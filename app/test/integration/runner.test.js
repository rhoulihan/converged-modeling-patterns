// app/test/integration/runner.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { testConfig } from './env.js';
import { bootstrap, createPools } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';

const cfg = testConfig();
const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo; let workspaces; let runner; let user;

async function makeRunner() {
  workspaces = new Workspaces({ cfg, pools });
  await workspaces.load();
  return new Runner({ cfg, gate: new Gate(cfg.gate), cache: new ResultCache(cfg.cache), pools, mongo, workspaces, patterns });
}

beforeAll(async () => {
  await bootstrap(cfg);
  pools = await createPools(cfg);
  mongo = new MongoPool(cfg);
  runner = await makeRunner();
  user = { id: 'solo', workspace: workspaces.solo() };
}, 300000);
afterAll(async () => { await mongo?.closeAll(); await pools?.close(); });

describe.each(patterns.map((p) => [p.id, p]))('%s', (id, p) => {
  it('resets cleanly and every step runs in order', async () => {
    const r = await runner.reset({ user, patternId: id });
    expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    for (const lane of ['document', 'converged']) {
      for (const st of p.lanes[lane]) {
        const out = await runner.runSql({ user, patternId: id, text: st.sql });
        const errs = out.results.filter((x) => x.kind === 'error');
        expect(errs, `${lane} step "${st.title}" (line ${st.line})`).toEqual([]);
      }
    }
  }, 120000);

  it('runs every MongoDB card after a reset', async () => {
    await runner.reset({ user, patternId: id });
    for (const card of p.lanes.mongo) {
      const out = await runner.runMongoText({ user, patternId: id, text: card.command });
      expect(out.results[0].kind, card.title).not.toBe('error');
      if (out.results[0].kind === 'docs') expect(out.results[0].docs.length, card.title).toBeGreaterThan(0);
    }
  }, 120000);

  it('measure-it: the document model writes more than the converged model', async () => {
    await runner.reset({ user, patternId: id });
    for (const m of p.measures) {
      const r = await runner.measure({ user, patternId: id, tag: m.tag });
      expect(r.document.result.kind, m.tag).not.toBe('error');
      expect(r.converged.result.kind, m.tag).not.toBe('error');
      // Directional claim of the lecture. If this fails, STOP and report both stat sets —
      // do not relax the assertion (see the plan's note on OSON partial updates).
      expect(r.document.stats['redo size'], `${m.tag} redo`).toBeGreaterThan(r.converged.stats['redo size']);
      expect(r.document.stats['db block changes'], `${m.tag} blocks`).toBeGreaterThan(r.converged.stats['db block changes']);
    }
  }, 120000);

  it('measure-it: write stats are non-zero and stable across repeated runs', async () => {
    await runner.reset({ user, patternId: id });
    for (const m of p.measures) {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await runner.measure({ user, patternId: id, tag: m.tag }));
      for (const side of ['document', 'converged']) {
        const pick = (r) => ({ redo: r[side].stats['redo size'], blocks: r[side].stats['db block changes'] });
        for (const r of runs) {
          // 'ok' = a PL/SQL block (03-bucket's document side), which always writes.
          expect(['dml', 'ok'], `${m.tag} ${side}`).toContain(r[side].result.kind);
          if (r[side].result.kind === 'ok' || r[side].result.rowsAffected > 0) {
            expect(r[side].stats['redo size'], `${m.tag} ${side} redo`).toBeGreaterThan(0);
            expect(r[side].stats['db block changes'], `${m.tag} ${side} blocks`).toBeGreaterThan(0);
          }
        }
        // Single-row INSERTs flip by +76 redo / +1 block run to run (space management
        // rolled back and redone), and a whole-document LOB rewrite occasionally steps
        // up when the LOB segment grows (seen: 21568/29 vs 20196/15). So stability is
        // modal agreement: at least 2 of the 3 runs agree within 100 redo and 1 block.
        const agree = (a, b) => Math.abs(a.redo - b.redo) <= 100 && Math.abs(a.blocks - b.blocks) <= 1;
        const picks = runs.map(pick);
        const modal = picks.some((a, i) => picks.some((b, j) => i !== j && agree(a, b)));
        expect(modal, `${m.tag} ${side}: no 2 of 3 runs agree ${JSON.stringify(picks)}`).toBe(true);
      }
      // The lecture's direction holds on every run, not just on average.
      for (const r of runs) {
        expect(r.document.stats['redo size'], `${m.tag} run redo`).toBeGreaterThan(r.converged.stats['redo size']);
        expect(r.document.stats['db block changes'], `${m.tag} run blocks`).toBeGreaterThan(r.converged.stats['db block changes']);
      }
    }
  }, 180000);
});

