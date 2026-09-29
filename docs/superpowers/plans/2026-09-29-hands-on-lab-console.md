# Hands-on Lab Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lab-ui` web container to `converged-modeling-patterns` that lets attendees view, copy, edit and run every pattern query (SQL and MongoDB API), and measure write amplification, through a single-permit gate with a read-only cache, in solo and event modes.

**Architecture:** A Node 22 / Express app (`app/`) beside the existing `oracle` service. Content is parsed at startup from the validated `patterns/NN-*/` files (structured comments only). Every database operation passes a FIFO weighted semaphore (1 permit) before reaching a node-oracledb pool (default max 1) or a MongoDB driver client (default pool 1); eligible read-only queries are answered from an LRU cache without entering the gate. Event mode adds per-attendee schemas provisioned by a least-privilege `LAB_ADMIN`, sign-in, and an admin page.

**Tech Stack:** Node 22 (ES modules), Express 5, node-oracledb 6 (thin), official `mongodb` driver, `acorn` (safe literal parsing), `yaml`, vitest, supertest, esbuild (vendor bundle), CodeMirror 6, `@fontsource/*` fonts, puppeteer-core (smoke test).

**Spec:** `docs/superpowers/specs/2026-09-29-hands-on-lab-console-design.md`

## Global Constraints

- Node `>=22`; `"type": "module"` everywhere; no TypeScript.
- `LAB_MODE` is `solo` (default) or `event`; `event` requires `ADMIN_PASSWORD`.
- UI host port `CMP_UI_PORT`, default `3100`; container port `3000`.
- Gate: **1 permit**; measure-it, reset and provisioning take **all** permits; SQL `callTimeout` **10000 ms**; Mongo `maxTimeMS` **10000**; **1** queued request per user; max queue wait **30000 ms** → HTTP **429** `{ "error": "busy, retry" }`; paused → HTTP **423** `{ "error": "paused by instructor" }`.
- Pools: `DB_POOL_MAX` default **1** (heterogeneous oracledb pool), `MONGO_POOL_MAX` default **1** (per client), control pool fixed at **1**.
- Cache: in-memory LRU, **500** entries; key = `(patternId, sha256(normalized text), datasetVersion)`; only for single read-only statements on pristine workspaces; never for measure-it.
- Result caps: **500 rows / 1 MB** per result, with `truncated: true`.
- The running app makes **no outbound network requests**; fonts, CodeMirror and all JS/CSS are served from `app/public/`.
- Pattern `.sql`/`.js` files change **only by added comments** (`-- @step`, `-- @note`, `-- @measure`, `// @step`, `// @note`); `run.sh` must still pass 18/0 after every task that touches them.
- User-submitted text is **never** passed to `eval`, `Function`, or `vm`.
- Always write "26ai" in UI copy and docs, never "23ai".
- Deck look: fonts Bricolage Grotesque / Public Sans / IBM Plex Mono; tokens `--hot #B3372B`, `--cool #0E8A63`, `--flow #2563EB` (+ dark variants from the deck).

## Review Focus

1. A seed `INSERT` whose JSON literal contains `;`, `--` or `'` escaped as `''` — the SQL parser must keep it one statement and must not strip "comments" inside strings (test in Task 2).
2. An attendee pastes a statement ending in `;` or a sqlplus `/` line into the console — it must run, not fail with ORA-00911 (test in Task 2, `splitConsoleSql`).
3. The app restarts mid-event after an attendee modified pattern 01 — that attendee must not be served the pristine cached result (dirty flags persist in the database; test in Task 10).
4. An Oracle error such as ORA-00942 must come back as a normal result `{ error, code }` with HTTP 200, not a 500 (test in Task 10).
5. A result bigger than 1 MB (e.g. `SELECT * FROM` a large JSON collection) must be truncated with a notice, not break the page (test in Task 10).

## Implementation choices within the spec

- **Sessions** are signed `HttpOnly` cookies whose HMAC secret is stored in the database (`lab_settings`), instead of one database row per session. This meets the spec's requirement that an app restart does not log anyone out, with less moving parts.
- **Measure-it grants for `CMP_USER`** are applied by the app's start-up bootstrap (`app/sql/bootstrap.sql`, run as SYSDBA) rather than by `run.sh`, so they hold however the stack is started.
- **Measure-it runs each write in a transaction that is rolled back**, so it is repeatable and never marks a workspace dirty.

## Known risk to watch

Oracle updates JSON documents in place (OSON partial updates), so for single-document patterns (Computed, Bucket) the document-model write measured *inside Oracle* may generate less redo than the lecture's document-engine argument implies. Task 10's directional assertion will surface this; if it fails, stop and report the numbers — the framing of that pattern's Measure it tab is a content decision.

## File Structure

```
app/
  package.json, vitest.config.js, Dockerfile, .dockerignore
  build/vendor.mjs                 bundle CodeMirror 6 + copy fonts into public/vendor (image build time)
  sql/bootstrap.sql                idempotent: LAB_ADMIN user, control tables, grants (run as SYSDBA once at startup)
  src/config.js                    env → frozen config
  src/content/sqlParser.js         parseSqlFile, splitConsoleSql
  src/content/mongoCommand.js      parseMongoCommand (acorn literal evaluator)
  src/content/mongoScript.js       parseMongoScript (@step cards from mongosh scripts)
  src/content/patterns.js          loadPatterns(dir) → pattern model
  src/guard.js                     classifySql(text) → { allowed, reason }
  src/gate.js                      Gate: FIFO weighted semaphore
  src/cache.js                     ResultCache, isReadOnlySql, isReadOnlyMongo, patternsTouched
  src/db/oracle.js                 pools, bootstrap, executeSql, withStats
  src/db/mongo.js                  MongoPool: clients per credential, runMongo
  src/services/workspaces.js       solo/event workspace registry, dirty flags, provisioning
  src/services/runner.js           runSql, runMongoText, measure, reset
  src/routes/api.js                /api/* (patterns, run, measure, reset, queue, signin, me)
  src/routes/admin.js              /api/admin/* (login, status, cancel, pause, prewarm, reset, end)
  src/server.js                    createApp(deps) + main()
  public/index.html, public/admin.html
  public/css/lab.css
  public/js/api.js, app.js, console.js, results.js, measure.js, admin.js
  test/unit/*.test.js
  test/integration/*.test.js       need a live cmp-oracle (compose profile "test")
  test/smoke/smoke.mjs             headless browser walkthrough + screenshots
  test/load/load.mjs               150 simulated attendees
patterns/NN-*/README.md            + YAML front matter
patterns/NN-*/*.sql, *.js          + @step/@note/@measure comments
compose.yml                        + lab-ui service, + lab-ui-test (profile test)
run.sh                             + stage 3: app tests
docs/instructor-runbook.md         new
README.md                          + "Hands-on console" section
```

---

### Task 1: App skeleton and configuration

**Files:**
- Create: `app/package.json`, `app/vitest.config.js`, `app/src/config.js`
- Test: `app/test/unit/config.test.js`

**Interfaces:**
- Produces: `loadConfig(env = process.env) → Readonly<Config>` where
  `Config = { mode: 'solo'|'event', port: number, patternsDir: string, db: { host, port, service, sysPassword, cmpUser, cmpPassword, labAdminPassword, poolMax }, mongo: { host, port, poolMax }, gate: { permits: 1, queueTimeoutMs, sqlTimeoutMs, mongoTimeoutMs }, cache: { maxEntries, enabled }, limits: { maxRows, maxBytes, maxStatements }, event: { code: string|null, adminPassword: string|null } }`.

- [ ] **Step 1: Create the package and install dependencies**

```bash
mkdir -p app/src app/test/unit app/test/integration app/public app/build app/sql
cd app
cat > package.json <<'JSON'
{
  "name": "cmp-lab-ui",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/server.js",
    "build:vendor": "node build/vendor.mjs",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:smoke": "node test/smoke/smoke.mjs",
    "test:load": "node test/load/load.mjs"
  }
}
JSON
npm install express oracledb mongodb acorn yaml
npm install -D vitest supertest esbuild codemirror @codemirror/lang-sql @codemirror/lang-javascript @codemirror/view @codemirror/state @fontsource/bricolage-grotesque @fontsource/public-sans @fontsource/ibm-plex-mono puppeteer-core
```

Expected: `package.json` gains `dependencies`/`devDependencies` with exact resolved versions; `package-lock.json` created. Commit the lock file. Then ignore generated folders:

```bash
printf 'node_modules/\npublic/vendor/\ntest/artifacts/\n' > .gitignore
```

- [ ] **Step 2: Add the vitest config**

```js
// app/vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 120000,
    fileParallelism: false, // integration tests share one database
  },
});
```

- [ ] **Step 3: Write the failing config tests**

```js
// app/test/unit/config.test.js
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults to solo mode with a single-permit gate and pools of 1', () => {
    const c = loadConfig({});
    expect(c.mode).toBe('solo');
    expect(c.port).toBe(3000);
    expect(c.gate).toEqual({ permits: 1, queueTimeoutMs: 30000, sqlTimeoutMs: 10000, mongoTimeoutMs: 10000 });
    expect(c.db.poolMax).toBe(1);
    expect(c.mongo.poolMax).toBe(1);
    expect(c.cache).toEqual({ maxEntries: 500, enabled: true });
    expect(c.limits).toEqual({ maxRows: 500, maxBytes: 1048576, maxStatements: 20 });
    expect(c.db.host).toBe('oracle');
    expect(c.db.service).toBe('FREEPDB1');
  });

  it('reads overrides from the environment', () => {
    const c = loadConfig({ DB_POOL_MAX: '2', MONGO_POOL_MAX: '3', DB_HOST: 'x', SQL_TIMEOUT_MS: '5000' });
    expect(c.db.poolMax).toBe(2);
    expect(c.mongo.poolMax).toBe(3);
    expect(c.db.host).toBe('x');
    expect(c.gate.sqlTimeoutMs).toBe(5000);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ LAB_MODE: 'party' })).toThrow(/LAB_MODE/);
  });

  it('requires ADMIN_PASSWORD in event mode', () => {
    expect(() => loadConfig({ LAB_MODE: 'event' })).toThrow(/ADMIN_PASSWORD/);
    const c = loadConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'pw', EVENT_CODE: 'NW26' });
    expect(c.event).toEqual({ code: 'NW26', adminPassword: 'pw' });
  });

  it('rejects non-positive pool sizes', () => {
    expect(() => loadConfig({ DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd app && npx vitest run test/unit/config.test.js`
Expected: FAIL — `Cannot find module '../../src/config.js'`.

- [ ] **Step 5: Implement `config.js`**

```js
// app/src/config.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function int(env, key, dflt, { min = 1 } = {}) {
  if (env[key] === undefined || env[key] === '') return dflt;
  const n = Number(env[key]);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} must be an integer >= ${min} (got "${env[key]}")`);
  return n;
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
}

export function loadConfig(env = process.env) {
  const mode = env.LAB_MODE || 'solo';
  if (!['solo', 'event'].includes(mode)) throw new Error(`LAB_MODE must be "solo" or "event" (got "${mode}")`);
  const adminPassword = env.ADMIN_PASSWORD || null;
  if (mode === 'event' && !adminPassword) throw new Error('ADMIN_PASSWORD is required when LAB_MODE=event');
  return deepFreeze({
    mode,
    port: int(env, 'PORT', 3000),
    patternsDir: env.PATTERNS_DIR || path.resolve(here, '../../patterns'),
    db: {
      host: env.DB_HOST || 'oracle',
      port: int(env, 'DB_PORT', 1521),
      service: env.DB_SERVICE || 'FREEPDB1',
      sysPassword: env.ORACLE_PASSWORD || 'Sandbox2026',
      cmpUser: 'CMP_USER',
      cmpPassword: env.CMP_PASSWORD || 'CmpUser2026',
      labAdminPassword: env.LAB_ADMIN_PASSWORD || 'LabAdmin2026',
      poolMax: int(env, 'DB_POOL_MAX', 1),
    },
    mongo: { host: env.MONGO_HOST || env.DB_HOST || 'oracle', port: int(env, 'MONGO_PORT', 27017), poolMax: int(env, 'MONGO_POOL_MAX', 1) },
    gate: {
      permits: 1,
      queueTimeoutMs: int(env, 'QUEUE_TIMEOUT_MS', 30000),
      sqlTimeoutMs: int(env, 'SQL_TIMEOUT_MS', 10000),
      mongoTimeoutMs: int(env, 'MONGO_TIMEOUT_MS', 10000),
    },
    cache: { maxEntries: int(env, 'CACHE_MAX_ENTRIES', 500), enabled: env.CACHE_ENABLED !== 'false' },
    limits: { maxRows: 500, maxBytes: 1048576, maxStatements: 20 },
    event: { code: env.EVENT_CODE || null, adminPassword },
  });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd app && npx vitest run test/unit/config.test.js`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/.gitignore app/vitest.config.js app/src/config.js app/test/unit/config.test.js
git commit -m "feat(lab-ui): app skeleton and configuration"
```

---
### Task 2: SQL file parser and console splitter

**Files:**
- Create: `app/src/content/sqlParser.js`
- Test: `app/test/unit/sqlParser.test.js`

**Interfaces:**
- Produces:
  - `parseSqlFile(text: string) → Stmt[]` where `Stmt = { sql: string, title: string|null, notes: string[], measure: string|null, plsql: boolean, line: number }`. `sql` has no trailing `;` for SQL; PL/SQL keeps its final `END;` and drops the `/` line.
  - `isSetup(stmt) → boolean` — true when `title === null && measure === null`.
  - `splitConsoleSql(text: string) → string[]` — statements ready for `connection.execute`.

Rules: `-- @step <title>`, `-- @note <text>` (repeatable), `-- @measure <tag>` attach to the next statement; plain `--` comment lines between an annotation and its statement are ignored; sqlplus line commands (`SET`, `PROMPT`, `COLUMN`, `WHENEVER`, `EXIT`, `SPOOL`, `DEFINE`, …) are dropped only when they begin a statement; `BEGIN`/`DECLARE`/`CREATE [OR REPLACE] TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE` start a PL/SQL unit ended by a line containing only `/`; SQL ends at a `;` outside single-quoted strings (with `''` escapes) and outside `--`/single-line `/* */` comments, or at a lone `/` line. Known limitation (documented in the file header): `q'[...]'` literals and multi-line `/* */` comments inside a statement are not supported — none exist in the pattern files.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/sqlParser.test.js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/sqlParser.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```js
// app/src/content/sqlParser.js
// Parses the validated pattern .sql files (and console input) into executable statements.
// Limitation: q'[...]' literals and multi-line /* */ comments inside a statement are not
// supported; the pattern files use neither.
const SQLPLUS = /^(SET|PROMPT|COLUMN|COL|WHENEVER|EXIT|QUIT|SPOOL|DEFINE|UNDEFINE|SHOW|TTITLE|BTITLE|BREAK|CLEAR)\b|^@/i;
const PLSQL_START = /^(BEGIN|DECLARE)\b|^CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b/i;
const ANNOT = /^--\s*@(step|note|measure)\b\s*(.*)$/i;

function scanLine(line, inString) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "'") {
        if (line[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '-' && line[i + 1] === '-') return { end: -1, inString };
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close === -1) return { end: -1, inString };
      i = close + 1;
      continue;
    }
    if (ch === ';') return { end: i, inString };
  }
  return { end: -1, inString };
}

export function parseSqlFile(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let anno = null;
  let buf = [];
  let startLine = 0;
  let plsql = false;
  let inString = false;

  const flush = () => {
    const sql = buf.join('\n').trim();
    if (sql) {
      out.push({ sql, title: anno?.title ?? null, notes: anno?.notes ?? [], measure: anno?.measure ?? null, plsql, line: startLine });
    }
    anno = null;
    buf = [];
    plsql = false;
    inString = false;
  };

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (buf.length === 0) {
      if (!t || t === '/') return;
      const a = t.match(ANNOT);
      if (a) {
        anno ??= { title: null, notes: [], measure: null };
        const kind = a[1].toLowerCase();
        const val = a[2].trim();
        if (kind === 'step') anno.title = val;
        else if (kind === 'note') anno.notes.push(val);
        else anno.measure = val;
        return;
      }
      if (t.startsWith('--') || SQLPLUS.test(t)) return;
      startLine = idx + 1;
      plsql = PLSQL_START.test(t);
    }
    if (plsql) {
      if (t === '/') flush();
      else buf.push(line);
      return;
    }
    if (t === '/') { flush(); return; }
    const r = scanLine(line, inString);
    if (r.end >= 0) {
      buf.push(line.slice(0, r.end));
      flush();
      return;
    }
    inString = r.inString;
    buf.push(line);
  });
  if (buf.length) flush();
  return out;
}

export const isSetup = (stmt) => stmt.title === null && stmt.measure === null;

export function splitConsoleSql(text) {
  return parseSqlFile(text).map((s) => s.sql);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run test/unit/sqlParser.test.js`
Expected: all passed (the real-file test passes before Task 7 because unannotated files still parse; it re-runs after annotation).

- [ ] **Step 5: Commit**

```bash
git add app/src/content/sqlParser.js app/test/unit/sqlParser.test.js
git commit -m "feat(lab-ui): SQL file parser with annotations, PL/SQL and console splitter"
```

---
### Task 3: MongoDB command parser and script-card extractor

**Files:**
- Create: `app/src/content/mongoCommand.js`, `app/src/content/mongoScript.js`
- Test: `app/test/unit/mongoCommand.test.js`, `app/test/unit/mongoScript.test.js`

**Interfaces:**
- Produces:
  - `class MongoParseError extends Error`
  - `parseMongoCommand(text) → MongoCmd` where `MongoCmd = { kind: 'showCollections' } | { kind: 'db', op: 'aggregate', args: any[], mods: {} } | { kind: 'collection', collection: string, op: 'find'|'findOne'|'aggregate'|'countDocuments'|'insertOne'|'insertMany'|'updateOne'|'updateMany'|'deleteOne'|'deleteMany', args: any[], mods: { sort?: object, limit?: number, skip?: number } }`.
  - `parseMongoScript(text, file?) → Array<{ title: string, notes: string[], command: string, line: number }>` — cards from top-level `// @step` / `// @note` comments bound to the next top-level statement (`db.*` expression or `const x = db.*`), with a trailing `.toArray()` removed. Annotations inside blocks are ignored.

Arguments are evaluated from the acorn AST by a literal-only evaluator: objects (non-computed keys), arrays, strings, numbers, booleans, `null`, regex literals, template literals without `${}`, unary minus on numbers, `ISODate("…")`, `new Date("…")`, `ObjectId("…")`. Anything else raises `MongoParseError`. Nothing is evaluated as code.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/mongoCommand.test.js
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { parseMongoCommand, MongoParseError } from '../../src/content/mongoCommand.js';

describe('parseMongoCommand', () => {
  it('parses a collection findOne with an unquoted-key filter', () => {
    expect(parseMongoCommand('db.xr_client_dv.findOne({_id: "C-001"});')).toEqual({
      kind: 'collection', collection: 'xr_client_dv', op: 'findOne', args: [{ _id: 'C-001' }], mods: {},
    });
  });
  it('parses db.aggregate with a multi-line $sql template literal and .toArray()', () => {
    const c = parseMongoCommand('db.aggregate([{ $sql: `select machine_id\n  from bk_sensor_readings` }]).toArray()');
    expect(c.kind).toBe('db');
    expect(c.op).toBe('aggregate');
    expect(c.args[0][0].$sql).toContain('from bk_sensor_readings');
  });
  it('collects sort/limit/skip modifiers on find', () => {
    const c = parseMongoCommand('db.c.find({a:{$gt:-1}}).sort({a:-1}).skip(2).limit(5)');
    expect(c.args).toEqual([{ a: { $gt: -1 } }]);
    expect(c.mods).toEqual({ sort: { a: -1 }, skip: 2, limit: 5 });
  });
  it('supports getCollection, regex, ISODate and ObjectId', () => {
    const c = parseMongoCommand('db.getCollection("x").find({n:/^A/i, d:{$gte:ISODate("2026-08-01T00:00:00Z")}, o:ObjectId("65f000000000000000000001")})');
    expect(c.collection).toBe('x');
    expect(c.args[0].n).toBeInstanceOf(RegExp);
    expect(c.args[0].d.$gte).toBeInstanceOf(Date);
    expect(c.args[0].o).toBeInstanceOf(ObjectId);
  });
  it('parses show collections', () => {
    expect(parseMongoCommand('show collections')).toEqual({ kind: 'showCollections' });
  });
  it.each([
    ['db.c.drop()', /unsupported operation/],
    ['db.c.find({a: `${x}`})', /template/],
    ['db.c.find(process.exit())', /unsupported syntax/],
    ['db.c.find({}); db.c.find({})', /one command/],
    ['require("fs")', /db\.<collection>/],
    ['db.c.findOne({}).limit(1)', /only apply to find/],
    ['db.c.find({...x})', /unsupported/],
  ])('rejects %s', (text, msg) => {
    expect(() => parseMongoCommand(text)).toThrow(MongoParseError);
    expect(() => parseMongoCommand(text)).toThrow(msg);
  });
});
```

```js
// app/test/unit/mongoScript.test.js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/mongoCommand.test.js test/unit/mongoScript.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `mongoCommand.js`**

```js
// app/src/content/mongoCommand.js
import * as acorn from 'acorn';
import { ObjectId } from 'mongodb';

export class MongoParseError extends Error {}

const COLL_OPS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'insertOne', 'insertMany',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany']);
const CURSOR_MODS = new Set(['sort', 'limit', 'skip', 'toArray']);

const fail = (node, msg) => new MongoParseError(node && node.start !== undefined ? `${msg} (at char ${node.start})` : msg);

function lit(node) {
  switch (node.type) {
    case 'Literal':
      return node.regex ? new RegExp(node.regex.pattern, node.regex.flags) : node.value;
    case 'TemplateLiteral':
      if (node.expressions.length) throw fail(node, 'template literals with ${…} are not supported');
      return node.quasis.map((q) => q.value.cooked).join('');
    case 'ArrayExpression':
      return node.elements.map((el) => {
        if (!el || el.type === 'SpreadElement') throw fail(node, 'unsupported array element');
        return lit(el);
      });
    case 'ObjectExpression': {
      const o = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) throw fail(p, 'unsupported object property');
        o[p.key.type === 'Identifier' ? p.key.name : String(p.key.value)] = lit(p.value);
      }
      return o;
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return -node.argument.value;
      break;
    case 'NewExpression':
    case 'CallExpression': {
      const name = node.callee.type === 'Identifier' ? node.callee.name : null;
      if (name === 'Date' || name === 'ISODate') {
        const a = node.arguments.map(lit);
        return a.length ? new Date(a[0]) : new Date();
      }
      if (name === 'ObjectId') return new ObjectId(lit(node.arguments[0]));
      break;
    }
    default:
      break;
  }
  throw fail(node, `unsupported syntax: ${node.type}`);
}

const prop = (m) => (m.computed ? (m.property.type === 'Literal' ? String(m.property.value) : null) : m.property.name);
const isDb = (n) => n.type === 'Identifier' && n.name === 'db';

function collectionName(n) {
  if (n.type === 'MemberExpression' && isDb(n.object)) return prop(n);
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && isDb(n.callee.object) && prop(n.callee) === 'getCollection') {
    return lit(n.arguments[0]);
  }
  return null;
}

export function parseMongoCommand(text) {
  const src = String(text).trim().replace(/;\s*$/, '');
  if (/^show\s+collections$/i.test(src)) return { kind: 'showCollections' };
  let expr;
  try {
    expr = acorn.parseExpressionAt(src, 0, { ecmaVersion: 'latest' });
  } catch (e) {
    throw new MongoParseError(`could not parse: ${e.message}`);
  }
  if (src.slice(expr.end).trim()) throw new MongoParseError('only one command at a time');
  const shapeErr = () => new MongoParseError('expected db.<collection>.<operation>(…) or db.aggregate([…])');

  const mods = {};
  let node = expr;
  while (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && CURSOR_MODS.has(prop(node.callee))) {
    const name = prop(node.callee);
    if (name !== 'toArray') mods[name] = lit(node.arguments[0]);
    node = node.callee.object;
  }
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') throw shapeErr();
  const op = prop(node.callee);
  const target = node.callee.object;
  const args = node.arguments.map(lit);
  if (isDb(target)) {
    if (op !== 'aggregate') throw new MongoParseError(`unsupported operation db.${op}`);
    return { kind: 'db', op, args, mods };
  }
  const collection = collectionName(target);
  if (!collection) throw shapeErr();
  if (!COLL_OPS.has(op)) throw new MongoParseError(`unsupported operation ${op}`);
  if (Object.keys(mods).length && op !== 'find') throw new MongoParseError('sort/limit/skip only apply to find');
  return { kind: 'collection', collection, op, args, mods };
}
```

- [ ] **Step 4: Implement `mongoScript.js`**

```js
// app/src/content/mongoScript.js
import * as acorn from 'acorn';
import { parseMongoCommand } from './mongoCommand.js';

const ANNOT = /^\s*@(step|note)\b\s*(.*)$/i;

export function parseMongoScript(text, file = 'script') {
  const comments = [];
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true, onComment: comments });
  const annos = comments
    .filter((c) => c.type === 'Line')
    .map((c) => ({ c, m: c.value.match(ANNOT) }))
    .filter((x) => x.m);
  const steps = [];
  let ai = 0;
  let prevEnd = 0;
  for (const st of ast.body) {
    const mine = [];
    while (ai < annos.length && annos[ai].c.end <= st.start) {
      if (annos[ai].c.start >= prevEnd) mine.push(annos[ai]);
      ai++;
    }
    prevEnd = st.end;
    const stepAnno = mine.filter((x) => x.m[1].toLowerCase() === 'step').pop();
    if (!stepAnno) continue;
    const node = st.type === 'VariableDeclaration' && st.declarations.length === 1 ? st.declarations[0].init
      : st.type === 'ExpressionStatement' ? st.expression : null;
    const where = `${file}:${st.loc.start.line}`;
    if (!node) throw new Error(`${where}: @step must precede a db.* expression or "const x = db.*"`);
    const command = text.slice(node.start, node.end).replace(/\.toArray\(\s*\)\s*$/, '');
    try {
      parseMongoCommand(command);
    } catch (e) {
      throw new Error(`${where}: ${e.message}`);
    }
    steps.push({
      title: stepAnno.m[2].trim(),
      notes: mine.filter((x) => x.m[1].toLowerCase() === 'note').map((x) => x.m[2].trim()),
      command,
      line: st.loc.start.line,
    });
  }
  return steps;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd app && npx vitest run test/unit/mongoCommand.test.js test/unit/mongoScript.test.js`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add app/src/content/mongoCommand.js app/src/content/mongoScript.js app/test/unit/mongoCommand.test.js app/test/unit/mongoScript.test.js
git commit -m "feat(lab-ui): safe mongosh command parser and script-card extractor"
```

---
### Task 4: Statement guard (defence in depth)

**Files:**
- Create: `app/src/guard.js`
- Test: `app/test/unit/guard.test.js`

**Interfaces:**
- Consumes: `parseSqlFile` (Task 2) in the real-file test; `MongoCmd` shape (Task 3).
- Produces: `classifySql(text: string) → { allowed: boolean, reason?: string }`; `classifyMongo(cmd: MongoCmd) → { allowed, reason? }` (checks every `$sql` stage text with `classifySql`).

The real isolation boundary is schema privileges (Task 11). The guard rejects obviously out-of-bounds statements early with a clear message. Rules match anywhere in the text after normalization (comments removed, upper-cased, whitespace collapsed), **including inside string literals**, so `EXECUTE IMMEDIATE 'GRANT …'` is blocked. A string that merely contains the word `grant` is therefore also blocked — accepted false positive.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/guard.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { classifySql, classifyMongo } from '../../src/guard.js';
import { parseSqlFile } from '../../src/content/sqlParser.js';

describe('classifySql', () => {
  it.each([
    'SELECT * FROM xr_client_dv',
    "INSERT INTO t VALUES ('{\"a\":1}')",
    'BEGIN NULL; END;',
    'CREATE OR REPLACE TRIGGER trg AFTER INSERT ON t FOR EACH ROW BEGIN NULL; END;',
    "CREATE OR REPLACE JSON RELATIONAL DUALITY VIEW v AS SELECT JSON {'_id': t.id} FROM t",
    'SELECT table_name FROM user_tables',
  ])('allows %s', (sql) => expect(classifySql(sql)).toEqual({ allowed: true }));

  it.each([
    ['alter system flush shared_pool', /ALTER SYSTEM/],
    ['ALTER DATABASE OPEN', /ALTER DATABASE/],
    ['drop user ws_abc cascade', /USER/],
    ['CREATE /* x */ USER bob IDENTIFIED BY p', /USER/],
    ["BEGIN EXECUTE IMMEDIATE 'GRANT DBA TO WS_1'; END;", /GRANT/],
    ['REVOKE SELECT ON t FROM x', /REVOKE/],
    ['create database link l connect to a identified by b using \'x\'', /DATABASE LINK/],
    ["BEGIN dbms_scheduler.create_job('j'); END;", /DBMS_SCHEDULER/],
    ["BEGIN DBMS_JOB.SUBMIT(:j, 'x'); END;", /DBMS_JOB/],
    ["SELECT utl_http.request('http://x') FROM dual", /UTL_/],
    ["BEGIN DBMS_PIPE.PURGE('p'); END;", /DBMS_PIPE/],
    ["CREATE DIRECTORY d AS '/tmp'", /DIRECTORY/],
    ['', /empty/i],
  ])('blocks %s', (sql, reason) => {
    const r = classifySql(sql);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it('allows every statement in the pattern files', () => {
    const root = path.resolve(import.meta.dirname, '../../../patterns');
    for (const dir of fs.readdirSync(root)) {
      for (const f of ['01-document-model.sql', '02-converged.sql']) {
        const p = path.join(root, dir, f);
        if (!fs.existsSync(p)) continue;
        for (const st of parseSqlFile(fs.readFileSync(p, 'utf8'))) expect(classifySql(st.sql), `${p}:${st.line}`).toEqual({ allowed: true });
      }
    }
  });
});

describe('classifyMongo', () => {
  it('checks $sql stages with the SQL rules', () => {
    expect(classifyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: 'select 1 from dual' }]], mods: {} })).toEqual({ allowed: true });
    const r = classifyMongo({ kind: 'db', op: 'aggregate', args: [[{ $sql: "begin execute immediate 'grant dba to x'; end;" }]], mods: {} });
    expect(r.allowed).toBe(false);
  });
  it('allows ordinary collection commands', () => {
    expect(classifyMongo({ kind: 'collection', collection: 'c', op: 'find', args: [{}], mods: {} })).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/guard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `guard.js`**

```js
// app/src/guard.js
// Defence in depth only: the isolation boundary is each attendee's schema privileges.
const RULES = [
  [/\bALTER SYSTEM\b/, 'ALTER SYSTEM'],
  [/\bALTER DATABASE\b/, 'ALTER DATABASE'],
  [/\b(CREATE|ALTER|DROP) USER\b/, 'CREATE/ALTER/DROP USER'],
  [/\bGRANT\b/, 'GRANT'],
  [/\bREVOKE\b/, 'REVOKE'],
  [/\bDATABASE LINK\b/, 'DATABASE LINK'],
  [/\bDBMS_SCHEDULER\b/, 'DBMS_SCHEDULER'],
  [/\bDBMS_JOB\b/, 'DBMS_JOB'],
  [/\bUTL_[A-Z_]+/, 'UTL_* packages'],
  [/\bDBMS_PIPE\b/, 'DBMS_PIPE'],
  [/\bCREATE (OR REPLACE )?DIRECTORY\b/, 'CREATE DIRECTORY'],
];

export function normalizeForGuard(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifySql(text) {
  const n = normalizeForGuard(text);
  if (!n) return { allowed: false, reason: 'Empty statement' };
  for (const [re, label] of RULES) if (re.test(n)) return { allowed: false, reason: `Blocked in this lab: ${label}` };
  return { allowed: true };
}

function sqlStages(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => sqlStages(v, out));
  else if (value && typeof value === 'object' && !(value instanceof RegExp) && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$sql' && typeof v === 'string') out.push(v);
      else sqlStages(v, out);
    }
  }
  return out;
}

