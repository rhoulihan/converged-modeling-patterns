---
title: Tree / Hierarchy
industry: Manufacturing bill of materials
deck: "30–33"
problem: >-
  Each part carries every materialized path it sits on, so exploding an assembly is one
  index range scan. Re-parenting a subassembly rewrites every descendant, but that happens
  200 times a day against 2 million explosions.
knobs:
  - { name: Diversity, setting: "High: 4 questions", help: "Planning explodes an assembly, costing rolls it up, engineering asks where-used and quality asks recall impact. The path answers all four: a prefix scan downward, and one part document (whose paths name every ancestor) upward." }
  - { name: Read / write, setting: "Read-heavy: decides it", help: "About 2 million explosions a day against about 200 engineering change orders. Every explosion is cheaper on the path (measured on 26ai: 765 µs for a 1,092-part assembly, against 1,116 µs walking edges with CONNECT BY), so the read side of the day decides the pattern." }
  - { name: Update locality, setting: "Lands on every descendant", hot: true, help: "One re-parent rewrites every part in the moved subtree, one row each (about 1.7–2.5 KB of redo per part, measured). It is the cost the path pays, and at this workload the smaller bill: the edge model only catches up once a typical move passes about 88,000 parts." }
help:
  tabs:
    document:
      why: "The answer for this workload: every part is one document carrying every path it sits on, under a multivalue index. Exploding an assembly is one prefix range scan, where-used is one document read, and a part shared by two assemblies is still one row. The cost lands on re-parenting, which rewrites every descendant."
      look: "The explosion's plan is one multivalue index range scan, and the re-parent's rows affected is one per part in the moved subtree."
    converged:
      why: "The measured alternative: store the canonical edges and derive position by walking them. A re-parent becomes one edge row, but every explosion pays the walk (about 1.5x the path's prefix scan with CONNECT BY, 2.5x with GRAPH_TABLE), and at 2 million explosions a day that premium outweighs the path's rewrites."
      look: "The re-parent reports 1 row affected; compare the explosion steps with the path lane's single range scan."
    measure:
      why: "The ratio is the path's redo for one re-parent (every descendant rewritten) divided by the edge model's (one row). It grows with the subtree, about 1.7 KB per moved part, while the edge update stays under 1 KB. It is the cost the path pays 200 times a day; the deck's model sets it against the read premium the edges pay 2 million times."
      look: "Your dot at 3 moved parts, near 7×, on a reference line that reaches about 5,100× at 3,000 parts."
measure:
  x_label: "parts in the moved subtree"
  lab_x: 3
  deck_slides: "30–33"
  verdict: >-
    The document model wins this workload. It is read-heavy: about 2 million explosions a
    day against about 200 engineering changes, and every explosion is cheaper on the path's
    prefix scan than walking edges (measured on 26ai: 765 µs against 1,116 µs for a
    1,092-part assembly). What this tab measures is the other side of the trade: the redo for
    one re-parent, which rewrites every part in the moved subtree. That bill comes 200 times
    a day, and it only outweighs the read savings once a typical move passes about 88,000
    parts.
  calibration:
    - { x: 3, ratio: 6.75 }   # doc 6348 B, conv 940 B
    - { x: 30, ratio: 53.76 }   # doc 51820 B, conv 964 B
    - { x: 300, ratio: 527.25 }   # doc 508272 B, conv 964 B
    - { x: 3000, ratio: 5137.86 }   # doc 5076204 B, conv 988 B
---
<img src="../../docs/assets/oracle-logo.svg" alt="Oracle" height="18">

# Pattern 05: Tree / Hierarchy

**Manufacturing.** Explode a bill of materials (read a whole subassembly's
components fast) and ask "what is this part used in?"

The deck's scenario: an equipment maker with 1.2 million parts, up to 12 levels
deep. About 2 million explosions a day (planning, costing, the service portal),
about 5,000 where-used questions a day plus recall bursts, and about 200
engineering change orders (ECOs) a day, many of which re-parent a subassembly of
10 to 40,000 parts. The numbers are illustrative; the shape is universal.

> Keep the path. Pay on the move, not on every read.

## The document bet

The materialized-path pattern stores each part with the chain of ancestors above it
as a string: `/P-1000/P-1100/P-1110`. A part used in more than one assembly carries
one path per use, in an array on its one document, and a **multivalue index** puts
every path in one index. Then:

- **Explode an assembly** = a left-anchored prefix range scan on that index
  (`paths starts with "/P-1000/P-1100/"`). The cheapest hierarchy read there is.
- **Where-used** = read the part's own document: its paths name every assembly
  above it, shared ones included.
- **Change a part** (cost, revision, supplier) = one row, however many assemblies
  use it.

This is a read-heavy workload, and the bet is right.

## Where the needle could flip

**The move.** A path *encodes position*, so moving one subassembly rewrites the
paths of **every part beneath it**: one row each, for one logical change. Re-parent a
10,000-part module and you rewrite 10,000 documents. On this engine that is one
statement in one transaction, so no explosion sees a half-moved subtree, but the
bytes are real.

