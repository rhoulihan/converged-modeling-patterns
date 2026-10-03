// Measure-it result: the calibrated curve with this run's live point, paired bars per statistic
// (each row scaled to its own max) with ratios and ⓘ explainers, and a "what just happened" panel.
// If either side errored there is no live point and every ratio shows — (raw values still shown).
import { curveChart, linesChart, breakEvenChart, fmtRatio as fmtR } from './chart.js';
import { renderPlans } from './planview.js';
import { analyze, verdict, fmtCount, readLabel, logSteps, breakEvenRange, breakEvenSentence } from './readside.js';
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

function whatHappened(n, reads = false) {
  const box = h('div', 'what-happened');
  box.append(h('h4', null, 'What just happened'));
  for (const t of [
    ...(reads ? ['At each size the lab also read one item through each model and counted the blocks every read and write touched, so reads and writes compare in one unit.'] : []),
    `The lab resized this pattern's data to each of ${n} sizes, on both sides, and ran the same write on each model at every size.`,
    'At each size each write ran once as a warm-up, then three times measured, each rolled back; the middle result is shown.',
    'Everything ran in one exclusive slot, so nobody else\'s work is in these numbers. Afterwards the pattern was rebuilt, so its lab data is back as it was built.',
    'Read the trend, not the bytes: the bytes depend on this small dataset; how fast "times more" climbs with size is the lesson.',
  ]) box.append(h('p', null, t));
  return box;
}

// Two sub-tabs: the summary (charts, tables) and the plans and statistics it is derived from.
export function renderMeasure(sw, { pattern } = {}) {
  const out = h('div', 'measure-out');
  const tabs = h('div', 'subtabs');
  const summary = renderSummary(sw, { pattern });
  const plans = h('div', 'plans-host');
  let built = false;
  const show = (which) => {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === which);
    summary.hidden = which !== 'summary';
    if (which === 'plans' && !built) { plans.append(renderPlans(sw, { pattern })); built = true; }
    plans.hidden = which !== 'plans';
  };
  for (const [key, label] of [['summary', 'Summary'], ['plans', 'Plans & stats']]) {
    const b = h('button', 'subtab', label); b.type = 'button'; b.dataset.tab = key; b.addEventListener('click', () => show(key)); tabs.append(b);
  }
  out.append(tabs, summary, plans);
  show('summary');
  return out;
}

function renderSummary(sw, { pattern } = {}) {
  const box = h('div', 'measure-summary');
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
  box.append(grid);
  const rs = readSection(sw, meas);
  if (rs) box.append(rs);
  box.append(whatHappened(sw.sizes.length, Boolean(rs)));
  return box;
}

