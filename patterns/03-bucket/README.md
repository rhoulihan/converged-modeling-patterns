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
# Pattern 03 — Bucket (time-series)

**Manufacturing / IoT.** Ingest millions of tiny sensor readings; read them back as
per-machine, per-hour summaries.

> The canonical write-amplification pattern. Let the engine amortize, not your schema.

## The document bet

A document per reading means millions of tiny documents. The Bucket pattern groups
them: one bucket document per machine per hour, each reading pushed into an array,
running counters kept on the bucket. Fewer, fatter documents; cheap windowed reads.

## Where the needle flips

This is *the* write-amplification pattern. Each reading is an array `$push` **plus**
a counter update, and because the storage engine never edits a block in place, the
**entire growing bucket is re-serialized into a new block on every single append.**
The bucket only grows, so the per-append cost climbs all cycle — and a hot sensor
marches its bucket straight at the **16 MB document ceiling**, where writes simply
start to fail. You built a structure whose write cost increases the more you use it.

## The converged softening

Stop hand-rolling buckets. Let **range partitioning** do the amortization the bucket
was faking, and let `GROUP BY` do the rollup:

- Readings are tiny, append-only rows in an **INTERVAL-partitioned** table — Oracle
  opens a new hourly partition on its own as time advances. Each insert is one small
  row: no array to grow, no page to re-serialize, no 16 MB ceiling.
- The per-hour summary is a `GROUP BY` over a partition range; asking for one hour
  **prunes** to one partition. Reads dwarf writes? A materialized view precomputes it.
- Prefer the Mongo lane? **`$sql`-in-pipeline** runs the same `GROUP BY` with
  parallel execution and **no 100 MB stage / 16 MB output caps** — full SQL over the
  wire protocol (see the root README).

Field result for exactly this reshape: a 29-second bucket rollup fell to **sub-400
milliseconds**, and the read win was kept without maintaining a single bucket.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Per-hour bucket doc; each reading `$push` + counter re-serializes the growing bucket |
| `02-converged.sql` | INTERVAL-partitioned readings (constant-cost inserts) + `GROUP BY` rollup + summary MV |
| `01-document-model.js` | The MongoDB-lane `$push` bucket — the same write-amp, runnable in `mongosh` |
| `02-sql-in-pipeline.js` | The hourly rollup as **full SQL over the Mongo wire** via a `$sql`-in-pipeline stage |
| `03-parity.js` | Asserts the Mongo `$sql` rollup == the SQL `GROUP BY` == the maintained bucket counters |
| `_capture.sql` | Helper: emits the SQL-lane rollup for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
`$sql`-in-pipeline rollup returns over the Mongo wire, and the parity assertion confirms
it equals the SQL `GROUP BY` (same machine/hour COUNT/AVG/MAX).
Run with `../../run.sh 03-bucket`.
