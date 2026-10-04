import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import oracledb from 'oracledb';
import { testConfig, dropOwn, skipUnlessOnlyOwn } from './env.js';
import { bootstrap, createPools, executeSql } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';

// Generated per run, so no literal in the repo looks like a credential.
const ADMIN_PW = `admin-${crypto.randomBytes(8).toString('hex')}`;

const cfg = testConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: ADMIN_PW });
const connectString = `${cfg.db.host}:${cfg.db.port}/${cfg.db.service}`;
const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo; let ws; let runner;
// Every workspace this file creates. Cleanup touches these and nothing else.
const own = new Set();
const mine = (w) => { own.add(w.schema); return w; };
const EMAILS = ['a', 'b', 'c', 'held', 'fresh', 'reaper', 'stuck'].map((x) => `${x}@example.com`);

// Park + reap our own workspaces. One still held by an ORDS session gets the reaper's kill
// path at once (its parked time is backdated — only for our own rows) instead of in 2 min.
async function cleanupOwn(schemas) {
  const r = await dropOwn(ws, mongo, schemas);
  if (!r.pending) return r;
  await control("UPDATE lab_pending_drop SET requested_at = SYSTIMESTAMP - INTERVAL '3' MINUTE "
    + `WHERE schema_name IN (${schemas.map((_, i) => `:s${i}`).join(', ')})`,
  Object.fromEntries(schemas.map((x, i) => [`s${i}`, x])));
  return ws.reapPending(schemas);
}

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

async function control(sql, binds = {}) {
  const c = await pools.control.getConnection();
  try {
    return await c.execute(sql, binds, { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT });
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
  // Clean slate for this file only: workspaces an earlier, interrupted run left behind under
  // this file's own test emails. Nobody else's workspace is touched.
  const leftovers = (await Promise.all(EMAILS.map((e) => ws.findByEmail(e)))).filter(Boolean).map((w) => w.schema);
  if (leftovers.length) await cleanupOwn(leftovers);
  runner = new Runner({ cfg, gate: new Gate(cfg.gate), cache: new ResultCache(cfg.cache), pools, mongo, workspaces: ws, patterns });
}, 300000);
afterAll(async () => {
  if (ws) await cleanupOwn([...own]);
  await mongo?.closeAll(); await pools?.close();
}, 300000);

