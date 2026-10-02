"""Act 1 figures for converged-modeling-patterns/presentations/converged-data-modeling-workshop1.html (hand-authored slides 2-7).

Each figure is built with deckfig.py (frame / collision / line-through-text checks) and
spliced into the deck between ``<!-- ACT1FIG:name -->`` and ``<!-- /ACT1FIG:name -->`` markers.
build_converged_deck.py never touches these slides, so the two scripts are independent.

  python3 presentations/build/build_act1_figs.py
"""
from __future__ import annotations

import re
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # presentations/build
sys.path.insert(0, str(ROOT))
from deckfig import HEAD, MONO, SANS, TONE, Fig, Flow, tw  # noqa: E402

# The deck's single master copy lives in the companion lab repo (converged-modeling-patterns),
# next to its images and bundled fonts. Override with CMP_DECK=/path/to/deck.html.
DECK = Path(os.environ.get("CMP_DECK", ROOT.parent / "converged-data-modeling-workshop1.html"))
TONE.update({"vec": ("var(--vec)", "var(--vec-soft)"), "graph": ("var(--graph)", "var(--graph-soft)")})


# ----------------------------------------------------------------------------- slide 2
def _cyl(f: Fig, cx, top, w, h, col, soft):
    """Database cylinder icon: top ellipse + body, tracked as one box."""
    rx, ry = w / 2, 6
    f.track(cx - rx - 1, top - ry - 1, cx + rx + 1, top + h + ry + 1, "cyl")
    f.raw(f'<path d="M{cx - rx:.1f},{top:.1f} V{top + h:.1f} A{rx},{ry} 0 0 0 {cx + rx:.1f},{top + h:.1f} '
          f'V{top:.1f}" fill="{soft}" stroke="{col}" stroke-width="2"/>')
    f.raw(f'<path d="M{cx - rx:.1f},{top + h / 2:.1f} A{rx},{ry} 0 0 0 {cx + rx:.1f},{top + h / 2:.1f}" '
          f'fill="none" stroke="{col}" stroke-width="1.4"/>')
    f.raw(f'<ellipse cx="{cx:.1f}" cy="{top:.1f}" rx="{rx}" ry="{ry}" fill="var(--panel)" stroke="{col}" stroke-width="2"/>')


FRAME_STORES = [("Document", "flow"), ("Search", "ink"), ("Graph", "graph"), ("Vector", "vec"), ("Relational", "cool")]
ACTS = [("Why now", "timeline · UMT"), ("The physics", "three knobs"),
        ("The pattern walk", "six industries"), ("How you know", "the bake-off")]


