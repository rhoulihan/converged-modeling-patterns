// app/src/services/runner.js
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { splitConsoleSql } from '../content/sqlParser.js';
import { parseMongoCommand, MongoParseError } from '../content/mongoCommand.js';
import { classifySql, classifyMongo } from '../guard.js';
import { isReadOnlySql, isReadOnlyMongo, patternsTouched } from '../cache.js';
import { executeSql, readStats } from '../db/oracle.js';
import { runMongo } from '../db/mongo.js';

const isTimeout = (r) => r.kind === 'error' && /DPI-1067|NJS-123|call timeout|timed out/i.test(r.error);
const IDLE_POLL_MS = 250;
const IDLE_CEILING_MS = 60000;
const labErr = (code, error) => ({ kind: 'error', code, error, elapsedMs: 0 });
// Reset/build (system operations) get one 120 s budget for all their statements.
const SYSTEM_BUDGET_MS = 120000;

export class Runner {
  #cfg; #gate; #cache; #pools; #mongo; #ws; #patterns; #ids; #cards;

  constructor({ cfg, gate, cache, pools, mongo, workspaces, patterns }) {
    this.#cfg = cfg;
    this.#gate = gate;
    this.#cache = cache;
    this.#pools = pools;
    this.#mongo = mongo;
    this.#ws = workspaces;
    this.#patterns = new Map(patterns.map((p) => [p.id, p]));
    this.#ids = patterns.map((p) => p.id);
    // Cache eligibility: only a pattern's own card text (trimmed) is ever cached.
    this.#cards = new Map(patterns.map((p) => [p.id, {
      sql: new Set([...p.lanes.document, ...p.lanes.converged].map((s) => s.sql.trim())),
      mongo: new Set(p.lanes.mongo.map((c) => c.command.trim())),
    }]));
    this.timeouts = { sqlMs: cfg.gate.sqlTimeoutMs, mongoMs: cfg.gate.mongoTimeoutMs };
  }

  // Runs `stmts` in order on one connection under ONE deadline of `budgetMs`: each
  // statement's callTimeout is the time remaining. Before each statement, a cancelled run
  // (ctx.cancelled, set by Gate.cancel) yields LAB-CANCELLED for it and every later one; an
  // exhausted budget, or a statement stopped by its callTimeout, yields LAB-TIMEOUT likewise.
  async #runStatements(conn, ctx, track, stmts, budgetMs) {
    const deadline = performance.now() + budgetMs;
    const secs = budgetMs / 1000;
    const out = [];
    let stop = null;
    for (const sql of stmts) {
      if (!stop && ctx.cancelled) stop = labErr('LAB-CANCELLED', 'Run was cancelled; this statement did not run');
      const left = Math.floor(deadline - performance.now());
      if (!stop && left <= 0) stop = labErr('LAB-TIMEOUT', `Run exceeded ${secs} s; this statement did not run`);
      if (stop) { out.push(stop); continue; }
      const r = track(await executeSql(conn, sql, { ...this.#limits(), timeoutMs: left }));
      if (isTimeout(r)) {
        out.push({ kind: 'error', code: 'LAB-TIMEOUT', error: `Run exceeded ${secs} s and was stopped`, elapsedMs: r.elapsedMs });
        stop = labErr('LAB-TIMEOUT', `Run exceeded ${secs} s; this statement did not run`);
        continue;
      }
      out.push(r);
    }
    return out;
  }

  #limits(autoCommit = true) {
    const { maxRows, maxBytes } = this.#cfg.limits;
    return { timeoutMs: this.timeouts.sqlMs, maxRows, maxBytes, autoCommit };
  }

  // A run is cacheable only when its text is exactly one of the pattern's cards (after
  // trimming leading/trailing whitespace), it is read-only, and the workspace is pristine.
  #cacheKey(p, lane, text, readOnly, ws) {
    if (!p || !readOnly || !this.#cards.get(p.id)[lane].has(text.trim())) return null;
    if (this.#ws.isDirty(ws.schema, p.id)) return null;
    return this.#cache.key(p.id, text, p.version);
  }

  #pattern(patternId) {
    const p = patternId ? this.#patterns.get(patternId) : null;
    if (patternId && !p) throw new Error(`unknown pattern ${patternId}`);
    return p;
  }

  async #withConn(ws, ctx, fn) {
    const conn = await this.#pools.exec.getConnection({ user: ws.schema, password: ws.password });
    ctx.cancel = () => { conn.break().catch(() => {}); };
    let drop = false;
    try {
      const out = await fn(conn, (r) => { if (isTimeout(r)) drop = true; return r; });
      return out;
    } finally {
      await conn.close({ drop }).catch(() => {});
    }
  }

  async ensureBuilt(user, patternId) {
    const p = this.#pattern(patternId);
    if (!p) return;
    if (this.#ws.builtVersion(user.workspace.schema, patternId) === p.version) return;
    const r = await this.reset({ user, patternId });
    if (!r.ok) throw new Error(`could not build ${patternId}: ${r.errors[0]?.error}`);
  }

  async reset({ user, patternId }) {
    const p = this.#pattern(patternId);
    const ws = user.workspace;
    const errors = await this.#gate.run({ userId: user.id, label: `${patternId} · reset`, exclusive: true }, (ctx) =>
      this.#withConn(ws, ctx, async (conn, track) => {
        const stmts = [...p.setup.document, ...p.setup.converged].map((st) => st.sql);
        const results = await this.#runStatements(conn, ctx, track, stmts, SYSTEM_BUDGET_MS);
        return results.flatMap((r, i) => (r.kind === 'error' ? [{ sql: stmts[i], error: r.error, code: r.code }] : []));
      }));
    if (!errors.length) {
      await this.#ws.markBuilt(ws.schema, patternId, p.version);
      await this.#ws.clearDirty(ws.schema, patternId);
    }
    return { ok: errors.length === 0, errors };
  }

  async runSql({ user, patternId, text }) {
    const stmts = splitConsoleSql(text);
    if (!stmts.length) return { lane: 'sql', results: [labErr('LAB-PARSE', 'Nothing to run')], cached: false };
    if (stmts.length > this.#cfg.limits.maxStatements) {
      return { lane: 'sql', results: [labErr('LAB-PARSE', `At most ${this.#cfg.limits.maxStatements} statements per run`)], cached: false };
    }
    for (const s of stmts) {
      const g = classifySql(s);
      if (!g.allowed) return { lane: 'sql', results: [labErr('LAB-GUARD', g.reason)], cached: false };
    }
    const p = this.#pattern(patternId);
    if (p) await this.ensureBuilt(user, patternId);
    const ws = user.workspace;
    const readOnly = isReadOnlySql(stmts);
    const key = this.#cacheKey(p, 'sql', text, readOnly, ws);
    const hit = key ? this.#cache.get(key) : undefined;
    if (hit) return { lane: 'sql', results: hit, cached: true };

    const results = await this.#gate.run({ userId: user.id, label: `${patternId ?? 'console'} · SQL` }, (ctx) =>
      this.#withConn(ws, ctx, (conn, track) => this.#runStatements(conn, ctx, track, stmts, this.timeouts.sqlMs)));
    if (!readOnly) await this.#ws.markDirty(ws.schema, patternsTouched(text, this.#ids));
    if (key && results.every((r) => r.kind !== 'error')) this.#cache.set(key, results);
    return { lane: 'sql', results, cached: false };
  }

  async runMongoText({ user, patternId, text }) {
    let cmd;
    try {
      cmd = parseMongoCommand(text);
    } catch (e) {
      if (e instanceof MongoParseError) return { lane: 'mongo', results: [labErr('LAB-PARSE', e.message)], cached: false };
      throw e;
    }
    const g = classifyMongo(cmd);
    if (!g.allowed) return { lane: 'mongo', results: [labErr('LAB-GUARD', g.reason)], cached: false };
    const p = this.#pattern(patternId);
    if (p) await this.ensureBuilt(user, patternId);
    const ws = user.workspace;
    const readOnly = isReadOnlyMongo(cmd);
    const key = this.#cacheKey(p, 'mongo', text, readOnly, ws);
    const hit = key ? this.#cache.get(key) : undefined;
    if (hit) return { lane: 'mongo', results: hit, cached: true };

    const { maxRows, maxBytes } = this.#cfg.limits;
    const result = await this.#gate.run({ userId: user.id, label: `${patternId ?? 'console'} · MongoDB` }, async (ctx) => {
      // The Oracle API for MongoDB ignores maxTimeMS, so the runner enforces the timeout itself.
      let stop;
      const stopped = new Promise((resolve) => { stop = resolve; });
      ctx.cancel = () => stop('cancel');
      const timeoutMs = this.timeouts.mongoMs;
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      const start = performance.now();
      try {
        const client = this.#mongo.client(ws.schema, ws.password);
        const op = runMongo(client, ws.schema.toUpperCase(), cmd, { timeoutMs, maxRows, maxBytes });
        const won = await Promise.race([op.then((r) => ({ r })), stopped.then((why) => ({ why }))]);
        if (won.r) return won.r;
        await this.#mongo.drop(ws.schema);
        await this.#waitIdle(ws.schema);
        const elapsedMs = Math.round(performance.now() - start);
        return won.why === 'timeout'
          ? { kind: 'error', code: 'LAB-TIMEOUT', error: `MongoDB operation exceeded ${timeoutMs / 1000} s and was stopped`, elapsedMs }
          : { kind: 'error', code: 'LAB-CANCELLED', error: 'MongoDB operation was cancelled', elapsedMs };
      } finally {
        clearTimeout(timer);
      }
    });
    if (!readOnly) await this.#ws.markDirty(ws.schema, patternsTouched(`${cmd.collection ?? ''} ${text}`, this.#ids));
    if (key && result.kind !== 'error') this.#cache.set(key, [result]);
    return { lane: 'mongo', results: [result], cached: false };
  }

  // Hold the gate permit until the database shows no ACTIVE session for the schema (60 s ceiling).
  async #waitIdle(schema) {
    const s = schema.toUpperCase();
    const deadline = Date.now() + IDLE_CEILING_MS;
    while (Date.now() < deadline) {
      const c = await this.#pools.control.getConnection();
      let active;
      try {
        const r = await c.execute("SELECT COUNT(*) FROM v$session WHERE username = :s AND status = 'ACTIVE'", { s });
        active = Number(r.rows[0][0]);
      } finally {
        await c.close();
      }
      if (active === 0) return;
      await sleep(IDLE_POLL_MS);
    }
    console.warn(`[lab-ui] mongo op for ${s} still active after 60 s — releasing the queue`);
  }

  async measure({ user, patternId, tag }) {
    const p = this.#pattern(patternId);
    const pair = p?.measures.find((m) => m.tag === tag);
    if (!pair) throw new Error(`unknown measure ${patternId}/${tag}`);
    await this.ensureBuilt(user, patternId);
    const ws = user.workspace;
    return this.#gate.run({ userId: user.id, label: `${patternId} · measure ${tag}`, exclusive: true }, (ctx) =>
      this.#withConn(ws, ctx, async (conn, track) => {
        // In-memory undo / private redo strands defer 'redo size' and 'db block changes'
        // in V$MYSTAT until commit or rollback, so a read before the rollback sees 0 (or a
        // stale value). Turning it off makes each side's deltas exact and repeatable.
        // No reset needed: exec-pool connections are standalone and closed after this call.
        try {
          await conn.execute('ALTER SESSION SET "_in_memory_undo" = false');
        } catch (e) {
          const err = labErr('LAB-MEASURE', `could not prepare the measurement session: ${e.message}`);
          return { tag, document: { sql: pair.document.sql, stats: {}, result: err }, converged: { sql: pair.converged.sql, stats: {}, result: err } };
        }
        const side = async (stmt) => {
          // Unmeasured warm-up pass: parse, cursor and first-touch effects stay out of the numbers.
          track(await executeSql(conn, stmt.sql, this.#limits(false)));
          await conn.rollback();
          const before = await readStats(conn);
          const result = track(await executeSql(conn, stmt.sql, this.#limits(false)));
          const after = await readStats(conn);
          await conn.rollback();
          const stats = Object.fromEntries(Object.keys(after).map((n) => [n, after[n] - before[n]]));
          return { sql: stmt.sql, stats, result };
        };
        return { tag, document: await side(pair.document), converged: await side(pair.converged) };
      }));
  }

  // Measure it, swept across sizes: for each of the pattern's measure.sizes, calibrate.sql
  // resizes the measured data on both sides (committed), then each side's write runs once as a
  // warm-up and three times measured, each rolled back; the run with the median redo is kept.
  // The sizes rewrite the attendee's pattern data, so the pattern is always rebuilt from its
  // setup scripts at the end (the same as "Reset this pattern").
  async sweep({ user, patternId, tag }) {
    const p = this.#pattern(patternId);
    const pair = p?.measures.find((m) => m.tag === tag);
    const sizes = p?.meta.measure?.sizes;
    if (!pair || !sizes || !p.calibrate) throw new Error(`no measure sweep for ${patternId}/${tag}`);
    await this.ensureBuilt(user, patternId);
    const ws = user.workspace;
    const out = await this.#gate.run({ userId: user.id, label: `${patternId} · measure ${tag} × ${sizes.length} sizes`, exclusive: true }, (ctx) =>
      this.#withConn(ws, ctx, async (conn, track) => {
        const points = [];
        let error = null;
        try {
          await conn.execute('ALTER SESSION SET "_in_memory_undo" = false');
          const once = async (stmt) => {
            const before = await readStats(conn);
            const result = track(await executeSql(conn, stmt.sql, this.#limits(false)));
            const after = await readStats(conn);
            await conn.rollback();
            return { result, stats: Object.fromEntries(Object.keys(after).map((n) => [n, after[n] - before[n]])) };
          };
          const side = async (stmt) => {
            track(await executeSql(conn, stmt.sql, this.#limits(false)));   // warm-up, unmeasured
            await conn.rollback();
            const runs = [await once(stmt), await once(stmt), await once(stmt)];
            const failed = runs.find((r) => r.result.kind === 'error');
            if (failed) return { sql: stmt.sql, stats: {}, result: failed.result };
            runs.sort((a, b) => a.stats['redo size'] - b.stats['redo size']);
            return { sql: stmt.sql, ...runs[1] };
          };
          for (const n of sizes) {
            if (ctx.cancelled) { error = labErr('LAB-CANCELLED', 'Measurement was cancelled'); break; }
            conn.callTimeout = SYSTEM_BUDGET_MS;
            for (const sql of p.calibrate) await conn.execute(sql, sql.includes(':n') ? { n } : {});
            await conn.commit();
            const document = await side(pair.document);
            const converged = await side(pair.converged);
            points.push({ x: n, document, converged });
            if (document.result.kind === 'error' || converged.result.kind === 'error') break;
          }
        } catch (e) {
          error = labErr('LAB-MEASURE', `measurement failed: ${e.message}`);
          await conn.rollback().catch(() => {});
        }
        // Put the lab back exactly as built.
        const stmts = [...p.setup.document, ...p.setup.converged].map((st) => st.sql);
        const rebuilt = await this.#runStatements(conn, ctx, track, stmts, SYSTEM_BUDGET_MS);
        return { points, error, restored: rebuilt.every((r) => r.kind !== 'error') };
      }));
    if (out.restored) {
      await this.#ws.markBuilt(ws.schema, patternId, p.version);
      await this.#ws.clearDirty(ws.schema, patternId);
    } else {
      await this.#ws.markBuilt(ws.schema, patternId, 'stale');   // not the current version: rebuilds on next use
    }
    const ratio = (d, c) => (d > 0 && c > 0 ? d / c : null);
    return {
      tag,
      sizes,
      error: out.error,
      restored: out.restored,
      points: out.points.map((pt) => ({ ...pt, ratio: ratio(pt.document.stats['redo size'], pt.converged.stats['redo size']) })),
    };
  }
}
