# Pattern 02 — Computed

**Telecom.** Show a subscriber's current-cycle usage instantly on the account page,
and rank the top talkers for the ops dashboard.

> Keep the read win. Stop paying for it with a whole-document rewrite on every event.

## The document bet

The Computed pattern bakes a rollup onto the document: compute once on write, read
it a thousand times for free. The math is real — a million reads an hour against a
thousand writes an hour means precomputing "divides the work by a thousand." Store
`cycleUsage` on the subscriber and the account page is a single lookup.

## Where the needle flips

Usage is not written once. Every Call Detail Record re-ticks the rollup, and each
re-tick re-reads and **rewrites the whole subscriber document** — the storage engine
never edits a block in place, so the entire leaf page is re-serialized into a new
block on every append. On a hot subscriber that is a write storm on one document,
and the counter becomes a contention hotspot. The pattern's own escape hatch —
counter-sharding into N documents and fanning the read back in — leaves the write
amplification exactly where it was.

And the Top-N dashboard gets no help at all: with the rollup buried inside each
document, ranking the top talkers means **SUM → SORT → LIMIT across the whole
collection on every load.** At book scale that is the query that melts down.

## The converged softening

Two moves, both keeping the read cheap:

1. **CDRs are append-only rows.** One small insert per event — no parent to rewrite,
   no hot-document contention. A maintained summary carries the rollup and is kept
   current **in the same transaction** by a row trigger: *Computed, with a staleness
   window of zero.* (Declarative equivalent: a materialized view `REFRESH FAST ON
   COMMIT` over a CDR mview log.)
2. **Hot Top-N becomes an index range scan.** A descending index on the summary's
   usage column turns "top talkers" into an O(log n) seek plus `FETCH FIRST N` — no
   SUM, no SORT, no full-collection scan.

This is the shape behind the field result on exactly this workload: a landing-page
Top-N that ran **60 seconds → 500 milliseconds**, ACID, with no precompute job, no
change streams, and no eventual-consistency window. Want the document shape at the
API? A duality view projects the subscriber with the live rollup included.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Baked `cycleUsage`; each CDR rewrites the whole subscriber doc; Top-N is a full scan |
| `02-converged.sql` | Append-only CDRs + trigger-maintained summary (staleness 0) + descending Top-N index + duality projection |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (23.26.2)**.
Run them with `../../run.sh 02-computed`.
