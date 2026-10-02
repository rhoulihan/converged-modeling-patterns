---
title: Computed
industry: Telecom
deck: "18–21"
problem: >-
  Each subscriber document carries a running cycle-usage rollup so the app and real-time
  charging read one document, but every call record now rewrites that hot document.
knobs:
  - { name: Diversity, setting: "Medium-high: 4 consumers", help: "The self-care app, real-time charging, the ops dashboard and the bill run all read usage, each in a different shape." }
  - { name: Read / write, setting: "Write-heavy on the rollup", help: "About 30 balance reads a subscriber a day against 11 CDRs on average and 400-plus for heavy users, so on average the rollup is written once for every three reads, and for heavy users it is written more often than it is read." }
  - { name: Update locality, setting: "Every write, one parent", hot: true, help: "Every CDR rewrites the whole subscriber document (3.4× the redo of the row write at ~3.5 KB, measured on 26ai). With rate checks reading the summary row, the narrow row is cheaper at every volume: about 2.3× for a light subscriber, 4.3× for a 400-a-day heavy user." }
help:
  tabs:
    document:
      why: "The starting point: keep a running cycleUsage rollup on the subscriber document so the balance check reads one document. The read is right; the cost is that every CDR rewrites the whole, growing document."
      look: "cdrs_in_document on the account page: the line items that every new CDR has to rewrite."
    converged:
      why: "CDRs become append-only rows and a trigger keeps a narrow usage row current in the same transaction. Rate checks read that row directly; only the account page joins it through the duality view (about 30% more read work). Each CDR is a small insert plus a one-row counter bump."
      look: "The CDR insert reports 1 row affected, and the account page reads total_mb from one summary row."
    mongo:
      why: "The subscriber document the app wanted, projected over the MongoDB API with the live rollup inline and read-only."
      look: "cycleUsage.totalMB in the returned document matches total_mb from the SQL reads."
    measure:
      why: "The ratio is the document model's redo for one CDR divided by the converged model's. The document side rewrites every line item already in the subscriber document, so the ratio climbs as the cycle fills; the converged insert stays near 1.6 KB."
      look: "Your dot at 1,000 line items, near the 33× reference point (about 52 KB of redo against 1.6 KB)."
measure:
  x_label: "CDR line items in the subscriber document"
  lab_x: 1000
  deck_slides: "18–21"
  calibration:
    - { x: 10, ratio: 1.73 }   # doc 2708 B, conv 1568 B
    - { x: 100, ratio: 7.16 }   # doc 11288 B, conv 1576 B
    - { x: 1000, ratio: 32.53 }   # doc 51792 B, conv 1592 B
    - { x: 5000, ratio: 203.24 }   # doc 323560 B, conv 1592 B
---
# Pattern 02: Computed

**Telecom.** Show a subscriber's current-cycle usage instantly on the account page,
and rank the top talkers for the ops dashboard.

> Keep the read win. Stop paying for it with a whole-document rewrite on every event.

## The document bet

The Computed pattern bakes a rollup onto the document: compute once on write, then
serve every read from the stored answer instead of re-aggregating a month of CDRs.
The math is real: a million reads an hour against a thousand writes an hour means
precomputing "divides the work by a thousand." Store `cycleUsage` on the subscriber
and the self-care app and real-time charging each get the balance from a single
lookup. The read side of this bet is right; the question is what it costs on the
write side, and who pays.

## Where the needle flips

Usage is not written once. Every Call Detail Record (CDR) appends a line item and
re-ticks the rollup, and each one is a read-modify-write that **rewrites the whole
subscriber document**. The document grows with every call, so the redo each CDR
costs grows with it: in the lab, subscriber S-001 already carries 1,000 CDR line
items this cycle, and posting one more rewrites all of them. A heavy user throws off
400 or more CDRs a day, so the busiest subscribers own the hottest documents. The
pattern's escape hatch, counter sharding (split the counter into N shard documents),
does spread the write contention, but now every balance check reads N documents and
sums them: a write problem traded for a read problem, on the latency-critical
charging path.

And the Top-N dashboard gets no help at all: with the rollup buried inside each of
12 million documents, ranking the top talkers means **SUM, SORT, LIMIT across the
whole collection on every load.**

**Put the rollup where the readers are.** Most of the ~30 daily reads of a
subscriber's usage are rate and consumption checks from real-time charging, not the
self-care app. They need three numbers, not the document. On a narrow summary row they
are a primary-key read; on the document they fetch and parse it every time. The app's
account page, the only reader that wants the whole document, reads a couple of times
a day. A write-heavy rollup with rare full-document reads argues for the relational
projection.

