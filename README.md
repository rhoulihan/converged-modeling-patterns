# Converged Modeling Patterns

Companion repository for the 90-minute lecture **"Model the Domain, Not the Engine —
Converged Data Modeling."** Every document-modeling pattern in this repo is a
runnable, side-by-side demonstration: the document-model starting point a developer
would build, and the converged alternative that keeps the read win **without** paying
the write-amplification the pattern was quietly charging you.

Runs on **Oracle AI Database 26ai Free** — one container, one command. Two lanes:
the same data through **SQL** (`sqlplus`) and through the **Oracle API for MongoDB**
(`mongosh`), with automated assertions that the two lanes return **byte-identical**
results. One truth, many shapes — proven, not asserted.

> **Data modeling is a physics problem, not a philosophy problem.** The famous
> document patterns are not folklore — they are disciplined responses to real
> storage-engine constraints. This repo asks one question of each: *does that
> constraint still exist on a converged engine?* When it does, keep the pattern.
> When it was a workaround for a missing capability, there is a better shape.

---

## The one idea

Every pattern trades along the same axis: **what you access together, you store
together.** Embed and you get atomic reads — until the document grows, hits 16 MB, or
takes write amplification on every change. Reference and you get small writes — but
now you need a join the engine may not love.

Convergence adds a **third resolution the catalog never had: _project it._** Store
the domain in canonical form once; project the shape each consumer wants — document,
graph, time-series, relational — at read time, over the same rows, in the same
transaction. **Duality does not change the physics knobs. It changes how the knobs
get set.**

The three knobs, on every design:

1. **Diversity of access patterns** — how many consumers want a *different shape* of
   the same truth? (Diversity pushes toward relational + projection.)
2. **Read/write ratio** — *where* compute should happen: write-time or read-time.
3. **Update %, and where the update lands** — the knob that quietly kills more designs
   than the other two combined. A high-velocity field buried in a large document is
   write amplification waiting to happen.

The breakpoint to keep in your head: **maintain a precomputed structure only if
`read-freq × read-cost > write-freq × maintenance-cost`.** Writes get heavy or reads
get rare, and it flips — and a real cost-based optimizer moves that breakpoint by
making read-time compute cheap.

---

## How this repo supports the presentation

This repository is the **runnable backing** for the 90-minute lecture *"Model the
Domain, Not the Engine."* Nothing in the talk is a claim you have to take on faith —
every pattern, every needle-flip, and the "one truth, many shapes" thesis itself is a
command you can run here, live, on a laptop. It serves two audiences:

- **Presenters** — step out of the slides and into a terminal at any pattern.
  `./run.sh 03-bucket` proves the Bucket `$sql` rollup and its cross-API parity in
  front of the room; the numbers on the slides are reproduced by the same scripts.
- **Developers you send here afterward** — the repo *is* the takeaway. Each pattern is
  a side-by-side they can read, run, modify, and measure against their own cardinality.

### Lecture → repo map

| Lecture beat | What backs it, here |
|---|---|
| **Why converged / "model once, project many"** — one truth served as many shapes | The duality views (`xr_client_dv`, `cp_subscriber_dv`, `ol_advisor_dv`) read **identically** through SQL and the MongoDB API; the `03-parity.js` scripts assert it byte-for-byte |
| **The physics** — three knobs, write amplification, the breakpoint | *The one idea* (above); every `01-document-model.sql` makes the write cost explicit in comments, every `02-converged.sql` shows where the needle flips |
| **The pattern walk** — six patterns, six industries | `patterns/01…06`, **1:1 with the slides** — same patterns, same industries, same hard edges |
| **Bucket's `$sql`-in-pipeline value-add** — parallel analytics, no pipeline caps | `patterns/03-bucket/02-sql-in-pipeline.js` — full SQL over the Mongo wire, runnable |
| **"One truth, many shapes" — proven, not asserted** | The four cross-API parity scripts (`0{1,2,6}/03-parity.js`, `03/03-parity.js`) — SQL result and MongoDB result asserted equal |
| **The honesty anchor** — where document still wins | *Where document still wins* (below) — the single-collection guidance, in words and as a rule |
| **Measure, don't guess** — the bake-off | *Measure it, don't guess it* (below) + the reason-then-measure modeling skill |
| **The anonymized proof numbers** (60s→500ms, 29s→sub-400ms, 9–15×) | Cited in the per-pattern READMEs, tagged as anonymized field results |

### Live-demo playbook

