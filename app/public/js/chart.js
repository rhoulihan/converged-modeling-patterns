// Log-log "how the gap grows" chart: the attendee's own runs, one per size, as a labelled curve,
// with y = 1 (break-even) dashed and a legend.
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

// points: [{ x, ratio }] measured just now, one per size. Drawn as the attendee's own curve.
export function curveChart({ points, xLabel }) {
  const W = 560; const H = 300; const L = 64; const R = 20; const T = 22; const B = 50;
  const PT_R = 5;
  const pts = points.filter((q) => finite(q.ratio));
  const xs = pts.map((q) => q.x); const ys = pts.map((q) => q.ratio);
  const x = logScale([Math.min(...xs) / 1.5, Math.max(...xs) * 1.5], [L, W - R]);
  const yMin = Math.min(0.5, ...ys) / 1.3;
  const yMax = Math.max(...ys) * 2.2;   // headroom for the legend
  const y = logScale([yMin, yMax], [H - B, T]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': `Times more redo, document model over converged, versus ${xLabel}` });
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

  const placed = [];
  const ptObstacles = pts.map((q) => ({ x0: x(q.x) - PT_R - 2, x1: x(q.x) + PT_R + 2, y0: y(q.ratio) - PT_R - 2, y1: y(q.ratio) + PT_R + 2 }));
  const lineObstacles = [];
  for (let i = 1; i < pts.length; i++) {
    const ax = x(pts[i - 1].x); const ay = y(pts[i - 1].ratio); const bx = x(pts[i].x); const by = y(pts[i].ratio);
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 1; k < n; k++) {
      const px = ax + ((bx - ax) * k) / n; const py = ay + ((by - ay) * k) / n;
      lineObstacles.push({ x0: px - 2, x1: px + 2, y0: py - 2, y1: py + 2 });
    }
  }

  // Legend, top-left (ratios grow with size, so the curve stays out of this corner).
  const lgX = L + 10; const lgY = T + 12; const lgFs = 11.5;
  svg.append(s('line', { x1: lgX, y1: lgY - 4, x2: lgX + 22, y2: lgY - 4, stroke: 'var(--flow)', 'stroke-width': 2.4 }));
  svg.append(s('circle', { cx: lgX + 11, cy: lgY - 4, r: 4, fill: 'var(--flow)' }));
  const lg = 'your runs: one per size, measured just now';
  svg.append(t({ x: lgX + 30, y: lgY, 'font-size': lgFs, fill: 'var(--flow)' }, lg));
  placed.push({ x0: lgX - 4, x1: lgX + 30 + charW(lgFs, lg) + 4, y0: lgY - lgFs - 4, y1: lgY + 6 });

  if (yMin < 1 && yMax > 1) {
    svg.append(s('line', { class: 'breakeven', x1: L, y1: y(1), x2: W - R, y2: y(1), stroke: 'var(--muted)', 'stroke-dasharray': '6 4' }));
    const beText = 'break-even · above = document writes more'; const beFs = 11;
    const cands = [];
    for (const ty of [y(1) - 6, y(1) + beFs + 4]) {
      for (const [tx, anchor] of [[W - R - 4, 'end'], [L + 4, 'start']]) cands.push({ tx, ty, anchor, box: boxFor(tx, ty, anchor, beText, beFs) });
    }
    const be = cands.find((c) => ![...ptObstacles, ...lineObstacles, ...placed].some((o) => overlaps(c.box, o))) ?? cands[0];
    svg.append(t({ x: be.tx, y: be.ty, 'text-anchor': be.anchor, 'font-size': beFs, fill: 'var(--muted)' }, beText));
    placed.push(be.box, { x0: L, x1: W - R, y0: y(1) - 2, y1: y(1) + 2 });
  }

  const d = pts.map((q) => `${x(q.x).toFixed(1)},${y(q.ratio).toFixed(1)}`);
  svg.append(s('path', { class: 'run', d: `M${d.join(' L')}`, fill: 'none', stroke: 'var(--flow)', 'stroke-width': 2.4 }));

  function placeLabel(mx, my, r, str, fs, obstacles) {
    const clamp = (tx, anchor, ty) => {
      let b = boxFor(tx, ty, anchor, str, fs);
      if (b.x0 < L + 2) tx += L + 2 - b.x0;
      b = boxFor(tx, ty, anchor, str, fs);
      if (b.x1 > W - R) tx -= b.x1 - (W - R);
      return { x: tx, y: ty, anchor, box: boxFor(tx, ty, anchor, str, fs) };
    };
    // Below-right first (the curve rises to the right), then above-left, then further out.
    const cands = [
      clamp(mx + r + 1, 'start', my + r + fs),
      clamp(mx - r - 1, 'end', my - r - 2),
      clamp(mx + r + 5, 'start', my + fs * 0.32),
      clamp(mx - r - 5, 'end', my + fs * 0.32),
      clamp(mx, 'middle', my + r + 5 + fs),
      clamp(mx, 'middle', my - r - 5),
    ];
    for (let k = 1; k <= 3; k++) {
      const up = my - r - 2 - k * (fs + 3);
      cands.push(clamp(mx + r + 1, 'start', up), clamp(mx - r - 1, 'end', up), clamp(mx, 'middle', up));
    }
    const inside = (b) => b.y0 >= T - 4 && b.y1 <= H - B - 2;
    return cands.find((c) => inside(c.box) && !obstacles.some((o) => overlaps(c.box, o))) ?? cands[0];
  }
  pts.forEach((q, i) => {
    const text = fmtRatio(q.ratio);
    const others = ptObstacles.filter((_, j) => j !== i);
    const lab = placeLabel(x(q.x), y(q.ratio), PT_R, text, 12, [...placed, ...others, ...lineObstacles]);
    svg.append(t({ class: 'pt-label', x: lab.x, y: lab.y, 'text-anchor': lab.anchor, 'font-size': 12, 'font-weight': 700, fill: 'var(--flow)' }, text));
    placed.push(lab.box);
  });
  for (const q of pts) svg.append(s('circle', { class: 'runpt', cx: x(q.x), cy: y(q.ratio), r: PT_R, fill: 'var(--flow)' }));
  return svg;
}

