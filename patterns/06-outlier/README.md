---
title: Outlier
industry: Financial services (brokerage)
deck: "34–37"
problem: >-
  Advisor documents embed their client book, which is right for the 180-client median. About
  120 institutional and team books of 20,000 to 150,000 clients break the 16 MB cap, so the
  Outlier pattern adds overflow documents and a second code path in the application.
knobs:
  - { name: Diversity, setting: "Low: one book screen", help: "The portal and the batch read the book the same way, top clients by AUM, so one shape serves both." }
  - { name: Read / write, setting: "Read-heavy by day", help: "About 2,000 book reads a second at the open, and one AUM refresh storm a night." }
  - { name: Update locality, setting: "Skew ×800, p50 → max", hot: true, help: "The largest book is about 800× the median and takes the nightly refresh and every transition: embedded is about 3× cheaper at the 180-client median, about 50× dearer at a 150,000-client book, with break-even near 3,200." }
help:
  tabs:
    document:
      why: "The starting point: embed the client book on the advisor document, which is right for the 99% of advisors under 500 clients. Books that outgrow the 16 MB cap spill into overflow documents behind a hasExtras flag, and every reader gains a branch."
      look: "The whale read's has_extras, clients_embedded and clients_in_overflow: one advisor, two places to look."
    converged:
      why: "Clients are rows with an (advisor_id, aum DESC) index, so every book is the same top-N query whether it holds 180 clients or 148,000. At the median the single document was cheaper, about 3× in the deck's model; the rows buy one code path."
      look: "The insert reports 1 row affected, and the whale's top 3 and next 3 come from the same query with OFFSET."
    mongo:
      why: "The CRM reads the book as a document over the MongoDB API and the AI assistant reads the same projection over SQL/JSON, both from the client rows the book screen queries."
      look: "The returned A-001 document carries its clients array and no hasExtras flag."
    measure:
      why: "The ratio is the redo for appending one client to the embedded book divided by the redo for one client row. The document side rewrites the whole book, so the ratio grows with the clients already embedded; the row insert stays near 1.2 KB."
      look: "Your dot at 800 clients, near 17× (about 20 KB of redo against 1.2 KB)."
measure:
  x_label: "clients embedded in the advisor's book"
  lab_x: 800
  sizes: [10, 100, 800, 2000]
  deck_slides: "34–37"
  calibration:
    - { x: 10, ratio: 1.65 }   # doc 2016 B, conv 1224 B
    - { x: 100, ratio: 5.01 }   # doc 6136 B, conv 1224 B
    - { x: 800, ratio: 16.96 }   # doc 20760 B, conv 1224 B
    - { x: 2000, ratio: 43.39 }   # doc 48768 B, conv 1124 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

# Pattern 06: Outlier (whale documents)

**Financial services (brokerage).** Open an advisor and read their book of clients,
top 100 by AUM, as one document. The platform has about 40,000 advisors and 17 million
clients (illustrative numbers; the shape of the distribution is the point).

> The outlier is just more rows, and the optimizer plans for it.

## The document bet

The Outlier pattern tunes the document for the *typical* record and special-cases the
fat tail. Embed the client book on the advisor document. The median advisor has 180
clients and 99% have fewer than 500, so for almost everyone the book is one document of
roughly 72 KB: one read, sorted in the app, done. For those advisors it genuinely beats
anything else, and that is worth saying plainly.

## Where the needle flips

About 120 institutional and team advisors carry **20,000 to 150,000-client books.**
At roughly 400 bytes a client the **16 MB ceiling** arrives near 40,000 clients, so the
team spills at 20,000 per document: the pattern adds a `hasExtras` flag, parks the tail
in **overflow documents** (seven of them for a 148,000-client book), and now **every
reader must branch**: *"if hasExtras, go fetch the overflow and stitch it back."* That
is the 16 MB document limit **leaking into your application code**: the portal, the
nightly batch, and the AI assistant's context builder all have to know about the
special case.

The knobs show why this one flips on the distribution, not the average. Diversity is
low (one screen reads the book one way) and the workload is read-heavy by day, about
2,000 book reads a second at the open; on those two knobs alone you would embed and move
on. Update locality is the hot knob: the largest book is about 800 times the median, and
the nightly AUM refresh and every advisor transition land inside those largest
documents. You design for the p50 and pay at the p99.9.

In the deck's illustrative cost model (not a benchmark), for a top-100 read the embedded
book is **about 3 times cheaper** at the 180-client median, break-even is **near 3,200
clients**, and a 148,000-client team book is **about 50 times more work**: eight
fetches, every client decoded, and a merge-sort in the application, on a code path that
only the 120 largest books ever exercise.

The pattern does not solve the outlier. It **admits the model breaks** for the fat
tail and pushes the special case up into every consumer.

The writes pay too. Until it spills, the whale's book is one growing document: in the
lab, advisor A-900 already embeds 800 clients, and adding one more is a
read-modify-write of the whole book: about 20 KB of redo against roughly 1.2 KB for one
client row, near 17 times in this lab (the deck's 26ai Free run measured about 20
times). Spilling to overflow is itself cheap: the outlier pattern costs you the growth
rewrite of the document before the spill, plus a branch in every reader.

## The converged softening

Start from the canonical form, the logical model: desk, advisor and client, where a
client is its own entity related to one advisor. The outlier exists only because the
document projection draws a physical boundary around the book. Store the client in a
different projection, **rows in one table** keyed by `advisor_id`, and there is no
special shape:

- Where a consumer wants the book as a document (the CRM over the MongoDB API, the AI
  assistant over SQL/JSON), a **duality view** produces it from the rows: no flag, no
  branch.
- The book screen runs one top-N query over the `(advisor_id, aum DESC)` index and
  **pages** with `FETCH FIRST` / `OFFSET`. The institutional **whale** is the *same
  table, same query*: the optimizer plans a stopped range scan that reads about 100
  index entries whether the book holds 180 clients or 148,000. Cardinality is a
  statistic, not a code path.
- Moving a book to another advisor is one `UPDATE` of `advisor_id` in one transaction,
  with no receiving document that might itself cross the cap.

The 16 MB ceiling never enters the picture, because the book was never one physical
document.

**The tradeoff, stated plainly.** The rows are not free to read. Every book read is a
query, an index descent and 100 assembled rows, and at the median that is about 3 times
the work of one stored document in the deck's model. What that read cost buys is one
code path for all 40,000 advisors, and writes that no longer scale with the size of the
book.

**When the document is still the right choice.** If the list has a hard upper bound
(ten saved watchlists, five beneficiaries), embed it. The Outlier pattern, and the
argument against it, only matters when the bound is a guess.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Embedded book (800-client whale) + growth append + `hasExtras` flag + overflow collection + reader branch |
| `02-converged.sql` | One clients table (the same 800-client whale as rows); a duality view produces the typical book as a document; the whale is paged rows |
| `03-parity.js` | Reads `ol_advisor_dv` via the MongoDB API and asserts byte-equality with the SQL lane |
| `_capture.sql` | Helper: emits the SQL-lane document for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. Cross-API
parity passes: the typical-advisor document (client array projected from rows) is
identical through SQL and the MongoDB API.
Run with `../../run.sh 06-outlier`.
