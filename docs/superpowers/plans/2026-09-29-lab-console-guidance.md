# Lab Console Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lab console self-explaining. It has four parts:
- a console dock that slides up on demand;
- ⓘ help popups (with deck figures) on every card, tab, knob and button;
- a Measure-it tab that plots the attendee's measured write amplification on a calibrated curve;
- a deck-workload thumbnail and per-statistic explainers.

**Architecture:**
- **Help content.** It lives with the lab content: statement annotations (`@why/@look/@figure`) plus README front matter (`help`, `knobs[].help`, `measure`). The existing pattern loader parses it and serves it through `/api/patterns`.
- **Figures.** They are static SVGs exported from the author's deck generators, with light and dark theme tokens embedded, and served at `/figures/<pattern>/<file>.svg`.
- **Frontend.** Three new dependency-free ES modules (`dock.js`, `help.js`, `chart.js`) and a rewritten `measure.js`. Everything builds DOM with `textContent` or `createElementNS`, never `innerHTML`.

**Tech Stack:** Node 22 ESM, Express 5, node-oracledb 7 (Thin), yaml, acorn, vitest + jsdom, puppeteer-core (smoke); Python 3 (figure export, in the author's content repo).

**Spec:** `docs/superpowers/specs/2026-09-29-lab-console-guidance-design.md`

## Global Constraints

- This repository (`converged-modeling-patterns`), branch `feat/lab-guidance`. Never push without the author's approval. Never commit to `master`.
- The only other repo touched is the author's deck-generator repo (not part of this repository), and only in Task 2. There, add one new export script and nothing else. Do not commit in that repo.
- All DOM insertion goes through `textContent`, `createElement` or `createElementNS`. No `innerHTML`, `insertAdjacentHTML` or `outerHTML` anywhere.
- Figures load via `<img src="/figures/...">`. Figure file names must match `^[a-z0-9-]+\.svg$`, and the pattern id must be one of the loaded pattern ids.
- Always write "Oracle AI Database 26ai", never 23ai.
- Help text must make no engine-internals claims ("in place", "partial update", "never edits a block"). Never say or imply a join is free. Voice: direct, physics-grounded, no marketing adjectives.
- Theme: reuse the CSS tokens already in `app/public/css/lab.css` (`--hot --cool --flow --ink --muted --faint --hairline --panel --paper --chip`). Everything must render in light and dark mode.
- Docker: never recreate `cmp-oracle` or `cmp-lab-ui`, never `down -v`, never prune, never start a second compose project (fixed container names collide). The running lab is in **event mode** with secrets in `.env`. Anything that connects to the DB from the host (integration tests, the host-run console, the calibration script) runs with `.env` sourced (`set -a; . ../.env; set +a`) so LAB_ADMIN's password is never reset. Unit tests need no database.
- Every commit message ends with the standard co-author trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Review Focus

1. **A pattern with no help content at all** (for example a newly added pattern). The page renders exactly as today, with no ⓘ, no errors and no broken tabs. Covered by the Task 1 loader test "absent help" and the Task 5 help test "no trigger when content is empty".
2. **The dock while the attendee is typing, or while a run is queued.** It never collapses under them, even when the pointer leaves. Covered by the Task 4 dock test "stays open while focused / busy".
3. **A measure result with an error side or zero converged redo.** The curve shows no marker for an invalid ratio, and the chart never shows NaN or Infinity. Covered by the Task 6 test "no marker when ratio not finite".
4. **A figure name that tries path traversal or an unknown pattern.** The server returns 404 and never reads outside `patterns/<id>/figures`. Covered by the Task 1 route test.
5. **Help popups near the viewport edge, and on small screens.** The popup stays fully visible, clamped with a 16 px gutter. Covered by the Task 5 placement unit test and the Task 8 smoke screenshots at 1440 and 800 px widths.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `app/src/content/sqlParser.js` | modify | parse `@why`, `@look` and `@figure` annotations |
| `app/src/content/mongoScript.js` | modify | the same annotations for mongosh cards |
| `app/src/content/patterns.js` | modify | front matter `help`, `knobs[].help` and `measure`; validate them |
| `app/src/routes/api.js` | modify | expose help fields in `/api/patterns` |
| `app/src/routes/figures.js` | create | `GET /figures/:pattern/:file` with strict validation |
| `app/src/server.js` | modify | mount the figures router |
| `app/public/js/dock.js` | create | console dock state machine |
| `app/public/js/help.js` | create | ⓘ trigger + popover (placement, a11y) |
| `app/public/js/chart.js` | create | log-log curve + live marker (pure SVG builder) |
| `app/public/js/measure.js` | rewrite | curve panel, log bars, explainers |
| `app/public/js/app.js` | modify | wire the dock, help and new measure card |
| `app/public/help/common.json` | create | shared help for Copy, Load, Run and Reset |
| `app/public/css/lab.css` | modify | dock, popover and measure layout styles |
| `app/public/index.html` | modify | dock bar markup (pin, ▲ affordance) |
| `app/scripts/calibrate-measure.mjs` | create | measures the redo ratio at several sizes per pattern |
| `patterns/<id>/calibrate.sql` | create (×6) | scales the pattern's size knob to `:n` |
| `patterns/<id>/figures/*.svg` | create (×6) | exported deck figures |
| `patterns/<id>/README.md` | modify (×6) | front matter `help`, knob help and `measure` |
| `patterns/<id>/0*.sql`, `*.js` | modify (×6) | `@why`, `@look` and `@figure` annotations |
| `app/scripts/help-review.mjs` | create | generates `docs/help-review.md` for the author |
| `app/test/unit/*.test.js` | create/modify | tests per task |
| `app/test/smoke/smoke.mjs` | modify | dock, help and measure checks |
| export script in the author's deck-generator repo (not part of this repository) | create | export deck figures into the lab repo |

**Figure mapping.** This refines spec §2 to what the deck generators actually produce.

| Deck function | Lab file | Used by |
|---|---|---|
| `fig_doc()` | `doc-shape.svg` | Document model tab help |
| `fig_model()` | `erd.svg` | Converged tab help |
| `fig_knobs()` | `model-curve.svg` | knob tile help, and the Measure-it deck thumbnail (the deck draws its gauges and workload curve as one figure) |
| `fig_flow()` | `flow.svg` | MongoDB API tab help |

---

### Task 1: Content model: annotations, front matter, API, figures route

**Files:**
- Modify: `app/src/content/sqlParser.js`, `app/src/content/mongoScript.js`, `app/src/content/patterns.js`, `app/src/routes/api.js`, `app/src/server.js`
- Create: `app/src/routes/figures.js`
- Test: `app/test/unit/sqlParser.test.js`, `app/test/unit/mongoScript.test.js`, `app/test/unit/patterns.test.js`, `app/test/unit/figures.test.js`

**Interfaces:**
- Produces:
  - Each parsed SQL statement and mongo step gains `help: { why: string|null, look: string|null, figure: { file, caption }|null }`.
  - `loadPatterns()` items gain `meta.help` (`{ tabs: { document?, converged?, mongo?, measure? } }`, each `{ why, look, figure }`), `meta.knobs[i].help` (string or null), and `meta.measure` (`{ xLabel, labX, deckSlides, calibration: [{ x, ratio }] }` or null).
  - `/api/patterns` cards gain `help`, and pattern objects carry `meta` unchanged in shape but with the new fields.
  - `GET /figures/:pattern/:file` serves `image/svg+xml`, or 404.

- [ ] **Step 1: Write the failing parser tests**

Append to `app/test/unit/sqlParser.test.js`:
```js
describe('help annotations', () => {
  it('attaches @why, @look and @figure to the next statement', () => {
    const [s] = parseSqlFile([
      '-- @step Read it',
      '-- @why Because the read is one document.',
      '-- @look The row count stays at 1.',
      '-- @figure doc-shape.svg The document as built',
      'SELECT 1 FROM dual;',
    ].join('\n'));
    expect(s.help).toEqual({ why: 'Because the read is one document.', look: 'The row count stays at 1.', figure: { file: 'doc-shape.svg', caption: 'The document as built' } });
  });
  it('defaults help to nulls and joins repeated @why lines', () => {
    const [a, b] = parseSqlFile('-- @step A\nSELECT 1 FROM dual;\n-- @step B\n-- @why one\n-- @why two\nSELECT 2 FROM dual;');
    expect(a.help).toEqual({ why: null, look: null, figure: null });
    expect(b.help.why).toBe('one two');
  });
  it('rejects a @figure file name that is not a plain .svg', () => {
    expect(() => parseSqlFile('-- @step A\n-- @figure ../x.svg c\nSELECT 1 FROM dual;')).toThrow(/@figure/);
  });
});
```

Append to `app/test/unit/mongoScript.test.js`:
```js
describe('help annotations (mongo)', () => {
  it('attaches // @why, @look and @figure to the step', () => {
    const [s] = parseMongoScript('// @step Find\n// @why One document.\n// @look count is 1\n// @figure flow.svg The flow\ndb.c.find({})\n');
    expect(s.help).toEqual({ why: 'One document.', look: 'count is 1', figure: { file: 'flow.svg', caption: 'The flow' } });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npx vitest run test/unit/sqlParser.test.js test/unit/mongoScript.test.js`
Expected: FAIL. `s.help` is undefined.

- [ ] **Step 3: Implement the annotations**

In `app/src/content/sqlParser.js`, replace the `ANNOT` constant and add a shared helper:
```js
const ANNOT = /^--\s*@(step|note|measure|why|look|figure)\b\s*(.*)$/i;
const FIGURE = /^([a-z0-9-]+\.svg)\s+(.+)$/;

// Shared by the SQL and mongosh parsers: fold one help annotation into an accumulator.
export function addHelp(help, kind, val, where = 'annotation') {
  if (kind === 'figure') {
    const f = val.match(FIGURE);
    if (!f) throw new Error(`${where}: @figure needs "<name>.svg <caption>" with a plain file name`);
    help.figure = { file: f[1], caption: f[2].trim() };
  } else {
    help[kind] = help[kind] ? `${help[kind]} ${val}` : val;
  }
}
const emptyHelp = () => ({ why: null, look: null, figure: null });
```
In `parseSqlFile`, change the annotation accumulator and the flush:
```js
      out.push({ sql, title: anno?.title ?? null, notes: anno?.notes ?? [], measure: anno?.measure ?? null,
        help: anno?.help ?? emptyHelp(), plsql, line: startLine });
```
and in `handle`:
```js
      if (a) {
        anno ??= { title: null, notes: [], measure: null, help: emptyHelp() };
        const kind = a[1].toLowerCase();
        const val = a[2].trim();
        if (kind === 'step') anno.title = val;
        else if (kind === 'note') anno.notes.push(val);
        else if (kind === 'measure') anno.measure = val;
        else addHelp(anno.help, kind, val, `line ${idx + 1}`);
        return;
      }
```
In `app/src/content/mongoScript.js`:
```js
import { addHelp } from './sqlParser.js';
const ANNOT = /^\s*@(step|note|why|look|figure)\b\s*(.*)$/i;
```
and when pushing a step:
```js
    const help = { why: null, look: null, figure: null };
    for (const x of mine) {
      const k = x.m[1].toLowerCase();
      if (k === 'why' || k === 'look' || k === 'figure') addHelp(help, k, x.m[2].trim(), where);
    }
    steps.push({
      title: stepAnno.m[2].trim(),
      notes: mine.filter((x) => x.m[1].toLowerCase() === 'note').map((x) => x.m[2].trim()),
      help,
      command,
      line: st.loc.start.line,
    });
```

- [ ] **Step 4: Run the parser tests**

Run: `cd app && npx vitest run test/unit/sqlParser.test.js test/unit/mongoScript.test.js`
Expected: PASS, with all earlier tests still green.

- [ ] **Step 5: Write the failing front-matter tests**

Append to `app/test/unit/patterns.test.js`, reusing its `fixture`, `DOC` and `CONV` helpers:
```js
const FM_HELP = `---
title: T
industry: I
deck: "14–17"
problem: P
knobs:
  - { name: Diversity, setting: High, help: "Four consumers read it." }
  - { name: Read / write, setting: Reads }
  - { name: Update locality, setting: Fans out, hot: true }
help:
  tabs:
    document: { why: "The starting point.", look: "One read.", figure: "doc-shape.svg" }
    measure: { why: "Same write, both models." }
measure:
  x_label: "CDR line items in the document"
  lab_x: 1000
  deck_slides: "18–21"
  calibration:
    - { x: 10, ratio: 1.2 }
    - { x: 100, ratio: 5 }
    - { x: 1000, ratio: 33 }
    - { x: 5000, ratio: 260 }
---
# body
`;

describe('help and measure front matter', () => {
  it('parses tab help, knob help and measure calibration', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM_HELP, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.meta.knobs[0].help).toBe('Four consumers read it.');
    expect(p.meta.knobs[1].help).toBeNull();
    expect(p.meta.help.tabs.document).toEqual({ why: 'The starting point.', look: 'One read.', figure: { file: 'doc-shape.svg', caption: null } });
    expect(p.meta.help.tabs.converged).toBeUndefined();
    expect(p.meta.measure).toEqual({ xLabel: 'CDR line items in the document', labX: 1000, deckSlides: '18–21',
      calibration: [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }] });
  });
  it('absent help and measure give empty structures, not errors', () => {
    const [p] = loadPatterns(fixture({ 'README.md': FM, '01-document-model.sql': DOC, '02-converged.sql': CONV }));
    expect(p.meta.help).toEqual({ tabs: {} });
    expect(p.meta.measure).toBeNull();
    expect(p.meta.knobs.every((k) => k.help === null)).toBe(true);
  });
  it('rejects a calibration with fewer than 4 points or lab_x outside the range', () => {
    const bad = FM_HELP.replace('lab_x: 1000', 'lab_x: 99999');
    expect(() => loadPatterns(fixture({ 'README.md': bad, '01-document-model.sql': DOC, '02-converged.sql': CONV }))).toThrow(/lab_x/);
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `cd app && npx vitest run test/unit/patterns.test.js`
Expected: FAIL. `knobs[0].help`, `meta.help` and `meta.measure` are undefined.

- [ ] **Step 7: Implement the front matter parsing**

In `app/src/content/patterns.js`, inside `frontMatter()`, replace the `return` with:
```js
  const FIG = /^[a-z0-9-]+\.svg$/;
  const tabHelp = (t, k) => {
    if (t == null) return undefined;
    if (t.figure != null && !FIG.test(String(t.figure))) throw new Error(`${file}: help.tabs.${k}.figure must be a plain .svg name`);
    return { why: t.why ? String(t.why) : null, look: t.look ? String(t.look) : null,
      figure: t.figure ? { file: String(t.figure), caption: t.caption ? String(t.caption) : null } : null };
  };
  const tabs = {};
  for (const k of ['document', 'converged', 'mongo', 'measure']) {
    const v = tabHelp(fm.help?.tabs?.[k], k);
    if (v) tabs[k] = v;
  }
  let measure = null;
  if (fm.measure) {
    const cal = (fm.measure.calibration ?? []).map((c) => ({ x: Number(c.x), ratio: Number(c.ratio) }));
    if (cal.length < 4 || cal.some((c) => !(c.x > 0) || !(c.ratio > 0))) throw new Error(`${file}: measure.calibration needs ≥ 4 points with x > 0 and ratio > 0`);
    cal.sort((a, b) => a.x - b.x);
    const labX = Number(fm.measure.lab_x);
    if (!(labX >= cal[0].x && labX <= cal[cal.length - 1].x)) throw new Error(`${file}: measure.lab_x must lie inside the calibrated x range`);
    measure = { xLabel: String(fm.measure.x_label), labX, deckSlides: String(fm.measure.deck_slides ?? fm.deck), calibration: cal };
  }
  return {
    title: String(fm.title),
    industry: String(fm.industry),
    deck: String(fm.deck),
    problem: String(fm.problem).trim(),
    knobs: fm.knobs.map((k) => ({ name: String(k.name), setting: String(k.setting), hot: k.hot === true, help: k.help ? String(k.help) : null })),
    help: { tabs },
    measure,
  };
```

- [ ] **Step 8: Run the tests**

Run: `cd app && npx vitest run test/unit/patterns.test.js`
Expected: PASS.

- [ ] **Step 9: Expose help in the API**

In `app/src/routes/api.js`, change the `/patterns` card mappers:
```js
      document: p.lanes.document.map(({ title, notes, sql, measure, help }) => ({ title, notes, sql, measure, help })),
      converged: p.lanes.converged.map(({ title, notes, sql, measure, help }) => ({ title, notes, sql, measure, help })),
      mongo: p.lanes.mongo.map(({ title, notes, command, help }) => ({ title, notes, command, help })),
    },
    measures: p.measures.map((m) => ({ tag: m.tag, documentSql: m.document.sql, convergedSql: m.converged.sql,
      help: { document: m.document.help, converged: m.converged.help } })),