**Measured on 26ai Free** (an 88,573-part synthetic BOM, 11 levels; the lab's
Measure-it protocol):

| Explode an assembly of… | Path: prefix scan, multivalue index | Edges: `CONNECT BY` (parts joined in) | Graph: `GRAPH_TABLE` |
|---|---|---|---|
| 12 parts | 23 µs | 25 µs | 227 µs |
| 120 parts | 101 µs | 135 µs | 462 µs |
| 1,092 parts | **765 µs** | **1,116 µs (1.5×)** | **1,945 µs (2.5×)** |
| 9,840 parts | 6,644 µs | 9,920 µs (1.5×) | 10,700 µs (1.6×) |

| Re-parent one subassembly | Redo | Time |
|---|---|---|
| Path: rewrite every descendant | about 1.7–2.5 KB per moved part | about 40 µs per moved part |
| Edges: one edge row | about 1.2 KB, any subtree | under 0.2 ms |

Put the day together (database time, measured costs, explosions averaging a
1,092-part assembly): the path spends about **1,530 s a day on explosions** and
0.008 s per moved part on ECOs; the edges spend about **2,232 s on explosions** and
almost nothing on ECOs. **Break-even sits near 88,000 parts per move**, more than
twice the deck's largest. At 10,000-part moves the edge model's day costs about
1.4× the path's; at 40,000, about 1.2×. Matching with `GRAPH_TABLE` instead costs
about 2.1–2.4×.

Two honest caveats. If most explosions are small (around 120 parts), the read gap
shrinks and break-even drops to about 8,500 parts per move. And the path's moves
cost redo: at 10,000-part moves, about 3.5–5 GB of log a day that the edge model
never writes. That is log, backup and standby I/O, not query time.

## The alternative: store the edge

In the canonical form (the logical model) each parent → child link is one
relationship. Storing exactly that, one edge row per link, makes a re-parent **one
row**: position is derived by walking the edges, never stored. `CONNECT BY` explodes
an assembly, and a SQL/PGQ property graph over the same rows answers where-used
with `GRAPH_TABLE`.

It is the right shape for a different workload. Here, every explosion pays the
walk: an index probe and a part lookup per component, level by level, two million
times a day. The edge model's cheap write saves 200 rewrites a day; the path's
cheap read saves on every one of the 2 million reads. And `GRAPH_TABLE` lost every
read test, explosions and where-used alike: graph matching earns its cost on
genuinely graph-shaped questions (many hops, many parents, asked ad hoc), not on a
fixed hierarchy read the same way millions of times.

| | Path: one document per part, multivalue index | Edges + `CONNECT BY` | Graph: `GRAPH_TABLE` |
|---|---|---|---|
| Explode a 1,092-part assembly (measured) | **765 µs**, one range scan | 1,116 µs | 1,945 µs |
| Where-used | one document read | upward walk, ~30 µs | upward match, ~210 µs |
| Change a shared part | one row | one row | one row |
| ECO re-parent | one row per moved part, one transaction | **one edge row** | one edge row |

## What the converged engine adds

Nothing that changes the shape: the path wins, so keep it. What it adds is around
the shape:

1. **Multivalue indexing** of the paths array, so a shared part stays one document
   with one row to change, and a prefix on any of its paths is a range scan.
2. **An atomic move.** The subtree rewrite is one `UPDATE` (or one `updateMany`
   through the MongoDB API) in one transaction: the next explosion sees the subtree
   wholly before or wholly after the ECO.
3. **The edge view when you need it.** The same engine runs `CONNECT BY` and
   `GRAPH_TABLE`, so the occasional genuinely graph-shaped analysis does not need a
   second database.

## When to store the edge instead

When moves are huge and frequent relative to what you read: a tree that engineering
reshapes in subtrees of 100,000 parts every day, or a workload whose explosions are
small while its moves are large. Or when the questions are genuinely graph-shaped:
many hops, many parents, asked ad hoc. Then the edge row's one-row move and the
graph's flexibility pay for the walk. Re-run the model with your own numbers: the
measured costs above are the inputs.

## In this folder

| File | What it shows |
|---|---|
| `01-document-model.sql` | One document per part with every path it sits on; a multivalue index; explode with one prefix scan; where-used from one document; a re-parent rewrites every descendant once |
| `02-converged.sql` | The measured alternative: adjacency edges (re-parent = one row) + `CONNECT BY` explosion + `GRAPH_TABLE` where-used |
| `calibrate.sql` | Resizes the moved subtree for Measure it's reference curve |

## Validated

Both scripts run clean on **Oracle AI Database 26ai Free (`23.26.3-faststart`)**, and
the document lane's MongoDB API commands (find with a path prefix, find by `_id`, and
the `updateMany` re-parent) return the same results as its SQL. This pattern has no
cross-API parity script: the edge lane is SQL only.
Run them with `../../run.sh 05-tree-hierarchy`.
