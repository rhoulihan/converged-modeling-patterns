// Measure-it result: the calibrated curve with this run's live point, paired bars per statistic
// (each row scaled to its own max) with ratios and ⓘ explainers, and a "what just happened" panel.
// If either side errored there is no live point and every ratio shows — (raw values still shown).
import { curveChart, fmtRatio as fmtR } from './chart.js';
import { helpTrigger, openHelp } from './help.js';

const STATS = [
  ['redo size', 'Bytes the database must write to its log to make the change durable: the most direct measure of how much the write physically changed.'],
  ['db block changes', 'How many data blocks the write touched.'],
  ['session logical reads', 'Blocks read (from cache) to find and change the data.'],
  ['CPU used by this session', 'CPU time in centiseconds. At this data size it is usually 0 on both sides. Shown, not hidden.'],
];
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const fmt = (n) => (num(n) === null ? '—' : n.toLocaleString('en-US'));
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

// The sweep as a table: one row per size, the redo of each side and how many times more.
function sweepTable(points, xLabel) {
  const t = h('table', 'sweep-table');
  const head = h('tr');
  for (const [txt, cls] of [[xLabel, ''], ['document redo (bytes)', 'num'], ['converged redo (bytes)', 'num'], ['times more', 'num']]) head.append(h('th', cls, txt));
  t.append(h('thead')); t.firstChild.append(head);
  const body = h('tbody');
  for (const q of points) {
    const tr = h('tr');
    tr.append(h('td', null, q.x.toLocaleString('en-US')), h('td', 'num', fmt(q.document.stats['redo size'])),
      h('td', 'num', fmt(q.converged.stats['redo size'])), h('td', 'num strong', q.ratio ? fmtR(q.ratio) : '—'));
    body.append(tr);
  }
  t.append(body);
  return t;
}

function whatHappened(n) {
  const box = h('div', 'what-happened');
  box.append(h('h4', null, 'What just happened'));
  for (const t of [
    `The lab resized this pattern's data to each of ${n} sizes, on both sides, and ran the same write on each model at every size.`,
    'At each size each write ran once as a warm-up, then three times measured, each rolled back; the middle result is shown.',
    'Everything ran in one exclusive slot, so nobody else\'s work is in these numbers. Afterwards the pattern was rebuilt, so its lab data is back as it was built.',
    'Read the trend, not the bytes: the bytes depend on this small dataset; how fast "times more" climbs with size is the lesson.',
  ]) box.append(h('p', null, t));
  return box;
}

export function renderMeasure(sw, { pattern } = {}) {
  const box = h('div', 'measure-out');
  const meas = pattern?.meta?.measure;
  if (sw.error) box.append(h('div', 'result error', `${sw.error.code ?? ''} ${sw.error.error}`));
  for (const q of sw.points) {
    for (const [name, sd] of [['document model', q.document], ['converged', q.converged]]) {
      if (sd.result.kind === 'error') box.append(h('div', 'result error', `size ${q.x}, ${name}: ${sd.result.code ?? ''} ${sd.result.error}`));
    }
  }
  if (!sw.restored) box.append(h('div', 'result error', 'The pattern could not be rebuilt afterwards; it will rebuild before its next use.'));
  const good = sw.points.filter((q) => q.ratio && q.document.result.kind !== 'error' && q.converged.result.kind !== 'error');
  if (good.length >= 2) {
    const first = good[0]; const last = good[good.length - 1];
    const head = h('p', 'measure-headline');
    head.append('Your runs: at the smallest size (', `${first.x.toLocaleString('en-US')}`, ') the document model wrote ', h('strong', null, fmtR(first.ratio)),
      ' the redo of the converged model; at the largest (', `${last.x.toLocaleString('en-US')}`, '), ', h('strong', null, fmtR(last.ratio)), '. The bigger the size, the bigger the gap.');
    box.append(head);
  }
  const grid = h('div', 'measure-grid');
  const left = h('div', 'measure-curve');
  left.append(h('div', 'kicker', 'How the gap grows'));
  if (good.length >= 2) left.append(curveChart({ points: good, xLabel: meas.xLabel }));
  const thumb = h('button', 'deck-thumb'); thumb.type = 'button';
  const img = h('img'); img.src = `/figures/${pattern.id}/model-curve.svg`; img.alt = 'The deck\'s workload model for this pattern';
  thumb.append(img, h('span', null, `The full workload picture, reads and writes: the deck's model (slides ${meas.deckSlides})`));
  thumb.addEventListener('click', () => openHelp(thumb, { title: 'Workload model (deck)', what: 'The deck\'s daily cost model: reads plus writes across the pattern\'s knob. Measure it shows the write side, measured live at several sizes.', figure: { file: 'model-curve.svg', caption: `Deck slides ${meas.deckSlides}` } }, { label: 'workload model', patternId: pattern.id }));
  left.append(thumb);
  const right = h('div', 'measure-stats');
  const stat = h('div', 'kicker', 'Every size');
  const hi = helpTrigger({ what: STATS[0][1] }, { label: 'redo size' }); if (hi) stat.append(hi);
  right.append(stat, sweepTable(sw.points, meas.xLabel));
  grid.append(left, right);
  box.append(grid, whatHappened(sw.sizes.length));
  return box;
}
