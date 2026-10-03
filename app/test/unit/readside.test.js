// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { analyze, growth, verdict, readLabel, logSteps } from '../../public/js/readside.js';
import { linesChart, breakEvenChart } from '../../public/js/chart.js';

const st = (lio) => ({ stats: { 'session logical reads': lio }, result: { kind: 'dml' } });
const rd = (lio) => ({ stats: { 'session logical reads': lio }, result: { kind: 'rows' } });
const pt = (x, dw, cw, dr, cr) => ({ x, document: st(dw), converged: st(cw), reads: { document: rd(dr), converged: rd(cr) } });

describe('analyze', () => {
  it('break-even reads per write = (doc write - conv write) / (conv read - doc read)', () => {
    const [r] = analyze([pt(3, 43, 14, 2, 11)]);
    expect(r.breakEven).toBeCloseTo(29 / 9);
  });
  it('null when the document read is no cheaper (never wins); 0 when its write is no dearer (always wins)', () => {
    expect(analyze([pt(1, 20, 13, 3, 2)])[0].breakEven).toBeNull();
    expect(analyze([pt(1, 10, 13, 3, 5)])[0].breakEven).toBe(0);
  });
  it('skips sizes with a failed side or no reads', () => {
    const bad = { ...pt(2, 1, 1, 1, 2), document: { stats: {}, result: { kind: 'error' } } };
    expect(analyze([bad, { ...pt(3, 1, 1, 1, 2), reads: null }, pt(4, 30, 3, 3, 4)]).map((r) => r.x)).toEqual([4]);
  });
});

describe('growth', () => {
  it('labels flat, in-step and faster-than-size costs from the log-log slope', () => {
    expect(growth([1, 10, 100, 1000], [3, 3, 3, 3]).label).toBe('stays flat');
    expect(growth([1, 10, 100, 1000], [2, 20, 200, 2000]).label).toBe('grows in step with size');
    expect(growth([1, 10, 100], [1, 100, 10000]).label).toBe('grows faster than size');
  });
});

describe('verdict', () => {
  const rows = [{ x: 3, breakEven: 9 }, { x: 100, breakEven: 10 }, { x: 1000, breakEven: null }];
  it('all, some (up to a size) or none at the stated workload', () => {
    expect(verdict(rows.slice(0, 2), 67)).toEqual({ kind: 'all' });
    expect(verdict(rows, 67)).toEqual({ kind: 'some', upTo: 100, sizes: [3, 100] });
    expect(verdict(rows, 5)).toEqual({ kind: 'none' });
  });
});

const boxesOf = (svg, sel) => [...svg.querySelectorAll(sel)].map((e) => {
  const fs = Number(e.getAttribute('font-size')); const w = 0.6 * fs * e.textContent.length;
  const lx = Number(e.getAttribute('x')); const ly = Number(e.getAttribute('y')); const a = e.getAttribute('text-anchor');
  const x0 = a === 'end' ? lx - w : a === 'middle' ? lx - w / 2 : lx;
  return { t: e.textContent, x0, x1: x0 + w, y0: ly - fs, y1: ly + fs * 0.3 };
});
const noOverlap = (boxes) => {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i]; const B = boxes[j];
    expect(A.x0 < B.x1 && A.x1 > B.x0 && A.y0 < B.y1 && A.y1 > B.y0, `"${A.t}" overlaps "${B.t}"`).toBe(false);
  }
};

