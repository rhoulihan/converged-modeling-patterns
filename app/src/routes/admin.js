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

  // Rebuilds every pattern in one workspace. Its own gate userId, so it never collides with
  // the attendee's own queued request (the gate allows one queued request per userId).
  // Returns the failures, one line per pattern; [] when every build succeeded.
  const buildAll = async (w) => {
    const user = { id: `admin-reset-${w.schema}`, workspace: w };
    const failed = [];
    for (const p of patterns) {
      try {
        const out = await runner.reset({ user, patternId: p.id });
        if (!out.ok) failed.push(`${p.id}: ${out.errors[0]?.error ?? 'build failed'}`);
      } catch (e) {
        failed.push(`${p.id}: ${e.message}`);
      }
    }
    return failed;
  };

  // Progress of the last "reset every attendee" (runs in the background, like prewarm).
  let resets = { running: false, total: 0, done: 0, failed: [] };

  r.get('/status', wrap(async (req, res) => res.json({
    gate: gate.status(),
    cache: { size: cache.size, enabled: cache.enabled },
    timeouts: runner.timeouts,
    resets,
    pending: await workspaces.pendingCount(),
    attendees: await workspaces.list(),
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
      if (resets.running) return res.status(409).json({ error: 'a reset of every attendee is already running' });
      const all = await workspaces.list();
      resets = { running: true, total: all.length, done: 0, failed: [] };
      const state = resets;
      (async () => {
        for (const a of all) {
          try {
            const w = await workspaces.findBySchema(a.schema);
            const failed = w ? await buildAll(w) : ['workspace no longer exists'];
            if (failed.length) state.failed.push({ schema: a.schema, error: failed.join('; ') });
          } catch (e) {
            state.failed.push({ schema: a.schema, error: e.message });
          }
          state.done += 1;
        }
      })().catch((e) => console.error('[lab-ui] reset-all failed', e)).finally(() => { state.running = false; });
      return res.status(202).json({ started: all.length });
    }
    const w = await workspaces.findBySchema(schema);
    if (!w) return res.status(404).json({ error: 'no such workspace' });
    const failed = await buildAll(w);
    if (failed.length) return res.status(500).json({ ok: false, error: `reset failed: ${failed.join('; ')}`, errors: failed });
    return res.json({ ok: true, reset: 1 });
  }));

  r.post('/end-event', wrap(async (req, res) => {
    const { dropped, pending } = await gate.run({ userId: 'admin', label: 'end event', exclusive: true }, () => workspaces.dropAll(mongo));
    cache.clear();
    return res.json({ dropped, pending });
  }));

  return r;
}
