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
  // Anchored near the axis, not the top: the "reference run" label above always sits near the
  // highest calibration point (top of the chart), and on several patterns the lab's own x sits
  // close enough to that point in log-space to collide with it up there. The strip just above the
  // axis and below the break-even line is otherwise empty on every pattern (all calibration
  // ratios are > 1), so it is always clear.
  svg.append(s('text', { x: x(labX) + 4, y: H - B - 6, 'font-size': 11, fill: 'var(--flow)' }, `lab data · ${fmtN(labX)}`));
  if (finite(live?.blocks)) svg.append(s('circle', { class: 'live-blocks', cx: x(labX), cy: y(live.blocks), r: 6, fill: 'none', stroke: 'var(--flow)', 'stroke-width': 2 }));
  if (finite(live?.redo)) {
    svg.append(s('circle', { class: 'live-redo', cx: x(labX), cy: y(live.redo), r: 7, fill: 'var(--flow)' }));
    svg.append(s('text', { x: x(labX) + 12, y: y(live.redo) + 4, 'font-size': 12, 'font-weight': 700, fill: 'var(--flow)' }, `you · ${live.redo.toFixed(1)}× redo`));
  }
  return svg;
}