// Reads and writes in one unit, blocks touched (logical reads): how each model's read grows with
// size, and how many reads per write the document model needs before it is cheaper overall.
function readSection(sw, meas) {
  const rows = analyze(sw.points);
  if (rows.length < 2) return null;
  const gDoc = { label: readLabel(rows, 'docRead', 'docRows') }; const gConv = { label: readLabel(rows, 'convRead', 'convRows') };
  const first = rows[0]; const last = rows[rows.length - 1];
  const sec = h('div', 'read-side');
  sec.append(h('h4', 'read-side-title', 'The read side: reads and writes in one unit, blocks touched'));
  const head1 = h('p', 'measure-headline');
  const n = (v) => v.toLocaleString('en-US');
  const multi = Math.max(...rows.map((r) => Math.max(r.docRows, r.convRows))) > 1;
  head1.append(multi ? 'For a read that returns many items, the document model touched ' : 'Reading one item, the document model touched ',
    h('strong', null, `${n(first.docRead)} → ${n(last.docRead)} blocks`), ` (${gDoc.label}); the converged model `,
    h('strong', null, `${n(first.convRead)} → ${n(last.convRead)}`), ` (${gConv.label}).`);
  const head2 = h('p', 'measure-headline');
  const v = meas.workload ? verdict(rows, meas.workload.readsPerWrite) : null;
  if (rows.every((r) => r.breakEven === null)) {
    head2.append('The document model\'s read is never cheaper here, so it ', h('strong', null, 'never wins'), ', whatever the mix of reads and writes.');
  } else if (v) {
    const lead = `The document model ${breakEvenSentence(rows)}. At this workload (~${fmtCount(meas.workload.readsPerWrite)} reads per write: ${meas.workload.label}) `;
    if (v.kind === 'all') head2.append(lead, h('strong', null, 'the document model wins at every size measured'), '.');
    else if (v.kind === 'none') head2.append(lead, h('strong', null, 'the converged model wins at every size measured'), '.');
    else head2.append(lead, h('strong', null, `the document model wins up to ${v.upTo.toLocaleString('en-US')}`), ` ${meas.xLabel}; beyond that the converged model wins.`);
  } else {
    head2.append(`The document model ${breakEvenSentence(rows)}.`);
  }
  sec.append(head1, head2);
  const grid = h('div', 'measure-grid two-charts');
  const a = h('div', 'measure-curve'); a.append(h('div', 'kicker', 'Blocks touched per read'));
  a.append(linesChart({ xLabel: meas.xLabel, yLabel: 'blocks touched per read (log)', series: [
    { name: `document model: ${gDoc.label}`, tone: 'hot', points: rows.map((r) => ({ x: r.x, y: r.docRead })) },
    { name: `converged: ${gConv.label}`, tone: 'cool', points: rows.map((r) => ({ x: r.x, y: r.convRead })) },
  ] }));
  const b = h('div', 'measure-curve'); b.append(h('div', 'kicker', 'Reads per write before the document model wins'));
  const ber = breakEvenRange(rows);
  const beText = ber.span ? `${ber.span} reads per write${ber.partial ? ', never at the larger sizes' : ''}` : null;
  b.append(breakEvenChart({ rows, workload: meas.workload, xLabel: meas.xLabel, breakEvenText: beText }));
  grid.append(a, b);
  sec.append(grid, blocksTable(rows, meas.xLabel));
  // Why a converged lookup creeps up by a block at large sizes, and why multi-row reads grow.
  const note = h('div', 'read-note');
  for (const st of logSteps(rows)) {
    const where = `${st.at.toLocaleString('en-US')} ${meas.xLabel}`;
    note.append(h('p', 'read-step', st.kind === 'index'
      ? `The ${st.what} rises from ${st.from} to ${st.to} blocks across these sizes: a step of a block or two, from an index gaining a level as its table grows (log n) or from where rows land in blocks, never a block per reference.`
      : `The ${st.what} rises from ${st.from} to ${st.to} blocks by ${where}: the document outgrew its block, so reading it touches more blocks (its size, not an index).`));
  }
  note.append(h('strong', null, 'Reading the block counts. '),
    'Every index lookup reads one block per index level, plus the row itself. An index gains a level only as its table grows, '
    + 'roughly once per hundred-fold more rows, so a one-item read or a one-row write stays at a handful of blocks and rises by about one block '
    + 'when an index grows a level (e.g. 4 to 5 blocks at 1,000 rows). That is the table size, not the number of references. '
    + 'A read that returns many items is different: rows assembled by one lookup each cost about a block per item, '
    + 'while items stored together in one document or a few adjacent blocks cost a small fraction of a block each.');
  sec.append(note);
  return sec;
}

function blocksTable(rows, xLabel) {
  const t = h('table', 'sweep-table');
  const head = h('tr');
  for (const [txt, cls] of [[xLabel, ''], ['document read', 'num'], ['converged read', 'num'], ['document write', 'num'], ['converged write', 'num'], ['reads per write to win', 'num']]) head.append(h('th', cls, txt));
  t.append(h('thead')); t.firstChild.append(head);
  const body = h('tbody');
  for (const r of rows) {
    const tr = h('tr');
    const be = r.breakEven === null ? 'never' : r.breakEven === 0 ? 'always' : fmtCount(r.breakEven);
    tr.append(h('td', null, r.x.toLocaleString('en-US')), h('td', 'num', fmt(r.docRead)), h('td', 'num', fmt(r.convRead)),
      h('td', 'num', fmt(r.docWrite)), h('td', 'num', fmt(r.convWrite)), h('td', 'num strong', be));
    body.append(tr);
  }
  t.append(body);
  const wrap = h('div', 'blocks-table'); wrap.append(h('div', 'kicker', 'Every size, in blocks touched'), t);
  return wrap;
}
