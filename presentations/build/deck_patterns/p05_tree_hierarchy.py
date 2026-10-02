"""Pattern 5: Tree / Hierarchy · manufacturing bill of materials.

Scenario (illustrative): industrial equipment maker, 1.2M parts, assemblies up to 12 levels
deep, ~200 engineering change orders (ECOs) a day re-parent subassemblies of 10 to 40,000 parts.

Cost model on slide C (illustrative, stated in notes + figcaption):
  R  = 2e6 BOM explosion / rollup reads per day   (1 work unit each via a path-prefix range scan)
  E  = 200 ECO re-parents per day,  W = 3 work units per document / row rewrite
  s  = parts in the moved subtree (x axis, log, 10 -> 40,000)
  path(s)  = R * 1.00 + E * s * W       (every descendant's path is rewritten)
  edges(s) = R * 1.30 + E * 1 * W       (recursive CONNECT BY costs ~30% more per explosion;
                                         a re-parent is one edge row)
  break-even: 0.30 R = E * W * (s - 1)  ->  s = 600,000 / 600 + 1 ~= 1,000 parts per moved subtree
Where-used is NOT in the model (the path can't express it; counting a second structure's upkeep
would only move break-even further left) — so the model is conservative toward the path.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 5: Tree / Hierarchy"
R = 2e6
ECOS = 200
REWRITE = 3.0
READ_PREMIUM = 1.30
MONO = "IBM Plex Mono, monospace"


def path_model(s):
    return R + ECOS * s * REWRITE


def edge_model(s):
    return R * READ_PREMIUM + ECOS * REWRITE


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 320, "One part document as built: a materialized path encodes its position, and a usedIn array was added for where-used")
    lines = [
        "{",
        '  "_id": "P-88213",',
        '  "name": "pump seal kit",',
        '  "rev": "C",',
        '  "unitCost": 14.20,',
        '  "path": "root.A-1.SA-7.HP-3",',
        '  "depth": 4,',
        '  "usedIn": [',
        '    "HP-3", "HP-9", "VB-12"',
        "  ],",
        '  "rollupCost": 14.20,',
        '  "supplier": "S-417"',
        "}",
    ]
    doc_panel(f, 18, 18, 316, lines, title="parts · one document per part",
              hot={5, 6, 7, 8, 9}, size=11.5, lh=19,
              callouts=[(5, ["path = position", "an ECO above it rewrites", "this and every descendant"], "hot"),
                        (8, ["second structure for", "where-used: parent list,", "kept in sync by app code"], "hot")],
              callout_x=364)
    return f.svg()


def slide_a():
    rows = [
        ["Explode an assembly", "MRP · service", "~2M/day", '<span class="pill">read</span>'],
        ["Cost rollup up the tree", "costing", "nightly", '<span class="pill">read</span>'],
        ["Where-used: which products contain X?", "sourcing", "~5k/day", '<span class="pill">read · reverse</span>'],
        ["Recall impact analysis", "quality", "bursts", '<span class="pill">read · reverse</span>'],
        ["ECO: re-parent a subassembly", "engineering", "~200/day", '<span class="pill hot">write · fan-out</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("1.2M", "parts"), ("12", "levels deep"), ("~200", "ECOs / day"), ("10–40k", "parts per move")])}
          {table(["Access pattern", "Who", "Rate", "Type"], rows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ('<strong>Every manufacturer in the room owns this problem: a bill of materials is the most honest hierarchy in enterprise data.</strong><br><br>'
             'An industrial equipment maker: 1.2 million parts, products up to 12 levels deep, machine to seal kit. Illustrative numbers, universal shape.<br><br>'
             'The dominant read is the explosion: MRP, product configuration and the service portal all want everything under an assembly. So the team stored a materialized path per part: one prefix range scan per explosion. Fast, and the right instinct.<br><br>'
             'The red rows: about 200 change orders a day, many re-parenting a subassembly, SA-7 from A-1 to A-2. Path is position, so every part under SA-7 changes too. Ten parts on a good day, 40,000 when a platform module moves.<br><br>'
             "Mid-recall, quality asks the reverse: which products contain this seal kit? Many do: it's a DAG, not a tree. The team bolted on a usedIn array: two structures, synced by hand.<br><br>"
             '<em>Land: the path answers one question in one direction, beautifully. Engineering changes and recalls live in the other two.</em>')
    return slide(label="Tree / Hierarchy: the problem", pattern=P, beat="A", clock="0:55 – 0:57",
                 title="Manufacturing BOM: the path is fast until engineering moves it",
                 lede="An equipment maker stores 1.2M parts with a <strong>materialized path</strong>, so exploding any assembly is one prefix scan. Then ~200 change orders a day re-parent subassemblies, and quality asks the <strong>reverse</strong> question: which products contain part X?",
                 body=body,
                 takeaway="The path makes the downward read one index scan. <strong>It makes every re-parent a subtree-sized rewrite</strong>, and it can't answer where-used without a second, hand-synced structure.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 436, "Canonical ERD of part, BOM edge and change order beside the fan-out of one re-parent across materialized paths")
    f.text(24, 30, "CANONICAL FORM: EDGES, NOT BAKED PATHS", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(652, 30, "THE SAME MOVE, AS PATHS", size=11, weight=600, fill="var(--faint)", font=MONO)
    ents = [
        dict(id="part", x=24, y=46, w=250, title="PART", cols=[
            ("part_id", "varchar2", "PK"), ("name", "varchar2", ""), ("rev", "varchar2", ""),
            ("unit_cost", "number", ""), ("supplier_id", "varchar2", "FK")]),
        dict(id="edge", x=340, y=150, w=250, title="BOM_EDGE", tone="hot", cols=[
            ("edge_id", "number", "PK"), ("parent_id", "varchar2", "hot"), ("child_id", "varchar2", "FK"),
            ("qty", "number", "")]),
        dict(id="eco", x=24, y=262, w=250, title="ECO", cols=[
            ("eco_id", "varchar2", "PK"), ("edge_id", "number", "FK"), ("from_parent", "varchar2", "snap"),
            ("released_at", "timestamp", "snap")]),
    ]
    rels = [
        dict(a="part", a_side="r", a_row="part_id", a_card="one", b="edge", b_side="l", b_row="parent_id",
             b_card="many", via=306),
        dict(a="edge", a_side="l", a_row="child_id", a_card="many", b="part", b_side="b", b_card="one"),
        dict(a="eco", a_side="r", a_row="edge_id", a_card="many", b="edge", b_side="b", b_card="one"),
    ]
    erd(f, ents, rels)
    f.text(360, 136, "parent → child · a part can have many parents (DAG)", size=11, fill="var(--muted)")
    # fan-out of one re-parent under materialized paths
    f.box(660, 46, 264, 54, ["ECO-4471 · re-parent SA-7", "A-1 → A-2"], tone="hot")
    f.path("M792,100 V128 H722 V156", [(722, 100), (792, 156)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.path("M792,128 H862 V156", [(792, 128), (862, 156)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 158, 124, 62, ["1", "SA-7 itself"], tone="hot", size=16)
    f.box(800, 158, 124, 62, ["10 – 40k", "descendants"], tone="hot", size=16)
    f.line(722, 220, 722, 248, stroke="var(--hot)", sw=1.7, arrow=True)
    f.line(862, 220, 862, 248, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 250, 264, 58, ["≈ subtree-size rewrites", "per ECO · not one transaction"], tone="hot")
    f.box(660, 326, 264, 55, ["Adjacency edge: 1 row update", "the subtree follows · atomic"], tone="cool")
    # legend
    f.rect(24, 402, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 414, "the column an ECO writes: structure, not position", size=11.5, fill="var(--muted)")
    f.rect(470, 402, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(492, 414, "immutable change history: safe to copy", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("<strong>Draw the BOM the way the domain actually is, and notice the path isn't in it anywhere.</strong><br><br>"
             "Left is the canonical form: parts, and edges carrying parent, child, quantity. That's all of it. BOM_EDGE points to PART twice (parent, child); the second makes it a DAG (directed acyclic graph). One seal kit, many pumps.<br><br>"
             "The red row is all an ECO writes: parent_id on one edge. Position is derived by walking edges, never stored. The green rows are history (moved-from parent, release time). Immutable, so copy it freely. That's audit, not denormalisation.<br><br>"
             "Right, the same move as paths: SA-7 from A-1 to A-2 rewrites SA-7 and every descendant (10 parts or 40,000), and across that many documents it isn't one atomic change.<br><br>"
             '<em>Land: the path stores a derived fact, position, in every node. Derived facts you store are facts you have to rewrite.</em>')
    return slide(label="Tree / Hierarchy: the model", pattern=P, beat="B", clock="0:57 – 0:58",
                 title="Store the edge, derive the position",
                 lede="In canonical form each parent → child link is one relationship, stored as <strong>one row</strong> in the relational projection; position is computed by walking edges. The materialized path stores position <strong>in every part</strong>, so moving one subassembly rewrites the whole subtree beneath it.",
                 body=body,
                 takeaway="<strong>A path is a derived fact stored N times.</strong> The edge is the fact stored once: an ECO changes one row and the subtree follows.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the BOM and a cost model of materialized paths versus adjacency edges as the moved subtree grows")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.8, tone="cool", setting="High: 4 questions",
             lines=["explode, roll up, where-used,", "recall impact"]),
        dict(name="2 · Read / write", value=0.88, tone="cool", setting="Read-heavy",
             lines=["~2M explosions/day against", "~200 ECOs/day"]),
        dict(name="3 · Update locality", value=0.85, tone="hot", setting="Lands on every descendant",
             lines=["one re-parent rewrites", "10 to 40,000 part paths"]),
    ])
    f.text(400, 28, "DAILY WORK vs PARTS PER MOVED SUBTREE · illustrative model", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    chart(f, (400, 58, 520, 236), (10, 4e4), (1.5e6, 4e7),
          curves=[dict(name="Materialized path", fn=path_model, tone="hot"),
                  dict(name="Adjacency edges · CONNECT BY, +30% read", fn=edge_model, tone="cool")],
          xlabel="parts in the moved subtree (log)", ylabel="work units per day (log)",
          logx=True, logy=True, yticks=[2e6, 5e6, 1e7, 2e7],
          regions=[(10, 1000, "hot", "path is cheaper"), (1000, 4e4, "cool", "edges are cheaper")],
          points=[(50, "Materialized path", "routine ECO · 50", 0, 17, "middle"),
                  (10000, "Materialized path", "module move · 10k", -10, -2, "end")],
          cross=("Materialized path", "Adjacency edges · CONNECT BY, +30% read"),
          cross_label=dict(lines=["break-even ≈ 1,000 parts"], dx=-12, dy=-13, anchor="end"),
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Illustrative cost model, not a benchmark: 2×10⁶ explosion reads/day at 1 unit via a path-prefix scan; recursive CONNECT BY adds ~30% per explosion; 200 ECOs/day; each document or row rewrite costs 3 units. Where-used is left out, which favours the path.</figcaption>
      </figure>"""
    notes = ("<strong>Same three knobs, and again the honest answer is 'it depends on the size of the move', so put a number on it.</strong><br><br>"
             "Two dials favour the path: diversity is high (explode, roll up, where-used, recall) and read/write leans hard to reads. Knob three is red: a re-parent lands on every descendant. That's the multiplier.<br><br>"
             'Say the model out loud. The path explodes with one prefix range scan. Edges use a recursive CONNECT BY, one pass but level by level, so I charge it 30% more on each of 2 million reads. Traversal is not free. On writes, the path rewrites the whole moved subtree; edges update one row.<br><br>'
             "Say plainly where the path wins: small moves or a static, read-only tree. Break-even is about 1,000 parts per move. A 10,000-part module move makes the path's day about 3 times the edges'. At 40,000, 10 times.<br><br>"
             'And I left where-used out entirely: a scan or second structure to maintain for the path, an indexed traversal for the graph. Counting it only moves break-even left.<br><br>'
             '<em>Land: static catalogue trees, keep the path. BOMs that engineering reshapes every day, store the edge.</em>')
    return slide(label="Tree / Hierarchy: where the knobs flip it", pattern=P, beat="C", clock="0:58 – 0:59",
                 title="The needle flips on the size of the move",
                 lede="Two knobs favour the path: <strong>four read questions</strong> and a <strong>read-heavy</strong> day. The third (every re-parent lands on the whole subtree) decides it. Charge the recursive read its real premium and break-even sits near <strong>1,000 parts per move</strong>.",
                 body=body,
                 takeaway="For small moves and static trees the path is cheaper: the recursive read costs more. <strong>Once engineering moves modules of thousands of parts, the edge wins: ~3× at 10k, ~10× at 40k.</strong>",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 318, "BOM edges and parts feed a CONNECT BY explosion and a SQL/PGQ property graph over the same rows, serving planning, cost rollup and the recall desk")
    f.text(92, 30, "RELATIONAL PROJECTION", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(295, 30, "SAME ROWS, TWO READS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(481, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("edge", 18, 56, 148, 64, ["bom_edges", "parent → child", "ECO writes here"], tone="hot")
    fl.node("part", 18, 212, 148, 56, ["parts", "1.2M rows"])
    fl.node("cb", 220, 44, 150, 96, ["CONNECT BY", "explode · roll up", "one recursive pass"], tone="cool")
    fl.node("g", 220, 192, 150, 96, ["bom_graph", "SQL/PGQ graph", "where-used, N hops"], tone="cool")
    fl.node("mrp", 420, 44, 122, 56, ["Planning", "SQL · explode"], tone="flow")
    fl.node("cost", 420, 118, 122, 56, ["Cost rollup", "SQL · nightly"], tone="flow")
    fl.node("rec", 420, 208, 122, 64, ["Recall desk", "where-used", "SQL/PGQ"], tone="flow")
    fl.edge("edge", "cb", 193, tone="muted", ay=76, by=76)
    fl.edge("edge", "g", 193, tone="muted", ay=100, by=222)
    fl.edge("part", "g", 193, tone="muted", ay=250, by=250)
    fl.edge("cb", "mrp", 396, tone="flow", ay=72, by=72)
    fl.edge("cb", "cost", 396, tone="flow", ay=112, by=146)
    fl.edge("g", "rec", 396, tone="flow", ay=240, by=240)
    return f.svg()


def slide_d():
    sql = ('<span class="c">-- explode: everything under an assembly, one pass</span>\n'
           '<span class="k">SELECT</span> child_id, qty, <span class="k">LEVEL</span> <span class="k">FROM</span> bom_edges\n'
           '<span class="k">START WITH</span> parent_id = :asm <span class="k">CONNECT BY PRIOR</span> child_id = parent_id;\n\n'
           '<span class="c">-- where-used: the reverse question, same rows (bom_graph)</span>\n'
           '<span class="k">SELECT</span> assembly <span class="k">FROM GRAPH_TABLE</span> ( bom_graph\n'
           '  <span class="k">MATCH</span> (a <span class="k">IS</span> part)-[<span class="k">IS</span> contains]-&gt;{1,4}(p <span class="k">IS</span> part)\n'
           '  <span class="k">WHERE</span> p.part_id = :part <span class="k">COLUMNS</span> (a.part_id <span class="k">AS</span> assembly) );\n\n'
           '<span class="c">-- ECO-4471: re-parent SA-7 = ONE row, subtree follows</span>\n'
           '<span class="k">UPDATE</span> bom_edges <span class="k">SET</span> parent_id = <span class="s">\'A-2\'</span>\n'
           '<span class="k">WHERE</span>  parent_id = <span class="s">\'A-1\'</span> <span class="k">AND</span> child_id = <span class="s">\'SA-7\'</span>;')
    ba = table(["", "Materialized path", "Edges + graph"], [
        ["ECO re-parent", '<span class="hot">1 doc per part in subtree</span>', '<span class="cool">1 edge row</span>'],
        ["Explode an assembly", "1 prefix range scan", "CONNECT BY pass (~+30%)"],
        ["Where-used", '<span class="hot">2nd structure, app-synced</span>', '<span class="cool">GRAPH_TABLE, same rows</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When to flip back:</b> a tree that rarely moves and is read one way (a product catalogue, an org chart snapshot), keep the materialized path. Its prefix scan is the cheapest explosion there is.</div>
        </div>
        <div class="stack">
          {code(sql, "Store the edge: recurse down, match up, move with one row")}
          {ba}
        </div>
      </div>"""
    notes = ('<strong>The converged answer splits the two questions the path tried to answer with one string.</strong><br><br>'
             'Structure lives in bom_edges. The ECO writes one row (the red box); the subtree follows, because position was never stored.<br><br>'
             'Downward, native recursion: CONNECT BY streams the explosion in one pass for planning and the nightly cost rollup. Not a recursive CTE, and still dearer than a prefix scan: the 30% from the last slide.<br><br>'
             'Upward, a graph match: a SQL/PGQ property graph over the same two tables, GRAPH_TABLE walking up from the seal kit to every assembly holding it, shared ones too. No graph database to sync, no usedIn array.<br><br>'
             "The companion lab proves both: where-used returns the shared assembly the path couldn't express, and the single-row UPDATE shows in the next explosion.<br><br>"
             "Flip back for a static tree read one way: there the path's prefix scan is the cheapest read there is.<br><br>"
             '<em>Land: store the edge, derive the position. One row per move, and the recall question finally has an answer.</em>')
    return slide(label="Tree / Hierarchy: the converged answer", pattern=P, beat="D", clock="0:59 – 1:00",
                 title="Store the edge: recurse down, match up, move one row",
                 lede="Keep the BOM as <strong>parent → child edges</strong>: <code>CONNECT BY</code> explodes it, a <strong>SQL/PGQ graph</strong> over the same rows answers where-used, and an ECO re-parent is <strong>one row</strong>.",
                 body=body,
                 takeaway="The re-parent went from <strong>one rewrite per descendant to one edge row</strong>, and where-used went from a hand-synced second structure to a graph match, paid for with a real recursive-read premium.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
