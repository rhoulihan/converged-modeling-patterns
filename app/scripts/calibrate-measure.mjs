// Measures document-model redo ÷ converged redo for each pattern's @measure pair at several
// sizes of its size knob, in a scratch schema on the lab database (never CMP_USER or WS_*).
// Protocol = the console's Measure it: in-memory undo off, one unmeasured warm-up, then 3
// measured runs (median), each rolled back. Prints YAML to paste into each README's front matter.
//
// Usage: DB_HOST=localhost DB_PORT=1522 ORACLE_PASSWORD=... node scripts/calibrate-measure.mjs [patternId ...]
import fs from 'node:fs';
import path from 'node:path';
import oracledb from 'oracledb';
import { loadPatterns } from '../src/content/patterns.js';
import { parseSqlFile } from '../src/content/sqlParser.js';
import { readStats } from '../src/db/oracle.js';

const ROOT = path.resolve(import.meta.dirname, '../../patterns');
const SIZES = {
  '01-extended-reference': [1, 10, 100, 1000],
  '02-computed': [1, 2, 4, 6, 7],   // subscriber document size, KB
  '03-bucket': [33, 100, 1000, 3600],   // lab bucket holds 30 seeded readings + 3 measured
  '04-subset': [3, 10, 100, 1000],
  '05-tree-hierarchy': [3, 30, 300, 3000],
  '06-outlier': [10, 100, 800, 2000],
};
const USER = 'ZZ_CALIBRATE';
const PW = 'Calibrate2026x';
const host = process.env.DB_HOST ?? 'localhost';
const port = process.env.DB_PORT ?? '1522';
const connectString = `${host}:${port}/FREEPDB1`;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function asSystem(fn) {
  const c = await oracledb.getConnection({ user: 'system', password: process.env.ORACLE_PASSWORD, connectString });
  try { return await fn(c); } finally { await c.close(); }
}

async function run(conn, stmts, binds = {}) {
  for (const s of stmts) {
    const b = s.sql.includes(':n') ? binds : {};
    await conn.execute(s.sql, b);
  }
}

async function measureOnce(conn, sql) {
  const before = await readStats(conn);
  await conn.execute(sql);
  const after = await readStats(conn);
  await conn.rollback();
  return after['redo size'] - before['redo size'];
}

async function calibrate(p) {
  const conn = await oracledb.getConnection({ user: USER, password: PW, connectString });
  try {
    await conn.execute('ALTER SESSION SET "_in_memory_undo" = false');
    await run(conn, p.setup.document);
    await run(conn, p.setup.converged);
    await conn.commit();
    const scale = parseSqlFile(fs.readFileSync(path.join(ROOT, p.id, 'calibrate.sql'), 'utf8'));
    const m = p.measures[0];
    const points = [];
    for (const n of SIZES[p.id]) {
      await run(conn, scale, { n });
      await conn.commit();
      await measureOnce(conn, m.document.sql);
      await measureOnce(conn, m.converged.sql);
      const d = []; const c = [];
      for (let i = 0; i < 3; i++) { d.push(await measureOnce(conn, m.document.sql)); c.push(await measureOnce(conn, m.converged.sql)); }
      const ratio = median(d) / median(c);
      points.push({ x: n, ratio: Number(ratio.toFixed(2)), doc: median(d), conv: median(c) });
      console.error(`${p.id} n=${n}: doc ${median(d)} B · conv ${median(c)} B · ${ratio.toFixed(1)}×`);
    }
    return points;
  } finally { await conn.close(); }
}

const only = process.argv.slice(2);
const patterns = loadPatterns(ROOT).filter((p) => !only.length || only.includes(p.id));
await asSystem(async (c) => {
  await c.execute(`BEGIN EXECUTE IMMEDIATE 'DROP USER ${USER} CASCADE'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1918 THEN RAISE; END IF; END;`);
  await c.execute(`CREATE USER ${USER} IDENTIFIED BY "${PW}" QUOTA UNLIMITED ON users`);
  // Same object privileges a lab workspace gets (03 builds a materialized view, 05 a property graph).
  await c.execute(`GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE TRIGGER, CREATE SEQUENCE, CREATE PROCEDURE, CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH, SELECT ANY DICTIONARY TO ${USER}`);
  await c.execute(`GRANT ALTER SESSION TO ${USER}`);
});
try {
  for (const p of patterns) {
    const pts = await calibrate(p);
    console.log(`# ${p.id}\nmeasure:\n  calibration:\n${pts.map((q) => `    - { x: ${q.x}, ratio: ${q.ratio} }   # doc ${q.doc} B, conv ${q.conv} B`).join('\n')}\n`);
  }
} finally {
  await asSystem((c) => c.execute(`DROP USER ${USER} CASCADE`));
}
