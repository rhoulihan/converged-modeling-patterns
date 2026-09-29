import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults to solo mode with a single-permit gate and pools of 1', () => {
    const c = loadConfig({});
    expect(c.mode).toBe('solo');
    expect(c.port).toBe(3000);
    expect(c.gate).toEqual({ permits: 1, queueTimeoutMs: 30000, sqlTimeoutMs: 10000, mongoTimeoutMs: 10000 });
    expect(c.db.poolMax).toBe(1);
    expect(c.mongo.poolMax).toBe(1);
    expect(c.cache).toEqual({ maxEntries: 500, enabled: true });
    expect(c.limits).toEqual({ maxRows: 500, maxBytes: 1048576, maxStatements: 20 });
    expect(c.db.host).toBe('oracle');
    expect(c.db.service).toBe('FREEPDB1');
  });

  it('reads overrides from the environment', () => {
    const c = loadConfig({ DB_POOL_MAX: '2', MONGO_POOL_MAX: '3', DB_HOST: 'x', SQL_TIMEOUT_MS: '5000' });
    expect(c.db.poolMax).toBe(2);
    expect(c.mongo.poolMax).toBe(3);
    expect(c.db.host).toBe('x');
    expect(c.gate.sqlTimeoutMs).toBe(5000);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ LAB_MODE: 'party' })).toThrow(/LAB_MODE/);
  });

  it('requires ADMIN_PASSWORD in event mode', () => {
    expect(() => loadConfig({ LAB_MODE: 'event' })).toThrow(/ADMIN_PASSWORD/);
    const c = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', EVENT_CODE: 'NW26' });
    expect(c.event).toEqual({ code: 'NW26', adminPassword: 'pw' });
  });

  it('rejects non-positive pool sizes', () => {
    expect(() => loadConfig({ DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