```bash
./run.sh 01-extended-reference   # ⭐ flagship: the SAME document, SQL == MongoDB, byte-for-byte
./run.sh 03-bucket               # the $sql-in-pipeline showcase + rollup parity
./run.sh                         # the whole walk, both lanes → 18 passed, 0 failed
```

Run any of these live: each `[PASS]` line is a slide's claim, executed.

---

## The six patterns (1:1 with the lecture)

| # | Pattern | Industry | Where the needle flips | Converged softening |
|---|---|---|---|---|
| [01](patterns/01-extended-reference/) ⭐ | **Extended Reference** | Wealth mgmt | Advisor moves offices → fan-out update across 100Ks of embedded copies + update anomaly | **Project, don't copy** — advisor normalized once, duality projects it live |
| [02](patterns/02-computed/) | **Computed** | Telecom | Every CDR re-aggregates + rewrites the whole subscriber doc → write storm | Append-only rows + trigger-maintained summary (staleness 0); **Top-N 60s → 500ms** |
| [03](patterns/03-bucket/) | **Bucket** | Manufacturing / IoT | Each reading rewrites the whole, growing bucket; marches at the 16 MB ceiling | INTERVAL-partitioned rows + `GROUP BY` rollup; **29s → sub-400ms** |
| [04](patterns/04-subset/) | **Subset** | Insurance | Push-and-trim on every claim to serve a full read that hardly happens | One table + composite index; **query the hot slice** with `FETCH FIRST` |
| [05](patterns/05-tree-hierarchy/) | **Tree / Hierarchy** | Manufacturing BOM | Re-parent → rewrites every descendant's path; where-used a prefix can't express | Adjacency edges (reorg = one row) + `CONNECT BY` + `GRAPH_TABLE` |
| [06](patterns/06-outlier/) | **Outlier** | Financial | `hasExtras` + overflow + app branch = the 16 MB limit leaking into your code | No special doc — "just more rows, the optimizer plans for it" |

Each folder holds a `README.md` (the teaching), `01-document-model.sql` (the starting
point, with the write cost made explicit in comments), and `02-converged.sql` (the
alternative, with the needle-flip explained). The four patterns that expose a duality
view (01, 02, 06) or a rollup (03) also carry a **MongoDB lane** — `*.js` scripts that
run through `mongosh` and assert cross-API parity (see below).

Numbers above are **anonymized field results** from real engagements, cited as such —
your mileage depends on scale, cardinality, and access mix. *A win at the wrong scale
is not a win.* Measure your own (see below).

---

## Repository layout

```
converged-modeling-patterns/
├── run.sh               # one command: build, wait, grant, run every pattern × both lanes, graded
├── compose.yml          # the 26ai + ORDS + Mongo-API service (non-default host ports)
├── docker/              # the image, built from scratch — DB + ORDS + mongosh, no ONNX/vector layer
│   ├── Dockerfile
│   ├── scripts/         #   install-ords.sh, entrypoint.sh (ORDS-enable CMP_USER + mongo.enabled)
│   └── init/            #   01-grants.sql, 02-ords-enable.sql
├── app/                 # the hands-on console — Node 22 Express app, compose service `lab-ui` on :3100
│   ├── src/             #   server, gate/cache, SQL+Mongo runners, content loader, HTTP + admin routes
│   ├── public/          #   the browser UI (offline vendor bundle, no outbound requests)
│   └── test/            #   unit, integration, smoke (Puppeteer) and load tests
└── patterns/
    ├── 01-extended-reference/   # ⭐ wealth mgmt — duality projection
    │   ├── README.md            #    the teaching: use case → hard edge → needle-flip → softening
    │   ├── 01-document-model.sql#    the starting point (write cost made explicit in comments)
    │   ├── 02-converged.sql     #    the converged alternative (the flip, explained)
    │   ├── 03-parity.js         #    Mongo lane: SAME doc via SQL and MongoDB API, byte-equal
    │   └── _capture.sql         #    captures the SQL-side result for the parity assertion
    ├── 02-computed/             # telecom — rollup, staleness 0        (+ 03-parity.js, _capture.sql)
    ├── 03-bucket/               # manufacturing/IoT — time-series
    │   ├── 01-document-model.sql / .js   # the $push bucket that grows (SQL + Mongo lanes)
    │   ├── 02-converged.sql     #    partitioned rows + GROUP BY rollup
    │   ├── 02-sql-in-pipeline.js#    $sql over the Mongo wire (the value-add)
    │   └── 03-parity.js         #    Mongo $sql rollup == SQL GROUP BY, asserted
    ├── 04-subset/               # insurance — pure SQL (no natural single Mongo collection)
    ├── 05-tree-hierarchy/       # manufacturing BOM — pure SQL (adjacency + CONNECT BY + GRAPH_TABLE)
    └── 06-outlier/              # financial — duality projection       (+ 03-parity.js, _capture.sql)
```

