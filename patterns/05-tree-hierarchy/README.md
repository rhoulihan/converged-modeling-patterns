# Pattern 05 — Tree / Hierarchy

**Manufacturing.** Explode a bill of materials — read a whole subassembly's
components fast — and ask "what is this part used in?"

> Store the edges. Let the engine traverse.

## The document bet

The materialized-path pattern stores each component with its chain of ancestors as a
string: `/P-1000/P-1100/P-1110`. A subtree read becomes a **left-anchored prefix
scan** (`LIKE '/P-1000/P-1100%'`) — an index range scan, O(log n). Cheap subtree
reads, and that part is genuinely good.

## Where the needle flips

Two edges, one on write and one on read:

- **Write.** The path *encodes position*, so moving one subassembly rewrites the path
  of **every descendant.** Re-parent a wheelset and you rewrite the wheelset, the
  wheel, the spoke, every node beneath it — write amplification **proportional to the
  size of the subtree** for a single logical move.
- **Read.** A genuine graph question — "which assemblies use this wheel?", upward,
  multi-parent, N hops — a *downward prefix string simply cannot express.* Share one
  component across two assemblies and the materialized path breaks: a node now has
  more than one path.

## The converged softening

Split the two questions the path was trying to answer at once:

- **Structure lives in adjacency edges** (`parent_id → child_id`). Re-parenting is a
  **single edge update** — the subtree follows automatically, because position is not
  baked into every node. Reorg write cost drops from O(subtree) to **O(1)**.
- **Subtree / explosion reads use native recursion** — `CONNECT BY` streams the
  frontier in one pass. (Emit `CONNECT BY` or `GRAPH_TABLE` for hierarchy, never a
  recursive CTE, which dams each level into an intermediate relation the optimizer can
  barely optimize.)
- **Genuine graph questions use SQL/PGQ `GRAPH_TABLE`** over the *same rows* — the
  where-used, multi-parent, N-hop DAG the prefix string could not express. No separate
  graph database to sync.

The write the path made expensive (reorg) becomes one row; the read the path could
not do at all (where-used across shared components) becomes one graph match.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Materialized paths; a re-parent rewrites every descendant's path |
| `02-converged.sql` | Adjacency edges (reorg = one row) + `CONNECT BY` explosion + `GRAPH_TABLE` where-used |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (23.26.2)**.
Run them with `../../run.sh 05-tree-hierarchy`.