// ---- shared frame for the read-side charts (log-log, same look as curveChart) ----
function frame({ xs, yMin, yMax, xLabel, yLabel, aria }) {
  const W = 560; const H = 300; const L = 64; const R = 20; const T = 22; const B = 50;
  const x = logScale([Math.min(...xs) / 1.5, Math.max(...xs) * 1.5], [L, W - R]);
  const y = logScale([yMin, yMax], [H - B, T]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': aria });
  const t = (attrs, text) => s('text', { 'paint-order': 'stroke', stroke: 'var(--panel)', 'stroke-width': 3, ...attrs }, text);
  svg.append(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: 'var(--hairline)' }));
  svg.append(s('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: 'var(--hairline)' }));
  for (const tk of x.ticks()) {
    svg.append(s('line', { x1: x(tk), y1: T, x2: x(tk), y2: H - B, stroke: 'var(--hairline)', 'stroke-dasharray': '2 4' }));
    svg.append(t({ x: x(tk), y: H - B + 16, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, fmtN(tk)));
  }
  for (const tk of y.ticks()) svg.append(t({ x: L - 8, y: y(tk) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, fmtN(tk)));
  svg.append(t({ x: (L + W - R) / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)' }, `${xLabel} (log)`));
  svg.append(t({ x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, yLabel));
  return { svg, x, y, t, W, H, L, R, T, B };
}

function placeLabelIn(f, mx, my, r, str, fs, obstacles) {
  const { L, W, R, T, H, B } = f;
  const clamp = (tx, anchor, ty) => {
    let b = boxFor(tx, ty, anchor, str, fs);
    if (b.x0 < L + 2) tx += L + 2 - b.x0;
    b = boxFor(tx, ty, anchor, str, fs);
    if (b.x1 > W - R) tx -= b.x1 - (W - R);
    return { x: tx, y: ty, anchor, box: boxFor(tx, ty, anchor, str, fs) };
  };
  const cands = [clamp(mx + r + 1, 'start', my + r + fs), clamp(mx - r - 1, 'end', my - r - 2), clamp(mx + r + 5, 'start', my + fs * 0.32),
    clamp(mx - r - 5, 'end', my + fs * 0.32), clamp(mx, 'middle', my + r + 5 + fs), clamp(mx, 'middle', my - r - 5)];
  for (let k = 1; k <= 3; k++) { const up = my - r - 2 - k * (fs + 3); cands.push(clamp(mx + r + 1, 'start', up), clamp(mx - r - 1, 'end', up)); }
  const inside = (b) => b.y0 >= T - 4 && b.y1 <= H - B - 2;
  return cands.find((c) => inside(c.box) && !obstacles.some((o) => overlaps(c.box, o))) ?? cands[0];
}
const segObstacles = (pts) => {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 1; k < n; k++) { const px = ax + ((bx - ax) * k) / n; const py = ay + ((by - ay) * k) / n; out.push({ x0: px - 2, x1: px + 2, y0: py - 2, y1: py + 2 }); }
  }
  return out;
};

// Two cost lines against size (e.g. blocks touched by each model's read). Every point labelled.
// series: [{ name, tone: 'hot'|'cool', points: [{ x, y }] }]
export function linesChart({ series, xLabel, yLabel }) {
  const all = series.flatMap((sr) => sr.points);
  const ys = all.map((p) => Math.max(1, p.y));
  const f = frame({ xs: all.map((p) => p.x), yMin: Math.min(...ys) / 2, yMax: Math.max(...ys) * 4, xLabel, yLabel, aria: `${yLabel} versus ${xLabel}` });
  const { svg, x, y, t, L, T } = f;
  const R0 = 4.5; const placed = [];
  const col = (tone) => (tone === 'hot' ? 'var(--hot)' : 'var(--cool)');
  // legend
  series.forEach((sr, i) => {
    const ly = T + 12 + i * 18;
    svg.append(s('line', { x1: L + 10, y1: ly - 4, x2: L + 32, y2: ly - 4, stroke: col(sr.tone), 'stroke-width': 2.4 }));
    svg.append(s('circle', { cx: L + 21, cy: ly - 4, r: 3.5, fill: col(sr.tone) }));
    svg.append(t({ x: L + 40, y: ly, 'font-size': 11.5, fill: col(sr.tone) }, sr.name));
    placed.push({ x0: L + 6, x1: L + 40 + charW(11.5, sr.name) + 4, y0: ly - 15, y1: ly + 5 });
  });
  const geo = series.map((sr) => sr.points.map((p) => [x(p.x), y(Math.max(1, p.y))]));
  const pts = geo.flatMap((g) => g.map(([px, py]) => ({ x0: px - R0 - 2, x1: px + R0 + 2, y0: py - R0 - 2, y1: py + R0 + 2 })));
  const lines = geo.flatMap(segObstacles);
  series.forEach((sr, i) => svg.append(s('path', { class: `line-${sr.tone}`, d: `M${geo[i].map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L')}`, fill: 'none', stroke: col(sr.tone), 'stroke-width': 2.4 })));
  series.forEach((sr, i) => sr.points.forEach((p, j) => {
    const [px, py] = geo[i][j]; const text = Math.round(p.y).toLocaleString('en-US');
    const lab = placeLabelIn(f, px, py, R0, text, 11, [...placed, ...pts.filter((o) => !(o.x0 === px - R0 - 2 && o.y0 === py - R0 - 2)), ...lines]);
    svg.append(t({ class: 'line-label', x: lab.x, y: lab.y, 'text-anchor': lab.anchor, 'font-size': 11, 'font-weight': 600, fill: col(sr.tone) }, text));
    placed.push(lab.box);
  }));
  series.forEach((sr, i) => geo[i].forEach(([px, py]) => svg.append(s('circle', { class: `pt-${sr.tone}`, cx: px, cy: py, r: R0, fill: col(sr.tone) }))));
  return svg;
}

// Break-even reads per write against size, with the stated workload as a line: the document
// model is cheaper overall wherever the curve sits below the workload line. null = never.
export function breakEvenChart({ rows, workload, xLabel }) {
  const finiteRows = rows.filter((r) => r.breakEven !== null && r.breakEven > 0);
  const vals = [...finiteRows.map((r) => r.breakEven), ...(workload ? [workload.readsPerWrite] : [])];
  const yMin = Math.max(0.01, Math.min(...vals, 1) / 3); const yMax = Math.max(...vals, 10) * 30;
  const f = frame({ xs: rows.map((r) => r.x), yMin, yMax, xLabel, yLabel: 'reads per write needed (log)', aria: `Reads per write the document model needs to win, versus ${xLabel}` });
  const { svg, x, y, t, L, W, R, T } = f;
  const placed = [];
  const ly = T + 12;
  svg.append(s('line', { x1: L + 10, y1: ly - 4, x2: L + 32, y2: ly - 4, stroke: 'var(--flow)', 'stroke-width': 2.4 }));
  const lg = 'break-even: reads per write for the document model to win';
  svg.append(t({ x: L + 40, y: ly, 'font-size': 11.5, fill: 'var(--flow)' }, lg));
  placed.push({ x0: L + 6, x1: L + 40 + charW(11.5, lg) + 4, y0: ly - 15, y1: ly + 5 });
  if (workload) {
    const wy = y(workload.readsPerWrite);
    svg.append(s('line', { class: 'workload', x1: L, y1: wy, x2: W - R, y2: wy, stroke: 'var(--ink)', 'stroke-dasharray': '6 4', 'stroke-width': 1.4 }));
    const wText = `this workload: ~${fmtN(Math.round(workload.readsPerWrite * 10) / 10)} reads per write`;
    svg.append(t({ x: W - R - 4, y: wy - 6, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600, fill: 'var(--ink)' }, wText));
    svg.append(t({ x: W - R - 4, y: wy + 15, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--muted)' }, 'below the line: the document model wins'));
    placed.push(boxFor(W - R - 4, wy - 6, 'end', wText, 11), boxFor(W - R - 4, wy + 15, 'end', 'below the line: the document model wins', 10.5), { x0: L, x1: W - R, y0: wy - 2, y1: wy + 2 });
  }
  const geo = finiteRows.map((r) => [x(r.x), y(r.breakEven)]);
  if (geo.length > 1) svg.append(s('path', { class: 'be-line', d: `M${geo.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L')}`, fill: 'none', stroke: 'var(--flow)', 'stroke-width': 2.4 }));
  const lines = segObstacles(geo);
  const ptBoxes = geo.map(([px, py]) => ({ x0: px - 7, x1: px + 7, y0: py - 7, y1: py + 7 }));
  finiteRows.forEach((r, i) => {
    const [px, py] = geo[i]; const text = (r.breakEven >= 10 ? Math.round(r.breakEven) : Math.round(r.breakEven * 10) / 10).toLocaleString('en-US');
    const lab = placeLabelIn(f, px, py, 5, text, 11.5, [...placed, ...ptBoxes.filter((_, j) => j !== i), ...lines]);
    svg.append(t({ class: 'be-label', x: lab.x, y: lab.y, 'text-anchor': lab.anchor, 'font-size': 11.5, 'font-weight': 700, fill: 'var(--flow)' }, text));
    placed.push(lab.box);
  });
  geo.forEach(([px, py]) => svg.append(s('circle', { class: 'be-pt', cx: px, cy: py, r: 5, fill: 'var(--flow)' })));
  // Sizes where the document's read is no cheaper: it never wins, whatever the mix.
  rows.filter((r) => r.breakEven === null).forEach((r) => {
    const px = x(r.x); const py = T + 40;
    svg.append(s('circle', { class: 'be-never', cx: px, cy: py, r: 5, fill: 'var(--panel)', stroke: 'var(--hot)', 'stroke-width': 2 }));
    svg.append(t({ x: px, y: py + 18, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 600, fill: 'var(--hot)' }, 'never'));
  });
  return svg;
}
