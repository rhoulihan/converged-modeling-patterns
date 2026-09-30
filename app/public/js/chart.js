// Log-log "write amplification vs size" chart: the measured reference calibration as a line with
// points, y = 1 (break-even) dashed, and this attendee's live measurement as a marker at lab_x.
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

export function curveChart({ calibration, labX, xLabel, live }) {
  const W = 560; const H = 300; const L = 64; const R = 20; const T = 22; const B = 50;
  const R_REDO = 7; const R_BLOCKS = 6;
  const xs = calibration.map((c) => c.x); const ys = calibration.map((c) => c.ratio);
  const yl = [live?.redo, live?.blocks].filter(finite);
  const x = logScale([Math.min(...xs) / 1.5, Math.max(...xs) * 1.5], [L, W - R]);
  const yMin = Math.min(0.5, ...ys, ...yl) / 1.3; const yMax = Math.max(...ys, ...yl) * 1.5;
  const y = logScale([yMin, yMax], [H - B, T]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'curve', role: 'img', 'aria-label': `Document model divided by converged, versus ${xLabel}` });

  // Every dynamic label in the plot gets a halo so it stays legible crossing gridlines or the
  // calibration curve (static ticks/titles get it too — harmless over the plain paper background).
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
  svg.append(t({ x: 14, y: (T + H - B) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)', transform: `rotate(-90 14 ${(T + H - B) / 2})` }, 'document ÷ converged (log)'));

  // Calibration points (r 3.5) padded by 4px: every label placed below treats them as obstacles.
  const CAL_R = 3.5;
  const calObstacles = calibration.map((c) => ({ x0: x(c.x) - CAL_R - 4, x1: x(c.x) + CAL_R + 4, y0: y(c.ratio) - CAL_R - 4, y1: y(c.ratio) + CAL_R + 4 }));

  // Boxes already committed to the plot — break-even, lab-data, then the live labels as each is
  // placed — so later placements know what to avoid.
  const placed = [];

  if (yMin < 1 && yMax > 1) {
    svg.append(s('line', { class: 'breakeven', x1: L, y1: y(1), x2: W - R, y2: y(1), stroke: 'var(--muted)', 'stroke-dasharray': '6 4' }));
    const beText = 'break-even · above = document writes more'; const beFs = 11;
    // Try left-above, right-above, left-below, right-below the line; take the first that stays
    // 10px clear of the lab-data guide and clear of every calibration point. A point at small x
    // with a ratio just above 1 (02-computed's x=10) sits exactly where left-above would go.
    const labStrip = { x0: x(labX) - 10, x1: x(labX) + 10, y0: T, y1: H - B };
    const cands = [];
    for (const ty of [y(1) - 6, y(1) + beFs + 4]) {
      for (const [tx, anchor] of [[L + 4, 'start'], [W - R - 4, 'end']]) cands.push({ tx, ty, anchor, box: boxFor(tx, ty, anchor, beText, beFs) });
    }
    const be = cands.find((c) => ![labStrip, ...calObstacles].some((o) => overlaps(c.box, o))) ?? cands[0];
    svg.append(t({ x: be.tx, y: be.ty, 'text-anchor': be.anchor, 'font-size': beFs, fill: 'var(--muted)' }, beText));
    placed.push(be.box);
  }

  const pts = calibration.map((c) => `${x(c.x).toFixed(1)},${y(c.ratio).toFixed(1)}`);
  svg.append(s('path', { class: 'cal', d: `M${pts.join(' L')}`, fill: 'none', stroke: 'var(--hot)', 'stroke-width': 2.2 }));
  for (const c of calibration) svg.append(s('circle', { class: 'calpt', cx: x(c.x), cy: y(c.ratio), r: CAL_R, fill: 'var(--panel)', stroke: 'var(--hot)', 'stroke-width': 1.6 }));
  // The "measured on 26ai Free (reference run)" annotation used to live here, pinned beside the
  // highest calibration point — which is also always near the top of the chart, since every
  // pattern's ratio increases with size. That collided with the lab-data label whenever the lab's
  // own x was log-close to the domain's high end. It now lives in the caption below the chart
  // (measure.js), which needs no collision handling at all.

  // ---- live markers ----
  const redoY = finite(live?.redo) ? y(live.redo) : null;
  const blocksY = finite(live?.blocks) ? y(live.blocks) : null;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const nearCalibration = (cy, r) => calibration.some((c) => dist(x(labX), cy, x(c.x), y(c.ratio)) < r);
  // The lab's x is often exactly one of the calibration x's by construction, so a live ratio close
  // to that point's reference ratio lands the marker almost on top of the calibration circle — and
  // the two live markers can just as easily land on top of each other. Either case: split them
  // apart horizontally rather than let them merge into one blob.
  let needOffset = false;
  if (redoY != null && blocksY != null && Math.abs(redoY - blocksY) < R_REDO + R_BLOCKS + 2) needOffset = true;
  if (redoY != null && nearCalibration(redoY, R_REDO)) needOffset = true;
  if (blocksY != null && nearCalibration(blocksY, R_BLOCKS)) needOffset = true;
  const redoCx = x(labX) + (needOffset ? 8 : 0);
  const blocksCx = x(labX) - (needOffset ? 8 : 0);

  // The guide line used to run the full plot height; now it stops short of the higher marker (or
  // at the top when there is none) so it never runs through a label sitting above it.
  const markerYs = [redoY, blocksY].filter((v) => v != null);
  const guideTop = markerYs.length ? Math.max(T, Math.min(...markerYs) - 12) : T;
  svg.append(s('line', { x1: x(labX), y1: guideTop, x2: x(labX), y2: H - B, stroke: 'var(--flow)', 'stroke-dasharray': '3 3' }));
  const labFs = 11; const labText = `lab data · ${fmtN(labX)}`;
  svg.append(t({ x: x(labX) + 4, y: H - B - 6, 'font-size': labFs, fill: 'var(--flow)' }, labText));
  placed.push(boxFor(x(labX) + 4, H - B - 6, 'start', labText, labFs));

  // Greedy label placement: try right of the marker, then left, then above, then below; take the
  // first whose estimated box clears every marker, calibration point and label already placed. Clamped inside
  // [L, W-R]; a "right" try that would overflow past the edge instead anchors from the marker.
  function placeLabel(mx, my, r, str, fs, obstacles) {
    const gap = 6;
    const clampX = (tx, anchor) => {
      let box = boxFor(tx, my, anchor, str, fs);
      if (box.x0 < L) tx += L - box.x0;
      box = boxFor(tx, my, anchor, str, fs);
      if (box.x1 > W - R) tx -= box.x1 - (W - R);
      return tx;
    };
    let right = { x: mx + r + gap, y: my + fs * 0.32, anchor: 'start' };
    let rightBox = boxFor(right.x, right.y, right.anchor, str, fs);
    if (rightBox.x1 > W - R) { right = { x: mx - 12, y: right.y, anchor: 'end' }; rightBox = boxFor(right.x, right.y, right.anchor, str, fs); }
    const leftX = clampX(mx - r - gap, 'end'); const left = { x: leftX, y: my + fs * 0.32, anchor: 'end', box: boxFor(leftX, my + fs * 0.32, 'end', str, fs) };
    const aboveX = clampX(mx, 'middle'); const above = { x: aboveX, y: my - r - gap, anchor: 'middle', box: boxFor(aboveX, my - r - gap, 'middle', str, fs) };
    const belowY = my + r + gap + fs; const below = { x: aboveX, y: belowY, anchor: 'middle', box: boxFor(aboveX, belowY, 'middle', str, fs) };
    for (const cand of [{ ...right, box: rightBox }, left, above, below]) {
      if (!obstacles.some((o) => overlaps(cand.box, o))) return cand;
    }
    return { ...right, box: rightBox };
  }

  if (redoY != null) {
    const markerObstacles = blocksY != null ? [{ x0: blocksCx - R_BLOCKS, x1: blocksCx + R_BLOCKS, y0: blocksY - R_BLOCKS, y1: blocksY + R_BLOCKS }] : [];
    const text = `you · ${live.redo.toFixed(1)}× redo`;
    const label = placeLabel(redoCx, redoY, R_REDO, text, 12, [...placed, ...calObstacles, ...markerObstacles]);
    svg.append(t({ x: label.x, y: label.y, 'text-anchor': label.anchor, 'font-size': 12, 'font-weight': 700, fill: 'var(--flow)' }, text));
    placed.push(label.box);
  }
  if (blocksY != null) {
    const markerObstacles = redoY != null ? [{ x0: redoCx - R_REDO, x1: redoCx + R_REDO, y0: redoY - R_REDO, y1: redoY + R_REDO }] : [];
    const text = `blocks ${live.blocks.toFixed(1)}×`;
    const label = placeLabel(blocksCx, blocksY, R_BLOCKS, text, 11, [...placed, ...calObstacles, ...markerObstacles]);
    svg.append(t({ x: label.x, y: label.y, 'text-anchor': label.anchor, 'font-size': 11, fill: 'var(--flow)' }, text));
    placed.push(label.box);
  }

  // Markers drawn last so they sit on top of the calibration curve, points and gridlines.
  if (blocksY != null) svg.append(s('circle', { class: 'live-blocks', cx: blocksCx, cy: blocksY, r: R_BLOCKS, fill: 'none', stroke: 'var(--flow)', 'stroke-width': 2 }));
  if (redoY != null) svg.append(s('circle', { class: 'live-redo', cx: redoCx, cy: redoY, r: R_REDO, fill: 'var(--flow)' }));

  return svg;
}
