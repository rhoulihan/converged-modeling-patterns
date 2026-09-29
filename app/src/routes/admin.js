// app/src/routes/admin.js
import express from 'express';
import crypto from 'node:crypto';
import { wrap } from './api.js';
import { sign, verify, parseCookies, cookie } from '../services/auth.js';

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function adminRouter({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret }) {
  const r = express.Router();
  if (cfg.mode !== 'event') {
    r.use((req, res) => res.status(404).json({ error: 'admin is only available in event mode' }));
    return r;
  }

  r.post('/login', (req, res) => {
    if (!same(req.body?.password ?? '', cfg.event.adminPassword)) return res.status(403).json({ error: 'wrong password' });
    res.setHeader('Set-Cookie', cookie('lab_admin', sign('admin', sessionSecret), { maxAgeSec: 12 * 3600 }));
    return res.json({ ok: true });
  });

  r.use((req, res, next) => (verify(parseCookies(req.headers.cookie).lab_admin, sessionSecret) === 'admin'
    ? next() : res.status(401).json({ error: 'admin sign-in required' })));

  const buildAll = async (w) => {
    const user = { id: w.schema, workspace: w };
    for (const p of patterns) await runner.reset({ user, patternId: p.id });
  };

  r.get('/status', wrap(async (req, res) => res.json({
    gate: gate.status(), cache: { size: cache.size, enabled: cache.enabled }, timeouts: runner.timeouts, attendees: await workspaces.list(),
  })));

  r.post('/timeouts', (req, res) => {
    const ok = (v) => Number.isInteger(v) && v >= 1000 && v <= 60000;
    const sqlMs = Number(req.body?.sqlMs); const mongoMs = Number(req.body?.mongoMs);
    if (!ok(sqlMs) || !ok(mongoMs)) return res.status(400).json({ error: 'sqlMs and mongoMs must be integers 1000–60000' });
    runner.timeouts = { sqlMs, mongoMs };
    return res.json(runner.timeouts);
  });

  r.post('/cancel', (req, res) => res.json({ cancelled: gate.cancel(Number(req.body?.id)) }));

  r.post('/pause', (req, res) => { gate.pause(Boolean(req.body?.on)); res.json({ paused: gate.status().paused }); });

  r.post('/cache', (req, res) => {
    cache.enabled = Boolean(req.body?.enabled);
    if (!cache.enabled) cache.clear();
    res.json({ enabled: cache.enabled });
  });

  r.post('/prewarm', (req, res) => {
    const count = Number(req.body?.count);
    if (!Number.isInteger(count) || count < 1 || count > 200) return res.status(400).json({ error: 'count must be 1–200' });
    (async () => {
      for (let i = 0; i < count; i++) {
        const w = await gate.run({ userId: `prewarm-${i}`, label: 'prewarm', exclusive: true }, () => workspaces.provision());
        await buildAll(w);
      }
    })().catch((e) => console.error('[lab-ui] prewarm failed', e));
    return res.status(202).json({ started: count });
  });

  r.post('/reset-attendee', wrap(async (req, res) => {
    const schema = String(req.body?.schema ?? '');
    if (schema === '*') {
      const all = await workspaces.list();
      for (const a of all) await buildAll(await workspaces.findBySchema(a.schema));
      return res.json({ ok: true, reset: all.length });
    }
    const w = await workspaces.findBySchema(schema);
    if (!w) return res.status(404).json({ error: 'no such workspace' });
    await buildAll(w);
    return res.json({ ok: true, reset: 1 });
  }));

  r.post('/end-event', wrap(async (req, res) => {
    const { dropped, pending } = await gate.run({ userId: 'admin', label: 'end event', exclusive: true }, () => workspaces.dropAll(mongo));
    cache.clear();
    return res.json({ dropped, pending });
  }));

  return r;
}
