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

const DOC = 'CREATE TABLE d (a NUMBER);\n-- @step Read\n-- @mongo db.d.find({})\nSELECT a FROM d;\n-- @measure m\nUPDATE d SET a = 1;\n';
const CONV = 'CREATE TABLE c (a NUMBER);\n-- @step Read\n-- @mongo db.aggregate([{ $sql: \'SELECT a FROM c\' }])\nSELECT a FROM c;\n-- @measure m\nUPDATE c SET a = 1;\n';

describe('loadPatterns (fixtures)', () => {
  it('carries each card\'s equivalent in the other language', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV,
      '03-demo.js': '// @step Read\n// @sql SELECT a FROM d\ndb.d.find({})\n' }));
    expect(p.lanes.document[0].mongo).toBe('db.d.find({})');
    expect(p.lanes.converged[0].mongo).toContain('$sql');
    expect(p.lanes.mongo[0].sql).toBe('SELECT a FROM d');
  });
  it('rejects a SQL card without a MongoDB equivalent', () => {
    const doc = DOC.replace('-- @mongo db.d.find({})\n', '');
    expect(() => loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': doc, '02-converged.sql': CONV })))
      .toThrow(/"Read" needs a -- @mongo equivalent/);
  });
  it('rejects a MongoDB equivalent the console cannot parse', () => {
    const doc = DOC.replace('db.d.find({})', 'db.d.explode({})');
    expect(() => loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': doc, '02-converged.sql': CONV })))
      .toThrow(/"Read".*@mongo/);
  });
  it('rejects a MongoDB card without a SQL equivalent', () => {
    expect(() => loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV,
      '03-demo.js': '// @step Read\ndb.d.find({})\n' }))).toThrow(/"Read" needs a \/\/ @sql equivalent/);
  });

  it('builds cards, setup, measure pairs and a version', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.id).toBe('09-demo');
    expect(p.meta.knobs[2]).toEqual({ name: 'Update locality', setting: 'Fans out', hot: true, help: null });
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
  it('every referenced figure, and each pattern\'s model-curve.svg, exists under patterns/<id>/figures/', () => {
    const root = path.resolve(import.meta.dirname, '../../../patterns');
    let checked = 0;
    for (const p of patterns) {
      const cards = [...p.lanes.document, ...p.lanes.converged, ...p.lanes.mongo];
      const files = new Set(['model-curve.svg']);
      for (const c of cards) if (c.help?.figure?.file) files.add(c.help.figure.file);
      for (const t of Object.values(p.meta.help.tabs)) if (t?.figure?.file) files.add(t.figure.file);
      for (const f of files) {
        expect(fs.existsSync(path.join(root, p.id, 'figures', f)), `${p.id}/figures/${f}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(patterns.length); // @figure references were actually found
  });
  it('is deterministic', () => {
    const again = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
    expect(again.map((p) => p.version)).toEqual(patterns.map((p) => p.version));
  });
});

const FM_HELP = `---
title: T
industry: I
deck: "14–17"
problem: P
knobs:
  - { name: Diversity, setting: High, help: "Four consumers read it." }
  - { name: Read / write, setting: Reads }
  - { name: Update locality, setting: Fans out, hot: true }
help:
  tabs:
    document: { why: "The starting point.", look: "One read.", figure: "doc-shape.svg" }
    measure: { why: "Same write, both models." }
measure:
  x_label: "CDR line items in the document"
  lab_x: 1000
  deck_slides: "18–21"
  calibration:
    - { x: 10, ratio: 1.2 }
    - { x: 100, ratio: 5 }
    - { x: 1000, ratio: 33 }
    - { x: 5000, ratio: 260 }
---
# body
`;

describe('help and measure front matter', () => {
  it('parses tab help, knob help and measure calibration', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM_HELP, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.meta.knobs[0].help).toBe('Four consumers read it.');
    expect(p.meta.knobs[1].help).toBeNull();
    expect(p.meta.help.tabs.document).toEqual({ why: 'The starting point.', look: 'One read.', figure: { file: 'doc-shape.svg', caption: null } });
    expect(p.meta.help.tabs.converged).toBeUndefined();
    expect(p.meta.measure).toEqual({ xLabel: 'CDR line items in the document', labX: 1000, deckSlides: '18–21',
      calibration: [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }], verdict: null, sizes: null, workload: null });
  });
  it('parses optional sweep sizes, which need calibrate.sql and must ascend', () => {
    const withSizes = FM_HELP.replace('  lab_x: 1000\n', '  lab_x: 1000\n  sizes: [10, 100, 1000]\n');
    const files = { 'README.md': withSizes, '01-document-model.sql': DOC, '02-converged.sql': CONV };
    expect(() => loadPatterns(fixture(files))).toThrow(/calibrate\.sql/);
    const [p] = loadPatterns(fixture({ ...files, 'calibrate.sql': 'DELETE FROM d WHERE a > :n;\n' }));
    expect(p.meta.measure.sizes).toEqual([10, 100, 1000]);
    expect(p.calibrate).toEqual(['DELETE FROM d WHERE a > :n']);
    const bad = FM_HELP.replace('  lab_x: 1000\n', '  lab_x: 1000\n  sizes: [100, 10, 1000]\n');
    expect(() => loadPatterns(fixture({ 'README.md': bad, '01-document-model.sql': DOC, '02-converged.sql': CONV, 'calibrate.sql': 'SELECT 1 FROM dual;\n' }))).toThrow(/sizes/);
  });
  it('parses an optional measure verdict and rejects an empty one', () => {
    const withVerdict = FM_HELP.replace('  deck_slides: "18–21"\n', '  deck_slides: "18–21"\n  verdict: >-\n    On a normal day the document wins.\n');
    const [p] = loadPatterns(fixture({ 'README.md': withVerdict, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.meta.measure.verdict).toBe('On a normal day the document wins.');
    const empty = FM_HELP.replace('  deck_slides: "18–21"\n', '  deck_slides: "18–21"\n  verdict: ""\n');
    expect(() => loadPatterns(fixture({ 'README.md': empty, '01-document-model.sql': DOC, '02-converged.sql': CONV }))).toThrow(/verdict/);
  });
  it('absent help and measure give empty structures, not errors', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.meta.help).toEqual({ tabs: {} });
    expect(p.meta.measure).toBeNull();
    expect(p.meta.knobs.every((k) => k.help === null)).toBe(true);
  });
  it('rejects a measure block without a non-empty x_label', () => {
    for (const bad of [FM_HELP.replace('  x_label: "CDR line items in the document"\n', ''), FM_HELP.replace('x_label: "CDR line items in the document"', 'x_label: ""')]) {
      expect(() => loadPatterns(fixture({ 'README.md': bad, '01-document-model.sql': DOC, '02-converged.sql': CONV }))).toThrow(/x_label/);
    }
  });
  it('rejects a calibration with fewer than 4 points or lab_x outside the range', () => {
    const bad = FM_HELP.replace('lab_x: 1000', 'lab_x: 99999');
    expect(() => loadPatterns(fixture({ 'README.md': bad, '01-document-model.sql': DOC, '02-converged.sql': CONV }))).toThrow(/lab_x/);
  });
});
