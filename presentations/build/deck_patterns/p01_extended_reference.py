"""Pattern 1: Extended Reference · wealth management (the exemplar for patterns 2–6).

Cost model on slide C (illustrative, stated in notes + figcaption):
  R  = 5e7 client-360 reads/day            (600/s average; 12k/s peak)
  embed(n)   = R * 1.00 + n * 2,700 * 3    (n advisor changes/day, 2,700 docs embed each card,
                                            3 work units per document rewrite)
  project(n) = R * 1.15 + n * 1 * 3        (duality view assembles the card on read: +15% read,
                                            one row updated per change)
  break-even: 0.15 R = n (8,100 - 3)  ->  n ~= 926 changes/day
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 1: Extended Reference"
R = 5e7
COPIES = 2700
REWRITE = 3.0


def embed(n):
    return R + n * COPIES * REWRITE


def project(n):
    return R * 1.15 + n * REWRITE


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 372, "The client document as built: the advisor card is copied into the client and into every account")
    lines = [
        "{",
        '  "_id": "C-104233",',
        '  "name": "Ada Okafor",',
        '  "segment": "HNW",',
        '  "advisor": {',
        '    "id": "A-317",',
        '    "name": "Grace Hopper",',
        '    "office": "Leeds",',
        '    "desk": "+44 113 555 0101"',
        "  },",
        '  "accounts": [',
        '    { "id": "ACC-88", "type": "ISA",',
        '      "advisor": { "id": "A-317",',
        '                   "office": "Leeds" } },',
        '    { "id": "ACC-91", "type": "GIA", ... }',
        "  ]",
        "}",
    ]
    doc_panel(f, 18, 18, 330, lines, title="clients · one document per client",
              hot={4, 5, 6, 7, 8, 9, 12, 13}, size=11, lh=17.5,
              callouts=[(4, ["advisor card, copied", "~790 client docs", "carry this copy"], "hot"),
                        (12, ["copied again per", "account: ~1,920", "more copies"], "hot")],
              callout_x=372)
    return f.svg()


def slide_a():
    rows = [
        ["Load client 360", "portal · copilot", "600/s avg · 12k/s peak", '<span class="pill">read</span>'],
        ["Render statements", "batch", "4.6M / night", '<span class="pill">read</span>'],
        ["Advisor office / desk change", "ops", "~300 / day", '<span class="pill hot">write · fan-out</span>'],
        ["Regional reorg: reassign advisors", "ops", "~8,000 in a day, 2× / yr", '<span class="pill hot">write · fan-out</span>'],
        ["Update client contact", "client", "~2k / day", '<span class="pill">write</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("2,400", "advisors"), ("1.9M", "clients"), ("4.6M", "accounts"), ("4", "consumers")])}
          {table(["Access pattern", "Who", "Rate", "Type"], rows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ("Go slowly. Every private bank has this problem; let the room see it first.<br><br>"
             "The platform: 2,400 advisors, 1.9 million clients, 4.6 million accounts. Four consumers render a client with their advisor: portal, advisor CRM, nightly statements, and now an AI copilot. The client 360 read dominates: 600 a second on average, 12,000 at the open, every screen showing the advisor's name, office and desk line.<br><br>"
             "So the team did the textbook thing, Extended Reference: copy the advisor card into every client and every account, since statements render per account. One read per screen, no $lookup. Now the red rows. Advisor edits are rare, about 300 a day. Twice a year, a regional reorg reassigns thousands in one day.<br><br>"
             "<em>Land: nothing on this slide is a mistake. It's a correct bet. The next three slides ask what that bet costs, and when it stops paying.</em>")
    return slide(label="Extended Reference: the problem", pattern=P, beat="A", clock="0:35 – 0:37",
                 title="Wealth management: one advisor card, 2,700 copies",
                 lede="Four consumers render every client with their advisor. To make each screen a single read, the team <strong>embedded the advisor card in every client and every account document</strong>: the Extended Reference pattern. Reads are instant. Now watch where the writes land.",
                 body=body,
                 takeaway="The reads are the whole reason for the pattern. <strong>The rare advisor edit is the whole cost</strong>: one change becomes ~2,700 document rewrites, and a reorg day multiplies it by thousands.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 440, "Canonical ERD of advisor, client, account, trade beside the fan-out of one advisor change across embedded copies")
    f.text(24, 32, "CANONICAL FORM: EACH FACT ONCE", size=11, weight=600, fill="var(--faint)", font="IBM Plex Mono, monospace")
    f.text(652, 32, "THE SAME FACT, EMBEDDED", size=11, weight=600, fill="var(--faint)", font="IBM Plex Mono, monospace")
    ents = [
        dict(id="adv", x=24, y=48, w=250, title="ADVISOR", tone="hot", cols=[
            ("advisor_id", "varchar2", "PK"), ("full_name", "varchar2", ""), ("office", "varchar2", "hot"),
            ("desk_phone", "varchar2", "hot"), ("region", "varchar2", "")]),
        dict(id="cli", x=24, y=248, w=250, title="CLIENT", cols=[
            ("client_id", "varchar2", "PK"), ("full_name", "varchar2", ""), ("segment", "varchar2", ""),
            ("advisor_id", "varchar2", "FK"), ("email", "varchar2", "")]),
        dict(id="acc", x=330, y=248, w=250, title="ACCOUNT", cols=[
            ("account_id", "varchar2", "PK"), ("client_id", "varchar2", "FK"), ("acct_type", "varchar2", ""),
            ("balance", "number", "")]),
        dict(id="trd", x=330, y=48, w=250, title="TRADE", cols=[
            ("trade_id", "varchar2", "PK"), ("account_id", "varchar2", "FK"), ("symbol", "varchar2", ""),
            ("quantity", "number", ""), ("exec_price", "number", "snap")]),
    ]
    rels = [
        dict(a="adv", a_side="b", a_card="one", b="cli", b_side="t", b_card="many"),
        dict(a="cli", a_side="r", a_row="client_id", a_card="one", b="acc", b_side="l", b_row="client_id",
             b_card="many", via=302),
        dict(a="acc", a_side="t", a_card="one", b="trd", b_side="b", b_card="many"),
    ]
    erd(f, ents, rels)
    # fan-out of one change
    f.box(660, 48, 264, 54, ["advisors · A-317", "office: Leeds → Manchester"], tone="hot")
    f.path("M792,102 V130 H722 V158", [(722, 102), (792, 158)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.path("M792,130 H862 V158", [(792, 130), (862, 158)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 160, 124, 62, ["790", "client docs"], tone="hot", size=16)
    f.box(800, 160, 124, 62, ["1,920", "account docs"], tone="hot", size=16)
    f.line(722, 222, 722, 250, stroke="var(--hot)", sw=1.7, arrow=True)
    f.line(862, 222, 862, 250, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 252, 264, 58, ["≈ 2,700 document rewrites", "per change · not one transaction"], tone="hot")
    f.box(660, 326, 264, 64, ["Relational projection", "1 row update · atomic", "every consumer sees it"], tone="cool")
    # legend
    f.rect(24, 404, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 416, "mutable reference data: copying it is what creates write amplification", size=11.5, fill="var(--muted)")
    f.rect(560, 404, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(582, 416, "immutable snapshot: safe to copy", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("Draw the domain the way Codd would and the tradeoff fits in one picture.<br><br>"
             "Left is the canonical form: advisor, client, account, trade, each fact once. Office and desk line are one fact each; the relational projection stores them in one row. Red rows are mutable reference data. The green row matters too: a trade's execution price is frozen at execution, so copying it isn't denormalisation. It's history, and Extended Reference is exactly right for it.<br><br>"
             "Right is the same fact embedded. A-317 moves from Leeds to Manchester: 790 client plus 1,920 account documents, about 2,700 rewrites, each re-serialising the whole thing. <strong>And it isn't one transaction.</strong> Mid-update, the portal says Leeds and the copilot says Manchester. Nothing crashes. The answers just disagree.<br><br>"
             "<em>Land: the pattern's real rule is 'copy what doesn't change'. The advisor card changes, so the copy is a liability we pay for on every edit.</em>")
    return slide(label="Extended Reference: the model", pattern=P, beat="B", clock="0:37 – 0:38",
                 title="Canonical form vs. the copy: where one edit lands",
                 lede="In canonical form the advisor's office is one fact; the relational projection stores it in <strong>one row</strong>. Extended Reference copies it into <strong>every client and account document</strong>. Copying the immutable costs nothing later; copying the mutable is write amplification.",
                 body=body,
                 takeaway="<strong>Snapshot the immutable, reference the mutable.</strong> The trade's execution price belongs in the document; the advisor's office does not.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the advisor card and a cost model of embedding versus projecting as advisor changes per day grow")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font="IBM Plex Mono, monospace")
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.8, tone="cool", setting="High: 4 consumers",
             lines=["portal, CRM, statements and", "copilot all read the card"]),
        dict(name="2 · Read / write", value=0.93, tone="cool", setting="Extreme read skew",
             lines=["5×10⁷ reads/day against", "~300 advisor edits/day"]),
        dict(name="3 · Update locality", value=0.82, tone="hot", setting="Rare, fans out ×2,700",
             lines=["each edit lands on every", "document that copied it"]),
    ])
    f.text(400, 28, "DAILY WORK vs ADVISOR CHANGES / DAY · illustrative model", size=11, weight=600,
           fill="var(--faint)", font="IBM Plex Mono, monospace")
    chart(f, (400, 58, 520, 236), (10, 1e5), (4e7, 1.2e9),
          curves=[dict(name="Embed the card", fn=embed, tone="hot"),
                  dict(name="Project it · duality view, +15% read", fn=project, tone="cool")],
          xlabel="advisor changes per day (log)", ylabel="work units per day (log)",
          logx=True, logy=True, yticks=[5e7, 1e8, 2e8, 5e8, 1e9],
          regions=[(10, 926, "hot", "embedding is cheaper"), (926, 1e5, "cool", "projection is cheaper")],
          points=[(300, "Embed the card", "normal day · 300", 0, 17, "middle"),
                  (8000, "Embed the card", "reorg day · 8,000", 12, 20, "start")],
          cross=("Embed the card", "Project it · duality view, +15% read"),
          cross_label=dict(lines=["break-even ≈ 930 / day"], dx=-12, dy=-13, anchor="end"),
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption><b style="color:var(--ink)">Both models run on Oracle. The flip point is where the document tax starts.</b><br>Illustrative cost model, not a benchmark: 5×10⁷ client reads/day; projecting the card adds ~15% to each read; each document rewrite costs 3 work units; ~2,700 documents embed each advisor.</figcaption>
      </figure>"""
    notes = ("The knobs earn their keep here, and the honest answer isn't 'always normalise'.<br><br>"
             "Dials first. Diversity: four consumers. Read/write is extreme: 50 million reads a day against about 300 edits. On those two knobs, embed. Knob three is red: each rare edit lands on about 2,700 documents, and that multiplier decides the model.<br><br>"
             "Say the model out loud. Embedding: one document read per screen, 2,700 rewrites per change. Projecting: about 15% more per read (the duality view joins the advisor row by primary key), one row per change. The join is not free; that 15% lands on every read. <strong>On a normal day, 300 changes, embedding is cheaper.</strong> Say it plainly. Break-even is about 930 a day.<br><br>"
             "Both curves are Oracle (see the caption): embedding is a JSON collection on the same engine. Shape, not vendor. The flip point is where the document tax starts. Left of it the copy is cheaper; right of it every extra edit is paid about 2,700 times. Further right means more write amplification before you join, and replicas, backups and change feeds pay every rewrite again. That's higher TCO (total cost of ownership). A cheaper join path, from the optimizer and the duality view, moves the flip point left. Left is cheaper.<br><br>"
             "Reorg day: 8,000 changes. Write work 2,700 times larger, the day's work doubled, and 22 million non-atomic rewrites while the copilot answers from half-updated data.<br><br>"
             "<em>Land: the needle doesn't flip on the average day. It flips on the worst day, and on correctness. Model for the reorg, not the Tuesday.</em>")
    return slide(label="Extended Reference: where the knobs flip it", pattern=P, beat="C", clock="0:38 – 0:39",
                 title="The needle flips on reorg day, not on an average Tuesday",
                 lede="Two knobs say embed: <strong>four consumers</strong> and <strong>fifty million reads a day</strong>. The third knob, where the update lands, says every edit touches ~2,700 documents. Put a number on it and the break-even is about <strong>930 changes a day</strong>.",
                 body=body,
                 takeaway="On a normal day embedding is cheaper: the projection's read cost is real. <strong>On reorg day the day's work doubles and it's 22M non-atomic rewrites.</strong> Model for the day that hurts.",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
# A step-through (deck builds: data-step / data-step-end, see the deck's "Builds" JS). Build keys
# follow the brief: base = 1 tables · 2 view · 3 read · 4 allowed write · 5 rejected write ·
# 6 one-row UPDATE · 7 close. Every statement and the ORA-40940 text below were run on the lab
# container (26ai Free, scratch schema) with this exact view definition from
# converged-modeling-patterns/patterns/01-extended-reference/02-converged.sql.
K = lambda w: f'<span class="k">{w}</span>'  # noqa: E731
S = lambda w: f'<span class="s">{w}</span>'  # noqa: E731


def _swap(old, new, at):
    return (f'<span class="swap"><span data-step-end="{at - 1}">{old}</span>'
            f'<span data-step="{at}" class="chg">{new}</span></span>')


def _dv_tables():
    return f"""<div>
            <p class="col-label">1 · Relational projection: each fact once</p>
            <p class="dv-tname">xr_advisors</p>
            <table class="dv-t"><thead><tr><th>advisor_id</th><th>full_name</th><th>office</th><th>desk</th></tr></thead><tbody>
              <tr class="dv-a317"><td class="id">A-317</td><td>Grace Hopper</td><td>{_swap("Leeds", "<b>Manchester</b>", 6)}</td><td class="id">x0101</td></tr>
              <tr><td class="id">A-402</td><td>Alan Turing</td><td>York</td><td class="id">x0144</td></tr>
            </tbody></table>
            <p class="dv-one">The advisor's office lives in ONE row.</p>
            <p class="dv-tname">xr_clients</p>
            <table class="dv-t"><thead><tr><th>client_id</th><th>full_name</th><th>segment</th><th>primary_advisor_id</th></tr></thead><tbody>
              <tr class="dv-c1"><td class="id">C-104233</td><td>{_swap("Ada Okafor", "<b>Ada Okafor-Reid</b>", 4)}</td><td>HNW</td><td class="id">A-317</td></tr>
              <tr><td class="id">C-104871</td><td>Ben Adeyemi</td><td>MASS</td><td class="id">A-317</td></tr>
              <tr><td class="id">C-105002</td><td>Cara Lindqvist</td><td>HNW</td><td class="id">A-402</td></tr>
            </tbody></table>
          </div>"""


def _dv_view():
    L = lambda cls, t: f'<span class="ln {cls}">{t}</span>'  # noqa: E731
    code = "".join([
        L("", f"{K('CREATE JSON RELATIONAL DUALITY VIEW')}"),
        L("", f"  xr_client_dv {K('AS')} {K('SELECT JSON')} {{"),
        L("", "  '_id'      : c.client_id,"),
        L("up l-fn", f"  'fullName' : c.full_name {K('WITH UPDATE')},"),
        L("up", f"  'segment'  : c.segment   {K('WITH UPDATE')},"),
        L("nu", f"  'advisor'  : ( {K('SELECT JSON')} {{"),
        L("nu", "      'advisorId' : a.advisor_id,"),
        L("nu", "      'fullName'  : a.full_name,"),
        L("nu", "      'office'    : a.office,"),
        L("nu", "      'desk'      : a.desk }"),
        L("nu", f"    {K('FROM')} xr_advisors a {K('WITH NOUPDATE')}"),
        L("nu", f"    {K('WHERE')} a.advisor_id = c.primary_advisor_id )"),
        L("", f"}} {K('FROM')} xr_clients c {K('WITH INSERT UPDATE DELETE')};"),
    ])
    return f"""<div data-step="2">
            <p class="col-label cool">2 · The duality view: the lab's exact definition</p>
            <pre class="code">{code}</pre>
            <ul class="dv-legend">
              <li class="ok">Can change: <b>fullName</b>, <b>segment</b>; add or delete a client</li>
              <li class="no">Can't change: anything under <b>advisor</b> (read-only here)</li>
            </ul>
          </div>"""


def _dv_doc():
    C = '<span style="color:var(--ink)">,</span>'
    L = lambda cls, t: f'<span class="ln {cls}">{t}</span>'  # noqa: E731
    code = "".join([
        L("", "{"),
        L("", f'  "_id": {S(chr(34) + "C-104233" + chr(34))},'),
        L("j-fn", f'  "fullName": {S(_swap(chr(34) + "Ada Okafor" + chr(34) + C, chr(34) + "Ada Okafor-Reid" + chr(34) + C, 4))}'),
        L("", f'  "segment": {S(chr(34) + "HNW" + chr(34))},'),
        L("", '  "advisor": {'),
        L("", f'    "advisorId": {S(chr(34) + "A-317" + chr(34))},'),
        L("", f'    "fullName": {S(chr(34) + "Grace Hopper" + chr(34))},'),
        L("j-of", f'    "office": {S(_swap(chr(34) + "Leeds" + chr(34) + C, chr(34) + "Manchester" + chr(34) + C, 6))}'),
        L("", f'    "desk": {S(chr(34) + "x0101" + chr(34))}'),
        L("", "  }"),
        L("", "}"),
    ])
    return f"""<div data-step="3">
            <p class="col-label flow">3 · Read it: one client document</p>
            <pre class="code">{code}</pre>
            <p class="dv-also" data-step="6">C-104871 (also A-317) now reads <b>Manchester</b> too, in the same commit.</p>
          </div>"""


def _dv_actions():
    get = (f"{K('SELECT')} data {K('FROM')} xr_client_dv {K('WHERE')} "
           f"{K('JSON_VALUE')}(data, {S(chr(39) + '$._id' + chr(39))}) = {S(chr(39) + 'C-104233' + chr(39))};")

    def upd(path, val):
        return (f"{K('UPDATE')} xr_client_dv {K('SET')} data = {K('JSON_TRANSFORM')}(data, {K('SET')} "
                f"{S(chr(39) + path + chr(39))} = {S(chr(39) + val + chr(39))})\n {K('WHERE')} "
                f"{K('JSON_VALUE')}(data, {S(chr(39) + '$._id' + chr(39))}) = {S(chr(39) + 'C-104233' + chr(39))};")
    sql6 = (f"{K('UPDATE')} xr_advisors {K('SET')} office = {S(chr(39) + 'Manchester' + chr(39))} "
            f"{K('WHERE')} advisor_id = {S(chr(39) + 'A-317' + chr(39))};")
    err = ("ORA-40940: Cannot update field 'office' corresponding to column 'OFFICE' of table 'XR_ADVISORS' "
           "in JSON Relational Duality View 'XR_CLIENT_DV': Missing UPDATE annotation or NOUPDATE annotation specified.")
    return f"""<div class="stepstack">
          <div class="dv-act" data-step="3" data-step-end="3">
            <pre class="req">{get}</pre>
            <p class="res"><b>Read:</b> the advisor block is assembled from the one <b>xr_advisors</b> row at read time: a primary-key join on every read. Nothing was copied.</p>
          </div>
          <div class="dv-act ok" data-step="4" data-step-end="4">
            <pre class="req">{upd("$.fullName", "Ada Okafor-Reid")}</pre>
            <p class="res"><b>✓ 1 row updated</b>: the <b>xr_clients</b> row for C-104233. No other row is touched.</p>
          </div>
          <div class="dv-act bad" data-step="5" data-step-end="5">
            <pre class="req">{upd("$.advisor.office", "Manchester")}</pre>
            <p class="err">{err}</p>
            <p class="res"><b>✗ Rejected, whole statement.</b> The advisor is read-only in this view; its office changes only in its own row.</p>
          </div>
          <div class="dv-act ok" data-step="6" data-step-end="6">
            <pre class="req">{sql6}</pre>
            <p class="res"><b>✓ 1 row · 1 transaction.</b> Every A-317 client document now shows Manchester at the same commit, with no eventual consistency.</p>
          </div>
          <div class="dv-close" data-step="7">
            <div class="side"><span class="big hot">~2,700</span><span class="lbl">document rewrites per office move, embedded</span></div>
            <div class="mid">from eventual consistency<br>to atomic</div>
            <div class="side r"><span class="lbl">row, one transaction, duality view</span><span class="big cool">1</span></div>
          </div>
        </div>"""


def slide_d():
    body = f"""      <div class="dv">
        <div class="dv-grid">
          {_dv_tables()}
          {_dv_view()}
          {_dv_doc()}
        </div>
        {_dv_actions()}
      </div>"""
    step = lambda n, t: f'<span data-note-step="{n}">{t}</span>'  # noqa: E731
    notes = ("The converged answer isn't 'normalise and make developers write joins'. <strong>The developer keeps the exact document they asked for, and the view decides what a write can touch.</strong> Seven clicks.<br><br>"
             + step(0, "Build 1, the tables: the relational projection, advisors and clients stored once. Point at Leeds: the office lives in ONE row, and clients reach it through primary_advisor_id, a foreign key, not a copy.") + "<br><br>"
             + step(2, "Build 2, the view, verbatim from the lab (patterns/01-extended-reference/02-converged.sql). fullName and segment are WITH UPDATE. The advisor subquery is WITH NOUPDATE: a reference the view reads, not a copy it owns. The root is WITH INSERT UPDATE DELETE, so whole client documents are created and removed through it.") + "<br><br>"
             + step(3, "Build 3, the read: the advisor block inline, assembled from the one advisors row. (The real result also carries a _metadata etag for optimistic locking, trimmed here.) Be straight about the price: a primary-key join on every read, about 15% more read work in our model. The join is not free; here it buys atomic reorgs. The portal calls find() on xr_client_dv via its MongoDB driver, the copilot reads SQL/JSON, statements use plain SQL; the lab proves MongoDB-API and SQL reads byte-identical.") + "<br><br>"
             + step(4, "Build 4, an allowed write: JSON_TRANSFORM sets fullName. Verified: 1 row updated, the xr_clients row for C-104233, nothing else.") + "<br><br>"
             + step(5, "Build 5, the refused write. Aim it at advisor.office and you get ORA-40940: 'Cannot update field office corresponding to column OFFICE of table XR_ADVISORS in JSON Relational Duality View XR_CLIENT_DV: Missing UPDATE annotation or NOUPDATE annotation specified.' Bundle it with fullName in one JSON_TRANSFORM and, verified, the whole statement is rejected; fullName doesn't sneak through. Per-field governance by the engine, not code review. For Q&amp;A: changing advisor.advisorId IS allowed. It re-points primary_advisor_id and never edits the advisor row.") + "<br><br>"
             + step(6, "Build 6, the reorg: one SQL UPDATE on xr_advisors, one row, one transaction. Both A-317 client documents read Manchester at the same commit, verified; the A-402 client still reads York.") + "<br><br>"
             + step(7, "Build 7: about 2,700 rewrites (790 client plus 1,920 account documents) against one row. Eventual becomes atomic.") + "<br><br>"
             "Side-by-side, if asked: a client 360 read is 1 document fetch against 1 assembled by PK join; reorg day, 8,000 changes, is about 22 million rewrites against 8,000 rows. And when to flip back: if a value must be frozen at write time (a trade's execution price, the advisor of record on a signed statement), snapshot it. That's history, not denormalisation: the green row from the ERD.<br><br>"
             "<em>Land: same document, same driver, same find(). The write went from 2,700 documents to one row, and the view decides what a write can touch.</em>")
    return f"""  <section class="slide pat" aria-label="Extended Reference: the converged answer">
    <div class="eyebrow"><span>Act 3 · {P} · D. The converged answer</span><span class="clock">0:39 – 0:40</span></div>
    <h2>Project the mutable: same document, one row to change</h2>
    <p class="lede">A <strong>duality view</strong> serves the document and decides what a write can touch.</p>
    <div class="body">
{body}
    </div>
  <aside class="notes" hidden>{notes}</aside>
  </section>"""


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
