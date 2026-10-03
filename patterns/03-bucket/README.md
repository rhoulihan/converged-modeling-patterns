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
  - { name: Update locality, setting: "Every write, same document", hot: true, help: "Every reading lands on the same growing bucket: break-even is about 900 readings a bucket, a one-a-second sensor already costs about 2.7× the rows, and a ten-a-second spindle about 22×, marching at the 16 MB cap. Against a running summary row, measured on 26ai, the converged write is cheaper at every bucket size, even 3 readings." }
help:
  tabs:
    document:
      why: "The starting point: one bucket document per sensor per hour, readings pushed into an array under running count, sum and max. The dashboard reads one document; every reading rewrites the growing bucket."
      look: "The bucket read's n and max_temp come off counters that every write maintains."
    converged:
      why: "Readings are small append-only rows in an hourly INTERVAL-partitioned table, and a trigger keeps a running summary row per machine and hour (count, sum, max) in each reading's own transaction. The dashboard reads one row; GROUP BY stays available for anything the summary doesn't answer."
      look: "The insert reports 3 rows affected; the summary-row read and the GROUP BY return the same n, average and max per machine and hour."
    mongo:
      why: "The anomaly team keeps db.aggregate() through the MongoDB API and runs the rollup as one $sql stage (Oracle's addition to the aggregation pipeline: a full SQL statement as one stage) over the same partitioned rows, planned by the optimizer."
      look: "One rollup document per machine and hour, with n, avg and max matching the SQL GROUP BY."
    measure:
      why: "The ratio is the bucket's redo for 3 appends divided by the redo for 3 row inserts plus their summary-row bumps. Each append rewrites the bucket as it stands, so the ratio grows with the readings in it; the inserts and bumps cost the same whether the hour holds 3 readings or 3,600."
      look: "Your dot at 33 readings (the lab bucket holds the hour's first 30, then the measured 3), near 3.9×. The reference line reaches about 166× at 3,600 readings (one a second for an hour)."
measure:
  x_label: "readings in the bucket after the write"
  lab_x: 33
  sizes: [33, 100, 1000, 3600]
  deck_slides: "22–25"
  calibration:
    - { x: 33, ratio: 3.87 }   # doc 10964 B, conv 2836 B
    - { x: 100, ratio: 8.82 }   # doc 24596 B, conv 2788 B
    - { x: 1000, ratio: 38.65 }   # doc 109616 B, conv 2836 B
    - { x: 3600, ratio: 165.94 }   # doc 470596 B, conv 2836 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

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
the canonical form at all; they are *derived*: computed with a `GROUP BY` on read, or
maintained incrementally, one counter bump per reading.

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

## Rate sizes the bucket, until incremental rollup wins

The update rate decides how big a bucket gets, and that is the trap. Size it by time
(one per sensor-hour) and a faster sensor means a fatter bucket, so the cost of each
append climbs with the rate. Size it by count and the hour spreads across more and more
buckets, so the dashboard's read climbs with the rate instead. The best bucket size is
a fixed number that doesn't move with rate, and no size makes the growth cost go away.

A running summary has no size to choose. Store each reading as a row and keep one
narrow summary row per machine-metric-hour current as each reading lands: one small
insert plus one counter bump, flat at any rate, and the dashboard reads one row.

**Measured on 26ai Free** (redo per reading; scratch tables, Measure-it protocol):

| Write | Redo per reading |
|---|---|
| Bucket append, empty bucket | 3,603 B |
| Bucket append, 10 / 50 / 150 readings already in it | 4,690 / 8,936 / 18,936 B (3,600 B + 102 B per reading in the bucket) |
| Document store, incremental: reading document + summary-document update | 4,849 B, flat |
| **Converged, incremental: reading row + summary-row bump** | **2,144 B, flat** |
| Raw reading row only (compute on read) | 1,515 B |

| Read the hour | Time |
|---|---|
| Summary row by primary key | 5 µs |
| One bucket's counters (indexed `_id`) | 8 to 12 µs |
| `GROUP BY` over 3,600 rows | 250 µs |

What it says:

- **Inside a document store there is a crossover.** A time-bounded bucket's average
  append costs about 3,600 + 51·N bytes over its life, which passes the 4,849 B of a
  reading document plus a running summary document at about **24 readings a bucket**:
  one reading every 2.5 minutes for an hourly bucket. Above that rate, incremental
  rollup beats the bucket, and shrinking the bucket only moves the cost to the read.
