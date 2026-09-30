import { describe, it, expect } from 'vitest';
import { normalizeSql, isReadOnlySql, isReadOnlyMongo, patternsTouched, ResultCache } from '../../src/cache.js';

const ALL = ['01-extended-reference', '02-computed', '03-bucket', '04-subset', '05-tree-hierarchy', '06-outlier'];

describe('eligibility', () => {
  it('normalizes whitespace, comments and trailing semicolons but not case', () => {
    expect(normalizeSql("SELECT  a -- c\n FROM t WHERE x = 'Ab';")).toBe("SELECT a FROM t WHERE x = 'Ab'");
  });
  it('treats single SELECT/WITH as read-only', () => {
    expect(isReadOnlySql(['SELECT 1 FROM dual'])).toBe(true);
    expect(isReadOnlySql(['with q as (select 1 x from dual) select x from q'])).toBe(true);
  });
  it('rejects writes, multiple statements and FOR UPDATE', () => {
    expect(isReadOnlySql(['UPDATE t SET a = 1'])).toBe(false);
    expect(isReadOnlySql(['SELECT 1 FROM dual', 'SELECT 2 FROM dual'])).toBe(false);
    expect(isReadOnlySql(['SELECT * FROM t FOR UPDATE'])).toBe(false);
    expect(isReadOnlySql(['BEGIN NULL; END;'])).toBe(false);
  });
  it('classifies Mongo commands', () => {
    expect(isReadOnlyMongo({ kind: 'showCollections' })).toBe(true);
    expect(isReadOnlyMongo({ kind: 'collection', op: 'find', args: [{}], mods: {} })).toBe(true);
    expect(isReadOnlyMongo({ kind: 'collection', op: 'updateOne', args: [{}, {}], mods: {} })).toBe(false);
    expect(isReadOnlyMongo({ kind: 'collection', op: 'aggregate', args: [[{ $match: {} }, { $out: 'x' }]], mods: {} })).toBe(false);
    expect(isReadOnlyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: 'select 1 from dual' }]], mods: {} })).toBe(true);
    expect(isReadOnlyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: 'delete from t' }]], mods: {} })).toBe(false);
  });
  it('classifies the object form of $sql by its statement; a missing statement is a write', () => {
    const agg = (v) => isReadOnlyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: v }]], mods: {} });
    expect(agg({ statement: 'select 1 from dual' })).toBe(true);
    expect(agg({ statement: 'delete from t' })).toBe(false);
    expect(agg({ statement: 'select 1 from dual for update' })).toBe(false);
    expect(agg({})).toBe(false);
    expect(agg({ statement: 42 })).toBe(false);
    expect(agg(null)).toBe(false);
  });
  it('maps statements to the patterns whose objects they touch', () => {
    expect(patternsTouched('UPDATE xr_advisors SET office = 1', ALL)).toEqual(['01-extended-reference']);
    expect(patternsTouched('insert into bk_readings select * from sb_claim_events', ALL).sort()).toEqual(['03-bucket', '04-subset']);
    expect(patternsTouched('create table scratch (a number)', ALL)).toEqual(ALL);
  });
});

describe('ResultCache', () => {
  it('keys on pattern, trimmed raw text and dataset version', () => {
    const c = new ResultCache();
    expect(c.key('p', '  SELECT 1 FROM dual \n', 'v1')).toBe(c.key('p', 'SELECT 1 FROM dual', 'v1'));
    expect(c.key('p', 'SELECT 1  FROM dual', 'v1')).not.toBe(c.key('p', 'SELECT 1 FROM dual', 'v1'));
    expect(c.key('p', 'SELECT 1 FROM dual;', 'v1')).not.toBe(c.key('p', 'SELECT 1 FROM dual', 'v1'));
    expect(c.key('p', '--x', 'v1')).not.toBe(c.key('p', '--y', 'v1'));
    expect(c.key('p', 'SELECT 1 FROM dual', 'v1')).not.toBe(c.key('p', 'SELECT 1 FROM dual', 'v2'));
    expect(c.key('p', 'SELECT 1 FROM dual', 'v1')).not.toBe(c.key('q', 'SELECT 1 FROM dual', 'v1'));
  });
  it('evicts the least recently used entry', () => {
    const c = new ResultCache({ maxEntries: 2 });
    c.set('a', 1); c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(2);
  });
  it('returns nothing while disabled', () => {
    const c = new ResultCache();
    c.set('a', 1);
    c.enabled = false;
    expect(c.get('a')).toBeUndefined();
  });
});
