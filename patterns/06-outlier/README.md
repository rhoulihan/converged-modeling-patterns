---
title: Outlier
industry: Financial services (brokerage)
deck: "34–37"
problem: >-
  Advisor documents embed their client book. Institutional books break the 16 MB cap, so
  the Outlier pattern adds overflow documents and a second code path in the application.
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
  deck_slides: "34–37"
  calibration:
    - { x: 10, ratio: 1.65 }   # doc 2016 B, conv 1224 B
    - { x: 100, ratio: 5.01 }   # doc 6136 B, conv 1224 B
    - { x: 800, ratio: 16.96 }   # doc 20760 B, conv 1224 B
    - { x: 2000, ratio: 43.39 }   # doc 48768 B, conv 1124 B
---
# Pattern 06: Outlier (whale documents)

**Financial / wealth management.** Open an advisor and read their book of clients as
one document.

> The outlier is just more rows, and the optimizer plans for it.

## The document bet

The Outlier pattern tunes the document for the *typical* record and special-cases the
fat tail. Embed the client book on the advisor document, fine for the ordinary
advisor, a few dozen to a few hundred clients fits comfortably.

## Where the needle flips

A handful of institutional advisors carry **100,000-client books.** Their document
blows past the **16 MB ceiling**, so the pattern adds a `hasExtras` flag, spills the
tail into an **overflow collection**, and now **every reader must branch**: *"if
hasExtras, go fetch the overflow and stitch it back."* That is the 16 MB
storage-engine limit **leaking into your application code**, and into the LLM's
context builder, which now has to know about the special case too.

The pattern does not solve the outlier. It **admits the model breaks** for the fat
tail and pushes the special case up into every consumer.

The writes pay too. Until it spills, the whale's book is one growing document: in the
lab, advisor A-900 already embeds 800 clients, and adding one more is a
read-modify-write of the whole book. Spilling to overflow is itself cheap: the
outlier pattern costs you the growth rewrite of the document before the spill, plus
a branch in every reader.

## The converged softening

There is no special document shape. Clients are **rows in one table**, referenced by
advisor:

- The **typical** advisor's book is projected as a document by a **duality view**:
  no flag, no branch.
- The institutional **whale** is the *same table, same optimizer*: it just returns
  more rows, and you **page** them with `FETCH FIRST` / `OFFSET` over the
  `(advisor_id, aum DESC)` index. That is the whole "outlier" story on a converged
  engine: ordinary pagination over ordinary rows.

The 16 MB ceiling never enters the picture, because the book was never one physical
document. The fat tail stops being an application special case.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Embedded book (800-client whale) + growth append + `hasExtras` flag + overflow collection + reader branch |
| `02-converged.sql` | One clients table (the same 800-client whale as rows); duality projects the typical book; the whale is paged rows |
| `03-parity.js` | Reads `ol_advisor_dv` via the MongoDB API and asserts byte-equality with the SQL lane |
| `_capture.sql` | Helper: emits the SQL-lane document for the parity check |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. Cross-API
parity passes: the typical-advisor document (client array projected from rows) is
identical through SQL and the MongoDB API.
Run with `../../run.sh 06-outlier`.