Every pattern folder is self-contained and teaches the same four beats as its slide.
`.sql` files run in the SQL lane; `.js` files run in the MongoDB lane; `03-parity.js`
is the cross-API assertion; `_capture.sql` feeds the SQL side of that assertion to
`run.sh`. Read a folder's `README.md` first, then the two model files side by side.

---

## Quickstart

```bash
./run.sh                 # build/bring up the stack, then run ALL patterns, BOTH lanes
./run.sh 03-bucket       # run just one pattern (both lanes)
```

`run.sh` builds and starts the container via `docker compose`, waits for the database
**and** the MongoDB API, grants the schema privileges the patterns use, and then, per
pattern, runs the **SQL lane** (`sqlplus`) followed by the **MongoDB lane** (`mongosh`,
in-container). Every script is graded: any ORA-/PLS- error or any parity mismatch is a
non-zero exit reported as **FAIL**. The run ends with a combined `N passed, 0 failed`.
It is idempotent; rerun freely. SQL-only patterns (Subset, Tree) have no `*.js` and
simply skip the Mongo lane.

The image is built fresh from [`docker/`](docker/): Oracle AI Database 26ai Free
(`gvenzl/oracle-free:23.26.3-faststart`) + **ORDS** (fronting the Database API and the
Oracle API for MongoDB) + **mongosh**. No vector/ONNX layer — these patterns use no
vectors. Ports (host → container), defaulted to **non-standard** values so nothing
collides with another Oracle/ORDS/Mongo stack:

| Service | In container | Host default | Override |
|---|---|---|---|
| SQL*Net | 1521 | **1522** | `CMP_PORT` |
| ORDS / Database Actions | 8181 | **8182** | `CMP_ORDS_PORT` |
| Oracle API for MongoDB | 27017 | **27018** | `CMP_MONGO_PORT` |
| Hands-on console (`lab-ui`) | 3000 | **3100** | `CMP_UI_PORT` |

Drive it yourself:

```bash
docker compose up -d --build

# SQL lane
docker exec -i cmp-oracle sqlplus -s cmp_user/CmpUser2026@localhost:1521/FREEPDB1 \
  < patterns/01-extended-reference/01-document-model.sql

# MongoDB lane (in-container mongosh; TLS is off for local dev)
MURI='mongodb://cmp_user:CmpUser2026@localhost:27017/CMP_USER?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true'
docker exec -i -e MURI="$MURI" cmp-oracle bash -lc 'mongosh "$MURI" --quiet --file /dev/stdin' \
  < patterns/03-bucket/02-sql-in-pipeline.js
```

Login: `cmp_user / CmpUser2026`, service `FREEPDB1`, schema ORDS-enabled as `CMP_USER`.
Override `ORACLE_PASSWORD` / `CMP_PASSWORD` as you like.

## Hands-on console

`docker compose up -d` also starts **`lab-ui`** — a browser console for this repo — at
**http://localhost:3100**. Every query in the six patterns, and in the lecture, can be
read, copied, edited and run from there, against the same 26ai container `run.sh` uses:

- one page per pattern: the problem, the three knob settings, and query cards for the
  document model, the converged model and (where it exists) the MongoDB API;
- **Copy**, **Load into console**, **Run** on every card, plus a console pane with its
  own **SQL** and **MongoDB** tabs for ad hoc statements;
- **Measure it** runs the document-model write and its converged counterpart back to
  back in one exclusive slot. Each side runs once unmeasured as a warm-up (parse and
  first-touch effects stay out of the numbers), then once measured: it reads the
  engine's own statistics (redo size, block changes, logical reads) before and after,
  with in-memory undo switched off so the counters are current, and rolls back. Numbers are a
  single-session, 26ai Free measurement — expect small run-to-run variance, not a fixed
  constant;
- **Reset this pattern** rebuilds its tables to the starting state.

Execution is serialized — one statement runs against the database at a time, a
first-come-first-served queue shows your place ("queued · N ahead"), and repeated
read-only queries are served from a cache — so the console stays responsive with a full
room on the 26ai Free container's 2 CPU threads / 2 GB RAM.