def fig_framing():
    f = Fig(1120, 456, "Old frame, a database per workload glued together with integration tax and consistency gaps, "
                       "reframed as model once, project many: one canonical form of entities and relationships, "
                       "projected as document, graph, vector and relational; then the four-act map of the session")
    # --- old frame --------------------------------------------------------------------------
    ox, pw, py, ph = 18, 496, 18, 282
    f.rect(ox, py, pw, ph, fill="var(--panel)", stroke="var(--hot)", sw=1.8, rx=10, name="old")
    f.raw(f'<rect x="{ox}" y="{py}" width="5" height="{ph}" rx="2" fill="var(--hot)"/>')
    f.text(ox + 24, py + 30, "THE OLD FRAME", size=14, weight=600, fill="var(--hot)", font=MONO)
    f.text(ox + 24, py + 60, "A database per workload", size=21, weight=800, font=HEAD)
    tw_, gap = 84, 12
    tx0 = ox + (pw - (5 * tw_ + 4 * gap)) / 2 + 2
    bus_y, tile_y, tile_h = 212, 96, 82
    xs = []
    for i, (name, tone) in enumerate(FRAME_STORES):
        x = tx0 + i * (tw_ + gap)
        cx = x + tw_ / 2
        xs.append(cx)
        col = TONE[tone][0] if tone != "ink" else "var(--muted)"
        soft = TONE[tone][1]
        f.rect(x, tile_y, tw_, tile_h, fill="var(--panel)", stroke="var(--hairline)", sw=1.4, rx=8, name=name)
        _cyl(f, cx, tile_y + 16, 30, 26, col, soft)
        f.text(cx, tile_y + 70, name, size=14, weight=600, fill=col, anchor="middle")
        f.line(cx, tile_y + tile_h, cx, bus_y, stroke="var(--hot)", sw=2, name="drop", seg=False)
    f.line(xs[0], bus_y, xs[-1], bus_y, stroke="var(--hot)", sw=3, name="glue", seg=False)
    for cx in xs:
        f.circle(cx, bus_y, 6, fill="var(--hot)", stroke="var(--panel)", sw=2)
    for j, (lab, sub) in ((1, ("integration tax", "serialize · hop · auth")),
                          (3, ("consistency gap", "copies disagree meanwhile"))):
        cx = xs[j]
        f.line(cx, bus_y + 8, cx, bus_y + 24, stroke="var(--hot)", sw=1.4, dash="3 3", name="leader", seg=False)
        f.text(cx, bus_y + 44, lab, size=16, weight=700, fill="var(--hot)", anchor="middle")
        f.text(cx, bus_y + 64, sub, size=13.5, fill="var(--muted)", anchor="middle")
    # --- transition -------------------------------------------------------------------------
    nx = 606
    f.line(ox + pw + 12, 160, nx - 12, 160, stroke="var(--ink)", sw=3, arrow=True, name="reframe")
    f.text((ox + pw + nx) / 2, 146, "reframe", size=14, weight=600, fill="var(--ink)", anchor="middle")
    # --- new frame --------------------------------------------------------------------------
    npw = 1102 - nx
    f.rect(nx, py, npw, ph, fill="var(--panel)", stroke="var(--cool)", sw=1.8, rx=10, name="new")
    f.raw(f'<rect x="{nx}" y="{py}" width="5" height="{ph}" rx="2" fill="var(--cool)"/>')
    f.text(nx + 24, py + 30, "THE FRAME FOR TODAY", size=14, weight=600, fill="var(--cool)", font=MONO)
    f.text(nx + 24, py + 60, "Model once, project many", size=21, weight=800, font=HEAD)
    fl = Flow(f)
    fl.node("canon", nx + 24, 112, 212, 110, ["Canonical form", "entities · relationships", "each fact once"],
            tone="cool", fill="var(--cool-soft)", size=17, sub=14)
    shapes = [("Document", "flow"), ("Graph", "graph"), ("Vector", "vec"), ("Relational", "cool")]
    sx, sw_, sh = nx + 290, 190, 34
    f.text(sx + sw_, py + 30, "PROJECTIONS, READ AS SHAPES", size=11.5, weight=600, fill="var(--muted)",
           anchor="end", font=MONO)
    for k, (name, tone) in enumerate(shapes):
        fl.node(name, sx, 88 + k * 42, sw_, sh, [name], tone=tone, size=15)
    for k, (name, _t) in enumerate(shapes):
        fl.edge("canon", name, nx + 262, tone="cool", ay=167, by=88 + k * 42 + sh / 2)
    f.rect(nx + 24, 250, npw - 44, 34, fill="var(--cool-soft)", stroke="var(--cool)", sw=1.3, rx=17, name="engine")
    f.text(nx + 24 + (npw - 44) / 2, 272, "one transaction · one optimizer", size=16, weight=700,
           fill="var(--cool)", anchor="middle")
    # --- the map ----------------------------------------------------------------------------
    f.text(18, 334, "TODAY'S MAP", size=14, weight=600, fill="var(--faint)", font=MONO)
    f.text(1102, 334, "a modeling session, not a product pitch", size=14, fill="var(--muted)", anchor="end",
           italic=True)
    cw, cg, cy, ch = 248, 30, 346, 52
    for i, (title, sub) in enumerate(ACTS):
        x = 18 + i * (cw + cg)
        f.rect(x, cy, cw, ch, fill="var(--chip)", stroke="var(--hairline)", sw=1.2, rx=26, name="act")
        f.circle(x + 27, cy + ch / 2, 16, fill="var(--cool)")
        f.text(x + 27, cy + ch / 2 + 6, str(i + 1), size=16, weight=800, fill="var(--panel)", anchor="middle",
               font=HEAD)
        f.text(x + 54, cy + 23, title, size=16, weight=700, font=HEAD)
        f.text(x + 54, cy + 42, sub, size=13.5, fill="var(--muted)")
        if i:
            f.line(x - cg + 5, cy + ch / 2, x - 5, cy + ch / 2, stroke="var(--faint)", sw=2, arrow=True, name="next")
    lead, main = "The rule all day:", "the workload chooses the shape; measure, don't guess."
    w = tw(lead, 17, SANS, 600) + 10 + tw(main, 21, HEAD, 800) * 0.9  # Bricolage renders narrower than tw()
    f.track(560 - w / 2, 434 - 17, 560 + w / 2, 434 + 5, "punchline")
    f.raw(f'<text x="560" y="434" text-anchor="middle"><tspan font-size="17" font-family="{SANS}" font-weight="600" '
          f'fill="var(--muted)">{lead}</tspan><tspan dx="10" font-size="21" font-family="{HEAD}" font-weight="800" '
          f'fill="var(--cool)">{main.replace("\'", "&#39;")}</tspan></text>')
    return f.svg()


