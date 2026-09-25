# Converged Modeling Patterns

Companion repository for the 90-minute lecture **"Model the Domain, Not the Engine —
Converged Data Modeling."** Every document-modeling pattern in this repo is a
runnable, side-by-side demonstration: the document-model starting point a developer
would build, and the converged alternative that keeps the read win **without** paying
the write-amplification the pattern was quietly charging you.

Runs on **Oracle AI Database 26ai Free** — one container, one command.

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
alternative, with the needle-flip explained).

Numbers above are **anonymized field results** from real engagements, cited as such —
your mileage depends on scale, cardinality, and access mix. *A win at the wrong scale
is not a win.* Measure your own (see below).

---

## Quickstart

```bash
./run.sh                 # brings up 26ai Free, then runs all six patterns
./run.sh 03-bucket       # run just one pattern
```

`run.sh` starts the container via `docker compose`, waits for it, grants the schema
privileges the patterns use, and runs every `.sql` — grading each one (any ORA-/PLS-
error is reported as FAIL). It is idempotent; rerun freely.

Prefer to drive it yourself:

```bash
docker compose up -d                                   # Oracle AI Database 26ai Free
CONN=cmp_user/CmpUser2026@localhost:1521/FREEPDB1
docker exec -i cmp-oracle sqlplus -s "$CONN" < patterns/01-extended-reference/01-document-model.sql
```

Connection: `cmp_user / CmpUser2026` on `localhost:1521/FREEPDB1`. Set `CMP_PORT` if
host port 1521 is taken; override `ORACLE_PASSWORD` / `CMP_PASSWORD` as you like.

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

- **26ai throughout.** Validated on Oracle AI Database 26ai Free (23.26.2), the
  `gvenzl/oracle-free:latest-faststart` image.
- **Customer-neutral.** No named customers; the domains are illustrative and reusable.
- **Pure SQL.** The `.sql` files validate in one lane via `sqlplus`; where a MongoDB-
  API idiom is the natural on-ramp (`$sql`-in-pipeline, the Mongo shape of a
  collection), it is described in the pattern README.

## License

MIT — see [LICENSE](LICENSE).
