import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMongoScript } from '../../src/content/mongoScript.js';

describe('parseMongoScript', () => {
  it('binds @step/@note to the next top-level db.* statement', () => {
    const steps = parseMongoScript([
      'function canon(x) { return x; }',
      '// @step Read the projected document',
      '// @note Same view, over the MongoDB API',
      'const d = db.xr_client_dv.findOne({_id: "C-001"});',
      'print(d);',
      '// @step Hourly rollup with $sql',
      'const rows = db.aggregate([{ $sql: `select 1 from dual` }]).toArray();',
      'for (const r of rows) {',
      '  // @step ignored inside a block',
      '  print(r);',
      '}',
    ].join('\n'));
    expect(steps).toEqual([
      { title: 'Read the projected document', notes: ['Same view, over the MongoDB API'], command: 'db.xr_client_dv.findOne({_id: "C-001"})', line: 4 },
      { title: 'Hourly rollup with $sql', notes: [], command: 'db.aggregate([{ $sql: `select 1 from dual` }])', line: 7 },
    ]);
  });
  it('rejects @step on a statement that is not a db command', () => {
    expect(() => parseMongoScript('// @step bad\nfor (const x of []) {}', 'f.js')).toThrow(/f\.js:2/);
  });
  it('rejects @step on an alias call (must be db.*)', () => {
    expect(() => parseMongoScript('const C = db.x;\n// @step bad\nC.findOne({});')).toThrow();
  });
  it('parses every pattern .js file', () => {
    const root = path.resolve(import.meta.dirname, '../../../patterns');
    for (const dir of fs.readdirSync(root)) {
      for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith('.js'))) {
        const p = path.join(root, dir, f);
        expect(() => parseMongoScript(fs.readFileSync(p, 'utf8'), p)).not.toThrow();
      }
    }
  });
});
