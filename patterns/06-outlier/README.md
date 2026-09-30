---
title: Outlier
industry: Financial services (brokerage)
deck: "34–37"
problem: >-
  Advisor documents embed their client book. Institutional books break the 16 MB cap, so
  the Outlier pattern adds overflow documents and a second code path in the application.
knobs:
  - { name: Diversity, setting: "Low — one book screen" }
  - { name: Read / write, setting: "Read-heavy by day" }
  - { name: Update locality, setting: "Skew ×800, p50 → max", hot: true }
---
# Pattern 06 — Outlier (whale documents)

**Financial / wealth management.** Open an advisor and read their book of clients as
one document.

> The outlier is just more rows, and the optimizer plans for it.

## The document bet

The Outlier pattern tunes the document for the *typical* record and special-cases the
fat tail. Embed the client book on the advisor document — fine for the ordinary
advisor, a few dozen to a few hundred clients fits comfortably.

## Where the needle flips

A handful of institutional advisors carry **100,000-client books.** Their document
blows past the **16 MB ceiling**, so the pattern adds a `hasExtras` flag, spills the
tail into an **overflow collection**, and now **every reader must branch**: *"if
hasExtras, go fetch the overflow and stitch it back."* That is the 16 MB
storage-engine limit **leaking into your application code** — and into the LLM's
context builder, which now has to know about the special case too.

The pattern does not solve the outlier. It **admits the model breaks** for the fat
tail and pushes the special case up into every consumer.

The writes pay too. Until it spills, the whale's book is one growing document: in the
lab, advisor A-900 already embeds 800 clients, and adding one more is a
read-modify-write of the whole book. Spilling to overflow is itself cheap — the
outlier pattern costs you the growth rewrite of the document before the spill, plus
a branch in every reader.

## The converged softening

There is no special document shape. Clients are **rows in one table**, referenced by
advisor:

- The **typical** advisor's book is projected as a document by a **duality view** —
  no flag, no branch.
- The institutional **whale** is the *same table, same optimizer* — it just returns
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