describe('cache and dirty flags', () => {
  const id = '01-extended-reference';
  const readCard = () => patterns.find((p) => p.id === id).lanes.converged.find((s) => /^\s*(SELECT|WITH)\b/i.test(s.sql));

  it('serves a repeated read from cache and stops after a write', async () => {
    await runner.reset({ user, patternId: id });
    const text = readCard().sql;
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(false);
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(true);
    await runner.runSql({ user, patternId: id, text: "UPDATE xr_advisors SET office = 'LAB-TEST' WHERE ROWNUM = 1" });
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(false);
  });

  it('keeps a dirty workspace uncached after an app restart', async () => {
    runner = await makeRunner(); // fresh cache, dirty flags reloaded from the database
    const text = readCard().sql;
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(false);
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(false);
    await runner.reset({ user, patternId: id });
    await runner.runSql({ user, patternId: id, text });
    expect((await runner.runSql({ user, patternId: id, text })).cached).toBe(true);
  });
});

describe('results', () => {
  it('returns Oracle errors as results', async () => {
    const out = await runner.runSql({ user, patternId: null, text: 'SELECT * FROM no_such_table_xyz' });
    expect(out.results[0]).toMatchObject({ kind: 'error', code: 'ORA-00942' });
  });
  it('truncates results over 1 MB', async () => {
    const out = await runner.runSql({ user, patternId: null, text: "SELECT RPAD('x', 4000, 'x') AS s FROM dual CONNECT BY level <= 400" });
    expect(out.results[0].truncated).toBe(true);
  });
  it('blocks guarded statements without executing them', async () => {
    const out = await runner.runSql({ user, patternId: null, text: 'GRANT DBA TO cmp_user' });
    expect(out.results[0]).toMatchObject({ kind: 'error', code: 'LAB-GUARD' });
  });
  it('returns Mongo parse errors as results', async () => {
    const out = await runner.runMongoText({ user, patternId: null, text: 'db.x.drop()' });
    expect(out.results[0]).toMatchObject({ kind: 'error', code: 'LAB-PARSE' });
  });
  it('runs several statements in one request', async () => {
    const out = await runner.runSql({ user, patternId: null, text: 'SELECT 1 FROM dual;\nSELECT 2 FROM dual;' });
    expect(out.results).toHaveLength(2);
  });
});

describe('mongo timeout (addendum A)', () => {
  // The addendum's `connect by level <= 20000000` fails fast here with ORA-30009 (CONNECT BY memory),
  // so use a deterministic ~5 s cross join of three small CONNECT BY row sources instead.
  const SLOW = 'db.aggregate([{ $sql: "select count(*) as n from (select level l from dual connect by level <= 5000) a, '
    + '(select level l from dual connect by level <= 5000) b, (select level l from dual connect by level <= 10) c" }])';

  it('stops a slow MongoDB op at the timeout, holds the queue until the session is idle, and serves the next request', async () => {
    const slowCfg = testConfig({ MONGO_TIMEOUT_MS: '1000' });
    const slowRunner = new Runner({
      cfg: slowCfg, gate: new Gate(slowCfg.gate), cache: new ResultCache(slowCfg.cache), pools, mongo, workspaces, patterns,
    });
    const schema = user.workspace.schema.toUpperCase();
    // Each sample: the executing statements of ACTIVE CMP_USER sessions, as "sid:sql_id:sql_exec_id".
    const activeOps = async () => {
      const c = await pools.control.getConnection();
      try {
        const r = await c.execute(
          "SELECT sid, sql_id, sql_exec_id FROM v$session WHERE username = :s AND status = 'ACTIVE' AND sql_id IS NOT NULL",
          { s: schema },
        );
        return r.rows.map(([sid, sqlId, execId]) => `${sid}:${sqlId}:${execId}`);
      } finally {
        await c.close();
      }
    };
    const samples = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        samples.push(await activeOps());
        await new Promise((res) => { setTimeout(res, 100); });
      }
    })();
    const started = Date.now();
    const out = await slowRunner.runMongoText({ user, patternId: null, text: SLOW });
    const elapsed = Date.now() - started;
    const atReturn = await activeOps();
    sampling = false;
    await sampler;

    expect(out.results[0], JSON.stringify(out.results[0])).toMatchObject({ kind: 'error', code: 'LAB-TIMEOUT' });
    expect(out.results[0].error).toBe('MongoDB operation exceeded 1 s and was stopped');
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    // An attendee operation persists across samples. When the client is dropped, ORDS briefly runs its
    // own housekeeping on a second pooled session (seen for a single sample, under the same username);
    // that is not an attendee operation, so only operations seen in >= 2 samples are counted.
    const seen = new Map();
    samples.flat().forEach((op) => seen.set(op, (seen.get(op) ?? 0) + 1));
    const ops = [...seen].filter(([, n]) => n >= 2).map(([op]) => op);
    expect(ops.length, JSON.stringify(samples)).toBeGreaterThanOrEqual(1); // the sampler did see the slow op
    const maxConcurrent = Math.max(...samples.map((s) => s.filter((op) => ops.includes(op)).length));
    expect(maxConcurrent, JSON.stringify(samples)).toBeLessThanOrEqual(1);
    // The permit was held until the database stopped executing the timed-out op.
    expect(atReturn.filter((op) => ops.includes(op))).toEqual([]);
    const next = await slowRunner.runSql({ user, patternId: null, text: 'SELECT 1 FROM dual' });
    expect(next.results[0].kind).toBe('rows');
  }, 120000);
});
