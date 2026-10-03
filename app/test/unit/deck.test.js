import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { deckRouter } from '../../src/routes/deck.js';
import { sign } from '../../src/services/auth.js';

// Session-signing key for the test: random per run, so no literal looks like a credential.
const SIGNING_KEY = crypto.randomBytes(16).toString('hex');
const DECK = 'converged-data-modeling-workshop1.html';

function app(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-'));
  const dir = path.join(root, 'presentations');
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.writeFileSync(path.join(dir, DECK), '<!DOCTYPE html><title>deck</title>');
  fs.writeFileSync(path.join(dir, 'dev-day-intro.html'), '<!DOCTYPE html><title>dev day</title>');
  fs.writeFileSync(path.join(dir, 'images', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(dir, 'build', 'build_deck.py'), 'print(1)');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'nope');
  const a = express();
  a.use('/deck', deckRouter({ cfg: { mode, presentationsDir: dir }, sessionSecret: SIGNING_KEY }));
  return a;
}
const admin = `lab_admin=${sign('admin', SIGNING_KEY)}`;

describe('/deck (instructor deck)', () => {
  it('event mode: refuses without the instructor sign-in and points to the admin page', async () => {
    const r = await request(app('event')).get('/deck/');
    expect(r.status).toBe(401);
    expect(r.text).toContain('/admin.html');
  });
  it('event mode: a forged or attendee cookie is refused too', async () => {
    const r = await request(app('event')).get('/deck/').set('Cookie', 'lab_admin=admin.forged');
    expect(r.status).toBe(401);
  });
  it('event mode: serves the deck and its assets to the signed-in instructor', async () => {
    const a = app('event');
    const r = await request(a).get('/deck/').set('Cookie', admin);
    expect(r.status).toBe(200);
    expect(r.text).toContain('<title>deck</title>');
    expect((await request(a).get('/deck/images/a.svg').set('Cookie', admin)).status).toBe(200);
  });
  it('solo mode: open, since there is no sign-in', async () => {
    expect((await request(app('solo')).get('/deck/')).status).toBe(200);
  });
  it('serves other decks in presentations/ (the Dev Day intro) under the same instructor gate', async () => {
    const a = app('event');
    expect((await request(a).get('/deck/dev-day-intro.html')).status).toBe(401);
    const r = await request(a).get('/deck/dev-day-intro.html').set('Cookie', admin);
    expect(r.status).toBe(200);
    expect(r.text).toContain('dev day');
  });

  it('redirects /deck to /deck/', async () => {
    const r = await request(app('solo')).get('/deck');
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe('/deck/');
  });
  it.each(['/deck/build/build_deck.py', '/deck/..%2Fsecret.txt', '/deck/%2e%2e/secret.txt'])('404 for %s', async (u) => {
    expect((await request(app('solo')).get(u).set('Cookie', admin)).status).toBe(404);
  });
});
