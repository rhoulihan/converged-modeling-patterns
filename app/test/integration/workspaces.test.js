import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import oracledb from 'oracledb';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';

const cfg = testConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'admin-test' });
const connectString = `${cfg.db.host}:${cfg.db.port}/${cfg.db.service}`;
const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo; let ws; let runner;

// A held connection is a deterministic stand-in for an ORDS-side session that outlives its
// client (see task-11-report.md): opening one directly against a workspace guarantees
// DROP USER ... CASCADE hits ORA-01940 until it's closed, with no dependence on ORDS timing.
async function openAs(workspace) {
  return oracledb.getConnection({ user: workspace.schema, password: workspace.password, connectString });
}

async function countWhere(sql) {
  const c = await pools.control.getConnection();
  try {
    const r = await executeSql(c, sql, { timeoutMs: 10000, maxRows: 5, maxBytes: 10000 });
    return r.rows[0].N;
  } finally {
    await c.close();
  }
}

beforeAll(async () => {
  await bootstrap(cfg);
  pools = await createPools(cfg);
  mongo = new MongoPool(cfg);
  ws = new Workspaces({ cfg, pools });
  await ws.load();
  // Clean slate. dropAll() locks + parks every workspace and does one reap pass; it never
  // blocks on an ORDS-held session, so leftovers from an earlier run (locked, already out
  // of lab_users) are simply re-attempted here and re-parked if still not drainable.
  await ws.dropAll(mongo);
  runner = new Runner({ cfg, gate: new Gate(cfg.gate), cache: new ResultCache(cfg.cache), pools, mongo, workspaces: ws, patterns });
}, 300000);
afterAll(async () => { await ws?.dropAll(mongo); await mongo?.closeAll(); await pools?.close(); }, 300000);

describe('event workspaces', () => {
  it('keeps a stable session secret', async () => {
    const a = await ws.sessionSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ws.sessionSecret()).toBe(a);
  });

  it('assigns one workspace per email and returns it again for the same email', async () => {
    const a = await ws.assign({ email: 'a@example.com', name: 'A' });
    const b = await ws.assign({ email: 'b@example.com', name: 'B' });
    expect(a.schema).toMatch(/^WS_[0-9A-F]{6}$/);
    expect(b.schema).not.toBe(a.schema);
    expect((await ws.assign({ email: 'a@example.com', name: 'A again' })).schema).toBe(a.schema);
    expect((await ws.findBySchema(a.schema)).email).toBe('a@example.com');
  }, 120000);

  it('isolates attendees from each other', async () => {
    const a = await ws.findByEmail('a@example.com');
    const b = await ws.findByEmail('b@example.com');
    const userA = { id: a.schema, workspace: a };
    const userB = { id: b.schema, workspace: b };
    expect((await runner.reset({ user: userB, patternId: '01-extended-reference' })).ok).toBe(true);
    const out = await runner.runSql({ user: userA, patternId: null, text: `SELECT COUNT(*) FROM ${b.schema}.xr_advisors` });
    expect(out.results[0].kind).toBe('error');
    expect(['ORA-00942', 'ORA-01031']).toContain(out.results[0].code);
  }, 180000);

  it('serves the MongoDB API per workspace', async () => {
    const a = await ws.findByEmail('a@example.com');
    const user = { id: a.schema, workspace: a };
    const p = patterns.find((x) => x.id === '01-extended-reference');
    const out = await runner.runMongoText({ user, patternId: p.id, text: p.lanes.mongo[0].command });
    expect(out.results[0].kind).toBe('docs');
    expect(out.results[0].docs.length).toBeGreaterThan(0);
  }, 180000);

  it('claims a prewarmed workspace before creating a new one', async () => {
    const pre = await ws.provision();
    const before = (await ws.list()).length;
    const c = await ws.assign({ email: 'c@example.com', name: 'C' });
    expect(c.schema).toBe(pre.schema);
    expect((await ws.list()).length).toBe(before);
  }, 120000);

  it('end event locks a still-connected workspace and parks it, drops one with no open session in the same call, and reapPending finishes it once the connection closes', async () => {
    // Deterministic stand-in for an ORDS-held session: this connection guarantees `held`
    // hits ORA-01940 on DROP USER for as long as it stays open — no dependence on ORDS
    // session-release timing (see task-11-report.md's evidence that timing is unpredictable
    // enough to make the previous version of this test flaky).
    const held = await ws.provision({ email: 'held@example.com', name: 'Held' });
    const heldConn = await openAs(held);

    // No connection ever opened against this one, so it must drop synchronously.
    const fresh = await ws.provision({ email: 'fresh@example.com', name: 'Fresh' });

    const { dropped, pending } = await ws.dropAll(mongo);
    expect(await ws.list()).toEqual([]); // pending workspaces are invisible to list()
    expect(dropped).toBeGreaterThanOrEqual(1); // at least `fresh`
    expect(pending).toBeGreaterThanOrEqual(1); // at least `held`

    expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${fresh.schema}'`)).toBe(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(1);

    // Locked immediately — no new connection succeeds, regardless of the still-open old one.
    await expect(openAs(held)).rejects.toThrow(/ORA-28000/);

    // Once the connection that was blocking it closes, reapPending() finishes the job.
    await heldConn.close();
    await ws.reapPending();
    expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${held.schema}'`)).toBe(0);
  }, 60000);

  it('startReaper drops a parked workspace on its own once unblocked, and stops cleanly', async () => {
    const held = await ws.provision({ email: 'reaper@example.com', name: 'Reaper' });
    const heldConn = await openAs(held);
    await ws.dropAll(mongo); // locks + parks `held`; the open connection guarantees ORA-01940

    const spy = vi.spyOn(ws, 'reapPending');
    const stop = ws.startReaper(500);
    try {
      await heldConn.close(); // now droppable — the reaper's own next tick should pick it up

      const deadline = Date.now() + 20000;
      let gone = false;
      while (Date.now() < deadline) {
        if (await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`) === 0) {
          gone = true;
          break;
        }
        await sleep(300);
      }
      expect(gone).toBe(true);
    } finally {
      stop();
    }

    // No further passes run once stopped.
    const callsAtStop = spy.mock.calls.length;
    await sleep(1500); // several more 500ms intervals' worth
    expect(spy.mock.calls.length).toBe(callsAtStop);
    spy.mockRestore();

    expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${held.schema}'`)).toBe(0);
  }, 30000);
});