```

- [ ] **Step 10: Write the failing figures-route test**

Create `app/test/unit/figures.test.js`:
```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { figuresRouter } from '../../src/routes/figures.js';

function app() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-'));
  fs.mkdirSync(path.join(root, '02-computed', 'figures'), { recursive: true });
  fs.writeFileSync(path.join(root, '02-computed', 'figures', 'erd.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'secret.svg'), '<svg/>');
  const a = express();
  a.use('/figures', figuresRouter({ cfg: { patternsDir: root }, patterns: [{ id: '02-computed' }] }));
  return a;
}

describe('GET /figures/:pattern/:file', () => {
  it('serves a known figure as svg', async () => {
    const r = await request(app()).get('/figures/02-computed/erd.svg');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it.each([
    '/figures/99-nope/erd.svg',
    '/figures/02-computed/missing.svg',
    '/figures/02-computed/..%2Fsecret.svg',
    '/figures/02-computed/ERD.SVG',
    '/figures/02-computed/erd.svg.js',
  ])('404 for %s', async (u) => {
    expect((await request(app()).get(u)).status).toBe(404);
  });
});
```

- [ ] **Step 11: Run to see it fail**

Run: `cd app && npx vitest run test/unit/figures.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 12: Implement the route**

Create `app/src/routes/figures.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const NAME = /^[a-z0-9-]+\.svg$/;

// Serves exported deck figures from patterns/<id>/figures/. The pattern id must be a loaded
// pattern and the file a plain lower-case .svg name, so nothing outside that folder is reachable.
export function figuresRouter({ cfg, patterns }) {
  const r = express.Router();
  const ids = new Set(patterns.map((p) => p.id));
  r.get('/:pattern/:file', (req, res) => {
    const { pattern, file } = req.params;
    if (!ids.has(pattern) || !NAME.test(file)) return res.status(404).end();
    const full = path.join(cfg.patternsDir, pattern, 'figures', file);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.set('Content-Type', 'image/svg+xml');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(full);
  });
  return r;
}
```
In `app/src/server.js` `createApp`, import it and mount it before the static middleware:
```js
import { figuresRouter } from './routes/figures.js';
// ...
  app.use('/figures', figuresRouter(deps));
```

- [ ] **Step 13: Run the unit suite**

Run: `cd app && npx vitest run test/unit`
Expected: PASS, all green.

- [ ] **Step 14: Commit**

```bash
git add app/src app/test/unit
git commit -m "feat(lab-ui): help annotations, front-matter help/measure, figures route"
```

---

### Task 2: Export deck figures into the lab repo

**Files:**
- Create: an export script in the author's deck-generator repo (not part of this repository; not committed here — the author commits that repo)
- Create: `patterns/<id>/figures/{doc-shape,erd,model-curve,flow}.svg` for all 6 patterns (committed in the lab repo)

**Interfaces:**
- Consumes: the deck generator's per-pattern figure functions `fig_doc()`, `fig_model()`, `fig_knobs()`, `fig_flow()` → `Fig`; `Fig.svg()` → str using `var(--token)` colours.
- Produces: 24 standalone SVGs that render with correct colours inside `<img>`. They carry their own `<style>` with light tokens and `@media (prefers-color-scheme: dark)` tokens, and a transparent background.

- [ ] **Step 1: Write the export script**

In the author's deck-generator repo (not part of this repository), write a small export script. For each of the six patterns it imports that pattern's deck figure module and calls the four figure functions, mapped `doc-shape` ← `fig_doc`, `erd` ← `fig_model`, `model-curve` ← `fig_knobs`, `flow` ← `fig_flow`. The deck SVGs colour everything with CSS custom properties (`var(--hot)` …), which an `<img>` cannot see from the host page, so the script injects a `<style>` right after the `<svg …>` root that defines the same tokens the lab uses (`--paper --panel --ink --muted --faint --hairline --hot --cool --flow --chip`, plus `--hot-soft --cool-soft --flow-soft`), once for light and once under `@media (prefers-color-scheme: dark)`, and writes each result to `patterns/<id>/figures/<name>.svg` under the lab's `patterns/` directory, which it takes as its only argument. It prints one line per file with its size.

- [ ] **Step 2: Run the export**

Run the export script from the author's deck-generator repo, passing this repository's `patterns/` directory.
Expected: 24 lines like `02-computed/erd.svg  18,432 B`. Each `Fig.svg()` call runs the deck's own collision checks, so a `FigureError` here means a deck bug; stop and report it.

- [ ] **Step 3: Verify by rasterising (light and dark)**

Run from the lab repo, reusing puppeteer-core from `app/node_modules`:
```bash
cd app && node -e '
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";
(async () => { const b = await puppeteer.launch({ executablePath: chrome, headless: "new" });
  const p = await b.newPage(); const out = "test/artifacts/figures"; fs.mkdirSync(out, { recursive: true });
  for (const scheme of ["light", "dark"]) { await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    for (const d of fs.readdirSync("../patterns").filter((n) => /^\d\d-/.test(n))) for (const f of fs.readdirSync(`../patterns/${d}/figures`)) {
      await p.setContent(`<body style="margin:0;background:${scheme === "dark" ? "#1A232E" : "#fff"}"><img style="width:900px" src="data:image/svg+xml;base64,${fs.readFileSync(`../patterns/${d}/figures/${f}`).toString("base64")}"></body>`);
      await p.screenshot({ path: `${out}/${d}-${f.replace(".svg", "")}-${scheme}.png`, fullPage: true }); } }
  await b.close(); })();'
