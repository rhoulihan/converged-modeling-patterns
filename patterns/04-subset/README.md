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
      why: "One claims table and a (policy_id, claim_ts DESC) index make the recent N a range scan that stops after N rows. The summary read does more work than one document fetch, about 25% in the deck's model; what that buys is one insert per claim and nothing to keep in step."
      look: "The insert reports 1 row affected, and the recent-claims query returns the newest 3 with no stored subset."
    measure:
      why: "Each size rebuilds the policy with that many claims inline on the document side and as rows on the converged side, then re-runs one claim event: the document model pushes and trims the whole policy, the converged model inserts one row. The read side counts the blocks each model's recent-claims read touches."
      look: "The redo gap grows with the subset's size; the break-even sits near 10 reads per event until the inline list gets large, then turns to never."
measure:
  x_label: "claims kept inline in the policy document"
  lab_x: 3
  sizes: [3, 10, 100, 1000]
  workload: { reads_per_write: 67, label: "about 2 million summary reads against 30,000 claim events a day" }
  deck_slides: "26–29"
  verdict: >-
    The document model wins this workload, up to a point. Reading the recent claims touches 3 blocks from the policy document against 4 for the index range scan, so the document model needs about 9 to 10 reads per claim event to win while the subset is small. With about 67 (2 million reads, 30,000 events) it wins up to 100 claims inline; at 1,000 inline claims its read is dearer and it never wins. A catastrophe day of 300,000 events drops the mix to about 7 reads per event, and the converged model wins.
  calibration:
    - { x: 3, ratio: 1.62 }   # doc 1680 B, conv 1036 B
    - { x: 10, ratio: 1.95 }   # doc 2024 B, conv 1036 B
    - { x: 100, ratio: 6.12 }   # doc 6336 B, conv 1036 B
    - { x: 1000, ratio: 26.26 }   # doc 26576 B, conv 1012 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

# Pattern 04: Subset (hot inline / vertical partition)

**Insurance.** The policy summary page shows the most recent claim events instantly
(the deck uses 10; this lab keeps 3 so the output stays readable); the full claim
history is opened far less often.

> Stop maintaining the subset. Query it.

## The document bet

The Subset pattern keeps the hot slice (the recent N claims) **inline** on the
policy document so the common read touches one document, and pushes the cold tail
into a separate history collection. Keep the working set in RAM; keep the hot read
to a single fetch. In the deck's workload (8 million policies, about 2 million
summary reads a day against about 30,000 claim events) that bet is sound: the
summary read dwarfs the event write.

## Where the needle flips

To keep the inline subset "recent," **every new claim event** pays twice: a
push-sort-trim **rewrite of the whole policy document**, *and* an insert of the full
event into the history collection. That is two writes in two places for one fact, and
if the second write fails, the summary and the history disagree. It also
concentrates: every event on every claim lands on the same policy document, which
becomes the hottest document in the system because of a list it has to maintain.

On a normal day the Subset pattern still wins. In the deck's illustrative cost model
(not a benchmark), querying adds about 25% to each summary read, and on 2 million
reads that premium is real. Break-even is about **83,000 events a day**. A
catastrophe (CAT) day, such as a hurricane landfall, runs at about **300,000**
events, and then the Subset pattern costs about **40% more** than querying, with
every extra write a whole-document rewrite on exactly the policies the customer app
is hammering. Size the model for the storm, not the sunny day.

## The converged softening

The canonical form is policy, claim and claim event, where a claim event is an
immutable fact recorded once. Here it is projected as rows on **one claims table**:
hot and cold live together. A composite index on `(policy_id, claim_ts DESC)` keeps
each policy's claims pre-sorted, so "the recent N" is an index range scan that
**stops after N rows**. Every claim is one insert and one index entry: no
maintenance rewrite, no history collection, no trimming. SQL/JSON assembles the same
policy document (header plus its recent claims) **at read time**, so hot and cold are
reunited by the query, never by a maintenance job.

That is the tradeoff, priced honestly: the summary read now does more work than a
single document fetch (about 25% in the deck's model). What it buys is a write path
that does not collapse in a storm, and one copy of every event for fraud review and
audit. The subset stops being *state you maintain* and becomes *a projected shape you
ask for.* The rarer full-history read is the same query without the `FETCH FIRST`.

**When the document shape is still right:** if the inline slice is frozen at write
time and rarely changes (for example, the three coverages printed on the
declarations page), keep it in the document. A slice that changes on every event is
a query.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Recent-N inline + history collection; each claim is a push-and-trim rewrite of the policy plus a history insert |
| `02-converged.sql` | One claims table + descending composite index; recent-N via `FETCH FIRST`; policy document assembled on read |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. This
pattern stays on the SQL and SQL/JSON access surfaces: a claims table has no natural
single collection to read through the MongoDB API, so there is no MongoDB API lane here.
Run them with `../../run.sh 04-subset`.
