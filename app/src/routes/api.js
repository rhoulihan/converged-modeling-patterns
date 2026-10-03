// app/src/routes/api.js
import express from 'express';
import { GateError } from '../gate.js';
import { sign, verify, parseCookies, cookie } from '../services/auth.js';
import { FailureLimit } from '../services/failureLimit.js';

const DAY = 24 * 3600;

export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof GateError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[lab-ui]', err);
    return res.status(500).json({ error: 'internal error' });
  });
}

export function apiRouter({ cfg, runner, workspaces, gate, patterns, sessionSecret, publicMode = false, signinLimit = new FailureLimit() }) {
  const r = express.Router();
  const publicPaths = new Set(['/config', '/signin', '/admin/login']);

  r.use(wrap(async (req, res, next) => {
    if (cfg.mode === 'solo') {
      const w = workspaces.solo();
      req.user = { id: 'solo', workspace: w, profile: { schema: w.schema, email: null, name: null } };
      return next();
    }
    if (publicPaths.has(req.path) || req.path.startsWith('/admin/')) return next();
    const schema = verify(parseCookies(req.headers.cookie).lab_sid, sessionSecret);
    const w = schema ? await workspaces.findBySchema(schema) : null;
    if (!w) return res.status(401).json({ error: 'sign in first' });
    req.user = { id: w.schema, workspace: w, profile: { schema: w.schema, email: w.email, name: w.name } };
    return next();
  }));

  r.get('/config', (req, res) => res.json({ mode: cfg.mode, eventCodeRequired: cfg.mode === 'event' && Boolean(cfg.event.code), instructor: !publicMode }));

  r.post('/signin', wrap(async (req, res) => {
    if (cfg.mode !== 'event') return res.status(404).json({ error: 'not in event mode' });
    // req.ip: the socket address on the LAN; behind the public tunnel, the client address the
    // tunnel appended to X-Forwarded-For (the public app trusts exactly that one hop).
    const wait = signinLimit.retryAfter(req.ip);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return res.status(429).json({ error: `too many failed sign-ins: try again in ${Math.ceil(wait / 60)} minute(s)` });
    }
    const { name, email, code } = req.body ?? {};
    if (!name?.trim() || !/^[^@\s]+@[^@\s]+$/.test(email ?? '')) {
      signinLimit.fail(req.ip);
      return res.status(400).json({ error: 'name and a valid email are required' });
    }
    if (cfg.event.code && code !== cfg.event.code) {
      signinLimit.fail(req.ip);
      return res.status(403).json({ error: 'wrong event code' });
    }
    // Storage cap: a returning attendee keeps their workspace; a new one is refused when full.
    if (!(await workspaces.findByEmail(email)) && (await workspaces.storage()).full) {
      return res.status(503).json({ error: 'The lab is full: no new workspaces can be created. Ask the instructor.' });
    }
    const w = await gate.run({ userId: email.toLowerCase(), label: 'sign-in', exclusive: true }, () => workspaces.assign({ email, name: name.trim() }));
    res.setHeader('Set-Cookie', cookie('lab_sid', sign(w.schema, sessionSecret), { maxAgeSec: 7 * DAY }));
    return res.json({ schema: w.schema });
  }));

  r.get('/me', (req, res) => res.json({ mode: cfg.mode, user: req.user.profile }));

  r.get('/patterns', (req, res) => res.json(patterns.map((p) => ({
    id: p.id,
    meta: p.meta,
    cards: {
      document: p.lanes.document.map(({ title, notes, sql, mongo, measure, help }) => ({ title, notes, sql, mongo, measure, help })),
      converged: p.lanes.converged.map(({ title, notes, sql, mongo, measure, help }) => ({ title, notes, sql, mongo, measure, help })),
      mongo: p.lanes.mongo.map(({ title, notes, command, sql, help }) => ({ title, notes, command, sql, help })),
    },
    measures: p.measures.map((m) => ({ tag: m.tag, documentSql: m.document.sql, convergedSql: m.converged.sql,
      help: { document: m.document.help, converged: m.converged.help } })),
  }))));

  const validPattern = (id) => id === null || id === undefined || patterns.some((p) => p.id === id);

  r.post('/run', wrap(async (req, res) => {
    const { lane, patternId = null, text } = req.body ?? {};
    if (!['sql', 'mongo'].includes(lane) || typeof text !== 'string' || !validPattern(patternId)) {
      return res.status(400).json({ error: 'lane must be "sql" or "mongo", text a string, patternId a known pattern or null' });
    }
    const out = lane === 'sql'
      ? await runner.runSql({ user: req.user, patternId, text })
      : await runner.runMongoText({ user: req.user, patternId, text });
    return res.json(out);
  }));

  r.get('/queue', (req, res) => {
    const s = gate.status();
    res.json({ position: gate.position(req.user.id), depth: s.queued.length, paused: s.paused });
  });

  r.post('/measure', wrap(async (req, res) => {
    const { patternId, tag } = req.body ?? {};
    const p = patterns.find((x) => x.id === patternId);
    if (!p || !p.measures.some((m) => m.tag === tag)) return res.status(400).json({ error: 'unknown pattern or measure tag' });
    return res.json(await runner.measure({ user: req.user, patternId, tag }));
  }));

  r.post('/reset', wrap(async (req, res) => {
    const { patternId } = req.body ?? {};
    if (!patterns.some((p) => p.id === patternId)) return res.status(400).json({ error: 'unknown pattern' });
    return res.json(await runner.reset({ user: req.user, patternId }));
  }));

  return r;
}
