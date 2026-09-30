# Hands-on Lab Console — Design

**Date:** 2026-09-29 · **Status:** approved in brainstorming, pending spec review
**Repo:** `converged-modeling-patterns` (companion lab for the Workshop 1 lecture *Model the
Domain, Not the Engine*) · **Ships as:** a follow-up PR to `oracle-devrel/oracle-umt-developer-hub`
after PR #12 merges (PR #12 is not extended).

## 1. Goal

Give attendees a completely browser-based, hands-on way to work through the six patterns from
the lecture: read each pattern's queries, copy them, paste/modify them in a console, execute them
against Oracle AI Database 26ai Free (SQL and the MongoDB API), and see the results — plus a
**Measure it** button that shows write amplification as live engine statistics.

Success criteria:

1. An attendee with only a browser can run every query the lecture shows, for all six patterns.
2. The queries in the UI are the same statements CI validates — they cannot drift.
3. The 26ai Free instance is never overwhelmed: at most one attendee statement executes at a
   time, even with ~150 attendees clicking Run at once.
4. Works fully offline (no internet in the room) and on Docker or Podman.
5. Two delivery modes from one codebase: self-run on a laptop, and instructor-hosted events.

Out of scope (YAGNI): progress tracking/grading, JavaScript (node-oracledb) console, a
presenter "follow-along" push, multi-instance app scaling, cloud deployment.

## 2. Context

The approach ports the proven engine of `oracle-json-workshop` (Node 22/Express app beside the
Oracle container; SQL executor with timeout and row cap; SQL splitter; results rendering;
per-attendee schema workspaces) into a lean app built around this repo's pattern files.
Two deliberate departures from that workshop:

- **Real MongoDB.** Its "mongosh" console translates commands to SQL. Ours uses the official
  MongoDB driver against the Oracle API for MongoDB (ORDS, port 27017), so `find`, `aggregate`
  and `$sql` stages genuinely execute — the same lane the repo's parity checks use.
- **PL/SQL allowed.** Its guardrails block PL/SQL; our pattern scripts need anonymous blocks and
  triggers, so isolation comes from per-attendee schemas instead (§6).

## 3. Architecture

```
 browser ──HTTP──▶  lab-ui container (Node 22 / Express)            cmp-oracle container
                    ├─ pattern pages (generated from repo files)    26ai Free + ORDS
                    ├─ POST /api/run      ─┐                        ├─ SQL        :1521
                    ├─ POST /api/measure  ─┼─▶ GATE ─▶ oracledb pool (DB_POOL_MAX=1) ──┤
                    ├─ POST /api/reset    ─┘   FIFO     mongodb driver (MONGO_POOL_MAX=1) ▶├─ Mongo API :27017
                    └─ /admin (event mode)     1 permit                          └─ ORDS       :8181
```

- New service `lab-ui` in `compose.yml`, built from `app/` (Node 22, Express). Depends on the
  existing `oracle` service being healthy. Host port `CMP_UI_PORT` (default **3100**, non-standard
  like the repo's other ports).
- Mode is `LAB_MODE=solo` (default) or `LAB_MODE=event`.
- All assets (fonts, CodeMirror 6, JSON viewer) are bundled at image build time; the running app
  makes no outbound requests.
- Look and feel matches the deck: same fonts, colour tokens, light/dark, hot = problem/before,
  cool = solution/after.

## 4. Execution: the gate and the read-only cache

### 4.1 Gate (single shared lock)

Every database operation — SQL statement, MongoDB command, measure-it pair, pattern reset,
workspace provisioning — passes through one in-process **FIFO weighted semaphore** with
**1 permit**. Consequently at most one attendee operation executes in the database at a time.

| Rule | Value (configurable) |
|---|---|
| Permits | 1 |
| Weight | normal = 1; measure-it pair, reset, provisioning = all permits (exclusive, run as one unit) |
| SQL statement timeout | 10 s (`callTimeout`); timeout kills the call and releases the permit |
| Mongo operation timeout | `maxTimeMS` 10 s |
| Queued requests per user | 1 (a second submission while queued is rejected with "already queued") |
| Max queue wait | 30 s → HTTP 429 "busy, retry" |
| Pause | admin can pause; queued and new requests return "paused by instructor" |

Status is reported to the console: `queued · N ahead` (polled or via server-sent events), then
`running`, then the result.

Backstop — connection pools are configurable and default to **1**:

| Setting | Default | Scope |
|---|---|---|
| `DB_POOL_MAX` | 1 | attendee execution pool (heterogeneous `oracledb` pool — `homogeneous: false` — so in event mode each attendee connects as their own schema user, while the cap applies across all attendees) |
| `MONGO_POOL_MAX` | 1 | `maxPoolSize` of each per-attendee MongoDB client (clients are closed when idle) |
| control pool | 1 (fixed) | app metadata only — sign-in lookups, session store, workspace registry; never runs attendee text |

With the defaults the backstop matches the gate: even a gate defect cannot put more than one
attendee statement into the database. The control pool exists so sign-in and session reads are not
stuck behind a 10 s attendee query. Cancel uses `connection.break()` on the executing connection,
so it needs no extra connection. Raising the pools above 1 only matters if the gate's permits are
raised too (§4.1).

Why an in-app gate (alternatives considered): a pool of size 1 cannot cover the separate Mongo
driver pool or show queue position; `DBMS_LOCK` makes every waiter hold a live database session
(the load we are protecting against) with no FIFO or visibility and no Mongo coverage; Resource
Manager is a possible later backstop but gives users no feedback; an external lock service is
unnecessary for a single app container.

### 4.2 Read-only cache (bypasses the gate)

A result may be served from cache only when **all** hold:

1. the statement is a single read-only `SELECT`/`WITH`, or a Mongo `find`/`aggregate` without
   `$out`/`$merge`;
2. the caller's workspace for that pattern is **pristine** — any write (DML/DDL/PL/SQL/Mongo
   write) marks the pattern dirty for that workspace; a reset clears the flag;
