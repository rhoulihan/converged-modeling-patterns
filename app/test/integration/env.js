import { loadConfig } from '../../src/config.js';

export function testConfig(overrides = {}) {
  return loadConfig({
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: process.env.DB_PORT ?? '1522',
    MONGO_HOST: process.env.MONGO_HOST ?? process.env.DB_HOST ?? 'localhost',
    MONGO_PORT: process.env.MONGO_PORT ?? '27018',
    ORACLE_PASSWORD: process.env.ORACLE_PASSWORD ?? 'Sandbox2026',
    CMP_PASSWORD: process.env.CMP_PASSWORD ?? 'CmpUser2026',
    // Pass the live LAB_ADMIN password through: bootstrap() runs ALTER USER lab_admin with it,
    // so a mismatch would lock a running console out of its control pool.
    LAB_ADMIN_PASSWORD: process.env.LAB_ADMIN_PASSWORD ?? 'LabAdmin2026',
    ...overrides,
  }, { allowDefaultSecrets: true });
}

// Integration tests share the lab's database with whatever else is using it (a solo lab, or
// a console someone left running). They clean up ONLY the workspaces they created: lock +
// park those, then reap just those rows. Never Workspaces.dropAll() for cleanup.
export async function dropOwn(ws, mongo, schemas) {
  const own = [...new Set(schemas)].filter(Boolean);
  if (!own.length) return { dropped: 0, pending: 0 };
  await ws.park(own, mongo);
  return ws.reapPending(own);
}

// Schemas in lab_users or lab_pending_drop that this test did not create. A test that must
// exercise dropAll() itself (or reset-all) skips unless this is empty.
export async function foreignRows(ws, own) {
  const mine = new Set(own);
  const rows = await ws.withControl(async (c) => (await c.execute(
    'SELECT schema_name FROM lab_users UNION SELECT schema_name FROM lab_pending_drop')).rows.map((r) => r[0]));
  return rows.filter((s) => !mine.has(s));
}

// Skip the running test, with the reason, when the database holds rows it did not create.
export async function skipUnlessOnlyOwn(ctx, ws, own) {
  const foreign = await foreignRows(ws, own);
  if (!foreign.length) return false;
  const why = `skipped: lab_users/lab_pending_drop hold ${foreign.length} workspace(s) this test did not create `
    + `(${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', …' : ''}); it would touch them`;
  console.warn(`[test] ${ctx.task.name}: ${why}`);
  ctx.skip(why);
  return true;
}