describe('event workspaces', () => {
  it('reports workspace and user-data storage from the segment dictionary', async () => {
    const s = await ws.storage({ maxAgeMs: 0 });
    expect(s.userBytes).toBeGreaterThan(0);                  // CMP_USER and LAB_ADMIN hold data
    expect(s.workspaceBytes).toBeGreaterThanOrEqual(0);
    expect(s.userBytes).toBeGreaterThanOrEqual(s.workspaceBytes);
    expect(s.capBytes).toBe(cfg.storageCapBytes);
    expect(s.full).toBe(s.workspaceBytes >= s.capBytes);
  });

  it('keeps a stable session secret', async () => {
    const a = await ws.sessionSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ws.sessionSecret()).toBe(a);
  });

  it('assigns one workspace per email and returns it again for the same email', async () => {
    const a = mine(await ws.assign({ email: 'a@example.com', name: 'A' }));
    const b = mine(await ws.assign({ email: 'b@example.com', name: 'B' }));
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

  it('claims a prewarmed workspace before creating a new one', async (ctx) => {
    // Another prewarmed workspace could be claimed instead of ours: only run on a clean DB.
    if (await skipUnlessOnlyOwn(ctx, ws, own)) return;
    const pre = mine(await ws.provision());
    const before = (await ws.list()).length;
    const c = mine(await ws.assign({ email: 'c@example.com', name: 'C' }));
    expect(c.schema).toBe(pre.schema);
    expect((await ws.list()).length).toBe(before);
  }, 120000);

  it('end event locks and parks every workspace and returns; reapPending drops the free one and finishes the held one once its connection closes', async (ctx) => {
    // dropAll() drops EVERY workspace: only run when all of them are this file's own.
    if (await skipUnlessOnlyOwn(ctx, ws, own)) return;
    // Deterministic stand-in for an ORDS-held session: this connection guarantees `held`
    // hits ORA-01940 on DROP USER for as long as it stays open — no dependence on ORDS
    // session-release timing (see task-11-report.md's evidence that timing is unpredictable
    // enough to make the previous version of this test flaky).
    const held = mine(await ws.provision({ email: 'held@example.com', name: 'Held' }));
    const heldConn = await openAs(held);

    // No connection ever opened against this one, so the first reap pass must drop it.
    const fresh = mine(await ws.provision({ email: 'fresh@example.com', name: 'Fresh' }));

    const parked = await ws.dropAll(mongo);
    expect(parked.dropped).toBe(0); // dropAll only locks + parks; the reaper drops
    expect(parked.pending).toBeGreaterThanOrEqual(2);
    expect(await ws.list()).toEqual([]); // pending workspaces are invisible to list()

    const { dropped, pending } = await ws.reapPending([...own]);
    expect(dropped).toBeGreaterThanOrEqual(1); // at least `fresh`
    expect(pending).toBeGreaterThanOrEqual(1); // at least `held`

    expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${fresh.schema}'`)).toBe(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(1);

    // Locked immediately — no new connection succeeds, regardless of the still-open old one.
    await expect(openAs(held)).rejects.toThrow(/ORA-28000/);

    // Once the connection that was blocking it closes, reapPending() finishes the job.
    await heldConn.close();
    await ws.reapPending([held.schema]);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${held.schema}'`)).toBe(0);
  }, 60000);

  it('startReaper drops a parked workspace on its own once unblocked, and stops cleanly', async (ctx) => {
    // dropAll() and the unfiltered reaper touch every workspace: only run on our own rows.
    if (await skipUnlessOnlyOwn(ctx, ws, own)) return;
    const held = mine(await ws.provision({ email: 'reaper@example.com', name: 'Reaper' }));
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

  it('reapPending kills the sessions of a workspace parked 2+ min, drops it, and skips a non-WS_ row without stopping', async (ctx) => {
    if (await skipUnlessOnlyOwn(ctx, ws, own)) return;
    const held = mine(await ws.provision({ email: 'stuck@example.com', name: 'Stuck' }));
    const heldConn = await openAs(held); // stands in for an ORDS pool session that never lets go
    await ws.dropAll(mongo); // parks `held`: parked < 2 min, so no kill yet
    expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(1);

    await control("MERGE INTO lab_pending_drop d USING (SELECT 'NOT_A_WS' AS s FROM dual) x ON (d.schema_name = x.s) "
      + 'WHEN NOT MATCHED THEN INSERT (schema_name) VALUES (x.s)');
    // Backdate only the rows this test parked — never a real workspace on the shared DB.
    await control("UPDATE lab_pending_drop SET requested_at = SYSTIMESTAMP - INTERVAL '3' MINUTE WHERE schema_name IN (:held, 'NOT_A_WS')",
      { held: held.schema });
    try {
      await ws.reapPending([held.schema, 'NOT_A_WS']);

      expect(await countWhere(`SELECT COUNT(*) AS n FROM all_users WHERE username = '${held.schema}'`)).toBe(0);
      expect(await countWhere(`SELECT COUNT(*) AS n FROM lab_pending_drop WHERE schema_name = '${held.schema}'`)).toBe(0);
      await expect(heldConn.execute('SELECT 1 FROM dual')).rejects.toThrow();

      const bogus = (await control("SELECT last_error FROM lab_pending_drop WHERE schema_name = 'NOT_A_WS'")).rows;
      expect(bogus).toHaveLength(1);
      expect(bogus[0].LAST_ERROR).toMatch(/not a WS_ workspace name/);
    } finally {
      await heldConn.close().catch(() => {});
      await control("DELETE FROM lab_pending_drop WHERE schema_name = 'NOT_A_WS'");
    }
  }, 60000);
});
