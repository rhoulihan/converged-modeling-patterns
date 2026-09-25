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

## The six patterns (1:1 with the lecture)

| # | Pattern | Industry | Where the needle flips | Converged softening |
|---|---|---|---|---|
| [01](patterns/01-extended-reference/) ⭐ | **Extended Reference** | Wealth mgmt | Advisor moves offices → fan-out update across 100Ks of embedded copies + update anomaly | **Project, don't copy** — advisor normalized once, duality projects it live |
| [02](patterns/02-computed/) | **Computed** | Telecom | Every CDR re-aggregates + rewrites the whole subscriber doc → write storm | Append-only rows + trigger-maintained summary (staleness 0); **Top-N 60s → 500ms** |
| [03](patterns/03-bucket/) | **Bucket** | Manufacturing / IoT | Each reading re-serializes the growing bucket; marches at the 16 MB ceiling | INTERVAL-partitioned rows + `GROUP BY` rollup; **29s → sub-400ms** |
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
  every cross-API parity assertion runs clean on a live container (`18 passed, 0 failed`).
- **Customer-neutral.** No named customers; the domains are illustrative and reusable.
- **Two lanes, asserted equal.** The SQL lane validates via `sqlplus`; the MongoDB lane
  validates via `mongosh`, and the parity scripts assert the two lanes return identical
  data. See *The MongoDB lane + cross-API parity* above.

## License

MIT — see [LICENSE](LICENSE).
