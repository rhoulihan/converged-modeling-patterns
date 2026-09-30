// Measure-it result: the calibrated curve with this run's live point, log-scale paired bars per
// statistic with ratios and ⓘ explainers, and a "what just happened" panel.
import { curveChart } from './chart.js';
import { helpTrigger, openHelp } from './help.js';

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