```
Expected: 48 PNGs. Open at least one figure per pattern in each scheme and confirm that:
- the colours are correct, not black-only;
- the text is legible on the dark background;
- nothing is clipped or overlapping.

If Chrome is elsewhere, use the path the smoke test auto-detects.

- [ ] **Step 4: Commit (lab repo only)**

From the repository root:
```bash
git add patterns/*/figures
git commit -m "feat(patterns): deck figures exported for in-lab help (light + dark tokens)"
```

---

### Task 3: Calibrate measure-it (redo ratio vs size knob) for all 6 patterns

**Files:**
- Create: `app/scripts/calibrate-measure.mjs`, `patterns/<id>/calibrate.sql` (×6)
- Modify: `patterns/<id>/README.md` (×6), adding the `measure:` block

**Interfaces:**
- Consumes:
  - `app/src/db/oracle.js` `readStats(conn)`
  - `app/src/content/sqlParser.js` `parseSqlFile`
  - `app/src/content/patterns.js` `loadPatterns`
  - test env conventions (`DB_HOST`, `DB_PORT`, `ORACLE_PASSWORD`)
- Produces: README front matter `measure: { x_label, lab_x, deck_slides, calibration: [{x, ratio}] }` for each pattern. Task 6 consumes it.

**Size knob per pattern.** This is the x-axis. `lab_x` is the value the lab data already has; read it from the pattern SQL and confirm it.

| Pattern | x_label | Suggested sizes |
|---|---|---|
| 01-extended-reference | "documents embedding the moved advisor" | 1, 10, 100, 1000 |
| 02-computed | "CDR line items in the subscriber document" | 10, 100, 1000, 5000 (lab_x 1000) |
| 03-bucket | "readings already in the bucket" | 3, 100, 1000, 3600 |
| 04-subset | "claims kept inline in the policy document" | 3, 10, 100, 1000 |
| 05-tree-hierarchy | "parts in the moved subtree" | 3, 30, 300, 3000 |
| 06-outlier | "clients embedded in the advisor's book" | 10, 100, 800, 2000 (lab_x 800) |

- [ ] **Step 1: Write the per-pattern scale scripts**

For each pattern, write `patterns/<id>/calibrate.sql`. It is a SQL*Plus-free script (parsed by `parseSqlFile`) that, after the pattern's own setup has run, resizes **both** models' data to size `:n`. It uses only statements the parser accepts and binds `:n` wherever the size appears. Both sides must hold the same logical data at every size, as in the 14b rescale.

This step needs judgement, so read the pattern's two SQL files before writing its scale script. Example for 02, from the spike (`generated` means `CONNECT BY LEVEL <= :n`):
```sql
-- Resize S-001 to :n CDR line items on both sides.
UPDATE cp_subscriber_doc SET data = JSON_TRANSFORM(data,
  SET '$.usage' = (SELECT JSON_ARRAYAGG(JSON_OBJECT('cdrId' VALUE level, 'ts' VALUE TIMESTAMP '2026-09-01 00:00:00' + NUMTODSINTERVAL(level, 'MINUTE'),
                        'mb' VALUE 50, 'min' VALUE 5, 'cost' VALUE 0.15) RETURNING JSON) FROM dual CONNECT BY LEVEL <= :n))
WHERE JSON_VALUE(data,'$._id') = 'S-001';
DELETE FROM cp_cdr WHERE subscriber_id = 'S-001';
INSERT INTO cp_cdr (subscriber_id, mb, minutes, cost) SELECT 'S-001', 50, 5, 0.15 FROM dual CONNECT BY LEVEL <= :n;
COMMIT;
```

- [ ] **Step 2: Write the calibration harness**

Create `app/scripts/calibrate-measure.mjs`:
```js
// Measures document-model redo ÷ converged redo for each pattern's @measure pair at several
// sizes of its size knob, in a scratch schema on the lab database (never CMP_USER or WS_*).
// Protocol = the console's Measure it: in-memory undo off, one unmeasured warm-up, then 3
// measured runs (median), each rolled back. Prints YAML to paste into each README's front matter.
//
// Usage: DB_HOST=localhost DB_PORT=1522 ORACLE_PASSWORD=... node scripts/calibrate-measure.mjs [patternId ...]
import fs from 'node:fs';
import path from 'node:path';
import oracledb from 'oracledb';
import { loadPatterns } from '../src/content/patterns.js';
import { parseSqlFile } from '../src/content/sqlParser.js';
import { readStats } from '../src/db/oracle.js';

const ROOT = path.resolve(import.meta.dirname, '../../patterns');
const SIZES = {
  '01-extended-reference': [1, 10, 100, 1000],
  '02-computed': [10, 100, 1000, 5000],
  '03-bucket': [3, 100, 1000, 3600],
  '04-subset': [3, 10, 100, 1000],
  '05-tree-hierarchy': [3, 30, 300, 3000],
  '06-outlier': [10, 100, 800, 2000],
};
const USER = 'ZZ_CALIBRATE';
const PW = 'Calibrate2026x';
const host = process.env.DB_HOST ?? 'localhost';
const port = process.env.DB_PORT ?? '1522';
const connectString = `${host}:${port}/FREEPDB1`;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function asSystem(fn) {
  const c = await oracledb.getConnection({ user: 'system', password: process.env.ORACLE_PASSWORD, connectString });
  try { return await fn(c); } finally { await c.close(); }
}

async function run(conn, stmts, binds = {}) {
  for (const s of stmts) {
    const b = s.sql.includes(':n') ? binds : {};
    await conn.execute(s.sql, b);
  }
}

async function measureOnce(conn, sql) {
  const before = await readStats(conn);
  await conn.execute(sql);
  const after = await readStats(conn);
  await conn.rollback();
  return after['redo size'] - before['redo size'];
}

async function calibrate(p) {
  const conn = await oracledb.getConnection({ user: USER, password: PW, connectString });
  try {
    await conn.execute('ALTER SESSION SET "_in_memory_undo" = false');
    await run(conn, p.setup.document);
    await run(conn, p.setup.converged);
    await conn.commit();
    const scale = parseSqlFile(fs.readFileSync(path.join(ROOT, p.id, 'calibrate.sql'), 'utf8'));
    const m = p.measures[0];
    const points = [];
    for (const n of SIZES[p.id]) {
      await run(conn, scale, { n });
      await conn.commit();
      await measureOnce(conn, m.document.sql);
      await measureOnce(conn, m.converged.sql);
      const d = []; const c = [];
      for (let i = 0; i < 3; i++) { d.push(await measureOnce(conn, m.document.sql)); c.push(await measureOnce(conn, m.converged.sql)); }
      const ratio = median(d) / median(c);
      points.push({ x: n, ratio: Number(ratio.toFixed(2)), doc: median(d), conv: median(c) });
      console.error(`${p.id} n=${n}: doc ${median(d)} B · conv ${median(c)} B · ${ratio.toFixed(1)}×`);
    }
    return points;
  } finally { await conn.close(); }
}

const only = process.argv.slice(2);
const patterns = loadPatterns(ROOT).filter((p) => !only.length || only.includes(p.id));
await asSystem(async (c) => {
  await c.execute(`BEGIN EXECUTE IMMEDIATE 'DROP USER ${USER} CASCADE'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -1918 THEN RAISE; END IF; END;`);
  await c.execute(`CREATE USER ${USER} IDENTIFIED BY "${PW}" QUOTA UNLIMITED ON users`);
  await c.execute(`GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE TRIGGER, CREATE SEQUENCE, CREATE PROCEDURE, SELECT ANY DICTIONARY TO ${USER}`);
  await c.execute(`GRANT ALTER SESSION TO ${USER}`);
});
try {
  for (const p of patterns) {
    const pts = await calibrate(p);
    console.log(`# ${p.id}\nmeasure:\n  calibration:\n${pts.map((q) => `    - { x: ${q.x}, ratio: ${q.ratio} }   # doc ${q.doc} B, conv ${q.conv} B`).join('\n')}\n`);
  }
} finally {
  await asSystem((c) => c.execute(`DROP USER ${USER} CASCADE`));
}
```

- [ ] **Step 3: Run it against the lab database**

The lab DB listens on `localhost:1522`. `ORACLE_PASSWORD` is the compose default unless `.env` overrides it. `ZZ_CALIBRATE` is a scratch user that the script creates and drops.

Run: `cd app && (set -a; . ../.env; set +a; ORACLE_PASSWORD=${ORACLE_PASSWORD:-Sandbox2026} node scripts/calibrate-measure.mjs) 2>&1 | tee test/artifacts/calibration.txt`

Expected, for every pattern:
- 4 points;
- the ratio grows with `x`;
- the ratio is greater than 1 at `lab_x`.

If a pattern's ratio does not rise with its knob, stop and report the numbers. That is a content finding for the author, not something to tune away.

- [ ] **Step 4: Write the measure blocks**

Add to each `patterns/<id>/README.md` front matter:
```yaml
measure:
  x_label: "<from the table above>"
  lab_x: <lab data's value>
  deck_slides: "<the pattern's deck slides, as in deck:>"
  calibration:
    - { x: ..., ratio: ... }   # from calibration.txt (keep the doc/conv bytes comment)
```

- [ ] **Step 5: Verify loading**

Run: `cd app && npx vitest run test/unit/patterns.test.js && node -e "import('./src/content/patterns.js').then(m=>console.log(m.loadPatterns('../patterns').map(p=>[p.id,p.meta.measure.labX,p.meta.measure.calibration.length])))"`
Expected: 6 rows, each with `labX` and `4`.

- [ ] **Step 6: Commit**

```bash
git add app/scripts/calibrate-measure.mjs patterns/*/calibrate.sql patterns/*/README.md
git commit -m "feat(patterns): measured redo-ratio calibration per pattern for the measure-it curve"
```

---

### Task 4: Console dock (slide-up)

**Files:**
- Create: `app/public/js/dock.js`, `app/test/unit/dock.test.js`
- Modify: `app/public/index.html`, `app/public/css/lab.css`, `app/public/js/app.js`, `app/public/js/console.js`

**Interfaces:**
- Produces: `class Dock(root, { storage })` with:
  - `open(reason)` and `close()`
  - `setBusy(bool)`
  - `togglePin()`, `get expanded`, `get pinned`
  - It emits nothing. It toggles `root.classList` `expanded`, `pinned` and `busy`, plus `aria-expanded` on `#dock-toggle`.
- Consumes: `Console.load()` and `Console.run()`, which call `dock.open('load' | 'run')` and `dock.setBusy()`.

- [ ] **Step 1: Write the failing dock tests**

Create `app/test/unit/dock.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dock } from '../../public/js/dock.js';

function mk() {
  document.body.innerHTML = '';
  const root = document.createElement('section'); root.id = 'console';
  const bar = document.createElement('div'); bar.className = 'bar';
  const t = document.createElement('button'); t.id = 'dock-toggle';
  const pin = document.createElement('button'); pin.id = 'dock-pin';
  const ed = document.createElement('div'); ed.className = 'editor'; ed.tabIndex = 0;
  bar.append(t, pin); root.append(bar, ed); document.body.append(root);
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  return { root, t, pin, ed, storage, dock: new Dock(root, { storage }) };
}

describe('Dock', () => {
  beforeEach(() => vi.useFakeTimers());

  it('starts collapsed with aria-expanded=false', () => {
    const { root, t } = mk();
    expect(root.classList.contains('expanded')).toBe(false);
    expect(t.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens on hover after the intent delay and closes 600 ms after leaving', () => {
    const { root } = mk();
    root.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(149);
    expect(root.classList.contains('expanded')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(true);
    root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(599);
    expect(root.classList.contains('expanded')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(false);
  });
  it('stays open while focused, busy or pinned', () => {
    const { root, ed, dock } = mk();
    dock.open('hover');
    ed.focus(); root.dispatchEvent(new Event('focusin'));
    root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
    ed.blur(); root.dispatchEvent(new Event('focusout'));
    dock.setBusy(true); root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
    dock.setBusy(false); dock.togglePin(); root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
  });
  it('remembers the pin in storage and tolerates storage that throws', () => {
    const { storage, dock } = mk();
    dock.togglePin();
    expect(storage.getItem('lab.dock.pinned')).toBe('true');
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => new Dock(document.getElementById('console'), { storage: bad }).togglePin()).not.toThrow();
  });
  it('the toggle button opens and closes explicitly', () => {
    const { root, t } = mk();
    t.click(); expect(root.classList.contains('expanded')).toBe(true);
    t.click(); expect(root.classList.contains('expanded')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd app && npx vitest run test/unit/dock.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement dock.js**

Create `app/public/js/dock.js`:
```js
// Console dock: a 40 px bar that slides the console up on hover, focus, load or run, and back
// down 600 ms after the pointer leaves, unless the editor has focus, a run is in flight or the
// dock is pinned. Touch devices (no hover) toggle on tap only.
const OPEN_DELAY = 150;
const CLOSE_DELAY = 600;
const KEY = 'lab.dock.pinned';

export class Dock {
  constructor(root, { storage = globalThis.localStorage } = {}) {
    this.root = root;
    this.storage = storage;
    this.toggle = root.querySelector('#dock-toggle');
    this.pinBtn = root.querySelector('#dock-pin');
    this.focused = false; this.busy = false; this.timer = null;
    this.hoverable = globalThis.matchMedia?.('(hover: hover)').matches ?? true;
    this.#setPinned(this.#read() === 'true');
    this.#render(this.pinned);
    if (this.hoverable) {
      root.addEventListener('pointerenter', () => this.#schedule(() => this.open('hover'), OPEN_DELAY));
      root.addEventListener('pointerleave', () => this.#schedule(() => this.close(), CLOSE_DELAY));
    }
    root.addEventListener('focusin', () => { this.focused = true; this.open('focus'); });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) this.focused = false; });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.pinned) { this.focused = false; this.close(true); this.toggle?.focus(); } });
    this.toggle?.addEventListener('click', () => (this.expanded ? this.close(true) : this.open('toggle')));
    this.pinBtn?.addEventListener('click', () => this.togglePin());
    globalThis.addEventListener?.('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); this.expanded ? this.close(true) : this.open('key'); } });
  }

  get expanded() { return this.root.classList.contains('expanded'); }

  open() { clearTimeout(this.timer); this.#render(true); }

  close(force = false) {
    clearTimeout(this.timer);
    if (this.pinned || this.busy || (this.focused && !force)) return;
    this.#render(false);
  }

  setBusy(on) { this.busy = on; this.root.classList.toggle('busy', on); if (on) this.open('run'); }

  togglePin() {
    this.#setPinned(!this.pinned);
    try { this.storage?.setItem(KEY, String(this.pinned)); } catch { /* storage unavailable */ }
    if (this.pinned) this.open('pin');
  }

  #setPinned(v) {
    this.pinned = v;
    this.root.classList.toggle('pinned', v);
    this.pinBtn?.setAttribute('aria-pressed', String(v));
  }

  #read() { try { return this.storage?.getItem(KEY); } catch { return null; } }

  #schedule(fn, ms) { clearTimeout(this.timer); this.timer = setTimeout(fn, ms); }

  #render(on) {
    this.root.classList.toggle('expanded', on);
    this.toggle?.setAttribute('aria-expanded', String(on));
    if (this.toggle) this.toggle.textContent = on ? '▼ Console' : '▲ Console';
  }
}
```

- [ ] **Step 4: Run the dock tests**

Run: `cd app && npx vitest run test/unit/dock.test.js`
Expected: PASS.

- [ ] **Step 5: Markup, CSS and wiring**

In `app/public/index.html`, make the bar's first children the toggle and the pin:
```html
  <div class="bar">
    <button type="button" class="dock-toggle" id="dock-toggle" aria-expanded="false" aria-controls="console-panes">▲ Console</button>
    <div class="tabs" role="tablist">
      <button type="button" data-lane="sql" class="on">SQL</button>
      <button type="button" data-lane="mongo">MongoDB</button>
    </div>
    <button type="button" class="btn primary" id="run">Run ⌘/Ctrl+Enter</button>
    <button type="button" class="btn" id="history">History</button>
    <span class="status" id="status">ready</span>
    <button type="button" class="dock-pin" id="dock-pin" aria-pressed="false" title="Keep the console open">📌</button>
  </div>
  <div class="panes" id="console-panes">
