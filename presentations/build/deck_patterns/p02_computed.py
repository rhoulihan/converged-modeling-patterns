"""Pattern 2: Computed · telecom (mobile operator, cycle-usage rollup on the subscriber).

Cost model on slide C (illustrative, calibrated to 26ai measurements; stated in notes + figcaption),
per subscriber per day:
  B  = 30 balance reads / subscriber / day: R = 28 rate/consumption checks (real-time charging)
       + A = 2 account-page reads (self-care app); 12M subscribers -> ~360M reads/day
  n  = CDRs per subscriber per day           (average ~11; heavy users 400+)
  embed(n) = B * 1.00 + n * 16.6
             every read fetches the ~6 KB subscriber document (profile + summary); each CDR
             inserts its own small document and updates the summary, which rewrites the whole
             subscriber document. Measured on 26ai Free (companion lab, Measure it): 12,800 B
             redo per CDR vs 1,544 B for CDR insert + summary row (8.3x, so 16.6 units against 2). No contention term: 400 CDRs a day is one
             every 3.6 minutes, so neither design waits on a lock and nothing needs sharding;
             the cost is the bytes rewritten, and it grows with the document
  summary(n) = R * 0.42 + A * 1.30 + n * 2
             rate checks read the narrow summary row by PK (measured: same 3 logical reads,
             4.0 vs 9.5 us, so 0.42x); account-page reads join it through the duality view (+30%);
             each CDR = one small row insert + one summary-row update + index entry (2 units)
  no break-even for this read mix: summary is cheaper at every n (14.4 + 2n vs 30 + 16.6n)
  heavy user (400/day): embed ~6,660 vs summary ~810 units/day (~8.2x)
  counter-case: if all 30 reads were account-page reads, embed wins below n ~ 0.6
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 2: Computed"
RATE = 28.0        # rate/consumption checks / subscriber / day (charging)
APP = 2.0          # account-page reads / subscriber / day (self-care app)
B = RATE + APP     # balance reads / subscriber / day
DOC_REWRITE = 16.6  # work units per CDR on the ~6 KB subscriber document (measured 8.3x the converged write)
ROW_WRITE = 2.0    # CDR insert + summary-row update + index entry
ROW_READ = 0.42    # rate check on the summary row vs a document fetch (measured 4.0 vs 9.5 us)
READ_JOIN = 1.30   # account-page read through the duality view (PK join)


def embed(n):
    return B + n * DOC_REWRITE


def summary(n):
    return RATE * ROW_READ + APP * READ_JOIN + n * ROW_WRITE


MONO = "IBM Plex Mono, monospace"


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 372, "The subscriber document as built: a running cycle-usage rollup that every call detail record rewrites")
    lines = [
        "{",
        '  "_id": "S-4471902",',
        '  "msisdn": "+1-202-555-0142",',
        '  "plan": "UNLIMITED-5G",',
        '  "addOns": [ "roam-EU", "hotspot-50" ],',
        '  "profile": { ... },  // ~6 KB: devices,',
        '  // addresses, consents, history',
        '  "cycleUsage": {',
        '    "totalMB":  48213.7,',
        '    "totalMin": 1284,',
        '    "cost":     86.42,',
        '    "cdrCount": 11906',
        "  },",
        '  "updatedAt": "2026-09-28T14:02:11Z"',
        "}",
    ]
    doc_panel(f, 18, 18, 336, lines, title="subscribers · one document per subscriber",
              hot={7, 8, 9, 10, 11, 12, 13}, size=11, lh=19,
              callouts=[(7, ["every CDR rewrites", "the whole document:", "400+ times a day"], "hot"),
                        (11, ["Top-N sorts 12M", "documents by this", "buried field"], "hot")],
              callout_x=378)
    return f.svg()


def slide_a():
    rows = [
        ["Record a CDR", "mediation", "1.5k/s avg", '<span class="pill hot">write · hot doc</span>'],
        ["Show balance in the app", "self-care app", "~25M / day", '<span class="pill">read</span>'],
        ["Real-time balance check", "charging", "~4k/s", '<span class="pill">read · &lt;50 ms</span>'],
        ['"Top 20 talkers this cycle"', "ops dashboard", "every load", '<span class="pill hot">read · sort 12M</span>'],
        ["Bill run", "batch", "12M / cycle", '<span class="pill">read · batch</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("12M", "subscribers"), ("4B", "CDRs / month"), ("6k/s", "peak CDRs"), ("400+", "CDRs/day, heavy user")])}
          {table(["Access pattern", "Who", "Rate", "Type"], rows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ("<strong>A mobile operator. Everyone in this room has hit this document checking their data balance.</strong><br><br>12 million subscribers, about 4 billion call and data detail records a month: 1,500 a second on average, 6,000 at the evening peak. A heavy user throws off 400 or more a day.<br><br>Two reads drove the design. The self-care app says 'you've used 48 GB of your plan', and charging checks the balance in real time before it lets a session continue. Neither wants to re-aggregate a month of CDRs, so the team kept a running cycleUsage rollup on the subscriber document. Compute on write, read without re-aggregating. The CDRs themselves live elsewhere, one small record each; the summary is the only thing the pattern adds.<br><br>The red rows are the bill. The subscriber document is the whole subscriber, about 6 KB of profile around three numbers. Every CDR updates those three numbers, and updating them rewrites all of it, and the heaviest users own the hottest ones. 'Top 20 talkers' gets no help at all: the rollup is buried inside 12 million documents, so the dashboard sorts them all on every load.<br><br><em>Land: the read side of this bet is right. The question is what it costs on the write side, and who pays.</em>")
    return slide(label="Computed: the problem", pattern=P, beat="A", clock="0:40 – 0:42",
                 title="Telecom: a counter on the hottest document you own",
                 lede="The app and the charging system both read the balance. To make that one read, each subscriber document carries a <strong>running cycle-usage rollup</strong>: the Computed pattern. Then 4 billion CDRs a month arrive, and <strong>every one rewrites the parent</strong>.",
                 body=body,
                 takeaway="The rollup makes the balance read one document. <strong>Every CDR pays for it with a whole-document rewrite</strong>, and the busiest subscribers take the most rewrites.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 440, "Canonical ERD of subscriber, CDR and usage summary beside the summary embedded in the subscriber document, where every CDR's summary update rewrites the whole ~6 KB document, 8.3 times the redo of a narrow summary row")
    f.text(24, 32, "CANONICAL FORM: FACTS APPENDED, ROLLUP DERIVED", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(652, 32, "THE SAME ROLLUP, EMBEDDED", size=11, weight=600, fill="var(--faint)", font=MONO)
    ents = [
        dict(id="sub", x=24, y=48, w=250, title="SUBSCRIBER", cols=[
            ("subscriber_id", "varchar2", "PK"), ("msisdn", "varchar2", ""), ("plan", "varchar2", ""),
            ("cycle", "varchar2", ""), ("profile", "json", "")]),
        dict(id="cdr", x=330, y=48, w=250, title="CDR · append-only", cols=[
            ("cdr_id", "number", "PK"), ("subscriber_id", "varchar2", "FK"), ("mb", "number", "snap"),
            ("minutes", "number", "snap"), ("cost", "number", "snap"), ("cdr_ts", "timestamp", "snap")]),
        dict(id="use", x=24, y=236, w=250, title="SUBSCRIBER_USAGE", tone="hot", cols=[
            ("subscriber_id", "varchar2", "PK"), ("total_mb", "number", "hot"), ("total_min", "number", "hot"),
            ("cost", "number", "hot")]),
    ]
    rels = [
        dict(a="sub", a_side="r", a_row="subscriber_id", a_card="one", b="cdr", b_side="l",
             b_row="subscriber_id", b_card="many", via=302),
        dict(a="sub", a_side="b", a_card="one", b="use", b_side="t", b_card="one"),
    ]
    erd(f, ents, rels)
    # trigger: CDR insert maintains the usage row in the same transaction
    f.path("M455,208 V300 H276", [(455, 208), (455, 300), (276, 300)], stroke="var(--cool)", sw=1.7,
           arrow=True, dash="5 4", name="trigger")
    f.text(466, 262, "AFTER INSERT trigger", size=11, weight=600, fill="var(--cool)", font=MONO)
    f.text(466, 278, "+1 counter row, same txn", size=11, fill="var(--muted)")
    # the embedded rollup: every CDR rewrites the whole subscriber document, and the
    # rewrite grows with the document (redo measured on 26ai Free)
    f.box(660, 48, 264, 50, ["CDR stream", "1,500/s avg · 6k/s peak"], tone="flow")
    f.line(792, 98, 792, 118, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 120, 264, 54, ["S-4471902 · subscriber doc", "~6 KB profile + 3 counters"], tone="hot")
    f.text(660, 198, "REDO PER CDR, MEASURED ON 26ai", size=10.5, weight=600, fill="var(--faint)", font=MONO)
    for k, (lab, kb, tone) in enumerate([("summary inside the ~6 KB document · 12.8 KB", 12.8, "hot"),
                                         ("narrow summary row · 1.5 KB", 1.544, "cool")]):
        y0 = 220 + k * 28
        f.text(660, y0, lab, size=11, fill="var(--muted)")
        f.rect(660, y0 + 6, 264 * kb / 12.8, 9, fill=f"var(--{tone}-soft)", stroke=f"var(--{tone})", sw=1, rx=2)
    f.box(660, 276, 264, 44, ["read it buys: account page", "~2 reads a subscriber a day"], tone="hot", size=12.5)
    f.box(660, 328, 264, 64, ["Relational projection", "append 1 row + bump 1", "counter row · ~1.5 KB"], tone="cool")
    # legend
    f.rect(24, 404, 14, 14, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=3)
    f.text(46, 416, "mutable rollup: every CDR writes it", size=11.5, fill="var(--muted)")
    f.rect(330, 404, 14, 14, fill="var(--cool-soft)", stroke="var(--cool)", sw=1, rx=3)
    f.text(352, 416, "immutable CDR facts: append, never rewrite", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("<strong>Draw the domain in canonical form and the Computed pattern splits into two things that were never the same: facts and a derivation.</strong><br><br>The green rows are facts: a CDR's megabytes, minutes, cost and timestamp freeze when the network emits it. Append, never update: the cheapest write there is.<br><br>The red rows are the derivation: cycle totals that change on every CDR. In the logical model that is one derived value per subscriber, and the relational projection keeps it in one narrow row, maintained by a trigger in the same transaction.<br><br>Now the right side. Embedded, the summary lives inside the whole subscriber: about 6 KB of profile around three numbers. Every CDR updates those three numbers, and updating them rewrites all of it. The document doesn't grow; it is just far bigger than the change. We measured it on 26ai: 12,800 bytes of redo per CDR against 1,544 for the CDR row plus the summary row, 8.3 times. Don't reach for counter sharding here. 400 writes a day is one every 3.6 minutes; nothing waits on a lock, so there is nothing to spread. The cost is bytes. And the read it buys is the account page, a couple of times a day per subscriber. A write tax on every event for a read that rarely happens is not a trade worth making: keep the subscriber, the CDRs and the summary in their own tables and join them on read.<br><br><em>Land: append the facts, derive the rollup. Keep the derivation narrow and the write stays small.</em>")
    return slide(label="Computed: the model", pattern=P, beat="B", clock="0:42 – 0:43",
                 title="Facts vs. the rollup: where every CDR lands",
                 lede="In canonical form a CDR is an <strong>immutable fact, appended once</strong>, and the cycle rollup is <strong>one derived value</strong> in one narrow row. Embedded, every CDR's summary update rewrites the whole subscriber document, profile and all, to speed up a read that happens a couple of times a day.",
                 body=body,
                 takeaway="<strong>Append the facts, derive the rollup.</strong> The CDR belongs in an append-only table; the running total belongs in a row the engine maintains, not inside the document it rewrites.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for the cycle-usage rollup and a cost model of an embedded rollup versus append-only CDRs with a maintained summary as CDRs per subscriber per day grow")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.68, tone="cool", setting="Medium-high: 4 consumers",
             lines=["app, charging, ops dashboard", "and the bill run"]),
        dict(name="2 · Read / write", value=0.3, tone="cool", setting="Write-heavy on the rollup",
             lines=["~30 balance reads/day vs", "11 CDRs avg · 400+ heavy"]),
        dict(name="3 · Update locality", value=0.9, tone="hot", setting="Every write, one parent",
             lines=["each CDR lands on the same", "hot subscriber document"]),
    ])
    f.text(400, 28, "WORK / SUBSCRIBER / DAY vs CDRs / DAY · illustrative model", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    a, b = "Embedded rollup · doc rewrite", "Append + summary · rate checks on the row"
    chart(f, (400, 58, 520, 236), (1, 1000), (10, 2e4),
          curves=[dict(name=a, fn=embed, tone="hot"), dict(name=b, fn=summary, tone="cool")],
          xlabel="CDRs per subscriber per day (log)", ylabel="work units / subscriber / day (log)",
          logx=True, logy=True, yticks=[10, 30, 100, 300, 1000, 3000, 10000],
          regions=[(1, 1000, "cool", "append + summary is cheaper at every volume")],
          points=[(1.5, a, "light · 1.5", -30, -40, "start"),
                  (11, a, "average · 11", -8, -20, "end"),
                  (400, a, "heavy · 400", -10, -20, "end")],
          legend=(400, 352), legend_dir="h")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Illustrative cost model calibrated to 26ai measurements: 30 balance reads/subscriber/day (28 rate checks, 2 account-page reads). A CDR inserts its record and rewrites the ~6 KB subscriber document (16.6 units: 8.3× the redo) vs a row insert + counter-row update (2 units). Rate checks read the summary row (0.42×); only account-page reads pay the projection's ~30%.</figcaption>
      </figure>"""
    notes = ("This is the slide where the pattern's own math turns on it.<br><br>Start with who reads the rollup. Thirty times a day per subscriber, something asks for usage. Twenty-eight of those are real-time charging checking a balance before it lets a call through. They want three numbers. The other two are a person opening the app. The Computed pattern serves all thirty the same way: fetch the whole subscriber document and dig the counters out. The dials say it before the chart does. Diversity is medium-high, reads and writes lean to writes, and knob three is red, because every write lands on one parent.<br><br>Now the writes. Every CDR lands on that document: 11 a day for the average subscriber, 400 for the heavy tail. We measured it on 26ai rather than modelling it. With a 6 KB subscriber document, one CDR (its own record plus the summary update) logs 12,800 bytes of redo; the CDR row plus the summary-row bump logs 1,544. That is 8.3 times the work, every event, so the model charges 16.6 units against 2. At 400 a day nothing waits on a lock, so the cost is pure bytes: the whole document on one side, one narrow row on the other. And no, the 8 KB block doesn't save you. Redo and undo grow with the bytes rewritten, and a document update rewrites every byte to change three counters.<br><br>Move the rollup to a narrow row and the reads get cheaper too: the same three logical reads, 4.0 microseconds against 9.5, because there's nothing to extract. Only the app's account page pays the duality view's 30% premium, and it shows up twice a day.<br><br>So the chart has no crossing. The narrow row wins at every volume: 3.2 times for a light subscriber, 8.2 for the heavy user. Say where the other answer lives. If every read were a full account-page read, the document would win only below about 0.6 CDRs a day: a subscriber who barely uses the phone. A document holding nothing but the counters measured within 1.4 times of the row. That isn't the Computed pattern; it's the relational design wearing JSON.<br><br><em>Land: put the rollup where the readers are. Charging needs three numbers. Give it three numbers, not the document.</em>")
    return slide(label="Computed: where the knobs flip it", pattern=P, beat="C", clock="0:43 – 0:44",
                 title="Put the rollup where the readers are",
                 lede="Diversity argues for a precomputed rollup. But <strong>every write lands on one parent document</strong>, and most reads are rate checks that need three numbers, not the document. Measured on 26ai, the narrow row wins <strong>at every volume</strong>: ~3.2× for a light subscriber, ~8.2× for the heavy user.",
                 body=body,
                 takeaway="The 8 KB block is not a floor: <strong>a document update rewrites every byte, every time</strong>. A document only competes when it holds nothing but the rollup.",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 336, "Append-only CDRs maintain a usage row by trigger; a descending index serves Top-N, a duality view serves the app over the MongoDB API and charging over SQL/JSON, and the bill run reads CDRs over SQL")
    f.text(95, 30, "RELATIONAL PROJECTION", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(297, 30, "MAINTAINED · PROJECTED", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(478, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("cdr", 18, 44, 156, 56, ["cdr", "append-only rows"])
    fl.node("use", 18, 152, 156, 56, ["subscriber_usage", "the rollup · 1 row"], tone="hot")
    fl.node("sub", 18, 262, 156, 56, ["subscribers", "msisdn · plan"])
    fl.node("ix", 222, 116, 150, 56, ["ix_usage_topn", "total_mb DESC"], tone="cool")
    fl.node("dv", 222, 200, 150, 96, ["subscriber_dv", "duality view", "cycleUsage NOUPDATE"], tone="cool")
    fl.node("bill", 414, 44, 128, 56, ["Bill run", "SQL over cdr"], tone="flow")
    fl.node("ops", 414, 116, 128, 56, ["Ops Top-N", "index range scan"], tone="flow")
    fl.node("app", 414, 188, 128, 56, ["Self-care app", "Mongo API find()"], tone="flow")
    fl.node("chg", 414, 262, 128, 56, ["Charging", "SQL/JSON"], tone="flow")
    # trigger inside the relational-projection column
    f.line(96, 100, 96, 150, stroke="var(--cool)", sw=1.7, arrow=True, dash="5 4", name="trigger")
    f.text(106, 122, "trigger", size=11, weight=600, fill="var(--cool)", font=MONO)
    f.text(106, 137, "same txn", size=11, fill="var(--muted)", font=MONO)
    fl.edge("use", "ix", 198, tone="muted", ay=170, by=144)
    fl.edge("use", "dv", 198, tone="muted", ay=190, by=226)
    fl.edge("sub", "dv", 198, tone="muted", ay=290, by=268)
    fl.edge("ix", "ops", 396, tone="flow")
    fl.edge("dv", "app", 396, tone="flow", ay=230, by=216)
    fl.edge("dv", "chg", 396, tone="flow", ay=266, by=290)
    fl.edge("cdr", "bill", 396, tone="flow")
    return f.svg()


def slide_d():
    k = lambda s: f'<span class="k">{s}</span>'  # noqa: E731
    c = lambda s: f'<span class="c">{s}</span>'  # noqa: E731
    sql = (c("-- 1 · each CDR is a small append; the trigger bumps one row") + "\n"
           + k("CREATE TRIGGER") + " trg_usage " + k("AFTER INSERT ON") + " cdr " + k("FOR EACH ROW BEGIN") + "\n"
           + "  " + k("MERGE INTO") + " subscriber_usage u\n"
           + "  " + k("USING") + " (" + k("SELECT") + " :NEW.subscriber_id sid " + k("FROM") + " dual) s "
           + k("ON") + " (u.subscriber_id = s.sid)\n"
           + "  " + k("WHEN MATCHED THEN UPDATE SET") + " u.total_mb = u.total_mb + :NEW.mb, ...\n"
           + "  " + k("WHEN NOT MATCHED THEN INSERT") + " ... ; " + k("END") + ";\n"
           + c("-- 2 · Top-N is an index range scan, not a sort") + "\n"
           + k("CREATE INDEX") + " ix_usage_topn " + k("ON") + " subscriber_usage (total_mb " + k("DESC") + ", subscriber_id);\n"
           + k("SELECT") + " subscriber_id, total_mb " + k("FROM") + " subscriber_usage " + k("ORDER BY") + " total_mb " + k("DESC") + "\n"
           + k("FETCH FIRST") + " 20 " + k("ROWS ONLY") + ";")
    ba = table(["", "Embedded rollup", "Append + summary"], [
        ["Record a CDR", '<span class="hot">CDR insert + whole-doc rewrite · 12,800 B redo (~6 KB doc)</span>', '<span class="cool">insert + counter row · 1,544 B (8.3×)</span>'],
        ["Rate check", "1 document (9.5 µs)", '<span class="cool">1 narrow row (4.0 µs)</span>'],
        ["Account page", "1 document", "duality view, PK join (~+30%)"],
        ["Top 20 talkers", '<span class="hot">sort 12M docs · 60 s</span>', '<span class="cool">index scan · 500 ms</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When to flip back:</b> a rollup-only document (counters, profile elsewhere) measures within 1.5× of the row; a closed cycle's final bill can live on the document.</div>
        </div>
        <div class="stack">
          {code(sql)}
          {ba}
          <div class="flipnote sec"><b>Same security model:</b> duality views and projections go through the same privileges, auditing and policies as the tables underneath. No second security model to manage.</div>
        </div>
      </div>"""
    notes = ("<strong>The converged answer keeps the Computed pattern's promise (the rollup is precomputed and current) and moves it off the hot document.</strong><br><br>Walk the diagram. CDRs are append-only rows, one small insert each. A row trigger bumps the usage row in the same transaction: Computed, with a staleness window of zero. (The declarative equivalent is a materialized view with fast refresh on commit: exact, but on 26ai about 8 times the trigger's redo and 40 times its time per single-row commit. The backup slide at the end has the breakdown.) Top-N stops being a sort: a descending index on total_mb makes 'top 20 talkers' an index range scan plus FETCH FIRST. That is the shape behind an anonymized field result on exactly this workload: the dashboard's Top-N went from 60 seconds to 500 milliseconds.<br><br>The app keeps its document. A duality view projects the subscriber with cycleUsage inline, read-only. The app calls find() through the MongoDB API, charging reads SQL/JSON, the bill run reads the CDRs directly. The companion lab proves the MongoDB API and SQL documents are identical.<br><br>Be straight about the price. The account-page read now joins the usage row by primary key, about 30% more read work, and each CDR is two row writes instead of one document rewrite. The rate checks, most of the reads, get cheaper. Companion lab, 26ai Free: one CDR against a ~6 KB subscriber document, its own record plus the summary update, costs 12,800 bytes of redo. Insert plus trigger-maintained summary row: 1,544 bytes. 8.3 times less. Don't oversell it: the summary row is still one row per subscriber, and the read now joins it. What changes is the write: a 1.5 KB insert and counter bump, flat however large the subscriber's profile is, instead of a rewrite of the whole subscriber document. Compute-on-write on the document is still right when writes are rare and don't collide.<br><br>Bottom right, security. A duality view is a database object in the same schema, not a copy elsewhere. You GRANT on it like any view; reads and writes resolve against the base tables in the same session, so the privileges, the unified audit trail and the policies all apply. The MongoDB API signs in as an ordinary database user, so find() on subscriber_dv answers to the same grants as SQL. Polyglot can't say that: document store, search index and cache each bring their own users, roles, audit log and patches. There's no demo of this, so keep the claim general. Asked about Virtual Private Database, Data Redaction or Real Application Security on duality views? Check the 26ai documentation for that feature before you promise it.<br><br><em>Land: same document at the API, a current rollup, a Top-N that's a seek, and a per-subscriber lock held for a 1.5 KB write, not a whole-document rewrite.</em>")
    return slide(label="Computed: the converged answer", pattern=P, beat="D", clock="0:44 – 0:45",
                 title="Append the CDR, maintain the rollup: staleness zero",
                 lede="Store each CDR as an <strong>append-only row</strong>; a trigger keeps a one-row summary current <strong>in the same transaction</strong>. A duality view serves the document.",
                 body=body,
                 takeaway="The rollup is still precomputed and still current. <strong>The write went from a whole-document rewrite to two small rows, and Top-N from 60 s to 500 ms</strong> (anonymized field result), and rate checks read a narrow row; only the app's page pays the read premium.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
