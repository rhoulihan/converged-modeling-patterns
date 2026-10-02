import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp, INSTRUCTOR_PATHS } from '../../src/server.js';
import { loadConfig } from '../../src/config.js';
import { sign } from '../../src/services/auth.js';

const SECRET = 'test-secret';
const admin = `lab_admin=${sign('admin', SECRET)}`;

function deps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
  fs.writeFileSync(path.join(dir, 'converged-data-modeling-workshop1.html'), '<!DOCTYPE html><title>deck</title>');
  const cfg = { ...loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', EVENT_CODE: 'CODE', LAB_ADMIN_PASSWORD: 'x' }), presentationsDir: dir };
  return { cfg, patterns: [], sessionSecret: SECRET, workspaces: {}, gate: {}, runner: {}, cache: {}, mongo: {} };
}

describe('public listener (attendee side only)', () => {
  it('PUBLIC_PORT is optional and validated', () => {
    expect(loadConfig({}).publicPort).toBeNull();
    expect(loadConfig({ PUBLIC_PORT: '3001' }).publicPort).toBe(3001);
    expect(() => loadConfig({ PUBLIC_PORT: 'abc' })).toThrow(/PUBLIC_PORT/);
  });

  it('the instructor side does not exist there, even with a valid instructor cookie', async () => {
    const app = createApp(deps(), { publicMode: true });
    for (const p of ['/admin.html', '/js/admin.js', '/api/admin/status', '/deck/', '/deck/images/oracle-logo.svg']) {
      const r = await request(app).get(p).set('Cookie', admin);
      expect(r.status, p).toBe(404);
    }
    const login = await request(app).post('/api/admin/login').send({ password: 'pw' });
    expect(login.status).toBe(404);
    expect(login.headers['set-cookie']).toBeUndefined();
  });

  it('the attendee side is served, and the page is told to hide the instructor link', async () => {
    const app = createApp(deps(), { publicMode: true });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/js/app.js')).status).toBe(200);
    const cfg = await request(app).get('/api/config');
    expect(cfg.body).toMatchObject({ mode: 'event', eventCodeRequired: true, instructor: false });
  });

  it('the LAN listener is unchanged: instructor sign-in and the link are there', async () => {
    const app = createApp(deps());
    expect((await request(app).get('/admin.html')).status).toBe(200);
    expect((await request(app).post('/api/admin/login').send({ password: 'pw' })).status).toBe(200);
    expect((await request(app).get('/api/config')).body.instructor).toBe(true);
  });

  it('covers every instructor entry point', () => {
    expect(INSTRUCTOR_PATHS).toEqual(['/admin.html', '/js/admin.js', '/api/admin', '/deck']);
  });
});
