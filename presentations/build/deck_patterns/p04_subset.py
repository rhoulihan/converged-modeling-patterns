"""Pattern 4: Subset · P&C insurance.

Scenario (illustrative): 8M policies; the policy document keeps the 10 most recent claim
events inline for the summary page, full history in a separate collection. ~30k claim
events/day, ~2M summary reads/day, ~5k full-history reads/day (equal cost in both models,
so it drops out of the comparison).

Cost model on slide C (illustrative, stated in notes + figcaption):
  R = 2e6 policy-summary reads/day
  subset(n) = R * 1.00 + n * (6 + 2)   (n claim events/day; each event rewrites the policy
                                         document — push, sort, trim, re-serialise: 6 units —
                                         and inserts the event into history: 2 units)
  query(n)  = R * 1.25 + n * 2         (summary assembled on read: policy row + index range
                                         scan FETCH FIRST 10 = +25% per read; each event is
                                         one row insert + one index entry: 2 units)
  break-even: 0.25 R = 6 n  ->  n ~= 83,000 events/day
  normal day 30k/day: subset cheaper (2.24M vs 2.56M units)
  CAT day 300k/day:  query cheaper (3.1M vs 4.4M units)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 4: Subset"
R = 2e6
DOC_REWRITE = 6.0
ROW_INSERT = 2.0
READ_PREMIUM = 0.25
BREAK_EVEN = READ_PREMIUM * R / DOC_REWRITE  # ~83,333 events/day
MONO = "IBM Plex Mono, monospace"


def subset(n):
    return R + n * (DOC_REWRITE + ROW_INSERT)


def query(n):
    return R * (1 + READ_PREMIUM) + n * ROW_INSERT


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 372, "The policy document as built: the ten most recent claim events inline, every event also written to a separate history collection")
    lines = [
        "{",
        '  "_id": "POL-7730142",',
        '  "holder": "R. Alvarez",',
        '  "product": "HOME",',
        '  "coverages": [ ... ],',
        '  "recentEvents": [',
        '    { "claim": "CLM-5581", "type": "PAYMENT",',
        '      "amount": 2400, "ts": "09-27T14:02" },',
        '    { "claim": "CLM-5581", "type": "NOTE" },',
        "    ... 8 more · sorted · trimmed to 10",
        "  ]",
        "}",
    ]
    doc_panel(f, 18, 18, 330, lines, title="policies · one document per policy",
              hot={5, 6, 7, 8, 9, 10}, size=11, lh=17.5,
              callouts=[(5, ["rewritten on every event", "$push · $sort · $slice: 10", "~30k times a day"], "hot")],
              callout_x=372)
    hist = [
        '{ "_id": "EV-90311", "policy": "POL-7730142",',
        '  "claim": "CLM-5581", "type": "PAYMENT" }',
    ]
    doc_panel(f, 18, 284, 330, hist, title="claim_history · one document per event",
              hot={0, 1}, size=11, lh=17.5,
              callouts=[(0, ["…and a second write", "same event, another place", "to keep in step"], "hot")],
              callout_x=372)
    return f.svg()


def slide_a():
    rows = [
        ["Record a claim event", "adjusters · ops", "~30k / day", '<span class="pill hot">write · hot doc</span>'],
        ["Policy summary page", "agents · app", "~2M / day", '<span class="pill">read</span>'],
        ["Full claim history", "adjusters · audit", "~5k / day", '<span class="pill">read · 2nd query</span>'],
        ["Fraud review across claims", "SIU analysts", "nightly", '<span class="pill">read · cross-doc</span>'],
        ["Catastrophe (CAT) surge", "claims ops", "~300k / day", '<span class="pill hot">write · hot doc</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("8M", "policies"), ("10", "events inline"), ("30k", "events / day"), ("4", "consumers")])}
          {table(["Access pattern", "Who", "Rate", "Type"], rows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ("Every P&amp;C carrier has this screen: the policy summary with the last few things that happened on a claim. Let the room recognise it first.<br><br>"
             "The book is 8 million policies. A claim is a stream: first notice of loss, adjuster notes, reserves, payments, status changes. About 30,000 events on a normal day. Agents and the customer app open the summary about 2 million times a day for the 10 most recent. Full history opens maybe 5,000 times a day, for adjusters and audit.<br><br>"
             "So, the textbook move: hot 10 inline, cold tail in history, one read per summary. Now the red. Every event runs $push, $sort, $slice, rewrites the policy document, then inserts into history. Two writes, two places, one fact. Last row: a hurricane lands and events jump tenfold in a day.<br><br>"
             "<em>Land: the pattern is a bet that the summary read dwarfs the event write. Hold that thought: the next slides put a number on the bet.</em>")
    return slide(label="Subset: the problem", pattern=P, beat="A", clock="0:50 – 0:52",
                 title="Insurance: ten claim events inline, rewritten on every event",
                 lede="Agents and the customer app open the policy summary <strong>2M times a day</strong>. To make it one read, the team kept the <strong>10 most recent claim events inline</strong> and the full history in a second collection: the Subset pattern. Now watch the write path.",
                 body=body,
                 takeaway="The summary read is why the pattern exists. <strong>Every claim event pays for it twice</strong>: a push-sort-trim rewrite of the policy document plus a history insert, in two places that must agree.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 456, "Canonical ERD of policy, claim and claim event beside how one claim event lands in the subset model versus the canonical form")
    f.text(24, 32, "CANONICAL FORM: EACH EVENT ONCE", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(660, 32, "ONE CLAIM EVENT, TWO MODELS", size=11, weight=600, fill="var(--faint)", font=MONO)
    ents = [
        dict(id="pol", x=24, y=48, w=250, title="POLICY", cols=[
            ("policy_id", "varchar2", "PK"), ("holder", "varchar2", ""), ("product", "varchar2", ""),
            ("premium", "number", ""), ("status", "varchar2", "")]),
        dict(id="clm", x=346, y=48, w=250, title="CLAIM", cols=[
            ("claim_id", "varchar2", "PK"), ("policy_id", "varchar2", "FK"), ("loss_date", "date", "snap"),
            ("status", "varchar2", "hot"), ("reserve", "number", "hot")]),
        dict(id="evt", x=204, y=250, w=236, title="CLAIM_EVENT · append-only", tone="cool", cols=[
            ("event_id", "varchar2", "PK"), ("claim_id", "varchar2", "FK"), ("policy_id", "varchar2", "FK"),
            ("event_type", "varchar2", "snap"), ("amount", "number", "snap"), ("event_ts", "timestamp", "snap")]),
    ]
    rels = [
        dict(a="pol", a_side="r", a_row="policy_id", a_card="one", b="clm", b_side="l", b_row="policy_id",
             b_card="many", via=310),
        dict(a="evt", a_side="l", a_row="policy_id", a_card="many", b="pol", b_side="b", b_card="one"),
        dict(a="evt", a_side="r", a_row="claim_id", a_card="many", b="clm", b_side="b", b_card="one"),
    ]
    erd(f, ents, rels)
    f.box(460, 346, 170, 58, ["INDEX", "policy_id, event_ts DESC"], tone="cool", size=12, sub_size=11)
    # one event in the subset model
    f.box(660, 48, 276, 50, ["claim event · CLM-5581", "payment · $2,400"], tone="hot")
    f.path("M798,98 V122 H728 V148", [(798, 98), (798, 122), (728, 122), (728, 148)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.path("M798,122 H868 V148", [(798, 122), (868, 122), (868, 148)], stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 150, 136, 74, ["policy doc", "push · sort · trim", "whole doc rewritten"], tone="hot", size=14, sub_size=11)
    f.box(806, 150, 130, 74, ["history doc", "insert full event", "second place"], tone="hot", size=14, sub_size=11)
    f.line(728, 224, 728, 250, stroke="var(--hot)", sw=1.7, arrow=True)
    f.line(871, 224, 871, 250, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 252, 276, 58, ["2 writes, 2 places, per event", "the hot doc absorbs every one"], tone="hot")
    f.box(660, 330, 276, 80, ["Relational projection", "1 row insert + 1 index entry", "the recent 10 is derived on read,", "not maintained"], tone="cool")
    # legend
    f.rect(24, 424, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 436, "mutable claim state: updated in place", size=11.5, fill="var(--muted)")
    f.rect(360, 424, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(382, 436, "immutable event facts: append once, never rewritten", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("Draw the domain canonically and it jumps out: the write is an immutable event, and the document model turns it into a mutation.<br><br>"
             "Left, the logical model: policy, claim, claim event. A claim's status and reserve mutate, the red rows. Its events are facts, the green rows: append once, never rewritten. The index is the whole trick: policy_id, event_ts descending. A policy's latest ten already sit in order at the front of that range.<br><br>"
             "Right, one payment in the subset model lands on two documents. The policy document is re-sorted, trimmed and rewritten whole; history gets the event. If the second write fails, summary and history disagree. And every event on every claim hits that one policy document: the hottest in the system, hot because of a list nobody asked you to store.<br><br>"
             "<em>Land: the recent ten is a query, not a fact. Model the fact once, insert it once as a row, and derive the list.</em>")
    return slide(label="Subset: the model", pattern=P, beat="B", clock="0:52 – 0:53",
                 title="An append-only event, turned into a document rewrite",
                 lede="Canonically a claim event is an <strong>immutable fact, inserted once</strong>. The Subset pattern turns it into <strong>two writes</strong>: a push-sort-trim rewrite of the policy document and a history insert, to maintain a list an index could simply read.",
                 body=body,
                 takeaway="<strong>The recent ten is a query, not a fact.</strong> Store the event once; a (policy_id, event_ts DESC) index keeps it pre-sorted. The price is one index entry per insert and a short range scan per read.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the policy summary and a cost model of maintaining the subset versus querying it as claim events per day grow")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.75, tone="cool", setting="High: 4 consumers",
             lines=["agents, customer app, adjusters", "and fraud all read claim events"]),
        dict(name="2 · Read / write", value=0.8, tone="cool", setting="Read-heavy, ~67 : 1",
             lines=["2M summary reads/day against", "~30k claim events/day"]),
        dict(name="3 · Update locality", value=0.86, tone="hot", setting="Every event hits the parent",
             lines=["each event rewrites the policy", "doc and writes history too"]),
    ])
    f.text(400, 28, "DAILY WORK vs CLAIM EVENTS / DAY · illustrative model", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    a, b = "Subset · push + trim + history", "Query it · FETCH FIRST 10, +25% read"
    chart(f, (400, 58, 520, 236), (3e3, 1e6), (1.6e6, 1.2e7),
          curves=[dict(name=a, fn=subset, tone="hot"), dict(name=b, fn=query, tone="cool")],
          xlabel="claim events per day (log)", ylabel="work units per day (log)",
          logx=True, logy=True, yticks=[3e6, 5e6, 1e7],
          regions=[(3e3, BREAK_EVEN, "hot", "the Subset pattern is cheaper"), (BREAK_EVEN, 1e6, "cool", "querying is cheaper")],
          points=[(30000, a, "normal day · 30k", 0, 20, "middle"),
                  (300000, a, "CAT day · 300k", -10, -4, "end")],
          cross=(a, b),
          cross_label=dict(lines=["break-even ≈ 83k / day"], dx=12, dy=24, anchor="start"),
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Illustrative cost model, not a benchmark: 2×10⁶ summary reads/day; assembling the summary on read (policy row + index range scan, FETCH FIRST 10) adds ~25% per read; a policy-document rewrite costs 6 work units, a row or document insert 2; full-history reads cost the same in both models.</figcaption>
      </figure>"""
    notes = ("Be honest here. <strong>On a normal day, the Subset pattern wins.</strong> The room won't expect that.<br><br>"
             "The dials: four consumers read claim events, so diversity is high, and reads beat writes about 67 to 1. Both say keep the pattern. Knob three is red: every event, on every claim, lands on the parent policy document.<br><br>"
             "Subset: one document per summary read, plus a rewrite and a history insert per event. Query: about 25% more per read (a policy row and an index range scan that stops after ten rows), plus one row and one index entry per event. That 25% is real on two million reads. At 30,000 events, Subset is cheaper. Break-even is near 83,000 a day.<br><br>"
             "Then a hurricane lands: 300,000 events in a day, on the policies in its path. Subset now costs about 40% more than querying, and every write rewrites a whole document the app is hammering.<br><br>"
             "<em>Land: size the model for the storm, not the sunny day. The day you need claims to be fast is the day the Subset pattern is slowest.</em>")
    return slide(label="Subset: where the knobs flip it", pattern=P, beat="C", clock="0:53 – 0:54",
                 title="The Subset pattern wins on sunny days, not in storms",
                 lede="Two knobs favour the Subset pattern: <strong>four consumers</strong> and a <strong>67 : 1 read skew</strong>. The third (every event rewrites the parent) sets the price. Break-even is about <strong>83k events a day</strong>; a CAT day runs at 300k.",
                 body=body,
                 takeaway="At 30k events a day the Subset pattern is cheaper: the query's read premium is real. <strong>On a CAT day it costs ~40% more, all of it on the hottest documents.</strong>",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 332, "Tables, the relational projection, and a descending composite index feed a policy summary query and a full history query that serve agents, adjusters and fraud over SQL/JSON and SQL")
    f.text(91, 30, "RELATIONAL PROJECTION", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(295, 30, "SAME ROWS, TWO READS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(482, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("pol", 18, 44, 148, 56, ["policies", "header, once"])
    fl.node("evt", 18, 150, 148, 56, ["claim_events", "append · DESC index"], tone="cool")
    fl.node("clm", 18, 256, 148, 56, ["claims", "status · reserve"])
    fl.node("sum", 220, 70, 150, 78, ["policy summary", "SQL/JSON", "FETCH FIRST 10"], tone="cool")
    fl.node("his", 220, 208, 150, 78, ["full history", "same query,", "no FETCH FIRST"], tone="cool")
    fl.node("app", 420, 44, 122, 56, ["Agents · app", "SQL/JSON doc"], tone="flow")
    fl.node("adj", 420, 150, 122, 56, ["Adjusters", "SQL · audit"], tone="flow")
    fl.node("fr", 420, 256, 122, 56, ["Fraud review", "SQL analytics"], tone="flow")
    fl.edge("pol", "sum", 193, tone="muted", by=96)
    fl.edge("evt", "sum", 204, tone="muted", by=128)
    fl.edge("evt", "his", 204, tone="muted", by=236)
    fl.edge("clm", "his", 193, tone="muted", by=266)
    fl.edge("sum", "app", 396, tone="flow", ay=100, by=72)
    fl.edge("his", "adj", 396, tone="flow", ay=236, by=178)
    fl.edge("his", "fr", 406, tone="flow", ay=258, by=284)
    return f.svg()


def slide_d():
    K = lambda w: f'<span class="k">{w}</span>'
    sql = (f"{K('CREATE INDEX')} ce_recent {K('ON')} claim_events (policy_id, event_ts {K('DESC')});\n"
           f"{K('INSERT INTO')} claim_events {K('VALUES')} (:ev, :clm, :pol, <span class=\"s\">'PAYMENT'</span>, 2400, {K('SYSTIMESTAMP')});\n"
           '<span class="c">-- \u2191 the whole write.  \u2193 the policy summary, assembled on read</span>\n'
           f"{K('SELECT JSON_OBJECT')}('policyId' {K('VALUE')} p.policy_id,\n"
           f"  'recentEvents' {K('VALUE')} ({K('SELECT JSON_ARRAYAGG')}(\n"
           f"      {K('JSON_OBJECT')}('type' {K('VALUE')} event_type, 'amount' {K('VALUE')} amount)\n"
           f"      {K('ORDER BY')} event_ts {K('DESC')})\n"
           f"    {K('FROM')} ({K('SELECT')} * {K('FROM')} claim_events e {K('WHERE')} e.policy_id = p.policy_id\n"
           f"          {K('ORDER BY')} e.event_ts {K('DESC')} {K('FETCH FIRST')} 10 {K('ROWS ONLY')})))\n"
           f"{K('FROM')} policies p {K('WHERE')} p.policy_id = :pol;")
    ba = table(["", "Subset", "Query it"], [
        ["Claim event", '<span class="hot">doc rewrite + history insert</span>', '<span class="cool">1 row + 1 index entry</span>'],
        ["Policy summary read", "1 document fetch", "index range scan, 10 rows (~+25%)"],
        ["CAT day · 300k events", '<span class="hot">300k doc rewrites</span>', '<span class="cool">300k inserts</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When to flip back:</b> if the inline slice is frozen at write time and rarely changes (the three coverages printed on the declarations page), keep it in the document. A slice that changes on every event is a query.</div>
        </div>
        <div class="stack">
          {code(sql, "Stop maintaining the subset: query it")}
          {ba}
        </div>
      </div>"""
    notes = ("The converged answer isn't a cleverer subset. It's no subset at all.<br><br>"
             "Policies, claims, claim events: each stored once. One composite index, policy_id plus event_ts descending, keeps every policy's events pre-sorted. The write is the INSERT: one row, one index entry, one transaction. No push, sort, trim, or second collection. A CAT day is 300,000 inserts, not 300,000 document rewrites.<br><br>"
             "The read is the SELECT. SQL/JSON builds the same policy document from a range scan that stops after ten rows. Full history drops FETCH FIRST. The companion lab runs both on 26ai; the plan stops at N.<br><br>"
             "The honest cost: the summary read does about 25% more work than one document fetch in our model. It buys a write path that holds in a storm and one copy of every event for fraud and audit.<br><br>"
             "<em>Land: the subset stops being state you maintain and becomes a projection you ask for.</em>")
    return slide(label="Subset: the converged answer", pattern=P, beat="D", clock="0:54 – 0:55",
                 title="Stop maintaining the subset: insert once, read the top ten",
                 lede="Store every claim event once in one table. A <strong>(policy_id, event_ts DESC)</strong> index makes the recent ten a range scan that <strong>stops after ten rows</strong>, and SQL/JSON assembles the same policy document on read. Hot and cold are one table.",
                 body=body,
                 takeaway="The app gets the same policy document. <strong>Each claim event went from a document rewrite plus a history insert to one row</strong>, paid for with a modest, predictable read cost.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
