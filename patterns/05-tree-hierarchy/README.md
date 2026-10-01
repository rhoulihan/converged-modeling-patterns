---
title: Tree / Hierarchy
industry: Manufacturing bill of materials
deck: "30–33"
problem: >-
  Each part carries a materialized path. Re-parenting a subassembly rewrites every
  descendant, and "which products use this part?" cannot be answered from a path.
knobs:
  - { name: Diversity, setting: "High: 4 questions", help: "Planning explodes an assembly, costing rolls it up, engineering asks where-used and quality asks recall impact: four questions over one structure, two of them upward." }
  - { name: Read / write, setting: "Read-heavy", help: "About 2 million explosions a day against about 200 engineering change orders, so on this knob alone the path's prefix scan is the right read." }
  - { name: Update locality, setting: "Lands on every descendant", hot: true, help: "One re-parent rewrites the path of every part in the moved subtree, 10 to 40,000 parts: break-even is about 1,000 parts a move, and a 10,000-part move makes the path's day about 3× the edge model's." }
help:
  tabs:
    document:
      why: "The starting point: every part carries a materialized path, so exploding an assembly is one prefix range scan. Position is stored in every node, so moving a subassembly rewrites every descendant, and the path cannot answer where-used."
      look: "The re-parent's rows affected: one per part in the moved subtree."
    converged:
      why: "Structure lives in edge rows: CONNECT BY explodes an assembly, and a property graph over the same rows answers where-used. The recursive walk costs about 30% more per explosion than a prefix scan in the deck's model; a re-parent is one edge row."
      look: "The re-parent reports 1 row affected, and the re-explosion shows the wheelset under P-1200."
    measure:
      why: "The ratio is the redo for rewriting every descendant's path divided by the redo for one edge update. It grows in step with the subtree, about 1.3 KB per moved part, while the edge update stays near 1 KB."
      look: "Your dot at 3 moved parts, near 4×, on a reference line that reaches about 4,000× at 3,000 parts."
measure:
  x_label: "parts in the moved subtree"
  lab_x: 3
  deck_slides: "30–33"
  calibration:
    - { x: 3, ratio: 4.23 }   # doc 3972 B, conv 940 B
    - { x: 30, ratio: 40.92 }   # doc 39448 B, conv 964 B
    - { x: 300, ratio: 409.29 }   # doc 394556 B, conv 964 B
    - { x: 3000, ratio: 3997.97 }   # doc 3949992 B, conv 988 B
---
# Pattern 05: Tree / Hierarchy

**Manufacturing.** Explode a bill of materials (read a whole subassembly's
components fast) and ask "what is this part used in?"

The deck's scenario: an equipment maker with 1.2 million parts, up to 12 levels
deep. About 2 million explosions a day (planning, costing, the service portal),
about 5,000 where-used questions a day plus recall bursts, and about 200
engineering change orders (ECOs) a day, many of which re-parent a subassembly of
10 to 40,000 parts. The numbers are illustrative; the shape is universal.

> Store the edge, derive the position.

## The document bet

The materialized-path pattern stores each component with its chain of ancestors as a
string: `/P-1000/P-1100/P-1110`. A subtree read becomes a **left-anchored prefix
scan** (`LIKE '/P-1000/P-1100%'`): an index range scan, O(log n). That is the
cheapest explosion there is, and it is the right instinct for a read-heavy day.

## Where the needle flips

Two edges, one on write and one on read:

- **Write.** The path *encodes position*, so moving one subassembly rewrites the path
  of **every descendant.** Re-parent a wheelset and you rewrite the wheelset, the
  wheel, the spoke, every node beneath it: write amplification **proportional to the
  size of the subtree** for a single logical move.
- **Read.** A genuine graph question ("which assemblies use this wheel?"): upward,
  multi-parent, N hops, is something a *downward prefix string simply cannot express.*
  Share one component across two assemblies and the materialized path breaks: a node
  now has more than one path. Teams usually bolt on a `usedIn` parent list, a second
  structure the application has to keep in sync by hand.

The path stores a derived fact (position) in every node, and derived facts you
store are facts you have to rewrite.

Put numbers on it (the deck's illustrative cost model, not a benchmark): charge
each explosion 1 unit via the prefix scan and about 30% more via a recursive walk,
and charge each document or row rewrite 3 units. **Break-even sits near 1,000 parts
per move.** Below that, or for a tree that rarely moves, the path's day is cheaper.
A 10,000-part module move makes the path's day about 3× the edge model's; at
40,000 parts it is about 10×. Where-used is left out of the model, which favours
the path; counting it only moves the break-even left.

## The converged softening

Split the two questions the path was trying to answer at once. In the canonical
form (the logical model) each parent → child link is one relationship; the
relational projection stores it as one edge row, and position is derived by
walking the edges.

- **Structure lives in adjacency edges** (`parent_id → child_id`). Re-parenting is a
  **single edge update**: the subtree follows automatically, because position is not
  baked into every node. Reorg write cost drops from O(subtree) to **O(1)**.
- **Subtree / explosion reads use native recursion** through the SQL access surface:
  `CONNECT BY` streams the frontier in one pass. (Emit `CONNECT BY` or `GRAPH_TABLE`
  for hierarchy, never a recursive CTE, which dams each level into an intermediate
  relation the optimizer can barely optimize.) The walk is not free: it goes level
  by level and costs more per explosion than a prefix scan, about 30% in the deck's
  model.
- **Genuine graph questions use SQL/PGQ `GRAPH_TABLE`** over the *same rows*: the
  where-used, multi-parent, N-hop DAG the prefix string could not express. No separate
  graph database to sync, no `usedIn` array to maintain.

| | Materialized path | Edges + graph |
|---|---|---|
| ECO re-parent | 1 document per part in the subtree | 1 edge row |
| Explode an assembly | 1 prefix range scan | `CONNECT BY` pass (about +30%) |
| Where-used | second structure, app-synced | `GRAPH_TABLE`, same rows |

The write the path made expensive (reorg) becomes one row, and the read the path
could not do at all (where-used across shared components) becomes one graph match,
paid for with a real recursive-read premium on every explosion.

## When the path is still the right choice

A tree that rarely moves and is read one way (a product catalogue, an org chart
snapshot), or one whose moves stay well under about 1,000 parts: keep the
materialized path. Its prefix scan is the cheapest explosion there is, and with
few or small moves there is little write amplification to pay for. Store the edge
when engineering reshapes large subtrees every day or the reverse question matters.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | Materialized paths; a re-parent rewrites every descendant's path |
| `02-converged.sql` | Adjacency edges (reorg = one row) + `CONNECT BY` explosion + `GRAPH_TABLE` where-used |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**. This
pattern stays pure-SQL: adjacency/graph traversal (`CONNECT BY` / `GRAPH_TABLE`) has no
single-collection document shape, so there is no MongoDB API lane here.
Run them with `../../run.sh 05-tree-hierarchy`.
