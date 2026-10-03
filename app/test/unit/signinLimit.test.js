import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { FailureLimit } from '../../src/services/failureLimit.js';
import { createApp } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';

describe('FailureLimit', () => {
  it('blocks a key after max failures and releases it when the oldest failure ages out', () => {
    let t = 0;
    const l = new FailureLimit({ max: 3, windowMs: 1000, now: () => t });
    for (let i = 0; i < 3; i++) { expect(l.retryAfter('a')).toBe(0); l.fail('a'); t += 100; }
    expect(l.retryAfter('a')).toBe(1);      // oldest at t=0, window ends at 1000, now 300
    expect(l.retryAfter('b')).toBe(0);      // other keys unaffected
    t = 1001;
    expect(l.retryAfter('a')).toBe(0);
  });
});

function deps(limit) {
  const cfg = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', EVENT_CODE: 'CODE', LAB_ADMIN_PASSWORD: 'x' });
  return {
    cfg, patterns: [], sessionSecret: 's', runner: {}, cache: {}, mongo: {},
    gate: { run: (_o, fn) => fn() },
    workspaces: { assign: async () => ({ schema: 'WS_TEST' }), findByEmail: async () => null, storage: async () => ({ full: false }) },
    signinLimit: limit,
  };
}
const good = { name: 'A', email: 'a@example.com', code: 'CODE' };
const bad = { ...good, code: 'WRONG' };

describe('attendee sign-in rate limit', () => {
  it('counts only failures, then answers 429 with Retry-After, even for the right code', async () => {
    const app = createApp(deps(new FailureLimit({ max: 3 })));
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/signin').send(good)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await request(app).post('/api/signin').send(bad)).status).toBe(403);
    const r = await request(app).post('/api/signin').send(good);
    expect(r.status).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.body.error).toMatch(/too many failed sign-ins/);
  });

  it('public listener: keys on the address the tunnel appended, not one the client claims', async () => {
    const app = createApp(deps(new FailureLimit({ max: 2 })), { publicMode: true });
    // The tunnel appends the real client address; a forged first entry changes nothing.
    for (const forged of ['1.1.1.1', '2.2.2.2']) {
      expect((await request(app).post('/api/signin').set('X-Forwarded-For', `${forged}, 70.0.0.1`).send(bad)).status).toBe(403);
    }
    expect((await request(app).post('/api/signin').set('X-Forwarded-For', '9.9.9.9, 70.0.0.1').send(good)).status).toBe(429);
    // A different real client is not affected.
    expect((await request(app).post('/api/signin').set('X-Forwarded-For', '70.0.0.2').send(good)).status).toBe(200);
  });

  it('LAN listener: ignores X-Forwarded-For, so a client cannot rotate it to escape the limit', async () => {
    const app = createApp(deps(new FailureLimit({ max: 2 })));
    for (const xff of ['1.1.1.1', '2.2.2.2']) {
      expect((await request(app).post('/api/signin').set('X-Forwarded-For', xff).send(bad)).status).toBe(403);
    }
    expect((await request(app).post('/api/signin').set('X-Forwarded-For', '3.3.3.3').send(good)).status).toBe(429);
  });
});

describe('workspace storage cap', () => {
  const capped = (full, existing) => ({ ...deps(new FailureLimit()),
    workspaces: { assign: async () => ({ schema: 'WS_TEST' }), findByEmail: async () => (existing ? { schema: 'WS_OLD' } : null), storage: async () => ({ full }) } });
  it('refuses a new attendee with 503 once the workspaces are full', async () => {
    const r = await request(createApp(capped(true, false))).post('/api/signin').send(good);
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/lab is full/);
  });
  it('still lets a returning attendee back in when full', async () => {
    expect((await request(createApp(capped(true, true))).post('/api/signin').send(good)).status).toBe(200);
  });
  it('lets new attendees in below the cap', async () => {
    expect((await request(createApp(capped(false, false))).post('/api/signin').send(good)).status).toBe(200);
  });
  it('defaults the cap to 10 GB and reads WORKSPACE_STORAGE_CAP_GB', () => {
    expect(loadConfig({}).storageCapBytes).toBe(10 * 1024 ** 3);
    expect(loadConfig({ WORKSPACE_STORAGE_CAP_GB: '2' }).storageCapBytes).toBe(2 * 1024 ** 3);
  });
});
