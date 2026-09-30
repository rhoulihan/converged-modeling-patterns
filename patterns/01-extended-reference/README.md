---
title: Extended Reference
industry: Wealth management
deck: "14–17"
problem: >-
  Four consumers render every client with their advisor, so the advisor card is embedded
  in every client and account document. Reads are instant — until an advisor moves offices
  and every embedded copy has to be found and rewritten.
knobs:
  - { name: Diversity, setting: "High — 4 consumers", help: "The client portal, the advisor CRM, the statement run and the AI copilot all render the client with the advisor card, so four readers want it inline." }
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
# Pattern 01 — Extended Reference ⭐

**Wealth management.** Open any client or account and show the servicing advisor's
name, office, and desk line — without a join.

> Project, don't copy.

## The document bet

The Extended Reference pattern copies the most-read fields of a referenced entity
*into* the referencing document, so the read never has to look them up. The advice
is disciplined — "only copy fields that rarely change." Embed the advisor block on
every client and account, and the account page renders with zero joins.

## Where the needle flips

The advisor is now stored **N times**, once per client. Nothing enforces that the
copies agree. The moment a copied value changes — an advisor moves offices, changes
a desk line — you have to find and rewrite **every embedded copy**. On a book of
100,000 clients that is a 100,000-document fan-out for one logical change, and each
document you miss is now serving a stale office to the client portal *and* to the
copilot reading that same document as context.

That is the pattern's whole trade in one line: **write amplification in, update
anomaly out.** It is a workaround for a missing capability — the engine's
reluctance to join — not a law of physics.

## The converged softening

Store the advisor **once**. Reference it by foreign key. Then let a **JSON
Relational Duality View** project the exact client document you wanted — advisor
block inline — where the advisor block is a *live projection through the FK*, not a
stored copy. The read shape is identical. An advisor moving offices is now **one
row**, and every document that projects that advisor is correct in the same
transaction. Fan-out: gone. Stale copy: impossible.

The rule this encodes:

- **Snapshot the immutable.** A trade's execution price is transaction truth —
  freeze it in the document; a later price change must never rewrite history.
- **Project the mutable.** An advisor's *current* office is reference data — never
  freeze it, project it live.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Advisor embedded on every client doc; an office change fans out across all copies |
| `02-converged.sql` | Advisor normalized once; duality view projects it live; the office change is one row |
| `03-parity.js` ⭐ | Reads `xr_client_dv` via the **MongoDB API** and asserts it is byte-equal to the same view read via **SQL** — "one truth, many shapes" |
| `_capture.sql` | Helper: emits the SQL-lane document that `03-parity.js` compares against |

## Validated

Both lanes run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. The
cross-API parity assertion passes: the projected client document is identical through
SQL and through the Oracle API for MongoDB.
Run with `../../run.sh 01-extended-reference`.