export function classifyMongo(cmd) {
  for (const sql of sqlStages(cmd.args ?? [])) {
    const r = classifySql(sql);
    if (!r.allowed) return r;
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run test/unit/guard.test.js`
Expected: all passed. If the pattern-file test fails, a pattern statement contains a blocked word — report it; do not weaken a rule without review.

- [ ] **Step 5: Commit**

```bash
git add app/src/guard.js app/test/unit/guard.test.js
git commit -m "feat(lab-ui): statement guard for SQL and \$sql stages"
```

---

### Task 5: The gate — FIFO weighted semaphore

**Files:**
- Create: `app/src/gate.js`
- Test: `app/test/unit/gate.test.js`

**Interfaces:**
- Produces:
  - `class GateError extends Error { code: 'busy'|'paused'|'already_queued', status: 429|423|409 }`
  - `class Gate({ permits = 1, queueTimeoutMs = 30000 })` with
    - `run(who: { userId: string, label: string, exclusive?: boolean }, fn: (ctx: { cancel?: () => void }) => Promise<T>) → Promise<T>` — `fn` receives a `ctx`; the runner sets `ctx.cancel` to abort the in-flight call.
    - `position(userId) → number|null` — requests ahead of this user's queued request (0 = next), `null` if not queued.
    - `status() → { permits, free, paused, queued: Array<{userId,label,waitingMs}>, running: Array<{id,userId,label,elapsedMs}> }`
    - `pause(on: boolean)` — on: rejects queued and new requests with `paused`.
    - `cancel(id) → boolean` — calls the running entry's `ctx.cancel`.

Strict FIFO: only the head of the queue may start; an exclusive request at the head blocks everything behind it until all permits are free.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/gate.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Gate, GateError } from '../../src/gate.js';

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => vi.useRealTimers());

describe('Gate', () => {
  it('runs one operation at a time with one permit', async () => {
    const g = new Gate({ permits: 1 });
    let active = 0; let max = 0;
    const d = [deferred(), deferred(), deferred()];
    const ps = d.map((x, i) => g.run({ userId: `u${i}`, label: 'q' }, async () => { active++; max = Math.max(max, active); await x.p; active--; return i; }));
    await tick();
    expect(active).toBe(1);
    d.forEach((x) => x.resolve());
    expect(await Promise.all(ps)).toEqual([0, 1, 2]);
    expect(max).toBe(1);
  });

  it('is first-in first-out across users', async () => {
    const g = new Gate({ permits: 1 });
    const order = [];
    const hold = deferred();
    const first = g.run({ userId: 'a', label: 'q' }, async () => { await hold.p; order.push('a'); });
    const rest = ['b', 'c', 'd'].map((u) => g.run({ userId: u, label: 'q' }, async () => { order.push(u); }));
    hold.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('makes an exclusive request wait for every permit and blocks later requests', async () => {
    const g = new Gate({ permits: 2 });
    const order = []; const holdA = deferred();
    const a = g.run({ userId: 'a', label: 'n' }, async () => { order.push('a+'); await holdA.p; order.push('a-'); });
    const x = g.run({ userId: 'x', label: 'm', exclusive: true }, async () => { order.push('x'); });
    const b = g.run({ userId: 'b', label: 'n' }, async () => { order.push('b'); });
    await tick();
    expect(order).toEqual(['a+']);
    holdA.resolve();
    await Promise.all([a, x, b]);
    expect(order).toEqual(['a+', 'a-', 'x', 'b']);
  });

  it('allows only one queued request per user', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    const running = g.run({ userId: 'u1', label: 'q' }, () => hold.p);
    const queued = g.run({ userId: 'u2', label: 'q' }, async () => 'ok');
    await expect(g.run({ userId: 'u2', label: 'q' }, async () => 'dup')).rejects.toMatchObject({ code: 'already_queued', status: 409 });
    const u1Again = g.run({ userId: 'u1', label: 'q' }, async () => 'u1-second'); // u1 is running, not queued
    hold.resolve();
    expect(await queued).toBe('ok');
    expect(await u1Again).toBe('u1-second');
    await running;
  });

  it('rejects with busy after the queue timeout', async () => {
    vi.useFakeTimers();
    const g = new Gate({ permits: 1, queueTimeoutMs: 30000 });
    g.run({ userId: 'a', label: 'q' }, () => new Promise(() => {}));
    const waiting = g.run({ userId: 'b', label: 'q' }, async () => 'never');
    vi.advanceTimersByTime(30000);
    await expect(waiting).rejects.toMatchObject({ code: 'busy', status: 429 });
    expect(g.status().queued).toHaveLength(0);
  });

  it('pause rejects queued and new requests; resume accepts again', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    const running = g.run({ userId: 'a', label: 'q' }, () => hold.p);
    const queued = g.run({ userId: 'b', label: 'q' }, async () => 1);
    g.pause(true);
    await expect(queued).rejects.toMatchObject({ code: 'paused', status: 423 });
    await expect(g.run({ userId: 'c', label: 'q' }, async () => 1)).rejects.toBeInstanceOf(GateError);
    g.pause(false);
    hold.resolve(); await running;
    expect(await g.run({ userId: 'c', label: 'q' }, async () => 2)).toBe(2);
  });

  it('reports queue position', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    g.run({ userId: 'a', label: 'q' }, () => hold.p);
    g.run({ userId: 'b', label: 'q' }, async () => 1);
    g.run({ userId: 'c', label: 'q' }, async () => 1);
    await tick();
    expect(g.position('b')).toBe(0);
    expect(g.position('c')).toBe(1);
    expect(g.position('a')).toBe(null);
    hold.resolve();
  });

  it('releases the permit when the operation throws', async () => {
    const g = new Gate({ permits: 1 });
    await expect(g.run({ userId: 'a', label: 'q' }, async () => { throw new Error('ORA-00942'); })).rejects.toThrow('ORA-00942');
    expect(await g.run({ userId: 'b', label: 'q' }, async () => 'next')).toBe('next');
  });

  it('cancel calls the running operation cancel hook', async () => {
    const g = new Gate({ permits: 1 });
    const cancel = vi.fn();
    const hold = deferred();
    const p = g.run({ userId: 'a', label: 'q' }, (ctx) => { ctx.cancel = () => { cancel(); hold.reject(new Error('cancelled')); }; return hold.p; });
    await tick();
    const [{ id }] = g.status().running;
    expect(g.cancel(id)).toBe(true);
    await expect(p).rejects.toThrow('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/gate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gate.js`**

```js
// app/src/gate.js
export class GateError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const busy = () => new GateError('busy', 429, 'busy, retry');
const paused = () => new GateError('paused', 423, 'paused by instructor');

export class Gate {
  #permits;
  #free;
  #queueTimeoutMs;
  #queue = [];
  #running = new Map();
  #paused = false;
  #seq = 0;

  constructor({ permits = 1, queueTimeoutMs = 30000 } = {}) {
    if (!Number.isInteger(permits) || permits < 1) throw new Error('permits must be >= 1');
    this.#permits = permits;
    this.#free = permits;
    this.#queueTimeoutMs = queueTimeoutMs;
  }

  run(who, fn) {
    if (this.#paused) return Promise.reject(paused());
    if (this.#queue.some((e) => e.userId === who.userId)) {
      return Promise.reject(new GateError('already_queued', 409, 'already queued — wait for your previous request'));
    }
    const weight = who.exclusive ? this.#permits : 1;
    return new Promise((resolve, reject) => {
      const entry = { id: ++this.#seq, userId: who.userId, label: who.label, weight, fn, resolve, reject, enqueuedAt: Date.now() };
      entry.timer = setTimeout(() => {
        const i = this.#queue.indexOf(entry);
        if (i !== -1) {
          this.#queue.splice(i, 1);
          reject(busy());
          this.#pump();
        }
      }, this.#queueTimeoutMs);
      this.#queue.push(entry);
      this.#pump();
    });
  }

  #pump() {
    while (this.#queue.length && this.#queue[0].weight <= this.#free) {
      const e = this.#queue.shift();
      clearTimeout(e.timer);
      this.#free -= e.weight;
      const ctx = {};
      this.#running.set(e.id, { id: e.id, userId: e.userId, label: e.label, startedAt: Date.now(), ctx });
      Promise.resolve()
        .then(() => e.fn(ctx))
        .then(e.resolve, e.reject)
        .finally(() => {
          this.#running.delete(e.id);
          this.#free += e.weight;
          this.#pump();
        });
    }
  }

  position(userId) {
    const i = this.#queue.findIndex((e) => e.userId === userId);
    return i === -1 ? null : i;
  }

  status() {
    const now = Date.now();
    return {
      permits: this.#permits,
      free: this.#free,
      paused: this.#paused,
      queued: this.#queue.map((e) => ({ userId: e.userId, label: e.label, waitingMs: now - e.enqueuedAt })),
      running: [...this.#running.values()].map((r) => ({ id: r.id, userId: r.userId, label: r.label, elapsedMs: now - r.startedAt })),
    };
  }

  pause(on) {
    this.#paused = Boolean(on);
    if (this.#paused) {
      for (const e of this.#queue.splice(0)) {
        clearTimeout(e.timer);
        e.reject(paused());
      }
    }
  }

  cancel(id) {
    const r = this.#running.get(id);
    if (!r || typeof r.ctx.cancel !== 'function') return false;
    r.ctx.cancel();
    return true;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run test/unit/gate.test.js`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/gate.js app/test/unit/gate.test.js
git commit -m "feat(lab-ui): FIFO weighted gate with queue timeout, pause and cancel"
```

---

### Task 6: Read-only cache and eligibility rules

**Files:**
- Create: `app/src/cache.js`
- Test: `app/test/unit/cache.test.js`

**Interfaces:**
- Consumes: `MongoCmd` (Task 3).
- Produces:
  - `normalizeSql(text) → string` (comments removed, whitespace collapsed, trailing `;` removed; case preserved)
  - `isReadOnlySql(statements: string[]) → boolean` — exactly one statement starting `SELECT`/`WITH`, no `FOR UPDATE`.
  - `isReadOnlyMongo(cmd: MongoCmd) → boolean` — `showCollections`; `find`/`findOne`/`countDocuments`; `aggregate` whose pipeline has no `$out`/`$merge` and whose `$sql` stages are all read-only SQL.
  - `PATTERN_PREFIXES = { xr: '01-extended-reference', cp: '02-computed', bk: '03-bucket', sb: '04-subset', tr: '05-tree-hierarchy', ol: '06-outlier' }`
  - `patternsTouched(text: string, allIds: string[]) → string[]` — pattern ids whose object prefix appears in the text; all ids when none does.
  - `class ResultCache({ maxEntries = 500 })`: `key(patternId, text, version) → string`, `get(key) → any|undefined` (refreshes recency), `set(key, value)`, `clear()`, `enabled` (get/set), `size`.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/cache.test.js
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
  it('maps statements to the patterns whose objects they touch', () => {
    expect(patternsTouched('UPDATE xr_advisors SET office = 1', ALL)).toEqual(['01-extended-reference']);
    expect(patternsTouched('insert into bk_readings select * from sb_claim_events', ALL).sort()).toEqual(['03-bucket', '04-subset']);
    expect(patternsTouched('create table scratch (a number)', ALL)).toEqual(ALL);
  });
});

describe('ResultCache', () => {
  it('keys on pattern, normalized text and dataset version', () => {
    const c = new ResultCache();
    expect(c.key('p', 'SELECT 1  FROM dual;', 'v1')).toBe(c.key('p', 'SELECT 1 FROM dual', 'v1'));
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/cache.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cache.js`**

```js
// app/src/cache.js
import crypto from 'node:crypto';

export function normalizeSql(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
    .trim();
}

export function isReadOnlySql(statements) {
  if (statements.length !== 1) return false;
  const n = normalizeSql(statements[0]);
  return /^(SELECT|WITH)\b/i.test(n) && !/\bFOR\s+UPDATE\b/i.test(n);
}

const MONGO_READ_OPS = new Set(['find', 'findOne', 'countDocuments']);

export function isReadOnlyMongo(cmd) {
  if (cmd.kind === 'showCollections') return true;
  if (MONGO_READ_OPS.has(cmd.op)) return true;
  if (cmd.op !== 'aggregate') return false;
  const pipeline = cmd.args[0] ?? [];
  return pipeline.every((stage) => {
    if ('$out' in stage || '$merge' in stage) return false;
    if (typeof stage.$sql === 'string') return isReadOnlySql([stage.$sql]);
    return true;
  });
}

export const PATTERN_PREFIXES = {
  xr: '01-extended-reference', cp: '02-computed', bk: '03-bucket', sb: '04-subset', tr: '05-tree-hierarchy', ol: '06-outlier',
};

export function patternsTouched(text, allIds) {
  const found = new Set();
  for (const m of String(text).matchAll(/\b(xr|cp|bk|sb|tr|ol)_\w+/gi)) {
    const id = PATTERN_PREFIXES[m[1].toLowerCase()];
    if (allIds.includes(id)) found.add(id);
  }
  return found.size ? [...found] : [...allIds];
}

export class ResultCache {
  #map = new Map();
  #max;
  enabled = true;

  constructor({ maxEntries = 500 } = {}) {
    this.#max = maxEntries;
  }

  key(patternId, text, version) {
    const h = crypto.createHash('sha256').update(normalizeSql(text)).digest('hex');
    return `${patternId}|${version}|${h}`;
  }

  get(key) {
    if (!this.enabled || !this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value);
  }

  clear() {
    this.#map.clear();
  }

  get size() {
    return this.#map.size;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run test/unit/cache.test.js`
Expected: all passed. Then confirm the object prefixes really are `xr_ cp_ bk_ sb_ tr_ ol_`:
`grep -ohE '\b(xr|cp|bk|sb|tr|ol)_[a-z_]+' ../patterns/*/*.sql | cut -d_ -f1 | sort | uniq -c` — six prefixes, one per pattern directory. If a pattern uses another prefix, add it to `PATTERN_PREFIXES` and to the test.

- [ ] **Step 5: Commit**

```bash
git add app/src/cache.js app/test/unit/cache.test.js
git commit -m "feat(lab-ui): read-only result cache and eligibility rules"
```

---
### Task 7: Pattern content — loader, README front matter, annotations

**Files:**
- Create: `app/src/content/patterns.js`
- Modify: `patterns/*/README.md` (prepend front matter), `patterns/*/01-document-model.sql`, `patterns/*/02-converged.sql`, `patterns/{01,02,03,06}-*/03-parity.js`, `patterns/03-bucket/02-sql-in-pipeline.js` (comments only)
- Test: `app/test/unit/patterns.test.js`

**Interfaces:**
- Consumes: `parseSqlFile`, `isSetup` (Task 2); `parseMongoScript` (Task 3).
- Produces: `loadPatterns(dir: string) → Pattern[]` (sorted by id) where

```
Pattern = {
  id: string,                                   // directory name, e.g. '01-extended-reference'
  meta: { title, industry, deck, problem, knobs: Array<{ name, setting, hot: boolean }> },
  lanes: { document: Stmt[], converged: Stmt[], mongo: MongoCard[] },   // cards: statements with a title
  setup: { document: Stmt[], converged: Stmt[] },                      // isSetup(stmt) === true, file order
  measures: Array<{ tag, document: Stmt, converged: Stmt }>,
  version: string,                              // sha256 of all setup SQL, first 16 hex chars
}
MongoCard = { title, notes, command, line }
```

Validation (throws `Error` naming the file): missing/invalid front matter; a `@measure` tag present on only one side; a measure statement that is not `UPDATE|INSERT|DELETE|MERGE` or PL/SQL, or contains `COMMIT` (measure runs in a rolled-back transaction); a pattern with no document or converged cards; a pattern with no measure pair.

- [ ] **Step 1: Write the failing tests**

```js
// app/test/unit/patterns.test.js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/patterns.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `patterns.js`**

```js
// app/src/content/patterns.js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { parseSqlFile, isSetup } from './sqlParser.js';
import { parseMongoScript } from './mongoScript.js';

function frontMatter(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: missing YAML front matter block`);
  const fm = YAML.parse(m[1]);
  for (const k of ['title', 'industry', 'deck', 'problem']) {
    if (!fm?.[k]) throw new Error(`${file}: front matter needs "${k}"`);
  }
  if (!Array.isArray(fm.knobs) || fm.knobs.length !== 3) throw new Error(`${file}: front matter needs exactly 3 knobs`);
  return {
    title: String(fm.title),
    industry: String(fm.industry),
    deck: String(fm.deck),
    problem: String(fm.problem).trim(),
    knobs: fm.knobs.map((k) => ({ name: String(k.name), setting: String(k.setting), hot: k.hot === true })),
  };
}

const readSql = (p) => (fs.existsSync(p) ? parseSqlFile(fs.readFileSync(p, 'utf8')) : []);

function checkMeasure(stmt, where) {
  const ok = stmt.plsql || /^(UPDATE|INSERT|DELETE|MERGE)\b/i.test(stmt.sql);
  if (!ok) throw new Error(`${where}: measure "${stmt.measure}" must be UPDATE/INSERT/DELETE/MERGE or PL/SQL`);
  if (/\bCOMMIT\b/i.test(stmt.sql)) throw new Error(`${where}: measure "${stmt.measure}" must not COMMIT (it runs in a rolled-back transaction)`);
}

function loadOne(root, id) {
  const dir = path.join(root, id);
  const meta = frontMatter(path.join(dir, 'README.md'));
  const docFile = path.join(dir, '01-document-model.sql');
  const convFile = path.join(dir, '02-converged.sql');
  const doc = readSql(docFile);
  const conv = readSql(convFile);
  const mongo = fs.readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .sort()
    .flatMap((n) => parseMongoScript(fs.readFileSync(path.join(dir, n), 'utf8'), path.join(dir, n)));

  const measures = [];
  const docTags = new Map(doc.filter((s) => s.measure).map((s) => [s.measure, s]));
  const convTags = new Map(conv.filter((s) => s.measure).map((s) => [s.measure, s]));
  for (const tag of new Set([...docTags.keys(), ...convTags.keys()])) {
    if (!docTags.has(tag) || !convTags.has(tag)) throw new Error(`${dir}: measure "${tag}" must appear in both 01-document-model.sql and 02-converged.sql`);
    checkMeasure(docTags.get(tag), docFile);
    checkMeasure(convTags.get(tag), convFile);
    measures.push({ tag, document: docTags.get(tag), converged: convTags.get(tag) });
  }

  const lanes = { document: doc.filter((s) => s.title), converged: conv.filter((s) => s.title), mongo };
  if (!lanes.document.length || !lanes.converged.length) throw new Error(`${dir}: needs at least one @step in each .sql file`);
  if (!measures.length) throw new Error(`${dir}: needs at least one @measure pair`);

  const setup = { document: doc.filter(isSetup), converged: conv.filter(isSetup) };
  const version = crypto.createHash('sha256')
    .update([...setup.document, ...setup.converged].map((s) => s.sql).join('\n;\n'))
    .digest('hex')
    .slice(0, 16);
  return { id, meta, lanes, setup, measures, version };
}

export function loadPatterns(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((id) => loadOne(root, id));
}
```

- [ ] **Step 4: Run the fixture tests**

Run: `cd app && npx vitest run test/unit/patterns.test.js -t fixtures`
Expected: the 4 fixture tests pass; the real-lab tests still fail (no front matter yet).

- [ ] **Step 5: Prepend front matter to the six pattern READMEs**

Insert each block at the very top of `patterns/<id>/README.md`; change nothing else in the README.

```yaml
# patterns/01-extended-reference/README.md
---
title: Extended Reference
industry: Wealth management
deck: "14–17"
problem: >-
  Four consumers render every client with their advisor, so the advisor card is embedded
  in every client and account document. Reads are instant — until an advisor moves offices
  and every embedded copy has to be found and rewritten.
knobs:
  - { name: Diversity, setting: "High — 4 consumers" }
  - { name: Read / write, setting: "Extreme read skew" }
  - { name: Update locality, setting: "Rare, fans out ×2,700", hot: true }
---
```

```yaml
# patterns/02-computed/README.md
---
title: Computed
industry: Telecom
deck: "18–21"
problem: >-
  Each subscriber document carries a running cycle-usage rollup so the app and real-time
  charging read one document — but every call record now rewrites that hot document.
knobs:
  - { name: Diversity, setting: "Medium-high — 4 consumers" }
  - { name: Read / write, setting: "Write-heavy on the rollup" }
  - { name: Update locality, setting: "Every write, one parent", hot: true }
---
```

```yaml
# patterns/03-bucket/README.md
---
title: Bucket
industry: Manufacturing / IoT
deck: "22–25"
problem: >-
  Sensor readings are bucketed per machine per hour. Every reading re-serializes the
  growing bucket, and hot sensors march it toward the 16 MB document cap.
knobs:
  - { name: Diversity, setting: "Medium — 4 read shapes" }
  - { name: Read / write, setting: "Write-heavy" }
  - { name: Update locality, setting: "Every write, same document", hot: true }
---
```

```yaml
# patterns/04-subset/README.md
---
title: Subset
industry: Insurance
deck: "26–29"
problem: >-
  The policy document keeps the ten most recent claim events inline. Every event becomes a
  push-sort-trim rewrite of the policy to maintain a list a query could simply read.
knobs:
  - { name: Diversity, setting: "High — 4 consumers" }
  - { name: Read / write, setting: "Read-heavy, ~67 : 1" }
  - { name: Update locality, setting: "Every event hits the parent", hot: true }
---
```

```yaml
# patterns/05-tree-hierarchy/README.md
---
title: Tree / Hierarchy
industry: Manufacturing bill of materials
deck: "30–33"
problem: >-
  Each part carries a materialized path. Re-parenting a subassembly rewrites every
  descendant, and "which products use this part?" cannot be answered from a path.
knobs:
  - { name: Diversity, setting: "High — 4 questions" }
  - { name: Read / write, setting: "Read-heavy" }
  - { name: Update locality, setting: "Lands on every descendant", hot: true }
---
```

```yaml
# patterns/06-outlier/README.md
---
title: Outlier
industry: Financial services (brokerage)
deck: "34–37"
problem: >-
  Advisor documents embed their client book. Institutional books break the 16 MB cap, so
  the Outlier pattern adds overflow documents and a second code path in the application.
knobs:
  - { name: Diversity, setting: "Low — one book screen" }
  - { name: Read / write, setting: "Read-heavy by day" }
  - { name: Update locality, setting: "Skew ×800, p50 → max", hot: true }
---
```

(The `# patterns/…` line above each block is a label for this plan — do not paste it.)

- [ ] **Step 6: Annotate the SQL and mongosh files (comments only)**

For each pattern, read `01-document-model.sql` and `02-converged.sql` top to bottom and add comment lines immediately above statements. Rules:

1. Leave every drop/create/seed statement that builds the starting state **untagged** — untagged statements are the pattern's Setup and are what reset runs.
2. Tag each statement an attendee should run or read in the lecture with `-- @step <imperative title>` and one or two `-- @note <one sentence>` lines explaining what to notice. Aim for 2–5 steps per file. A `@step` statement must only depend on setup or on earlier `@step`s in the same file (attendees run them in order after a reset), and no untagged statement may depend on a `@step` statement (reset runs the untagged statements alone). Task 10's integration test enforces both.
3. Tag the write that shows the pattern's cost in `01-document-model.sql`, and its converged counterpart in `02-converged.sql`, with the same `-- @measure <tag>` (together with its `@step`). A measured statement must be a single `UPDATE/INSERT/DELETE/MERGE` or a PL/SQL block with **no `COMMIT`**. A separate `COMMIT;` statement that follows it can stay untagged: running it during setup is harmless, and attendee steps run with auto-commit.
4. Do not change any statement text, order or whitespace inside statements.

Measure pairs (tag names are fixed; pick the statements that implement these writes):

| Pattern | Tag | Document-model side | Converged side |
|---|---|---|---|
| 01 | `advisor-move` | `JSON_TRANSFORM` rewriting the advisor block in every client document of one advisor | `UPDATE xr_advisors SET office = …` |
| 02 | `record-cdr` | the update that bumps the rollup inside the subscriber document | the `INSERT` of one CDR row (the trigger maintains the summary) |
| 03 | `ingest-reading` | the `JSON_TRANSFORM … APPEND` into the hour bucket | the `INSERT` of one reading row |
| 04 | `claim-event` | the push-sort-trim update of the policy document | the `INSERT` of one claim-event row |
| 05 | `reparent` | the update that rewrites the path of every descendant | the single edge `UPDATE` |
| 06 | `add-client` | the update that appends a client into the advisor's embedded book | the `INSERT` of one client row |

If a side's write only exists inside a larger PL/SQL block that also commits, stop and report it — do not restructure pattern SQL in this task.

MongoDB cards: in `01-extended-reference/03-parity.js`, `02-computed/03-parity.js`, `06-outlier/03-parity.js` put `// @step Read the projected document over the MongoDB API` (plus a `// @note`) above the top-level `const … = db.<view>.findOne(...)`; in `03-bucket/02-sql-in-pipeline.js` put `// @step Hourly rollup with $sql in the pipeline` above `const rows = db.aggregate([...])`. Only top-level `db.*` statements can carry `// @step`.

- [ ] **Step 7: Run all unit tests, then the lab**

Run: `cd app && npx vitest run test/unit`
Expected: all passed (including the real-file tests from Tasks 2–4 and 7).

Run: `cd .. && ./run.sh`
Expected: `RESULT: 18 passed, 0 failed` — annotations are comments, so nothing changes for sqlplus/mongosh.

- [ ] **Step 8: Commit**

```bash
git add app/src/content/patterns.js app/test/unit/patterns.test.js patterns/
git commit -m "feat(lab-ui): pattern loader; README front matter and @step/@measure annotations"
```

---
### Task 8: Oracle layer — bootstrap, pools, executor, statistics

**Files:**
- Create: `app/sql/bootstrap.sql`, `app/src/db/oracle.js`, `app/test/integration/env.js`
- Test: `app/test/integration/oracle.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `parseSqlFile` (Task 2).
- Produces:
  - `bootstrap(cfg) → Promise<void>` — connects once as `SYS AS SYSDBA` (thin mode) and runs `sql/bootstrap.sql` (idempotent), binding `:pw` to `cfg.db.labAdminPassword`.
  - `createPools(cfg) → Promise<{ exec: oracledb.Pool, control: oracledb.Pool, close(): Promise<void> }>` — `exec` is heterogeneous (`homogeneous: false`, `poolMax: cfg.db.poolMax`), `control` is `LAB_ADMIN`, `poolMax: 1`.
  - `executeSql(conn, sql, { timeoutMs, maxRows, maxBytes, autoCommit = true }) → Promise<SqlResult>` where
    `SqlResult = { kind: 'rows', columns: string[], rows: object[], rowCount: number, truncated: boolean, elapsedMs } | { kind: 'dml', rowsAffected, elapsedMs } | { kind: 'ok', elapsedMs } | { kind: 'error', error: string, code: string|null, elapsedMs }`. Oracle errors are returned, never thrown.
  - `readStats(conn) → Promise<Record<string, number>>` for `redo size`, `db block changes`, `session logical reads`, `CPU used by this session`.
  - `STAT_NAMES` (array of those four names).
- Integration test helper `testConfig(overrides?)` in `test/integration/env.js`.

Integration tests need the database running. From the repo root: `docker compose up -d oracle` and wait for healthy (or run `./run.sh` once). Then run tests from `app/` with the host-mapped ports (`env.js` defaults: `DB_HOST=localhost`, `DB_PORT=1522`, `MONGO_PORT=27018`). Inside the compose test profile (Task 14) they use `oracle:1521/27017`.

- [ ] **Step 1: Write the bootstrap SQL**

```sql
-- app/sql/bootstrap.sql
-- Idempotent. Run once at lab-ui start-up as SYS AS SYSDBA connected to FREEPDB1.
-- Creates LAB_ADMIN (least privilege for provisioning attendee workspaces), the control
-- tables, and the V$ grants measure-it needs. :pw is bound to LAB_ADMIN_PASSWORD.
DECLARE
  PROCEDURE x(p_sql VARCHAR2, p_ok1 PLS_INTEGER DEFAULT 0, p_ok2 PLS_INTEGER DEFAULT 0) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLCODE NOT IN (p_ok1, p_ok2) THEN RAISE; END IF;
  END;
BEGIN
  x('CREATE USER lab_admin IDENTIFIED BY "' || :pw || '" QUOTA 100M ON users', -1920);
  x('ALTER USER lab_admin IDENTIFIED BY "' || :pw || '"');
  x('GRANT CREATE SESSION, CREATE TABLE TO lab_admin');
  x('GRANT CREATE USER, ALTER USER, DROP USER TO lab_admin');
  x('GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE, '
    || 'CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH TO lab_admin WITH ADMIN OPTION');
  x('GRANT SODA_APP TO lab_admin WITH ADMIN OPTION');
  x('GRANT SELECT ON sys.v_$mystat TO lab_admin WITH GRANT OPTION');
  x('GRANT SELECT ON sys.v_$statname TO lab_admin WITH GRANT OPTION');
  x('GRANT SELECT ON sys.v_$session TO lab_admin');
  x('GRANT SELECT ON sys.v_$mystat TO cmp_user');
  x('GRANT SELECT ON sys.v_$statname TO cmp_user');
  x('GRANT ORDS_ADMINISTRATOR_ROLE TO lab_admin', -1919);  -- role exists once ORDS is installed
  x('CREATE TABLE lab_admin.lab_users (schema_name VARCHAR2(30) PRIMARY KEY, schema_password VARCHAR2(64) NOT NULL, '
    || 'email VARCHAR2(320) UNIQUE, display_name VARCHAR2(200), created_at TIMESTAMP DEFAULT SYSTIMESTAMP, assigned_at TIMESTAMP)', -955);
  x('CREATE TABLE lab_admin.lab_dirty (schema_name VARCHAR2(30), pattern_id VARCHAR2(64), '
    || 'CONSTRAINT lab_dirty_pk PRIMARY KEY (schema_name, pattern_id))', -955);
  x('CREATE TABLE lab_admin.lab_built (schema_name VARCHAR2(30), pattern_id VARCHAR2(64), version VARCHAR2(16) NOT NULL, '
    || 'CONSTRAINT lab_built_pk PRIMARY KEY (schema_name, pattern_id))', -955);
  x('CREATE TABLE lab_admin.lab_settings (k VARCHAR2(64) PRIMARY KEY, v VARCHAR2(4000))', -955);
END;
/
```

- [ ] **Step 2: Write the test environment helper**

```js
// app/test/integration/env.js
import { loadConfig } from '../../src/config.js';

export function testConfig(overrides = {}) {
  return loadConfig({
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: process.env.DB_PORT ?? '1522',
    MONGO_HOST: process.env.MONGO_HOST ?? process.env.DB_HOST ?? 'localhost',
    MONGO_PORT: process.env.MONGO_PORT ?? '27018',
    ORACLE_PASSWORD: process.env.ORACLE_PASSWORD ?? 'Sandbox2026',
    CMP_PASSWORD: process.env.CMP_PASSWORD ?? 'CmpUser2026',
    ...overrides,
  });
}
```

- [ ] **Step 3: Write the failing integration tests**

```js
// app/test/integration/oracle.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql, readStats, STAT_NAMES } from '../../src/db/oracle.js';

const cfg = testConfig();
const opts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
let pools; let conn;

beforeAll(async () => {
  await bootstrap(cfg);
  await bootstrap(cfg); // idempotent
  pools = await createPools(cfg);
  conn = await pools.exec.getConnection({ user: cfg.db.cmpUser, password: cfg.db.cmpPassword });
  await executeSql(conn, 'DROP TABLE lab_it_t PURGE', opts);
  await executeSql(conn, 'CREATE TABLE lab_it_t (id NUMBER PRIMARY KEY, v VARCHAR2(20))', opts);
});
afterAll(async () => {
  await executeSql(conn, 'DROP TABLE lab_it_t PURGE', opts);
  await conn?.close();
  await pools?.close();
});

describe('oracle layer', () => {
  it('returns rows with column names', async () => {
    const r = await executeSql(conn, "SELECT 1 AS n, 'a' AS s FROM dual", opts);
    expect(r).toMatchObject({ kind: 'rows', columns: ['N', 'S'], rows: [{ N: 1, S: 'a' }], rowCount: 1, truncated: false });
  });
  it('returns rowsAffected for DML', async () => {
    expect(await executeSql(conn, "INSERT INTO lab_it_t VALUES (1, 'x')", opts)).toMatchObject({ kind: 'dml', rowsAffected: 1 });
  });
  it('returns ok for DDL and PL/SQL', async () => {
    expect(await executeSql(conn, 'BEGIN NULL; END;', opts)).toMatchObject({ kind: 'ok' });
  });
  it('returns Oracle errors with their code instead of throwing', async () => {
    const r = await executeSql(conn, 'SELECT * FROM no_such_table_xyz', opts);
    expect(r).toMatchObject({ kind: 'error', code: 'ORA-00942' });
    expect(r.error).toMatch(/ORA-00942/);
  });
  it('caps rows at maxRows and flags truncation', async () => {
    const r = await executeSql(conn, 'SELECT level AS n FROM dual CONNECT BY level <= 600', opts);
    expect(r.rowCount).toBe(500);
    expect(r.truncated).toBe(true);
  });
  it('caps results at maxBytes and flags truncation', async () => {
    const r = await executeSql(conn, "SELECT RPAD('x', 4000, 'x') AS s FROM dual CONNECT BY level <= 400", opts);
    expect(JSON.stringify(r.rows).length).toBeLessThanOrEqual(1048576);
    expect(r.truncated).toBe(true);
  });
  it('times out a long call', async () => {
    const r = await executeSql(conn, 'BEGIN DBMS_SESSION.SLEEP(5); END;', { ...opts, timeoutMs: 500 });
    expect(r.kind).toBe('error');
  });
  it('reads session statistics that grow with a write', async () => {
    const before = await readStats(conn);
    expect(Object.keys(before).sort()).toEqual([...STAT_NAMES].sort());
    await executeSql(conn, "UPDATE lab_it_t SET v = 'y' WHERE id = 1", { ...opts, autoCommit: false });
    const after = await readStats(conn);
    await conn.rollback();
    expect(after['redo size']).toBeGreaterThan(before['redo size']);
    expect(after['db block changes']).toBeGreaterThan(before['db block changes']);
  });
  it('control pool connects as LAB_ADMIN', async () => {
    const c = await pools.control.getConnection();
    const r = await executeSql(c, 'SELECT USER AS u FROM dual', opts);
    await c.close();
    expect(r.rows[0].U).toBe('LAB_ADMIN');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run (DB up): `cd app && npx vitest run test/integration/oracle.test.js`
Expected: FAIL — `Cannot find module '../../src/db/oracle.js'`.

- [ ] **Step 5: Implement `oracle.js`**

```js
// app/src/db/oracle.js
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import oracledb from 'oracledb';
import { parseSqlFile } from '../content/sqlParser.js';

oracledb.fetchAsString = [oracledb.CLOB];

const BOOTSTRAP = path.resolve(import.meta.dirname, '../../sql/bootstrap.sql');
export const STAT_NAMES = ['redo size', 'db block changes', 'session logical reads', 'CPU used by this session'];

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

export async function createPools(cfg) {
  const exec = await oracledb.createPool({
    connectString: connectString(cfg), homogeneous: false, poolMin: 0, poolMax: cfg.db.poolMax, poolIncrement: 1,
    queueTimeout: cfg.gate.queueTimeoutMs,
  });
  const control = await oracledb.createPool({
    user: 'lab_admin', password: cfg.db.labAdminPassword, connectString: connectString(cfg),
    poolMin: 0, poolMax: 1, poolIncrement: 1, queueTimeout: 60000,
  });
  return { exec, control, close: async () => { await exec.close(5); await control.close(5); } };
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

export async function readStats(conn) {
  const r = await conn.execute(
    `SELECT n.name, m.value FROM v$mystat m JOIN v$statname n ON n.statistic# = m.statistic#
      WHERE n.name IN (${STAT_NAMES.map((_, i) => `:n${i}`).join(', ')})`,
    Object.fromEntries(STAT_NAMES.map((n, i) => [`n${i}`, n])),
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return Object.fromEntries(r.rows.map((x) => [x.NAME, Number(x.VALUE)]));
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd app && npx vitest run test/integration/oracle.test.js`
Expected: 9 passed. If the `SYSDBA` connect fails with `NJS-116`/`NJS-138`, record the exact message: thin mode in the installed oracledb version must support privileged connections — do not switch to thick mode without review.

- [ ] **Step 7: Commit**

```bash
git add app/sql/bootstrap.sql app/src/db/oracle.js app/test/integration/env.js app/test/integration/oracle.test.js
git commit -m "feat(lab-ui): Oracle bootstrap, pools, bounded executor and session stats"
```

---

### Task 9: MongoDB layer

**Files:**
- Create: `app/src/db/mongo.js`
- Test: `app/test/integration/mongo.test.js`

**Interfaces:**
- Consumes: `MongoCmd` (Task 3); `executeSql`, `createPools` (Task 8) for fixtures.
- Produces:
  - `mongoUri({ host, port, user, password }) → string` — same shape `run.sh` uses: `mongodb://USER:PW@host:port/USER?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true` (user and password URI-encoded; database = upper-case schema name).
  - `class MongoPool(cfg)`: `client(user, password) → MongoClient` (cached per user, `maxPoolSize: cfg.mongo.poolMax`, closed after 5 idle minutes), `drop(user) → Promise<void>` (close and forget one client), `closeAll() → Promise<void>`.
  - `runMongo(client, dbName, cmd, { timeoutMs, maxRows, maxBytes }) → Promise<MongoResult>` where
    `MongoResult = { kind: 'docs', docs: object[], count, truncated, elapsedMs } | { kind: 'count', count, elapsedMs } | { kind: 'write', result: object, elapsedMs } | { kind: 'collections', names: string[], elapsedMs } | { kind: 'error', error, code, elapsedMs }`. Documents are converted with relaxed EJSON; errors are returned, never thrown.

- [ ] **Step 1: Write the failing integration tests**

```js
// app/test/integration/mongo.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql } from '../../src/db/oracle.js';
import { MongoPool, runMongo, mongoUri } from '../../src/db/mongo.js';
import { parseMongoCommand } from '../../src/content/mongoCommand.js';

const cfg = testConfig();
const sqlOpts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
const mOpts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
let pools; let conn; let mongo; let client;
const run = (text) => runMongo(client, 'CMP_USER', parseMongoCommand(text), mOpts);

beforeAll(async () => {
  await bootstrap(cfg);
  pools = await createPools(cfg);
  conn = await pools.exec.getConnection({ user: cfg.db.cmpUser, password: cfg.db.cmpPassword });
  await executeSql(conn, 'DROP TABLE lab_it_docs PURGE', sqlOpts);
  await executeSql(conn, 'CREATE JSON COLLECTION TABLE lab_it_docs', sqlOpts);
  mongo = new MongoPool(cfg);
  client = mongo.client(cfg.db.cmpUser, cfg.db.cmpPassword);
});
afterAll(async () => {
  await mongo?.closeAll();
  await executeSql(conn, 'DROP TABLE lab_it_docs PURGE', sqlOpts);
  await conn?.close();
  await pools?.close();
});

describe('mongo layer', () => {
  it('builds the same URI shape run.sh uses', () => {
    expect(mongoUri({ host: 'oracle', port: 27017, user: 'WS_ABC', password: 'p@ss' }))
      .toBe('mongodb://WS_ABC:p%40ss@oracle:27017/WS_ABC?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true');
  });
  it('inserts, finds and counts', async () => {
    expect(await run('db.lab_it_docs.insertMany([{_id:"a", n:1},{_id:"b", n:2},{_id:"c", n:3}])')).toMatchObject({ kind: 'write' });
    const r = await run('db.lab_it_docs.find({n:{$gte:2}}).sort({n:-1})');
    expect(r.kind).toBe('docs');
    expect(r.docs.map((d) => d._id)).toEqual(['c', 'b']);
    expect(await run('db.lab_it_docs.countDocuments({})')).toMatchObject({ kind: 'count', count: 3 });
  });
  it('updates and reads back with findOne', async () => {
    await run('db.lab_it_docs.updateOne({_id:"a"}, {$set:{n:10}})');
    const r = await run('db.lab_it_docs.findOne({_id:"a"})');
    expect(r.docs[0].n).toBe(10);
  });
  it('runs $sql in an aggregation pipeline over the wire', async () => {
    const r = await run('db.aggregate([{ $sql: `select 1 as "one" from dual` }])');
    expect(r.kind).toBe('docs');
    expect(r.docs[0].one).toBe(1);
  });
  it('lists collections', async () => {
    const r = await run('show collections');
    expect(r.kind).toBe('collections');
    expect(r.names.map((n) => n.toLowerCase())).toContain('lab_it_docs');
  });
  it('returns errors instead of throwing', async () => {
    const r = await run('db.aggregate([{ $sql: `select * from no_such_table_xyz` }])');
    expect(r.kind).toBe('error');
    expect(r.error).toBeTruthy();
  });
  it('caps documents at maxRows', async () => {
    const r = await runMongo(client, 'CMP_USER', parseMongoCommand('db.lab_it_docs.find({})'), { ...mOpts, maxRows: 2 });
    expect(r.docs).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/integration/mongo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mongo.js`**

```js
// app/src/db/mongo.js
import { performance } from 'node:perf_hooks';
import { MongoClient, BSON } from 'mongodb';

const IDLE_MS = 5 * 60 * 1000;

export function mongoUri({ host, port, user, password }) {
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `mongodb://${u}:${p}@${host}:${port}/${user.toUpperCase()}?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true`;
}

export class MongoPool {
  #cfg;
  #clients = new Map();

  constructor(cfg) {
    this.#cfg = cfg;
  }

  client(user, password) {
    const key = user.toUpperCase();
    let e = this.#clients.get(key);
    if (!e) {
      const c = new MongoClient(mongoUri({ host: this.#cfg.mongo.host, port: this.#cfg.mongo.port, user: key, password }), {
        maxPoolSize: this.#cfg.mongo.poolMax,
      });
      e = { client: c, timer: null };
      this.#clients.set(key, e);
    }
    clearTimeout(e.timer);
    e.timer = setTimeout(() => this.drop(key), IDLE_MS);
    e.timer.unref?.();
    return e.client;
  }

  async drop(user) {
    const key = user.toUpperCase();
    const e = this.#clients.get(key);
    if (!e) return;
    this.#clients.delete(key);
    clearTimeout(e.timer);
    await e.client.close(true).catch(() => {});
  }

  async closeAll() {
    await Promise.all([...this.#clients.keys()].map((k) => this.drop(k)));
  }
}

const toJson = (doc) => BSON.EJSON.serialize(doc, { relaxed: true });

async function take(cursor, maxRows, maxBytes) {
  const docs = [];
  let truncated = false;
  for await (const d of cursor) {
    if (docs.length === maxRows) { truncated = true; break; }
    docs.push(toJson(d));
  }
  await cursor.close();
  while (docs.length && JSON.stringify(docs).length > maxBytes) {
    docs.splice(Math.floor(docs.length * 0.8));
    truncated = true;
  }
  return { docs, truncated };
}

export async function runMongo(client, dbName, cmd, { timeoutMs, maxRows, maxBytes }) {
  const start = performance.now();
  const elapsedMs = () => Math.round(performance.now() - start);
  const db = client.db(dbName);
  const o = { maxTimeMS: timeoutMs };
  try {
    if (cmd.kind === 'showCollections') {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
      return { kind: 'collections', names, elapsedMs: elapsedMs() };
    }
    if (cmd.kind === 'db') {
      const { docs, truncated } = await take(db.aggregate(cmd.args[0] ?? [], { ...o, ...(cmd.args[1] ?? {}) }), maxRows, maxBytes);
      return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
    }
    const coll = db.collection(cmd.collection);
    const [a0 = {}, a1, a2] = cmd.args;
    switch (cmd.op) {
      case 'find': {
        let cur = coll.find(a0, { ...o, ...(a1 ? { projection: a1 } : {}) });
        if (cmd.mods.sort) cur = cur.sort(cmd.mods.sort);
        if (cmd.mods.skip) cur = cur.skip(cmd.mods.skip);
        cur = cur.limit(Math.min(cmd.mods.limit ?? maxRows + 1, maxRows + 1));
        const { docs, truncated } = await take(cur, maxRows, maxBytes);
        return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
      }
      case 'findOne': {
        const d = await coll.findOne(a0, { ...o, ...(a1 ? { projection: a1 } : {}) });
        return { kind: 'docs', docs: d ? [toJson(d)] : [], count: d ? 1 : 0, truncated: false, elapsedMs: elapsedMs() };
      }
      case 'aggregate': {
        const { docs, truncated } = await take(coll.aggregate(a0, { ...o, ...(a1 ?? {}) }), maxRows, maxBytes);
        return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
      }
      case 'countDocuments':
        return { kind: 'count', count: await coll.countDocuments(a0, o), elapsedMs: elapsedMs() };
      case 'insertOne': return { kind: 'write', result: toJson(await coll.insertOne(a0, o)), elapsedMs: elapsedMs() };
      case 'insertMany': return { kind: 'write', result: toJson(await coll.insertMany(a0, o)), elapsedMs: elapsedMs() };
      case 'updateOne': return { kind: 'write', result: toJson(await coll.updateOne(a0, a1, { ...o, ...(a2 ?? {}) })), elapsedMs: elapsedMs() };
      case 'updateMany': return { kind: 'write', result: toJson(await coll.updateMany(a0, a1, { ...o, ...(a2 ?? {}) })), elapsedMs: elapsedMs() };
      case 'deleteOne': return { kind: 'write', result: toJson(await coll.deleteOne(a0, o)), elapsedMs: elapsedMs() };
      case 'deleteMany': return { kind: 'write', result: toJson(await coll.deleteMany(a0, o)), elapsedMs: elapsedMs() };
      default: return { kind: 'error', error: `unsupported operation ${cmd.op}`, code: null, elapsedMs: elapsedMs() };
    }
  } catch (err) {
    return { kind: 'error', error: err.message, code: err.code ?? err.codeName ?? null, elapsedMs: elapsedMs() };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && npx vitest run test/integration/mongo.test.js`
Expected: 7 passed. If `show collections` returns names in upper case, the `toLowerCase()` in the test already covers it; if `$sql` returns the column as `ONE`, change the SQL alias quoting, not the assertion (the alias is quoted, so lower case is expected).

- [ ] **Step 5: Commit**

```bash
git add app/src/db/mongo.js app/test/integration/mongo.test.js
git commit -m "feat(lab-ui): MongoDB API layer with bounded results"
```

---
### Task 10: Runner — run, measure, reset, lazy build, cache and dirty flags

**Files:**
- Create: `app/src/services/workspaces.js`, `app/src/services/runner.js`
- Test: `app/test/integration/runner.test.js`

**Interfaces:**
- Consumes: `Gate` (Task 5); `ResultCache`, `isReadOnlySql`, `isReadOnlyMongo`, `patternsTouched` (Task 6); `classifySql`, `classifyMongo` (Task 4); `splitConsoleSql` (Task 2); `parseMongoCommand`, `MongoParseError` (Task 3); `loadPatterns` → `Pattern` (Task 7); `createPools`, `executeSql`, `readStats` (Task 8); `MongoPool`, `runMongo` (Task 9).
- Produces:
  - `class Workspaces({ cfg, pools })`: `load()`, `solo() → Workspace`, `isDirty(schema, patternId) → boolean`, `markDirty(schema, patternIds[])`, `clearDirty(schema, patternId)`, `builtVersion(schema, patternId) → string|null`, `markBuilt(schema, patternId, version)`. `Workspace = { userId: string, schema: string, password: string }`. Dirty/built flags are written to `lab_dirty`/`lab_built` **before** memory is updated and are reloaded by `load()`, so they survive an app restart.
  - `class Runner({ cfg, gate, cache, pools, mongo, workspaces, patterns })`:
    - `timeouts: { sqlMs: number, mongoMs: number }` — public, initialised from `cfg.gate`; the admin API may change it at runtime.
    - `runSql({ user, patternId, text }) → Promise<{ lane: 'sql', results: Array<SqlResult>, cached: boolean }>`
    - `runMongoText({ user, patternId, text }) → Promise<{ lane: 'mongo', results: [MongoResult], cached: boolean }>`
    - `measure({ user, patternId, tag }) → Promise<{ tag, document: Side, converged: Side }>` where `Side = { sql, stats: Record<string, number>, result: SqlResult }` (stats are deltas; both sides rolled back)
    - `reset({ user, patternId }) → Promise<{ ok: boolean, errors: Array<{ sql, error, code }> }>`
    - `ensureBuilt(user, patternId) → Promise<void>` — resets the pattern in that workspace when its built version differs from `pattern.version`.
    - `user = { id: string, workspace: Workspace }`.
  - Guard rejections return `{ kind: 'error', code: 'LAB-GUARD', error }`; parse failures `{ kind: 'error', code: 'LAB-PARSE', error }` — HTTP 200 results, never exceptions. Gate rejections throw `GateError` (HTTP layer maps status).

- [ ] **Step 1: Write the failing integration tests**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/integration/runner.test.js`
Expected: FAIL — `services/workspaces.js` not found.

- [ ] **Step 3: Implement `workspaces.js` (solo part; Task 11 adds provisioning)**

```js
// app/src/services/workspaces.js
import oracledb from 'oracledb';

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const k = (schema, patternId) => `${schema}|${patternId}`;

export class Workspaces {
  cfg;
  pools;
  #dirty = new Set();
  #built = new Map();

  constructor({ cfg, pools }) {
    this.cfg = cfg;
    this.pools = pools;
  }

  async withControl(fn) {
    const c = await this.pools.control.getConnection();
    try {
      return await fn(c);
    } finally {
      await c.close();
    }
  }

  async load() {
    await this.withControl(async (c) => {
      this.#dirty.clear();
      this.#built.clear();
      (await c.execute('SELECT schema_name, pattern_id FROM lab_dirty', [], OBJ)).rows
        .forEach((r) => this.#dirty.add(k(r.SCHEMA_NAME, r.PATTERN_ID)));
      (await c.execute('SELECT schema_name, pattern_id, version FROM lab_built', [], OBJ)).rows
        .forEach((r) => this.#built.set(k(r.SCHEMA_NAME, r.PATTERN_ID), r.VERSION));
    });
  }

  solo() {
    return { userId: 'solo', schema: this.cfg.db.cmpUser, password: this.cfg.db.cmpPassword };
  }

  isDirty(schema, patternId) {
    return this.#dirty.has(k(schema, patternId));
  }

  async markDirty(schema, patternIds) {
    const add = patternIds.filter((p) => !this.isDirty(schema, p));
    if (!add.length) return;
    await this.withControl((c) => c.executeMany(
      `MERGE INTO lab_dirty d USING (SELECT :s AS s, :p AS p FROM dual) x
         ON (d.schema_name = x.s AND d.pattern_id = x.p)
       WHEN NOT MATCHED THEN INSERT (schema_name, pattern_id) VALUES (x.s, x.p)`,
      add.map((p) => ({ s: schema, p })), { autoCommit: true }));
    add.forEach((p) => this.#dirty.add(k(schema, p)));
  }

  async clearDirty(schema, patternId) {
    await this.withControl((c) => c.execute('DELETE FROM lab_dirty WHERE schema_name = :s AND pattern_id = :p',
      { s: schema, p: patternId }, { autoCommit: true }));
    this.#dirty.delete(k(schema, patternId));
  }

  builtVersion(schema, patternId) {
    return this.#built.get(k(schema, patternId)) ?? null;
  }

  async markBuilt(schema, patternId, version) {
    await this.withControl((c) => c.execute(
      `MERGE INTO lab_built b USING (SELECT :s AS s, :p AS p, :v AS v FROM dual) x
         ON (b.schema_name = x.s AND b.pattern_id = x.p)
       WHEN MATCHED THEN UPDATE SET b.version = x.v
       WHEN NOT MATCHED THEN INSERT (schema_name, pattern_id, version) VALUES (x.s, x.p, x.v)`,
      { s: schema, p: patternId, v: version }, { autoCommit: true }));
    this.#built.set(k(schema, patternId), version);
  }

  forgetInMemory(schema) {
    for (const key of [...this.#dirty]) if (key.startsWith(`${schema}|`)) this.#dirty.delete(key);
    for (const key of [...this.#built.keys()]) if (key.startsWith(`${schema}|`)) this.#built.delete(key);
  }
}
```

- [ ] **Step 4: Implement `runner.js`**

```js
// app/src/services/runner.js
import { splitConsoleSql } from '../content/sqlParser.js';
import { parseMongoCommand, MongoParseError } from '../content/mongoCommand.js';
import { classifySql, classifyMongo } from '../guard.js';
import { isReadOnlySql, isReadOnlyMongo, patternsTouched } from '../cache.js';
import { executeSql, readStats } from '../db/oracle.js';
import { runMongo } from '../db/mongo.js';

const isTimeout = (r) => r.kind === 'error' && /DPI-1067|NJS-123|call timeout|timed out/i.test(r.error);
const labErr = (code, error) => ({ kind: 'error', code, error, elapsedMs: 0 });

export class Runner {
  #cfg; #gate; #cache; #pools; #mongo; #ws; #patterns; #ids;

  constructor({ cfg, gate, cache, pools, mongo, workspaces, patterns }) {
    this.#cfg = cfg;
    this.#gate = gate;
    this.#cache = cache;
    this.#pools = pools;
    this.#mongo = mongo;
    this.#ws = workspaces;
    this.#patterns = new Map(patterns.map((p) => [p.id, p]));
    this.#ids = patterns.map((p) => p.id);
    this.timeouts = { sqlMs: cfg.gate.sqlTimeoutMs, mongoMs: cfg.gate.mongoTimeoutMs };
  }

  #limits(autoCommit = true) {
    const { maxRows, maxBytes } = this.#cfg.limits;
    return { timeoutMs: this.timeouts.sqlMs, maxRows, maxBytes, autoCommit };
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
        const errs = [];
        for (const st of [...p.setup.document, ...p.setup.converged]) {
          const r = track(await executeSql(conn, st.sql, this.#limits()));
          if (r.kind === 'error') errs.push({ sql: st.sql, error: r.error, code: r.code });
        }
        return errs;
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
    const cacheable = readOnly && p && !this.#ws.isDirty(ws.schema, patternId);
    const key = cacheable ? this.#cache.key(patternId, stmts[0], p.version) : null;
    const hit = key ? this.#cache.get(key) : undefined;
    if (hit) return { lane: 'sql', results: hit, cached: true };

    const results = await this.#gate.run({ userId: user.id, label: `${patternId ?? 'console'} · SQL` }, (ctx) =>
      this.#withConn(ws, ctx, async (conn, track) => {
        const out = [];
        for (const s of stmts) out.push(track(await executeSql(conn, s, this.#limits())));
        return out;
      }));
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
    const cacheable = readOnly && p && !this.#ws.isDirty(ws.schema, patternId);
    const key = cacheable ? this.#cache.key(patternId, `mongo:${text}`, p.version) : null;
    const hit = key ? this.#cache.get(key) : undefined;
    if (hit) return { lane: 'mongo', results: hit, cached: true };

    const client = this.#mongo.client(ws.schema, ws.password);
    const { maxRows, maxBytes } = this.#cfg.limits;
    const result = await this.#gate.run({ userId: user.id, label: `${patternId ?? 'console'} · MongoDB` }, async (ctx) => {
      ctx.cancel = () => { this.#mongo.drop(ws.schema); };
      return runMongo(client, ws.schema.toUpperCase(), cmd, { timeoutMs: this.timeouts.mongoMs, maxRows, maxBytes });
    });
    if (!readOnly) await this.#ws.markDirty(ws.schema, patternsTouched(`${cmd.collection ?? ''} ${text}`, this.#ids));
    if (key && result.kind !== 'error') this.#cache.set(key, [result]);
    return { lane: 'mongo', results: [result], cached: false };
  }

  async measure({ user, patternId, tag }) {
    const p = this.#pattern(patternId);
    const pair = p?.measures.find((m) => m.tag === tag);
    if (!pair) throw new Error(`unknown measure ${patternId}/${tag}`);
    await this.ensureBuilt(user, patternId);
    const ws = user.workspace;
    return this.#gate.run({ userId: user.id, label: `${patternId} · measure ${tag}`, exclusive: true }, (ctx) =>
      this.#withConn(ws, ctx, async (conn, track) => {
        const side = async (stmt) => {
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
}
```


- [ ] **Step 5: Run to verify pass**

Run: `cd app && npx vitest run test/integration/runner.test.js`
Expected: all passed.
- If a **"every step runs in order"** test fails, the pattern's annotations violate Task 7 rule 2 — fix the annotations (comments only), re-run `./run.sh` (18/0), then this test.
- If a **measure-it** direction assertion fails, **stop**: record both stat sets for that tag and report them. Oracle updates OSON documents partially, so a single-document update may generate less redo than the lecture's document-engine argument assumes. This is a content decision for the lab owner, not a test to relax.

- [ ] **Step 6: Commit**

```bash
git add app/src/services/workspaces.js app/src/services/runner.js app/test/integration/runner.test.js
git commit -m "feat(lab-ui): runner with gate, cache, dirty flags, measure-it and reset"
```

---
### Task 11: Event mode — provisioning, prewarm, end event, signed sessions

**Files:**
- Create: `app/src/services/auth.js`
- Modify: `app/src/services/workspaces.js` (add the event-mode methods below)
- Test: `app/test/unit/auth.test.js`, `app/test/integration/workspaces.test.js`

**Interfaces:**
- Consumes: `Workspaces` (Task 10), `Runner` (Task 10) in tests, `createPools`/`bootstrap`/`executeSql` (Task 8).
- Produces:
  - `auth.js`: `sign(value: string, secret: string) → string` (`value.hmac`), `verify(token: string, secret: string) → string|null` (timing-safe), `parseCookies(header?: string) → Record<string,string>`, `cookie(name, value, { maxAgeSec }) → string` (`HttpOnly; SameSite=Lax; Path=/`).
  - `Workspaces` event methods:
    - `sessionSecret() → Promise<string>` — 64 hex chars stored in `lab_settings` (`k = 'session_secret'`), created once; survives restarts.
    - `findByEmail(email) → Promise<Workspace & { email, name }|null>`, `findBySchema(schema) → Promise<…|null>`
    - `provision({ email = null, name = null } = {}) → Promise<Workspace>` — creates `WS_xxxxxx`, grants, quota 50M, V$ grants, ORDS-enables the schema, records it in `lab_users`.
    - `assign({ email, name }) → Promise<Workspace>` — same email → same workspace; otherwise claims a prewarmed unassigned workspace (`email IS NULL`, `FOR UPDATE SKIP LOCKED`), else provisions a new one.
    - `list() → Promise<Array<{ schema, email, name, createdAt, assignedAt, built: string[] }>>`
    - `dropAll(mongoPool) → Promise<number>` — closes Mongo clients, drops every `WS_%` user `CASCADE`, deletes their rows from `lab_users`, `lab_dirty`, `lab_built`; returns count.
  - Callers (Task 12) wrap `provision`/`assign`/`dropAll` in `gate.run({ …, exclusive: true })`.

- [ ] **Step 1: Write the failing auth unit tests**

```js
// app/test/unit/auth.test.js
import { describe, it, expect } from 'vitest';
import { sign, verify, parseCookies, cookie } from '../../src/services/auth.js';

describe('auth', () => {
  it('round-trips a signed value', () => {
    expect(verify(sign('WS_ABC123', 's3cret'), 's3cret')).toBe('WS_ABC123');
  });
  it('rejects tampering and wrong secrets', () => {
    const t = sign('WS_ABC123', 's3cret');
    expect(verify(t.replace('ABC', 'XYZ'), 's3cret')).toBeNull();
    expect(verify(t, 'other')).toBeNull();
    expect(verify('garbage', 's3cret')).toBeNull();
    expect(verify(undefined, 's3cret')).toBeNull();
  });
  it('parses cookie headers', () => {
    expect(parseCookies('a=1; lab_sid=x.y; b=%20z')).toEqual({ a: '1', lab_sid: 'x.y', b: ' z' });
    expect(parseCookies(undefined)).toEqual({});
  });
  it('builds an HttpOnly cookie', () => {
    expect(cookie('lab_sid', 'v', { maxAgeSec: 60 })).toBe('lab_sid=v; Max-Age=60; Path=/; HttpOnly; SameSite=Lax');
  });
});
```

- [ ] **Step 2: Implement `auth.js` and run the unit tests**

```js
// app/src/services/auth.js
import crypto from 'node:crypto';

const mac = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

export function sign(value, secret) {
  return `${value}.${mac(value, secret)}`;
}

export function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const value = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(mac(value, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAgeSec }) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax`;
}
```

Run: `cd app && npx vitest run test/unit/auth.test.js` → 4 passed. (Note: `encodeURIComponent('x.y')` keeps the dot, so signed tokens survive the cookie round trip.)

- [ ] **Step 3: Write the failing workspace integration tests**

```js
// app/test/integration/workspaces.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';

const cfg = testConfig({ LAB_MODE: 'event', ADMIN_PASSWORD: 'admin-test' });
const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo; let ws; let runner;

beforeAll(async () => {
  await bootstrap(cfg);
  pools = await createPools(cfg);
  mongo = new MongoPool(cfg);
  ws = new Workspaces({ cfg, pools });
  await ws.load();
  await ws.dropAll(mongo); // clean slate
  runner = new Runner({ cfg, gate: new Gate(cfg.gate), cache: new ResultCache(cfg.cache), pools, mongo, workspaces: ws, patterns });
}, 300000);
afterAll(async () => { await ws?.dropAll(mongo); await mongo?.closeAll(); await pools?.close(); }, 300000);

describe('event workspaces', () => {
  it('keeps a stable session secret', async () => {
    const a = await ws.sessionSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ws.sessionSecret()).toBe(a);
  });

  it('assigns one workspace per email and returns it again for the same email', async () => {
    const a = await ws.assign({ email: 'a@example.com', name: 'A' });
    const b = await ws.assign({ email: 'b@example.com', name: 'B' });
    expect(a.schema).toMatch(/^WS_[0-9A-F]{6}$/);
    expect(b.schema).not.toBe(a.schema);
    expect((await ws.assign({ email: 'a@example.com', name: 'A again' })).schema).toBe(a.schema);
    expect((await ws.findBySchema(a.schema)).email).toBe('a@example.com');
  }, 120000);

  it('isolates attendees from each other', async () => {
    const a = await ws.findByEmail('a@example.com');
    const b = await ws.findByEmail('b@example.com');
    const userA = { id: a.schema, workspace: a };
    const userB = { id: b.schema, workspace: b };
    expect((await runner.reset({ user: userB, patternId: '01-extended-reference' })).ok).toBe(true);
    const out = await runner.runSql({ user: userA, patternId: null, text: `SELECT COUNT(*) FROM ${b.schema}.xr_advisors` });
    expect(out.results[0].kind).toBe('error');
    expect(['ORA-00942', 'ORA-01031']).toContain(out.results[0].code);
  }, 180000);

  it('serves the MongoDB API per workspace', async () => {
    const a = await ws.findByEmail('a@example.com');
    const user = { id: a.schema, workspace: a };
    const p = patterns.find((x) => x.id === '01-extended-reference');
    const out = await runner.runMongoText({ user, patternId: p.id, text: p.lanes.mongo[0].command });
    expect(out.results[0].kind).toBe('docs');
    expect(out.results[0].docs.length).toBeGreaterThan(0);
  }, 180000);

  it('claims a prewarmed workspace before creating a new one', async () => {
    const pre = await ws.provision();
    const before = (await ws.list()).length;
    const c = await ws.assign({ email: 'c@example.com', name: 'C' });
    expect(c.schema).toBe(pre.schema);
    expect((await ws.list()).length).toBe(before);
  }, 120000);

  it('end event drops every workspace', async () => {
    const n = await ws.dropAll(mongo);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await ws.list()).toEqual([]);
    const c = await pools.control.getConnection();
    const r = await executeSql(c, "SELECT COUNT(*) AS n FROM all_users WHERE username LIKE 'WS\\_%' ESCAPE '\\'", { timeoutMs: 10000, maxRows: 5, maxBytes: 10000 });
    await c.close();
    expect(r.rows[0].N).toBe(0);
  }, 300000);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd app && npx vitest run test/integration/workspaces.test.js`
Expected: FAIL — `ws.dropAll is not a function`.

- [ ] **Step 5: Add the event-mode methods to `workspaces.js`**

Add `import crypto from 'node:crypto';` at the top, then these methods inside `class Workspaces`:

```js
  async sessionSecret() {
    return this.withControl(async (c) => {
      const r = await c.execute("SELECT v FROM lab_settings WHERE k = 'session_secret'", [], OBJ);
      if (r.rows.length) return r.rows[0].V;
      const v = crypto.randomBytes(32).toString('hex');
      await c.execute(
        `MERGE INTO lab_settings s USING (SELECT 'session_secret' AS k, :v AS v FROM dual) x ON (s.k = x.k)
         WHEN NOT MATCHED THEN INSERT (k, v) VALUES (x.k, x.v)`, { v }, { autoCommit: true });
      return (await c.execute("SELECT v FROM lab_settings WHERE k = 'session_secret'", [], OBJ)).rows[0].V;
    });
  }

  #row(r) {
    return r ? { userId: r.SCHEMA_NAME, schema: r.SCHEMA_NAME, password: r.SCHEMA_PASSWORD, email: r.EMAIL, name: r.DISPLAY_NAME } : null;
  }

  async findByEmail(email) {
    return this.withControl(async (c) => this.#row((await c.execute(
      'SELECT * FROM lab_users WHERE email = :e', { e: email.trim().toLowerCase() }, OBJ)).rows[0]));
  }

  async findBySchema(schema) {
    return this.withControl(async (c) => this.#row((await c.execute(
      'SELECT * FROM lab_users WHERE schema_name = :s', { s: schema }, OBJ)).rows[0]));
  }

  async provision({ email = null, name = null } = {}) {
    const schema = `WS_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const password = `Ws${crypto.randomBytes(12).toString('hex')}`;
    await this.withControl(async (c) => {
      const ddl = [
        `CREATE USER ${schema} IDENTIFIED BY "${password}" QUOTA 50M ON users`,
        `GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE, CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH, SODA_APP TO ${schema}`,
        `GRANT SELECT ON sys.v_$mystat TO ${schema}`,
        `GRANT SELECT ON sys.v_$statname TO ${schema}`,
        `BEGIN ORDS_METADATA.ORDS_ADMIN.ENABLE_SCHEMA(p_enabled => TRUE, p_schema => '${schema}', p_url_mapping_type => 'BASE_PATH', p_url_mapping_pattern => '${schema.toLowerCase()}', p_auto_rest_auth => FALSE); COMMIT; END;`,
      ];
      for (const s of ddl) await c.execute(s);
      await c.execute(
        `INSERT INTO lab_users (schema_name, schema_password, email, display_name, assigned_at)
         VALUES (:s, :p, :e, :n, CASE WHEN :e IS NULL THEN NULL ELSE SYSTIMESTAMP END)`,
        { s: schema, p: password, e: email ? email.trim().toLowerCase() : null, n: name }, { autoCommit: true });
    });
    return { userId: schema, schema, password, email, name };
  }

  async assign({ email, name }) {
    const existing = await this.findByEmail(email);
    if (existing) return existing;
    const claimed = await this.withControl(async (c) => {
      const r = await c.execute(
        'SELECT schema_name FROM lab_users WHERE email IS NULL ORDER BY created_at FETCH FIRST 1 ROWS ONLY FOR UPDATE SKIP LOCKED', [], OBJ);
      if (!r.rows.length) return null;
      await c.execute('UPDATE lab_users SET email = :e, display_name = :n, assigned_at = SYSTIMESTAMP WHERE schema_name = :s',
        { e: email.trim().toLowerCase(), n: name, s: r.rows[0].SCHEMA_NAME }, { autoCommit: true });
      return r.rows[0].SCHEMA_NAME;
    });
    return claimed ? this.findBySchema(claimed) : this.provision({ email, name });
  }

  async list() {
    return this.withControl(async (c) => (await c.execute(
      `SELECT u.schema_name, u.email, u.display_name, u.created_at, u.assigned_at,
              (SELECT LISTAGG(b.pattern_id, ',') WITHIN GROUP (ORDER BY b.pattern_id) FROM lab_built b WHERE b.schema_name = u.schema_name) AS built
         FROM lab_users u ORDER BY u.created_at`, [], OBJ)).rows.map((r) => ({
      schema: r.SCHEMA_NAME, email: r.EMAIL, name: r.DISPLAY_NAME, createdAt: r.CREATED_AT, assignedAt: r.ASSIGNED_AT,
      built: r.BUILT ? r.BUILT.split(',') : [],
    })));
  }

  async dropAll(mongoPool) {
    const users = await this.list();
    await Promise.all(users.map((u) => mongoPool?.drop(u.schema)));
    await this.withControl(async (c) => {
      for (const u of users) {
        await c.execute(`DROP USER ${u.schema} CASCADE`).catch((e) => { if (e.errorNum !== 1918) throw e; });
        await c.execute('DELETE FROM lab_dirty WHERE schema_name = :s', { s: u.schema });
        await c.execute('DELETE FROM lab_built WHERE schema_name = :s', { s: u.schema });
        await c.execute('DELETE FROM lab_users WHERE schema_name = :s', { s: u.schema });
        await c.commit();
        this.forgetInMemory(u.schema);
      }
    });
    return users.length;
  }
```

`DROP USER … CASCADE` fails with ORA-01940 if the user is connected; the exec pool closes connections after every operation and Mongo clients are dropped first, so no session should remain. If ORA-01940 appears in the test, report it rather than adding session-killing code.

- [ ] **Step 6: Run to verify pass**

Run: `cd app && npx vitest run test/unit/auth.test.js test/integration/workspaces.test.js`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add app/src/services/auth.js app/src/services/workspaces.js app/test/unit/auth.test.js app/test/integration/workspaces.test.js
git commit -m "feat(lab-ui): event-mode workspaces, prewarm, end event and signed sessions"
```

---
### Task 12: HTTP API, admin API and server

**Files:**
- Create: `app/src/routes/api.js`, `app/src/routes/admin.js`, `app/src/server.js`
- Test: `app/test/integration/http.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `createApp({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret }) → express.Application`
  - `main() → Promise<void>` (only when `server.js` is the entry point): loads config, retries `bootstrap` every 10 s for up to 10 min (and, in event mode, until `LAB_ADMIN` holds `ORDS_ADMINISTRATOR_ROLE`), creates pools, loads patterns and workspaces, listens on `cfg.port`.
  - Routes (JSON; body limit 64 KB):

| Method + path | Mode | Body → response |
|---|---|---|
| `GET /api/config` | both | `{ mode, eventCodeRequired }` |
| `POST /api/signin` | event | `{ name, email, code? }` → sets `lab_sid`, `{ schema }`; wrong code 403; missing name/email 400 |
| `GET /api/me` | both | `{ mode, user: { schema, email, name } }` (solo: schema `CMP_USER`) |
| `GET /api/patterns` | both | `Array<{ id, meta, cards: { document: Card[], converged: Card[], mongo: MongoCard[] }, measures: Array<{ tag, documentSql, convergedSql }> }>` with `Card = { title, notes, sql, measure }` |
| `POST /api/run` | both | `{ lane: 'sql'|'mongo', patternId: string|null, text }` → runner result; `GateError` → its status + `{ error, code }` |
| `GET /api/queue` | both | `{ position: number|null, depth, paused }` for the caller |
| `POST /api/measure` | both | `{ patternId, tag }` → measure result |
| `POST /api/reset` | both | `{ patternId }` → `{ ok, errors }` |
| `POST /api/admin/login` | event | `{ password }` → sets `lab_admin`; wrong 403 |
| `GET /api/admin/status` | event | `{ gate: gate.status(), cache: { size, enabled }, timeouts: runner.timeouts, attendees: workspaces.list() }` |
| `POST /api/admin/cancel` | event | `{ id }` → `{ cancelled }` |
| `POST /api/admin/pause` | event | `{ on }` → `{ paused }` |
| `POST /api/admin/cache` | event | `{ enabled }` → clears the cache when disabling |
| `POST /api/admin/prewarm` | event | `{ count }` (1–200) → `202 { started: count }`; runs in background: provision + build every pattern, each through the gate exclusively |
| `POST /api/admin/reset-attendee` | event | `{ schema }` → rebuilds every pattern for that workspace; `schema: "*"` rebuilds every attendee |
| `POST /api/admin/timeouts` | event | `{ sqlMs, mongoMs }` (integers 1000–60000) → sets `runner.timeouts`, returns it |
| `POST /api/admin/end-event` | event | → `{ dropped }` (exclusive gate) |

In event mode every `/api/*` route except `config`, `signin` and `admin/login` requires a valid `lab_sid` (401 otherwise); admin routes require `lab_admin` (401). Unknown errors → 500 `{ error: 'internal error' }` and a server log line; never leak stack traces.

- [ ] **Step 1: Write the failing HTTP tests**

```js
// app/test/integration/http.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import { testConfig } from './env.js';
import { bootstrap, createPools } from '../../src/db/oracle.js';
import { MongoPool } from '../../src/db/mongo.js';
import { Gate } from '../../src/gate.js';
import { ResultCache } from '../../src/cache.js';
import { loadPatterns } from '../../src/content/patterns.js';
import { Workspaces } from '../../src/services/workspaces.js';
import { Runner } from '../../src/services/runner.js';
import { createApp } from '../../src/server.js';

const patterns = loadPatterns(path.resolve(import.meta.dirname, '../../../patterns'));
let pools; let mongo;

async function build(env) {
  const cfg = testConfig(env);
  const gate = new Gate(cfg.gate);
  const cache = new ResultCache(cfg.cache);
  const workspaces = new Workspaces({ cfg, pools });
  await workspaces.load();
  const runner = new Runner({ cfg, gate, cache, pools, mongo, workspaces, patterns });
  const sessionSecret = await workspaces.sessionSecret();
  return { app: createApp({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret }), gate, workspaces };
}

beforeAll(async () => {
  const cfg = testConfig();
  await bootstrap(cfg);
  pools = await createPools(cfg);
  mongo = new MongoPool(cfg);
}, 300000);
afterAll(async () => { await mongo?.closeAll(); await pools?.close(); });

describe('solo mode', () => {
  let app;
  beforeAll(async () => { ({ app } = await build({})); });

  it('describes the lab', async () => {
    expect((await request(app).get('/api/config')).body).toEqual({ mode: 'solo', eventCodeRequired: false });
    const r = await request(app).get('/api/patterns');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(6);
    expect(r.body[0].cards.document[0]).toHaveProperty('sql');
  });
  it('runs SQL and returns Oracle errors with HTTP 200', async () => {
    const ok = await request(app).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 AS n FROM dual' });
    expect(ok.status).toBe(200);
    expect(ok.body.results[0].rows[0].N).toBe(1);
    const bad = await request(app).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT * FROM no_such_table_xyz' });
    expect(bad.status).toBe(200);
    expect(bad.body.results[0].code).toBe('ORA-00942');
  });
  it('runs a MongoDB command', async () => {
    const r = await request(app).post('/api/run').send({ lane: 'mongo', patternId: null, text: 'show collections' });
    expect(r.status).toBe(200);
    expect(r.body.results[0].kind).toBe('collections');
  });
  it('rejects a bad lane with 400', async () => {
    expect((await request(app).post('/api/run').send({ lane: 'js', text: 'x' })).status).toBe(400);
  });
  it('maps a paused gate to 423', async () => {
    const { app: a, gate } = await build({});
    gate.pause(true);
    const r = await request(a).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 FROM dual' });
    expect(r.status).toBe(423);
    expect(r.body.error).toBe('paused by instructor');
  });
  it('maps queue timeout to 429', async () => {
    const { app: a, gate } = await build({ QUEUE_TIMEOUT_MS: '200' });
    gate.run({ userId: 'someone-else', label: 'hold' }, () => new Promise((res) => setTimeout(res, 1500)));
    const r = await request(a).post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT 1 FROM dual' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('busy, retry');
  });
  it('reports the queue position', async () => {
    const r = await request(app).get('/api/queue');
    expect(r.body).toEqual({ position: null, depth: 0, paused: false });
  });
});

describe('event mode', () => {
  let app; let workspaces;
  beforeAll(async () => { ({ app, workspaces } = await build({ LAB_MODE: 'event', ADMIN_PASSWORD: 'admin-test', EVENT_CODE: 'LAB26' })); });
  afterAll(async () => { await workspaces.dropAll(mongo); }, 300000);

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).post('/api/run').send({ lane: 'sql', text: 'SELECT 1 FROM dual' })).status).toBe(401);
  });
  it('checks the event code', async () => {
    const r = await request(app).post('/api/signin').send({ name: 'A', email: 'a@example.com', code: 'nope' });
    expect(r.status).toBe(403);
  });
  it('signs in, then runs SQL in the attendee workspace', async () => {
    const agent = request.agent(app);
    const s = await agent.post('/api/signin').send({ name: 'A', email: 'a@example.com', code: 'LAB26' });
    expect(s.status).toBe(200);
    expect(s.body.schema).toMatch(/^WS_/);
    const me = await agent.get('/api/me');
    expect(me.body.user.email).toBe('a@example.com');
    const r = await agent.post('/api/run').send({ lane: 'sql', patternId: null, text: 'SELECT USER AS u FROM dual' });
    expect(r.body.results[0].rows[0].U).toBe(s.body.schema);
  }, 120000);
  it('protects the admin API', async () => {
    expect((await request(app).get('/api/admin/status')).status).toBe(401);
    expect((await request(app).post('/api/admin/login').send({ password: 'wrong' })).status).toBe(403);
    const admin = request.agent(app);
    expect((await admin.post('/api/admin/login').send({ password: 'admin-test' })).status).toBe(200);
    const st = await admin.get('/api/admin/status');
    expect(st.status).toBe(200);
    expect(st.body.gate.permits).toBe(1);
    expect(st.body.attendees.length).toBeGreaterThanOrEqual(1);
    expect((await admin.post('/api/admin/pause').send({ on: true })).body).toEqual({ paused: true });
    expect((await admin.post('/api/admin/pause').send({ on: false })).body).toEqual({ paused: false });
    expect((await admin.post('/api/admin/timeouts').send({ sqlMs: 5000, mongoMs: 5000 })).body).toEqual({ sqlMs: 5000, mongoMs: 5000 });
    expect((await admin.post('/api/admin/timeouts').send({ sqlMs: 5, mongoMs: 5000 })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/integration/http.test.js`
Expected: FAIL — `server.js` not found.

- [ ] **Step 3: Implement `routes/api.js`**

```js
// app/src/routes/api.js
import express from 'express';
import { GateError } from '../gate.js';
import { sign, verify, parseCookies, cookie } from '../services/auth.js';

const DAY = 24 * 3600;

export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof GateError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[lab-ui]', err);
    return res.status(500).json({ error: 'internal error' });
  });
}

export function apiRouter({ cfg, runner, workspaces, gate, patterns, sessionSecret }) {
  const r = express.Router();
  const publicPaths = new Set(['/config', '/signin', '/admin/login']);

  r.use(wrap(async (req, res, next) => {
    if (cfg.mode === 'solo') {
      const w = workspaces.solo();
      req.user = { id: 'solo', workspace: w, profile: { schema: w.schema, email: null, name: null } };
      return next();
    }
    if (publicPaths.has(req.path) || req.path.startsWith('/admin/')) return next();
    const schema = verify(parseCookies(req.headers.cookie).lab_sid, sessionSecret);
    const w = schema ? await workspaces.findBySchema(schema) : null;
    if (!w) return res.status(401).json({ error: 'sign in first' });
    req.user = { id: w.schema, workspace: w, profile: { schema: w.schema, email: w.email, name: w.name } };
    return next();
  }));

  r.get('/config', (req, res) => res.json({ mode: cfg.mode, eventCodeRequired: cfg.mode === 'event' && Boolean(cfg.event.code) }));

  r.post('/signin', wrap(async (req, res) => {
    if (cfg.mode !== 'event') return res.status(404).json({ error: 'not in event mode' });
    const { name, email, code } = req.body ?? {};
    if (!name?.trim() || !/^[^@\s]+@[^@\s]+$/.test(email ?? '')) return res.status(400).json({ error: 'name and a valid email are required' });
    if (cfg.event.code && code !== cfg.event.code) return res.status(403).json({ error: 'wrong event code' });
    const w = await gate.run({ userId: email.toLowerCase(), label: 'sign-in', exclusive: true }, () => workspaces.assign({ email, name: name.trim() }));
    res.setHeader('Set-Cookie', cookie('lab_sid', sign(w.schema, sessionSecret), { maxAgeSec: 7 * DAY }));
    return res.json({ schema: w.schema });
  }));

  r.get('/me', (req, res) => res.json({ mode: cfg.mode, user: req.user.profile }));

  r.get('/patterns', (req, res) => res.json(patterns.map((p) => ({
    id: p.id,
    meta: p.meta,
    cards: {
      document: p.lanes.document.map(({ title, notes, sql, measure }) => ({ title, notes, sql, measure })),
      converged: p.lanes.converged.map(({ title, notes, sql, measure }) => ({ title, notes, sql, measure })),
      mongo: p.lanes.mongo.map(({ title, notes, command }) => ({ title, notes, command })),
    },
    measures: p.measures.map((m) => ({ tag: m.tag, documentSql: m.document.sql, convergedSql: m.converged.sql })),
  }))));

  const validPattern = (id) => id === null || id === undefined || patterns.some((p) => p.id === id);

  r.post('/run', wrap(async (req, res) => {
    const { lane, patternId = null, text } = req.body ?? {};
    if (!['sql', 'mongo'].includes(lane) || typeof text !== 'string' || !validPattern(patternId)) {
      return res.status(400).json({ error: 'lane must be "sql" or "mongo", text a string, patternId a known pattern or null' });
    }
    const out = lane === 'sql'
      ? await runner.runSql({ user: req.user, patternId, text })
      : await runner.runMongoText({ user: req.user, patternId, text });
    return res.json(out);
  }));

  r.get('/queue', (req, res) => {
    const s = gate.status();
    res.json({ position: gate.position(req.user.id), depth: s.queued.length, paused: s.paused });
  });

  r.post('/measure', wrap(async (req, res) => {
    const { patternId, tag } = req.body ?? {};
    const p = patterns.find((x) => x.id === patternId);
    if (!p || !p.measures.some((m) => m.tag === tag)) return res.status(400).json({ error: 'unknown pattern or measure tag' });
    return res.json(await runner.measure({ user: req.user, patternId, tag }));
  }));

  r.post('/reset', wrap(async (req, res) => {
    const { patternId } = req.body ?? {};
    if (!patterns.some((p) => p.id === patternId)) return res.status(400).json({ error: 'unknown pattern' });
    return res.json(await runner.reset({ user: req.user, patternId }));
  }));

  return r;
}
```

- [ ] **Step 4: Implement `routes/admin.js`**

```js
// app/src/routes/admin.js
import express from 'express';
import crypto from 'node:crypto';
import { wrap } from './api.js';
import { sign, verify, parseCookies, cookie } from '../services/auth.js';

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function adminRouter({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret }) {
  const r = express.Router();
  if (cfg.mode !== 'event') {
    r.use((req, res) => res.status(404).json({ error: 'admin is only available in event mode' }));
    return r;
  }

  r.post('/login', (req, res) => {
    if (!same(req.body?.password ?? '', cfg.event.adminPassword)) return res.status(403).json({ error: 'wrong password' });
    res.setHeader('Set-Cookie', cookie('lab_admin', sign('admin', sessionSecret), { maxAgeSec: 12 * 3600 }));
    return res.json({ ok: true });
  });

  r.use((req, res, next) => (verify(parseCookies(req.headers.cookie).lab_admin, sessionSecret) === 'admin'
    ? next() : res.status(401).json({ error: 'admin sign-in required' })));

  const buildAll = async (w) => {
    const user = { id: w.schema, workspace: w };
    for (const p of patterns) await runner.reset({ user, patternId: p.id });
  };

  r.get('/status', wrap(async (req, res) => res.json({
    gate: gate.status(), cache: { size: cache.size, enabled: cache.enabled }, timeouts: runner.timeouts, attendees: await workspaces.list(),
  })));

  r.post('/timeouts', (req, res) => {
    const ok = (v) => Number.isInteger(v) && v >= 1000 && v <= 60000;
    const sqlMs = Number(req.body?.sqlMs); const mongoMs = Number(req.body?.mongoMs);
    if (!ok(sqlMs) || !ok(mongoMs)) return res.status(400).json({ error: 'sqlMs and mongoMs must be integers 1000–60000' });
    runner.timeouts = { sqlMs, mongoMs };
    return res.json(runner.timeouts);
  });

  r.post('/cancel', (req, res) => res.json({ cancelled: gate.cancel(Number(req.body?.id)) }));

  r.post('/pause', (req, res) => { gate.pause(Boolean(req.body?.on)); res.json({ paused: gate.status().paused }); });

  r.post('/cache', (req, res) => {
    cache.enabled = Boolean(req.body?.enabled);
    if (!cache.enabled) cache.clear();
    res.json({ enabled: cache.enabled });
  });

  r.post('/prewarm', (req, res) => {
    const count = Number(req.body?.count);
    if (!Number.isInteger(count) || count < 1 || count > 200) return res.status(400).json({ error: 'count must be 1–200' });
    (async () => {
      for (let i = 0; i < count; i++) {
        const w = await gate.run({ userId: `prewarm-${i}`, label: 'prewarm', exclusive: true }, () => workspaces.provision());
        await buildAll(w);
      }
    })().catch((e) => console.error('[lab-ui] prewarm failed', e));
    return res.status(202).json({ started: count });
  });

  r.post('/reset-attendee', wrap(async (req, res) => {
    const schema = String(req.body?.schema ?? '');
    if (schema === '*') {
      const all = await workspaces.list();
      for (const a of all) await buildAll(await workspaces.findBySchema(a.schema));
      return res.json({ ok: true, reset: all.length });
    }
    const w = await workspaces.findBySchema(schema);
    if (!w) return res.status(404).json({ error: 'no such workspace' });
    await buildAll(w);
    return res.json({ ok: true, reset: 1 });
  }));

  r.post('/end-event', wrap(async (req, res) => {
    const dropped = await gate.run({ userId: 'admin', label: 'end event', exclusive: true }, () => workspaces.dropAll(mongo));
    cache.clear();
    return res.json({ dropped });
  }));

  return r;
}
```

- [ ] **Step 5: Implement `server.js`**

```js
// app/src/server.js
import path from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { bootstrap, createPools } from './db/oracle.js';
import { MongoPool } from './db/mongo.js';
import { Gate } from './gate.js';
import { ResultCache } from './cache.js';
import { loadPatterns } from './content/patterns.js';
import { Workspaces } from './services/workspaces.js';
import { Runner } from './services/runner.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';

export function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/admin', adminRouter(deps));
  app.use('/api', apiRouter(deps));
  app.use(express.static(path.resolve(import.meta.dirname, '../public'), { maxAge: '1h' }));
  app.use((err, req, res, next) => { // body-parser errors etc.
    if (res.headersSent) return next(err);
    return res.status(err.status ?? 400).json({ error: err.type === 'entity.too.large' ? 'request too large' : 'bad request' });
  });
  return app;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForBootstrap(cfg) {
  for (let i = 1; i <= 60; i++) {
    try {
      await bootstrap(cfg);
      if (cfg.mode !== 'event') return;
      const pools = await createPools(cfg);
      const c = await pools.control.getConnection();
      const r = await c.execute("SELECT COUNT(*) FROM user_role_privs WHERE granted_role = 'ORDS_ADMINISTRATOR_ROLE'");
      await c.close(); await pools.close();
      if (r.rows[0][0] > 0) return;
      console.log('[lab-ui] waiting for ORDS to be installed…');
    } catch (e) {
      console.log(`[lab-ui] database not ready (${i}/60): ${e.message}`);
    }
    await sleep(10000);
  }
  throw new Error('database did not become ready in 10 minutes');
}

export async function main() {
  const cfg = loadConfig();
  await waitForBootstrap(cfg);
  const pools = await createPools(cfg);
  const mongo = new MongoPool(cfg);
  const gate = new Gate(cfg.gate);
  const cache = new ResultCache(cfg.cache);
  cache.enabled = cfg.cache.enabled;
  const patterns = loadPatterns(cfg.patternsDir);
  const workspaces = new Workspaces({ cfg, pools });
  await workspaces.load();
  const runner = new Runner({ cfg, gate, cache, pools, mongo, workspaces, patterns });
  const sessionSecret = await workspaces.sessionSecret();
  const app = createApp({ cfg, runner, workspaces, gate, cache, patterns, mongo, sessionSecret });
  app.listen(cfg.port, () => console.log(`[lab-ui] ${cfg.mode} mode on :${cfg.port} · ${patterns.length} patterns`));
}

if (process.argv[1] === import.meta.filename) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd app && npx vitest run test/integration/http.test.js`
Expected: all passed.

- [ ] **Step 7: Run the whole suite**

Run: `cd app && npx vitest run`
Expected: all unit and integration tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/routes app/src/server.js app/test/integration/http.test.js
git commit -m "feat(lab-ui): HTTP and admin API, server bootstrap"
```

---
### Task 13: Frontend foundation — offline vendor bundle, styles, shell, results renderer

**Files:**
- Create: `app/build/cm-entry.js`, `app/build/vendor.mjs`, `app/public/index.html`, `app/public/css/lab.css`, `app/public/js/api.js`, `app/public/js/results.js`
- Test: `app/test/unit/results.test.js`

**Interfaces:**
- Produces:
  - `public/vendor/cm.js` (generated, git-ignored) exporting `createEditor(parent: HTMLElement, { lang: 'sql'|'mongo', doc: string, onRun: () => void }) → { get(): string, set(text: string): void, focus(): void }`.
  - `public/vendor/fonts.css` (generated) with `@font-face` rules for the three families.
  - `api.js`: `getJSON(url) → Promise<{ status, body }>`, `postJSON(url, body) → Promise<{ status, body }>`.
  - `results.js`: `renderResult(result) → HTMLElement` for every `SqlResult`/`MongoResult` kind; `renderRun(runResponse) → HTMLElement` (all results + `served from cache` badge). **All values are inserted with `textContent`, never `innerHTML`.**

- [ ] **Step 1: Add jsdom for the renderer test**

```bash
cd app && npm install -D jsdom
```

- [ ] **Step 2: Write the failing renderer tests**

```js
// app/test/unit/results.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderResult, renderRun } from '../../public/js/results.js';

describe('renderResult', () => {
  it('renders rows as a table with escaped values', () => {
    const el = renderResult({ kind: 'rows', columns: ['NAME'], rows: [{ NAME: '<img src=x onerror=alert(1)>' }], rowCount: 1, truncated: false, elapsedMs: 3 });
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('td').textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('renders JSON-valued cells and documents as a collapsible tree', () => {
    const el = renderResult({ kind: 'docs', docs: [{ _id: 'C-001', advisor: { office: 'NYC-09' } }], count: 1, truncated: false, elapsedMs: 2 });
    expect(el.querySelectorAll('details').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('NYC-09');
  });
  it('renders DML, DDL, counts, collections and writes as messages', () => {
    expect(renderResult({ kind: 'dml', rowsAffected: 3, elapsedMs: 1 }).textContent).toContain('3 rows affected');
    expect(renderResult({ kind: 'ok', elapsedMs: 1 }).textContent).toContain('Statement executed');
    expect(renderResult({ kind: 'count', count: 7, elapsedMs: 1 }).textContent).toContain('7');
    expect(renderResult({ kind: 'collections', names: ['a', 'b'], elapsedMs: 1 }).textContent).toContain('a');
    expect(renderResult({ kind: 'write', result: { modifiedCount: 1 }, elapsedMs: 1 }).textContent).toContain('modifiedCount');
  });
  it('renders errors with their code', () => {
    const el = renderResult({ kind: 'error', code: 'ORA-00942', error: 'ORA-00942: table or view does not exist', elapsedMs: 1 });
    expect(el.classList.contains('error')).toBe(true);
    expect(el.textContent).toContain('ORA-00942');
  });
  it('flags truncation', () => {
    expect(renderResult({ kind: 'rows', columns: ['N'], rows: [{ N: 1 }], rowCount: 1, truncated: true, elapsedMs: 1 }).textContent)
      .toMatch(/truncated/i);
  });
});

describe('renderRun', () => {
  it('shows the cache badge', () => {
    const el = renderRun({ lane: 'sql', cached: true, results: [{ kind: 'ok', elapsedMs: 0 }] });
    expect(el.textContent).toContain('served from cache');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd app && npx vitest run test/unit/results.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `api.js` and `results.js`**

```js
// app/public/js/api.js
async function call(url, init) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
export const getJSON = (url) => call(url);
export const postJSON = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
```

```js
// app/public/js/results.js
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
};

function tree(value, key) {
  if (value === null || typeof value !== 'object') {
    const row = h('div', 'jv');
    if (key !== undefined) row.append(h('span', 'jk', `${key}: `));
    row.append(h('span', `jval ${value === null ? 'jnull' : typeof value}`, JSON.stringify(value)));
    return row;
  }
  const d = h('details', 'jt');
  d.open = true;
  const isArr = Array.isArray(value);
  const n = isArr ? value.length : Object.keys(value).length;
  d.append(h('summary', null, `${key !== undefined ? `${key}: ` : ''}${isArr ? `[ ${n} ]` : `{ ${n} }`}`));
  for (const [k, v] of Object.entries(value)) d.append(tree(v, isArr ? Number(k) : k));
  return d;
}

const meta = (r, extra = '') => h('div', 'rmeta', `${extra}${extra ? ' · ' : ''}${r.elapsedMs ?? 0} ms${r.truncated ? ' · truncated (500 rows / 1 MB limit)' : ''}`);

export function renderResult(r) {
  const box = h('div', `result ${r.kind}`);
  switch (r.kind) {
    case 'rows': {
      const t = h('table', 'grid');
      const tr = h('tr');
      r.columns.forEach((c) => tr.append(h('th', null, c)));
      const thead = h('thead');
      thead.append(tr);
      t.append(thead);
      const tb = h('tbody');
      for (const row of r.rows) {
        const x = h('tr');
        for (const c of r.columns) {
          const v = row[c];
          const td = h('td');
          if (v !== null && typeof v === 'object') td.append(tree(v));
          else td.textContent = v === null ? 'NULL' : String(v);
          x.append(td);
        }
        tb.append(x);
      }
      t.append(tb);
      box.append(t, meta(r, `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}`));
      break;
    }
    case 'docs':
      r.docs.forEach((d) => box.append(tree(d)));
      box.append(meta(r, `${r.count} document${r.count === 1 ? '' : 's'}`));
      break;
    case 'dml': box.append(h('div', 'msg', `${r.rowsAffected} rows affected`), meta(r)); break;
    case 'ok': box.append(h('div', 'msg', 'Statement executed'), meta(r)); break;
    case 'count': box.append(h('div', 'msg', `count: ${r.count}`), meta(r)); break;
    case 'collections': box.append(h('div', 'msg', r.names.join('  ·  ') || '(no collections)'), meta(r)); break;
    case 'write': box.append(tree(r.result), meta(r)); break;
    case 'error': box.append(h('div', 'msg', r.error), meta(r, r.code ?? 'error')); box.classList.add('error'); break;
    default: box.append(h('div', 'msg', JSON.stringify(r)));
  }
  return box;
}

export function renderRun(run) {
  const wrap = h('div', 'run');
  if (run.cached) wrap.append(h('span', 'badge cool', 'served from cache'));
  run.results.forEach((r) => wrap.append(renderResult(r)));
  return wrap;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd app && npx vitest run test/unit/results.test.js`
Expected: 6 passed.

- [ ] **Step 6: Write the vendor build (CodeMirror 6 + fonts, offline)**

```js
// app/build/cm-entry.js
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { sql, PLSQL } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';

export function createEditor(parent, { lang, doc = '', onRun }) {
  const view = new EditorView({
    parent,
    doc,
    extensions: [
      basicSetup,
      lang === 'sql' ? sql({ dialect: PLSQL }) : javascript(),
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { onRun?.(); return true; } }])),
      EditorView.lineWrapping,
    ],
  });
  return {
    get: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
  };
}
```

```js
// app/build/vendor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/vendor');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

await build({ entryPoints: [path.join(root, 'build/cm-entry.js')], bundle: true, format: 'esm', minify: true, outfile: path.join(out, 'cm.js') });

const FONTS = [
  ['bricolage-grotesque', 'Bricolage Grotesque', [600, 700, 800]],
  ['public-sans', 'Public Sans', [400, 500, 600, 700]],
  ['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 600]],
];
let css = '';
for (const [pkg, family, weights] of FONTS) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    const src = path.join(root, 'node_modules/@fontsource', pkg, 'files', file);
    if (!fs.existsSync(src)) throw new Error(`missing font file ${src}`);
    fs.copyFileSync(src, path.join(out, 'fonts', file));
    css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2');}\n`;
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
console.log('vendor: cm.js + fonts.css written');
```

Run: `cd app && npm run build:vendor` → prints `vendor: cm.js + fonts.css written`; `ls public/vendor public/vendor/fonts` shows `cm.js`, `fonts.css` and 10 `.woff2` files.

- [ ] **Step 7: Write the stylesheet (deck tokens) and the page shell**

```css
/* app/public/css/lab.css */
:root {
  --paper: #F6F8F9; --panel: #FFFFFF; --ink: #1C2733; --muted: #5A6B7C; --faint: #8B99A7; --hairline: #D8DEE4;
  --hot: #B3372B; --hot-soft: rgba(179,55,43,.10); --cool: #0E8A63; --cool-soft: rgba(14,138,99,.10);
  --flow: #2563EB; --flow-soft: rgba(37,99,235,.10); --chip: #EDF1F4;
  --sans: 'Public Sans', 'Segoe UI', system-ui, sans-serif; --head: 'Bricolage Grotesque', var(--sans); --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --dock: 42vh;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #131A22; --panel: #1A232E; --ink: #E8EDF2; --muted: #93A3B4; --faint: #6B7B8C; --hairline: #26313D;
    --hot: #E06552; --hot-soft: rgba(224,101,82,.14); --cool: #21A57F; --cool-soft: rgba(33,165,127,.14);
    --flow: #60A5FA; --flow-soft: rgba(96,165,250,.16); --chip: #222D39;
  }
}
:root[data-theme="dark"] {
  --paper: #131A22; --panel: #1A232E; --ink: #E8EDF2; --muted: #93A3B4; --faint: #6B7B8C; --hairline: #26313D;
  --hot: #E06552; --hot-soft: rgba(224,101,82,.14); --cool: #21A57F; --cool-soft: rgba(33,165,127,.14);
  --flow: #60A5FA; --flow-soft: rgba(96,165,250,.16); --chip: #222D39;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--paper); color: var(--ink); font: 15px/1.5 var(--sans); }
header.top { display: flex; align-items: center; gap: 16px; padding: 10px 24px; border-bottom: 1px solid var(--hairline); background: var(--panel); }
header.top .brand { font: 700 15px var(--head); }
header.top .who { margin-left: auto; font: 12px var(--mono); color: var(--muted); }
main#view { padding: 20px 24px calc(var(--dock) + 24px); max-width: 1180px; margin: 0 auto; }
h1, h2, h3 { font-family: var(--head); margin: 0 0 8px; }
h1 { font-size: 30px; font-weight: 800; }
.kicker { font: 600 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--cool); }
.problem { color: var(--muted); max-width: 72ch; }
.knobs { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
.knob { font: 12px var(--mono); background: var(--chip); border-radius: 16px; padding: 3px 11px; color: var(--muted); }
.knob b { color: var(--ink); } .knob.hot { background: var(--hot-soft); color: var(--hot); } .knob.hot b { color: var(--hot); }
.patterns { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.pcard { display: block; text-decoration: none; color: inherit; background: var(--panel); border: 1px solid var(--hairline); border-left: 4px solid var(--cool); border-radius: 10px; padding: 14px 16px; }
.pcard:hover { border-color: var(--muted); }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--hairline); margin: 14px 0; flex-wrap: wrap; }
.tabs button { font: 600 13px var(--sans); background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; color: var(--muted); cursor: pointer; }
.tabs button.on { color: var(--ink); border-bottom-color: var(--cool); }
.card { background: var(--panel); border: 1px solid var(--hairline); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
.card h3 { font-size: 15px; font-weight: 700; }
.card .note { color: var(--muted); font-size: 13.5px; margin: 0 0 8px; }
.card.measure { border-left: 3px solid var(--flow); }
pre.code { font: 12.5px/1.5 var(--mono); background: var(--chip); border-radius: 6px; padding: 10px 12px; overflow-x: auto; margin: 0 0 8px; white-space: pre; }
.actions { display: flex; gap: 8px; }
button.btn { font: 600 13px var(--sans); color: var(--ink); background: var(--panel); border: 1px solid var(--hairline); border-radius: 7px; padding: 5px 12px; cursor: pointer; }
button.btn:hover { border-color: var(--muted); } button.btn.primary { background: var(--cool); color: #fff; border-color: var(--cool); }
button.btn:disabled { opacity: .5; cursor: default; }
.badge { font: 600 11px var(--mono); border-radius: 12px; padding: 2px 9px; display: inline-block; margin-bottom: 6px; }
.badge.cool { background: var(--cool-soft); color: var(--cool); } .badge.hot { background: var(--hot-soft); color: var(--hot); }
.result { margin: 6px 0; } .result .msg { font: 13px var(--mono); } .result.error .msg { color: var(--hot); }
.rmeta { font: 11.5px var(--mono); color: var(--faint); margin-top: 4px; }
table.grid { border-collapse: collapse; font: 12.5px var(--mono); width: 100%; }
table.grid th, table.grid td { border-bottom: 1px solid var(--hairline); padding: 4px 8px; text-align: left; vertical-align: top; }
table.grid th { color: var(--faint); font-weight: 600; }
details.jt { font: 12.5px var(--mono); margin-left: 12px; } details.jt > summary { cursor: pointer; color: var(--muted); }
.jv { margin-left: 24px; font: 12.5px var(--mono); } .jk { color: var(--flow); } .jval.string { color: var(--cool); } .jnull { color: var(--faint); }
#console { position: fixed; left: 0; right: 0; bottom: 0; height: var(--dock); background: var(--panel); border-top: 1px solid var(--hairline); display: grid; grid-template-rows: auto 1fr auto; }
#console .bar { display: flex; align-items: center; gap: 8px; padding: 6px 16px; border-bottom: 1px solid var(--hairline); }
#console .bar .tabs { border: 0; margin: 0; }
#console .status { margin-left: auto; font: 12px var(--mono); color: var(--muted); }
#console .panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 0; }
#console .editor { border-right: 1px solid var(--hairline); overflow: auto; min-height: 0; }
#console .out { overflow: auto; padding: 8px 14px; min-height: 0; }
.cm-editor { height: 100%; font-size: 13px; } .cm-editor .cm-content { font-family: var(--mono); }
.measure-table { width: 100%; border-collapse: collapse; font: 13px var(--mono); margin-bottom: 10px; }
.measure-table td, .measure-table th { padding: 4px 8px; border-bottom: 1px solid var(--hairline); text-align: right; }
.measure-table th:first-child, .measure-table td:first-child { text-align: left; }
.signin { max-width: 420px; margin: 60px auto; background: var(--panel); border: 1px solid var(--hairline); border-radius: 12px; padding: 22px; }
.signin label { display: block; font-size: 13px; color: var(--muted); margin-top: 10px; }
.signin input { width: 100%; font: 15px var(--sans); padding: 7px 10px; border: 1px solid var(--hairline); border-radius: 7px; background: var(--paper); color: var(--ink); }
.flash { color: var(--hot); font-size: 13px; margin-top: 8px; }
@media (max-width: 800px) { #console .panes { grid-template-columns: 1fr; } :root { --dock: 55vh; } }
```

```html
<!-- app/public/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Converged Modeling Lab</title>
<link rel="stylesheet" href="/vendor/fonts.css">
<link rel="stylesheet" href="/css/lab.css">
</head>
<body>
<header class="top">
  <a class="brand" href="#/">Converged Modeling Lab</a>
  <span class="kicker">Oracle AI Database 26ai</span>
  <span class="who" id="who"></span>
</header>
<main id="view" aria-live="polite"></main>
<section id="console" aria-label="Console">
  <div class="bar">
    <div class="tabs" role="tablist">
      <button type="button" data-lane="sql" class="on">SQL</button>
      <button type="button" data-lane="mongo">MongoDB</button>
    </div>
    <button type="button" class="btn primary" id="run">Run ⌘/Ctrl+Enter</button>
    <span class="status" id="status">ready</span>
  </div>
  <div class="panes">
    <div class="editor" id="editor-sql"></div>
    <div class="editor" id="editor-mongo" hidden></div>
    <div class="out" id="out"></div>
  </div>
</section>
<script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 8: Commit**

```bash
git add app/package.json app/package-lock.json app/build app/public/index.html app/public/css app/public/js/api.js app/public/js/results.js app/test/unit/results.test.js
git commit -m "feat(lab-ui): offline vendor bundle, deck-styled shell and safe results renderer"
```

---
### Task 14: Frontend behaviour — console, pattern pages, measure-it, sign-in, admin

**Files:**
- Create: `app/public/js/console.js`, `app/public/js/measure.js`, `app/public/js/app.js`, `app/public/admin.html`, `app/public/js/admin.js`
- Modify: `app/public/index.html` (add the History button)
- Test: `app/test/unit/measure.test.js` (the page scripts are exercised end-to-end by the smoke test in Task 16)

**Interfaces:**
- Consumes: `getJSON`/`postJSON`, `renderRun` (Task 13); `/vendor/cm.js` `createEditor`; the HTTP API (Task 12).
- Produces:
  - `console.js`: `exec({ lane, text, patternId }, onStatus) → Promise<{ ok: true, run } | { ok: false, message }>` (polls `/api/queue` every 750 ms while waiting; maps 401/409/423/429 to friendly messages); `class Console(rootEl)` with `show(lane)`, `load(lane, text)`, `setPattern(id)`, `run()`, `showHistory()`.
  - `measure.js`: `renderMeasure(measureResult) → HTMLElement` — table of the four stat deltas plus rows affected and elapsed, and an SVG bar chart of `redo size` and `db block changes` (document = hot, converged = cool).

- [ ] **Step 1: Write the failing measure renderer test**

```js
// app/test/unit/measure.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const side = (redo, blocks, rows) => ({
  sql: 'UPDATE x SET y = 1',
  stats: { 'redo size': redo, 'db block changes': blocks, 'session logical reads': 10, 'CPU used by this session': 0 },
  result: { kind: 'dml', rowsAffected: rows, elapsedMs: 4 },
});

describe('renderMeasure', () => {
  it('tabulates both sides and draws four bars', () => {
    const el = renderMeasure({ tag: 'advisor-move', document: side(12000, 40, 2), converged: side(600, 4, 1) });
    expect(el.querySelector('table').textContent).toContain('redo size');
    expect(el.textContent).toContain('12,000');
    expect(el.textContent).toContain('20.0×');
    expect(el.querySelectorAll('svg rect.bar')).toHaveLength(4);
  });
  it('shows an error side instead of numbers', () => {
    const el = renderMeasure({ tag: 't', document: { sql: 'x', stats: {}, result: { kind: 'error', code: 'ORA-00942', error: 'nope', elapsedMs: 0 } }, converged: side(1, 1, 1) });
    expect(el.textContent).toContain('ORA-00942');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run test/unit/measure.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `measure.js`**

```js
// app/public/js/measure.js
const SVGNS = 'http://www.w3.org/2000/svg';
const STATS = ['redo size', 'db block changes', 'session logical reads', 'CPU used by this session'];
const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const s = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = String(text); return e; };

export function renderMeasure(m) {
  const box = h('div', 'measure-out');
  for (const [name, sd] of [['document model', m.document], ['converged', m.converged]]) {
    if (sd.result.kind === 'error') box.append(h('div', 'result error', `${name}: ${sd.result.code ?? ''} ${sd.result.error}`));
  }
  const t = h('table', 'measure-table');
  const head = h('tr');
  ['', 'Document model', 'Converged', 'Ratio'].forEach((c) => head.append(h('th', null, c)));
  t.append(head);
  const rows = [...STATS.map((n) => [n, m.document.stats[n], m.converged.stats[n]]),
    ['rows affected', m.document.result.rowsAffected, m.converged.result.rowsAffected],
    ['elapsed ms', m.document.result.elapsedMs, m.converged.result.elapsedMs]];
  for (const [n, d, c] of rows) {
    const tr = h('tr');
    tr.append(h('td', null, n), h('td', 'hot', fmt(d)), h('td', 'cool', fmt(c)), h('td', null, c ? `${(d / c).toFixed(1)}×` : '—'));
    t.append(tr);
  }
  box.append(t);

  const W = 560; const H = 150; const x0 = 150; const maxW = W - x0 - 90;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'redo size and block changes, document model vs converged' });
  ['redo size', 'db block changes'].forEach((stat, gi) => {
    const d = m.document.stats[stat] ?? 0; const c = m.converged.stats[stat] ?? 0;
    const max = Math.max(d, c, 1);
    const y = 20 + gi * 62;
    svg.append(s('text', { x: 16, y: y + 22, 'font-size': 12, fill: 'var(--muted)' }, stat));
    [[d, 'var(--hot)', 0], [c, 'var(--cool)', 24]].forEach(([v, color, dy]) => {
      const w = Math.max(2, Math.round((v / max) * maxW));
      svg.append(s('rect', { class: 'bar', x: x0, y: y + dy, width: w, height: 18, rx: 3, fill: color }));
      svg.append(s('text', { x: x0 + w + 8, y: y + dy + 13, 'font-size': 11.5, fill: 'var(--ink)' }, fmt(v)));
    });
  });
  box.append(svg);
  return box;
}
```

Run: `cd app && npx vitest run test/unit/measure.test.js` → 2 passed.

- [ ] **Step 4: Add the History button to the console bar in `index.html`**

In `app/public/index.html`, directly after the `<button … id="run">` line, add:

```html
    <button type="button" class="btn" id="history">History</button>
```

- [ ] **Step 5: Implement `console.js`**

```js
// app/public/js/console.js
import { createEditor } from '/vendor/cm.js';
import { getJSON, postJSON } from './api.js';
import { renderRun } from './results.js';

const MESSAGES = { 401: 'please sign in again', 409: 'you already have a request queued', 423: 'paused by instructor', 429: 'busy — the database is serving others, try again' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export async function exec({ lane, text, patternId }, onStatus) {
  let done = false;
  onStatus('running…');
  const poll = (async () => {
    await sleep(400);
    while (!done) {
      const q = await getJSON('/api/queue').catch(() => null);
      if (!done && q?.body) onStatus(q.body.paused ? 'paused by instructor' : q.body.position === null ? 'running…' : `queued · ${q.body.position} ahead`);
      await sleep(750);
    }
  })();
  try {
    const r = await postJSON('/api/run', { lane, patternId, text });
    if (r.status === 200) return { ok: true, run: r.body };
    return { ok: false, message: MESSAGES[r.status] ?? r.body?.error ?? `error ${r.status}` };
  } catch {
    return { ok: false, message: 'network error' };
  } finally {
    done = true;
    await poll.catch(() => {});
  }
}

export class Console {
  constructor(root) {
    this.root = root;
    this.lane = 'sql';
    this.patternId = null;
    this.statusEl = root.querySelector('#status');
    this.out = root.querySelector('#out');
    this.editors = {
      sql: createEditor(root.querySelector('#editor-sql'), { lang: 'sql', doc: store.get('lab.last.sql') ?? 'SELECT 1 FROM dual', onRun: () => this.run() }),
      mongo: createEditor(root.querySelector('#editor-mongo'), { lang: 'mongo', doc: store.get('lab.last.mongo') ?? 'show collections', onRun: () => this.run() }),
    };
    root.querySelectorAll('.bar [data-lane]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.lane)));
    root.querySelector('#run').addEventListener('click', () => this.run());
    root.querySelector('#history').addEventListener('click', () => this.showHistory());
  }

  show(lane) {
    this.lane = lane;
    this.root.querySelectorAll('.bar [data-lane]').forEach((b) => b.classList.toggle('on', b.dataset.lane === lane));
    this.root.querySelector('#editor-sql').hidden = lane !== 'sql';
    this.root.querySelector('#editor-mongo').hidden = lane !== 'mongo';
    this.editors[lane].focus();
  }

  load(lane, text) {
    this.show(lane);
    this.editors[lane].set(text);
    this.editors[lane].focus();
  }

  setPattern(id) {
    this.patternId = id;
  }

  async run() {
    const lane = this.lane;
    const text = this.editors[lane].get();
    if (!text.trim()) return;
    store.set(`lab.last.${lane}`, text);
    const hist = (store.get(`lab.hist.${lane}`) ?? []).filter((t) => t !== text);
    store.set(`lab.hist.${lane}`, [text, ...hist].slice(0, 20));
    const btn = this.root.querySelector('#run');
    btn.disabled = true;
    const r = await exec({ lane, text, patternId: this.patternId }, (s) => { this.statusEl.textContent = s; });
    btn.disabled = false;
    this.statusEl.textContent = r.ok ? 'ready' : r.message;
    this.out.replaceChildren(r.ok ? renderRun(r.run) : Object.assign(document.createElement('div'), { className: 'result error', textContent: r.message }));
  }

  showHistory() {
    const list = document.createElement('div');
    const items = store.get(`lab.hist.${this.lane}`) ?? [];
    if (!items.length) list.textContent = 'No history yet.';
    for (const t of items) {
      const pre = Object.assign(document.createElement('pre'), { className: 'code', textContent: t, title: 'Click to load' });
      pre.style.cursor = 'pointer';
      pre.addEventListener('click', () => this.load(this.lane, t));
      list.append(pre);
    }
    this.out.replaceChildren(list);
  }
}
```

- [ ] **Step 6: Implement `app.js`**

```js
// app/public/js/app.js
import { getJSON, postJSON } from './api.js';
import { Console, exec } from './console.js';
import { renderRun } from './results.js';
import { renderMeasure } from './measure.js';

const view = document.getElementById('view');
const who = document.getElementById('who');
let config; let patterns = []; let cons;

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const btn = (label, onClick, cls = 'btn') => { const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
const MSG = { 409: 'you already have a request queued', 423: 'paused by instructor', 429: 'busy — try again' };

async function copy(text, b) {
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select & copy'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1200);
}

function card(title, notes, code, lane, patternId, measureTag) {
  const c = h('div', 'card');
  if (measureTag) c.append(h('span', 'badge hot', `measured: ${measureTag}`));
  c.append(h('h3', null, title));
  notes.forEach((n) => c.append(h('p', 'note', n)));
  c.append(h('pre', 'code', code));
  const out = h('div', 'card-out');
  const copyBtn = btn('Copy', () => copy(code, copyBtn));
  const runBtn = btn('Run', async () => {
    runBtn.disabled = true;
    const r = await exec({ lane, text: code, patternId }, (s) => { out.textContent = s; });
    runBtn.disabled = false;
    out.replaceChildren(r.ok ? renderRun(r.run) : h('div', 'result error', r.message));
  });
  const actions = h('div', 'actions');
  actions.append(copyBtn, btn('Load into console', () => cons.load(lane, code)), runBtn);
  c.append(actions, out);
  return c;
}

function measureCard(p, m) {
  const c = h('div', 'card measure');
  c.append(h('h3', null, `Measure it · ${m.tag}`),
    h('p', 'note', 'Runs both writes back to back in one exclusive slot, reads the engine statistics before and after each, then rolls both back.'),
    h('div', 'kicker', 'Document model'), h('pre', 'code', m.documentSql),
    h('div', 'kicker', 'Converged'), h('pre', 'code', m.convergedSql));
  const out = h('div', 'card-out');
  const b = btn('Measure it', async () => {
    b.disabled = true; out.textContent = 'measuring… (waits for an exclusive slot)';
    const r = await postJSON('/api/measure', { patternId: p.id, tag: m.tag });
    b.disabled = false;
    out.replaceChildren(r.status === 200 ? renderMeasure(r.body) : h('div', 'result error', MSG[r.status] ?? r.body?.error ?? `error ${r.status}`));
  }, 'btn primary');
  c.append(b, out);
  return c;
}

function home() {
  cons.setPattern(null);
  const grid = h('div', 'patterns');
  patterns.forEach((p, i) => {
    const a = h('a', 'pcard');
    a.href = `#/p/${p.id}`;
    a.append(h('div', 'kicker', `Pattern ${i + 1} · ${p.meta.industry}`), h('h3', null, p.meta.title), h('p', 'problem', p.meta.problem), h('div', 'rmeta', `Deck slides ${p.meta.deck}`));
    grid.append(a);
  });
  view.replaceChildren(h('h1', null, 'Model the domain, not the engine'),
    h('p', 'problem', 'Six document-modeling patterns, each with the document-model starting point and the converged alternative. Copy a query, change it, run it in the console below — SQL or the MongoDB API, same data.'), grid);
}

function patternPage(id) {
  const p = patterns.find((x) => x.id === id);
  if (!p) return home();
  cons.setPattern(id);
  const n = patterns.indexOf(p) + 1;
  const head = h('div');
  const knobs = h('div', 'knobs');
  p.meta.knobs.forEach((k) => { const s = h('span', `knob${k.hot ? ' hot' : ''}`); s.append(h('b', null, `${k.name}: `), document.createTextNode(k.setting)); knobs.append(s); });
  const status = h('span', 'rmeta');
  const reset = btn('Reset this pattern', async () => {
    reset.disabled = true; status.textContent = 'resetting…';
    const r = await postJSON('/api/reset', { patternId: id });
    reset.disabled = false;
    status.textContent = r.status === 200 ? (r.body.ok ? 'reset done' : `reset failed: ${r.body.errors[0]?.error}`) : (MSG[r.status] ?? `error ${r.status}`);
  });
  head.append(h('div', 'kicker', `Pattern ${n} · ${p.meta.industry} · deck slides ${p.meta.deck}`), h('h1', null, p.meta.title), h('p', 'problem', p.meta.problem), knobs, reset, status);

  const tabs = [
    ['Document model', () => p.cards.document.map((c) => card(c.title, c.notes, c.sql, 'sql', id, c.measure))],
    ['Converged', () => p.cards.converged.map((c) => card(c.title, c.notes, c.sql, 'sql', id, c.measure))],
    ...(p.cards.mongo.length ? [['MongoDB API', () => p.cards.mongo.map((c) => card(c.title, c.notes, c.command, 'mongo', id, null))]] : []),
    ['Measure it', () => p.measures.map((m) => measureCard(p, m))],
  ];
  const bar = h('div', 'tabs');
  const body = h('div');
  const select = (i) => {
    [...bar.children].forEach((b, j) => b.classList.toggle('on', i === j));
    body.replaceChildren(...tabs[i][1]());
  };
  tabs.forEach(([label], i) => bar.append(btn(label, () => select(i), '')));
  view.replaceChildren(head, bar, body);
  select(0);
}

function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) patternPage(m[1]); else home();
  window.scrollTo(0, 0);
}

function signin() {
  const f = h('form', 'signin');
  f.append(h('h2', null, 'Join the lab'), h('p', 'problem', 'Your own workspace is created on first sign-in. Use the same email to come back to it.'));
  const field = (label, name, type = 'text') => { const l = h('label', null, label); const i = h('input'); i.name = name; i.type = type; i.required = name !== 'code'; l.append(i); f.append(l); };
  field('Name', 'name'); field('Email', 'email', 'email');
  if (config.eventCodeRequired) field('Event code', 'code');
  const flash = h('div', 'flash');
  const submit = h('button', 'btn primary', 'Sign in'); submit.type = 'submit';
  f.append(submit, flash);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; flash.textContent = 'setting up your workspace…';
    const d = Object.fromEntries(new FormData(f));
    const r = await postJSON('/api/signin', d);
    submit.disabled = false;
    if (r.status === 200) { flash.textContent = ''; boot(); } else flash.textContent = r.body?.error ?? MSG[r.status] ?? `error ${r.status}`;
  });
  document.getElementById('console').hidden = true;
  view.replaceChildren(f);
}

async function boot() {
  config = (await getJSON('/api/config')).body;
  const me = await getJSON('/api/me');
  if (me.status === 401) return signin();
  document.getElementById('console').hidden = false;
  who.textContent = config.mode === 'solo' ? 'solo · CMP_USER' : `${me.body.user.name} · ${me.body.user.schema}`;
  patterns = (await getJSON('/api/patterns')).body;
  cons ??= new Console(document.getElementById('console'));
  window.onhashchange = route;
  route();
}

boot();
```

- [ ] **Step 7: Implement the admin page**

```html
<!-- app/public/admin.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lab Admin</title>
<link rel="stylesheet" href="/vendor/fonts.css">
<link rel="stylesheet" href="/css/lab.css">
</head>
<body>
<header class="top"><span class="brand">Lab Admin</span><span class="kicker">Instructor</span></header>
<main id="view" style="padding-bottom:24px"></main>
<script type="module" src="/js/admin.js"></script>
</body>
</html>
```

```js
// app/public/js/admin.js
import { getJSON, postJSON } from './api.js';

const view = document.getElementById('view');
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const btn = (label, onClick, cls = 'btn') => { const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
let timer;

function login(msg = '') {
  const f = h('form', 'signin');
  const l = h('label', null, 'Admin password'); const i = h('input'); i.type = 'password'; i.name = 'password'; l.append(i);
  const s = h('button', 'btn primary', 'Sign in'); s.type = 'submit';
  f.append(h('h2', null, 'Instructor sign-in'), l, s, h('div', 'flash', msg));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await postJSON('/api/admin/login', { password: i.value });
    if (r.status === 200) render(); else login(r.body?.error ?? 'sign-in failed');
  });
  view.replaceChildren(f);
}

async function render() {
  clearTimeout(timer);
  const r = await getJSON('/api/admin/status');
  if (r.status === 401) return login();
  if (r.status === 404) { view.replaceChildren(h('p', 'problem', 'The admin page is only available in event mode (LAB_MODE=event).')); return; }
  const { gate, cache, attendees } = r.body;
  const top = h('div', 'card');
  top.append(h('h3', null, `Queue: ${gate.queued.length} waiting · ${gate.running.length} running · ${gate.paused ? 'PAUSED' : 'live'}`));
  gate.running.forEach((x) => {
    const row = h('div', 'actions');
    row.append(h('span', 'rmeta', `${x.userId} · ${x.label} · ${Math.round(x.elapsedMs / 100) / 10}s`), btn('Cancel', async () => { await postJSON('/api/admin/cancel', { id: x.id }); render(); }));
    top.append(row);
  });
  const controls = h('div', 'actions');
  const n = h('input'); n.type = 'number'; n.min = 1; n.max = 200; n.value = 10; n.style.width = '70px';
  controls.append(
    btn(gate.paused ? 'Resume execution' : 'Pause execution', async () => { await postJSON('/api/admin/pause', { on: !gate.paused }); render(); }, 'btn primary'),
    btn(`Cache: ${cache.enabled ? 'on' : 'off'} (${cache.size})`, async () => { await postJSON('/api/admin/cache', { enabled: !cache.enabled }); render(); }),
    n, btn('Pre-warm workspaces', async () => { await postJSON('/api/admin/prewarm', { count: Number(n.value) }); render(); }),
    btn(`Timeouts: ${r.body.timeouts.sqlMs / 1000}s`, async () => {
      const v = Number(prompt('Statement timeout in seconds (1–60)', String(r.body.timeouts.sqlMs / 1000)));
      if (Number.isFinite(v)) { await postJSON('/api/admin/timeouts', { sqlMs: Math.round(v * 1000), mongoMs: Math.round(v * 1000) }); render(); }
    }),
    btn('Reset every attendee', async () => {
      if (!confirm('Rebuild every pattern in every workspace? This queues behind attendee work.')) return;
      await postJSON('/api/admin/reset-attendee', { schema: '*' }); render();
    }),
    btn('End event (drop all workspaces)', async () => {
      if (prompt('Type END to drop every attendee workspace') !== 'END') return;
      const x = await postJSON('/api/admin/end-event', {});
      alert(`Dropped ${x.body?.dropped ?? 0} workspaces`); render();
    }),
  );
  top.append(controls);
  const t = h('table', 'grid');
  const head = h('tr'); ['Schema', 'Name', 'Email', 'Built patterns', ''].forEach((c) => head.append(h('th', null, c)));
  t.append(head);
  attendees.forEach((a) => {
    const tr = h('tr');
    const td = h('td'); td.append(btn('Reset all patterns', async () => { await postJSON('/api/admin/reset-attendee', { schema: a.schema }); render(); }));
    tr.append(h('td', null, a.schema), h('td', null, a.name ?? '(prewarmed)'), h('td', null, a.email ?? ''), h('td', null, a.built.length), td);
    t.append(tr);
  });
  const list = h('div', 'card'); list.append(h('h3', null, `Attendees (${attendees.length})`), t);
  view.replaceChildren(top, list);
  timer = setTimeout(render, 2000);
}

render();
```

- [ ] **Step 8: Try it by hand**

With the database up: `cd app && npm run build:vendor && DB_HOST=localhost DB_PORT=1522 MONGO_HOST=localhost MONGO_PORT=27018 npm start`, open `http://localhost:3000`, open a pattern, run a card, load one into the console and run it, measure a pair, reset. Then restart with `LAB_MODE=event ADMIN_PASSWORD=x EVENT_CODE=LAB26` and exercise sign-in and `/admin.html`. Fix anything broken before committing.

- [ ] **Step 9: Commit**

```bash
git add app/public app/test/unit/measure.test.js
git commit -m "feat(lab-ui): console, pattern pages, measure-it view, sign-in and admin page"
```

---
### Task 15: Container, compose services and `run.sh` stage 3

**Files:**
- Create: `app/Dockerfile`, `.dockerignore` (repo root)
- Modify: `compose.yml` (add `lab-ui` and `lab-ui-test`), `run.sh` (stage 3)

**Interfaces:**
- Consumes: the whole app.
- Produces: `docker compose up -d` starts `cmp-lab-ui` on host port `${CMP_UI_PORT:-3100}`; `docker compose --profile test run --rm lab-ui-test` runs every vitest suite against the `oracle` service; `./run.sh` reports **19** results (18 lab scripts + 1 app suite).

- [ ] **Step 1: Write the Dockerfile (build context = repo root, so `patterns/` is available)**

```dockerfile
# app/Dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build:vendor

FROM deps AS test
COPY patterns /patterns
ENV PATTERNS_DIR=/patterns
CMD ["npx", "vitest", "run"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=deps /app/src ./src
COPY --from=deps /app/sql ./sql
COPY --from=deps /app/public ./public
COPY patterns /patterns
ENV PATTERNS_DIR=/patterns PORT=3000
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
```

The unit tests resolve `../../../patterns` from `/app/test/unit`, which is `/patterns` in the test image — the same files.

```gitignore
# .dockerignore (repo root)
.git
app/node_modules
app/public/vendor
app/test/artifacts
docs
```

- [ ] **Step 2: Add the services to `compose.yml`** (under `services:`, after `oracle`)

```yaml
  lab-ui:
    build:
      context: .
      dockerfile: app/Dockerfile
      target: runtime
    image: converged-modeling-patterns-lab-ui:latest
    container_name: cmp-lab-ui
    depends_on:
      oracle:
        condition: service_healthy
    ports:
      - '${CMP_UI_PORT:-3100}:3000'          # hands-on console (non-default host port)
    environment:
      LAB_MODE: '${LAB_MODE:-solo}'           # solo | event
      ADMIN_PASSWORD: '${ADMIN_PASSWORD:-}'   # required when LAB_MODE=event
      EVENT_CODE: '${EVENT_CODE:-}'
      ORACLE_PASSWORD: '${ORACLE_PASSWORD:-Sandbox2026}'
      CMP_PASSWORD: '${CMP_PASSWORD:-CmpUser2026}'
      LAB_ADMIN_PASSWORD: '${LAB_ADMIN_PASSWORD:-LabAdmin2026}'
      DB_POOL_MAX: '${DB_POOL_MAX:-1}'
      MONGO_POOL_MAX: '${MONGO_POOL_MAX:-1}'

  lab-ui-test:
    profiles: ['test']
    build:
      context: .
      dockerfile: app/Dockerfile
      target: test
    depends_on:
      oracle:
        condition: service_healthy
    environment:
      DB_HOST: oracle
      DB_PORT: '1521'
      MONGO_HOST: oracle
      MONGO_PORT: '27017'
      ORACLE_PASSWORD: '${ORACLE_PASSWORD:-Sandbox2026}'
      CMP_PASSWORD: '${CMP_PASSWORD:-CmpUser2026}'
```

- [ ] **Step 3: Add stage 3 to `run.sh`**

Insert immediately before the line `echo ""; echo "==================================================================="`:

```bash
# Stage 3: the hands-on console's own tests (unit + integration) against this database.
# Skipped when a single pattern is requested.
if [ -z "$FILTER" ]; then
  echo ""; echo "################  lab console (app/)  ################"
  if docker compose --profile test run --rm --build lab-ui-test; then
    echo "     [PASS] lab-ui tests"; pass=$((pass+1))
  else
    echo "     [FAIL] lab-ui tests"; fail=$((fail+1)); failed="$failed lab-ui-tests"
  fi
fi
```

Also update the result banner comment at the top of `run.sh` to mention stage 3 in one line: `# Stage 3:   the lab console's vitest suites (app/), in a throwaway container.`

- [ ] **Step 4: Verify**

```bash
docker compose build lab-ui lab-ui-test
docker compose up -d
until curl -fsS http://localhost:3100/api/config; do sleep 5; done; echo
./run.sh
```

Expected: `curl` prints `{"mode":"solo","eventCodeRequired":false}`; `./run.sh` ends with `RESULT: 19 passed, 0 failed`. Open `http://localhost:3100` and confirm the fonts load with the network tab showing no requests outside `localhost:3100`.

- [ ] **Step 5: Commit**

```bash
git add app/Dockerfile .dockerignore compose.yml run.sh
git commit -m "feat(lab-ui): lab-ui container, test profile and run.sh stage 3"
```

---

### Task 16: Smoke test (headless browser) and load test (150 attendees)

**Files:**
- Create: `app/test/smoke/smoke.mjs`, `app/test/load/load.mjs`

**Interfaces:**
- Consumes: a running `lab-ui` (`LAB_URL`, default `http://localhost:3100`); Chrome/Chromium on the host (`CHROME_PATH`, else auto-detected); for the load test, event mode and `LAB_ADMIN` credentials for session sampling.
- Produces: `npm run test:smoke` (exit 0 = pass; screenshots in `app/test/artifacts/`), `npm run test:load` (exit 0 = all load assertions hold; prints a JSON report).

- [ ] **Step 1: Write the smoke test**

```js
// app/test/smoke/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const URL = process.env.LAB_URL ?? 'http://localhost:3100';
const OUT = path.resolve(import.meta.dirname, '../artifacts');
fs.mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH
  ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    .map((c) => { try { return execSync(`command -v ${c}`).toString().trim(); } catch { return null; } }).find(Boolean);
if (!chrome) { console.error('no Chrome found; set CHROME_PATH'); process.exit(2); }

const fail = (m) => { console.error(`SMOKE FAIL: ${m}`); process.exit(1); };
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle0' });
    const cards = await page.$$('.pcard');
    if (cards.length !== 6) fail(`expected 6 pattern cards, got ${cards.length}`);
    await page.screenshot({ path: path.join(OUT, `home-${scheme}.png`) });
    for (const id of ['01-extended-reference', '03-bucket']) {
      await page.goto(`${URL}/#/p/${id}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.card');
      const runButtons = await page.$$('.card .actions button:nth-child(3)');
      await runButtons[0].click();
      await page.waitForSelector('.card-out .result', { timeout: 60000 });
      const errs = await page.$$('.card-out .result.error');
      if (errs.length) fail(`${id}: first card returned an error`);
      const loadButtons = await page.$$('.card .actions button:nth-child(2)');
      await loadButtons[0].click();
      await page.click('#run');
      await page.waitForSelector('#out .result', { timeout: 60000 });
      await page.screenshot({ path: path.join(OUT, `${id}-cards-${scheme}.png`) });
      const tabs = await page.$$('.tabs button');
      await tabs[tabs.length - 1].click(); // Measure it
      await page.click('.card.measure .btn.primary');
      await page.waitForSelector('.measure-out svg', { timeout: 60000 });
      await page.screenshot({ path: path.join(OUT, `${id}-measure-${scheme}.png`), fullPage: true });
    }
    if (external.length) fail(`external requests: ${external.join(', ')}`);
    await page.close();
  }
  console.log(`SMOKE PASS · screenshots in ${OUT}`);
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Run the smoke test and review the screenshots**

Run (stack up in solo mode): `cd app && npm run test:smoke`
Expected: `SMOKE PASS`. Then open every PNG in `app/test/artifacts/` (light and dark) and fix anything cramped, overlapping or unreadable — the script cannot judge that.

- [ ] **Step 3: Write the load test**

```js
// app/test/load/load.mjs
// Requires LAB_MODE=event. Env: LAB_URL, EVENT_CODE, USERS (150), WRITERS (0.2),
// DB_HOST/DB_PORT (host-mapped, default localhost:1522), LAB_ADMIN_PASSWORD.
import oracledb from 'oracledb';

const URL = process.env.LAB_URL ?? 'http://localhost:3100';
const USERS = Number(process.env.USERS ?? 150);
const WRITERS = Number(process.env.WRITERS ?? 0.2);
const PATTERN = '01-extended-reference';
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;

async function post(jar, path, body) {
  const res = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: jar.c ?? '' }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) jar.c = set.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

const cfg = await (await fetch(`${URL}/api/config`)).json();
if (cfg.mode !== 'event') { console.error('load test needs LAB_MODE=event'); process.exit(2); }
const patterns = await (await fetch(`${URL}/api/patterns`)).json().catch(() => null);
const users = Array.from({ length: USERS }, (_, i) => ({ i, jar: {} }));

console.log(`signing in ${USERS} attendees…`);
for (const u of users) {
  const r = await post(u.jar, '/api/signin', { name: `Load ${u.i}`, email: `load${u.i}@example.com`, code: process.env.EVENT_CODE });
  if (r.status !== 200) { console.error('sign-in failed', r); process.exit(1); }
}
const cards = (patterns ?? (await (await fetch(`${URL}/api/patterns`, { headers: { cookie: users[0].jar.c } })).json()))
  .find((p) => p.id === PATTERN).cards.converged;
const read = cards.find((c) => /^\s*(SELECT|WITH)\b/i.test(c.sql)).sql;

console.log('warming (builds pattern 01 in every workspace, one at a time)…');
for (const u of users) {
  const r = await post(u.jar, '/api/run', { lane: 'sql', patternId: PATTERN, text: read });
  if (r.status !== 200) { console.error('warm-up failed', r.status, r.body); process.exit(1); }
}

const conn = await oracledb.getConnection({ user: 'lab_admin', password: process.env.LAB_ADMIN_PASSWORD ?? 'LabAdmin2026', connectString: `${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 1522}/FREEPDB1` });
let maxActive = 0; let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const r = await conn.execute("SELECT COUNT(*) FROM v$session WHERE username LIKE 'WS\\_%' ESCAPE '\\' AND status = 'ACTIVE'");
    maxActive = Math.max(maxActive, r.rows[0][0]);
    await new Promise((res) => setTimeout(res, 50));
  }
})();

console.log(`burst: ${USERS} attendees click Run at once (${Math.round(WRITERS * 100)}% write)…`);
const t0 = Date.now();
const outcomes = await Promise.all(users.map(async (u) => {
  const write = u.i < USERS * WRITERS;
  const text = write ? `UPDATE xr_advisors SET office = 'LOAD-${u.i}' WHERE ROWNUM = 1` : read;
  const s = Date.now();
  const r = await post(u.jar, '/api/run', { lane: 'sql', patternId: PATTERN, text });
  return { status: r.status, cached: r.body?.cached === true, ms: Date.now() - s, write };
}));
sampling = false;
await sampler;
await conn.close();

const lat = outcomes.filter((o) => o.status === 200).map((o) => o.ms);
const report = {
  users: USERS,
  wallMs: Date.now() - t0,
  statuses: outcomes.reduce((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {}),
  cachedReads: outcomes.filter((o) => o.cached).length,
  executed: outcomes.filter((o) => o.status === 200 && !o.cached).length,
  maxActiveAttendeeSessions: maxActive,
  p50ms: pct(lat, 0.5),
  p95ms: pct(lat, 0.95),
};
console.log(JSON.stringify(report, null, 2));

const problems = [];
if (maxActive > 1) problems.push(`gate breached: ${maxActive} attendee sessions active at once`);
if (Object.keys(report.statuses).some((s) => Number(s) >= 500)) problems.push('server errors during burst');
if (report.executed > USERS * WRITERS + 1) problems.push(`cache did not absorb the reads: ${report.executed} executions`);
if (problems.length) { console.error(`LOAD FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('LOAD PASS');
```

Readers of dirty workspaces (writers) are not cached; the allowance `USERS * WRITERS + 1` covers the writers plus the first read that fills the cache.

- [ ] **Step 4: Run the load test**

```bash
LAB_MODE=event ADMIN_PASSWORD=admin EVENT_CODE=LOAD docker compose up -d --force-recreate lab-ui
cd app && USERS=150 EVENT_CODE=LOAD npm run test:load
```

Expected: `LOAD PASS`, `maxActiveAttendeeSessions` ≤ 1, no 5xx. Record the report (p50/p95, 429 count) in the commit message. Afterwards end the event from `/admin.html` (or `POST /api/admin/end-event`) and recreate `lab-ui` in solo mode.

- [ ] **Step 5: Commit**

```bash
git add app/test/smoke/smoke.mjs app/test/load/load.mjs
git commit -m "test(lab-ui): headless smoke test and 150-attendee load test"
```

---

### Task 17: Documentation and final verification

**Files:**
- Modify: `README.md` (new "Hands-on console" section after "Quickstart"; add `app/` to "Repository layout"; ports table gains `3100`)
- Create: `docs/instructor-runbook.md`

- [ ] **Step 1: Add the README section**

```markdown
## Hands-on console

Every query in this repo — and in the lecture — can be read, copied, edited and run from a
browser. `docker compose up -d` also starts **`lab-ui`** at **http://localhost:3100**:

- one page per pattern: the problem, the three knob settings, and query cards for the
  document model, the converged model and (where it exists) the MongoDB API;
- **Copy**, **Load into console**, **Run** on every card; a console with SQL and MongoDB tabs;
- **Measure it**: runs the document-model write and its converged counterpart back to back and
  shows the engine's own statistics (redo, block changes, logical reads) — then rolls both back;
- **Reset this pattern** puts its tables back to the starting state.

Execution is serialized: one statement runs in the database at a time (a first-come,
first-served queue shows your place), and repeated read-only example queries are served from a
cache. That keeps Oracle AI Database 26ai Free responsive even with a full room.

| Setting | Default | Meaning |
|---|---|---|
| `LAB_MODE` | `solo` | `solo`: one user, no sign-in. `event`: sign-in, a private workspace per attendee, admin page |
| `CMP_UI_PORT` | `3100` | host port for the console |
| `DB_POOL_MAX` / `MONGO_POOL_MAX` | `1` / `1` | connection caps behind the queue |
| `EVENT_CODE`, `ADMIN_PASSWORD` | — | event mode only; see `docs/instructor-runbook.md` |
```

- [ ] **Step 2: Write the instructor runbook**

```markdown
# Instructor runbook — hands-on console in event mode

## Before the session (15 minutes)

1. `export LAB_MODE=event ADMIN_PASSWORD='<choose one>' EVENT_CODE='<short code for the room>'`
2. Start: `docker compose up -d` (Podman: `podman-compose up -d`). First start builds images.
3. Wait until `curl -fsS http://localhost:3100/api/config` shows `"mode":"event"`.
4. Open `http://<your-host>:3100/admin.html`, sign in, and **pre-warm** about as many workspaces as
   you expect attendees (each takes a few seconds; attendees who arrive early simply get a fresh
   one).
5. Put the URL and the event code on a slide.

## During the session

- **Pause execution** while you talk through a slide; attendees see "paused by instructor".
  Resume when it is their turn.
- The status panel shows the queue and the statement running now; **Cancel** stops a runaway.
- An attendee who broke their workspace can press **Reset this pattern**, or you can
  **Reset all patterns** for them from the attendee table.

## After the session

- **End event** drops every attendee workspace. Then `docker compose down` (add `-v` to discard
  the database volume too).

## Limits to know

- One statement executes at a time; each statement times out after 10 s, each result is capped
  at 500 rows / 1 MB, and a request waits at most 30 s in the queue before "busy — try again".
- Oracle AI Database 26ai Free: 2 CPU threads, 2 GB RAM, 12 GB of user data — ample for ~150
  workspaces of a few MB each.
```

- [ ] **Step 3: Final verification**

```bash
docker compose down -v            # clean volume: proves first-boot bootstrap works
./run.sh                          # expect RESULT: 19 passed, 0 failed
cd app && npm run test:smoke      # expect SMOKE PASS; review screenshots
```

Then run the load test once with `USERS=150` as in Task 16 and confirm `LOAD PASS`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/instructor-runbook.md
git commit -m "docs: hands-on console section and instructor runbook"
```

Delivery to the hub (a follow-up PR after PR #12 merges) is a separate step owned by the lead: sync `app/`, `compose.yml`, `run.sh`, `.dockerignore`, the annotated `patterns/` and docs into `labs/converged-modeling-patterns/`, and extend `.github/workflows/converged-modeling-patterns.yml` to run `npm run test:smoke` on the runner after `./run.sh`.
