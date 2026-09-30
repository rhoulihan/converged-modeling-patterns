# Lab console guidance: dock, help, and measure-it — design

**Status:** approved in conversation 2026-09-29 (sections 1–3); this document is the written spec.
**Branch:** `feat/lab-guidance` → PR against `master` of the public repo.
**Builds on:** `2026-09-29-hands-on-lab-console-design.md` (the console as shipped in PR #1).

## Goal

Attendees should understand, without the instructor at their elbow, **what each thing on the
screen is doing and why it matters for the pattern**. The console should not steal the screen
when they are reading, and the Measure-it tab should read like the deck: a knob curve with
their own measurement on it, not a bare table.

Success: an attendee who has not seen the lecture can open any pattern, hover the ⓘ on any
card, tab, knob or button and learn what it does, why it matters and what to look for; and
on Measure it, see where their measured number sits on the pattern's curve and what each
statistic means.

## 1. Console dock

- **Collapsed** (default): a 40 px bar pinned to the bottom — lane tabs (SQL / MongoDB), run
  status text, History, a `▲ Console` affordance, and the pin toggle. Page content gets the full
  viewport minus 40 px.
- **Expanded**: ~45 vh (min 280 px, max 60 vh), the current editor + results layout.
- **Opens on**: pointer hover over the bar or panel (150 ms intent delay); keyboard focus
  entering the panel; `Load into console`; `Run` from a card; any run in flight; the keyboard shortcut
  Ctrl/⌘ + backtick toggles.
- **Closes on**: pointer leaving for 600 ms — **never** while the editor has focus, a run is in
  flight or queued, or the dock is pinned.
- **Pin** (📌): keeps it expanded; stored per browser in `localStorage` (wrapped in try/catch —
  no storage means unpinned).
- **Touch / no-hover devices** (`@media (hover: none)`): tap the bar to toggle; no auto-close.
- Motion: `transform: translateY` transition 180 ms; `prefers-reduced-motion` → no transition.
- Accessibility: the bar is a `button` with `aria-expanded` and `aria-controls`; focus order is
  unchanged; Esc from the editor collapses the dock only when not pinned and returns focus to
  the triggering control.
- The existing `hidden` behaviour (dock hidden on the event-mode sign-in screen) is unchanged.

## 2. Help popups and info graphics

### Where ⓘ appears

| Surface | Count (approx.) | Content key |
|---|---|---|
| Every query card (SQL `@step`, Mongo card) | ~47 | the statement's annotations |
| Pattern tabs: Document model, Converged, MongoDB API, Measure it | 4 × 6 | README front matter `help.tabs` |
| Knob tiles (Diversity, Read/write, Update locality) | 3 × 6 | README front matter `knobs[].help` |
| Reset this pattern, Run/Copy/Load buttons (shared) | ~4 shared | app-level `public/help/common.json` |

### Popup behaviour
- Opens on hover (desktop, 200 ms intent) or click/Enter/Space; closes on Esc, outside click, or
  pointer leave (unless opened by click). One popup open at a time.
- Positioned with a small, dependency-free placement routine (flip above/below, clamp to the
  viewport, 16 px gutter); max width 420 px; scrolls internally if tall.
- `role="dialog"` for click-opened (focus moves into it), `role="tooltip"` for hover; the ⓘ is
  a `button` with `aria-describedby` / `aria-haspopup`.
- All text inserted with `textContent`; figures are same-origin static SVG files loaded via
  `<img>` (no inline SVG from content, no `innerHTML`).

### Popup shape (every popup)
1. **What it does** — one line.
2. **Why it matters** — 1–2 lines tied to this pattern's knobs.
3. **What to look for** — what in the result proves the point (optional for tabs/knobs).
4. **Figure** — optional small deck-style graphic (≤ 400 × 240) with a one-line caption.

### Content source (lives with the lab content, not in the app)
- Statement annotations (parsed by the existing `sqlParser` / `mongoScript`, attached to the
  step the same way `@note` is):
  - `-- @why <text>` · `-- @look <text>` · `-- @figure <file>.svg <caption>` (SQL)
  - `// @why`, `// @look`, `// @figure` (mongosh cards)
  - `@note` stays the always-visible card subtitle; `@why`/`@look` go in the popup.
- README front matter additions per pattern:
  ```yaml
  help:
    tabs:
      document: { why: "...", look: "...", figure: "doc-shape.svg" }
      converged: { why: "...", look: "...", figure: "erd.svg" }
      mongo: { why: "...", look: "..." }
      measure: { why: "...", look: "..." }
  knobs:
    - { name: Diversity, setting: "...", help: "..." }   # help added to existing entries
  ```
- Missing annotations are allowed (no ⓘ rendered) — the loader never fails on absent help.
- The pattern loader (`src/content/patterns.js`) exposes `help` on steps, tabs and knobs via
  `/api/patterns/:id`; unit tests cover parsing and the absent case.

### Figures
- Static SVGs in `patterns/<id>/figures/`, served read-only at `/figures/<id>/<file>.svg`
  (path-validated: `^[a-z0-9-]+\.svg$`, pattern id from the loaded set only).
- Generated from the **same deck generators** (in the author's deck-generator repo, not part
  of this repository) by a small export script there; only the built SVGs are
  committed to this public repo. Per pattern: `erd.svg` (canonical ERD), `knobs.svg` (three
  gauges), `doc-shape.svg` (the document-model sketch), `model-curve.svg` (the deck's
  workload curve, used in §3). Palette/fonts follow the deck house style and render on both
  light and dark backgrounds (transparent background, tokens chosen for contrast in both).
- SVG rules: everything inside the frame, no collisions, ≥ 16 px padding, verified by
  rasterising each exported file before commit.

### Authoring
- Claude drafts all text in the author's voice (direct, physics-grounded, no marketing
  language; "Oracle AI Database 26ai"; no engine-internals claims such as in-place/partial
  update; never "the join is free").