```
In `app/public/css/lab.css`, replace the `#console { ... }` rule and the `main#view` bottom padding:
```css
main#view { padding: 20px 24px 64px; max-width: 1180px; margin: 0 auto; }
#console { position: fixed; left: 0; right: 0; bottom: 0; height: clamp(280px, 45vh, 60vh); background: var(--panel); border-top: 1px solid var(--hairline);
  display: grid; grid-template-rows: auto 1fr; transform: translateY(calc(100% - 42px)); transition: transform 180ms ease; box-shadow: 0 -6px 18px rgba(0,0,0,.08); z-index: 20; }
#console.expanded { transform: translateY(0); }
#console .dock-toggle, #console .dock-pin { font: 600 12px var(--sans); background: none; border: 0; color: var(--muted); cursor: pointer; padding: 4px 6px; }
#console .dock-pin[aria-pressed="true"] { color: var(--cool); }
#console.busy .dock-toggle::after { content: ' · running'; color: var(--flow); }
@media (prefers-reduced-motion: reduce) { #console { transition: none; } }
```
Delete the `--dock` variable and the `@media (max-width: 800px)` override of `--dock`. Keep that media query's `#console .panes` single-column rule.

In `app/public/js/console.js`, have the console take an optional dock:
```js
export class Console {
  constructor(root, dock = null) {
    this.dock = dock;
    // ... existing body ...
  }
  load(lane, text) {
    this.dock?.open('load');
    this.show(lane);
    this.editors[lane].set(text);
    this.editors[lane].focus();
  }
  async run() {
    // ... existing lines up to btn.disabled = true;
    this.dock?.setBusy(true);
    const r = await exec({ lane, text, patternId: this.patternId }, (s) => { this.statusEl.textContent = s; });
    this.dock?.setBusy(false);
    // ... rest unchanged
  }
}
```
In `app/public/js/app.js` `boot()`:
```js
import { Dock } from './dock.js';
// ...
  const consoleEl = document.getElementById('console');
  cons ??= new Console(consoleEl, new Dock(consoleEl));
```

