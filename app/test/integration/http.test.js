// app/test/integration/http.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import { testConfig, dropOwn, skipUnlessOnlyOwn } from './env.js';
import { bootstrap, createPools } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';
import { createApp } from '../../src/server.js';

const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo;

async function build(env) {
  const cfg = testConfig(env);
  const gate = new Gate(cfg.gate);
  const cache = new ResultCache(cfg.cache);
  const workspaces = new Workspaces({ cfg, pools });
  await workspaces.load();
  const runner = new Runner({ cfg, gate, cache, pools, mongo, workspaces, patterns });
  const sessionSecret = await workspaces.sessionSecret();
  return { app: createApp({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret }), gate, workspaces };
}

beforeAll(async () => {
  const cfg = testConfig();
  await bootstrap(cfg);
  pools = await createPools(cfg);
  mongo = new MongoPool(cfg);
}, 300000);
afterAll(async () => { await mongo?.closeAll(); await pools?.close(); });

describe('solo mode', () => {
  let app;
  beforeAll(async () => { ({ app } = await build({})); });

  it('describes the lab', async () => {
    expect((await request(app).get('/api/config')).body).toEqual({ mode: 'solo', eventCodeRequired: false, instructor: true });
    const r = await request(app).get('/api/patterns');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(6);
    expect(r.body[0].cards.document[0]).toHaveProperty('sql');
  });
  it('runs SQL and returns Oracle errors with HTTP 200', async () => {
    const ok = await request(app).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 AS n FROM dual' });
    expect(ok.status).toBe(200);
    expect(ok.body.results[0].rows[0].N).toBe(1);
    const bad = await request(app).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT * FROM no_such_table_xyz' });
    expect(bad.status).toBe(200);
    expect(bad.body.results[0].code).toBe('ORA-00942');
  });
  it('runs a MongoDB command', async () => {
    const r = await request(app).post('/api/run').send({ lane: 'mongo', patternId: null, text: 'show collections' });
    expect(r.status).toBe(200);
    expect(r.body.results[0].kind).toBe('collections');
  });
  it('rejects a bad lane with 400', async () => {
    expect((await request(app).post('/api/run').send({ lane: 'js', text: 'x' })).status).toBe(400);
  });
  it('maps a paused gate to 423', async () => {
    const { app: a, gate } = await build({});
    gate.pause(true);
    const r = await request(a).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 FROM dual' });
    expect(r.status).toBe(423);
    expect(r.body.error).toBe('paused by instructor');
  });
  it('maps queue timeout to 429', async () => {
    const { app: a, gate } = await build({ QUEUE_TIMEOUT_MS: '200' });
    gate.run({ userId: 'someone-else', label: 'hold' }, () => new Promise((res) => setTimeout(res, 1500)));
    const r = await request(a).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 FROM dual' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('busy, retry');
  });
  it('reports the queue position', async () => {
    const r = await request(app).get('/api/queue');
    expect(r.body).toEqual({ position: null, depth: 0, paused: false });
  });
});

describe('event mode', () => {
  let app; let workspaces;
  beforeAll(async () => { ({ app, workspaces } = await build({ LAB_MODE: 'event', ADMIN_PASSWORD: 'admin-test', EVENT_CODE: 'LAB26' })); });
  // Only the workspace(s) this block signed in: never another run's or a live event's.
  afterAll(async () => {
    const mine = (await Promise.all(['a@example.com'].map((e) => workspaces.findByEmail(e)))).filter(Boolean);
    await dropOwn(workspaces, mongo, mine.map((w) => w.schema));
  }, 300000);

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).post('/api/run').send({ lane: 'sql', text: 'SELECT 1 FROM dual' })).status).toBe(401);
  });
  it('checks the event code', async () => {
    const r = await request(app).post('/api/signin').send({ name: 'A', email: 'a@example.com', code: 'nope' });
    expect(r.status).toBe(403);
  });
  it('signs in, then runs SQL in the attendee workspace', async () => {
    const agent = request.agent(app);
    const s = await agent.post('/api/signin').send({ name: 'A', email: 'a@example.com', code: 'LAB26' });
    expect(s.status).toBe(200);
    expect(s.body.schema).toMatch(/^WS_/);
    const me = await agent.get('/api/me');
    expect(me.body.user.email).toBe('a@example.com');
    const r = await agent.post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT USER AS u FROM dual' });
    expect(r.body.results[0].rows[0].U).toBe(s.body.schema);
  }, 120000);
  it('protects the admin API', async () => {
    expect((await request(app).get('/api/admin/status')).status).toBe(401);
    expect((await request(app).post('/api/admin/login').send({ password: 'wrong' })).status).toBe(403);
    const admin = request.agent(app);
    expect((await admin.post('/api/admin/login').send({ password: 'admin-test' })).status).toBe(200);
    const st = await admin.get('/api/admin/status');
    expect(st.status).toBe(200);
    expect(st.body.gate.permits).toBe(1);
    expect(st.body.attendees.length).toBeGreaterThanOrEqual(1);
    expect((await admin.post('/api/admin/pause').send({ on: true })).body).toEqual({ paused: true });
    expect((await admin.post('/api/admin/pause').send({ on: false })).body).toEqual({ paused: false });
    expect((await admin.post('/api/admin/timeouts').send({ sqlMs: 5000, mongoMs: 5000 })).body).toEqual({ sqlMs: 5000, mongoMs: 5000 });
    expect((await admin.post('/api/admin/timeouts').send({ sqlMs: 5, mongoMs: 5000 })).status).toBe(400);
  });
  it('resets every attendee in the background (202) and reports progress in status', async (ctx) => {
    const a = await workspaces.findByEmail('a@example.com');
    // Reset-all rebuilds EVERY workspace: only run when the only one is this test's own.
    if (await skipUnlessOnlyOwn(ctx, workspaces, [a.schema])) return;
    const admin = request.agent(app);
    expect((await admin.post('/api/admin/login').send({ password: 'admin-test' })).status).toBe(200);
    const r = await admin.post('/api/admin/reset-attendee').send({ schema: '*' });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ started: 1 });
    let st;
    const deadline = Date.now() + 240000;
    do {
      await new Promise((res) => { setTimeout(res, 500); });
      st = (await admin.get('/api/admin/status')).body;
    } while (st.resets.running && Date.now() < deadline);
    expect(st.resets).toMatchObject({ running: false, total: 1, done: 1, failed: [] });
    expect(st.pending).toBe(0);
    expect(st.attendees.find((x) => x.schema === a.schema).built).toHaveLength(6);
    expect((await admin.post('/api/admin/reset-attendee').send({ schema: a.schema })).body).toEqual({ ok: true, reset: 1 });
  }, 300000);
});