| Setting | Default | Meaning |
|---|---|---|
| `LAB_MODE` | `solo` | `solo`: one user, no sign-in. `event`: sign-in, a private workspace per attendee, admin page |
| `CMP_UI_PORT` | `3100` | host port for the console |
| `DB_POOL_MAX` / `MONGO_POOL_MAX` | `1` / `1` | connection caps behind the queue |
| `EVENT_CODE`, `ADMIN_PASSWORD` | — | event mode only; see [`docs/instructor-runbook.md`](docs/instructor-runbook.md) |

Solo mode (the default) needs no configuration. `./run.sh` folds the console's own unit
and integration tests in as a last stage against the same database — **19 passed, 0
failed**, combined with the patterns. `cd app && npm run test:smoke` is a separate
headless-Chrome walkthrough of every pattern page (screenshots land in
`app/test/artifacts/`, git-ignored), and `npm run test:load` drives a simulated event;
see [`docs/instructor-runbook.md`](docs/instructor-runbook.md) for running it against
your own room size before a large session.

## The MongoDB lane + cross-API parity

The Oracle API for MongoDB surfaces the same schema over the Mongo wire protocol, so a
MongoDB developer meets these patterns in their own tools — and the repo proves the two
lanes agree:

- **`$sql`-in-pipeline** (Bucket): `patterns/03-bucket/02-sql-in-pipeline.js` issues the
  hourly time-series rollup as **full SQL through the Mongo wire** via Oracle's `$sql`
  aggregation stage — parallel execution, cost-based optimization, and none of the
  100 MB stage / 16 MB output caps a native pipeline hits.
- **Rollup parity** (Bucket): `03-parity.js` asserts the Mongo `$sql` rollup equals the
  SQL lane's `02-converged.sql` `GROUP BY` (same machine/hour COUNT/AVG/MAX), and that
  both equal the hand-maintained document-model bucket counters.
- **Document parity** (Extended Reference ⭐, Computed, Outlier): each `03-parity.js`
  reads the **same duality-view document two ways** — `SELECT ... FROM <view>` (SQL) and
  `db.<view>.findOne(...)` (MongoDB API) — and asserts they are **byte-equal** after
  canonicalizing JSON and ignoring the duality `_metadata` (etag/asof). This is the
  executable proof of *"one truth, many shapes."*

Each parity script `quit(1)`s on any mismatch, so `run.sh` reports it as FAIL. Subset
and Tree stay pure-SQL (no natural single Mongo collection for a claims table or an
adjacency/graph traversal).

---

## Where document still wins (the honesty anchor)

This is not "relational beats document." It is *shape per access pattern, on one
engine.* The document model is the right tool for most reads, and for a real class of
writes. The white-hot case — a shopping cart or event stream taking tens of millions
of tiny add/remove operations a day and read constantly — belongs in a **single
collection** (one small document per line item, keyed `cart#sku`), **not** a duality
view. A duality view is a read-time join; do not put one in front of a write-storm.
**A single collection is not a duality view** — a duality view assembles a document by
joining normalized tables; a single collection gathers documents on an index. Both
are first-class here.

The other half of the 90/10: entitlement / array-containment workloads have run
**~9–15× faster in the document shape** than a 27-table normalized schema — on the
*same* engine. The point was never the shape. The point is you no longer have to pick
one for the whole system.

---

## Measure it, don't guess it

Every needle-flip in this repo is a *breakpoint* — a frequency or scale at which the
winner changes. On a converged engine you don't have to guess where it is:
reproduce the schema, generate data at real cardinality, build the candidate shapes,
and **measure read _and_ write cost** (writes are access patterns too). See the
`oracle-data-modeling` skill's reason-then-measure bake-off, and bring your own schema
and slowest queries to the workshop lab.

---

## Notes

- **26ai throughout.** Validated on Oracle AI Database 26ai Free (`23.26.3-faststart`),
  ORDS 26.2, mongosh from the current MongoDB 8.0 repo. Every `.sql`, every `.js`, and
  every cross-API parity assertion runs clean on a live container, and `./run.sh` folds
  in the hands-on console's own test suite as a last stage (`19 passed, 0 failed`).
- **Customer-neutral.** No named customers; the domains are illustrative and reusable.
- **Two lanes, asserted equal.** The SQL lane validates via `sqlplus`; the MongoDB lane
  validates via `mongosh`, and the parity scripts assert the two lanes return identical
  data. See *The MongoDB lane + cross-API parity* above.

## License

Universal Permissive License (UPL) 1.0 — see [LICENSE](LICENSE). Copyright (c) 2026
Oracle and/or its affiliates.
