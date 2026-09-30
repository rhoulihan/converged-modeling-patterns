---
title: Subset
industry: Insurance
deck: "26–29"
problem: >-
  The policy document keeps the ten most recent claim events inline. Every event becomes a
  push-sort-trim rewrite of the policy to maintain a list a query could simply read.
knobs:
  - { name: Diversity, setting: "High: 4 consumers", help: "Agents, the customer app, adjusters and fraud all read claim events: the first two want the recent few, the last two want everything." }
  - { name: Read / write, setting: "Read-heavy, ~67 : 1", help: "About 2 million summary reads a day against about 30,000 claim events, which is the case for keeping the subset inline." }
  - { name: Update locality, setting: "Every event hits the parent", hot: true, help: "Every claim event rewrites the parent policy document and writes history too: break-even is about 83,000 events a day, and a 300,000-event CAT day makes the subset about 40% more expensive than querying." }
help:
  tabs:
    document:
      why: "The starting point: keep the most recent claims inline on the policy so the summary page reads one document, and push each full claim into a history collection. Every new claim is a whole-policy rewrite plus a second write that has to stay in step."
      look: "recent_claims_inline holds exactly 3 claims, trimmed by hand on every write."
    converged:
      why: "One claims table and a (policy_id, claim_ts DESC) index make the recent N a range scan that stops after N rows. The summary read does more work than one document fetch, about 25% in the deck's model; each claim is one insert."
      look: "The insert reports 1 row affected, and the recent-claims query returns the newest 3 with no stored subset."
    measure:
      why: "The ratio is the redo for pushing and trimming the policy document divided by the redo for one claim insert. The document side rewrites every claim kept inline, so the ratio grows with the subset's size; the insert stays near 1 KB."
      look: "Your dot at 3 inline claims sits near 1.6×, and it leaves out the history insert the document model also pays."
measure:
  x_label: "claims kept inline in the policy document"
  lab_x: 3
  deck_slides: "26–29"
  calibration:
    - { x: 3, ratio: 1.62 }   # doc 1680 B, conv 1036 B
    - { x: 10, ratio: 1.95 }   # doc 2024 B, conv 1036 B
    - { x: 100, ratio: 6.12 }   # doc 6336 B, conv 1036 B
    - { x: 1000, ratio: 26.26 }   # doc 26576 B, conv 1012 B
---
# Pattern 04: Subset (hot inline / vertical partition)

**Insurance.** The policy page shows the 3 most recent claims instantly; the full
claim history is opened rarely.

> Stop maintaining the subset. Query it.

## The document bet

The Subset pattern keeps the hot slice (the recent N claims) **inline** on the
policy document so the common read touches one document, and pushes the cold tail
into a separate history collection. Keep the working set in RAM; keep the hot read
to a single fetch.

## Where the needle flips

To keep the inline subset "recent," **every new claim** has to push into the inline
array, **trim** the array back to N, *and* insert the full claim into the overflow
collection, two writes, plus a whole-document rewrite of the policy, on every
claim. You are paying a maintenance write on **every** write to serve a full-history
read that **hardly ever happens.** Writes are heavy; the read you optimized for is
rare. The needle is pointing the wrong way.

## The converged softening

There is **one claims table**: hot and cold live together. A composite index on
`(policy_id, claim_ts DESC)` makes "the recent N" an index range scan that **stops
after N rows**: an O(log n) seek, no maintenance write, no overflow collection, no
trimming. Every claim is a single append. The full policy document (header plus its
recent claims) is assembled **at read time** with SQL/JSON, so hot and cold are
reunited by the query, never by a maintenance job.

The subset stops being *state you maintain* and becomes *a projection you ask for.*
The rare full-history read is the same query without the `FETCH FIRST`.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Recent-N inline + overflow collection; each claim is push + trim + overflow write |
| `02-converged.sql` | One claims table + descending composite index; recent-N via `FETCH FIRST`; doc assembled on read |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. This
pattern stays pure-SQL: a claims table has no natural single Mongo collection to read
against, so there is no Mongo lane here.
Run them with `../../run.sh 04-subset`.
