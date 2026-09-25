# Pattern 04 — Subset (hot inline / vertical partition)

**Insurance.** The policy page shows the 3 most recent claims instantly; the full
claim history is opened rarely.

> Stop maintaining the subset. Query it.

## The document bet

The Subset pattern keeps the hot slice — the recent N claims — **inline** on the
policy document so the common read touches one document, and pushes the cold tail
into a separate history collection. Keep the working set in RAM; keep the hot read
to a single fetch.

## Where the needle flips

To keep the inline subset "recent," **every new claim** has to push into the inline
array, **trim** the array back to N, *and* insert the full claim into the overflow
collection — two writes, plus a whole-document rewrite of the policy, on every
claim. You are paying a maintenance write on **every** write to serve a full-history
read that **hardly ever happens.** Writes are heavy; the read you optimized for is
rare. The needle is pointing the wrong way.

## The converged softening

There is **one claims table** — hot and cold live together. A composite index on
`(policy_id, claim_ts DESC)` makes "the recent N" an index range scan that **stops
after N rows**: an O(log n) seek, no maintenance write, no overflow collection, no
trimming. Every claim is a single append. The full policy document — header plus its
recent claims — is assembled **at read time** with SQL/JSON, so hot and cold are
reunited by the query, never by a maintenance job.

The subset stops being *state you maintain* and becomes *a projection you ask for.*
The rare full-history read is the same query without the `FETCH FIRST`.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Recent-N inline + overflow collection; each claim is push + trim + overflow write |
| `02-converged.sql` | One claims table + descending composite index; recent-N via `FETCH FIRST`; doc assembled on read |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (23.26.2)**.
Run them with `../../run.sh 04-subset`.
