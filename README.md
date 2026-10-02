# Converged Modeling Patterns

Companion repository for the 90-minute lecture **"Model the Domain, Not the Engine:
Converged Data Modeling."** Every document-modeling pattern in this repo is a
runnable, side-by-side exploration of a tradeoff: the document-model design a developer
would build, a converged alternative, and what each one costs on reads **and** on
writes. Sometimes the converged alternative wins; sometimes the document shape should
stay (see *Where document still wins*). The lab measures where the needle flips
instead of assuming it.

Runs on **Oracle AI Database 26ai Free**: one container, one command. Two lanes:
the same data through **SQL** (`sqlplus`) and through the **Oracle API for MongoDB**
(`mongosh`), with automated assertions that the two lanes return **byte-identical**
results. One truth, many shapes. Proven, not asserted.

> **Data modeling is a physics problem, not a philosophy problem.** The famous
> document patterns are not folklore. They are disciplined responses to real
> storage-engine constraints. This repo asks one question of each: *does that
> constraint still exist on a converged engine?* When it does, keep the pattern.
> When it was a workaround for a missing capability, there is a better shape.

---

## The one idea

Every pattern trades along the same axis: **what you access together, you store
together.** Embed and you get atomic reads, until the document grows, hits 16 MB, or
takes write amplification on every change. Reference and you get small writes, but
now you need a join the engine may not love.

Convergence adds a **third resolution the catalog never had: _project it._** Model
the domain once, as its **canonical form**: the entities, properties and relationships
that are the primary truth. Store that truth as one or more **projections**, chosen per
access pattern: rows on tables, embedded documents, or graph nodes and edges. Each
consumer's query, processed by an **access surface** (SQL, SQL/JSON, SQL/PGQ or the
MongoDB API), creates the **projected shape** it needs (document, graph, time-series,
relational) at read time, in the same transaction. Relational is one projection among
several, not the center: **the workload picks the shape**.

The vocabulary used throughout (Unified Model Theory, or UMT):

| Term | Meaning |
|---|---|
| **Canonical form** | the primary truth: the logical model of entities, properties and relationships, each fact stated once. Not "the tables" |
| **Projection** | the stored form of that truth: rows on tables, embedded documents (JSON collections, duality views), graph nodes and edges |
| **Access surface** | the interface a query is processed by: SQL, SQL/JSON, SQL/PGQ, the MongoDB API |
| **Projected shape** | what a query creates when an access surface processes it: a document, a graph, a rowset, a time series |
| **Access dimension** | the kind of question the query asks: point read, range, aggregate, traverse |

It is the query, not the storage, that makes the shape.

No projection is free. Rendering a document from rows costs more on the read than
reading a stored document, and in exchange it ends write amplification; storing the
document makes the read cheaper and the writes heavier. Every pattern below explores
where that trade flips. **Duality does not change the physics knobs. It changes how the
knobs get set.**

The three knobs, on every design:

1. **Diversity of access patterns**: how many consumers want a *different shape* of
   the same truth? (High diversity wants projections: one stored shape can't serve
   every consumer. One dominant shape favors storing that shape.)
2. **Read/write ratio**: *where* compute should happen, write-time or read-time.
3. **Update %, and where the update lands**: the knob that quietly kills more designs
   than the other two combined. A high-velocity field buried in a large document is
   write amplification waiting to happen.

Knob 3 can veto the other two: a read-heavy, high-diversity workload still can't embed
a field that is hot and mutable.

**Blocks are the unit of I/O, not a floor on cost.** It's tempting to assume a small
row and a small document cost the same because both fit in one 8 KB block. Measured
on 26ai, they don't: redo and undo grow with the bytes rewritten, and a document
update rewrites the whole document even when it changes one field. Three counters in
a narrow summary row log about 1.0 KB of redo per update; the same three counters
inside a ~3.5 KB subscriber document log 8.3 KB, and repeated rewrites of a 6.2 KB
document wrote 15× the blocks (pattern 02 has the numbers). Count bytes rewritten,
not blocks touched.

The breakpoint to keep in your head: **maintain a precomputed structure only if
`read-freq × read-cost > write-freq × maintenance-cost`.** Writes get heavy or reads
get rare, and it flips. Read-time compute is never free, but a real cost-based
optimizer lowers its cost, and that moves the breakpoint.

---

## How this repo supports the presentation

This repository is the **runnable backing** for the 90-minute lecture *"Model the
Domain, Not the Engine."* Nothing in the talk is a claim you have to take on faith:
every pattern, every needle-flip, and the "one truth, many shapes" thesis itself is a
command you can run here, live, on a laptop. It serves two audiences:

