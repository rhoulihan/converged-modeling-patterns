---
title: Computed
industry: Telecom
deck: "18–21"
problem: >-
  Each subscriber document carries the full profile plus a running cycle-usage summary, so
  the account page reads one document, but every call record's summary update now rewrites
  the whole subscriber document.
knobs:
  - { name: Diversity, setting: "Medium-high: 4 consumers", help: "The self-care app, real-time charging, the ops dashboard and the bill run all read usage, each in a different shape." }
  - { name: Read / write, setting: "Write-heavy on the summary", help: "About 30 balance reads a subscriber a day, but 28 are rate checks that need three numbers; the account page that wants the document reads about twice. Against 11 CDRs on average and 400-plus for heavy users, the summary is written far more often than the document is read." }
  - { name: Update locality, setting: "Every write, one parent", hot: true, help: "Every CDR's summary update rewrites the whole ~6 KB subscriber document: 12.8 KB of redo per CDR against 1.5 KB for the summary row (8.3×, measured on 26ai). With rate checks on the row, the narrow row is cheaper at every volume: about 3.2× for a light subscriber, 8.2× for a 400-a-day heavy user." }
help:
  tabs:
    document:
      why: "The starting point: keep the cycleUsage summary on the subscriber document so the account page reads one document. CDRs are stored separately; the cost is that every CDR's summary update rewrites the whole subscriber document, profile and all."
      look: "subscriber_doc_bytes on the account page: the ~6 KB every summary update rewrites to change three counters."
    converged:
      why: "CDRs are append-only rows and a trigger keeps a narrow summary row current in the same transaction; the profile stays in cp_subscribers, untouched by CDRs. Rate checks read the summary row directly; only the account page joins it through the duality view (about 30% more read work)."
      look: "The CDR insert reports 1 row affected, and the account page reads total_mb from one summary row."
    mongo:
      why: "The subscriber document the app wanted, profile included, projected over the MongoDB API with the live summary inline and read-only."
      look: "cycleUsage.totalMB in the returned document matches total_mb from the SQL reads."
    measure:
      why: "The ratio is the document model's redo for one CDR (CDR insert plus summary update) divided by the converged model's (CDR insert plus trigger-maintained summary row). The summary update rewrites the whole subscriber document, so the ratio grows with the document's size; the converged write stays near 1.5 KB."
      look: "Your dot at the lab's ~6 KB subscriber document, near the 8.3× reference point (about 12.8 KB of redo against 1.5 KB)."
measure:
  x_label: "KB in the subscriber document"
  lab_x: 6
  sizes: [1, 2, 4, 6, 7]
  workload: { reads_per_write: 2.7, label: "about 30 usage reads against 11 CDRs per subscriber a day" }
  deck_slides: "18–21"
  calibration:
    - { x: 1, ratio: 2.82 }   # doc 4356 B, conv 1544 B
    - { x: 2, ratio: 3.97 }   # doc 6128 B, conv 1544 B
    - { x: 4, ratio: 6.12 }   # doc 9456 B, conv 1544 B
    - { x: 6, ratio: 8.29 }   # doc 12800 B, conv 1544 B
    - { x: 7, ratio: 9.47 }   # doc 14620 B, conv 1544 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

# Pattern 02: Computed

**Telecom.** Show a subscriber's current-cycle usage instantly on the account page,
and rank the top talkers for the ops dashboard.

> Keep the precomputed summary. Stop rewriting the whole subscriber to update it.

## The document bet

The Computed pattern keeps a precomputed answer on the document: compute once on
write, then serve reads from the stored result instead of re-aggregating a month of
CDRs. Put `cycleUsage` (total MB, minutes, cost) on the subscriber document and the
account page gets profile and usage in a single lookup. The CDRs themselves are
stored separately, one small document each: the summary is the only thing the
pattern adds to the subscriber. The read side of this bet is right; the question is
what it costs on the write side, and who pays.

## Where the needle flips

**The subscriber document is not small.** It carries the profile: plan, devices,
addresses, preferences, consents and account history, about 6 KB in the lab. The
summary is three numbers. Every Call Detail Record (CDR) updates the summary, and in
a document database updating three counters **rewrites the whole subscriber
document**. The document doesn't grow; it is simply far bigger than the change. A
heavy user throws off 400 or more CDRs a day, so the busiest subscribers pay that
rewrite most often.

Contention is not the problem. At 400 CDRs a day (one every 3.6 minutes) nothing
waits on a lock, and nothing needs counter sharding. **The cost is bytes**: a
whole-document rewrite on every CDR, to speed up a read that happens a couple of
times a day. And the Top-N dashboard gets no help at all: with the summary inside
each of 12 million documents, ranking the top talkers means **SORT and LIMIT across
the whole collection on every load.**

**Put the summary where the readers are.** Most of the ~30 daily reads of a
subscriber's usage are rate and consumption checks from real-time charging, not the
self-care app. They need three numbers, not the profile. On a narrow summary row they
are a primary-key read; on the document they fetch and parse it every time. The app's
account page, the only reader that wants the whole document, reads about twice a day.
A write-heavy summary with rare full-document reads belongs in its own table, joined
on read.

**Measured on 26ai Free** (8 KB blocks, JSON stored inline in the row; the lab's own
Measure-it protocol):

