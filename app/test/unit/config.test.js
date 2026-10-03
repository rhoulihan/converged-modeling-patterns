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
    expect(() => loadConfig({ LAB_MODE: 'event', LAB_ADMIN_PASSWORD: 'Own-LabAdmin-1' })).toThrow(/ADMIN_PASSWORD/);
    const c = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', EVENT_CODE: 'NW26', LAB_ADMIN_PASSWORD: 'Own-LabAdmin-1' });
    expect(c.event).toEqual({ code: 'NW26', adminPassword: 'pw' });
  });

  it('refuses to start event mode while LAB_ADMIN_PASSWORD is the repo default', () => {
    expect(() => loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw' })).toThrow(/LAB_ADMIN_PASSWORD.*default/);
    expect(() => loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', LAB_ADMIN_PASSWORD: 'LabAdmin2026' })).toThrow(/LAB_ADMIN_PASSWORD/);
    expect(loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', LAB_ADMIN_PASSWORD: 'Own-LabAdmin-1' }).db.labAdminPassword).toBe('Own-LabAdmin-1');
  });

  it('keeps solo mode default-friendly', () => {
    expect(loadConfig({}).db.labAdminPassword).toBe('LabAdmin2026');
    expect(loadConfig({ LAB_MODE: 'solo' }).mode).toBe('solo');
  });

  it('lets the integration harness opt out of the default-secret check', () => {
    const c = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw' }, { allowDefaultSecrets: true });
    expect(c.db.labAdminPassword).toBe('LabAdmin2026');
  });

  it('rejects database passwords containing a double quote', () => {
    expect(() => loadConfig({ LAB_ADMIN_PASSWORD: 'a"b' })).toThrow(/LAB_ADMIN_PASSWORD must not contain "/);
    expect(() => loadConfig({ ORACLE_PASSWORD: 'a"b' })).toThrow(/ORACLE_PASSWORD/);
    expect(() => loadConfig({ CMP_PASSWORD: 'a"b' })).toThrow(/CMP_PASSWORD/);
  });

  it('rejects non-positive pool sizes', () => {
    expect(() => loadConfig({ DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
  it('gate permits default to the pool size and can be set on their own', () => {
    expect(loadConfig({}).gate.permits).toBe(1);
    expect(loadConfig({ DB_POOL_MAX: '4' }).gate.permits).toBe(4);
    expect(loadConfig({ DB_POOL_MAX: '4', GATE_PERMITS: '2' }).gate.permits).toBe(2);
    expect(() => loadConfig({ GATE_PERMITS: '0' })).toThrow(/GATE_PERMITS/);
  });
});
