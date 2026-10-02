// app/src/server.js
import path from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { bootstrap, createPools } from './db/oracle.js';
import { MongoPool } from './db/mongo.js';
import { Gate } from './gate.js';
import { ResultCache } from './cache.js';
import { loadPatterns } from './content/patterns.js';
import { Workspaces } from './services/workspaces.js';
import { Runner } from './services/runner.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { figuresRouter } from './routes/figures.js';
import { deckRouter } from './routes/deck.js';

// The instructor side: the admin page and its script, the admin API and the deck.
export const INSTRUCTOR_PATHS = ['/admin.html', '/js/admin.js', '/api/admin', '/deck'];

// publicMode builds the app for the public listener: the instructor side does not exist there
// (404, as if never deployed), so a tunnel to it exposes only what attendees use. The LAN
// listener keeps everything, and the instructor runs the event from the LAN.
export function createApp(deps, { publicMode = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (publicMode) {
    // Only the tunnel can reach the public listener (it is bound to localhost), so trust exactly
    // one proxy hop: req.ip becomes the client address the tunnel appended to X-Forwarded-For,
    // and a client cannot pick its own by sending the header. The LAN app trusts no proxy.
    app.set('trust proxy', 1);
    app.use(INSTRUCTOR_PATHS, (req, res) => res.status(404).end());
  }
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/admin', adminRouter(deps));
  app.use('/api', apiRouter({ ...deps, publicMode }));
  app.use('/figures', figuresRouter(deps));
  app.use('/deck', deckRouter(deps));
  app.use(express.static(path.resolve(import.meta.dirname, '../public'), { maxAge: '1h' }));
  app.use((err, req, res, next) => { // body-parser errors etc.
    if (res.headersSent) return next(err);
    return res.status(err.status ?? 400).json({ error: err.type === 'entity.too.large' ? 'request too large' : 'bad request' });
  });
  return app;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForBootstrap(cfg) {
  for (let i = 1; i <= 60; i++) {
    try {
      await bootstrap(cfg);
      if (cfg.mode !== 'event') return;
      const pools = await createPools(cfg);
      const c = await pools.control.getConnection();
      const r = await c.execute("SELECT COUNT(*) FROM user_role_privs WHERE granted_role = 'ORDS_ADMINISTRATOR_ROLE'");
      await c.close(); await pools.close();
      if (r.rows[0][0] > 0) return;
      console.log('[lab-ui] waiting for ORDS to be installed…');
    } catch (e) {
      console.log(`[lab-ui] database not ready (${i}/60): ${e.message}`);
    }
    await sleep(10000);
  }
  throw new Error('database did not become ready in 10 minutes');
}

export async function main() {
  const cfg = loadConfig();
  await waitForBootstrap(cfg);
  const pools = await createPools(cfg);
  const mongo = new MongoPool(cfg);
  const gate = new Gate(cfg.gate);
  const cache = new ResultCache(cfg.cache);
  cache.enabled = cfg.cache.enabled;
  const patterns = loadPatterns(cfg.patternsDir);
  const workspaces = new Workspaces({ cfg, pools });
  await workspaces.load();
  if (cfg.mode === 'event') {
    workspaces.startReaper(30000, (fn) => gate.run({ userId: 'reaper', label: 'reap', exclusive: true }, fn));
  }
  const runner = new Runner({ cfg, gate, cache, pools, mongo, workspaces, patterns });
  const sessionSecret = await workspaces.sessionSecret();
  const deps = { cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret };
  createApp(deps).listen(cfg.port, () => console.log(`[lab-ui] ${cfg.mode} mode on :${cfg.port} · ${patterns.length} patterns`));
  if (cfg.publicPort) {
    createApp(deps, { publicMode: true }).listen(cfg.publicPort, () => console.log(`[lab-ui] public listener (attendee side only) on :${cfg.publicPort}`));
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