- [ ] **Step 6: Unit suite, then a manual check**

Run: `cd app && npx vitest run test/unit`
Expected: PASS.

Then check it by hand:
1. Run the console on the host against the live DB with `.env` sourced (so bootstrap never resets LAB_ADMIN's password), in solo mode on port 3199:
   ```bash
   cd app && npm run build:vendor && (set -a; . ../.env; set +a; LAB_MODE=solo PORT=3199 DB_HOST=localhost DB_PORT=1522 MONGO_HOST=localhost MONGO_PORT=27018 node src/server.js)
   ```
   Never start a second compose project: `cmp-oracle` has a fixed container name and would collide.
2. Open `http://localhost:3199`.
3. Confirm the collapsed bar, hover-to-open, close-on-leave, and that it stays open while typing.
4. Stop it with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add app/public app/test/unit/dock.test.js
git commit -m "feat(lab-ui): console dock slides up on hover/focus/load/run, pin to keep open"
```

---

### Task 5: Help popovers on cards, tabs, knobs and buttons

**Files:**
- Create: `app/public/js/help.js`, `app/public/help/common.json`, `app/test/unit/help.test.js`
- Modify: `app/public/js/app.js`, `app/public/css/lab.css`, `app/test/smoke/smoke.mjs` (tab selector)

**Interfaces:**
- Produces:
  - `helpTrigger(content, { label, patternId }) → HTMLElement|null`. Content is `{ why, look, figure: {file, caption}|null, title? }`, and the function returns null when `why`, `look` and `figure` are all empty.
  - `placePopover(rect, size, viewport) → { top, left, side }`, a pure function.
  - `openHelp(anchorEl, content, opts)` opens a dialog popover anchored to any element.
- Consumes:
  - `/api/patterns` fields from Task 1;
  - figures at `/figures/<patternId>/<file>`;
  - `/help/common.json` shaped as `{ copy, load, run, reset }`, each value `{ why, look }`.

- [ ] **Step 1: Write the failing tests**

Create `app/test/unit/help.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { helpTrigger, placePopover } from '../../public/js/help.js';

describe('placePopover', () => {
  const vp = { width: 1000, height: 800 };
  it('prefers below the trigger', () => {
    expect(placePopover({ top: 100, bottom: 120, left: 200, right: 216 }, { width: 400, height: 200 }, vp)).toEqual({ top: 128, left: 200, side: 'below' });
  });
  it('flips above when there is no room below', () => {
    expect(placePopover({ top: 700, bottom: 720, left: 200, right: 216 }, { width: 400, height: 200 }, vp).side).toBe('above');
  });
  it('clamps to a 16 px gutter on the right', () => {
    expect(placePopover({ top: 100, bottom: 120, left: 900, right: 916 }, { width: 400, height: 200 }, vp).left).toBe(584);
  });
});

describe('helpTrigger', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('returns null when there is nothing to say', () => {
    expect(helpTrigger({ why: null, look: null, figure: null }, { label: 'x' })).toBeNull();
  });
  it('opens a dialog with text sections on click and closes on Escape', () => {
    const t = helpTrigger({ why: 'Because <b>physics</b>.', look: 'Row count 1.', figure: { file: 'erd.svg', caption: 'The ERD' } }, { label: 'Read it', patternId: '02-computed' });
    document.body.append(t);
    t.click();
    const d = document.querySelector('.help-pop');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.textContent).toContain('Because <b>physics</b>.');
    expect(d.querySelector('b')).toBeNull();
    expect(d.querySelector('img').getAttribute('src')).toBe('/figures/02-computed/erd.svg');
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.help-pop')).toBeNull();
  });
  it('only one popover is open at a time', () => {
    const a = helpTrigger({ why: 'a' }, { label: 'a' }); const b = helpTrigger({ why: 'b' }, { label: 'b' });
    document.body.append(a, b); a.click(); b.click();
    expect(document.querySelectorAll('.help-pop').length).toBe(1);
    expect(document.querySelector('.help-pop').textContent).toContain('b');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd app && npx vitest run test/unit/help.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement help.js**

Create `app/public/js/help.js`:
```js
// ⓘ help: a small button that opens one popover at a time with "What it does / Why it matters /
// What to look for" and an optional deck figure. Hover opens a tooltip (desktop); click, Enter or
// Space opens a dialog that keeps focus until Esc or an outside click. Text via textContent only.
const GUTTER = 16;
const GAP = 8;
let current = null;

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

export function placePopover(rect, size, vp) {
  const below = rect.bottom + GAP;
  const side = below + size.height <= vp.height - GUTTER || rect.top - GAP - size.height < GUTTER ? 'below' : 'above';
  const top = side === 'below' ? below : rect.top - GAP - size.height;
  const left = Math.max(GUTTER, Math.min(rect.left, vp.width - GUTTER - size.width));
  return { top, left, side };
}

function closeCurrent(returnFocus = false) {
  if (!current) return;
  const { pop, trigger } = current;
  pop.remove();
  trigger.setAttribute('aria-expanded', 'false');
  current = null;
  if (returnFocus) trigger.focus();
}

function build(content, { label, patternId }, modal) {
  const pop = h('div', 'help-pop');
  pop.setAttribute('role', modal ? 'dialog' : 'tooltip');
  pop.setAttribute('aria-label', `About: ${label}`);
  pop.tabIndex = -1;
  if (content.title) pop.append(h('div', 'help-title', content.title));
  if (content.what) pop.append(h('div', 'help-k', 'What it does'), h('p', null, content.what));
  if (content.why) pop.append(h('div', 'help-k', 'Why it matters'), h('p', null, content.why));
  if (content.look) pop.append(h('div', 'help-k', 'What to look for'), h('p', null, content.look));
  if (content.figure && patternId) {
    const fig = h('figure', 'help-fig');
    const img = h('img');
    img.src = `/figures/${patternId}/${content.figure.file}`;
    img.alt = content.figure.caption ?? label;
    img.loading = 'lazy';
    fig.append(img);
    if (content.figure.caption) fig.append(h('figcaption', null, content.figure.caption));
    pop.append(fig);
  }
  return pop;
}

function open(trigger, content, opts, modal) {
  if (current?.trigger === trigger && current.modal === modal) return;
  closeCurrent();
  const pop = build(content, opts, modal);
  document.body.append(pop);
  const r = trigger.getBoundingClientRect();
  const size = { width: pop.offsetWidth || 420, height: pop.offsetHeight || 200 };
  const p = placePopover(r, size, { width: window.innerWidth, height: window.innerHeight });
  pop.style.top = `${p.top + window.scrollY}px`;
  pop.style.left = `${p.left + window.scrollX}px`;
  pop.dataset.side = p.side;
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCurrent(true); } });
  pop.addEventListener('pointerleave', () => { if (!modal) closeCurrent(); });
  trigger.setAttribute('aria-expanded', 'true');
  current = { pop, trigger, modal };
  if (modal) pop.focus();
}

document.addEventListener?.('pointerdown', (e) => {
  if (current && !current.pop.contains(e.target) && e.target !== current.trigger) closeCurrent();
});

// Open a dialog popover anchored to any element (e.g. the Measure-it deck thumbnail).
export function openHelp(anchor, content, opts) { open(anchor, content, opts, true); }

export function helpTrigger(content, opts) {
  if (!content || !(content.why || content.look || content.what || content.figure)) return null;
  const b = h('button', 'help-i', 'ⓘ');
  b.type = 'button';
  b.setAttribute('aria-label', `About: ${opts.label}`);
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  let hoverTimer = null;
  b.addEventListener('click', (e) => { e.stopPropagation(); open(b, content, opts, true); });
  b.addEventListener('pointerenter', () => { hoverTimer = setTimeout(() => open(b, content, opts, false), 200); });
  b.addEventListener('pointerleave', (e) => {
    clearTimeout(hoverTimer);
    if (current?.trigger === b && !current.modal && !current.pop.contains(e.relatedTarget)) closeCurrent();
  });
  return b;
}
```

- [ ] **Step 4: Run the help tests**

Run: `cd app && npx vitest run test/unit/help.test.js`
Expected: PASS.

- [ ] **Step 5: Add the shared help and CSS**

Create `app/public/help/common.json`:
```json
{
  "copy": { "what": "Copies the statement to your clipboard.", "why": "Paste it into your own tools or the console below and change it — the lab data is yours to modify." },
  "load": { "what": "Opens the statement in the console at the bottom of the page.", "why": "Edit it before running: change a value, add a predicate, compare plans.", "look": "The console slides up; Ctrl/⌘+Enter runs it." },
  "run": { "what": "Runs the statement in your workspace and shows the result under the card.", "why": "Every run goes through a shared queue so one attendee cannot starve the others; a run has a 10 s budget.", "look": "Elapsed time and rows under the result; 'served from cache' means a classmate already ran this exact card." },
  "reset": { "what": "Rebuilds this pattern's tables in your workspace to the starting data.", "why": "Use it after you've changed data and want the card results — and Measure it — to match the lab again." }
}
```
Append to `app/public/css/lab.css`:
```css
.help-i { font: 13px var(--sans); line-height: 1; background: none; border: 0; color: var(--faint); cursor: pointer; padding: 2px 4px; border-radius: 50%; vertical-align: middle; }
.help-i:hover, .help-i[aria-expanded="true"] { color: var(--flow); }
.help-i:focus-visible { outline: 2px solid var(--flow); outline-offset: 1px; }
.help-pop { position: absolute; z-index: 40; max-width: 420px; max-height: min(70vh, 520px); overflow: auto; background: var(--panel); color: var(--ink);
  border: 1px solid var(--hairline); border-left: 3px solid var(--flow); border-radius: 10px; padding: 10px 14px; box-shadow: 0 10px 28px rgba(0,0,0,.18); font-size: 13.5px; }
.help-pop p { margin: 2px 0 8px; }
.help-pop .help-title { font: 700 14px var(--head); margin-bottom: 4px; }
.help-pop .help-k { font: 600 10.5px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.help-pop .help-fig { margin: 6px 0 0; } .help-pop .help-fig img { width: 100%; height: auto; display: block; border-radius: 6px; background: var(--paper); }
.help-pop .help-fig figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
.card h3 .help-i, .tabs .help-i, .knob .help-i { margin-left: 4px; }
```

- [ ] **Step 6: Wire into app.js**

In `app/public/js/app.js`:
```js
import { helpTrigger } from './help.js';
let common = {};
// in boot(), before route():
  common = (await getJSON('/help/common.json')).body ?? {};
```
Change `card()` to take `help` and `patternId`, add the ⓘ in the title, and add the per-button ⓘ from `common`:
```js
function card(title, notes, code, lane, patternId, measureTag, help) {
  const c = h('div', 'card');
  if (measureTag) c.append(h('span', 'badge hot', `measured: ${measureTag}`));
  const t = h('h3', null, title);
  const hi = helpTrigger(help, { label: title, patternId });
  if (hi) t.append(hi);
  c.append(t);
  // ... notes, pre.code, out, copyBtn and runBtn unchanged ...
  const actions = h('div', 'actions');
  actions.append(copyBtn, btn('Load into console', () => cons.load(lane, code)), runBtn);
  const aHelp = h('span', 'actions-help');
  for (const k of ['copy', 'load', 'run']) { const x = helpTrigger(common[k], { label: k }); if (x) aHelp.append(x); }
  c.append(actions, aHelp, out);
  return c;
}
```
The ⓘ for the buttons goes in a sibling `span.actions-help` after `.actions`, not inside it. That keeps the smoke test's `.card .actions button:nth-child(n)` selectors valid.

Update the three `card(...)` call sites to pass `c.help`.

In `patternPage()`:
- Knob tiles get their own help:
  ```js
  p.meta.knobs.forEach((k) => { const s = h('span', `knob${k.hot ? ' hot' : ''}`); s.append(h('b', null, `${k.name}: `), document.createTextNode(k.setting)); const hi = helpTrigger(k.help ? { why: k.help, figure: { file: 'model-curve.svg', caption: 'The three knobs and where they flip this pattern (deck)' } } : null, { label: k.name, patternId: id }); if (hi) s.append(hi); knobs.append(s); });
  ```
- The reset button gets `helpTrigger(common.reset, { label: 'Reset' })`, appended after it.
- Tabs become a label button plus an ⓘ sibling, using `tab` as the class for the label buttons:
  ```js
  const TABKEY = { 'Document model': 'document', 'Converged': 'converged', 'MongoDB API': 'mongo', 'Measure it': 'measure' };
  tabs.forEach(([label], i) => {
    bar.append(btn(label, () => select(i), 'tab'));
    const hi = helpTrigger(p.meta.help.tabs[TABKEY[label]], { label, patternId: id });
    if (hi) bar.append(hi);
  });
  ```
  In `select`, toggle `on` only on `.tab` buttons: `[...bar.querySelectorAll('.tab')].forEach((b, j) => b.classList.toggle('on', i === j));`.

In `app/test/smoke/smoke.mjs`, change the tab selector from `'#view .tabs button'` to `'#view .tabs button.tab'`.

- [ ] **Step 7: Unit suite**

Run: `cd app && npx vitest run test/unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/public app/test
git commit -m "feat(lab-ui): ⓘ help popovers on cards, tabs, knobs and buttons (with deck figures)"
```

---

### Task 6: Measure-it: calibrated curve with the live point, log bars, explainers

**Files:**
- Create: `app/public/js/chart.js`, `app/test/unit/chart.test.js`
- Rewrite: `app/public/js/measure.js`
- Modify: `app/test/unit/measure.test.js`, `app/public/js/app.js` (`measureCard`), `app/public/css/lab.css`

**Interfaces:**
- Produces:
  - `curveChart({ calibration, labX, xLabel, live: { redo, blocks } }) → SVGElement`. `redo` and `blocks` are ratios, or `null`/non-finite for no marker.
  - `logScale(domain, range) → fn` plus `fn.ticks()`.
  - `renderMeasure(result, { pattern }) → HTMLElement`, which keeps the existing error rows. `pattern` is the `/api/patterns` object, so `meta.measure` and `id` are available.
- Consumes:
  - `p.meta.measure` (Task 3);
  - `/figures/<id>/model-curve.svg` (Task 2);
  - `helpTrigger` (Task 5).

- [ ] **Step 1: Write the failing chart tests**

Create `app/test/unit/chart.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { curveChart, logScale } from '../../public/js/chart.js';

const CAL = [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }];

describe('logScale', () => {
  it('maps decades linearly', () => {
    const s = logScale([1, 1000], [0, 300]);
    expect(s(1)).toBeCloseTo(0); expect(s(10)).toBeCloseTo(100); expect(s(1000)).toBeCloseTo(300);
  });
  it('ticks are powers of ten inside the domain', () => {
    expect(logScale([3, 5000], [0, 1]).ticks()).toEqual([10, 100, 1000]);
  });
});

describe('curveChart', () => {
  it('draws the calibration line, points, break-even line and a live marker', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'CDR items', live: { redo: 32.8, blocks: 1.9 } });
    expect(svg.querySelector('path.cal')).not.toBeNull();
    expect(svg.querySelectorAll('circle.calpt').length).toBe(4);
    expect(svg.querySelector('line.breakeven')).not.toBeNull();
    expect(svg.querySelector('circle.live-redo')).not.toBeNull();
    expect(svg.querySelector('circle.live-blocks')).not.toBeNull();
    expect(svg.textContent).toContain('you · 32.8× redo');
  });
  it('no marker when the live ratio is not finite', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'x', live: { redo: Infinity, blocks: null } });
    expect(svg.querySelector('circle.live-redo')).toBeNull();
    expect(svg.querySelector('circle.live-blocks')).toBeNull();
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd app && npx vitest run test/unit/chart.test.js`
Expected: FAIL. The module is not found.

- [ ] **Step 3: Implement chart.js**

Create `app/public/js/chart.js`:
```js
// Log-log "write amplification vs size" chart: the measured reference calibration as a line with
// points, y = 1 (break-even) dashed, and this attendee's live measurement as a marker at lab_x.
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text != null) e.textContent = String(text); return e; };
const finite = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fmtN = (v) => (v >= 1000 ? `${v / 1000}k` : String(v));

export function logScale([d0, d1], [r0, r1]) {
  const l0 = Math.log10(d0); const l1 = Math.log10(d1);
  const f = (v) => r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0);
  f.ticks = () => { const out = []; for (let p = Math.ceil(l0); p <= Math.floor(l1); p++) out.push(10 ** p); return out; };
  return f;
}

export function curveChart({ calibration, labX, xLabel, live }) {
  const W = 560; const H = 300; const L = 64; const R = 20; const T = 22; const B = 50;
  const xs = calibration.map((c) => c.x); const ys = calibration.map((c) => c.ratio);
  const yl = [live?.redo, live?.blocks].filter(finite);
  const x = logScale([Math.min(...xs) / 1.5, Math.max(...xs) * 1.5], [L, W - R]);
  const yMin = Math.min(0.5, ...ys, ...yl) / 1.3; const yMax = Math.max(...ys, ...yl) * 1.5;
  const y = logScale([yMin, yMax], [H - B, T]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': `Document-model redo divided by converged redo, versus ${xLabel}` });

  svg.append(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'var(--hairline)' }));
  svg.append(s('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: 'var(--hairline)' }));
  for (const t of x.ticks()) {
    svg.append(s('line', { x1: x(t), y1: T, x2: x(t), y2: H - B, stroke: 'var(--hairline)', 'stroke-dasharray': '2 4' }));
    svg.append(s('text', { x: x(t), y: H - B + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, fmtN(t)));
  }
  for (const t of y.ticks()) {
    svg.append(s('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, `${t}×`));
  }
  svg.append(s('text', { x: (L + W - R) / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)' }, `${xLabel} (log)`));
  svg.append(s('text', { x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, 'document ÷ converged redo (log)'));

  if (yMin < 1 && yMax > 1) {
    svg.append(s('line', { class: 'breakeven', x1: L, y1: y(1), x2: W - R, y2: y(1), stroke: 'var(--muted)', 'stroke-dasharray': '6 4' }));
    svg.append(s('text', { x: W - R - 4, y: y(1) - 6, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, 'break-even · above = document writes more'));
  }
  const pts = calibration.map((c) => `${x(c.x).toFixed(1)},${y(c.ratio).toFixed(1)}`);
  svg.append(s('path', { class: 'cal', d: `M${pts.join(' L')}`, fill: 'none', stroke: 'var(--hot)', 'stroke-width': 2.2 }));
  for (const c of calibration) svg.append(s('circle', { class: 'calpt', cx: x(c.x), cy: y(c.ratio), r: 3.5, fill: 'var(--panel)', stroke: 'var(--hot)', 'stroke-width': 1.6 }));
  svg.append(s('text', { x: x(xs[xs.length - 1]) - 6, y: y(ys[ys.length - 1]) - 10, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--hot)' }, 'measured on 26ai Free (reference run)'));

  svg.append(s('line', { x1: x(labX), y1: T, x2: x(labX), y2: H - B, stroke: 'var(--flow)', 'stroke-dasharray': '3 3' }));
  svg.append(s('text', { x: x(labX) + 4, y: T + 10, 'font-size': 11, fill: 'var(--flow)' }, `lab data · ${fmtN(labX)}`));
  if (finite(live?.blocks)) svg.append(s('circle', { class: 'live-blocks', cx: x(labX), cy: y(live.blocks), r: 6, fill: 'none', stroke: 'var(--flow)', 'stroke-width': 2 }));
  if (finite(live?.redo)) {
    svg.append(s('circle', { class: 'live-redo', cx: x(labX), cy: y(live.redo), r: 7, fill: 'var(--flow)' }));
    svg.append(s('text', { x: x(labX) + 12, y: y(live.redo) + 4, 'font-size': 12, 'font-weight': 700, fill: 'var(--flow)' }, `you · ${live.redo.toFixed(1)}× redo`));
  }
  return svg;
}
```

- [ ] **Step 4: Run the chart tests**

Run: `cd app && npx vitest run test/unit/chart.test.js`
Expected: PASS.

- [ ] **Step 5: Update the measure tests for the new rendering**

Replace `app/test/unit/measure.test.js` with the following. It keeps the earlier non-finite and error cases and adds the curve and explainer checks.
```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const P = { id: '02-computed', meta: { deck: '18–21', measure: { xLabel: 'CDR items', labX: 1000, deckSlides: '18–21',
  calibration: [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }] } } };
const side = (redo, blocks, kind = 'dml') => ({ sql: 'x', stats: { 'redo size': redo, 'db block changes': blocks, 'session logical reads': 10, 'CPU used by this session': 0 },
  result: kind === 'dml' ? { kind, rowsAffected: 1, elapsedMs: 2 } : { kind, elapsedMs: 2 } });

describe('renderMeasure', () => {
  it('renders the curve with a live marker, log bars with ratios, and explainers', () => {
    const el = renderMeasure({ tag: 't', document: side(52160, 21), converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('svg.curve circle.live-redo')).not.toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
    expect(el.textContent).toContain('32.8×');
    expect(el.querySelector('.what-happened')).not.toBeNull();
    expect(el.querySelector('.deck-thumb img').getAttribute('src')).toBe('/figures/02-computed/model-curve.svg');
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('an error side shows the error and no live marker', () => {
    const err = { sql: 'x', stats: {}, result: { kind: 'error', code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } };
    const el = renderMeasure({ tag: 't', document: err, converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('.result.error').textContent).toContain('LAB-MEASURE');
    expect(el.querySelector('circle.live-redo')).toBeNull();
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('a PL/SQL (kind ok) side shows — for rows affected', () => {
    const el = renderMeasure({ tag: 't', document: side(4752, 21, 'ok'), converged: side(864, 6) }, { pattern: P });
    expect(el.querySelector('.rows-affected').textContent).toContain('—');
  });
  it('a pattern without calibration still renders the bars', () => {
    const el = renderMeasure({ tag: 't', document: side(3060, 17), converged: side(500, 3) }, { pattern: { id: 'x', meta: { deck: '1', measure: null } } });
    expect(el.querySelector('svg.curve')).toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `cd app && npx vitest run test/unit/measure.test.js`
Expected: FAIL. There is no `.stat-bars`, `svg.curve` or `.what-happened`.

- [ ] **Step 7: Rewrite measure.js**

Replace `app/public/js/measure.js`:
```js
// Measure-it result: the calibrated curve with this run's live point, log-scale paired bars per
// statistic with ratios and ⓘ explainers, and a "what just happened" panel.
import { curveChart } from './chart.js';
import { helpTrigger, openHelp } from './help.js';

const NS = 'http://www.w3.org/2000/svg';
const STATS = [
  ['redo size', 'Bytes the database must write to its log to make the change durable — the most direct measure of how much the write physically changed.'],
  ['db block changes', 'How many data blocks the write touched.'],
  ['session logical reads', 'Blocks read (from cache) to find and change the data — a read-modify-write of a whole document shows up here.'],
  ['CPU used by this session', 'CPU time in centiseconds. At this data size it is usually 0 on both sides — shown, not hidden.'],
];
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const fmt = (n) => (num(n) === null ? '—' : n.toLocaleString('en-US'));
const ratioOf = (d, c) => (num(d) === null || !num(c) ? null : d / c);
const fmtRatio = (r) => (r === null ? '—' : `${r.toFixed(1)}×`);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const s = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text != null) e.textContent = String(text); return e; };

function statBars(m) {
  const wrap = h('div', 'stat-bars');
  const vals = STATS.flatMap(([n]) => [num(m.document.stats[n]), num(m.converged.stats[n])]).filter((v) => v > 0);
  const lmax = Math.log10(Math.max(10, ...vals));
  const len = (v) => (v > 0 ? Math.max(4, (Math.log10(v + 1) / lmax) * 100) : 0);
  for (const [name, explain] of STATS) {
    const d = m.document.stats[name]; const c = m.converged.stats[name];
    const row = h('div', 'stat');
    const label = h('div', 'stat-name', name);
    const hi = helpTrigger({ what: explain }, { label: name }); if (hi) label.append(hi);
    const bars = h('div', 'stat-pair');
    for (const [v, cls] of [[d, 'hot'], [c, 'cool']]) {
      const line = h('div', 'stat-line');
      const bar = h('span', `stat-bar ${cls}`); bar.style.width = `${len(num(v) ?? 0)}%`;
      line.append(bar, h('span', 'stat-val', fmt(v)));
      bars.append(line);
    }
    row.append(label, bars, h('div', 'stat-ratio', fmtRatio(ratioOf(d, c))));
    wrap.append(row);
  }
  const rows = (r) => (r.kind === 'dml' ? r.rowsAffected : null);
  wrap.append(h('div', 'rows-affected rmeta',
    `rows affected ${fmt(rows(m.document.result))} vs ${fmt(rows(m.converged.result))} · elapsed ${fmt(m.document.result.elapsedMs)} ms vs ${fmt(m.converged.result.elapsedMs)} ms · log scale`));
  const legend = h('div', 'stat-legend rmeta');
  legend.append(h('span', 'key hot', 'document model'), h('span', 'key cool', 'converged'));
  wrap.prepend(legend);
  return wrap;
}

function whatHappened() {
  const box = h('div', 'what-happened');
  box.append(h('h4', null, 'What just happened'));
  for (const t of [
    'Both writes ran back to back in one exclusive slot, so nobody else\'s work is in these numbers.',
    'Each side ran once unmeasured as a warm-up, then once measured, then rolled back — your lab data is unchanged.',
    'Read the ratio, not the bytes: the bytes depend on this small lab dataset; the ratio shows how each model\'s write cost scales with the size on the x-axis.',
    'One session on Oracle AI Database 26ai Free: expect small run-to-run variance (a block, or a LOB chunk). Say "same order of magnitude", not exact bytes.',
  ]) box.append(h('p', null, t));
  return box;
}

export function renderMeasure(m, { pattern } = {}) {
  const box = h('div', 'measure-out');
  for (const [name, sd] of [['document model', m.document], ['converged', m.converged]]) {
    if (sd.result.kind === 'error') box.append(h('div', 'result error', `${name}: ${sd.result.code ?? ''} ${sd.result.error}`));
  }
  const grid = h('div', 'measure-grid');
  const meas = pattern?.meta?.measure;
  if (meas) {
    const left = h('div', 'measure-curve');
    left.append(h('div', 'kicker', 'Write amplification vs size'));
    left.append(curveChart({ calibration: meas.calibration, labX: meas.labX, xLabel: meas.xLabel,
      live: { redo: ratioOf(m.document.stats['redo size'], m.converged.stats['redo size']), blocks: ratioOf(m.document.stats['db block changes'], m.converged.stats['db block changes']) } }));
    left.append(h('p', 'rmeta', 'Solid dot: your redo ratio · ring: your block-change ratio · line: reference measurements at other sizes, same protocol.'));
    const thumb = h('button', 'deck-thumb'); thumb.type = 'button';
    const img = h('img'); img.src = `/figures/${pattern.id}/model-curve.svg`; img.alt = 'The deck\'s workload model for this pattern';
    thumb.append(img, h('span', null, `The full workload picture — illustrative model from the deck (slides ${meas.deckSlides})`));
    thumb.addEventListener('click', () => openHelp(thumb, { title: 'Workload model (deck)', what: 'The deck\'s daily cost model: reads plus writes, in illustrative units, across the pattern\'s knob. The chart on the left is the part Measure it can prove: one write, in bytes.', figure: { file: 'model-curve.svg', caption: `Deck slides ${meas.deckSlides}` } }, { label: 'workload model', patternId: pattern.id }));
    left.append(thumb);
    grid.append(left);
  }
  const right = h('div', 'measure-stats');
  right.append(h('div', 'kicker', 'This run'), statBars(m));
  grid.append(right);
  box.append(grid, whatHappened());
  return box;
}
```

- [ ] **Step 8: Run the measure tests**

Run: `cd app && npx vitest run test/unit/measure.test.js test/unit/chart.test.js`
Expected: PASS.

- [ ] **Step 9: Wire it in app.js and add CSS**

In `app/public/js/app.js` `measureCard(p, m)`, replace the bare note with an ⓘ-carrying title. Give each statement's kicker its help, pass the pattern, and use the new render call:
```js
  const title = h('h3', null, `Measure it · ${m.tag}`);
  const th = helpTrigger(p.meta.help.tabs.measure, { label: 'Measure it', patternId: p.id }); if (th) title.append(th);
  const kd = h('div', 'kicker', 'Document model'); const kdh = helpTrigger(m.help?.document, { label: 'document write', patternId: p.id }); if (kdh) kd.append(kdh);
  const kc = h('div', 'kicker', 'Converged'); const kch = helpTrigger(m.help?.converged, { label: 'converged write', patternId: p.id }); if (kch) kc.append(kch);
  c.append(title, kd, h('pre', 'code', m.documentSql), kc, h('pre', 'code', m.convergedSql));
  // ... button unchanged, then:
  out.replaceChildren(r.status === 200 ? renderMeasure(r.body, { pattern: p }) : h('div', 'result error', MSG[r.status] ?? r.body?.error ?? `error ${r.status}`));
```
Append to `app/public/css/lab.css`, replacing the old `.measure-out svg` and `.measure-table` rules:
```css
.measure-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 18px; margin-top: 10px; }
@media (max-width: 900px) { .measure-grid { grid-template-columns: 1fr; } }
.measure-out svg.curve { width: 100%; height: auto; display: block; }
.deck-thumb { display: flex; gap: 10px; align-items: center; margin-top: 8px; background: var(--chip); border: 1px solid var(--hairline); border-radius: 8px; padding: 6px; cursor: zoom-in; color: var(--muted); font: 12px var(--sans); text-align: left; width: 100%; }
.deck-thumb img { width: 120px; height: auto; border-radius: 4px; background: var(--paper); }
.stat { display: grid; grid-template-columns: 150px minmax(0, 1fr) 56px; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--hairline); }
.stat-name { font: 12.5px var(--mono); color: var(--ink); }
.stat-line { display: flex; align-items: center; gap: 6px; height: 16px; }
.stat-bar { display: inline-block; height: 10px; border-radius: 3px; } .stat-bar.hot { background: var(--hot); } .stat-bar.cool { background: var(--cool); }
.stat-val { font: 11.5px var(--mono); color: var(--muted); white-space: nowrap; }
.stat-ratio { font: 700 13px var(--mono); text-align: right; }
.stat-legend { display: flex; gap: 14px; } .stat-legend .key::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.stat-legend .key.hot::before { background: var(--hot); } .stat-legend .key.cool::before { background: var(--cool); }
.what-happened { margin-top: 14px; background: var(--flow-soft); border-radius: 8px; padding: 10px 14px; font-size: 13.5px; }
.what-happened h4 { margin: 0 0 4px; font: 700 13px var(--head); } .what-happened p { margin: 2px 0; }
```

- [ ] **Step 10: Unit suite**

Run: `cd app && npx vitest run test/unit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add app/public app/test/unit
git commit -m "feat(lab-ui): measure-it curve with your live point, log bars with explainers, deck thumbnail"
```

---

### Task 7: Author the help content for all 6 patterns, plus the review document

**Files:**
- Modify: `patterns/<id>/01-document-model.sql`, `02-converged.sql`, `*.js` (×6), adding `@why`, `@look` and `@figure`
- Modify: `patterns/<id>/README.md` (×6), adding `help.tabs` and `knobs[].help`
- Create: `app/scripts/help-review.mjs`, `docs/help-review.md` (generated)

**Interfaces:**
- Consumes: the annotation and front-matter formats from Task 1; the figure names from Task 2.
- Produces: text for every card, tab and knob; `docs/help-review.md` for the author.

**Voice and rules** (binding):
- Direct and first-person-plural where natural, physics-grounded, no marketing adjectives.
- `@why` is at most 2 sentences. It ties to one of the pattern's three knobs, named explicitly: Diversity, Read/write, or Update locality.
- `@look` is 1 sentence and names something visible in the result (a count, a column, the elapsed time, rows affected, "served from cache").
- Use `@figure` on the first card of each tab only: `doc-shape.svg` for the Document model tab, `erd.svg` for Converged, `flow.svg` for MongoDB API. Captions come from the deck figure's subject.
- Every `@measure` statement gets `@why` and `@look` that explain the redo difference in terms of the read-modify-write of a growing document versus a small row. No engine-internals claims.
- Tab help (`help.tabs.*`): `why` is 1–2 sentences, `look` is 1 sentence. `measure.why` explains what the ratio means for this pattern's knob.
- Knob help: 1 sentence explaining the setting in this pattern's workload terms, using the deck's numbers where they exist (read the deck notes in the pattern README and the deck module docstring cited in this plan's Task 3 table).
- Never "the join is free". Always "Oracle AI Database 26ai". Do not mention MongoDB as the owner of document patterns; describe them as document-model patterns.

Worked example (pattern 02, the document-side measured write):
```sql
-- @step Record a call (rewrites the subscriber document)
-- @note Append the line item and re-tick the rollup — a read-modify-write of the WHOLE subscriber document (1,000 prior CDRs), once per CDR.
-- @why Update locality is the hot knob here: every call lands on the same parent, so each CDR pays for rewriting everything already in the document.
-- @look Rows affected is 1 — but Measure it shows how many bytes that one row cost.
-- @figure doc-shape.svg The subscriber document as built
-- @measure record-cdr
```

- [ ] **Step 1: Write the review generator**

Create `app/scripts/help-review.mjs`:
```js
// Generates docs/help-review.md: every help entry by pattern, surface and statement, so the
// author can review all lab guidance text in one place. Flags cards that have no help.
import fs from 'node:fs';
import path from 'node:path';
import { loadPatterns } from '../src/content/patterns.js';