- **Presenters**: step out of the slides and into a terminal at any pattern.
  `./run.sh 03-bucket` proves the Bucket `$sql` rollup and its cross-API parity in
  front of the room; the numbers on the slides are reproduced by the same scripts.
- **Developers you send here afterward**: the repo *is* the takeaway. Each pattern is
  a side-by-side they can read, run, modify, and measure against their own cardinality.

### Lecture → repo map

| Lecture beat | What backs it, here |
|---|---|
| **Why converged / "model once, project many"**: one truth served as many shapes | The duality views (`xr_client_dv`, `cp_subscriber_dv`, `ol_advisor_dv`) read **identically** through SQL and the MongoDB API; the `03-parity.js` scripts assert it byte-for-byte |
| **The physics**: three knobs, write amplification, the breakpoint | *The one idea* (above); every `01-document-model.sql` makes the write cost explicit in comments, every `02-converged.sql` shows where the needle flips |
| **The pattern walk**: six patterns, six industries | `patterns/01…06`, **1:1 with the slides**: same patterns, same industries, same hard edges |
| **Bucket's `$sql`-in-pipeline value-add**: parallel analytics, no pipeline caps | `patterns/03-bucket/02-sql-in-pipeline.js`: full SQL over the Mongo wire, runnable |
| **"One truth, many shapes": proven, not asserted** | The four cross-API parity scripts (`0{1,2,6}/03-parity.js`, `03/03-parity.js`): SQL result and MongoDB result asserted equal |
| **The rest of the catalog**: optional vs. obsolete | *The rest of the catalog* (below) |
| **The honesty anchor**: where document still wins | *Where document still wins* (below): the single-collection guidance, in words and as a rule |
| **Measure, don't guess**: the bake-off | *Measure it, don't guess it* (below) + the reason-then-measure modeling skill |
| **The anonymized proof numbers** (60s→500ms, 29s→sub-400ms, 9–15×) | Cited in the per-pattern READMEs, tagged as anonymized field results |

### Live-demo playbook

```bash
./run.sh 01-extended-reference   # ⭐ flagship: the SAME document, SQL == MongoDB, byte-for-byte
./run.sh 03-bucket               # the $sql-in-pipeline showcase + rollup parity
./run.sh                         # the whole walk, both lanes → 19 passed, 0 failed
```

Run any of these live: each `[PASS]` line is a slide's claim, executed.

---

## The six patterns (1:1 with the lecture)

| # | Pattern | Industry | Where the needle flips | Converged softening |
|---|---|---|---|---|
| [01](patterns/01-extended-reference/) ⭐ | **Extended Reference** | Wealth mgmt | Advisor moves offices → fan-out update across 100Ks of embedded copies + update anomaly | **Project, don't copy**: advisor normalized once, duality projects it live |
| [02](patterns/02-computed/) | **Computed** | Telecom | Every CDR re-aggregates + rewrites the whole subscriber doc → write storm | Append-only rows + trigger-maintained summary (staleness 0); **Top-N 60s → 500ms** |
| [03](patterns/03-bucket/) | **Bucket** | Manufacturing / IoT | Each reading rewrites the whole, growing bucket; marches at the 16 MB ceiling | INTERVAL-partitioned rows + `GROUP BY` rollup; **29s → sub-400ms** |
| [04](patterns/04-subset/) | **Subset** | Insurance | Push-and-trim on every claim to serve a full read that hardly happens | One table + composite index; **query the hot slice** with `FETCH FIRST` |
| [05](patterns/05-tree-hierarchy/) | **Tree / Hierarchy** | Manufacturing BOM | Re-parent → rewrites every descendant's path; where-used a prefix can't express | Adjacency edges (reorg = one row) + `CONNECT BY` + `GRAPH_TABLE` |
| [06](patterns/06-outlier/) | **Outlier** | Financial | `hasExtras` + overflow + app branch = the 16 MB limit leaking into your code | No special doc: "just more rows, the optimizer plans for it" |

Each folder holds a `README.md` (the teaching), `01-document-model.sql` (the starting
point, with the write cost made explicit in comments), and `02-converged.sql` (the
alternative, with the needle-flip explained). The four patterns that expose a duality
view (01, 02, 06) or a rollup (03) also carry a **MongoDB lane**: `*.js` scripts that
run through `mongosh` and assert cross-API parity (see below).

Numbers above are **anonymized field results** from real engagements, cited as such.
Your mileage depends on scale, cardinality, and access mix. *A win at the wrong scale
is not a win.* Measure your own (see below).

---

## Repository layout