- **On the converged engine there is no crossover.** Even an empty bucket's first
  append (3,603 B) costs more than a row plus a summary-row bump (2,144 B). Running
  summaries over append-only rows beat every bucket size at every rate, and the summary
  row is also the cheapest read.
- **Rate still decides one thing:** bucket versus compute on read. That is the ~900
  break-even above. The running summary beats both.
- **One honest footnote: the first readings of a new hour.** The first reading has to
  create that hour's summary row and its index entry in a fresh partition, so the
  hour's first few writes touch more blocks than appending to a near-empty bucket
  (25 against 21 for three readings), though still less redo (3,448 B against
  4,736 B). From then on the converged write is flat at about 19 blocks. That is why
  the lab measures mid-hour, with 30 readings already in it.

**Why a trigger, not `REFRESH FAST ON COMMIT`.** The declarative way to keep the
summary current is a materialized view with fast refresh on commit over a view log:
no code, staleness zero, and the optimizer can rewrite matching `GROUP BY` queries to
it. Measured per reading on 26ai Free (insert-only, both results exact):

| Per reading | 1 reading per commit | 10 readings per commit |
|---|---|---|
| Base row insert | 594 B · 18 µs | 333 B · 10 µs |
| + trigger summary bump | **969 B · 33 µs** | **636 B · 20 µs** |
| + MV log only | 1,378 B · 66 µs | 1,048 B · 21 µs |
| + on-commit fast refresh | **8,017 B · 1,339 µs** | **2,143 B · 152 µs** |

The view log alone costs more than the whole trigger, and the commit-time refresh is
most of the rest: 8× the redo and about 40× the time at one reading per commit,
narrowing to 3.4× and 7.7× at ten. Declarative convenience has a measurable price at
ingest rates. Measure it before you pick it.

## The converged softening

Stop hand-rolling buckets for the hot sensors. Let the partition be the bucket: **range
partitioning** does the amortization the bucket was faking, and `GROUP BY` does the
rollup:

- Readings are tiny, append-only rows in an **INTERVAL-partitioned** table: Oracle
  opens a new hourly partition on its own as time advances. Each reading is one small
  row: no array to grow, no document to rewrite, no 16 MB ceiling.
- The per-hour summary is a **running summary row**, kept current by a trigger in each
  reading's own transaction: one counter bump per reading, staleness zero, and the
  dashboard reads one row. A `GROUP BY` over the partition range (asking for one hour
  **prunes** to one partition) answers anything the summary doesn't.
- The anomaly team keeps its aggregation pipeline. `$sql` is Oracle's addition to the
  MongoDB aggregation pipeline: one more stage of `db.aggregate()` whose body is a full
  SQL statement, with rows returned to the driver as documents. The rollup inside it
  gets the cost-based optimizer, parallel execution and pruning to the partitions it
  needs, with none of the pipeline's 100 MB stage-memory or 16 MB output caps (see the
  root README).

**The price.** Each reading pays a summary-row bump on top of its insert, about 375 B
of redo and 14 µs measured. What that buys is a constant-cost write with no 16 MB
ceiling and a one-row dashboard read at any rate. An anonymized field result for
exactly this reshape: a 29-second bucket rollup fell to **under 400 milliseconds**.

**When the bucket still makes sense:** in a document store without a running summary,
for slow sensors. At one reading a minute a bucket holds 60 readings, below the ~900
break-even against compute on read; and below about 24 readings a bucket it beats a
reading document plus a summary document. On the converged engine, with the summary
row available, the measurements above leave the bucket no case to make.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Per-hour bucket doc; each reading `$push` + counter rewrites the growing bucket |
| `02-converged.sql` | INTERVAL-partitioned readings (constant-cost inserts) + trigger-maintained running summary per machine-hour + `GROUP BY` for everything else |
| `01-document-model.js` | The `$push` bucket through the MongoDB API: the same write amplification, runnable in `mongosh` |
| `02-sql-in-pipeline.js` | The hourly rollup as **full SQL through the MongoDB API** via a `$sql` pipeline stage |
| `03-parity.js` | Asserts the `$sql` rollup == the SQL `GROUP BY` == the trigger-maintained summary == the bucket counters |
| `_capture.sql` | Helper: emits the SQL-lane rollup for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
`$sql`-in-pipeline rollup returns through the MongoDB API, and the parity assertion
confirms it equals the SQL `GROUP BY` (same machine/hour COUNT/AVG/MAX).
Run with `../../run.sh 03-bucket`.