const root = path.resolve(import.meta.dirname, '../../patterns');
const out = [];
const line = (s = '') => out.push(s);
const help = (hp) => [hp?.why && `- **Why:** ${hp.why}`, hp?.look && `- **Look for:** ${hp.look}`, hp?.figure && `- **Figure:** \`${hp.figure.file}\` — ${hp.figure.caption ?? ''}`].filter(Boolean);
let missing = 0;
line('# Lab help text — review'); line(); line('Generated by `app/scripts/help-review.mjs`. Edit the pattern files, not this file.'); line();
for (const p of loadPatterns(root)) {
  line(`## ${p.id} · ${p.meta.title}`); line();
  line('### Knobs'); for (const k of p.meta.knobs) line(`- **${k.name}** (${k.setting}): ${k.help ?? '⚠ MISSING'}`); line();
  line('### Tabs'); for (const [k, v] of Object.entries({ document: 0, converged: 0, mongo: 0, measure: 0 })) { void v; const t = p.meta.help.tabs[k]; line(`**${k}**`); const hl = help(t); if (!hl.length) { line('- ⚠ MISSING'); missing++; } else hl.forEach(line); line(); }
  for (const [lane, steps] of Object.entries(p.lanes)) {
    line(`### ${lane} cards`); line();
    for (const st of steps) {
      line(`**${st.title}**${st.measure ? ` · measured: ${st.measure}` : ''}`);
      const hl = help(st.help); if (!hl.length) { line('- ⚠ MISSING'); missing++; } else hl.forEach(line);
      line();
    }
  }
}
out.splice(3, 0, `Entries missing help: **${missing}**`, '');
fs.writeFileSync(path.resolve(import.meta.dirname, '../../docs/help-review.md'), out.join('\n'));
console.log(`docs/help-review.md written · ${missing} missing`);
```

- [ ] **Step 2: Author the content, one pattern at a time**

For each of the 6 patterns:
1. Read its README, both SQL files, its mongosh files and the deck module docstring.
2. Add the annotations and front matter.
3. After each pattern, run `cd app && npx vitest run test/unit/patterns.test.js && node scripts/help-review.mjs`.

Expected: the loader does not fail, and the missing count drops toward 0.

- [ ] **Step 3: Validate that the lab still runs unchanged**

Run: `cd app && npx vitest run test/unit`. Then run `./run.sh 01-extended-reference` through each pattern id; they use the repo's own lab validation, which exercises the SQL files.
Expected: all unit tests PASS; every pattern passes (annotations are comments to SQL*Plus and mongosh).

- [ ] **Step 4: Regenerate the review doc and commit**

```bash
cd app && node scripts/help-review.mjs && cd ..
git add patterns app/scripts/help-review.mjs docs/help-review.md
git commit -m "content: help text for every card, tab and knob across the six patterns"
```
Expected: `docs/help-review.md written · 0 missing`.

**Human gate:** the author reviews `docs/help-review.md` before the PR merges. Apply the author's edits to the pattern files, not to the generated doc, then regenerate.

---

### Task 8: Smoke coverage, docs, final verification

**Files:**
- Modify: `app/test/smoke/smoke.mjs`, `README.md` (the "Hands-on console" section), `docs/instructor-runbook.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Extend the smoke test**