**Measured on 26ai Free** (8 KB blocks, JSON stored inline in the row; scratch tables,
the lab's own Measure-it protocol):

| Write or read | Redo per write | Block changes |
|---|---|---|
| Summary row update (with its Top-N index) | 1,016 B | 7 |
| Converged CDR write: insert + summary update | 1,776 B | 13 |
| Document update, rollup only (64 B of JSON) | 1,460 B | 9 |
| Document update, ~3.5 KB (50 line items) | 5,996 B | 9 |
| Document update, ~7.6 KB (110 line items) | 11,292 B | 10 |
| Document update, ~69 KB (the lab's 1,000 line items) | 47,592 B | 18 |
| **1,000 committed updates**, summary row | 1.2 MB redo | 69 blocks written |
| **1,000 committed updates**, ~6.2 KB document | 9.8 MB redo | 1,021 blocks written |
| Rate check: summary row by primary key | 3 logical reads, 4.0 µs | |
| Rate check: one counter from a ~3.4 KB document | 3 logical reads, 9.5 µs | |

What the numbers say:

- **The 8 KB block is the unit of I/O, not a floor on cost.** Redo and undo grow with
  the bytes rewritten. A document update rewrites the whole document even when it
  changes three counters (appending a line item costs the same), so a 3.5 KB document
  logs 3.4× the redo of the row write, and a 6.2 KB one 9×.
- **Physical block writes don't level off either.** Repeated updates to one hot data
  block coalesce (69 block writes for 1,000 row updates), but each whole-document
  rewrite also generates undo the size of the document, and that lands in new blocks:
  1,021 block writes for the 6.2 KB document.
- **Rate checks get cheaper, not dearer**, on the summary row: the same logical I/O as
  fetching the document, without extracting a value from it.

In the deck's illustrative cost model calibrated to these numbers (28 rate checks
and 2 account-page reads a subscriber a day; a CDR costs 6.8 units on the document
against 2 for the row), **append + summary is cheaper at every volume**: about 2.3×
for a light subscriber, 2.9× for the average at 11 CDRs a day, and 4.3× for the
heavy user at 400. The counter-case, stated honestly: if every read were a full
account-page read, embedding would still win below about 2 CDRs a day.

## The converged softening

In canonical form (the logical model) a CDR is an immutable fact, appended once, and
the cycle rollup is one derived value per subscriber. The Computed pattern splits
into two things that were never the same: facts and a derivation. Two moves follow:

1. **CDRs are append-only rows.** One small insert per event, no parent document to
   rewrite. A narrow summary row carries the rollup and is kept current **in the
   same transaction** by a row trigger: *Computed, with a staleness window of zero.*
   (Declarative equivalent: a materialized view `REFRESH FAST ON COMMIT` over a CDR
   mview log.) Both models serialize per subscriber; the summary row locks just as
   the document does. What changes is what you do while holding the lock: a ~1.5 KB
   write instead of a rewrite of the whole, growing document.
2. **Hot Top-N becomes an index range scan.** A descending index on the summary's
   usage column turns "top talkers" into an O(log n) seek plus `FETCH FIRST N`, no
   SUM, no SORT, no full-collection scan.

This is the shape behind an anonymized field result on exactly this workload: a
landing-page Top-N that went **from 60 seconds to 500 milliseconds**, ACID, with no
precompute job, no change streams, and no eventual-consistency window. Want the
document shape at the API? A duality view projects the subscriber with the live
rollup inline and read-only, through the same privileges, auditing and policies as
the tables underneath.

Measured in this lab on 26ai Free, recording one CDR against a subscriber document
already holding 1,000 CDRs costs about 52 KB of redo; the converged insert plus the
trigger-maintained summary row costs about 1.6 KB, roughly **33×** less.

## The tradeoff, honestly

| | Embedded rollup | Append + summary |
|---|---|---|
| Record a CDR | whole-document rewrite (~52 KB redo at 1,000 CDRs) | small insert + one counter row (~1.6 KB) |
| Rate check (most reads) | 1 document (9.5 µs measured) | 1 narrow row (4.0 µs measured) |
| Account page (rare) | 1 document | 1 document, joined by primary key (~30% more read work) |
| Top 20 talkers | sort every document | index range scan |

The read premium is real, but only the account page pays it: the duality view joins
the usage row on each read. The rate checks that make up most reads read the narrow
row and get faster. What the design buys is the end of the whole-document rewrite on
every CDR.

**When a document is still right:** a **rollup-only document** (the three counters,
with the line items stored elsewhere) measured within 1.4× of the summary row on
redo and blocks written. That is the relational design written as JSON, and it is a
fine choice when a document API is the requirement. A closed cycle's final bill,
written once and then read, belongs in a document too. What does not work at any
volume is the Computed pattern's usual shape: counters inside the growing document.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Baked `cycleUsage` over 1,000 embedded CDR line items; each CDR rewrites the whole, growing subscriber doc; Top-N is a full scan |
| `02-converged.sql` | The same 1,000 CDRs as append-only rows + trigger-maintained summary (staleness 0) + descending Top-N index + duality projection |
| `03-parity.js` | Reads `cp_subscriber_dv` (rollup included) via the MongoDB API and asserts byte-equality with the SQL lane |
| `_capture.sql` | Helper: emits the SQL-lane document for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. Cross-API
parity passes: the subscriber document with its live rollup is identical through SQL and
the MongoDB API.
Run with `../../run.sh 02-computed`.