3. the request is not a measure-it run.

Cache key: `(pattern, hash(normalized statement text), dataset version)`. The dataset version
changes when the pattern's setup files change (content hash at startup). In event mode all
pristine workspaces share one cache entry per key, so a room-wide "everyone clicks Run" costs one
execution. Results carry a `served from cache` badge. Cache is in-memory, bounded (LRU, 500
entries), and can be disabled from the admin page.

## 5. Content model and UI

### 5.1 Single source of truth

The UI reads `patterns/NN-*/` directly: `README.md`, `01-document-model.sql`,
`02-converged.sql`, `*.js`. The only change to the `.sql`/`.js` files is structured comments,
ignored by `sqlplus` and `mongosh`, so `run.sh`/CI keep validating exactly what attendees see
(each pattern `README.md` also gains a small front-matter block — see the metadata bullet):

```sql
-- @step  Read the client document the portal wanted
-- @note  Same shape as the embedded card — assembled on read, nothing copied.
SELECT JSON_VALUE(data,'$.advisor.office') FROM xr_client_dv;

-- @measure advisor-move      (pairs with the same tag in 01-document-model.sql)
UPDATE xr_advisors SET office = 'NYC-09' WHERE advisor_id = 'A-001';
```

- `@step <title>` starts a query card; `@note <text>` adds its explanation (may repeat).
- `@measure <tag>` marks a statement as one side of a measure-it pair; the pair is the statement
  with the same tag in the document-model and converged files of the same pattern.
- Untagged statements (drops, `CREATE TABLE`, seed inserts) form the collapsed **Setup** block;
  reset runs the pattern's setup (and all statements needed to recreate its objects).
- The splitter handles `;`-terminated SQL and `/`-terminated PL/SQL.
- Pattern metadata (title, industry, problem paragraph, knob settings, deck slide range) comes
  from a YAML front-matter block added to the top of each pattern `README.md` (GitHub renders it
  as a small table; nothing else in the README changes).

### 5.2 Pattern page

- **Header:** pattern · industry, the problem paragraph, three knob chips, "Deck slides X–Y".
- **Tabs:** `Document model` · `Converged` · `MongoDB API` (only where the pattern has `.js`) ·
  `Measure it`.
- **Query cards:** title, note, highlighted code; **Copy**, **Load into console**, **Run**
  (inline result under the card).
- **Measure it:** each pair runs as one exclusive gate unit. For each side it reports deltas of
  `V$MYSTAT` statistics — `redo size`, `db block changes`, `session logical reads` — plus rows or
  documents affected and elapsed time; shown as a table and a bar chart, document model (hot) vs
  converged (cool). SQL lane only (the Mongo API's server sessions are not observable from the
  attendee session). Requires `SELECT` on `V$MYSTAT`/`V$STATNAME` for workspace users.

### 5.3 Console

Bottom-docked panel on every page:

- tabs **SQL** and **MongoDB**, each keeping its own buffer; CodeMirror 6 editor with syntax
  highlighting, `Ctrl/Cmd+Enter` to run, per-tab history;
- results: grid for rows, collapsible JSON tree for documents, message for DML/DDL
  ("1 row updated");