In `app/test/smoke/smoke.mjs`, inside the per-pattern loop, after the page loads and before the existing card runs, add:
```js
      // Dock: collapsed on arrival, expands on hover, and on Load.
      const expanded = () => page.$eval('#console', (e) => e.classList.contains('expanded'));
      if (await expanded()) fail(`${id}: dock should start collapsed`);
      await page.hover('#console .bar'); await new Promise((r) => setTimeout(r, 300));
      if (!(await expanded())) fail(`${id}: dock did not expand on hover`);
      await page.mouse.move(10, 10); await new Promise((r) => setTimeout(r, 900));
      if (await expanded()) fail(`${id}: dock did not collapse after leaving`);
      // Help: a card ⓘ and a tab ⓘ open popovers with text.
      for (const sel of ['.card h3 .help-i', '#view .tabs .help-i']) {
        const t = await page.$(sel);
        if (!t) fail(`${id}: no help trigger for ${sel}`);
        await t.click();
        const txt = await page.$eval('.help-pop', (e) => e.textContent.trim());
        if (txt.length < 20) fail(`${id}: help popover for ${sel} is empty`);
        await page.keyboard.press('Escape');
      }
```
In the Measure-it block, after `await page.waitForSelector('.measure-out svg', ...)`, add:
```js
      if (!(await page.$('.measure-out svg.curve circle.live-redo'))) fail(`${id}: measure curve has no live marker`);
      if (!(await page.$('.measure-out .stat-bars'))) fail(`${id}: measure stat bars missing`);
```
Also take the existing screenshots at an 800 px viewport width, in addition to 1440, for the cards and measure pages.

