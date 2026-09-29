import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
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
const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo; let ws; let runner;

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

  it('end event locks every workspace immediately, drops the ones with no lingering ORDS session in the same call, and parks the rest for the reaper', async () => {
    // Capture credentials for everything currently assigned before end-event moves them
    // out of lab_users — lab_pending_drop doesn't store passwords, and whether any one
    // schema ends up "pending" vs. dropped in this same call depends on unpredictable
    // ORDS session timing (see task-11-report.md), so the test can't assume which one.
    const known = new Map();
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      const w = await ws.findByEmail(email);
      if (w) known.set(w.schema, w.password);
    }

    // Exercises the Mongo API on a fresh workspace: the Oracle API for MongoDB's ORDS-side
    // session can outlive the client disconnect, so this (like `a`, used earlier) is a
    // likely candidate to still be "pending" — but locked — immediately after dropAll().
    const used = await ws.assign({ email: 'used@example.com', name: 'Used' });
    known.set(used.schema, used.password);
    const p = patterns.find((x) => x.id === '01-extended-reference');
    const mongoOut = await runner.runMongoText({ user: { id: used.schema, workspace: used }, patternId: p.id, text: p.lanes.mongo[0].command });
    expect(mongoOut.results[0].kind).toBe('docs');

    // Never touches the Mongo API — no lingering session, so it must drop synchronously.
    const fresh = await ws.provision({ email: 'fresh@example.com', name: 'Fresh' });

    const { dropped, pending } = await ws.dropAll(mongo);
    expect(await ws.list()).toEqual([]); // pending workspaces are invisible to list()
    expect(dropped).toBeGreaterThanOrEqual(1); // at least `fresh`
    expect(pending).toBeGreaterThanOrEqual(1); // at least one of the Mongo-API users

    const c = await pools.control.getConnection();
    const freshGone = await executeSql(c, `SELECT COUNT(*) AS n FROM all_users WHERE username = '${fresh.schema}'`,
      { timeoutMs: 10000, maxRows: 5, maxBytes: 10000 });
    expect(freshGone.rows[0].N).toBe(0);

    const pendingRows = await executeSql(c, 'SELECT schema_name FROM lab_pending_drop', { timeoutMs: 10000, maxRows: 20, maxBytes: 10000 });
    await c.close();
    expect(pendingRows.rows.length).toBe(pending);
    const stillPending = pendingRows.rows.map((r) => r.SCHEMA_NAME).find((s) => known.has(s));
    expect(stillPending).toBeTruthy();

    // The still-pending workspace is locked immediately — no new connection succeeds,
    // regardless of whatever its old ORDS-held session is still doing. Do not wait for
    // that session to drain; ORA-28000 proves the lock, not a live connection count.
    await expect(oracledb.getConnection({
      user: stillPending,
      password: known.get(stillPending),
      connectString: `${cfg.db.host}:${cfg.db.port}/${cfg.db.service}`,
    })).rejects.toThrow(/ORA-28000/);

    // A second reapPending() is harmless — idempotent, safe to call again immediately.
    const again = await ws.reapPending();
    expect(again.pending).toBeLessThanOrEqual(pending);
  }, 60000);
});
