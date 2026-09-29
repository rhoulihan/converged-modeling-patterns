import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSqlFile, isSetup, splitConsoleSql } from '../../src/content/sqlParser.js';

describe('parseSqlFile', () => {
  it('attaches @step/@note/@measure to the next statement and keeps setup untagged', () => {
    const s = parseSqlFile([
      '-- plain comment',
      'DROP TABLE t PURGE;',
      '-- @step Read it',
      '-- @note first note',
      '-- @note second',
      'SELECT a',
      'FROM t;',
      '-- @measure move',
      'UPDATE t SET a = 1;',
    ].join('\n'));
    expect(s.map((x) => x.sql)).toEqual(['DROP TABLE t PURGE', 'SELECT a\nFROM t', 'UPDATE t SET a = 1']);
    expect(s[1]).toMatchObject({ title: 'Read it', notes: ['first note', 'second'], measure: null, line: 6 });
    expect(s[2]).toMatchObject({ title: null, measure: 'move' });
    expect(s.map(isSetup)).toEqual([true, false, false]);
  });

  it('treats a BEGIN block ended by "/" as one PL/SQL statement', () => {
    const s = parseSqlFile('BEGIN\n  FOR r IN (SELECT 1 x FROM dual) LOOP\n    NULL;\n  END LOOP;\nEND;\n/\nSELECT 1 FROM dual;');
    expect(s).toHaveLength(2);
    expect(s[0].plsql).toBe(true);
    expect(s[0].sql.endsWith('END;')).toBe(true);
    expect(s[1].sql).toBe('SELECT 1 FROM dual');
  });

  it('treats CREATE OR REPLACE TRIGGER as PL/SQL', () => {
    const s = parseSqlFile('CREATE OR REPLACE TRIGGER trg AFTER INSERT ON t FOR EACH ROW\nBEGIN\n  UPDATE s SET n = n + 1;\nEND;\n/');
    expect(s).toHaveLength(1);
    expect(s[0].plsql).toBe(true);
  });

  it('does not split or strip inside string literals (JSON seed data)', () => {
    const s = parseSqlFile(`INSERT INTO t VALUES ('{"a":"x;y","b":"--z","c":"it''s"}');\nSELECT 1 FROM dual;`);
    expect(s).toHaveLength(2);
    expect(s[0].sql).toContain('x;y');
    expect(s[0].sql).toContain('--z');
    expect(s[0].sql).toContain("it''s");
  });

  it('drops sqlplus directives only at statement start', () => {
    const s = parseSqlFile('SET HEADING OFF PAGESIZE 0\nSELECT 1 FROM dual;\nUPDATE t\nSET data = JSON_TRANSFORM(data, SET \'$.a\' = 1)\nWHERE id = 1;');
    expect(s.map((x) => x.sql)).toEqual(['SELECT 1 FROM dual', "UPDATE t\nSET data = JSON_TRANSFORM(data, SET '$.a' = 1)\nWHERE id = 1"]);
  });

  it('ignores a trailing comment after the semicolon', () => {
    expect(parseSqlFile('SELECT 1 FROM dual;  -- one')[0].sql).toBe('SELECT 1 FROM dual');
  });

  it('parses every pattern SQL file into clean statements', () => {
    const root = path.resolve(import.meta.dirname, '../../../patterns');
    for (const dir of fs.readdirSync(root)) {
      for (const f of ['01-document-model.sql', '02-converged.sql']) {
        const p = path.join(root, dir, f);
        if (!fs.existsSync(p)) continue;
        const stmts = parseSqlFile(fs.readFileSync(p, 'utf8'));
        expect(stmts.length, p).toBeGreaterThan(0);
        for (const st of stmts) {
          expect(st.sql.trim(), p).not.toBe('');
          expect(st.sql, p).not.toMatch(/\n\/\s*$/);
          expect(st.sql, p).not.toMatch(/^(SET|PROMPT|WHENEVER)\s/);
        }
      }
    }
  });
});

describe('splitConsoleSql', () => {
  it('accepts a trailing semicolon or sqlplus slash', () => {
    expect(splitConsoleSql('SELECT 1 FROM dual;')).toEqual(['SELECT 1 FROM dual']);
    expect(splitConsoleSql('SELECT 1 FROM dual\n/')).toEqual(['SELECT 1 FROM dual']);
  });
  it('splits several statements', () => {
    expect(splitConsoleSql('SELECT 1 FROM dual;\nSELECT 2 FROM dual;')).toHaveLength(2);
  });
  it('keeps a PL/SQL block without a closing slash intact', () => {
    expect(splitConsoleSql('BEGIN NULL; END;')).toEqual(['BEGIN NULL; END;']);
  });
  it('returns [] for blank input', () => {
    expect(splitConsoleSql('  \n -- only a comment\n')).toEqual([]);
  });
});