- status line: elapsed, `served from cache`, `queued · N ahead`, errors with the ORA-/Mongo code;
- MongoDB input accepts mongosh-style commands — `db.<coll>.find(filter, projection)`,
  `.findOne`, `.aggregate([...])`, `.countDocuments`, `.insertOne/Many`, `.updateOne/Many`,
  `.deleteOne/Many`, `show collections` — parsed (never `eval`ed) into real driver calls.

Limits per result: 500 rows / 1 MB, with a truncation notice.

## 6. Modes

### 6.1 Solo (default)

No sign-in. Workspace = the existing `CMP_USER` schema (its grants in `run.sh` gain `SELECT` on
`V$MYSTAT`/`V$STATNAME` for measure-it). The gate and cache apply exactly as in event mode. Reset
rebuilds the chosen pattern from its SQL files. No admin page.

### 6.2 Event

- **Sign-in:** name + email, plus an optional event code (`EVENT_CODE`). The same email always
  returns the same workspace. Sessions are stored in the database so an app restart does not log
  anyone out.
- **Workspace:** private schema `WS_xxxxxx` created by a least-privilege `LAB_ADMIN` account: the
  grants `run.sh` gives today, a quota, `SELECT` on `V$MYSTAT`/`V$STATNAME`, ORDS enabled for the
  Mongo API. Objects are built by re-running each pattern's setup scripts inside the schema (they
  are validated and idempotent; a table copy would miss duality views, triggers, the property
  graph and materialized views).
- **Load control:** admin **pre-warm** prepares N workspaces in the background (through the
  gate); **lazy setup** builds a pattern in a workspace only when the attendee first opens it.
- **Isolation:** attendee statements run as the attendee's own schema user. PL/SQL and triggers
  are allowed. Blocked (normalized-text rules): `ALTER SYSTEM`, `ALTER DATABASE`,
  `CREATE/ALTER/DROP USER`, `GRANT`, `REVOKE`, database links, `DBMS_SCHEDULER`/`DBMS_JOB`,
  `UTL_*` (network/file), `DBMS_PIPE`. Rules match anywhere in the submitted text after
  normalization (case, whitespace, comments removed), including inside PL/SQL string literals, so
  `EXECUTE IMMEDIATE 'GRANT …'` is blocked too.
  Mongo connections use the attendee's credentials, with a small per-user driver pool closed when
  idle.
- **Admin page** (`ADMIN_PASSWORD`): queue depth; the running operation (attendee, pattern,
  elapsed) with **cancel** (`connection.break()` / `killOp`); attendee list with workspace status;
  reset one attendee or all; **pause** execution; timeouts and cache toggle; **end event** (drop
  every `WS_` schema).
- **Footprint:** each workspace is a few MB; ~150 attendees fit comfortably within Free's
  12 GB user-data limit.

## 7. Testing and verification (TDD)

- **Unit (vitest, no database):** gate (FIFO order, one permit, exclusive weights, one queued per
  user, queue timeout → 429, pause); cache eligibility and dirty tracking; annotation parser and
  statement splitter (incl. PL/SQL `/`); mongosh parser → driver call descriptors; guardrail
  classifier (allowed and blocked cases).
- **Integration (live 26ai Free):** every `@step` in all six patterns succeeds via `/api/run`;
  measure-it returns statistics for every pair **and** the document-model side has higher redo
  and block changes than the converged side (directional assertion); Mongo console `find`,
  `aggregate` and the Bucket `$sql` pipeline match the lab's parity results; cache hit on a
  repeated read, bypass after a write; reset restores the pattern. Event mode: provision three
  workspaces, prove A cannot read B, prove Mongo works per workspace.
- **Load (150 simulated attendees, concurrent Run):** sampled active attendee sessions in
  `V$SESSION` never exceed 1; the cache absorbs the burst (executions ≪ requests); zero 5xx;
  queue waits and 429s as designed; report p50/p95 wait.
- **UI smoke (headless browser):** each pattern page loads; load a card into the console; run it;
  result renders; light and dark screenshots reviewed by eye.
- **CI:** `run.sh` gains a third stage (app tests) after the SQL and MongoDB lanes; the hub's
  per-lab workflow runs the same (timeout may be raised from 55 min).

## 8. Documentation

- README: a "Hands-on console" section (start, URL, solo vs event).
- `docs/instructor-runbook.md`: one page for event mode — set `EVENT_CODE` and
  `ADMIN_PASSWORD`, pre-warm, pause during lecture moments, end event; Docker and Podman commands.

## 9. Delivery

1. Build in this repo (local commits).
2. After PR #12 merges, sync into `labs/converged-modeling-patterns/` on a new hub branch and open
   a follow-up PR for the hub maintainers, mirroring the conventions used in PR #12 (UPL, labs README row
   unchanged, per-lab workflow updated).
