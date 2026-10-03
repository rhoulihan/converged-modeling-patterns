// app/src/db/oracle.js
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import oracledb from 'oracledb';
import { parseSqlFile } from '../content/sqlParser.js';

oracledb.fetchAsString = [oracledb.CLOB];

const BOOTSTRAP = path.resolve(import.meta.dirname, '../../sql/bootstrap.sql');
export const STAT_NAMES = ['redo size', 'db block changes', 'session logical reads', 'CPU used by this session',
  'consistent gets', 'db block gets', 'physical reads', 'redo entries', 'undo change vector size', 'sorts (memory)',
  'table scan rows gotten', 'table fetch by rowid'];

const connectString = (cfg) => `${cfg.db.host}:${cfg.db.port}/${cfg.db.service}`;

export async function bootstrap(cfg) {
  const conn = await oracledb.getConnection({
    user: 'sys', password: cfg.db.sysPassword, connectString: connectString(cfg), privilege: oracledb.SYSDBA,
  });
  try {
    for (const st of parseSqlFile(fs.readFileSync(BOOTSTRAP, 'utf8'))) {
      await conn.execute(st.sql, st.sql.includes(':pw') ? { pw: cfg.db.labAdminPassword } : {});
    }
  } finally {
    await conn.close();
  }
}

// node-oracledb Thin mode does not implement heterogeneous connection pooling
// (NJS-089: "Heterogeneous Pooling is not supported by node-oracledb in Thin mode") —
// this is a permanent Thin-mode architecture limitation, not a version bug, and switching
// to Thick mode requires review (see task brief). Attendee schemas are created dynamically
// by lab_admin, so their usernames are not known up front and cannot each get their own
// homogeneous pool. Instead `exec` is a minimal pool-shaped wrapper: it hands out standalone
// Thin-mode connections under whatever credentials are supplied, bounded to `cfg.db.poolMax`
// concurrent connections with the same queue-timeout behavior a real pool would apply.
//
// `connect` is injectable (defaults to a real oracledb connection) so the wrapper's own
// acquire/release/close bookkeeping can be unit-tested with a stub, independent of the DB.
export function createExecPool(cfg, { connect = (opts) => oracledb.getConnection({ ...opts, connectString: connectString(cfg) }) } = {}) {
  const max = cfg.db.poolMax;
  const queueTimeoutMs = cfg.gate.queueTimeoutMs;
  let open = 0;
  let closed = false;
  const waiters = [];
  const live = new Set();

  function release() {
    open--;
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      open++;
      next.resolve();
    }
  }

  function acquire() {
    if (open < max) {
      open++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i !== -1) waiters.splice(i, 1);
          reject(new Error('NJS-040: connection request timed out'));
        }, queueTimeoutMs),
      };
      waiters.push(waiter);
    });
  }

  return {
    async getConnection(opts = {}) {
      if (closed) throw new Error('exec pool is closed');
      await acquire();
      let conn;
      try {
        conn = await connect(opts);
      } catch (err) {
        release();
        throw err;
      }
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        live.delete(conn);
        release();
      };
      const rawClose = conn.close.bind(conn);
      conn.close = async (...args) => {
        try {
          return await rawClose(...args);
        } finally {
          releaseOnce();
        }
      };
      live.add(conn);
      return conn;
    },
    async close() {
      closed = true;
      for (const w of waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error('exec pool is closing'));
      }
      const toClose = [...live];
      live.clear();
      await Promise.all(toClose.map((c) => c.close({ drop: true }).catch(() => {})));
    },
  };
}

export async function createPools(cfg) {
  const exec = createExecPool(cfg);
  const control = await oracledb.createPool({
    user: 'lab_admin', password: cfg.db.labAdminPassword, connectString: connectString(cfg),
    poolMin: 0, poolMax: 1, poolIncrement: 1, queueTimeout: 60000,
  });
  return { exec, control, close: async () => { await exec.close(); await control.close(5); } };
}

