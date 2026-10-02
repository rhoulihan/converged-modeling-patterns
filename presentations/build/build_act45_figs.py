"""Acts 4-5 figures for converged-modeling-patterns/presentations/converged-data-modeling-workshop1.html
(hand-authored slides 38-45: the rest of the catalog through the call to action).

Same contract as build_act1_figs.py: each figure is built with deckfig.py (frame, collision
and line-through-text checks) and spliced between ``<!-- ACT45FIG:name -->`` and
``<!-- /ACT45FIG:name -->`` markers. build_converged_deck.py never touches these slides.

  python3 presentations/build/build_act45_figs.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # presentations/build
sys.path.insert(0, str(ROOT))
from deckfig import HEAD, MONO, SANS, TONE, Fig, knob_rows, tw  # noqa: E402

DECK = Path(os.environ.get("CMP_DECK", ROOT.parent / "converged-data-modeling-workshop1.html"))


def chip(f: Fig, x, y, s, tone="cool", size=12.5, h=24, font=MONO, weight=600):
    """Rounded tag with centred text; returns its width."""
    w = tw(s, size, font, weight) + 20
    f.rect(x, y, w, h, fill=TONE[tone][1], stroke=TONE[tone][0], sw=1.1, rx=h / 2, name="chip")
    f.text(x + w / 2, y + h / 2 + size * 0.36, s, size=size, weight=weight, fill=TONE[tone][0],
           anchor="middle", font=font)
    return w


def panel(f: Fig, x, y, w, h, tone, title, sub=None):
    f.rect(x, y, w, h, fill="var(--panel)", stroke=TONE[tone][0], sw=1.8, rx=12, name=title)
    f.text(x + 22, y + 30, title, size=14, weight=600, fill=TONE[tone][0], font=MONO)
    if sub:
        f.text(x + 22, y + 52, sub, size=14, fill="var(--muted)")


def disc(f: Fig, cx, cy, r, n, tone="cool", size=None):
    f.circle(cx, cy, r, fill=TONE[tone][0])
    size = size or r * 1.05
    f.text(cx, cy + size * 0.36, str(n), size=size, weight=800, fill="var(--panel)", anchor="middle", font=HEAD)


# ----------------------------------------------------------------------------- slide 38
OPTIONAL = [  # name, what it was for, what Oracle gives you
    ("Polymorphic", "mixed shapes in one collection", "multivalue index"),
    ("Attribute", "sparse key/value attributes", "real index on key/value"),
    ("Schema-Versioning", "old and new shapes side by side", "IS JSON + a view"),
    ("Document-Versioning", "history of every change", "temporal validity / Flashback"),
]
OBSOLETE = [
    ("Approximation", "hand-rolled approximate counters", "APPROX_COUNT_DISTINCT"),
    ("Pre-Allocation", "padding so a document won't move", "an MMAPv1 artifact"),
]


def _tile(f: Fig, x, y, w, h, name, sub, tag, tone, strike=False):
    f.rect(x, y, w, h, fill="var(--panel)", stroke="var(--hairline)", sw=1.3, rx=8, name=name)
    f.raw(f'<rect x="{x}" y="{y}" width="4" height="{h}" rx="2" fill="{TONE[tone][0]}"/>')
    nw = f.text(x + 20, y + 32, name, size=20, weight=800, font=HEAD,
                fill="var(--muted)" if strike else "var(--ink)")
    if strike:
        f.line(x + 17, y + 25, x + 23 + nw * 0.9, y + 25, stroke="var(--hot)", sw=2.2, name="strike", seg=False)
    f.text(x + 20, y + 56, sub, size=13.5, fill="var(--muted)")
    chip(f, x + 20, y + 70, tag, tone=tone)


def fig_catalog():
    f = Fig(1120, 420, "The rest of the catalog: four patterns still useful but optional, each with the Oracle mechanism that replaces it, and two obsolete patterns")
    panel(f, 18, 18, 700, 314, "cool", "STILL USEFUL, NOW OPTIONAL", "the engine already gives you the mechanism")
    for i, (name, sub, tag) in enumerate(OPTIONAL):
        _tile(f, 40 + (i % 2) * 336, 88 + (i // 2) * 120, 320, 108, name, sub, tag, "cool")
    panel(f, 742, 18, 360, 314, "hot", "OBSOLETE", "the limit they fought is gone")
    for i, (name, sub, tag) in enumerate(OBSOLETE):
        _tile(f, 764, 88 + i * 120, 320, 108, name, sub, tag, "hot", strike=True)
    f.text(560, 386, "Patterns are bets against an engine.", size=32, weight=800, anchor="middle", font=HEAD)
    return f.svg()


# ----------------------------------------------------------------------------- slide 39
def _tree(f: Fig, x, y, w=36, h=32, tone="cool"):
    """B-tree index glyph: a triangle with a root dot."""
    c = TONE[tone][0]
    f.path(f"M{x + w / 2:.1f},{y} L{x + w},{y + h} L{x},{y + h} Z", [(x, y), (x + w, y + h)],
           stroke=c, sw=1.6, fill=TONE[tone][1], name="tree", seg=False)
    f.circle(x + w / 2, y + 8, 3, fill=c)


def _doc(f: Fig, x, y, w=30, h=36, tone="flow"):
    c = TONE[tone][0]
    f.path(f"M{x},{y} H{x + w - 9} L{x + w},{y + 9} V{y + h} H{x} Z", [(x, y), (x + w, y + h)],
           stroke=c, sw=1.6, fill="var(--panel)", name="doc", seg=False)
    for k in range(3):
        f.line(x + 6, y + 14 + k * 7, x + w - 6, y + 14 + k * 7, stroke=c, sw=1.2, name="docline", seg=False)


def fig_cart():
    f = Fig(1120, 436, "The shopping cart as a JSON collection table in Oracle, the three knob settings that make embedding win, and the read cost of one collection probe versus a duality view assembling k tables")
    # column 1: the cart, in Oracle
    f.text(18, 30, "THE CART, IN ORACLE", size=13, weight=600, fill="var(--faint)", font=MONO)
    f.rect(18, 44, 336, 36, fill="var(--chip)", stroke="var(--hairline)", sw=1, rx=6, name="ddl")
    f.text(32, 67, "CREATE JSON COLLECTION TABLE carts;", size=12.5, weight=600, fill="var(--cool)", font=MONO)
    f.rect(18, 92, 336, 112, fill="var(--panel)", stroke="var(--hairline)", sw=1.3, rx=8, name="cartdoc")
    lines = ['{ "_id": "cart#u42",', '  "items": [', '    { "sku": "A-19", "qty": 2 },', '    { "sku": "C-07", "qty": 1 } ] }']
    for k, ln in enumerate(lines):
        ind = len(ln) - len(ln.lstrip(" "))
        f.text(32 + ind * 12 * 0.61, 120 + k * 22, ln.strip(), size=12, font=MONO)
    f.text(18, 232, "one table, two access surfaces", size=13, fill="var(--muted)")
    for k, (a, b) in enumerate((("MongoDB API", "insertOne() · find()"), ("SQL/JSON", "JSON_VALUE · JSON_TABLE"))):
        y = 244 + k * 46
        f.rect(18, y, 336, 36, fill="var(--flow-soft)", stroke="var(--flow)", sw=1.3, rx=8, name="lane")
        f.text(32, y + 23, a, size=14, weight=700, fill="var(--flow)")
        f.text(340, y + 23, b, size=12.5, fill="var(--muted)", anchor="end", font=MONO)
    # column 2: the knobs
    f.text(386, 30, "THE KNOBS FOR THE CART", size=13, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 386, 42, [
        dict(name="1 · Diversity", value=0.12, tone="cool", setting="Low: one owner",
             lines=["one shopper reads and", "writes this cart"]),
        dict(name="2 · Read / write", value=0.5, tone="flow", setting="Both hot",
             lines=["every click reads it", "and writes it"]),
        dict(name="3 · Update locality", value=0.12, tone="cool", setting="Private",
             lines=["an update touches one cart,", "never a shared fact"]),
    ], row_h=84, r=24)
    f.rect(386, 296, 300, 34, fill="var(--cool-soft)", stroke="var(--cool)", sw=1.4, rx=8, name="verdict")
    f.text(536, 318, "embed wins: nothing shared to copy", size=14, weight=700, fill="var(--cool)", anchor="middle")
    # column 3: read cost
    f.text(716, 30, "READ COST, SAME DOCUMENT SHAPE", size=13, weight=600, fill="var(--faint)", font=MONO)
    f.rect(716, 44, 386, 112, fill="var(--panel)", stroke="var(--hairline)", sw=1.3, rx=8, name="rowA")
    f.raw('<rect x="716" y="44" width="4" height="112" rx="2" fill="var(--cool)"/>')
    f.text(736, 70, "JSON collection", size=16, weight=700, font=HEAD)
    _tree(f, 736, 90)
    f.line(778, 106, 806, 106, stroke="var(--cool)", sw=1.8, arrow=True, name="fetch")
    _doc(f, 812, 88)
    f.text(1086, 104, "O(log n)", size=21, weight=700, fill="var(--cool)", anchor="end", font=MONO)
    f.text(1086, 128, "1 probe + 1 fetch", size=13.5, fill="var(--muted)", anchor="end")
    f.rect(716, 172, 386, 158, fill="var(--panel)", stroke="var(--hairline)", sw=1.3, rx=8, name="rowB")
    f.raw('<rect x="716" y="172" width="4" height="158" rx="2" fill="var(--flow)"/>')
    f.text(736, 198, "Duality view over k tables", size=16, weight=700, font=HEAD)
    for k in range(3):
        _tree(f, 736 + k * 46, 212, tone="flow")
        f.line(754 + k * 46, 246, 754 + k * 46, 266, stroke="var(--flow)", sw=1.6, arrow=True, name="probe")
    f.text(880, 234, "… k", size=15, weight=700, fill="var(--flow)", font=MONO)
    f.rect(736, 270, 112, 28, fill="var(--flow-soft)", stroke="var(--flow)", sw=1.2, rx=6, name="assemble")
    f.text(792, 289, "assemble", size=13, weight=600, fill="var(--flow)", anchor="middle")
    f.line(850, 284, 872, 284, stroke="var(--flow)", sw=1.8, arrow=True, name="out")
    _doc(f, 876, 266)
    f.text(1086, 232, "O(k · log n)", size=21, weight=700, fill="var(--flow)", anchor="end", font=MONO)
    f.text(1086, 256, "k probes + assembly", size=13, fill="var(--muted)", anchor="end")
    f.text(1086, 276, "nested arrays cost more", size=13, fill="var(--muted)", anchor="end")
    f.text(1086, 314, "joins are never free", size=13.5, weight=700, fill="var(--hot)", anchor="end")
    # the message
    f.rect(18, 356, 1084, 58, fill="var(--flow-soft)", stroke="var(--flow)", sw=1.4, rx=10, name="msg")
    f.text(560, 391, "Powerful tools: pick the shape the workload asks for. A single collection is not a duality view.",
           size=17.5, weight=700, anchor="middle")
    return f.svg()


# ----------------------------------------------------------------------------- slide 40
def _icon_schema(f: Fig, cx, cy):
    boxes = [(cx - 62, cy - 34), (cx + 14, cy - 34), (cx - 24, cy + 8)]
    f.line(cx - 14, cy - 20, cx + 14, cy - 20, stroke="var(--muted)", sw=1.6, name="fk", seg=False)
    f.path(f"M{cx - 38},{cy - 6} V{cy + 22} H{cx - 24}", [(cx - 38, cy - 6), (cx - 24, cy + 22)],
           stroke="var(--muted)", sw=1.6, name="fk2", seg=False)
    for x, y in boxes:
        f.rect(x, y, 48, 28, fill="var(--panel)", stroke="var(--ink)", sw=1.5, rx=4, name="tbl")
        f.raw(f'<rect x="{x}" y="{y}" width="48" height="9" rx="3" fill="var(--cool)"/>')


def _icon_volume(f: Fig, cx, cy):
    hs = [14, 26, 40, 56, 74]
    for k, h in enumerate(hs):
        x = cx - 60 + k * 25
        f.rect(x, cy + 38 - h, 18, h, fill="var(--flow)", stroke="var(--flow)", sw=1, rx=3, name="bar")
    f.line(cx - 66, cy + 40, cx + 66, cy + 40, stroke="var(--faint)", sw=1.4, name="base", seg=False)


def _glyph(f: Fig, kind, x, y):
    """36x40 shape glyphs for the five candidate designs."""
    ink, cool, flow, hot = "var(--ink)", "var(--cool)", "var(--flow)", "var(--hot)"
    if kind == "as-is":
        f.rect(x, y, 36, 40, fill="var(--chip)", stroke="var(--muted)", sw=1.5, rx=4, dash="4 3", name="g0")
        f.text(x + 18, y + 26, "?", size=17, weight=800, fill="var(--muted)", anchor="middle", font=HEAD, check=False)
    elif kind == "normalized":
        for k in range(3):
            f.rect(x + 6, y + k * 15, 24, 10, fill="var(--panel)", stroke=cool, sw=1.5, rx=2, name="g1")
        for k in range(2):
            f.line(x + 18, y + 10 + k * 15, x + 18, y + 15 + k * 15, stroke=cool, sw=1.5, name="g1l", seg=False)
    elif kind == "embedded":
        f.rect(x, y, 36, 40, fill="var(--panel)", stroke=hot, sw=1.6, rx=4, name="g2")
        f.rect(x + 6, y + 7, 24, 10, fill="var(--hot-soft)", stroke=hot, sw=1.2, rx=2, name="g2a")
        f.rect(x + 6, y + 22, 24, 10, fill="var(--hot-soft)", stroke=hot, sw=1.2, rx=2, name="g2b")
    elif kind == "hybrid":
        f.rect(x, y, 36, 40, fill="var(--panel)", stroke=cool, sw=1.6, rx=4, name="g3")
        for k in range(2):
            f.line(x + 5, y + 8 + k * 7, x + 31, y + 8 + k * 7, stroke=cool, sw=1.6, name="g3l", seg=False)
        f.text(x + 18, y + 34, "{ }", size=12, weight=700, fill=flow, anchor="middle", font=MONO, check=False)
    else:  # duality
        f.rect(x, y + 2, 14, 12, fill="var(--panel)", stroke=cool, sw=1.4, rx=2, name="g4a")
        f.rect(x, y + 24, 14, 12, fill="var(--panel)", stroke=cool, sw=1.4, rx=2, name="g4b")
        f.path(f"M{x + 14},{y + 8} H{x + 19} V{y + 30} H{x + 14} M{x + 19},{y + 19} H{x + 22}",
               [(x + 14, y + 8), (x + 22, y + 30)], stroke=ink, sw=1.3, name="g4l", seg=False)
        f.path(f"M{x + 22},{y + 8} H{x + 30} L{x + 36},{y + 14} V{y + 32} H{x + 22} Z",
               [(x + 22, y + 8), (x + 36, y + 32)], stroke=flow, sw=1.5, fill="var(--flow-soft)", name="g4d", seg=False)


def _icon_measure(f: Fig, cx, cy):
    f.circle(cx, cy - 6, 27, fill="var(--panel)", stroke="var(--ink)", sw=2.4)
    f.rect(cx - 6, cy - 42, 12, 7, fill="var(--ink)", stroke="var(--ink)", sw=1, rx=2, name="crown")
    f.line(cx, cy - 6, cx, cy - 24, stroke="var(--ink)", sw=2.4, name="hand", seg=False)
    f.line(cx, cy - 6, cx + 12, cy + 2, stroke="var(--hot)", sw=2.4, name="hand2", seg=False)
    f.circle(cx, cy - 6, 3, fill="var(--ink)")
    chip(f, cx - 70, cy + 30, "reads", tone="flow", size=12, h=22)
    chip(f, cx + 8, cy + 30, "writes", tone="hot", size=12, h=22)


def _icon_cross(f: Fig, cx, cy):
    x0, y0, w, h = cx - 60, cy - 38, 120, 78
    f.line(x0, y0 + h, x0 + w, y0 + h, stroke="var(--faint)", sw=1.4, name="ax", seg=False)
    f.line(x0, y0 + h, x0, y0, stroke="var(--faint)", sw=1.4, name="ay", seg=False)
    f.path(f"M{x0 + 4},{y0 + h - 14} C{x0 + 60},{y0 + h - 16} {x0 + 80},{y0 + 30} {x0 + w - 4},{y0 + 4}",
           [(x0, y0), (x0 + w, y0 + h)], stroke="var(--hot)", sw=3, name="c1", seg=False)
    f.path(f"M{x0 + 4},{y0 + h - 36} L{x0 + w - 4},{y0 + h - 28}", [(x0, y0), (x0 + w, y0 + h)],
           stroke="var(--cool)", sw=3, name="c2", seg=False)
    f.circle(x0 + 72, y0 + h - 31, 6, fill="var(--ink)")


STEPS = [  # title, sub lines, icon, width
    ("Your schema", ["the real one,", "not a toy"], "schema", 169),
    ("Your data", ["at production", "cardinality"], "volume", 169),
    ("Candidate designs", ["D0–D4 · same data, same engine"], "candidates", 310),
    ("Measure", ["reads AND writes,", "at your write rate"], "measure", 169),
    ("The crossover", ["where the winner", "flips"], "cross", 169),
]


def fig_bakeoff():
    f = Fig(1120, 452, "The bake-off in five steps: your schema, your data at production cardinality, five candidate designs, measure reads and writes, find the crossover; two rules; reason to the candidates, measure to the decision")
    x, y, h, gap = 18, 18, 244, 24
    for i, (title, subs, icon, w) in enumerate(STEPS):
        f.rect(x, y, w, h, fill="var(--panel)", stroke="var(--hairline)", sw=1.6, rx=12, name=title)
        disc(f, x + 30, y + 32, 17, i + 1)
        cx, cy = x + w / 2, y + 112
        if icon == "schema":
            _icon_schema(f, cx, cy)
        elif icon == "volume":
            _icon_volume(f, cx, cy)
        elif icon == "measure":
            _icon_measure(f, cx, cy)
        elif icon == "cross":
            _icon_cross(f, cx, cy)
        else:
            kinds = ["as-is", "normalized", "embedded", "hybrid", "duality"]
            for k, kind in enumerate(kinds):
                gx = x + 10 + k * 58 + 11
                _glyph(f, kind, gx, y + 72)
                f.text(gx + 18, y + 132, f"D{k}", size=12, weight=700, fill="var(--ink)", anchor="middle", font=MONO)
                f.text(gx + 18, y + 150, kind, size=10.5, fill="var(--muted)", anchor="middle")
        f.text(x + w / 2, y + 194, title, size=18, weight=800, anchor="middle", font=HEAD)
        for k, s in enumerate(subs):
            f.text(x + w / 2, y + 216 + k * 17, s, size=13.5, fill="var(--muted)", anchor="middle")
        if i < len(STEPS) - 1:
            f.line(x + w + 3, y + h / 2, x + w + gap - 3, y + h / 2, stroke="var(--cool)", sw=2.6, arrow=True, name="next")
        x += w + gap
    rules = [("RULE 1", "Writes are access patterns too", "a shape that wins reads and loses writes hasn't won"),
             ("RULE 2", "A win at the wrong scale is not a win", "measure at production cardinality, or you're tuning a toy")]
    for k, (tag, big, sub) in enumerate(rules):
        rx = 18 + k * 555
        f.rect(rx, 284, 529, 104, fill="var(--hot-soft)", stroke="var(--hot)", sw=1.8, rx=12, name=tag)
        f.text(rx + 22, 310, tag, size=12.5, weight=700, fill="var(--hot)", font=MONO)
        f.text(rx + 264, 346, big, size=21, weight=800, anchor="middle", font=HEAD)
        f.text(rx + 264, 372, sub, size=14, fill="var(--muted)", anchor="middle")
    f.text(560, 428, "Reason to the candidates. Measure to the decision.", size=25, weight=800,
           fill="var(--cool)", anchor="middle", font=HEAD)
    return f.svg()


# ----------------------------------------------------------------------------- slide 41
PROOFS = [  # org, workload, before, after, headline, lines
    ("GLOBAL BANK", "Heavy aggregation query", "30 s", "1.0 s", "28× faster", ["Query rewrite only.", "No new model."]),
    ("GLOBAL BANK", "Elected data model", "30 s", "18 ms", "1,667× faster", ["A hybrid model won:", "relational tables + JSON columns."]),
    ("WEALTH-MANAGEMENT PLATFORM", "40 production queries", "0.83 s", "0.16 s", "−81% on average",
     ["40 of 40 faster.", "A query that timed out: 0.39 s."]),
]


def fig_proofs():
    f = Fig(1120, 336, "Three before and after results from two anonymized engagements: 30 s to 1.0 s by rewrite, 30 s to 18 ms with a hybrid model, 0.83 s to 0.16 s average across 40 queries")
    for i, (org, wl, before, after, head, lines) in enumerate(PROOFS):
        x, y, w, h = 18 + i * 368, 18, 348, 300
        f.rect(x, y, w, h, fill="var(--panel)", stroke="var(--hairline)", sw=1.6, rx=12, name=org + str(i))
        f.raw(f'<rect x="{x}" y="{y}" width="{w}" height="5" rx="2" fill="var(--cool)"/>')
        f.text(x + 24, y + 38, org, size=13, weight=600, fill="var(--faint)", font=MONO)
        f.text(x + 24, y + 64, wl, size=17, weight=700, font=HEAD)
        bw = f.text(x + 24, y + 130, before, size=32, weight=800, fill="var(--hot)", font=HEAD)
        ax = x + 24 + bw + 10
        f.line(ax, y + 119, ax + 34, y + 119, stroke="var(--ink)", sw=2.4, arrow=True, name="to")
        f.text(ax + 44, y + 130, after, size=32, weight=800, fill="var(--cool)", font=HEAD)
        f.text(x + 24, y + 152, "before", size=11.5, fill="var(--faint)", font=MONO)
        f.text(ax + 44, y + 152, "after", size=11.5, fill="var(--faint)", font=MONO)
        f.line(x + 24, y + 172, x + w - 24, y + 172, stroke="var(--hairline)", sw=1, name="rule", seg=False)
        f.text(x + 24, y + 212, head, size=28, weight=800, fill="var(--cool)", font=HEAD)
        for k, s in enumerate(lines):
            f.text(x + 24, y + 244 + k * 21, s, size=15, fill="var(--muted)" if k else "var(--ink)",
                   weight=400 if k else 600)
    return f.svg()


# ----------------------------------------------------------------------------- slide 42
def fig_ninety_ten():
    f = Fig(1120, 332, "Entitlements: a 27-table join thicket versus one document with an indexed array, about 9 to 15 times faster on the same engine; and the 90/10 split served from one source of truth")
    panel(f, 18, 18, 520, 296, "cool", "ENTITLEMENTS · ARRAY CONTAINMENT", "“which resources can this principal touch?”")
    # join thicket
    for r in range(3):
        for c in range(4):
            bx, by = 40 + c * 54, 96 + r * 40
            if c < 3:
                f.line(bx + 34, by + 10, bx + 54, by + 10, stroke="var(--hot)", sw=1.3, name="j", seg=False)
            if r < 2:
                f.line(bx + 17, by + 20, bx + 17, by + 40, stroke="var(--hot)", sw=1.3, name="j", seg=False)
            f.rect(bx, by, 34, 20, fill="var(--panel)", stroke="var(--hot)", sw=1.3, rx=3, name="t")
    f.text(141, 236, "27 tables", size=15, weight=700, fill="var(--hot)", anchor="middle")
    f.text(141, 256, "a join thicket", size=13.5, fill="var(--muted)", anchor="middle")
    # document with indexed array
    f.rect(290, 92, 228, 100, fill="var(--panel)", stroke="var(--flow)", sw=1.5, rx=8, name="edoc")
    f.raw('<rect x="292" y="124" width="224" height="22" fill="var(--cool-soft)"/>')
    for k, (ln, col) in enumerate((('{ "principal": "p-88",', "var(--ink)"),
                                   ('  "resources": ["r-12",', "var(--cool)"),
                                   ('    "r-40", "r-77", ...] }', "var(--ink)"))):
        ind = len(ln) - len(ln.lstrip(" "))
        f.text(304 + ind * 11.5 * 0.61, 118 + k * 23, ln.strip(), size=11.5, font=MONO, fill=col)
    chip(f, 331, 204, "multivalue index", tone="cool", size=12, h=22)
    f.text(404, 256, "one document, indexed array", size=13.5, fill="var(--muted)", anchor="middle")
    f.text(278, 296, "~9–15× faster on the same engine", size=20, weight=800, fill="var(--cool)", anchor="middle", font=HEAD)
    # the 90/10
    panel(f, 562, 18, 540, 296, "flow", "THE 90/10", "every query on the shape that suits it")
    bx, by, bw = 584, 124, 496
    f.rect(bx, by, bw * 0.9, 50, fill="var(--flow-soft)", stroke="var(--flow)", sw=1.5, rx=6, name="ninety")
    f.text(bx + 16, by + 31, "~90%: happy on a document shape", size=14.5, weight=700, fill="var(--flow)")
    f.rect(bx + bw * 0.9 + 4, by, bw * 0.1 - 4, 50, fill="var(--cool-soft)", stroke="var(--cool)", sw=1.5, rx=6, name="ten")
    f.text(bx + bw * 0.95 + 2, by + 31, "10%", size=12.5, weight=700, fill="var(--cool)", anchor="middle")
    f.text(bx + bw, by - 12, "~10%: joins, aggregation, graph", size=13.5, weight=600, fill="var(--cool)", anchor="end")
    f.rect(bx, 234, bw, 44, fill="var(--panel)", stroke="var(--ink)", sw=1.6, rx=8, name="truth")
    f.text(bx + bw / 2, 262, "one canonical form · one engine", size=15, weight=700, anchor="middle")
    for ax in (bx + bw * 0.45, bx + bw * 0.95 + 2):
        f.line(ax, 232, ax, by + 54, stroke="var(--ink)", sw=1.7, arrow=True, name="up")
    return f.svg()


# ----------------------------------------------------------------------------- slide 43
TESTS = [
    (["One transaction", "boundary"], ["one ACID commit", "spans every model"]),
    (["One optimizer"], ["one cost-based plan", "across every model"]),
    (["One consistency", "model"], ["no lag between a", "vector and its row"]),
    (["One governance", "domain"], ["one auth, one audit,", "one patch cycle"]),
    (["Shared access", "surfaces"], ["SQL, SQL/JSON, SQL/PGQ,", "MongoDB API: same rows"]),
]


def fig_tests():
    f = Fig(1120, 424, "Five tests for a converged engine in a grid, the test that separates converged from polyglot, and the added benefit: one database to replicate across regions and clouds")
    for i, (title, subs) in enumerate(TESTS):
        x, y, w, h = 18 + i * 220, 18, 204, 162
        f.rect(x, y, w, h, fill="var(--panel)", stroke="var(--cool)", sw=1.6, rx=10, name=title[0])
        disc(f, x + 30, y + 32, 16, i + 1)
        for k, s in enumerate(title):
            f.text(x + 18, y + 76 + k * 22, s, size=17, weight=800, font=HEAD)
        for k, s in enumerate(subs):
            f.text(x + 18, y + 128 + k * 18, s, size=12.5, fill="var(--muted)")
    f.text(560, 210, "The test: if any answer is “that's a different service,” it's polyglot with a shared bill.",
           size=15, weight=600, fill="var(--ink)", anchor="middle")
    f.rect(18, 232, 1084, 174, fill="var(--cool-soft)", stroke="var(--cool)", sw=1.6, rx=12, name="benefit")
    f.text(40, 262, "ADDED BENEFIT", size=13, weight=700, fill="var(--cool)", font=MONO)
    f.text(40, 296, "One database to replicate, not five stores to keep in sync", size=22, weight=800, font=HEAD)
    f.text(40, 324, "Multi-region and multi-cloud get far simpler: one replication stream,", size=15, fill="var(--muted)")
    f.text(40, 344, "one failover plan, one consistency story.", size=15, fill="var(--muted)")
    f.text(40, 384, "“Tell the DBAs your app is ready for multi-region and multi-cloud.”", size=18, weight=800,
           fill="var(--cool)", font=HEAD)
    # replication glyph: one database, copies in another region and another cloud
    cx, top, bot, rw = 930, 280, 336, 30
    f.path(f"M{cx - rw},{top} V{bot} A{rw},9 0 0 0 {cx + rw},{bot} V{top}", [(cx - rw, top - 9), (cx + rw, bot + 9)],
           stroke="var(--cool)", sw=2, fill="var(--panel)", name="db", seg=False)
    f.raw(f'<ellipse cx="{cx}" cy="{top}" rx="{rw}" ry="9" fill="var(--panel)" stroke="var(--cool)" stroke-width="2"/>')
    f.text(cx, 372, "one database", size=12.5, weight=700, fill="var(--cool)", anchor="middle")
    for k, lab in enumerate(("region B", "cloud C")):
        by = 262 + k * 64
        f.rect(1004, by, 82, 36, fill="var(--panel)", stroke="var(--cool)", sw=1.4, rx=6, name=lab)
        f.text(1045, by + 23, lab, size=12.5, weight=600, fill="var(--ink)", anchor="middle")
        f.path(f"M{cx + rw + 2},{308} H976 V{by + 18} H1001", [(cx + rw + 2, 308), (976, by + 18), (1001, by + 18)],
               stroke="var(--cool)", sw=1.7, arrow=True, name="repl")
    return f.svg()


# ----------------------------------------------------------------------------- slide 44
QUESTIONS = [
    "Where is your canonical form?",
    "Which projected shapes do your consumers need?",
    "Which access dimensions, and how often?",
    "What is your projection latency?",
    "What consistency does your AI need?",
]


def fig_questions():
    f = Fig(1120, 404, "Five numbered questions to ask of any architecture; question four, projection latency, is marked as the quiet one")
    for i, q in enumerate(QUESTIONS):
        y = 18 + i * 74
        quiet = i == 3
        f.rect(18, y, 1084, 62, fill="var(--hot-soft)" if quiet else "var(--panel)",
               stroke="var(--hot)" if quiet else "var(--hairline)", sw=1.8 if quiet else 1.3, rx=10, name=q)
        disc(f, 58, y + 31, 21, i + 1, tone="hot" if quiet else "cool")
        f.text(98, y + 39, q, size=23, weight=800, font=HEAD)
        if quiet:
            f.text(1082, y + 38, "the quiet one", size=14, weight=700, fill="var(--hot)", anchor="end", font=MONO)
    return f.svg()


# ----------------------------------------------------------------------------- slide 45
def fig_cta():
    f = Fig(1120, 344, "The design review in three steps: bring your schema and slowest queries, we bake it off on your data, the numbers pick the model; then Workshop 3 and the companion repo")
    steps = [("Bring your schema", "and your five slowest queries"), ("We bake it off", "on your data, at your cardinality"),
             ("Numbers pick the model", "reads and writes, measured")]
    for i, (a, b) in enumerate(steps):
        x = 18 + i * 377
        f.rect(x, 18, 330, 96, fill="var(--panel)", stroke="var(--cool)", sw=1.8, rx=12, name=a)
        disc(f, x + 30, 48, 15, i + 1)
        f.text(x + 56, 55, a, size=19, weight=800, font=HEAD)
        f.text(x + 56, 84, b, size=14, fill="var(--muted)")
        if i < 2:
            f.line(x + 334, 66, x + 373, 66, stroke="var(--cool)", sw=2.6, arrow=True, name="next")
    nxt = [("Workshop 3 · the lab", ["“One restaurant, every model”: you build", "the projections yourself, hands-on."]),
           ("Companion repo · converged-modeling-patterns", ["Every pattern in this deck as runnable SQL,", "validated on Oracle AI Database 26ai Free."])]
    for i, (a, lines) in enumerate(nxt):
        x = 18 + i * 555
        f.rect(x, 136, 529, 100, fill="var(--panel)", stroke="var(--hairline)", sw=1.4, rx=10, name=a)
        f.raw(f'<rect x="{x}" y="136" width="4" height="100" rx="2" fill="var(--flow)"/>')
        f.text(x + 22, 164, a, size=16, weight=700, font=HEAD)
        for k, s in enumerate(lines):
            f.text(x + 22, 190 + k * 20, s, size=14, fill="var(--muted)")
    f.text(560, 282, "Model the domain, not the engine. Project the access.", size=26, weight=800, anchor="middle", font=HEAD)
    f.text(560, 318, "Measure the tradeoff. Don't argue it.", size=26, weight=800, fill="var(--cool)", anchor="middle", font=HEAD)
    return f.svg()



# Backup slide 46: incremental summary maintenance, trigger vs MV fast refresh on commit.
# Measured on 26ai Free (companion lab, scratch tables, insert-only readings, both exact,
# two runs averaged): per reading, redo bytes and microseconds, commit included.
MVCOST = {
    "1 reading per commit": [
        ("Trigger summary", [("base", 594, 18.5), ("bump", 375, 14.1)]),
        ("MV fast refresh on commit", [("base", 594, 18.5), ("log", 784, 47.3), ("refresh", 6639, 1273.1)]),
    ],
    "10 readings per commit": [
        ("Trigger summary", [("base", 333, 10.2), ("bump", 303, 9.5)]),
        ("MV fast refresh on commit", [("base", 333, 10.2), ("log", 715, 11.1), ("refresh", 1095, 131.0)]),
    ],
}
SEG_TONE = {"base": "muted", "bump": "cool", "log": "flow", "refresh": "hot"}


def fig_mvcost():
    f = Fig(960, 392, "Per-reading cost of keeping an hourly summary exact: a row trigger against a materialized view with fast refresh on commit, split into base insert, summary bump, view log and commit-time refresh, as redo bytes and microseconds at 1 and 10 readings per commit")
    panels = [(24, "REDO PER READING (BYTES)", 1, 8100, lambda v: f"{v:,.0f} B"),
              (488, "TIME PER READING (µs)", 2, 1350, lambda v: f"{v:,.0f} µs")]
    label_w, bar_w = 160, 208
    for px, title, idx, vmax, fmt in panels:
        f.text(px, 30, title, size=11, weight=600, fill="var(--faint)", font=MONO)
        y = 52
        for group, rows in MVCOST.items():
            f.text(px, y + 12, group, size=11.5, weight=600, fill="var(--muted)")
            y += 22
            for name, segs in rows:
                f.text(px, y + 17, name, size=12, fill="var(--ink)")
                x = px + label_w
                for kind, *vals in segs:
                    w = max(1.5, bar_w * vals[idx - 1] / vmax)
                    stroke, soft = TONE[SEG_TONE[kind]]
                    f.rect(x, y + 4, w, 18, fill=soft, stroke=stroke, sw=1, rx=2, name=f"seg-{kind}")
                    x += w
                total = sum(v[idx - 1] for _, *v in segs)
                f.text(x + 6, y + 17, fmt(total), size=12, weight=700, fill="var(--ink)")
                y += 30
            y += 10
    # key
    kx, ky = 24, 270
    for kind, lab in (("base", "base row insert"), ("bump", "trigger: summary-row bump"),
                      ("log", "MV log write"), ("refresh", "commit-time fast refresh")):
        stroke, soft = TONE[SEG_TONE[kind]]
        f.rect(kx, ky, 16, 14, fill=soft, stroke=stroke, sw=1, rx=2, name=f"key-{kind}")
        f.text(kx + 22, ky + 11.5, lab, size=11.5, fill="var(--muted)")
        kx += tw(lab, 11.5, SANS, 400) + 52
    # the two findings
    chip(f, 24, 306, "the MV log alone (+784 B) costs more than the whole trigger bump (+375 B)", tone="flow", size=12)
    chip(f, 24, 340, "1 per commit: 8× the redo, 40× the time · 10 per commit: 3.4× and 7.7×", tone="hot", size=12)
    return f.svg()

FIGS = {"catalog": fig_catalog, "cart": fig_cart, "bakeoff": fig_bakeoff, "proofs": fig_proofs,
        "ninetyten": fig_ninety_ten, "tests": fig_tests, "questions": fig_questions, "cta": fig_cta,
        "mvcost": fig_mvcost}


def main():
    s = DECK.read_text(encoding="utf-8")
    for name, fn in FIGS.items():
        svg = fn()
        pat = re.compile(rf"(<!-- ACT45FIG:{name} -->).*?(<!-- /ACT45FIG:{name} -->)", re.S)
        if not pat.search(s):
            sys.exit(f"marker ACT45FIG:{name} missing from deck")
        s = pat.sub(lambda m: m.group(1) + svg + m.group(2), s)
        print(f"{name}: ok")
    DECK.write_text(s, encoding="utf-8")


if __name__ == "__main__":
    main()
