import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { EventSettings, newEventCode } from '../../src/services/eventSettings.js';
import { createApp } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';

// Test passwords are generated per run, so no literal in the repo looks like a credential.
const START = `start-${crypto.randomBytes(8).toString('hex')}`;
const NEXT = `next-${crypto.randomBytes(12).toString('hex')}`;
const cfg = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: START, EVENT_CODE: 'CODE1', LAB_ADMIN_PASSWORD: 'x' });
const memStore = () => { const m = {}; return { m, get: async () => ({ ...m }), set: async (k, v) => { m[k] = v; } }; };

describe('EventSettings', () => {
  it('starts from the config and generates CMP codes', () => {
    const e = new EventSettings({ cfg });
    expect(e.code).toBe('CODE1');
    expect(e.checkPassword(START)).toBe(true);
    expect(newEventCode()).toMatch(/^CMP[0-9A-F]{6}$/);
  });
  it('saves a new code and a hashed password, and reloads them', async () => {
    const store = memStore();
    const e = await new EventSettings({ cfg, store }).load();
    await e.setCode('CMPABC123');
    await e.setPassword(START, NEXT);
    expect(store.m.event_code).toBe('CMPABC123');
    expect(store.m.admin_password_hash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(store.m.admin_password_hash).not.toContain(NEXT);
    const again = await new EventSettings({ cfg, store }).load();
    expect(again.code).toBe('CMPABC123');
    expect(again.checkPassword(NEXT)).toBe(true);
    expect(again.checkPassword(START)).toBe(false);
  });
  it('refuses a bad code, a wrong current password and a short new one', async () => {
    const e = new EventSettings({ cfg });
    await expect(e.setCode('a b')).rejects.toThrow(/4 to 24/);
    await expect(e.setPassword('wrong', NEXT)).rejects.toThrow(/current password/);
    await expect(e.setPassword(START, 'short')).rejects.toThrow(/12 characters/);
  });
});

describe('admin event controls', () => {
  const deps = () => ({ cfg, patterns: [], sessionSecret: 's', runner: { timeouts: {} }, cache: { size: 0 }, mongo: {},
    gate: { run: (_o, fn) => fn(), status: () => ({}) },
    workspaces: { assign: async () => ({ schema: 'WS_T' }), findByEmail: async () => null, storage: async () => ({ full: false }) },
    event: new EventSettings({ cfg, store: memStore() }) });
  const adminCookie = async (app, pw) => (await request(app).post('/api/admin/login').send({ password: pw })).headers['set-cookie'][0].split(';')[0];
  it('a new event code takes effect for sign-in at once', async () => {
    const app = createApp(deps());
    const c = await adminCookie(app, START);
    const r = await request(app).post('/api/admin/event-code').set('Cookie', c).send({});
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^CMP[0-9A-F]{6}$/);
    const who = { name: 'A', email: 'a@example.com' };
    expect((await request(app).post('/api/signin').send({ ...who, code: 'CODE1' })).status).toBe(403);
    expect((await request(app).post('/api/signin').send({ ...who, code: r.body.code })).status).toBe(200);
  });
  it('a changed password replaces the old one', async () => {
    const app = createApp(deps());
    const c = await adminCookie(app, START);
    expect((await request(app).post('/api/admin/password').set('Cookie', c).send({ current: 'nope', next: NEXT })).status).toBe(403);
    expect((await request(app).post('/api/admin/password').set('Cookie', c).send({ current: START, next: NEXT })).status).toBe(200);
    expect((await request(app).post('/api/admin/login').send({ password: START })).status).toBe(403);
    expect((await request(app).post('/api/admin/login').send({ password: NEXT })).status).toBe(200);
  });
  it('the event controls need the instructor cookie', async () => {
    expect((await request(createApp(deps())).post('/api/admin/event-code').send({})).status).toBe(401);
  });
});
