import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
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
  await ws.dropAll(mongo); // clean slate
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

  it('end event drops every workspace', async () => {
    const n = await ws.dropAll(mongo);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await ws.list()).toEqual([]);
    const c = await pools.control.getConnection();
    const r = await executeSql(c, "SELECT COUNT(*) AS n FROM all_users WHERE username LIKE 'WS\\_%' ESCAPE '\\'", { timeoutMs: 10000, maxRows: 5, maxBytes: 10000 });
    await c.close();
    expect(r.rows[0].N).toBe(0);
  }, 300000);
});
