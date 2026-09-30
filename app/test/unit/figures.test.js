import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { figuresRouter } from '../../src/routes/figures.js';

function app() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-'));
  fs.mkdirSync(path.join(root, '02-computed', 'figures'), { recursive: true });
  fs.writeFileSync(path.join(root, '02-computed', 'figures', 'erd.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'secret.svg'), '<svg/>');
  const a = express();
  a.use('/figures', figuresRouter({ cfg: { patternsDir: root }, patterns: [{ id: '02-computed' }] }));
  return a;
}

describe('GET /figures/:pattern/:file', () => {
  it('serves a known figure as svg', async () => {
    const r = await request(app()).get('/figures/02-computed/erd.svg');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    // Opened full size in its own tab, an SVG is a document: no scripts, no external loads.
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
  });
  it.each([
    '/figures/99-nope/erd.svg',
    '/figures/02-computed/missing.svg',
    '/figures/02-computed/..%2Fsecret.svg',
    '/figures/02-computed/ERD.SVG',
    '/figures/02-computed/erd.svg.js',
  ])('404 for %s', async (u) => {
    expect((await request(app()).get(u)).status).toBe(404);
  });
});