```
converged-modeling-patterns/
├── run.sh               # one command: build, wait, grant, run every pattern × both lanes, graded
├── compose.yml          # the 26ai + ORDS + Mongo-API service (non-default host ports)
├── lab.sh               # the same stack with the plain podman/docker CLI, for hosts with no compose
├── docker/              # the image, built from scratch: DB + ORDS + mongosh, no ONNX/vector layer
│   ├── Dockerfile
│   ├── scripts/         #   install-ords.sh, entrypoint.sh (ORDS-enable CMP_USER + mongo.enabled)
│   └── init/            #   01-grants.sql, 02-ords-enable.sql
├── presentations/       # the Workshop 1 deck (HTML), its images and fonts, and build/ (the deck's generators)
├── app/                 # the hands-on console: Node 22 Express app, compose service `lab-ui` on :3100
│   ├── src/             #   server, gate/cache, SQL+Mongo runners, content loader, HTTP + admin routes
│   ├── public/          #   the browser UI (offline vendor bundle, no outbound requests)
│   └── test/            #   unit, integration, smoke (Puppeteer) and load tests
└── patterns/
    ├── 01-extended-reference/   # ⭐ wealth mgmt, duality projection
    │   ├── README.md            #    the teaching: use case → hard edge → needle-flip → softening
    │   ├── 01-document-model.sql#    the starting point (write cost made explicit in comments)
    │   ├── 02-converged.sql     #    the converged alternative (the flip, explained)
    │   ├── 03-parity.js         #    Mongo lane: SAME doc via SQL and MongoDB API, byte-equal
    │   └── _capture.sql         #    captures the SQL-side result for the parity assertion
    ├── 02-computed/             # telecom, rollup, staleness 0        (+ 03-parity.js, _capture.sql)
    ├── 03-bucket/               # manufacturing/IoT, time-series
    │   ├── 01-document-model.sql / .js   # the $push bucket that grows (SQL + Mongo lanes)
    │   ├── 02-converged.sql     #    partitioned rows + GROUP BY rollup
    │   ├── 02-sql-in-pipeline.js#    $sql over the Mongo wire (the value-add)
    │   └── 03-parity.js         #    Mongo $sql rollup == SQL GROUP BY, asserted
    ├── 04-subset/               # insurance, pure SQL (no natural single Mongo collection)
    ├── 05-tree-hierarchy/       # manufacturing BOM, pure SQL (adjacency + CONNECT BY + GRAPH_TABLE)
    └── 06-outlier/              # financial, duality projection       (+ 03-parity.js, _capture.sql)
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

`run.sh` builds and starts the container via compose (or `./lab.sh` when no compose
provider is installed: see *Podman* below), waits for the database
**and** the MongoDB API, grants the schema privileges the patterns use, and then, per
pattern, runs the **SQL lane** (`sqlplus`) followed by the **MongoDB lane** (`mongosh`,
in-container). Every script is graded: any ORA-/PLS- error or any parity mismatch is a
non-zero exit reported as **FAIL**. The run ends with a combined `N passed, 0 failed`.
It is idempotent; rerun freely. SQL-only patterns (Subset, Tree) have no `*.js` and
simply skip the Mongo lane.

The image is built fresh from [`docker/`](docker/): Oracle AI Database 26ai Free
(`gvenzl/oracle-free:23.26.3-faststart`) + **ORDS** (fronting the Database API and the
Oracle API for MongoDB) + **mongosh**. No vector/ONNX layer: these patterns use no
vectors. Ports (host → container), defaulted to **non-standard** values so nothing
collides with another Oracle/ORDS/Mongo stack:

| Service | In container | Host default | Override |
|---|---|---|---|
| SQL*Net | 1521 | **1522** | `CMP_PORT` |
| ORDS / Database Actions | 8181 | **8182** | `CMP_ORDS_PORT` |
| Oracle API for MongoDB | 27017 | **27018** | `CMP_MONGO_PORT` |
| Hands-on console (`lab-ui`) | 3000 | **3100** | `CMP_UI_PORT` |

All four bind to `127.0.0.1` on the host (`CMP_DB_BIND` / `CMP_UI_BIND` to change).

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

### Podman

Podman works with or without a compose provider. With `podman compose` (or
`docker-compose` installed as its provider) everything above works as written. Without
one, use `lab.sh`, which runs the same two services with the plain `podman` CLI:

```bash
./lab.sh up          # build images if missing (--build to force), start the database, then the console
./lab.sh status      # containers, health, console URL
./lab.sh logs oracle # or: lab-ui
./lab.sh down        # remove the containers; -v also deletes the database volume
```

`lab.sh` reads `.env` like compose does (a variable set in the shell wins) and mirrors
`compose.yml`'s images, container names, ports and volume, so the database survives a
switch between the two. `run.sh` picks compose when a provider answers and falls back
to `lab.sh` otherwise, so `./run.sh` works unchanged. The image builds on x86_64 and on
Apple silicon (arm64). `docker exec` in the commands above becomes `podman exec`.

## Hands-on console

`docker compose up -d` (or `./lab.sh up`) also starts **`lab-ui`** (a browser console for this repo) at
**http://localhost:3100**. Every query in the six patterns, and in the lecture, can be
read, copied, edited and run from there, against the same 26ai container `run.sh` uses:

- one page per pattern: the problem, the three knob settings, and query cards for the
  document model, the converged model and (where it exists) the MongoDB API;
- **Copy**, **Load into console**, **Run** on every card, plus a console pane with its
  own **SQL** and **MongoDB** tabs for ad hoc statements. **Load into console** fills both
  tabs: the card in its own tab and the same step in the other language in the other
  (native MongoDB operations on the JSON collections and duality views; otherwise the same
  SQL through Oracle's `$sql` stage);
- **Measure it** runs the document-model write and its converged counterpart back to
  back in one exclusive slot. Each side runs once unmeasured as a warm-up (parse and
  first-touch effects stay out of the numbers), then once measured: it reads the
  engine's own statistics (redo size, block changes, logical reads) before and after,
  with in-memory undo switched off so the counters are current, and rolls back. Numbers are a
  single-session, 26ai Free measurement: expect small run-to-run variance, not a fixed
  constant;
- **Reset this pattern** rebuilds its tables to the starting state.

The console lives in a **dock** collapsed to a thin bar at the bottom of the page. Hover
the bar, or use **Load into console**, to open it. It stays open while you're typing in
it or a console run is in progress, and closes on its own about half a second after both
your pointer leaves it and focus moves elsewhere (e.g. clicking back into the page).
Click **📌** to pin it open regardless, or **▲/▼ Console** to toggle it by hand.

Every card, tab and knob has a **ⓘ** next to it: hover for a quick tooltip, click for a
dialog with what it does, why it matters and what to look for, and, where relevant, the
deck figure it illustrates.

**Measure it**'s chart plots a reference line (write amplification measured on 26ai Free
at several sizes, same protocol) against **your** live point at this lab's actual size (on fresh or reset lab data),
so you can see where your result falls on the curve rather than judging it in isolation.
Beside the chart, a **deck workload model** thumbnail opens the pattern's full daily-cost
illustration from the deck; it's a separate, illustrative model, not something Measure it
proves directly.

Execution is serialized: one statement runs against the database at a time, a
first-come-first-served queue shows your place ("queued · N ahead"), and repeated
read-only queries are served from a cache, so the console stays responsive with a full
room on the 26ai Free container's 2 CPU threads / 2 GB RAM.

| Setting | Default | Meaning |
|---|---|---|
| `LAB_MODE` | `solo` | `solo`: one user, no sign-in. `event`: sign-in, a private workspace per attendee, admin page |
| `CMP_UI_PORT` | `3100` | host port for the console |
| `CMP_UI_BIND` | `127.0.0.1` | interface the console binds to; `0.0.0.0` for an event so the room can reach it |
| `CMP_DB_BIND` | `127.0.0.1` | interface for the database ports (1522/8182/27018); keep it on localhost, even for an event |
| `LAB_ADMIN_PASSWORD` | `LabAdmin2026` | the console's provisioning account; event mode refuses to start on the default |
| `DB_POOL_MAX` / `MONGO_POOL_MAX` | `1` / `1` | connection caps behind the queue |
| `EVENT_CODE`, `ADMIN_PASSWORD` | none | event mode only; see [`docs/instructor-runbook.md`](docs/instructor-runbook.md) |

**The instructor deck rides along.** The console also serves the Workshop 1 deck at
**`/deck/`** (for example http://localhost:3100/deck/), with its images and fonts, so the
lab host is self-contained with no internet connection. In event mode it needs the
instructor sign-in: the admin page has an **Open the instructor deck** button. In solo
mode it is open.

Every host port binds to `127.0.0.1` by default. For an event, publish only the console
(`CMP_UI_BIND=0.0.0.0`): publishing the database ports would hand attendees LAB_ADMIN and
SYS, whose credentials are in this repo. Don't run `./run.sh` during an event: its test
stage shares the database.

Solo mode (the default) needs no configuration. `./run.sh` folds the console's own unit
and integration tests in as a last stage against the same database: **19 passed, 0
failed**, combined with the patterns. `cd app && npm run test:smoke` is a separate
headless-Chrome walkthrough of every pattern page (screenshots land in
`app/test/artifacts/`, git-ignored), and `npm run test:load` drives a simulated event;
see [`docs/instructor-runbook.md`](docs/instructor-runbook.md) for running it against
your own room size before a large session.

## The MongoDB lane + cross-API parity

The Oracle API for MongoDB surfaces the same schema over the Mongo wire protocol, so a
MongoDB developer meets these patterns in their own tools, and the repo proves the two
lanes agree:

- **`$sql`-in-pipeline** (Bucket): `patterns/03-bucket/02-sql-in-pipeline.js` issues the
  hourly time-series rollup as **full SQL through the Mongo wire** via Oracle's `$sql`
  aggregation stage: parallel execution, cost-based optimization, and none of the
  100 MB stage / 16 MB output caps a native pipeline hits.
- **Rollup parity** (Bucket): `03-parity.js` asserts the Mongo `$sql` rollup equals the
  SQL lane's `02-converged.sql` `GROUP BY` (same machine/hour COUNT/AVG/MAX), and that
  both equal the hand-maintained document-model bucket counters.
- **Document parity** (Extended Reference ⭐, Computed, Outlier): each `03-parity.js`
  reads the **same duality-view document two ways**: `SELECT ... FROM <view>` (SQL) and
  `db.<view>.findOne(...)` (MongoDB API), and asserts they are **byte-equal** after
  canonicalizing JSON and ignoring the duality `_metadata` (etag/asof). This is the
  executable proof of *"one truth, many shapes."*

Each parity script `quit(1)`s on any mismatch, so `run.sh` reports it as FAIL. Subset
and Tree stay pure-SQL (no natural single Mongo collection for a claims table or an
adjacency/graph traversal).

---

## The rest of the catalog

The six patterns above are the ones where the tradeoff is closest. The rest of the
document pattern catalog splits into two piles on a converged engine:

- **Still useful, now optional**: *Polymorphic* (differently shaped documents in one
  collection, spanned by a multivalue index), *Attribute* (key/value pairs get a real
  index instead of a scan), *Schema Versioning* (an `IS JSON` check plus a
  discriminator, with a view presenting one shape), *Document Versioning* (temporal
  validity and Flashback give the history without a second collection of copies).
- **Obsolete**: *Approximation* (native `APPROX_COUNT_DISTINCT` and the other
  approximate aggregates answer directly), *Pre-Allocation* (padding documents so they
  would not move on disk was an artifact of one early storage engine; when the engine
  changed, the pattern vanished).

Patterns are bets against an engine's limits, not laws of modeling.

---

## Where document still wins (the honesty anchor)

This is not "relational beats document." It is *shape per access pattern, on one
engine.* The document model is the right tool for most reads, and for a real class of
writes. The white-hot case (a shopping cart taking tens of millions of tiny add/remove
operations a day and read constantly) belongs in a **single collection**: on 26ai, a
JSON collection table (`CREATE JSON COLLECTION TABLE carts`) holding each cart as one
self-contained document, written through the MongoDB API and readable with SQL/JSON.
Same table, two access surfaces, one engine.

Its knobs say embed. **Diversity** is low (one owner, one screen); **reads and writes**
are both hot, so there is nothing to precompute; **update locality** is private (an
update touches one cart, never a shared fact). Nothing is shared and nothing is
copied, so embedding costs nothing extra. Same three knobs as Extended Reference,
different settings, opposite answer.

**Joins are never free.** One indexed read of a self-contained document is one B-tree
probe plus one fetch, O(log n). A duality view assembles the same shape from k tables:
roughly O(k · log n), and nested arrays cost more again. For the advisor card in
pattern 01 that premium buys atomic reorgs; for the cart it buys nothing, because
there is no shared fact to protect. **A single collection is not a duality view**: a
duality view assembles a document from tables; a single collection stores the document.
Both are first-class here.

The rule: reach for a projection when a fact is **shared, queried many ways, or changes
under you**. Leave it embedded when it is **private, uniform and self-contained**.

The other half of the 90/10: entitlement / array-containment workloads have run
**~9–15× faster in the document shape** than a 27-table normalized schema, on the
*same* engine. The point was never the shape. The point is you no longer have to pick
one for the whole system.

---

## Measure it, don't guess it

Every needle-flip in this repo is a *breakpoint*: a frequency or scale at which the
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

Universal Permissive License (UPL) 1.0, see [LICENSE](LICENSE). Copyright (c) 2026
Oracle and/or its affiliates.
