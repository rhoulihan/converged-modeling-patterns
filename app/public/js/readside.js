// Read side of Measure it: reads and writes in one unit (logical reads: blocks touched), per
// size, and what follows from them: how each cost grows with size, and how many reads per write
// the document model needs before it is the cheaper model overall.
const lio = (s) => (s && typeof s['session logical reads'] === 'number' ? s['session logical reads'] : null);
const ok = (side) => side && side.result && side.result.kind !== 'error';

// Per size: blocks for each model's read and write, and the break-even reads per write.
//   document day  = R * docRead  + W * docWrite
//   converged day = R * convRead + W * convWrite
//   document cheaper when R / W > (docWrite - convWrite) / (convRead - docRead)
// null breakEven = the document never wins (its read is no cheaper); 0 = it always wins.
export function analyze(points) {
  return points
    .filter((q) => q.reads && ok(q.document) && ok(q.converged) && ok(q.reads.document) && ok(q.reads.converged))
    .map((q) => {
      const dr = lio(q.reads.document.stats); const cr = lio(q.reads.converged.stats);
      const dw = lio(q.document.stats); const cw = lio(q.converged.stats);
      let breakEven;
      if (cr <= dr) breakEven = null;
      else if (dw <= cw) breakEven = 0;
      else breakEven = (dw - cw) / (cr - dr);
      return { x: q.x, docRead: dr, convRead: cr, docWrite: dw, convWrite: cw, breakEven,
        docRows: q.reads.document.rows ?? 1, convRows: q.reads.converged.rows ?? 1 };
    });
}

// Log-log least-squares slope: how a cost grows with size (1 = in step with size, 0 = flat).
export function growth(xs, ys) {
  const pts = xs.map((x, i) => [Math.log10(x), Math.log10(Math.max(1, ys[i]))]);
  const n = pts.length;
  if (n < 2) return { slope: 0, label: 'not enough sizes' };
  const mx = pts.reduce((a, p) => a + p[0], 0) / n; const my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const slope = sxx ? pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx : 0;
  const label = slope < 0.15 ? 'stays flat' : slope < 0.6 ? 'grows slower than size' : slope < 1.3 ? 'grows in step with size' : 'grows faster than size';
  return { slope, label };
}

// Where the document model wins at the stated workload: sizes with a break-even at or below it.
export function verdict(rows, readsPerWrite) {
  if (!rows.length) return null;
  const wins = rows.filter((r) => r.breakEven !== null && r.breakEven <= readsPerWrite).map((r) => r.x);
  if (wins.length === rows.length) return { kind: 'all' };
  if (!wins.length) return { kind: 'none' };
  return { kind: 'some', upTo: Math.max(...wins), sizes: wins };
}

// How to describe a read's cost: per item returned when it returns many items (an explosion, a
// list), otherwise by how it grows with size.
export function readLabel(rows, blocksKey, rowsKey) {
  const last = rows[rows.length - 1];
  if (Math.max(...rows.map((r) => r[rowsKey])) > 1) {
    const per = last[blocksKey] / Math.max(1, last[rowsKey]);
    return `about ${per < 0.1 ? per.toFixed(2) : per.toFixed(1)} blocks per item returned`;
  }
  return growth(rows.map((r) => r.x), rows.map((r) => r[blocksKey])).label;
}

// Small rises in a cost that is otherwise flat, with their cause:
//  - a converged read or write that steps up and stays up: an index gaining a level as its
//    table grows (log n). A rise that drops back is run-to-run noise and is not reported.
//  - a single-item document read that rises: the document outgrew a block, so reading it
//    touches more blocks (its size, not an index).
export function logSteps(rows) {
  const xs = rows.map((r) => r.x); const out = [];
  const single = (key) => Math.max(...rows.map((r) => r[key])) <= 1;
  const persistent = (ys) => ys.every((y, i) => i === 0 || y >= ys[i - 1]);
  const bigStep = (ys) => {
    let at = rows[1].x; let best = -Infinity;
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > best) { best = ys[i] - ys[i - 1]; at = rows[i].x; }
    return at;
  };
  for (const [key, rowsKey, what] of [['convRead', 'convRows', 'converged read'], ['convWrite', null, 'converged write']]) {
    if (rowsKey && !single(rowsKey)) continue;   // multi-item reads grow with the items returned
    const ys = rows.map((r) => r[key]);
    if (growth(xs, ys).label !== 'stays flat' || ys[ys.length - 1] <= ys[0] || !persistent(ys)) continue;
    out.push({ kind: 'index', what, from: ys[0], to: ys[ys.length - 1], at: bigStep(ys) });
  }
  if (single('docRows')) {
    const ys = rows.map((r) => r.docRead);
    if (ys[ys.length - 1] > ys[0]) out.push({ kind: 'doc', what: 'document read', from: ys[0], to: ys[ys.length - 1], at: bigStep(ys) });
  }
  return out;
}

export const fmtCount = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1));