- [ ] **Step 2: Run the smoke test against a host-run console**

Run the console on the host against the live DB, **with `.env` sourced** (so its LAB_ADMIN password matches and bootstrap never resets it), in solo mode on port 3199:
```bash
cd app && npm run build:vendor && (set -a; . ../.env; set +a; LAB_MODE=solo PORT=3199 DB_HOST=localhost DB_PORT=1522 MONGO_HOST=localhost MONGO_PORT=27018 node src/server.js)
```
Never start a second compose project: `cmp-oracle` has a fixed container name and a second project would collide with it.
Then in a second shell: `cd app && LAB_URL=http://localhost:3199 npm run test:smoke`; stop the console afterwards.
Expected: `SMOKE PASS`. Review the screenshots in `app/test/artifacts/` in light, dark and 800 px for:
- popover overlap and clipping;
- the dock covering content;
- chart labels colliding.

Fix anything you find before continuing.

- [ ] **Step 3: Update the docs**

In `README.md` "Hands-on console", add one short paragraph each on the dock (hover to open, pin), ⓘ help, and the Measure-it curve (reference line vs your live point; the deck workload model is a separate, linked illustration). In `docs/instructor-runbook.md` "During the session", add: "Point attendees at the ⓘ next to any card, tab or knob; the Measure-it curve shows where their result sits against a reference run."

- [ ] **Step 4: Full verification**

Run: `cd app && npx vitest run test/unit`
Expected: PASS.

Integration tests (DB-backed; `.env` sourced so LAB_ADMIN's password is passed through, never reset):
```bash
cd app && (set -a; . ../.env; set +a; npx vitest run test/integration/http.test.js)
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/test/smoke/smoke.mjs README.md docs/instructor-runbook.md
git commit -m "test+docs: smoke covers dock, help and measure curve; README/runbook updated"
```
