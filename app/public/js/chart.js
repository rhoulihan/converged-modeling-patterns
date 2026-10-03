// Log-log "how the gap grows" chart: the measured reference runs as a neutral line with labelled
// points, y = 1 (break-even) dashed, a legend, and this attendee's run as one marker at lab_x.
// Label placement is collision-aware (estimated text boxes, not exact metrics) because the same
// chart has to work across every pattern's calibration data, not just the ones checked by hand.
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

// Rough text-box estimate (0.6 * font-size per character — no real metrics available at this
// layer) used only to decide "does this collide", not to render.
const charW = (fs, str) => 0.6 * fs * str.length;
const boxFor = (cx, baseline, anchor, str, fs) => {
  const w = charW(fs, str);
  const x0 = anchor === 'end' ? cx - w : anchor === 'middle' ? cx - w / 2 : cx;
  return { x0, x1: x0 + w, y0: baseline - fs, y1: baseline + fs * 0.3 };
};
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// Ratio label: one decimal below 10x, whole numbers with separators above.
export const fmtRatio = (r) => (r < 10 ? `${r.toFixed(1)}×` : `${Math.round(r).toLocaleString('en-US')}×`);

export function curveChart({ calibration, labX, xLabel, live }) {
  const W = 560; const H = 300; const L = 64; const R = 20; const T = 22; const B = 50;
  const R_YOU = 7; const CAL_R = 3.5;
  const xs = calibration.map((c) => c.x); const ys = calibration.map((c) => c.ratio);
  const youRatio = finite(live?.redo) ? live.redo : null;
  const x = logScale([Math.min(...xs) / 1.5, Math.max(...xs) * 1.5], [L, W - R]);
  const yMin = Math.min(0.5, ...ys, ...(youRatio ? [youRatio] : [])) / 1.3;
  const yMax = Math.max(...ys, ...(youRatio ? [youRatio] : [])) * 2.2;   // headroom for the legend
  const y = logScale([yMin, yMax], [H - B, T]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': `Times more redo, document model over converged, versus ${xLabel}` });

  // Every label gets a halo so it stays legible crossing gridlines or the reference line.
  const t = (attrs, text) => s('text', { 'paint-order': 'stroke', stroke: 'var(--panel)', 'stroke-width': 3, ...attrs }, text);

  svg.append(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'var(--hairline)' }));
  svg.append(s('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: 'var(--hairline)' }));
  for (const tk of x.ticks()) {
    svg.append(s('line', { x1: x(tk), y1: T, x2: x(tk), y2: H - B, stroke: 'var(--hairline)', 'stroke-dasharray': '2 4' }));
    svg.append(t({ x: x(tk), y: H - B + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, fmtN(tk)));
  }
  for (const tk of y.ticks()) {
    svg.append(t({ x: L - 8, y: y(tk) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, `${tk}×`));
  }
  svg.append(t({ x: (L + W - R) / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)' }, `${xLabel} (log)`));
  svg.append(t({ x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, 'times more redo: document ÷ converged (log)'));

  // Everything placed so far, so later labels avoid it: legend, break-even label, points, labels.
  const placed = [];
  const calObstacles = calibration.map((c) => ({ x0: x(c.x) - CAL_R - 3, x1: x(c.x) + CAL_R + 3, y0: y(c.ratio) - CAL_R - 3, y1: y(c.ratio) + CAL_R + 3 }));
  // The reference line between the points is an obstacle too: sample it as small boxes, so no
  // label is drawn across it.
  const lineObstacles = [];
  for (let i = 1; i < calibration.length; i++) {
    const ax = x(calibration[i - 1].x); const ay = y(calibration[i - 1].ratio);
    const bx = x(calibration[i].x); const by = y(calibration[i].ratio);
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 1; k < n; k++) {
      const px = ax + ((bx - ax) * k) / n; const py = ay + ((by - ay) * k) / n;
      lineObstacles.push({ x0: px - 2, x1: px + 2, y0: py - 2, y1: py + 2 });
    }
  }

  // Legend, top-left: ratios grow with size, so the reference line stays out of this corner.
  const lgX = L + 10; const lgY = T + 12; const lgFs = 11;
  svg.append(s('line', { x1: lgX, y1: lgY - 4, x2: lgX + 22, y2: lgY - 4, stroke: 'var(--muted)', 'stroke-width': 2.2 }));
  svg.append(s('circle', { cx: lgX + 11, cy: lgY - 4, r: CAL_R, fill: 'var(--panel)', stroke: 'var(--muted)', 'stroke-width': 1.6 }));
  const lg1 = 'measured on 26ai Free at other sizes';
  svg.append(t({ x: lgX + 30, y: lgY, 'font-size': lgFs, fill: 'var(--muted)' }, lg1));
  svg.append(s('circle', { cx: lgX + 11, cy: lgY + 14, r: 5, fill: 'var(--flow)' }));
  const lg2 = 'your run, at this lab\'s size';
  svg.append(t({ x: lgX + 30, y: lgY + 18, 'font-size': lgFs, fill: 'var(--flow)' }, lg2));
  placed.push({ x0: lgX - 4, x1: lgX + 30 + charW(lgFs, lg1) + 4, y0: lgY - lgFs - 4, y1: lgY + 22 });

  if (yMin < 1 && yMax > 1) {
    svg.append(s('line', { class: 'breakeven', x1: L, y1: y(1), x2: W - R, y2: y(1), stroke: 'var(--muted)', 'stroke-dasharray': '6 4' }));
    const beText = 'break-even · above = document writes more'; const beFs = 11;
    const labStrip = { x0: x(labX) - 10, x1: x(labX) + 10, y0: T, y1: H - B };
    const cands = [];
    for (const ty of [y(1) - 6, y(1) + beFs + 4]) {
      for (const [tx, anchor] of [[W - R - 4, 'end'], [L + 4, 'start']]) cands.push({ tx, ty, anchor, box: boxFor(tx, ty, anchor, beText, beFs) });
    }
    const be = cands.find((c) => ![labStrip, ...calObstacles, ...placed].some((o) => overlaps(c.box, o))) ?? cands[0];
    svg.append(t({ x: be.tx, y: be.ty, 'text-anchor': be.anchor, 'font-size': beFs, fill: 'var(--muted)' }, beText));
    placed.push(be.box);
    placed.push({ x0: L, x1: W - R, y0: y(1) - 2, y1: y(1) + 2 });   // the dashed line itself
  }

  // Reference line: neutral, because it is neither model; it is the measured gap at other sizes.
  const pts = calibration.map((c) => `${x(c.x).toFixed(1)},${y(c.ratio).toFixed(1)}`);
  svg.append(s('path', { class: 'cal', d: `M${pts.join(' L')}`, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2.2 }));
  for (const c of calibration) svg.append(s('circle', { class: 'calpt', cx: x(c.x), cy: y(c.ratio), r: CAL_R, fill: 'var(--panel)', stroke: 'var(--muted)', 'stroke-width': 1.6 }));

  // "Your run" marker: at the lab's size; nudged right if it would sit on a reference point.
  const youY = youRatio ? y(youRatio) : null;
  const onRef = youY != null && calibration.some((c) => Math.hypot(x(labX) - x(c.x), youY - y(c.ratio)) < R_YOU + CAL_R);
  const youX = x(labX) + (onRef ? R_YOU + CAL_R + 2 : 0);
  const youBox = youY != null ? { x0: youX - R_YOU - 2, x1: youX + R_YOU + 2, y0: youY - R_YOU - 2, y1: youY + R_YOU + 2 } : null;
  svg.append(s('line', { class: 'lab-guide', x1: x(labX), y1: youY != null ? youY + R_YOU + 2 : T, x2: x(labX), y2: H - B, stroke: 'var(--flow)', 'stroke-dasharray': '3 3', opacity: 0.6 }));

  // Greedy placement: right, left, above, below the anchor; first box clear of every obstacle.
  function placeLabel(mx, my, r, str, fs, obstacles) {
    const gap = 5;
    const clamp = (tx, anchor, ty) => {
      let b = boxFor(tx, ty, anchor, str, fs);
      if (b.x0 < L + 2) tx += L + 2 - b.x0;
      b = boxFor(tx, ty, anchor, str, fs);
      if (b.x1 > W - R) tx -= b.x1 - (W - R);
      return { x: tx, y: ty, anchor, box: boxFor(tx, ty, anchor, str, fs) };
    };
    // Below-right first: the reference line rises to the right, so that corner is clear of it.
    const cands = [
      clamp(mx + r + 1, 'start', my + r + fs),
      clamp(mx - r - 1, 'end', my - r - 2),
      clamp(mx + r + gap, 'start', my + fs * 0.32),
      clamp(mx - r - gap, 'end', my + fs * 0.32),
      clamp(mx, 'middle', my + r + gap + fs),
      clamp(mx, 'middle', my - r - gap),
    ];
    // Crowded spot (e.g. just above break-even, beside a reference point): step further out.
    for (let k = 1; k <= 3; k++) {
      const up = my - r - 2 - k * (fs + 3);
      cands.push(clamp(mx + r + 1, 'start', up), clamp(mx - r - 1, 'end', up), clamp(mx, 'middle', up));
    }
    const inside = (b) => b.y0 >= T - 4 && b.y1 <= H - B - 2;
    return cands.find((c) => inside(c.box) && !obstacles.some((o) => overlaps(c.box, o))) ?? cands[0];
  }

  // Your run's label first (it matters most), then each reference point's value.
  if (youY != null) {
    const text = `your run · ${fmtRatio(youRatio)}`;
    const lab = placeLabel(youX, youY, R_YOU, text, 12.5, [...placed, ...calObstacles, ...lineObstacles]);
    svg.append(t({ class: 'you-label', x: lab.x, y: lab.y, 'text-anchor': lab.anchor, 'font-size': 12.5, 'font-weight': 700, fill: 'var(--flow)' }, text));
    placed.push(lab.box);
  }
  calibration.forEach((c, i) => {
    const text = fmtRatio(c.ratio);
    const others = calObstacles.filter((_, j) => j !== i);
    const lab = placeLabel(x(c.x), y(c.ratio), CAL_R, text, 10.5, [...placed, ...others, ...lineObstacles, ...(youBox ? [youBox] : [])]);
    svg.append(t({ class: 'cal-label', x: lab.x, y: lab.y, 'text-anchor': lab.anchor, 'font-size': 10.5, fill: 'var(--muted)' }, text));
    placed.push(lab.box);
  });

  if (youY != null) svg.append(s('circle', { class: 'live-redo', cx: youX, cy: youY, r: R_YOU, fill: 'var(--flow)' }));
  return svg;
}