# ----------------------------------------------------------------------------- slide 3
# Ported from From-RDBMS-to-NoSQL-Oracle-Edition.html, slide 8 ("Timeline with Peaks & Valleys"):
# same eras, dates, images, peak/valley sequence and 10-build order, restyled to deck tokens.
ERAS = [  # (label lines, date, source-curve y, tone, image)
    (["Human", "Brain"], "~100,000 BC", 320, "flow", "images/image79.png"),
    (["Ledgers"], "~3000 BC", 380, "cool", "images/image84.png"),
    (["Punch", "Cards"], "1890s", 280, "vec", "images/image83.png"),
    (["Magnetic", "Tape"], "1950s", 350, "graph", "images/image77.png"),
    (["Block", "Storage"], "1970s", 240, "flow", "images/image78.png"),
    (["RDBMS"], "1980s", 340, "cool", "images/image89.png"),
    (["Distributed", "NoSQL"], "2000s", 180, "hot", "images/image93.png"),
    (["Polyglot", "Persistence"], "2015+", 100, "graph", None),
    (["Unified Model", "Theory"], "2020s", 390, "hot", "images/umt-icon.png"),
]


def fig_timeline():
    W, H = 1300, 540
    f = Fig(W, H, "Data pressure through the ages: a curve of peaks and valleys from the human brain to Unified Model Theory")
    ax_x, ax_y, top = 70, 452, 150
    xs = [128 + i * 135 for i in range(len(ERAS))]
    ys = [ax_y - (420 - y) * (ax_y - top) / 320 for _, _, y, _, _ in ERAS]
    f.defs.append('<linearGradient id="tlgrad" x1="0" y1="0" x2="0" y2="1">'
                  '<stop offset="0%" style="stop-color:var(--hot);stop-opacity:0.42"/>'
                  '<stop offset="100%" style="stop-color:var(--hot);stop-opacity:0.03"/></linearGradient>')
    # axes + curve (build 0: always visible)
    f.raw(f'<text x="34" y="{(top + ax_y) / 2:.0f}" font-size="15" font-family="{SANS}" font-weight="600" '
          f'fill="var(--muted)" text-anchor="middle" transform="rotate(-90 34 {(top + ax_y) / 2:.0f})">Data pressure</text>')
    f.track(22, (top + ax_y) / 2 - 60, 38, (top + ax_y) / 2 + 60, "ylabel")
    pts = [(ax_x, ax_y - 30)] + list(zip(xs, ys)) + [(W - 30, ax_y - 42)]
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        h = (x1 - x0) / 2
        d += f" C{x0 + h:.1f},{y0:.1f} {x1 - h:.1f},{y1:.1f} {x1:.1f},{y1:.1f}"
    f.raw(f'<path d="{d} L{pts[-1][0]:.1f},{ax_y} L{ax_x},{ax_y} Z" fill="url(#tlgrad)"/>')
    f.path(d, [(x, y) for x, y in pts], stroke="var(--hot)", sw=4, name="curve", seg=False)
    f.line(ax_x, ax_y, W - 22, ax_y, stroke="var(--faint)", sw=2, arrow=True, name="xaxis", seg=False)
    f.line(ax_x, ax_y, ax_x, top - 40, stroke="var(--faint)", sw=2, arrow=True, name="yaxis", seg=False)
    f.text(W - 24, ax_y + 48, "time", size=14, fill="var(--faint)", anchor="end", italic=True)

    for i, ((lab, date, _, tone, img), x, y) in enumerate(zip(ERAS, xs, ys), start=1):
        col = TONE[tone][0]
        f.raw(f'<g data-step="{i}">')
        last = i == len(ERAS)
        f.line(x, 128, x, ax_y + 8, stroke=col, sw=1.4, dash="4 3", name="drop", seg=False)
        # image / access-dimension chips in the top band (y 18..80)
        if img:
            s = 62
            f.rect(x - s / 2 - 3, 18, s + 6, s + 6, fill="var(--panel)", stroke=col, sw=2, rx=9, name="img")
            f.raw(f'<image href="{img}" x="{x - s / 2:.1f}" y="21" width="{s}" height="{s}" '
                  f'preserveAspectRatio="xMidYMid {"meet" if last else "slice"}"/>')
        else:
            chips = [[("SQL", "flow"), ("Doc", "cool"), ("Graph", "vec")], [("Time", "graph"), ("Vector", "hot")]]
            for r, row in enumerate(chips):
                ws = [tw(t, 13, SANS, 600) + 16 for t, _ in row]
                cx = x - (sum(ws) + 6 * (len(ws) - 1)) / 2
                for (t, tn), w in zip(row, ws):
                    f.rect(cx, 19 + r * 32, w, 26, fill=TONE[tn][1], stroke=TONE[tn][0], sw=1.3, rx=13, name="chip")
                    f.text(cx + w / 2, 37 + r * 32, t, size=13, weight=600, fill=TONE[tn][0], anchor="middle")
                    cx += w + 6
        for k, t in enumerate(lab):
            f.text(x, 104 + k * 18, t, size=16, weight=700, fill=col, anchor="middle", font=HEAD)
        f.circle(x, y, 12 if last else 9, fill=col, stroke="var(--panel)", sw=3 if last else 2)
        f.text(x, ax_y + 28, date, size=15, weight=700 if last else 500,
               fill="var(--ink)" if last else "var(--muted)", anchor="middle")
        f.raw("</g>")
    f.raw('<g data-step="10">')
    f.text(W / 2, H - 22, "Each peak = data pressure exceeding current technology.  Each valley = the solution.",
           size=18, weight=600, fill="var(--ink)", anchor="middle")
    f.raw("</g>")
    return f.svg()


