"""Pattern 6: Outlier · brokerage books of business.

Scenario (illustrative): 40,000 advisors; 99% hold < 500 clients (p50 ~180); 0.3% (~120)
are institutional / team books of 20k–150k clients. Each embedded client entry is ~400 bytes
(id, name, AUM, as-of, risk band, last contact), so the 16 MB cap sits near ~40k clients; the
team spills at 20k clients per document (half the cap, headroom for growth).

Cost model on slide C (illustrative, stated in notes + figcaption) — work per top-100 book read:
  k(n)    = max(0, ceil(n / 20,000) - 1)             overflow documents
  embed(n) = 10 * (1 + k)                            document fetches
           + 0.01 * n                                every embedded client is read + decoded
           + (0.005 * n if k > 0)                    application-side merge-sort across buckets
  conv(n)  = 10                                      one query
           + 2 * log10(n)                            index descent on (advisor_id, aum DESC)
           + 0.25 * min(n, 100)                      rows returned + assembled (never free)
  break-even (no overflow yet): 0.01 n = 25 + 2 log10 n  ->  n ~= 3,200 clients per book
  p50 (180):  embed 11.8 vs conv 39.5   -> the embedded document is ~3x cheaper
  150k book:  embed 2,330 vs conv 45    -> ~50x the other way
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 6: Outlier"
FETCH = 10.0
PER_CLIENT = 0.01
MERGE = 0.005
BUCKET = 20000
PER_ROW = 0.25


def overflow_docs(n):
    return max(0, math.ceil(n / BUCKET) - 1)


def embed(n):
    k = overflow_docs(n)
    return FETCH * (1 + k) + PER_CLIENT * n + (MERGE * n if k else 0)


def conv(n):
    return FETCH + 2 * math.log10(n) + PER_ROW * min(n, 100)


MONO = "IBM Plex Mono, monospace"


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 372, "The advisor document as built: the client book embedded as an array, with a hasExtras flag for the books that overflow")
    lines = [
        "{",
        '  "_id": "A-900",',
        '  "name": "Institutional Desk 4",',
        '  "bookType": "team",',
        '  "hasExtras": true,',
        '  "clientCount": 148212,',
        '  "clients": [',
        '    { "id": "C-900001",',
        '      "name": "Harbor Pension Trust",',
        '      "aum": 912400000 },',
        '    { "id": "C-900002",',
        '      "aum": 887150000 },',
        "    ... 19,998 more ...",
        "  ]",
        "}",
    ]
    doc_panel(f, 18, 18, 330, lines, title="advisors · one document per book",
              hot={4, 9, 11}, size=11, lh=19.5,
              callouts=[(4, ["the 16 MB cap, leaked:", "128k more clients sit", "in 7 overflow docs"], "hot"),
                        (10, ["nightly AUM refresh", "rewrites the whole", "~8 MB document"], "hot")],
              callout_x=372)
    return f.svg()


def slide_a():
    rows = [
        ["My book: top 100 by AUM", "advisor portal", "~2k/s at the open", '<span class="pill">read</span>'],
        ["Add a client", "onboarding", "~30k / day", '<span class="pill">write</span>'],
        ["Nightly AUM refresh", "batch", "~17M clients / night", '<span class="pill hot">write · big doc</span>'],
        ["Advisor transition: move a book", "ops", "~50 books / week", '<span class="pill hot">write · big doc</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("40,000", "advisors"), ("~17M", "clients"), ("p50", "180 clients"), ("~120", "books &gt; 20k")])}
          {table(["Access pattern", "Who", "Rate", "Type"], rows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ('The whole story here is the shape of the distribution.<br><br>'
             "Not Pattern 1's firm: a brokerage, with 40,000 advisors and about 17 million clients. The median advisor has 180; 99% have fewer than 500. The numbers are illustrative. The shape is not.<br><br>"
             "The screen is 'my book, top 100 by AUM', opened a couple of thousand times a second at the open. So the clients are embedded in the advisor document: one read, sorted in the app. <strong>For 39,880 advisors that is exactly right.</strong><br><br>"
             "Then the tail: ~120 team books with 20,000 to 150,000 clients. At 400 bytes a client the cap lands near 40,000, so the team spills at 20,000 per document, sets hasExtras, and parks the rest in overflow documents. That's the Outlier pattern. The red pills, nightly AUM refresh and book moves, land in the biggest documents on the platform.<br><br>"
             '<em>Land: the pattern is honest. It admits the model breaks for the fat tail. The question is what that admission costs.</em>')
    return slide(label="Outlier: the problem", pattern=P, beat="A", clock="1:00 – 1:02",
                 title="Brokerage: 40,000 books of business, and 120 that don't fit",
                 lede="Every advisor's “my book” screen is one document with the client list embedded. For the median book of 180 clients that is perfect. Then the <strong>team books with 150,000 clients</strong> hit the 16 MB cap, and the <strong>Outlier pattern</strong> adds a flag, overflow documents and a branch.",
                 body=body,
                 takeaway="The pattern is built for the median book. <strong>The 16 MB cap becomes a flag, seven extra documents and an <code>if</code> in every reader</strong>, and the biggest documents take the most writes.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 440, "Canonical ERD of desk, advisor and client beside the typical one-document book and the institutional book split into overflow documents plus an application branch")
    f.text(24, 32, "CANONICAL FORM: A CLIENT IS ITS OWN ENTITY", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(640, 32, "THE SAME BOOK, AS DOCUMENTS", size=11, weight=600, fill="var(--faint)", font=MONO)
    ents = [
        dict(id="dsk", x=24, y=48, w=250, title="DESK", cols=[
            ("desk_id", "varchar2", "PK"), ("desk_name", "varchar2", ""), ("book_type", "varchar2", "")]),
        dict(id="adv", x=24, y=204, w=250, title="ADVISOR", cols=[
            ("advisor_id", "varchar2", "PK"), ("desk_id", "varchar2", "FK"), ("full_name", "varchar2", ""),
            ("region", "varchar2", "")]),
        dict(id="cli", x=330, y=120, w=260, title="CLIENT", tone="hot", cols=[
            ("client_id", "varchar2", "PK"), ("advisor_id", "varchar2", "FK"), ("full_name", "varchar2", ""),
            ("aum", "number", "hot"), ("aum_as_of", "date", "hot"), ("opened_on", "date", "snap")]),
    ]
    rels = [
        dict(a="dsk", a_side="b", a_card="one", b="adv", b_side="t", b_card="many"),
        dict(a="adv", a_side="r", a_row="advisor_id", a_card="one", b="cli", b_side="l", b_row="advisor_id",
             b_card="many", via=302),
    ]
    erd(f, ents, rels)
    f.text(330, 308, "INDEX (advisor_id, aum DESC)", size=11, weight=600, fill="var(--cool)", font=MONO)
    f.text(330, 326, "any book, any size: one range scan", size=11.5, fill="var(--muted)")
    # typical vs outlier
    f.box(640, 48, 296, 50, ["p50 advisor · 180 clients", "1 document · ~72 KB · one read"], tone="cool")
    f.box(640, 118, 296, 50, ["team book · 148k clients", "advisor doc: first 20k + hasExtras"], tone="hot")
    f.path("M788,168 V182 H690 V196", [(788, 168), (788, 182), (690, 182), (690, 196)],
           stroke="var(--hot)", sw=1.7, arrow=True)
    f.line(788, 182, 788, 196, stroke="var(--hot)", sw=1.7, arrow=True)
    f.path("M788,182 H886 V196", [(788, 182), (886, 182), (886, 196)], stroke="var(--hot)", sw=1.7, arrow=True)
    for bx, lab in ((640, "#part-2"), (738, "#part-3"), (836, "… #part-8")):
        f.box(bx, 198, 100 if bx == 836 else 90, 44, [lab, "20k clients"], tone="hot", size=12, sub_size=10.5)
    for x in (685, 783, 886):
        f.line(x, 242, x, 262, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(640, 264, 296, 56, ["application branch", "if hasExtras: 1 + 7 fetches, merge-sort"], tone="hot")
    f.box(640, 330, 296, 62, ["Relational projection", "1 query, any book", "same index range scan · no branch"], tone="cool")
    # legend
    f.rect(24, 404, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 416, "mutable: rewritten nightly, inside the biggest documents", size=11.5, fill="var(--muted)")
    f.rect(500, 404, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(522, 416, "immutable: safe to copy anywhere", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ('Drop the document boundary and the outlier stops being a special shape.<br><br>'
             'Left, the canonical form: desk, advisor, client. A client is its own entity; in the relational projection, a row with an advisor_id. Red is what moves: AUM and its as-of date nightly, advisor_id on a transition. Green is the honest exception: the open date never changes, so copy it anywhere.<br><br>'
             'Right, as documents: the median book is one ~72 KB document, one read, and it genuinely wins. The team book is the first 20,000 clients, a hasExtras flag, and seven overflow documents.<br><br>'
             "The bottom red box is the cost. <strong>The storage limit is now an if-statement in every reader</strong>: portal, batch, the AI assistant's context builder. Two code paths, and the rare one breaks.<br><br>"
             '<em>Land: the document boundary is a physical limit. When the book outgrows it, the limit becomes application code.</em>')
    return slide(label="Outlier: the model", pattern=P, beat="B", clock="1:02 – 1:03",
                 title="The book is rows; the document boundary is the outlier",
                 lede="A client is its own entity, stored <strong>once, as a row keyed by advisor</strong>: 180 rows or 148,000, same table, same index. The document model makes the book one physical object, so the fat tail becomes <strong>overflow documents and an application branch</strong>.",
                 body=body,
                 takeaway="<strong>Outliers exist only where a physical boundary is part of the model.</strong> Remove the boundary and a 148k-client book is just a longer range scan.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the book of business and a cost model of the embedded book versus an index range scan as clients per advisor grow")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.3, tone="cool", setting="Low: one book screen",
             lines=["portal and batch read the", "book the same way"]),
        dict(name="2 · Read / write", value=0.7, tone="cool", setting="Read-heavy by day",
             lines=["~2k reads/s at the open;", "one refresh storm a night"]),
        dict(name="3 · Update locality", value=0.9, tone="hot", setting="Skew ×800, p50 → max",
             lines=["writes land in the biggest", "documents on the platform"]),
    ])
    f.text(400, 28, "WORK PER TOP-100 BOOK READ vs BOOK SIZE · illustrative model", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    chart(f, (400, 58, 520, 236), (10, 2e5), (5, 5000),
          curves=[dict(name="Embedded book + overflow", fn=embed, tone="hot"),
                  dict(name="Rows · index range scan, top 100", fn=conv, tone="cool")],
          xlabel="clients per advisor (log)", ylabel="work units per read (log)",
          logx=True, logy=True, yticks=[10, 30, 100, 300, 1000, 3000],
          regions=[(10, 3200, "hot", "one document is cheaper"), (3200, 2e5, "cool", "range scan is cheaper")],
          points=[(180, "Embedded book + overflow", "p50 · 180 clients", 0, 20, "middle"),
                  (148000, "Embedded book + overflow", "team book · 148k", -10, 4, "end")],
          cross=("Embedded book + overflow", "Rows · index range scan, top 100"),
          cross_label=dict(lines=["break-even ≈ 3,200 clients"], dx=-12, dy=-14, anchor="end"),
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Illustrative cost model, not a benchmark: embedded = 10 per document fetch + 0.01 per client read (~400 B each), 20k-client overflow documents + 0.005/client app merge; rows = 10 + 2·log₁₀ n + 0.25 per row returned (≤ 100).</figcaption>
      </figure>"""
    notes = ('Two true things on one chart. The audience has to hear both.<br><br>'
             'The dials: diversity low, one screen, one read. Read/write leans read. On those, embed and move on. Knob three is red on purpose. The largest book is ~800 times the median, and the refresh and every transition land in those largest documents. Design for the p50, pay at the p99.9.<br><br>'
             'The model, out loud: the embedded book is one fetch plus decoding every client. Rows cost a query, an index descent and 100 assembled rows, real work every read. So at the median of 180 clients the document is about three times cheaper. Say it plainly. Break-even is near 3,200 clients, where 99% of advisors never go.<br><br>'
             '<strong>At 148,000 clients it is about fifty times the work</strong>: eight fetches, every client decoded, a merge-sort in the app. And that path runs for only 120 advisors, so it is the least tested.<br><br>'
             '<em>Land: the embedded book wins the median and loses the tail by fifty. The needle flips on the distribution, not the average.</em>')
    return slide(label="Outlier: where the knobs flip it", pattern=P, beat="C", clock="1:03 – 1:04",
                 title="Designed for the p50, paid for at the p99.9",
                 lede="For the median book of 180 clients, one embedded document is <strong>~3× cheaper</strong> than a range scan; the break-even is about <strong>3,200 clients</strong>. The ~120 team books sit 50× past it, where the read becomes 1 + k fetches and a merge in the app.",
                 body=body,
                 takeaway="The embedded book wins for 99% of advisors. Say so. <strong>At 148k clients it's ~50× the work and a second code path</strong> that only the 120 largest, most-written books exercise.",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 332, "Advisor and client tables feed a duality view for document consumers and one top-N query for the book screen, with no application branch")
    f.text(91, 30, "RELATIONAL PROJECTION", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(295, 30, "SAME ROWS, TWO READS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(482, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("adv", 18, 70, 148, 56, ["advisors", "one row each"])
    fl.node("cli", 18, 206, 148, 70, ["clients", "idx advisor_id,", "aum DESC"], tone="hot")
    fl.node("dv", 220, 56, 150, 88, ["advisor_dv", "duality view", "book as a document"], tone="cool")
    fl.node("top", 220, 204, 150, 88, ["top-N query", "FETCH FIRST ·", "OFFSET pages"], tone="cool")
    fl.node("crm", 420, 44, 122, 56, ["CRM", "Mongo API find()"], tone="flow")
    fl.node("ai", 420, 150, 122, 56, ["AI assistant", "SQL/JSON"], tone="flow")
    fl.node("book", 420, 256, 122, 56, ["Book screen", "SQL · any size"], tone="flow")
    fl.edge("adv", "dv", 193, tone="muted", by=90)
    fl.edge("cli", "dv", 193, tone="muted", ay=226, by=118)
    fl.edge("cli", "top", 193, tone="muted", ay=256, by=256)
    fl.edge("dv", "crm", 396, tone="flow", ay=80, by=72)
    fl.edge("dv", "ai", 396, tone="flow", ay=120, by=178)
    fl.edge("top", "book", 396, tone="flow", ay=270, by=284)
    return f.svg()


def slide_d():
    sql = ('<span class="k">CREATE JSON RELATIONAL DUALITY VIEW</span> advisor_dv <span class="k">AS</span>\n'
           "<span class=\"k\">SELECT JSON</span> { '_id'     : a.advisor_id,\n"
           "  'clients' : [ <span class=\"k\">SELECT JSON</span> { 'clientId' : c.client_id,\n"
           "                                'aum'      : c.aum <span class=\"k\">WITH UPDATE</span> }\n"
           "                <span class=\"k\">FROM</span> clients c <span class=\"k\">WITH INSERT UPDATE DELETE</span>\n"
           "                <span class=\"k\">WHERE</span> c.advisor_id = a.advisor_id ]\n"
           "} <span class=\"k\">FROM</span> advisors a <span class=\"k\">WITH INSERT UPDATE DELETE</span>;\n"
           '<span class="c">-- book screen: index (advisor_id, aum DESC), any book size</span>\n'
           '<span class="k">SELECT</span> client_id, aum <span class="k">FROM</span> clients <span class="k">WHERE</span> advisor_id = :advisor\n'
           '<span class="k">ORDER BY</span> aum <span class="k">DESC</span>\n'
           '<span class="k">OFFSET</span> :skip <span class="k">ROWS FETCH NEXT</span> 100 <span class="k">ROWS ONLY</span>;')
    ba = table(["", "Outlier pattern", "Rows + projection"], [
        ["Top 100, 148k book", '<span class="hot">8 fetches + app merge</span>', '<span class="cool">1 range scan, 100 rows</span>'],
        ["Top 100, 180-client book", "1 document (cheaper)", "range scan + assembly (~3× in model)"],
        ["Move a book", '<span class="hot">rewrite 2 books, may overflow</span>', '<span class="cool">1 UPDATE, 1 transaction</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When to flip back:</b> if the list has a hard upper bound (ten saved watchlists, five beneficiaries), embed it. The Outlier pattern is only needed when the bound is a guess. Growth costs too: +1 client to an 800-client book is ~20× a row insert's redo (companion lab).</div>
        </div>
        <div class="stack">
          {code(sql, "One table, one index, one query, no overflow branch")}
          {ba}
        </div>
      </div>"""
    notes = ("The converged answer doesn't patch the pattern. It deletes it: no flag, no overflow, no branch, because the book was never one physical object.<br><br>"
             'Two projections, one set of rows. Clients carry an index on advisor_id, AUM descending. That index is the whole trick. A duality view gives the CRM and AI assistant the book as a document over the MongoDB API or SQL/JSON. The book screen runs one top-N query with FETCH FIRST and OFFSET, the same statement for 180 clients or 148,000. The companion lab validates both on 26ai Free.<br><br>'
             "The optimizer adapts: a stopped range scan reads 100 index entries at 180 or 148,000. <strong>Cardinality is a statistic, not a code path.</strong> Be straight: at 180 the document was about three times cheaper in our model. That's the price of one code path.<br><br>"
             'Growth, measured on 26ai Free: one client added to an 800-client embedded book writes 20,196 bytes of redo across 15 block changes; one row insert, 1,000 to 1,100 bytes across 7 or 8. Roughly 20x. The spill itself is cheap. The bill is the growth rewrite before it, plus a branch in every reader. Moving a book is one UPDATE of advisor_id in one transaction, with no receiving document to cross the cap.<br><br>'
             '<em>Land: there is no fat tail when the row is the unit. The outlier is just more rows, and the optimizer plans for it.</em>')
    return slide(label="Outlier: the converged answer", pattern=P, beat="D", clock="1:04 – 1:05",
                 title="The outlier is just more rows: one query, no branch",
                 lede="Store each client as a row, index it by <strong>(advisor_id, aum DESC)</strong>, and project the book as a document with a <strong>duality view</strong> where a consumer wants one. The book screen pages with <code>FETCH FIRST</code> / <code>OFFSET</code>: the same statement for every advisor.",
                 body=body,
                 takeaway="The 16 MB cap never enters the model because the book was never one document. <strong>One code path for 40,000 advisors</strong>, paid for with a modest, predictable read cost at the median.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
