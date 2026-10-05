import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function int(env, key, dflt, { min = 1 } = {}) {
  if (env[key] === undefined || env[key] === '') return dflt;
  const n = Number(env[key]);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} must be an integer >= ${min} (got "${env[key]}")`);
  return n;
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
}

// The repo's published default for LAB_ADMIN (compose.yml). Fine for a one-person solo lab;
// in event mode the room can reach the console, so it must be changed.
const DEFAULT_LAB_ADMIN_PASSWORD = 'LabAdmin2026';

// `allowDefaultSecrets` exists for the integration harness only: it exercises event-mode
// code paths against the lab's own database, whose LAB_ADMIN password is the default.
export function loadConfig(env = process.env, { allowDefaultSecrets = false } = {}) {
  const mode = env.LAB_MODE || 'solo';
  if (!['solo', 'event'].includes(mode)) throw new Error(`LAB_MODE must be "solo" or "event" (got "${mode}")`);
  // Bootstrap DDL embeds LAB_ADMIN_PASSWORD in a quoted identifier; a " would break it.
  for (const key of ['ORACLE_PASSWORD', 'CMP_PASSWORD', 'LAB_ADMIN_PASSWORD']) {
    if (String(env[key] ?? '').includes('"')) throw new Error(`${key} must not contain " (double quote)`);
  }
  const adminPassword = env.ADMIN_PASSWORD || null;
  const labAdminPassword = env.LAB_ADMIN_PASSWORD || DEFAULT_LAB_ADMIN_PASSWORD;
  if (mode === 'event' && !adminPassword) throw new Error('ADMIN_PASSWORD is required when LAB_MODE=event');
  if (mode === 'event' && !allowDefaultSecrets && labAdminPassword === DEFAULT_LAB_ADMIN_PASSWORD) {
    throw new Error('LAB_ADMIN_PASSWORD is still the repo default (LabAdmin2026); set your own before starting LAB_MODE=event');
  }
  return deepFreeze({
    mode,
    port: int(env, 'PORT', 3000),
    // Optional second listener for a public tunnel (e.g. Tailscale Funnel): the attendee side only.
    publicPort: env.PUBLIC_PORT ? int(env, 'PUBLIC_PORT', null) : null,
    // TRUST_PROXY=1: the main listener sits behind one reverse proxy (e.g. Caddy on a cloud VM), so
    // req.ip, which keys the sign-in failure limit, is the client address the proxy forwards.
    trustProxy: env.TRUST_PROXY === '1',
    patternsDir: env.PATTERNS_DIR || path.resolve(here, '../../patterns'),
    presentationsDir: env.PRESENTATIONS_DIR || path.resolve(here, '../../presentations'),
    db: {
      host: env.DB_HOST || 'oracle',
      port: int(env, 'DB_PORT', 1521),
      service: env.DB_SERVICE || 'FREEPDB1',
      sysPassword: env.ORACLE_PASSWORD || 'Sandbox2026',
      cmpUser: 'CMP_USER',
      cmpPassword: env.CMP_PASSWORD || 'CmpUser2026',
      labAdminPassword,
      poolMax: int(env, 'DB_POOL_MAX', 1),
    },
    mongo: { host: env.MONGO_HOST || env.DB_HOST || 'oracle', port: int(env, 'MONGO_PORT', 27017), poolMax: int(env, 'MONGO_POOL_MAX', 1) },
    gate: {
      // How many attendee statements run at once. Defaults to the pool size; exclusive work
      // (sign-in, reset, Measure it) still takes every permit.
      permits: int(env, 'GATE_PERMITS', int(env, 'DB_POOL_MAX', 1)),
      queueTimeoutMs: int(env, 'QUEUE_TIMEOUT_MS', 30000),
      sqlTimeoutMs: int(env, 'SQL_TIMEOUT_MS', 10000),
      mongoTimeoutMs: int(env, 'MONGO_TIMEOUT_MS', 10000),
    },
    cache: { maxEntries: int(env, 'CACHE_MAX_ENTRIES', 500), enabled: env.CACHE_ENABLED !== 'false' },
    limits: { maxRows: 500, maxBytes: 1048576, maxStatements: 20 },
    event: { code: env.EVENT_CODE || null, adminPassword },
    // New attendees are refused once the workspaces hold this much data: 26ai Free caps user
    // data at 12 GB for the whole database.
    storageCapBytes: int(env, 'WORKSPACE_STORAGE_CAP_GB', 10) * 1024 ** 3,
  });
}
