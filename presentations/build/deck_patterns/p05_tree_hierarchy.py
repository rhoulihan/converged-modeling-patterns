"""Pattern 5: Tree / Hierarchy · manufacturing bill of materials.

Scenario (illustrative): industrial equipment maker, 1.2M parts, assemblies up to 12 levels
deep, ~2M explosions a day, ~200 engineering change orders (ECOs) a day re-parenting
subassemblies of 10 to 40,000 parts.

Cost model on slide C: inputs MEASURED on 26ai Free (88,573-part synthetic BOM, 11 levels,
the lab's Measure-it protocol); the scenario rates are illustrative. Database seconds a day:
  R  = 2e6 explosions/day, each of an average 1,092-part assembly (the measured point)
  E  = 200 ECO re-parents/day,  s = parts in the moved subtree (x axis, log)
  path(s)  = R * 765 us  + E * s * 40 us   (multivalue-index prefix scan; every descendant
                                            rewritten once, ~40 us and ~1.7-2.5 KB redo each)
  edges(s) = R * 1116 us + E * 0.2 ms      (CONNECT BY with parts joined in; one edge row)
  graph(s) = R * 1945 us + E * 0.2 ms      (GRAPH_TABLE {1,10})
  break-even: 702 s = E * s * 40 us  ->  s ~= 88,000 parts per move
Sensitivity (README, notes): at ~120-part explosions (101 vs 135 us) break-even drops to ~8,500.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 5: Tree / Hierarchy"
R = 2e6
ECOS = 200
PATH_READ = 765e-6      # s per explosion, prefix scan on the multivalue index (measured)
EDGE_READ = 1116e-6     # CONNECT BY with parts joined in (measured)
GRAPH_READ = 1945e-6    # GRAPH_TABLE (measured)
REWRITE = 40e-6         # s per moved part, path rewrite (measured)
EDGE_WRITE = 0.2e-3     # one edge row (measured, upper bound)
MONO = "IBM Plex Mono, monospace"


def path_model(s):
    return R * PATH_READ + ECOS * s * REWRITE


def edge_model(s):
    return R * EDGE_READ + ECOS * EDGE_WRITE


def graph_model(s):
    return R * GRAPH_READ + ECOS * EDGE_WRITE


BREAK_EVEN = (R * (EDGE_READ - PATH_READ) + ECOS * EDGE_WRITE) / (ECOS * REWRITE)


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 320, "One part document as built: every materialized path the part sits on, in one array covered by a multivalue index")
    lines = [
        "{",
        '  "_id": "P-88213",',
        '  "name": "pump seal kit",',
        '  "rev": "C",',
        '  "unitCost": 14.20,',
        '  "paths": [',
        '    "root.A-1.SA-7.HP-3",',
        '    "root.A-4.VB-12"',
        "  ],",
        '  "supplier": "S-417"',
        "}",
    ]
    doc_panel(f, 18, 18, 316, lines, title="parts · one document per part",
              hot={5, 6, 7, 8}, size=11.5, lh=19,
              callouts=[(5, ["path = position: an ECO", "above it rewrites this", "and every descendant"], "hot"),
                        (8, ["shared part: one path per", "use, one document, one", "multivalue index entry each"], "hot")],
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
             'The dominant read is the explosion: MRP, product configuration and the service portal all want everything under an assembly, about two million times a day. So the team stored a materialized path per part: one prefix range scan per explosion. Fast, and the right instinct.<br><br>'
             "A seal kit goes into many pumps: it's a DAG, not a tree. So the document carries one path per use, in an array, and a multivalue index covers every element. Where-used is then just the part's own document, and a cost change is one row.<br><br>"
             'The red row is the bill: about 200 change orders a day, many re-parenting a subassembly, SA-7 from A-1 to A-2. Path is position, so every part under SA-7 changes too. Ten parts on a good day, 40,000 when a platform module moves.<br><br>'
             '<em>Land: ten thousand explosions for every move. The question is which bill is bigger, and we will measure it rather than guess.</em>')
    return slide(label="Tree / Hierarchy: the problem", pattern=P, beat="A", clock="0:55 – 0:57",
                 title="Manufacturing BOM: ten thousand explosions for every move",
                 lede="An equipment maker stores 1.2M parts with <strong>materialized paths</strong>, so exploding any assembly is one prefix scan, and a shared part carries one path per use. About 200 change orders a day re-parent subassemblies, and <strong>every move rewrites the subtree beneath it</strong>.",
                 body=body,
                 takeaway="The path makes every explosion one index scan and every re-parent a subtree-sized rewrite. <strong>With 2 million explosions against 200 moves a day, which bill is bigger?</strong>",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 436, "Canonical ERD of part, BOM edge and change order beside the two costs of storing materialized paths: one prefix scan per explosion, one rewrite per moved part")
    f.text(24, 30, "CANONICAL FORM: PARTS AND EDGES", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(652, 30, "STORED FOR THE READ: PATHS", size=11, weight=600, fill="var(--faint)", font=MONO)
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
    # the two costs of the stored path
    f.box(660, 46, 264, 54, ["2M explosions a day", "1 prefix range scan each"], tone="cool")
    f.box(660, 128, 264, 54, ["ECO-4471 · re-parent SA-7", "A-1 → A-2"], tone="hot")
    f.path("M792,182 V200 H722 V214", [(722, 182), (792, 214)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.path("M792,200 H862 V214", [(792, 200), (862, 214)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 216, 124, 62, ["1", "SA-7 itself"], tone="hot", size=16)
    f.box(800, 216, 124, 62, ["10 – 40k", "descendants"], tone="hot", size=16)
    f.line(722, 278, 722, 300, stroke="var(--hot)", sw=1.7, arrow=True)
    f.line(862, 278, 862, 300, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 302, 264, 58, ["one rewrite per moved part", "one statement · one transaction"], tone="hot")
    # legend
    f.rect(24, 402, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 414, "what an ECO changes: one edge row, or every path below it", size=11.5, fill="var(--muted)")
    f.rect(500, 402, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(522, 414, "what the path buys: the cheapest read, every time", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("<strong>Draw the BOM the way the domain actually is, and notice the path isn't in it anywhere.</strong><br><br>"
             "Left is the canonical form: parts, and edges carrying parent, child, quantity. BOM_EDGE points to PART twice (parent, child); the second makes it a DAG (directed acyclic graph). One seal kit, many pumps. The green rows are history: immutable, copy them freely.<br><br>"
             "Position isn't in the canonical form. A path is position, derived from the edges and stored in every part. Storing it is a projection made for one read, and it has two prices on the right.<br><br>"
             "Top, what it buys: every explosion is one prefix range scan, two million times a day. Bottom, what it costs: SA-7 moves from A-1 to A-2 and every part beneath it is rewritten, 10 or 40,000 of them. On this engine that is one statement in one transaction, so no explosion sees half a move.<br><br>"
             "Store the edge instead and the move is one row, but every explosion has to walk the edges to find what the path already says.<br><br>"
             '<em>Land: a path is a derived fact stored N times. Whether that is worth it is a question of rates: reads that use it against moves that rewrite it.</em>')
    return slide(label="Tree / Hierarchy: the model", pattern=P, beat="B", clock="0:57 – 0:58",
                 title="The edge is the fact; the path is what the reads want",
                 lede="In canonical form each parent → child link is one relationship, and position is derived by walking the edges. A materialized path <strong>stores that position in every part</strong>: every explosion becomes one range scan, and every move rewrites the subtree beneath it.",
                 body=body,
                 takeaway="<strong>A path is a derived fact stored N times.</strong> Store it when the reads that use it outnumber the moves that rewrite it: here, ten thousand to one.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the BOM and a measured daily cost of materialized paths, adjacency edges and a property graph as the moved subtree grows")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.8, tone="cool", setting="High: 4 questions",
             lines=["explode, roll up, where-used,", "recall impact"]),
        dict(name="2 · Read / write", value=0.92, tone="cool", setting="Read-heavy: decides it",
             lines=["~2M explosions/day against", "~200 ECOs/day"]),
        dict(name="3 · Update locality", value=0.85, tone="hot", setting="Lands on every descendant",
             lines=["one re-parent rewrites", "10 to 40,000 part paths"]),
    ])
    f.text(400, 28, "DATABASE SECONDS PER DAY vs PARTS PER MOVE · measured costs", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    chart(f, (400, 58, 520, 236), (1e3, 3e5), (1000, 4400),
          curves=[dict(name="Materialized path", fn=path_model, tone="hot"),
                  dict(name="Edges · CONNECT BY", fn=edge_model, tone="cool"),
                  dict(name="Graph · GRAPH_TABLE", fn=graph_model, tone="muted", dash="5 4")],
          xlabel="parts in the moved subtree (log)", ylabel="database seconds per day",
          logx=True, yticks=[1000, 2000, 3000, 4000],
          regions=[(1e3, BREAK_EVEN, "hot", "path is cheaper"), (BREAK_EVEN, 3e5, "cool", "edges")],
          points=[(1e4, "Materialized path", "module · 10k", 0, 17, "middle"),
                  (4e4, "Materialized path", "platform · 40k", 0, 17, "middle")],
          cross=("Materialized path", "Edges · CONNECT BY"),
          cross_label=dict(lines=["break-even ≈ 88,000 parts"], dx=-12, dy=-13, anchor="end"),
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Costs measured on 26ai Free (88,573-part BOM, 11 levels; the lab's protocol), rates illustrative: 2×10⁶ explosions/day of a 1,092-part assembly at 765 µs (path, multivalue-index prefix scan), 1,116 µs (CONNECT BY, parts joined in) or 1,945 µs (GRAPH_TABLE); 200 ECOs/day at 40 µs per moved part (path) or one edge row.</figcaption>
      </figure>"""
    notes = ("<strong>Same three knobs, and this time we measured instead of modelling.</strong><br><br>"
             "Two dials favour the path: diversity is high, and the path answers all four questions; read/write leans hard to reads. Knob three is red: a re-parent lands on every descendant. That is the path's bill.<br><br>"
             "The measurements, on 26ai with an 88,000-part BOM. Exploding a thousand-part assembly: 765 microseconds with the path's prefix scan, 1,116 walking edges with CONNECT BY, 1,945 with a graph match. Rewriting a moved part: about 40 microseconds and two kilobytes of redo. An edge move: one row.<br><br>"
             "Multiply by the day. The walk costs about 350 microseconds more on each of two million explosions: around 700 database seconds. The path's rewrites cost 40 microseconds a part on 200 moves. Break-even is about 88,000 parts per move, more than twice the biggest move engineering makes. At 10,000 parts the edge model's day is about 1.4 times the path's; the graph's about 2.4.<br><br>"
             "Be straight about the caveats. If most explosions are small, around a hundred parts, break-even drops to about 8,500. And the path's moves write redo, gigabytes a day at these sizes: log and standby I/O the edge never pays.<br><br>"
             '<em>Land: read-heavy decides it. Pay on the move, not on every read.</em>')
    return slide(label="Tree / Hierarchy: where the knobs flip it", pattern=P, beat="C", clock="0:58 – 0:59",
                 title="Measured: the walk costs more than the rewrites",
                 lede="Two knobs favour the path: <strong>four read questions</strong> and a <strong>read-heavy</strong> day. The third (every re-parent lands on the whole subtree) is its bill. Measured on 26ai, walking edges costs <strong>~1.5× the path's prefix scan</strong> on every explosion, so break-even sits near <strong>88,000 parts per move</strong>.",
                 body=body,
                 takeaway="Across the moves engineering actually makes the path's day is cheaper: <strong>~1.4× at 10k, ~1.2× at 40k</strong> against edges, ~2.4× against a graph match. The edge only wins past ~88,000 parts per move.",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 318, "Part documents with every path in a multivalue index feed a prefix-scan explosion and a one-document where-used; an ECO rewrites the moved subtree in one transaction")
    f.text(92, 30, "ONE DOC PER PART", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(295, 30, "TWO READS, NO WALK", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(481, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("doc", 18, 56, 148, 96, ["parts", "paths[] per part", "multivalue index"], tone="cool")
    fl.node("eco", 18, 212, 148, 64, ["ECO · UPDATE", "moved subtree", "one transaction"], tone="hot")
    fl.node("scan", 220, 44, 150, 96, ["prefix scan", "explode · roll up", "one range scan"], tone="cool")
    fl.node("one", 220, 192, 150, 96, ["one doc read", "where-used", "paths = ancestors"], tone="cool")
    fl.node("mrp", 420, 44, 122, 56, ["Planning", "explode"], tone="flow")
    fl.node("cost", 420, 118, 122, 56, ["Cost rollup", "nightly"], tone="flow")
    fl.node("rec", 420, 208, 122, 64, ["Recall desk", "where-used", "one read"], tone="flow")
    fl.edge("doc", "scan", 193, tone="muted", ay=76, by=76)
    fl.edge("doc", "one", 193, tone="muted", ay=128, by=222)
    fl.edge("scan", "mrp", 396, tone="flow", ay=72, by=72)
    fl.edge("scan", "cost", 396, tone="flow", ay=112, by=146)
    fl.edge("one", "rec", 396, tone="flow", ay=240, by=240)
    f.line(92, 210, 92, 154, stroke="var(--hot)", sw=1.7, arrow=True)
    return f.svg()


def slide_d():
    sql = ('<span class="c">-- every path a part sits on, one index entry each</span>\n'
           '<span class="k">CREATE MULTIVALUE INDEX</span> bom_paths <span class="k">ON</span> parts p (p.data.paths.string());\n\n'
           '<span class="c">-- explode: everything under an assembly, one range scan</span>\n'
           '<span class="k">SELECT</span> data <span class="k">FROM</span> parts\n'
           '<span class="k">WHERE</span>  <span class="k">JSON_EXISTS</span>(data, <span class="s">\'$.paths?(@ starts with $p)\'</span> <span class="k">PASSING</span> :asm <span class="k">AS</span> "p");\n\n'
           '<span class="c">-- where-used: the part\'s own document names every ancestor</span>\n'
           'db.parts.find({ _id: <span class="s">"P-88213"</span> }, { paths: 1 })\n\n'
           '<span class="c">-- ECO-4471: one statement, one transaction, every moved part once</span>\n'
           '<span class="k">UPDATE</span> parts <span class="k">SET</span> data = <span class="k">JSON_TRANSFORM</span>(data, <span class="k">SET</span> <span class="s">\'$.paths\'</span> = ...)\n'
           '<span class="k">WHERE</span>  <span class="k">JSON_EXISTS</span>(data, <span class="s">\'$.paths?(@ starts with "root.A-1.SA-7")\'</span>);')
    ba = table(["", "Path · multivalue index", "Edges · CONNECT BY", "Graph · GRAPH_TABLE"], [
        ["Explode 1,092 parts", '<span class="cool">765 µs</span>', "1,116 µs", '<span class="hot">1,945 µs</span>'],
        ["Where-used", '<span class="cool">1 document</span>', "upward walk", "upward match"],
        ["ECO re-parent", '<span class="hot">1 row per moved part</span>', '<span class="cool">1 edge row</span>', '<span class="cool">1 edge row</span>'],
        ["Day at 10k-part moves", '<span class="cool">1×</span>', "~1.4×", '<span class="hot">~2.4×</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When to store the edge:</b> moves far larger than what you read (past ~88,000 parts a move here, ~8,500 if explosions are small), or genuinely graph-shaped questions: many hops, many parents, asked ad hoc. Then the one-row move pays for the walk.</div>
        </div>
        <div class="stack">
          {code(sql, "Keep the path: one row per part, every path indexed, one transaction per move")}
          {ba}
        </div>
      </div>"""
    notes = ("<strong>The converged answer here is to keep the document pattern, and to run it properly.</strong><br><br>"
             "One document per part, with every path it sits on in an array. A multivalue index puts each path in one index, so exploding an assembly is one range scan, and a shared seal kit is still one row to change.<br><br>"
             "Where-used needs no walk: the part's own document names every ancestor. The recall desk reads one document.<br><br>"
             "The bill is the ECO: every part beneath the moved node rewritten once. On this engine that is one UPDATE (or one updateMany over the MongoDB API) in one transaction. No explosion sees half a move.<br><br>"
             "The table is the comparison we measured. Edges and CONNECT BY make the move one row and pay 1.5 times on every explosion. The graph match is the most flexible and the slowest for this job: graph earns its cost on graph-shaped questions, not on a fixed hierarchy read two million times a day. Both still run on this engine, over the same data, for the day you need them.<br><br>"
             "The companion lab runs both lanes: the path's prefix scan and one-document where-used, and the edge lane's one-row move; Measure it shows what the path's re-parent costs.<br><br>"
             '<em>Land: the lab explores the tradeoffs, and here the document pattern wins. Keep the path; pay on the move.</em>')
    return slide(label="Tree / Hierarchy: the converged answer", pattern=P, beat="D", clock="0:59 – 1:00",
                 title="Keep the path: index every path, move in one transaction",
                 lede="One document per part with <strong>every path it sits on</strong>, under a <strong>multivalue index</strong>: an explosion is one range scan, where-used is one document, and an ECO rewrites the moved subtree in <strong>one transaction</strong>. Edges and a graph were measured too, and lose on the read.",
                 body=body,
                 takeaway="Here the document pattern wins: <strong>the edge's one-row move saves 200 rewrites a day, and the path's range scan saves on every one of 2 million reads.</strong> Store the edge when the moves outgrow the reads.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
