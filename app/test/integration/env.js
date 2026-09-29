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