# ----------------------------------------------------------------------------- slide 4
def fig_economics():
    f = Fig(1120, 424, "Then and now: storage and compute costs swap places; the answer becomes an engine-maintained projection")
    panels = [
        (18, "THEN · 1970s–1990s", [("Storage", "disk cost real money", 300, "hot", "expensive"),
                                   ("Compute & latency", "joins were affordable", 90, "cool", "cheap enough")]),
        (604, "NOW · 2010s →", [("Storage", "pennies per gigabyte", 40, "cool", "nearly free"),
                               ("Compute & latency", "CPU, network hops, user wait", 300, "hot", "expensive")]),
    ]
    for x, title, rows in panels:
        f.rect(x, 18, 496, 230, fill="var(--panel)", stroke="var(--hairline)", rx=10, name="panel")
        f.text(x + 20, 46, title, size=15, weight=600, fill="var(--faint)", font=MONO)
        for r, (name, sub, L, tone, val) in enumerate(rows):
            y = 84 + r * 84
            w = f.text(x + 20, y, name, size=17, weight=700, font=HEAD)
            f.text(x + 28 + w, y, "· " + sub, size=14, fill="var(--muted)")
            f.rect(x + 20, y + 14, L, 30, fill=TONE[tone][0], stroke=TONE[tone][0], sw=1, rx=5, name="bar")
            f.text(x + 34 + L, y + 35, val, size=16, weight=700, fill=TONE[tone][0])
    f.line(526, 132, 592, 132, stroke="var(--ink)", sw=2, arrow=True, name="swap")
    f.text(559, 120, "swap", size=14, weight=600, fill="var(--ink)", anchor="middle")
    # then: plain answer; now: the callout
    f.line(854, 248, 854, 296, stroke="var(--cool)", sw=2.2, arrow=True, name="callout")
    f.rect(604, 300, 496, 104, fill="var(--cool-soft)", stroke="var(--cool)", sw=2, rx=10, name="answer")
    f.text(854, 334, "denormalize → project (engine-maintained)", size=18, weight=800, fill="var(--ink)",
           anchor="middle", font=HEAD)
    f.text(854, 362, "keep one normalized truth; spend cheap storage", size=15, fill="var(--muted)", anchor="middle")
    f.text(854, 384, "on read shapes the engine keeps in sync", size=15, fill="var(--muted)", anchor="middle")
    f.rect(18, 300, 496, 104, fill="var(--panel)", stroke="var(--hairline)", sw=1.4, rx=10, name="then")
    f.text(266, 334, "Answer then: normalize", size=18, weight=800, fill="var(--ink)", anchor="middle", font=HEAD)
    f.text(266, 362, "store each fact once;", size=15, fill="var(--muted)", anchor="middle")
    f.text(266, 384, "join at read time to reassemble it", size=15, fill="var(--muted)", anchor="middle")
    return f.svg()


