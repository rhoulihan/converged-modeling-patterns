import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql, readStats, STAT_NAMES } from '../../src/db/oracle.js';

const cfg = testConfig();
const opts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
let pools; let conn;

beforeAll(async () => {
  await bootstrap(cfg);
  await bootstrap(cfg); // idempotent
  pools = await createPools(cfg);
  conn = await pools.exec.getConnection({ user: cfg.db.cmpUser, password: cfg.db.cmpPassword });
  await executeSql(conn, 'DROP TABLE lab_it_t PURGE', opts);
  await executeSql(conn, 'CREATE TABLE lab_it_t (id NUMBER PRIMARY KEY, v VARCHAR2(20))', opts);
});
afterAll(async () => {
  await executeSql(conn, 'DROP TABLE lab_it_t PURGE', opts);
  await conn?.close();
  await pools?.close();
});

describe('oracle layer', () => {
  it('returns rows with column names', async () => {
    const r = await executeSql(conn, "SELECT 1 AS n, 'a' AS s FROM dual", opts);
    expect(r).toMatchObject({ kind: 'rows', columns: ['N', 'S'], rows: [{ N: 1, S: 'a' }], rowCount: 1, truncated: false });
  });
  it('returns rowsAffected for DML', async () => {
    expect(await executeSql(conn, "INSERT INTO lab_it_t VALUES (1, 'x')", opts)).toMatchObject({ kind: 'dml', rowsAffected: 1 });
  });
  it('returns ok for DDL and PL/SQL', async () => {
    expect(await executeSql(conn, 'BEGIN NULL; END;', opts)).toMatchObject({ kind: 'ok' });
  });
  it('returns Oracle errors with their code instead of throwing', async () => {
    const r = await executeSql(conn, 'SELECT * FROM no_such_table_xyz', opts);
    expect(r).toMatchObject({ kind: 'error', code: 'ORA-00942' });
    expect(r.error).toMatch(/ORA-00942/);
  });
  it('caps rows at maxRows and flags truncation', async () => {
    const r = await executeSql(conn, 'SELECT level AS n FROM dual CONNECT BY level <= 600', opts);
    expect(r.rowCount).toBe(500);
    expect(r.truncated).toBe(true);
  });
  it('caps results at maxBytes and flags truncation', async () => {
    const r = await executeSql(conn, "SELECT RPAD('x', 4000, 'x') AS s FROM dual CONNECT BY level <= 400", opts);
    expect(JSON.stringify(r.rows).length).toBeLessThanOrEqual(1048576);
    expect(r.truncated).toBe(true);
  });
  it('times out a long call', async () => {
    const r = await executeSql(conn, 'BEGIN DBMS_SESSION.SLEEP(5); END;', { ...opts, timeoutMs: 500 });
    expect(r.kind).toBe('error');
  });
  it('reads session statistics that grow with a write', async () => {
    const before = await readStats(conn);
    expect(Object.keys(before).sort()).toEqual([...STAT_NAMES].sort());
    await executeSql(conn, "UPDATE lab_it_t SET v = 'y' WHERE id = 1", { ...opts, autoCommit: false });
    const after = await readStats(conn);
    await conn.rollback();
    expect(after['redo size']).toBeGreaterThan(before['redo size']);
    expect(after['db block changes']).toBeGreaterThan(before['db block changes']);
  });
  it('control pool connects as LAB_ADMIN', async () => {
    const c = await pools.control.getConnection();
    const r = await executeSql(c, 'SELECT USER AS u FROM dual', opts);
    await c.close();
    expect(r.rows[0].U).toBe('LAB_ADMIN');
  });
});
