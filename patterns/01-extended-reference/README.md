---
title: Extended Reference
industry: Wealth management
deck: "14–17"
problem: >-
  Four consumers render every client with their advisor, so the advisor card is embedded
  in every client and account document. Reads are instant, until an advisor moves offices
  and every embedded copy has to be found and rewritten.
knobs:
  - { name: Diversity, setting: "High: 4 consumers", help: "The client portal, the advisor CRM, the statement run and the AI copilot all render the client with the advisor card, so four readers want it inline." }
  - { name: Read / write, setting: "Extreme read skew", help: "About 50 million client-360 reads a day against roughly 300 advisor edits: on this knob alone, embedding the card is the right bet." }
  - { name: Update locality, setting: "Rare, fans out ×2,700", hot: true, help: "Each advisor edit lands on about 2,700 documents (790 clients plus 1,920 accounts), so a reorg day of 8,000 changes is roughly 22 million document rewrites." }
help:
  tabs:
    document:
      why: "The starting point: copy the advisor card into every client document so the client-360 read needs no lookup. The bet pays until an advisor moves and every copy has to be found and rewritten."
      look: "The advisor move's rows affected: one per client document that embeds A-001."
    converged:
      why: "The advisor is stored once and a duality view projects the same client document through the foreign key. Every read pays for a primary-key join (about 15% more read work in the deck's model); every advisor move is one row."
      look: "The advisor move reports 1 row affected, and the confirm query still shows both of A-001's clients on NYC-09."
    mongo:
      why: "The same duality view, read over the MongoDB API: one set of rows, two access surfaces, one advisor row."
      look: "The advisor.office in the returned document matches what the SQL read of xr_client_dv shows."
    measure:
      why: "The ratio is the document model's redo for the advisor move divided by the converged model's. The document side rewrites every document that embeds the advisor, so the ratio grows with that count; the converged side is one row at any count."
      look: "Your dot at 2 embedded copies, on a reference line that reaches about 3,000× at 1,000 copies."
measure:
  x_label: "documents embedding the moved advisor"
  lab_x: 2
  deck_slides: "14–17"
  calibration:
    - { x: 1, ratio: 3.47 }   # doc 1652 B, conv 476 B
    - { x: 10, ratio: 30.71 }   # doc 14616 B, conv 476 B
    - { x: 100, ratio: 303.83 }   # doc 144624 B, conv 476 B
    - { x: 1000, ratio: 3036.59 }   # doc 1445416 B, conv 476 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

# Pattern 01: Extended Reference ⭐

**Wealth management.** Open any client or account and show the servicing advisor's
name, office, and desk line. The deck's book: 2,400 advisors, 1.9 million clients,
4.6 million accounts, and four consumers (client portal, advisor CRM, nightly
statement run, AI copilot) that all render the client with the advisor card.

> Project, don't copy.

## The document bet

The Extended Reference pattern copies the most-read fields of a referenced entity
*into* the referencing document, so the read never has to look them up. The advice
is disciplined: "only copy fields that rarely change." Embed the advisor card on
every client and every account (statements render per account), and each screen is
a single document read with no lookup.

On two of the three knobs this is the right bet. **Diversity** is high: four
consumers want the card inline. **Read / write** is extreme: about 50 million
client-360 reads a day (600 a second on average, 12,000 at the open) against roughly
300 advisor edits. Nothing about the choice is a mistake.

## Where the needle flips

The third knob, **update locality**, is where it turns. The advisor is now stored
once per document that embeds it, and nothing enforces that the copies agree. When a
copied value changes (an advisor moves offices, changes a desk line) every embedded
copy has to be found and rewritten. In the deck's book each advisor appears in about
**2,700 documents** (790 client documents plus 1,920 account documents), so one
office move is about 2,700 rewrites, each one re-serializing the whole document.
Twice a year a regional reorg makes about 8,000 such changes in a day: roughly
**22 million document rewrites**.

Those rewrites are not one transaction. Until the last one lands, the portal can show
the old office while the copilot, reading another document as context, shows the new
one. Nothing crashes; the answers just disagree.

That is the pattern's trade in one line: **write amplification in, update anomaly
out.** The illustrative cost model on deck slide 16 puts a number on it: embedding
costs one document read per screen plus 2,700 rewrites per change; projecting the
card costs about **15% more per read** plus one row per change. On a normal day (300
changes) **embedding is cheaper**. Break-even is about **930 changes a day**. On reorg
day the day's total work roughly doubles, and correctness is the bigger cost. The
needle flips on the worst day, not the average one, so model for the reorg.

Both sides of that curve run on Oracle (the document side here is a JSON collection
table on the same engine), so the comparison is about shape, not vendor.

## The converged alternative

Store the advisor **once**, as one row in the relational projection, and have each
client reference it by foreign key. A **JSON Relational Duality View** then projects
the exact client document the document developer wanted, advisor block inline. The
advisor block is assembled through the foreign key when the document is read, not
stored as a copy.

What that costs: every read pays for a primary-key join, about 15% more read work in
the deck's model. Joins are never free. What it buys: an advisor moving offices is
**one row**, and every document that projects that advisor shows the change at the
same commit. No fan-out, no stale copy, no sync job between the portal and the
copilot.

The view also decides what a write through it can touch. `fullName` and `segment` are
`WITH UPDATE`; the advisor subquery is `WITH NOUPDATE`, so an attempt to change
`advisor.office` through the view is rejected (ORA-40940) and the office changes only
in its own row. That is per-field governance enforced by the engine.

## When the document shape stays

- **Snapshot the immutable.** A trade's execution price, or the advisor of record on
  a signed statement, is history: freeze it in the document. A later change must
  never rewrite it. That is Extended Reference used exactly as intended.
- **Project the mutable.** An advisor's *current* office is reference data that
  changes: project it rather than copy it.
- If edits stay well below the break-even and there is no reorg-style burst, the
  embedded card is cheaper to read and the extra rewrites are a fair price.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Advisor card embedded in every client document; an office change fans out across every copy |
| `02-converged.sql` | Advisor stored once as a row; a duality view projects it into the client document; the office change is one row |
| `03-parity.js` ⭐ | Reads `xr_client_dv` through the **MongoDB API** and asserts it is byte-equal to the same view read through **SQL**: one projection, two access surfaces, the same projected shape |
| `_capture.sql` | Helper: emits the SQL-lane document that `03-parity.js` compares against |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
cross-API parity assertion passes: the projected client document is identical through
SQL and through the Oracle API for MongoDB.
Run with `../../run.sh 01-extended-reference`.