# ----------------------------------------------------------------------------- slide 6
STORES = [  # name, what it holds, value, stale?, lag
    ("Document store", "JSON documents", "Gold", False, "lag ~ms"),
    ("Search index", "full-text search", "Gold", False, "lag ~1–15 s"),
    ("Vector index", "embeddings for RAG", "Silver", True, "next embed job"),
    ("Graph store", "relationships", "Gold", False, "lag ~1 s"),
    ("Cache", "hot reads", "Silver", True, "10 min expiry"),
]


def _clock(f: Fig, cx, cy, col):
    f.circle(cx, cy, 10, fill="var(--panel)", stroke=col, sw=2)
    f.line(cx, cy, cx, cy - 6.5, stroke=col, sw=2, name="hand", seg=False)
    f.line(cx, cy, cx + 5, cy + 2, stroke=col, sw=2, name="hand", seg=False)


def fig_polyglot():
    f = Fig(1120, 452, "One fact copied into five stores, each with its own sync delay; an AI agent reads a stale copy and acts on it")
    fl = Flow(f)
    rows_y = [70 + i * 74 for i in range(5)]
    fl.node("src", 18, 218, 198, 88, ["One fact changes", "customer tier = Gold", "10:00:00"], tone="flow", size=16, sub=14)
    for i, (name, what, val, stale, lag) in enumerate(STORES):
        y = rows_y[i]
        tone = "hot" if stale else "ink"
        f.rect(302, y, 460, 58, fill="var(--panel)", stroke=TONE[tone][0] if stale else "var(--hairline)",
               sw=2 if stale else 1.4, rx=8, name=name)
        fl.nodes[name] = (302, y, 460, 58)
        f.text(318, y + 25, name, size=16, weight=700, font=HEAD)
        f.text(318, y + 45, what, size=13.5, fill="var(--muted)")
        vt = "hot" if stale else "cool"
        pw = tw(val, 15, SANS, 700) + 22
        f.rect(478, y + 15, pw, 28, fill=TONE[vt][1], stroke=TONE[vt][0], sw=1.3, rx=14, name="val")
        f.text(478 + pw / 2, y + 34, val, size=15, weight=700, fill=TONE[vt][0], anchor="middle")
        if stale:
            f.text(478 + pw + 8, y + 34, "stale", size=13.5, weight=700, fill="var(--hot)")
        _clock(f, 624, y + 29, "var(--hot)" if stale else "var(--muted)")
        f.text(642, y + 34, lag, size=13.5, weight=600 if stale else 400,
               fill="var(--hot)" if stale else "var(--muted)")
    for i, (name, *_rest) in enumerate(STORES):
        fl.edge("src", name, 258, tone="flow", ay=262, by=rows_y[i] + 29)
    f.text(236, 30, "integration tax", size=15, weight=700, fill="var(--hot)", anchor="middle")
    f.text(236, 50, "per copy: serialize · network hop · auth", size=13, fill="var(--muted)", anchor="middle")
    f.text(680, 30, "eventual consistency gap", size=15, weight=700, fill="var(--hot)", anchor="middle")
    f.text(680, 50, "each copy catches up on its own clock", size=13, fill="var(--muted)", anchor="middle")
    # the agent reads the stale vector copy (row 2) and acts on it
    f.text(962, 188, "10:00:05 (five seconds later)", size=13.5, fill="var(--muted)", anchor="middle")
    fl.node("agent", 820, 203, 282, 88, ["AI agent (RAG)", "retrieval-augmented generation", "reads the vector copy: Silver"],
            tone="flow", size=16, sub=13.5)
    fl.edge("Vector index", "agent", 791, tone="hot", ay=rows_y[2] + 29, by=247)
    f.text(791, rows_y[2] + 21, "reads", size=13, weight=600, fill="var(--hot)", anchor="middle")
    f.line(962, 291, 962, 317, stroke="var(--hot)", sw=2, arrow=True, name="acts")
    fl.node("act", 820, 321, 282, 64, ["Acts on “Silver”", "denies a Gold customer's fee waiver"], tone="hot", size=16, sub=13.5)
    f.text(962, 410, "confident wrong answer", size=16, weight=800, fill="var(--hot)", anchor="middle", font=HEAD)
    f.text(962, 430, "(hallucination)", size=15, fill="var(--hot)", anchor="middle")
    return f.svg()