describe('read-side charts', () => {
  it('linesChart: two labelled lines, one point per size, no overlapping labels', () => {
    for (const [dr, cr] of [[[2, 2, 13, 110], [11, 40, 310, 3073]], [[3, 3, 28, 23], [4, 4, 4, 4]], [[3, 3, 3, 3], [4, 4, 4, 5]]]) {
      const xs = [3, 30, 300, 3000];
      const svg = linesChart({ xLabel: 'x', yLabel: 'blocks', series: [
        { name: 'document model: stays flat', tone: 'hot', points: xs.map((x, i) => ({ x, y: dr[i] })) },
        { name: 'converged: grows in step with size', tone: 'cool', points: xs.map((x, i) => ({ x, y: cr[i] })) }] });
      expect(svg.querySelectorAll('circle.pt-hot').length).toBe(4);
      expect(svg.querySelectorAll('circle.pt-cool').length).toBe(4);
      noOverlap(boxesOf(svg, 'text.line-label'));
    }
  });
  it('breakEvenChart: the curve, the workload line, and "never" markers', () => {
    const rows = [{ x: 33, breakEven: 27 }, { x: 100, breakEven: 33 }, { x: 1000, breakEven: null }, { x: 3600, breakEven: null }];
    const svg = breakEvenChart({ rows, workload: { readsPerWrite: 0.1, label: 'x' }, xLabel: 'readings' });
    expect(svg.querySelectorAll('circle.be-pt').length).toBe(2);
    expect(svg.querySelectorAll('circle.be-never').length).toBe(2);
    expect(svg.querySelector('line.workload')).not.toBeNull();
    expect(svg.textContent).toContain('this workload: ~0.1 reads per write');
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
    noOverlap(boxesOf(svg, 'text.be-label'));
  });
  it('breakEvenChart without a workload draws no workload line', () => {
    const svg = breakEvenChart({ rows: [{ x: 10, breakEven: 7 }, { x: 100, breakEven: 7 }], workload: null, xLabel: 'x' });
    expect(svg.querySelector('line.workload')).toBeNull();
  });
});

describe('readLabel and logSteps', () => {
  const r = (x, docRead, convRead, convWrite, docRows = 1, convRows = 1) => ({ x, docRead, convRead, docWrite: 99, convWrite, docRows, convRows });
  it('describes a multi-item read per item returned (pattern 5: explosions)', () => {
    const rows = [r(3, 2, 11, 14, 2, 2), r(3000, 110, 3073, 24, 2999, 2999)];
    expect(readLabel(rows, 'docRead', 'docRows')).toBe('about 0.04 blocks per item returned');
    expect(readLabel(rows, 'convRead', 'convRows')).toBe('about 1.0 blocks per item returned');
  });
  it('a one-item read keeps the growth label', () => {
    expect(readLabel([r(1, 3, 4, 3), r(1000, 3, 5, 3)], 'convRead', 'convRows')).toBe('stays flat');
  });
  it('notes a flat series that still rises (pattern 1: 4 to 5 blocks at 1,000), and skips multi-item reads', () => {
    // The converged write's 3 → 4 → 3 wobble is noise (it drops back), so only the read is reported.
    const p1 = [r(1, 3, 4, 3), r(10, 3, 4, 4), r(100, 3, 4, 3), r(1000, 3, 5, 3)];
    expect(logSteps(p1)).toEqual([{ kind: 'index', what: 'converged read', from: 4, to: 5, at: 1000 }]);
    // A single-item document read that grows is the document's size, not an index (pattern 4).
    const p4 = [r(3, 3, 4, 7), r(100, 3, 4, 7), r(1000, 6, 5, 7)];
    // ...while its converged read stepping 4 → 5 at 1,000 claims (and staying) is the claims index gaining a level.
    expect(logSteps(p4)).toEqual([{ kind: 'index', what: 'converged read', from: 4, to: 5, at: 1000 },
      { kind: 'doc', what: 'document read', from: 3, to: 6, at: 1000 }]);
    const p5 = [r(3, 2, 11, 14, 2, 2), r(30, 2, 40, 14, 29, 29), r(300, 14, 310, 15, 299, 299), r(3000, 110, 3073, 24, 2999, 2999)];   // 14 → 15 at 300, the big step at 3,000
    expect(logSteps(p5)).toEqual([{ kind: 'index', what: 'converged write', from: 14, to: 24, at: 3000 }]);
  });
});