- The author reviews the full text in one review document before it ships (a generated
  `docs/help-review.md` listing every entry by pattern, surface and statement).

## 3. Measure-it tab

### Layout (top to bottom)
1. **The two statements** (unchanged), each with its ⓘ.
2. **Measure it** button (unchanged behaviour).
3. **Curve panel (left, ~60%) + stats panel (right, ~40%)**; stacks vertically below 900 px.
4. **"What just happened"** explainer panel.

### Curve panel — "write amplification vs document size", with the live point
The deck's slide-C curves are **daily workload models** (reads + writes, illustrative units).
Measure it measures **one write** in bytes of redo. Plotting a single-write measurement on a
daily-workload axis would be dishonest, so the live panel plots the quantity Measure it
actually measures, on the knob that governs it:

- **x** = the pattern's size knob (log): 01 documents embedding the moved advisor · 02 CDR line
  items in the subscriber document · 03 readings in the bucket · 04 claims kept inline ·
  05 parts in the moved subtree · 06 clients embedded in the book.
- **y** = document-model redo ÷ converged redo for one write (log).
- **Calibrated line** = measured on 26ai Free at 4–5 sizes per pattern (same protocol as
  Measure it: in-memory undo off, warm-up, 3 runs, median), stored per pattern as data in
  README front matter (`measure.calibration: [{x, ratio}]`, plus `x_label`, `lab_x`). Drawn as
  a line with the measured points, labelled "measured on 26ai Free (reference run)".
- **Live marker** = this attendee's result: `x = lab_x` (the lab data's size), `y` = their
  measured redo ratio, labelled "you · 33× redo". A second, hollow marker shows the same run's
  block-change ratio.
- **Break-even band**: y = 1 drawn as a dashed line — above it the document model writes more.
- **Deck link**: a small thumbnail of the deck's workload curve (`model-curve.svg`) with the
  caption "the full workload picture — illustrative model from the deck (slides N–M)", opening
  enlarged in a popup. This keeps the deck graph on the tab without mixing its units into the
  live chart.