function clip(rows, maxRows, maxBytes) {
  let truncated = rows.length > maxRows;
  let out = rows.slice(0, maxRows);
  while (out.length && JSON.stringify(out).length > maxBytes) {
    out = out.slice(0, Math.floor(out.length * 0.8));
    truncated = true;
  }
  return { rows: out, truncated };
}

export async function executeSql(conn, sql, { timeoutMs, maxRows, maxBytes, autoCommit = true }) {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  conn.callTimeout = timeoutMs;
  try {
    const r = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit, maxRows: maxRows + 1 });
    if (r.metaData) {
      const { rows, truncated } = clip(r.rows ?? [], maxRows, maxBytes);
      return { kind: 'rows', columns: r.metaData.map((m) => m.name), rows, rowCount: rows.length, truncated, elapsedMs: elapsed() };
    }
    if (typeof r.rowsAffected === 'number') return { kind: 'dml', rowsAffected: r.rowsAffected, elapsedMs: elapsed() };
    return { kind: 'ok', elapsedMs: elapsed() };
  } catch (err) {
    return { kind: 'error', error: err.message, code: err.code ?? null, elapsedMs: elapsed() };
  } finally {
    conn.callTimeout = 0;
  }
}

// The executed plan of the last statement a session ran, with its runtime numbers per step
// (the session must run with statistics_level = ALL). Read on a privileged connection (the
// control pool), so attendees need no access to V$ views. null for PL/SQL blocks or when the
// statement is no longer in the cursor cache.
export async function readPlan(conn, sid) {
  const o = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const s = (await conn.execute('SELECT prev_sql_id AS sql_id, prev_child_number AS child FROM v$session WHERE sid = :sid', { sid }, o)).rows[0];
  if (!s?.SQL_ID) return null;
  const r = await conn.execute(
    `SELECT p.id, p.parent_id, p.depth, p.operation, p.options, p.object_name, p.object_type, p.cardinality,
            p.last_output_rows, p.last_cr_buffer_gets, p.last_cu_buffer_gets, p.last_disk_reads, p.last_elapsed_time,
            p.access_predicates, p.filter_predicates, i.table_name AS index_table, i.uniqueness, i.index_type
       FROM v$sql_plan_statistics_all p
       LEFT JOIN dba_indexes i ON i.owner = p.object_owner AND i.index_name = p.object_name
      WHERE p.sql_id = :s AND p.child_number = :c ORDER BY p.id`, { s: s.SQL_ID, c: s.CHILD }, o);
  if (!r.rows.length) return null;
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return r.rows.map((x) => ({
    id: n(x.ID), parentId: n(x.PARENT_ID), depth: n(x.DEPTH), operation: x.OPERATION, options: x.OPTIONS, object: x.OBJECT_NAME,
    objectType: x.OBJECT_TYPE, estRows: n(x.CARDINALITY), rows: n(x.LAST_OUTPUT_ROWS),
    blocks: (n(x.LAST_CR_BUFFER_GETS) ?? 0) + (n(x.LAST_CU_BUFFER_GETS) ?? 0), diskReads: n(x.LAST_DISK_READS), elapsedUs: n(x.LAST_ELAPSED_TIME),
    access: x.ACCESS_PREDICATES ?? null, filter: x.FILTER_PREDICATES ?? null,
    indexTable: x.INDEX_TABLE ?? null, unique: x.UNIQUENESS === 'UNIQUE', indexType: x.INDEX_TYPE ?? null,
  }));
}

export async function readStats(conn) {
  const r = await conn.execute(
    `SELECT n.name, m.value FROM v$mystat m JOIN v$statname n ON n.statistic# = m.statistic#
      WHERE n.name IN (${STAT_NAMES.map((_, i) => `:n${i}`).join(', ')})`,
    Object.fromEntries(STAT_NAMES.map((n, i) => [`n${i}`, n])),
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Object.fromEntries(r.rows.map((x) => [x.NAME, Number(x.VALUE)]));
}