# ----------------------------------------------------------------------------- slide 7
TERMS = [  # title, gloss, examples, tone
    ("Canonical Form", "the logical model", ["entities", "properties", "relationships"], "cool"),
    ("Projections", "how the data is stored", ["tables / rows", "documents", "graph nodes & edges"], "cool"),
    ("Access Surface", "how consumers ask", ["SQL · SQL/JSON", "SQL/PGQ (graph queries)", "MongoDB API"], "flow"),
    ("Projected Shape", "what the consumer reads", ["a document · a graph", "a vector result", "a rowset"], "flow"),
]


def fig_umt():
    f = Fig(1120, 412, "UMT vocabulary as a flow: the canonical form (entities, properties, relationships) is stored as "
                       "projections (tables, documents, graph nodes and edges); queries on the access surface render "
                       "the projected shape the consumer reads; each query carries an access dimension")
    w, gap, x0, y0, h = 230, 48, 28, 58, 188
    # the step from projection to shape happens at query time, on the access surface
    c2, c4 = x0 + (w + gap) + w / 2, x0 + 3 * (w + gap) + w / 2
    f.path(f"M{c2:.1f},{y0 - 2:.1f} V42 H{c4:.1f} V{y0 - 3:.1f}", [(c2, y0 - 2), (c2, 42), (c4, 42), (c4, y0 - 3)],
           stroke="var(--flow)", sw=1.8, arrow=True, name="render", seg=False)
    f.text((c2 + c4) / 2, 32, "queries on the access surface render the shape", size=15, weight=600,
           fill="var(--flow)", anchor="middle")
    for i, (title, gloss, ex, tone) in enumerate(TERMS):
        x = x0 + i * (w + gap)
        col = TONE[tone][0]
        f.rect(x, y0, w, h, fill="var(--panel)", stroke=col, sw=1.8, rx=10, name=title)
        f.raw(f'<rect x="{x}" y="{y0}" width="5" height="{h}" rx="2" fill="{col}"/>')
        f.text(x + w / 2 + 2, y0 + 34, title, size=19, weight=800, anchor="middle", font=HEAD)
        f.text(x + w / 2 + 2, y0 + 58, gloss, size=14, fill=col, anchor="middle", weight=600)
        f.line(x + 22, y0 + 74, x + w - 18, y0 + 74, stroke="var(--hairline)", sw=1, name="rule", seg=False)
        for k, t in enumerate(ex):
            f.text(x + w / 2 + 2, y0 + 104 + k * 24, t, size=15, fill="var(--muted)", anchor="middle")
        if i:
            f.line(x - gap + 4, y0 + h / 2, x - 4, y0 + h / 2, stroke="var(--ink)", sw=2, arrow=True, name="arrow")
    # the query, with its access dimension, arrives at the access surface
    qx, qy, qw, qh = 434, 290, 668, 104
    ax = x0 + 2 * (w + gap) + w / 2
    f.rect(qx, qy, qw, qh, fill="var(--panel)", stroke="var(--hairline)", sw=1.4, rx=10, name="query")
    f.text(qx + 18, qy + 28, "A consumer's query", size=17, weight=700, font=HEAD)
    f.text(qx + 228, qy + 28, "Access Dimension: the kind of question it asks", size=14.5, fill="var(--muted)")
    dims = ["point", "range", "aggregate", "traverse", "similarity"]
    cx = qx + 18
    for d in dims:
        cw = (qw - 36 - 4 * 10) / 5
        f.rect(cx, qy + 48, cw, 36, fill="var(--flow-soft)", stroke="var(--flow)", sw=1.3, rx=18, name="dim")
        f.text(cx + cw / 2, qy + 72, d, size=16, weight=600, fill="var(--flow)", anchor="middle", font=MONO)
        cx += cw + 10
    f.line(ax, qy - 2, ax, y0 + h + 4, stroke="var(--flow)", sw=2, arrow=True, name="asks")
    f.text(ax + 10, qy - 16, "asks", size=13.5, weight=600, fill="var(--flow)")
    f.text(210, 332, "Model once.", size=26, weight=800, fill="var(--cool)", anchor="middle", font=HEAD)
    f.text(210, 368, "Project many.", size=26, weight=800, fill="var(--cool)", anchor="middle", font=HEAD)
    return f.svg()


FIGS = {"framing": fig_framing, "timeline": fig_timeline, "economics": fig_economics, "polyglot": fig_polyglot, "umt": fig_umt}


def main():
    s = DECK.read_text(encoding="utf-8")
    for name, fn in FIGS.items():
        svg = fn()
        pat = re.compile(rf"(<!-- ACT1FIG:{name} -->).*?(<!-- /ACT1FIG:{name} -->)", re.S)
        if not pat.search(s):
            sys.exit(f"marker ACT1FIG:{name} missing from deck")
        s = pat.sub(lambda m: m.group(1) + svg + m.group(2), s)
        print(f"{name}: ok")
    DECK.write_text(s, encoding="utf-8")


if __name__ == "__main__":
    main()
