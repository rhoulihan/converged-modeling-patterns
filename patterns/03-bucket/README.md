---
title: Bucket
industry: Manufacturing / IoT
deck: "22–25"
problem: >-
  Sensor readings are bucketed per sensor per hour. Every reading rewrites the
  growing bucket (36,000 rewrites an hour on a hot spindle), and hot sensors march
  it toward the 16 MB document cap.
knobs:
  - { name: Diversity, setting: "Medium: 4 read shapes", help: "The live dashboard, the 8-hour shift rollup, the 7-day anomaly scan and ML feature pulls all read the same readings, each in a different shape." }
  - { name: Read / write, setting: "Write-heavy", help: "About 34,000 readings a second, three billion a day, against a dashboard that re-reads each sensor-hour about 360 times." }
  - { name: Update locality, setting: "Every write, same document", hot: true, help: "Every reading lands on the same growing bucket: break-even is about 900 readings a bucket, a one-a-second sensor already costs about 2.7× the rows, and a ten-a-second spindle about 22×, marching at the 16 MB cap. Slow sensors (one a minute, 60 a bucket) still favor the bucket." }
help:
  tabs:
    document:
      why: "The starting point: one bucket document per sensor per hour, readings pushed into an array under running count, sum and max. The dashboard reads one document; every reading rewrites the growing bucket."
      look: "The bucket read's n and max_temp come off counters that every write maintains."
    converged:
      why: "Readings are small append-only rows in an hourly INTERVAL-partitioned table, and the rollup is a GROUP BY that prunes to the hours asked for. The last-hour dashboard now scans rows instead of fetching one document, about twice the read bytes in the deck's model."
      look: "The insert reports 3 rows affected, and the GROUP BY returns n, average and max per machine and hour."
    mongo:
      why: "The anomaly team keeps db.aggregate() through the MongoDB API and runs the rollup as one $sql stage (Oracle's addition to the aggregation pipeline: a full SQL statement as one stage) over the same partitioned rows, planned by the optimizer."
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

The platform (all numbers illustrative): 18,000 sensors across 40 plants. Most report
once a second; the hot ones (spindles, vibration) report ten times a second. That is
about 34,000 readings a second, three billion a day.

A document per reading means billions of tiny documents. The Bucket pattern groups
them: one bucket document per sensor per hour, each reading pushed into an array,
running count, sum, min and max kept on top. Fewer, fatter documents, and a live
dashboard that reads the whole hour as one contiguous document with the counters
already computed. The read side is genuinely good.

| Access pattern | Who | Rate | Type |
|---|---|---|---|
| Ingest a reading | gateways | ~34k/s | write, hot document |
| Last-hour machine dashboard | line supervisors | 6/min | read, 1 bucket |
| Shift rollup (8 h) | plant managers | 120/day | read, range |
| 7-day anomaly scan, all sensors | reliability engineers | hourly | read, times out |
| ML feature extraction | data science | nightly | read, scan |

## Immutable facts, mutable container

In the canonical form (the logical model of plants, machines and readings) a reading
is an immutable fact: a value at a timestamp. In the relational projection it is one
row, inserted once and never changed. The hourly count, sum, min and max are not in
the canonical form at all; they are *derived*, and can be computed with a `GROUP BY` on
read or kept in a materialized view.

The bucket takes those immutable facts and wraps them in the one mutable thing in the
system. One hot sensor-hour at ten readings a second is 36,000 rewrites of a bucket that
averages about 2.2 MB: roughly 78 GB of bytes moved to store 4.3 MB of data. The same
hour as rows is 36,000 small inserts, about 9 MB, appended to one hourly partition.
Engines soften the constant with in-memory deltas and checkpoints; they don't change the
shape. The write amplification comes from the wrapper, not the data.

## Where the needle flips

Diversity is medium (four read shapes) and the workload is write-heavy, but the knob
that bites is **update locality**. Each reading is an array `$push` **plus** a counter
update, a read-modify-write that **rewrites the entire growing bucket document on every
single append.** The bytes moved per hour grow with the square of the readings, so the
redo each append costs climbs all hour. You built a structure whose write cost
increases the more you use it.

The deck's illustrative cost model (not a benchmark) prices both sides honestly: 120 B
per reading; each `$push` rewrites the whole bucket; a row insert adds about 130 B of
header, index and redo; and the live dashboard reads the hour 360 times an hour, with
the row range scan paying about 150 B more per row than one document fetch. The
`GROUP BY` is not free.

- **Below about 900 readings a bucket, the bucket wins.** A sensor that reports once a
  minute holds 60 readings an hour and is read hundreds of times. Bucket it: the
  one-document read beats the rewrites.
- **At one reading a second** (3,600 a bucket) the bucket already costs about 2.7× the
  rows.
- **The hot spindle at 36,000** costs about 22×, and its bucket marches at the
  **16 MB document ceiling** (about 140,000 readings at this size), where writes simply
  start to fail.

The bucket is a low-rate pattern. It loses exactly on the sensors you care most about:
the fast, hot ones.

## The converged softening

Stop hand-rolling buckets for the hot sensors. Let the partition be the bucket: **range
partitioning** does the amortization the bucket was faking, and `GROUP BY` does the
rollup:

- Readings are tiny, append-only rows in an **INTERVAL-partitioned** table: Oracle
  opens a new hourly partition on its own as time advances. Each reading is one small
  row: no array to grow, no document to rewrite, no 16 MB ceiling.
- The per-hour summary is a `GROUP BY` over a partition range; asking for one hour
  **prunes** to one partition. Where reads repeat (shift reports), a materialized view
  precomputes it.
- The anomaly team keeps its aggregation pipeline. `$sql` is Oracle's addition to the
  MongoDB aggregation pipeline: one more stage of `db.aggregate()` whose body is a full
  SQL statement, with rows returned to the driver as documents. The rollup inside it
  gets the cost-based optimizer, parallel execution and pruning to the partitions it
  needs, with none of the pipeline's 100 MB stage-memory or 16 MB output caps (see the
  root README).

**The price.** The last-hour dashboard now scans rows instead of fetching one document:
about twice the read bytes in the deck's model. What that buys is a constant-cost insert
with no 16 MB ceiling. An anonymized field result for exactly this reshape: a 29-second
bucket rollup fell to **under 400 milliseconds**, paid for with that heavier last-hour
read.

**When to flip back: slow sensors.** At one reading a minute a bucket holds 60 readings,
well below the ~900 break-even, and the one-document bucket read is still the better
shape.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Per-hour bucket doc; each reading `$push` + counter rewrites the growing bucket |
| `02-converged.sql` | INTERVAL-partitioned readings (constant-cost inserts) + `GROUP BY` rollup + summary MV |
| `01-document-model.js` | The `$push` bucket through the MongoDB API: the same write amplification, runnable in `mongosh` |
| `02-sql-in-pipeline.js` | The hourly rollup as **full SQL through the MongoDB API** via a `$sql` pipeline stage |
| `03-parity.js` | Asserts the `$sql` rollup == the SQL `GROUP BY` == the maintained bucket counters |
| `_capture.sql` | Helper: emits the SQL-lane rollup for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
`$sql`-in-pipeline rollup returns through the MongoDB API, and the parity assertion
confirms it equals the SQL `GROUP BY` (same machine/hour COUNT/AVG/MAX).
Run with `../../run.sh 03-bucket`.