- Rendered as inline SVG built with DOM APIs (`createElementNS`) in `public/js/measure.js`;
  axes, ticks and labels follow the deck's chart style; resizes with the container.

### Stats panel
- Paired horizontal bars per statistic (redo size, db block changes, session logical reads,
  CPU), document = hot, converged = cool, **log scale** so a 33× and a 1.9× gap are both
  readable, ratio called out at the right (`32.8×`, `—` when not finite).
- Each statistic has an ⓘ with a plain-language explainer:
  - **redo size** — bytes the database must write to its log to make the change durable; the
    most direct measure of how much the write physically changed.
  - **db block changes** — how many data blocks the write touched.
  - **session logical reads** — blocks read (from cache) to find and change the data; the
    read-modify-write in the document model shows up here.
  - **CPU used by this session** — centiseconds; usually 0 at this size — honest, not hidden.
- Rows affected and elapsed ms shown as small print under the bars (not charted).

### "What just happened" panel (static text, per pattern where it differs)
- Both writes ran back to back in one exclusive slot (nobody else's work in the numbers);
  each side ran once unmeasured as a warm-up, then once measured, then rolled back — the lab
  data is unchanged.
- Why the **ratio** is the takeaway, not the bytes: bytes depend on this small lab dataset;
  the ratio shows how each model's write cost scales with the knob on the x-axis.
- Honest caveat: one session on 26ai Free; expect small run-to-run variance (± a block or a
  LOB chunk); say "same order of magnitude", not exact bytes.

## 4. Data and API changes

- `README.md` front matter per pattern: `help` (tabs), `knobs[].help`, `measure`
  (`x_label`, `lab_x`, `calibration[]`, `deck_slides`).
- Statement annotations `@why`, `@look`, `@figure` (SQL and mongosh).
- `/api/patterns/:id` returns the new fields; no other API change. The measure response is
  unchanged (the client computes ratios as today).
- New static route `/figures/<patternId>/<file>.svg` with strict validation.
- Calibration data is produced by a checked-in script `app/scripts/calibrate-measure.mjs`
  (runs against a scratch schema on the lab DB, never CMP_USER or WS_ schemas; drops it
  afterwards) — rerun when pattern data changes.

## 5. Testing

- Unit: annotation parsing (`@why/@look/@figure`, absent), front-matter parsing and
  validation, figure-path validation, the curve's scale/placement maths (log axes, marker
  position, non-finite handling), dock state machine (hover/focus/pin/run-in-flight rules)
  under jsdom.
- Integration: `/api/patterns/:id` includes help fields; `/figures/...` serves valid files and
  rejects traversal/unknown ids.
- Smoke (headless, light + dark): per pattern — the dock starts collapsed and expands on hover
  and on Load; an ⓘ on a card, a tab and a knob opens a popup with text; Measure it renders the
  curve with a live marker and the stats bars; screenshots reviewed for overlap/clipping.
- Accessibility spot-check: keyboard-only path opens a popup and toggles the dock.

## 6. Out of scope

- Changing the pattern SQL itself or the measured statements.
- Localisation.
- Help content for the admin page (instructors have the runbook).
- Replacing the deck's figures; the lab consumes exported copies.

## 7. Risks and decisions

- **Axis honesty (decided above):** the live chart plots per-write redo ratio vs the size knob,
  calibrated by measurement; the deck's workload curve appears as a linked thumbnail, not as the
  live chart's axis. *If the author prefers the workload curve as the live chart, the live
  point cannot be placed honestly on it — this is the one design choice to confirm on review.*
- **Content volume:** ~110 short entries; drafted in one pass, reviewed in one document.
- **Deck coupling:** figures are exported copies; a deck change needs a re-export (script run),
  not a lab code change.
- **Calibration drift:** stored reference data can go stale when pattern data changes; the
  calibration script is rerun and the smoke test checks that each pattern has ≥ 4 calibration
  points and a `lab_x` inside the calibrated range.
