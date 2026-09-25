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

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (23.26.2)**.
Run them with `../../run.sh 01-extended-reference` (or pipe each file to `sqlplus`).