| Write or read | Redo per write | Block changes |
|---|---|---|
| Summary row update (with its Top-N index) | 1,016 B | 7 |
| Same three counters inside a 1 KB subscriber document | 3,520 B | 9 |
| ... inside a ~3.5 KB subscriber document | 8,320 B | 9 |
| **One CDR, converged:** insert + trigger-maintained summary row | **1,544 B** | 13 |
| **One CDR, document:** CDR insert + summary update, ~6 KB subscriber document (the lab) | **12,800 B (8.3×)** | 15 |
| 1,000 committed counter updates, summary row | 1.2 MB redo | 69 blocks written |
| 1,000 committed counter updates, ~6.2 KB document | 9.8 MB redo | 1,021 blocks written |
| Rate check: summary row by primary key | 3 logical reads, 4.0 µs | |
| Rate check: one counter from a ~3.4 KB document | 3 logical reads, 9.5 µs | |

What the numbers say:

- **The 8 KB block is the unit of I/O, not a floor on cost.** Redo and undo grow with
  the bytes rewritten: about twice the document's size per summary update, whatever
  changed inside it. The narrow row is 8× cheaper than the same counters inside a
  3.5 KB document.
- **Physical block writes don't level off either.** Repeated updates to one hot data
  block coalesce (69 block writes for 1,000 row updates), but each whole-document
  rewrite also generates undo the size of the document, and that lands in new blocks:
  1,021 block writes for the 6.2 KB document.
- **Rate checks get cheaper, not dearer**, on the summary row: the same logical I/O as
  fetching the document, without extracting a value from it.

In the deck's illustrative cost model calibrated to these numbers (28 rate checks
and 2 account-page reads a subscriber a day; a CDR costs 16.6 units on the ~6 KB
document against 2 for the row), **append + summary is cheaper at every volume**:
about 3.2× for a light subscriber, 5.8× for the average at 11 CDRs a day, and 8.2× for
the heavy user at 400. The counter-case, stated honestly: if every read were a full
account-page read, the document would still win below about 0.6 CDRs a day, which is
to say a subscriber who barely uses the phone.

## The converged softening

In canonical form (the logical model) a CDR is an immutable fact, appended once, the
subscriber's profile changes rarely, and the cycle total is one derived value per
subscriber. The Computed pattern bundles that derived value into the profile. Two
moves pull it back out:

1. **The summary lives in a narrow row.** CDRs are append-only rows (the same small
   insert the document design pays), and a row trigger keeps a three-counter summary
   row current **in the same transaction**: *Computed, with a staleness window of
   zero.* (Declarative equivalent: a materialized view `REFRESH FAST ON COMMIT` over a
   CDR log. Exact, but measured on 26ai it costs about 8× the trigger's redo and 40×
   its time per single-row commit; pattern 03 has the breakdown.) The profile stays in
   `cp_subscribers`, and no CDR ever touches it.
2. **Hot Top-N becomes an index range scan.** A descending index on the summary's
   usage column turns "top talkers" into an O(log n) seek plus `FETCH FIRST N`, no
   SORT, no full-collection scan.

This is the shape behind an anonymized field result on exactly this workload: a
landing-page Top-N that went **from 60 seconds to 500 milliseconds**, ACID, with no
precompute job, no change streams, and no eventual-consistency window. Want the
document shape at the API? A duality view projects the subscriber with the profile
and the live summary inline (the summary read-only), through the same privileges,
auditing and policies as the tables underneath.

## The tradeoff, honestly

| | Summary in the subscriber document | Summary row + append-only CDRs |
|---|---|---|
| Record a CDR (measured, ~6 KB subscriber) | CDR insert + whole-document rewrite, 12.8 KB redo | CDR insert + one counter row, 1.5 KB |
| Rate check (most reads) | 1 document (9.5 µs measured) | 1 narrow row (4.0 µs measured) |
| Account page (rare) | 1 document | 1 document via the duality view, PK join (~30% more read work) |
| Top 20 talkers | sort every document | index range scan |

The read premium is real, but only the account page pays it: the duality view joins
the summary row on each read, about twice a day. The rate checks that make up most
reads read the narrow row and get faster. What the design buys is the end of the
whole-document rewrite on every CDR.

**When a document is still right:** a **rollup-only document** (the three counters,
with the profile stored elsewhere) measured within 1.5× of the summary row on redo.
That is the relational design written as JSON, and a fine choice when a document API
is the requirement. A closed cycle's final bill, written once and then read, belongs
in a document too. What does not pay at this workload is the Computed pattern's
usual shape: the summary inside the full subscriber document.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | CDRs as small documents; the `cycleUsage` summary on a ~6 KB subscriber document that every CDR's update rewrites; Top-N is a full scan |
| `02-converged.sql` | The same CDRs as append-only rows + trigger-maintained summary row (staleness 0) + descending Top-N index + duality projection (profile and summary) |
| `03-parity.js` | Reads `cp_subscriber_dv` (profile and summary) via the MongoDB API and asserts byte-equality with the SQL lane |
| `calibrate.sql` | Resizes the subscriber profile for Measure it's reference curve |
| `_capture.sql` | Helper: emits the SQL-lane document for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. Cross-API
parity passes: the subscriber document with its live summary is identical through SQL and
the MongoDB API.
Run with `../../run.sh 02-computed`.
