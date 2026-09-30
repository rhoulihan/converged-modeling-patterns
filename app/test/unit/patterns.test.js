import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPatterns } from '../../src/content/patterns.js';

const FM = `---
title: T
industry: I
deck: "14–17"
problem: P
knobs:
  - { name: Diversity, setting: High }
  - { name: Read / write, setting: Reads }
  - { name: Update locality, setting: Fans out, hot: true }
---
# body
`;

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pat-'));
  const dir = path.join(root, '09-demo');
  fs.mkdirSync(dir);
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
  return root;
}

const DOC = 'CREATE TABLE d (a NUMBER);\n-- @step Read\nSELECT a FROM d;\n-- @measure m\nUPDATE d SET a = 1;\n';
const CONV = 'CREATE TABLE c (a NUMBER);\n-- @step Read\nSELECT a FROM c;\n-- @measure m\nUPDATE c SET a = 1;\n';

describe('loadPatterns (fixtures)', () => {
  it('builds cards, setup, measure pairs and a version', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.id).toBe('09-demo');
    expect(p.meta.knobs[2]).toEqual({ name: 'Update locality', setting: 'Fans out', hot: true });
    expect(p.lanes.document.map((s) => s.title)).toEqual(['Read']);
    expect(p.setup.converged.map((s) => s.sql)).toEqual(['CREATE TABLE c (a NUMBER)']);
    expect(p.measures).toHaveLength(1);
    expect(p.measures[0].document.sql).toBe('UPDATE d SET a = 1');
    expect(p.version).toMatch(/^[0-9a-f]{16}$/);
    expect(p.lanes.mongo).toEqual([]);
  });
  it('rejects a missing front matter block', () => {
    expect(() => loadPatterns(fixture({ 'README.md': '# no fm', '01-document-model.sql': DOC, '02-converged.sql': CONV }))).toThrow(/front matter/);
  });
  it('rejects a one-sided measure tag', () => {
    expect(() => loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV.replace('@measure m', '@step Upd') }))).toThrow(/measure "m"/);
  });
  it('rejects a measure statement that commits', () => {
    const bad = DOC.replace('UPDATE d SET a = 1;', 'BEGIN UPDATE d SET a = 1; COMMIT; END;\n/');
    expect(() => loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': bad, '02-converged.sql': CONV }))).toThrow(/COMMIT/);
  });
});

describe('loadPatterns (the real lab)', () => {
  const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
  it('loads all six patterns with metadata', () => {
    expect(patterns.map((p) => p.id)).toEqual(['01-extended-reference', '02-computed', '03-bucket', '04-subset', '05-tree-hierarchy', '06-outlier']);
    for (const p of patterns) {
      expect(p.meta.title && p.meta.industry && p.meta.problem && p.meta.deck, p.id).toBeTruthy();
      expect(p.meta.knobs.map((k) => k.hot), p.id).toEqual([false, false, true]);
      expect(p.lanes.document.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.lanes.converged.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.measures.length, p.id).toBeGreaterThanOrEqual(1);
    }
  });
  it('has MongoDB cards where the pattern has a Mongo lane', () => {
    const byId = Object.fromEntries(patterns.map((p) => [p.id, p]));
    for (const id of ['01-extended-reference', '02-computed', '03-bucket', '06-outlier']) expect(byId[id].lanes.mongo.length, id).toBeGreaterThanOrEqual(1);
  });
  it('is deterministic', () => {
    const again = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
    expect(again.map((p) => p.version)).toEqual(patterns.map((p) => p.version));
  });
});
