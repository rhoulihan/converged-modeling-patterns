import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifySql, classifyMongo } from '../../src/guard.js';
import { parseSqlFile } from '../../src/content/sqlParser.js';

describe('classifySql', () => {
  it.each([
    'SELECT * FROM xr_client_dv',
    "INSERT INTO t VALUES ('{\"a\":1}')",
    'BEGIN NULL; END;',
    'CREATE OR REPLACE TRIGGER trg AFTER INSERT ON t FOR EACH ROW BEGIN NULL; END;',
    "CREATE OR REPLACE JSON RELATIONAL DUALITY VIEW v AS SELECT JSON {'_id': t.id} FROM t",
    'SELECT table_name FROM user_tables',
  ])('allows %s', (sql) => expect(classifySql(sql)).toEqual({ allowed: true }));

  it.each([
    ['alter system flush shared_pool', /ALTER SYSTEM/],
    ['ALTER DATABASE OPEN', /ALTER DATABASE/],
    ['drop user ws_abc cascade', /USER/],
    ['CREATE /* x */ USER bob IDENTIFIED BY p', /USER/],
    ["BEGIN EXECUTE IMMEDIATE 'GRANT DBA TO WS_1'; END;", /GRANT/],
    ['REVOKE SELECT ON t FROM x', /REVOKE/],
    ['create database link l connect to a identified by b using \'x\'', /DATABASE LINK/],
    ["BEGIN dbms_scheduler.create_job('j'); END;", /DBMS_SCHEDULER/],
    ["BEGIN DBMS_JOB.SUBMIT(:j, 'x'); END;", /DBMS_JOB/],
    ["SELECT utl_http.request('http://x') FROM dual", /UTL_/],
    ["BEGIN DBMS_PIPE.PURGE('p'); END;", /DBMS_PIPE/],
    ["CREATE DIRECTORY d AS '/tmp'", /DIRECTORY/],
    ['', /empty/i],
  ])('blocks %s', (sql, reason) => {
    const r = classifySql(sql);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it('allows every statement in the pattern files', () => {
    const root = path.resolve(import.meta.dirname, '../../../patterns');
    for (const dir of fs.readdirSync(root)) {
      for (const f of ['01-document-model.sql', '02-converged.sql']) {
        const p = path.join(root, dir, f);
        if (!fs.existsSync(p)) continue;
        for (const st of parseSqlFile(fs.readFileSync(p, 'utf8'))) expect(classifySql(st.sql), `${p}:${st.line}`).toEqual({ allowed: true });
      }
    }
  });
});

describe('classifyMongo', () => {
  it('checks $sql stages with the SQL rules', () => {
    expect(classifyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: 'select 1 from dual' }]], mods: {} })).toEqual({ allowed: true });
    const r = classifyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: "begin execute immediate 'grant dba to x'; end;" }]], mods: {} });
    expect(r.allowed).toBe(false);
  });
  it('allows ordinary collection commands', () => {
    expect(classifyMongo({ kind: 'collection', collection: 'c', op: 'find', args: [{}], mods: {} })).toEqual({ allowed: true });
  });
});
