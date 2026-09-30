---
title: Bucket
industry: Manufacturing / IoT
deck: "22–25"
problem: >-
  Sensor readings are bucketed per machine per hour. Every reading rewrites the
  growing bucket, and hot sensors march it toward the 16 MB document cap.
knobs:
  - { name: Diversity, setting: "Medium: 4 read shapes", help: "The live dashboard, the 8-hour shift rollup, the 7-day anomaly scan and ML feature pulls all read the same readings, each in a different shape." }
  - { name: Read / write, setting: "Write-heavy", help: "About 34,000 readings a second, three billion a day, against a dashboard that re-reads each sensor-hour about 360 times." }
  - { name: Update locality, setting: "Every write, same document", hot: true, help: "Every reading lands on the same growing bucket: break-even is about 900 readings a bucket, a one-a-second sensor already costs about 2.7× the rows, and a ten-a-second spindle about 22×." }
help:
  tabs:
    document:
      why: "The starting point: one bucket document per sensor per hour, readings pushed into an array under running count, sum and max. The dashboard reads one document; every reading rewrites the growing bucket."
      look: "The bucket read's n and max_temp come off counters that every write maintains."
    converged:
      why: "Readings are small append-only rows in an hourly INTERVAL-partitioned table, and the rollup is a GROUP BY that prunes to the hours asked for. The last-hour dashboard now scans rows instead of fetching one document, about twice the read bytes in the deck's model."
      look: "The insert reports 3 rows affected, and the GROUP BY returns n, average and max per machine and hour."
    mongo:
      why: "The anomaly team keeps db.aggregate() over the MongoDB API and runs the rollup as one $sql stage over the same partitioned rows, planned by the optimizer."
      look: "One rollup document per machine and hour, with n, avg and max matching the SQL GROUP BY."
    measure:
      why: "The ratio is the bucket's redo for 3 appends divided by the redo for 3 row inserts. Each append rewrites the bucket as it stands, so the ratio grows with the readings in it; the inserts cost the same whether the hour holds 3 readings or 3,600."
      look: "Your dot at 3 readings, near 5×, on a reference line that reaches about 470× at 3,600 readings (one a second for an hour)."
measure:
  x_label: "readings in the bucket after the write"
  lab_x: 3
  deck_slides: "22–25"
  calibration:
    - { x: 3, ratio: 4.89 }   # doc 4776 B, conv 976 B
    - { x: 100, ratio: 24.57 }   # doc 24664 B, conv 1004 B
    - { x: 1000, ratio: 109.18 }   # doc 109616 B, conv 1004 B
    - { x: 3600, ratio: 469.84 }   # doc 471716 B, conv 1004 B
---
# Pattern 03: Bucket (time-series)

**Manufacturing / IoT.** Ingest millions of tiny sensor readings; read them back as
per-machine, per-hour summaries.

> The textbook write-amplification pattern. Let the engine amortize, not your schema.

## The document bet

A document per reading means millions of tiny documents. The Bucket pattern groups
them: one bucket document per machine per hour, each reading pushed into an array,
running counters kept on the bucket. Fewer, fatter documents; cheap windowed reads.

## Where the needle flips

This is *the* write-amplification pattern. Each reading is an array `$push` **plus**
a counter update, a read-modify-write that **rewrites the entire growing bucket
document on every single append.** The bucket only grows, so the redo each append
costs climbs all cycle, and a hot sensor
marches its bucket straight at the **16 MB document ceiling**, where writes simply
start to fail. You built a structure whose write cost increases the more you use it.

## The converged softening

Stop hand-rolling buckets. Let **range partitioning** do the amortization the bucket
was faking, and let `GROUP BY` do the rollup:

- Readings are tiny, append-only rows in an **INTERVAL-partitioned** table: Oracle
  opens a new hourly partition on its own as time advances. Each reading is one small
  row: no array to grow, no document to rewrite, no 16 MB ceiling.
- The per-hour summary is a `GROUP BY` over a partition range; asking for one hour
  **prunes** to one partition. Reads dwarf writes? A materialized view precomputes it.
- Prefer the Mongo lane? **`$sql`-in-pipeline** runs the same `GROUP BY` with
  parallel execution and **no 100 MB stage / 16 MB output caps**, full SQL over the
  wire protocol (see the root README).

Field result for exactly this reshape: a 29-second bucket rollup fell to **sub-400
milliseconds**, and the read win was kept without maintaining a single bucket.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Per-hour bucket doc; each reading `$push` + counter rewrites the growing bucket |
| `02-converged.sql` | INTERVAL-partitioned readings (constant-cost inserts) + `GROUP BY` rollup + summary MV |
| `01-document-model.js` | The MongoDB-lane `$push` bucket: the same write-amp, runnable in `mongosh` |
| `02-sql-in-pipeline.js` | The hourly rollup as **full SQL over the Mongo wire** via a `$sql`-in-pipeline stage |
| `03-parity.js` | Asserts the Mongo `$sql` rollup == the SQL `GROUP BY` == the maintained bucket counters |
| `_capture.sql` | Helper: emits the SQL-lane rollup for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
`$sql`-in-pipeline rollup returns over the Mongo wire, and the parity assertion confirms
it equals the SQL `GROUP BY` (same machine/hour COUNT/AVG/MAX).
Run with `../../run.sh 03-bucket`.
