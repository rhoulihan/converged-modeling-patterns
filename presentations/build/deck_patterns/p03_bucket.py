"""Pattern 3: Bucket · manufacturing / IoT.

Scenario (illustrative): 18,000 sensors across 40 plants; 1 reading/s typical, hot sensors
(spindles, vibration) 10/s. One bucket document per sensor per hour (3,600 readings; 36,000
for a hot sensor) with running count/sum/min/max.

Cost model on slide C (illustrative, stated in notes + figcaption), per sensor-hour,
n = readings per bucket, in bytes touched:
  s  = 120 B per reading            Q  = 360 last-hour dashboard reads per sensor-hour
  i  = 130 B row overhead on insert (row header + index entry + redo)
  ir = 150 B extra per row fetched on read (vs one contiguous array)
  D  = 2,000 B per document fetch
  bucket(n) = s*n^2/2 + Q*(D + s*n)          (every $push rewrites the growing bucket;
                                              a dashboard read is one document)
  rows(n)   = n*(s + i) + Q*n*(s + ir)       (append-only insert; the read is a pruned
                                              range scan that pays per row)
  summary(n) = n*(s + i + u) + Q*r1        (append-only insert + a running summary row bumped
                                              per reading by a trigger; the dashboard reads one row)
  u  = 100 B summary bump per reading (measured on 26ai: row + bump 2,144 B vs row 1,515 B, ~40%)
  r1 = 200 B per summary-row read (one narrow row, ~1/10 of a document fetch's fixed cost)
  break-even bucket vs GROUP BY: s*n^2/2 - n*(s + i + Q*ir) + Q*D = 0  ->  n ~= 890 readings / bucket
  summary(n) < min(bucket, rows) at every n: no crossover (matches the 26ai measurement, where even
  an empty bucket's first append, 3,603 B, costs more than a row + summary bump, 2,144 B)
  16 MB document cap: 16,777,216 / 120 ~= 140k readings.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deckfig import MONO, Fig, Flow, chart, doc_panel, erd, knob_rows  # noqa: E402
from deck_patterns._common import code, facts, slide, table  # noqa: E402

P = "Pattern 3: Bucket"
S, I, Q, IR, D = 120, 130, 360, 150, 2000
U, R1 = 100, 200  # running summary: bump bytes per reading, bytes per summary-row read
CAP = 16 * 1024 * 1024 / S  # readings at the 16 MB document cap


def bucket(n):
    return S * n * n / 2 + Q * (D + S * n)


def rows(n):
    return n * (S + I) + Q * n * (S + IR)


def summary(n):
    return n * (S + I + U) + Q * R1


def _bytes(v):
    for k, u in ((1e12, "TB"), (1e9, "GB"), (1e6, "MB"), (1e3, "KB")):
        if v >= k:
            return f"{v / k:g} {u}"
    return f"{v:g} B"


# ------------------------------------------------------------------------- A · problem
def fig_doc():
    f = Fig(560, 340, "The sensor-hour bucket as built: counters and an array that every reading rewrites")
    lines = [
        "{",
        '  "_id": "M-118|VIB|2026-09-25T14",',
        '  "machineId": "M-118",',
        '  "metric": "VIB",',
        '  "hourStart": "2026-09-25T14:00:00Z",',
        '  "count": 21604,',
        '  "sum": 1548212.7,',
        '  "min": 0.8, "max": 97.3,',
        '  "readings": [',
        '    { "ts": "14:00:00.1", "val": 71.4 },',
        '    { "ts": "14:00:00.2", "val": 71.9 },',
        "    ... 21,601 more readings ...",
        '    { "ts": "14:36:00.4", "val": 72.2 }',
        "  ]",
        "}",
    ]
    doc_panel(f, 18, 18, 336, lines, title="readings · one bucket per sensor per hour",
              hot={5, 6, 7, 12}, size=11, lh=17.5,
              callouts=[(5, ["counters: $inc / $max", "rewritten on every", "single reading"], "hot"),
                        (12, ["$push lands here:", "rewrites 2.6 MB", "and it only grows"], "hot")],
              callout_x=378)
    return f.svg()


def slide_a():
    arows = [
        ["Ingest a reading", "gateways", "~34k/s", '<span class="pill hot">write · hot doc</span>'],
        ["Last-hour machine dashboard", "line supervisors", "6/min", '<span class="pill">read · 1 bucket</span>'],
        ["Shift rollup (8 h)", "plant managers", "120/day", '<span class="pill">read · range</span>'],
        ["7-day anomaly scan, all sensors", "reliability eng.", "hourly", '<span class="pill hot">read · times out</span>'],
        ["ML feature extraction", "data science", "nightly", '<span class="pill">read · scan</span>'],
    ]
    body = f"""      <div class="split">
        <div class="stack">
          {facts([("18,000", "sensors"), ("40", "plants"), ("~34k/s", "readings"), ("36k", "per hot bucket")])}
          {table(["Access pattern", "Who", "Rate", "Type"], arows, num_cols=(2,))}
        </div>
        <figure>{fig_doc()}</figure>
      </div>"""
    notes = ("<strong>Every telemetry system in manufacturing has this shape, and the room has built this document.</strong><br><br>"
             "18,000 sensors, 40 plants. Most report once a second, hot spindles and vibration sensors ten times. About 34,000 readings a second, three billion a day, all illustrative.<br><br>"
             "To dodge billions of tiny documents the team buckets: one document per sensor-hour, an array of readings, running count, sum, min and max. The dashboard reads one document, and that read is genuinely good.<br><br>"
             "The red lines: every reading is a $push plus a counter update on the same document. At 36 minutes past the hour a hot bucket holds 21,600 readings, 2.6 MB, and the next reading rewrites all of it. The red read: the 7-day anomaly scan unwinds 3 million buckets through a pipeline. It is the job that times out.<br><br>"
             "<em>Land: the bucket makes the hour cheap to read. The question is what it costs to write, and the answer depends on how fast the sensor talks.</em>")
    return slide(label="Bucket: the problem", pattern=P, beat="A", clock="0:45 – 0:47",
                 title="Manufacturing IoT: one bucket, 36,000 rewrites",
                 lede="18,000 sensors, 40 plants, ~34k readings a second. To avoid billions of tiny documents the team <strong>buckets each sensor's hour into one document</strong>: an array plus running counters. The dashboard reads one document, and every incoming reading rewrites it.",
                 body=body,
                 takeaway="The bucket buys a one-document dashboard read. <strong>It pays with a write whose cost grows with every reading</strong>, and the hottest sensors grow fastest.",
                 notes=notes)


# ------------------------------------------------------------------------- B · model
def fig_model():
    f = Fig(960, 452, "Canonical ERD of plant, machine, append-only sensor readings and a derived hourly rollup, beside one hot sensor-hour concentrated into a single bucket; the hourly rollup is kept by a trigger, one bump per reading")
    f.text(24, 32, "CANONICAL FORM: EACH READING ONCE, NEVER REWRITTEN", size=11, weight=600, fill="var(--faint)", font=MONO)
    f.text(652, 32, "ONE HOT SENSOR-HOUR, BUCKETED", size=11, weight=600, fill="var(--faint)", font=MONO)
    ents = [
        dict(id="pl", x=24, y=48, w=250, title="PLANT", cols=[
            ("plant_id", "varchar2", "PK"), ("name", "varchar2", ""), ("region", "varchar2", "")]),
        dict(id="mc", x=24, y=214, w=250, title="MACHINE", cols=[
            ("machine_id", "varchar2", "PK"), ("plant_id", "varchar2", "FK"), ("model", "varchar2", ""),
            ("line_no", "number", "")]),
        dict(id="rd", x=330, y=48, w=250, title="SENSOR_READINGS", tone="cool", fill="var(--cool-soft)", cols=[
            ("reading_id", "number", "PK"), ("machine_id", "varchar2", "FK"), ("metric", "varchar2", ""),
            ("reading_val", "number", "snap"), ("reading_ts", "timestamp", "snap")]),
        dict(id="mv", x=330, y=250, w=250, title="HOURLY_SUMMARY · derived", cols=[
            ("machine_id", "varchar2", ""), ("hour_start", "date", ""), ("n", "number", ""),
            ("sum_val", "number", ""), ("max_val", "number", "")]),
    ]
    rels = [
        dict(a="pl", a_side="b", a_card="one", b="mc", b_side="t", b_card="many"),
        dict(a="mc", a_side="r", a_row="machine_id", a_card="one", b="rd", b_side="l", b_row="machine_id",
             b_card="many", via=302),
    ]
    geo = erd(f, ents, rels)
    rx, ry, rw, rh, _ = geo["rd"]
    mx = rx + rw / 2
    f.line(mx, ry + rh, mx, 248, stroke="var(--cool)", sw=1.6, dash="5 4", arrow=True, name="groupby")
    f.text(mx + 12, (ry + rh + 250) / 2 + 4, "+1 bump per reading · trigger", size=11, weight=600,
           fill="var(--cool)", font=MONO)
    # one hot sensor-hour, concentrated into one document
    f.box(660, 44, 264, 50, ["M-118 · spindle vibration", "10 readings / s"], tone="flow")
    f.line(792, 94, 792, 120, stroke="var(--hot)", sw=1.7, arrow=True)
    # the bucket: its counters and array are the rewritten parts, so they carry the red tint
    f.rect(660, 122, 264, 86, fill="var(--panel)", stroke="var(--hot)", sw=1.4, rx=6, name="bucket")
    f.raw('<rect x="660" y="122" width="4" height="86" rx="2" fill="var(--hot)"/>')
    f.text(794, 142, "1 bucket document", size=13, weight=700, font="Bricolage Grotesque, Public Sans, sans-serif", anchor="middle")
    f.rect(676, 152, 138, 22, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=4, name="counters")
    f.text(745, 167, "count·sum·min·max", size=10.5, weight=600, fill="var(--hot)", anchor="middle", font=MONO)
    f.rect(822, 152, 90, 22, fill="var(--hot-soft)", stroke="var(--hot)", sw=1, rx=4, name="array")
    f.text(867, 167, "readings[ ]", size=10.5, weight=600, fill="var(--hot)", anchor="middle", font=MONO)
    f.text(794, 196, "every reading rewrites both", size=11.5, fill="var(--muted)", anchor="middle")
    f.line(792, 208, 792, 226, stroke="var(--hot)", sw=1.7, arrow=True)
    f.box(660, 228, 264, 76, ["O(n²) rewrite volume", "36,000 rewrites · 4.3 MB bucket", "≈ 78 GB if each push rewrites it"],
          tone="hot", size=16)
    f.box(660, 316, 264, 64, ["Relational projection", "36,000 row inserts · ≈ 9 MB", "+ 1 summary row, bumped"], tone="cool")
    # key: a framed legend, so the swatches read as a key and not as pointers
    f.rect(24, 402, 900, 32, fill="var(--panel)", stroke="var(--hairline)", sw=1, rx=6, name="key")
    f.text(38, 423, "Key:", size=12, weight=700, fill="var(--ink)")
    f.rect(84, 410, 26, 16, fill="var(--hot-soft)", stroke="var(--hot)", sw=1.2, rx=3, name="sw-hot")
    f.text(118, 423, "red: rewritten on every reading (the bucket's counters and array)", size=11.5, fill="var(--muted)")
    f.rect(532, 410, 26, 16, fill="var(--cool-soft)", stroke="var(--cool)", sw=1.2, rx=3, name="sw-cool")
    f.text(566, 423, "green: immutable (SENSOR_READINGS rows, inserted once)", size=11.5, fill="var(--muted)")
    return f.svg()


def slide_b():
    body = f"""      <figure>{fig_model()}</figure>"""
    notes = ("<strong>Draw the domain and something surprising shows up: nothing in it is mutable.</strong><br><br>"
             "Key first: red is rewritten on every reading, green is immutable. All of SENSOR_READINGS is green. The only red is the bucket's counters and array.<br><br>"
             "The canonical form is plant, machine, reading. A reading is a fact at a timestamp; its relational projection is one row, written once. Pattern 1 suffered from copied mutable data. This data never changes.<br><br>"
             "So the writes pile up in the container. Count, sum, min and max are derived, not canonical. HOURLY_SUMMARY is that derivation, kept current by a trigger: one counter bump as each reading lands, so the dashboard reads one row. A GROUP BY on read still answers any question the summary doesn't.<br><br>"
             "One hot sensor-hour, ten readings a second: 36,000 rewrites of a bucket averaging 2.2 MB, about 78 GB moved to store 4.3 MB. In-memory deltas and checkpoints soften the constant, not the shape. As rows, the same hour is 36,000 small inserts, about 9 MB, appended to one hourly partition.<br><br>"
             "<em>Land: the bucket takes immutable facts and wraps them in the one mutable thing in the system. The write amplification is the wrapper, not the data.</em>")
    return slide(label="Bucket: the model", pattern=P, beat="B", clock="0:47 – 0:48",
                 title="Immutable readings, mutable bucket",
                 lede="In canonical form a reading is an <strong>immutable fact</strong>; in the relational projection it is one row, inserted once. The hourly counters are <strong>derived</strong>. The bucket turns those immutable facts into one ever-growing document that <strong>every reading rewrites</strong>.",
                 body=body,
                 takeaway="<strong>Immutable facts, mutable container.</strong> The write amplification comes from the bucket, not from the data. Derive the counters instead of storing them.",
                 notes=notes)


# ------------------------------------------------------------------------- C · knobs
def fig_knobs():
    f = Fig(960, 380, "Knob settings for sensor telemetry and a cost model of bucket versus append-only rows, with GROUP BY on read or a running summary, as readings per bucket grow")
    f.text(20, 30, "KNOB SETTINGS · THIS WORKLOAD", size=11, weight=600, fill="var(--faint)", font=MONO)
    knob_rows(f, 20, 44, [
        dict(name="1 · Diversity", value=0.5, tone="cool", setting="Medium: 4 read shapes",
             lines=["dashboard, shift rollup,", "anomaly scan, ML features"]),
        dict(name="2 · Read / write", value=0.15, tone="cool", setting="Write-heavy",
             lines=["~3B readings in per day;", "reads are rollups, not points"]),
        dict(name="3 · Update locality", value=0.95, tone="hot", setting="Every write, same document",
             lines=["each reading rewrites the", "growing hour bucket"]),
    ])
    f.text(400, 28, "BYTES PER SENSOR-HOUR vs READINGS / BUCKET · illustrative model", size=11, weight=600,
           fill="var(--faint)", font=MONO)
    box = (400, 58, 520, 236)
    sx, sy = chart(f, box, (20, 2e5), (1e4, 1e13),
                   curves=[dict(name="Bucket · $push", fn=bucket, tone="hot"),
                           dict(name="Rows · GROUP BY", fn=rows, tone="flow"),
                           dict(name="Rows + summary", fn=summary, tone="cool")],
                   xlabel="readings per bucket (log)", ylabel="bytes touched per sensor-hour (log)",
                   logx=True, logy=True, yticks=[1e5, 1e7, 1e9, 1e11], ytick_fmt=_bytes,
                   regions=[(20, 2e5, "cool", "running summary is cheapest at every bucket size")],
                   points=[(60, "Bucket · $push", "1 / min · 60", -4, 20, "start"),
                           (3600, "Bucket · $push", "1 / s · 3,600", -10, -8, "end"),
                           (36000, "Bucket · $push", "hot · 36,000", -10, -8, "end")],
                   cross=("Bucket · $push", "Rows · GROUP BY"),
                   cross_label=dict(lines=["bucket vs GROUP BY ≈ 900"], dx=-12, dy=-13, anchor="end"),
                   legend=(400, 352), legend_dir="h")
    # the 16 MB document cap (drawn locally so its label sits inside the plot)
    cx = sx(CAP)
    f.line(cx, box[1], cx, box[1] + box[3], stroke="var(--hot)", sw=1.3, dash="4 4", name="cap")
    f.text(cx - 6, box[1] + 16, "16 MB cap ≈ 140k", size=10.5, weight=600, fill="var(--hot)", anchor="end")
    return f.svg()


def slide_c():
    body = f"""      <figure>{fig_knobs()}
        <figcaption>Illustrative cost model, not a benchmark: 120 B per reading; each $push rewrites the whole bucket (s·n²/2 per hour); a row insert adds ~130 B of header, index and redo; a live dashboard reads the hour 360×/h, paying ~150 B more per row than one 2 KB-overhead document fetch. Running summary: +100 B per reading (measured ~40% of an insert) and a 200 B one-row read.</figcaption>
      </figure>"""
    notes = ("<strong>This chart has a region where the bucket wins. Spend time there; it is why the pattern exists.</strong><br><br>"
             "Dials: diversity medium, four read shapes. Write-skewed, three billion readings a day. Locality pinned: every write hits one growing document. That knob bites.<br><br>"
             "Say the model out loud. Every push rewrites the bucket, so bytes grow with the square of the readings. Rows pay a constant per insert. Reads are charged honestly: 360 dashboard reads an hour, and a range scan pays per row where the bucket is one contiguous fetch. The GROUP BY is not free.<br><br>"
             "Below the break-even, about 900 readings, the bucket wins. A once-a-minute sensor holds 60 readings, read hundreds of times an hour: bucket it.<br><br>"
             "At one reading a second the bucket costs ~2.7× the rows. The hot spindle at 36,000 costs ~22×, marching on the 16 MB cap: about 140,000 readings, where writes fail.<br><br>"
             "Now the twist, and it is about rate. The update rate sizes the bucket. Bound it by time and a faster sensor means a fatter bucket, so every append costs more. Bound it by count and the hour spreads over more buckets, so the dashboard reads more. The best bucket size is a constant that doesn't move with rate, and no size removes the growth cost. The green curve has no size to pick: store each reading as a row and bump one running summary row per hour as it lands. One insert, one counter bump, flat at any rate; the dashboard reads one row.<br><br>"
             "We measured it on 26ai. A bucket append costs 3,600 bytes of redo plus 102 for every reading already in it. Inside a document store, a reading document plus a running summary document costs 4,849 bytes flat, so the bucket stops paying at about 24 readings: one reading every 2.5 minutes for an hourly bucket. On the converged engine a row plus a summary-row bump costs 2,144 bytes, less than an empty bucket's first append at 3,603. No crossover: the running summary beats every bucket size at every rate.<br><br>"
             "<em>Land: the bucket is a low-rate pattern. It loses exactly on the sensors you care most about: the fast, hot ones. And a running summary beats it at every rate.</em>")
    return slide(label="Bucket: where the knobs flip it", pattern=P, beat="C", clock="0:48 – 0:49",
                 title="Slow sensors love buckets. Hot sensors break them.",
                 lede="Diversity is medium and the workload is write-heavy, but the knob that bites is <strong>locality</strong>: every reading lands on the same growing document. Rewrite cost grows with <strong>n²</strong>: against GROUP BY on read the break-even is about <strong>900 readings per bucket</strong>, and a <strong>running summary beats every bucket size</strong>.",
                 body=body,
                 takeaway="Rate sizes the bucket, and the hot spindle marches at the 16 MB cap. <strong>A running summary has no size to pick: one insert and one counter bump per reading, at any rate.</strong>",
                 notes=notes)


# ------------------------------------------------------------------------- D · converged
def fig_flow():
    f = Fig(560, 332, "Append-only partitioned readings keep a trigger-maintained hourly summary current for dashboards, and feed a pruned GROUP BY for the anomaly job over the MongoDB API $sql stage and for shift reports")
    f.text(91, 30, "RELATIONAL PROJECTION", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(295, 30, "SUMMARY", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    f.text(482, 30, "CONSUMERS", size=10.5, weight=600, fill="var(--faint)", anchor="middle", font=MONO)
    fl = Flow(f)
    fl.node("mc", 18, 44, 148, 56, ["machines", "plant · line · model"])
    fl.node("rd", 18, 196, 148, 70, ["sensor_readings", "append-only rows", "INTERVAL 1 h"], tone="cool")
    fl.node("sm", 220, 44, 150, 96, ["hourly summary", "trigger · 1 bump", "per reading"], tone="cool")
    fl.node("gb", 220, 222, 150, 70, ["GROUP BY hour", "pruned · parallel"], tone="cool")
    fl.node("dash", 420, 44, 122, 56, ["Dashboards", "SQL · 1 row"], tone="flow")
    fl.node("anom", 420, 150, 122, 56, ["Anomaly scan", "Mongo API $sql"], tone="flow")
    fl.node("shift", 420, 256, 122, 56, ["Shift report", "SQL · 8 h range"], tone="flow")
    fl.edge("mc", "sm", 193, tone="muted", by=72)
    fl.edge("rd", "sm", 193, tone="muted", ay=216, by=112)
    fl.edge("rd", "gb", 193, tone="muted", ay=246, by=257)
    fl.edge("sm", "dash", 396, tone="flow", ay=72)
    fl.edge("gb", "anom", 396, tone="flow", ay=240, by=178)
    fl.edge("gb", "shift", 396, tone="flow", ay=274, by=284)
    return f.svg()


def slide_d():
    js = ('<span class="k">CREATE TABLE</span> sensor_readings ( machine_id VARCHAR2(16), metric VARCHAR2(24),\n'
          "  reading_val NUMBER(12,3), reading_ts TIMESTAMP )\n"
          '<span class="k">PARTITION BY RANGE</span> (reading_ts) <span class="k">INTERVAL</span> (<span class="k">INTERVAL</span> <span class="s">\'1\'</span> <span class="k">HOUR</span>)\n'
          '( <span class="k">PARTITION</span> p0 <span class="k">VALUES LESS THAN</span> (<span class="k">TIMESTAMP</span> <span class="s">\'2026-08-01 00:00:00\'</span>) );\n\n'
          "db.aggregate([{ <mark class=\"hl\">$sql</mark>: `\n"
          '  <span class="k">select json</span> { <span class="s">\'machineId\'</span> : machine_id, <span class="s">\'n\'</span> : count(*), <span class="s">\'max\'</span> : max(reading_val),\n'
          '                <span class="s">\'hour\'</span> : to_char(trunc(reading_ts,<span class="s">\'HH24\'</span>),<span class="s">\'YYYY-MM-DD"T"HH24\'</span>) }\n'
          '  <span class="k">from</span> sensor_readings <span class="k">where</span> reading_ts &gt;= systimestamp - <span class="k">interval</span> <span class="s">\'7\'</span> <span class="k">day</span>\n'
          '  <span class="k">group by</span> machine_id, metric, trunc(reading_ts,<span class="s">\'HH24\'</span>)` }])')
    ba = table(["", "Hour bucket", "Partitioned rows"], [
        ["Ingest, hot sensor at :59", '<span class="hot">rewrite a 4.3 MB doc</span>', '<span class="cool">insert one ~120 B row + 1 counter bump</span>'],
        ["Last-hour dashboard", "1 document fetch", '<span class="cool">1 summary row (trigger-kept)</span>'],
        ["Bucket rollup · anonymized field result", '<span class="hot">29 s</span>', '<span class="cool">&lt; 400 ms</span>'],
    ])
    body = f"""      <div class="split wide-r top">
        <div class="stack">
          <figure>{fig_flow()}</figure>
          <div class="flipnote"><b>When a bucket still pays:</b> a document store with no running summary and a slow sensor: below ~24 readings a bucket on our measurements.</div>
        </div>
        <div class="stack">
          <div class="flipnote sql"><b><code>$sql</code>: Oracle's addition to the MongoDB aggregation pipeline.</b> It runs full SQL as one stage of <code>db.aggregate()</code>.</div>
          {code(js)}
          {ba}
        </div>
      </div>"""
    notes = ("<strong>Stop hand-rolling buckets. The partition does the amortization the bucket was faking, and the document team keeps its pipeline.</strong><br><br>"
             "Readings become tiny append-only rows in an INTERVAL-partitioned table; Oracle opens each hourly partition itself as the clock crosses the hour. No array to grow, nothing to rewrite, no 16 MB ceiling. A trigger keeps one summary row per machine and hour current as each reading lands, and the dashboard reads that row. Anything the summary doesn't answer is a GROUP BY pruned to the hours it needs.<br><br>"
             "Explain the pipeline first. In the MongoDB API, db.aggregate([ ... ]) is an ordered list of stages, each feeding the next: $match filters, $group rolls up, $sort orders, $project reshapes, $unwind flattens an array into one document per element. The app builds the list; the engine runs it stage by stage.<br><br>"
             "$sql, the blue callout, is Oracle's addition: one more stage whose body is full SQL (joins, GROUP BY, window functions, pruning). Its rows return to the driver as documents. Point at the highlighted $sql: the anomaly team keeps db.aggregate(), its driver and code structure, and drops the rollup in as one stage. That SQL gets the cost-based optimizer, parallel execution and pruning to the seven hourly partitions it needs, with none of a pipeline's per-stage memory limits or output caps. The companion lab asserts the $sql rollup equals the SQL GROUP BY, row for row.<br><br>"
             "Be straight about the cost: each reading now pays a counter bump on top of its insert, about 375 bytes of redo and 14 microseconds, measured. We also tried the declarative version, a materialized view with fast refresh on commit: exact, and about 8 times the redo and 40 times the time per single-row commit. The backup slide at the end has the breakdown. The payoff, from an anonymized field result on exactly this reshape: a 29-second bucket rollup fell under 400 milliseconds.<br><br>"
             "<em>Land: the facts stay immutable, the partition does the bucketing, and the pipeline keeps working, with SQL inside it.</em>")
    return slide(label="Bucket: the converged answer", pattern=P, beat="D", clock="0:49 – 0:50",
                 title="Let the partition be the bucket, and put SQL in the pipeline",
                 lede="Store each reading as an <strong>append-only row in an hourly INTERVAL partition</strong>. The document team keeps its pipeline and hands the heavy rollup to SQL.",
                 body=body,
                 takeaway="Ingest becomes a constant-cost insert with no 16 MB ceiling. <strong>An anonymized field reshape took a 29 s bucket rollup to under 400 ms</strong>, and the dashboard reads one summary row.",
                 notes=notes)


def slides():
    return [slide_a(), slide_b(), slide_c(), slide_d()]
