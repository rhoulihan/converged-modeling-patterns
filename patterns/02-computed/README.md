---
title: Computed
industry: Telecom
deck: "18–21"
problem: >-
  Each subscriber document carries a running cycle-usage rollup so the app and real-time
  charging read one document — but every call record now rewrites that hot document.
knobs:
  - { name: Diversity, setting: "Medium-high — 4 consumers", help: "The self-care app, real-time charging, the ops dashboard and the bill run all read usage, each in a different shape." }
  - { name: Read / write, setting: "Write-heavy on the rollup", help: "About 30 balance reads a subscriber a day against 11 CDRs on average and 400-plus for heavy users, so on average the rollup is written once for every three reads, and for heavy users it is written more often than it is read." }
  - { name: Update locality, setting: "Every write, one parent", hot: true, help: "Every CDR lands on the same subscriber document: break-even is about 4.4 CDRs a subscriber a day, and a 400-a-day heavy user costs about 2.5× the work embedded." }
help:
  tabs:
    document:
      why: "The starting point: keep a running cycleUsage rollup on the subscriber document so the balance check reads one document. The read is right; the cost is that every CDR rewrites the whole, growing document."
      look: "cdrs_in_document on the account page: the line items that every new CDR has to rewrite."
    converged:
      why: "CDRs become append-only rows and a trigger keeps a narrow usage row current in the same transaction. The balance read joins that row by primary key (about 30% more read work in the deck's model); each CDR is a small insert plus a one-row counter bump."
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

Usage is not written once. Every Call Detail Record appends a line item and
re-ticks the rollup, and each one is a read-modify-write that **rewrites the whole
subscriber document**. The document grows with every call, so the redo each CDR
costs grows with it: in the lab, subscriber S-001 already carries 1,000 CDR line
items this cycle, and posting one more rewrites all of them. On a hot subscriber
that is a write storm on one document. The pattern's own escape hatch —
counter-sharding into N documents and fanning the read back in — leaves the write
amplification exactly where it was.

And the Top-N dashboard gets no help at all: with the rollup buried inside each
document, ranking the top talkers means **SUM → SORT → LIMIT across the whole
collection on every load.** At book scale that is the query that melts down.

## The converged softening

Two moves, both keeping the read cheap:

1. **CDRs are append-only rows.** One small insert per event — no parent document to
   rewrite. Both serialize per subscriber; the converged write is ~1.5 KB instead of
   the whole document. A maintained summary carries the rollup and is kept current
   **in the same transaction** by a row trigger: *Computed, with a staleness
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
| `01-document-model.sql` | Baked `cycleUsage` over 1,000 embedded CDR line items; each CDR rewrites the whole, growing subscriber doc; Top-N is a full scan |
| `02-converged.sql` | The same 1,000 CDRs as append-only rows + trigger-maintained summary (staleness 0) + descending Top-N index + duality projection |
| `03-parity.js` | Reads `cp_subscriber_dv` (rollup included) via the MongoDB API and asserts byte-equality with the SQL lane |
| `_capture.sql` | Helper: emits the SQL-lane document for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. Cross-API
parity passes: the subscriber document with its live rollup is identical through SQL and
the MongoDB API.
Run with `../../run.sh 02-computed`.
