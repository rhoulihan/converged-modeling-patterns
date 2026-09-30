// Runner cache eligibility (I1), against a stub connection — no database needed.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Runner } from '../../src/services/runner.js';

const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
const p = patterns.find((x) => x.id === '01-extended-reference');
const readCard = p.lanes.converged.find((s) => /^\s*(SELECT|WITH)\b/i.test(s.sql));
const user = { id: 'solo', workspace: { schema: 'CMP_USER', password: 'x' } };
let runner; let executed; let cache;

beforeEach(() => {
  executed = [];
  const conn = {
    execute: async (sql) => { executed.push(sql); return { metaData: [{ name: 'X' }], rows: [{ X: 1 }] }; },
    close: async () => {},
    break: async () => {},
  };
  const workspaces = {
    builtVersion: (s, id) => patterns.find((x) => x.id === id).version,
    isDirty: () => false,
    markDirty: async () => {},
  };
  const cfg = loadConfig({});
  cache = new ResultCache();
  runner = new Runner({ cfg, gate: new Gate(cfg.gate), cache, pools: { exec: { getConnection: async () => conn } }, mongo: {}, workspaces, patterns });
});

const run = (text) => runner.runSql({ user, patternId: p.id, text });

describe('result cache eligibility', () => {
  it('never caches ad hoc console text', async () => {
    expect((await run('SELECT USER FROM dual')).cached).toBe(false);
    expect((await run('SELECT USER FROM dual')).cached).toBe(false);
    expect(executed).toHaveLength(2);
    expect(cache.size).toBe(0);
  });

  it('does not cache comment-only text', async () => {
    expect((await run('--x')).cached).toBe(false);
    expect((await run('--y')).cached).toBe(false);
    expect(cache.size).toBe(0);
  });

  it('caches a card SELECT run exactly as shown', async () => {
    expect((await run(readCard.sql)).cached).toBe(false);
    expect((await run(readCard.sql)).cached).toBe(true);
    expect(executed).toHaveLength(1);
  });

  it('still hits after a leading/trailing whitespace edit, but not after any other edit', async () => {
    await run(readCard.sql);
    expect((await run(`  ${readCard.sql} \n`)).cached).toBe(true);
    expect((await run(`${readCard.sql} -- mine`)).cached).toBe(false);
    expect((await run(readCard.sql.replace(/ /, '  '))).cached).toBe(false);
  });
});
