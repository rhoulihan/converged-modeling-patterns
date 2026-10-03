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
  it('draws the reference line with labelled points, break-even, a legend and one "your run" marker', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'CDR items', live: { redo: 32.8 } });
    expect(svg.querySelector('path.cal')).not.toBeNull();
    expect(svg.querySelectorAll('circle.calpt').length).toBe(4);
    expect([...svg.querySelectorAll('text.cal-label')].map((e) => e.textContent)).toEqual(['1.2×', '5.0×', '33×', '260×']);
    expect(svg.querySelector('line.breakeven')).not.toBeNull();
    expect(svg.querySelectorAll('circle.live-redo').length).toBe(1);
    expect(svg.querySelector('circle.live-blocks')).toBeNull();
    expect(svg.querySelector('text.you-label').textContent).toBe('your run · 33×');
    expect(svg.textContent).toContain('measured on 26ai Free at other sizes');
    expect(svg.textContent).toContain("your run, at this lab's size");
  });
  it('no marker when the live ratio is not finite', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'x', live: { redo: Infinity } });
    expect(svg.querySelector('circle.live-redo')).toBeNull();
    expect(svg.querySelector('text.you-label')).toBeNull();
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('nudges the marker off a reference point it would sit on', () => {
    const svg = curveChart({ calibration: CAL, labX: 10, xLabel: 'x', live: { redo: 1.2 } });
    const dot = svg.querySelector('circle.live-redo');
    const ref = svg.querySelector('circle.calpt');
    expect(Number(dot.getAttribute('cx'))).toBeGreaterThan(Number(ref.getAttribute('cx')));
  });
  it('keeps the "your run" label inside the plot when labX sits at the maximum calibration x', () => {
    const svg = curveChart({ calibration: CAL, labX: 5000, xLabel: 'x', live: { redo: 120 } });
    const el = svg.querySelector('text.you-label');
    const fs = Number(el.getAttribute('font-size')); const w = 0.6 * fs * el.textContent.length;
    const lx = Number(el.getAttribute('x')); const anchor = el.getAttribute('text-anchor');
    const x1 = anchor === 'end' ? lx : anchor === 'middle' ? lx + w / 2 : lx + w;
    expect(x1).toBeLessThanOrEqual(541);
  });
  it('no two labels overlap, for every pattern-shaped calibration', () => {
    const cases = [
      { cal: CAL, labX: 1000, redo: 32.8 },
      { cal: [{ x: 1, ratio: 3.4 }, { x: 10, ratio: 30 }, { x: 100, ratio: 300 }, { x: 1000, ratio: 3000 }], labX: 2, redo: 6.1 },
      { cal: [{ x: 3, ratio: 6.75 }, { x: 30, ratio: 53.8 }, { x: 300, ratio: 527 }, { x: 3000, ratio: 5138 }], labX: 3, redo: 6.6 },
      { cal: [{ x: 1, ratio: 2.82 }, { x: 2, ratio: 3.97 }, { x: 4, ratio: 6.12 }, { x: 6, ratio: 8.29 }, { x: 7, ratio: 9.47 }], labX: 6, redo: 8.3 },
      { cal: [{ x: 3, ratio: 1.6 }, { x: 10, ratio: 1.9 }, { x: 100, ratio: 6.1 }, { x: 1000, ratio: 26 }], labX: 3, redo: 1.5 },
    ];
    for (const { cal, labX, redo } of cases) {
      const svg = curveChart({ calibration: cal, labX, xLabel: 'x', live: { redo } });
      const boxes = [...svg.querySelectorAll('text.you-label, text.cal-label')].map((e) => {
        const fs = Number(e.getAttribute('font-size')); const w = 0.6 * fs * e.textContent.length;
        const lx = Number(e.getAttribute('x')); const ly = Number(e.getAttribute('y')); const a = e.getAttribute('text-anchor');
        const x0 = a === 'end' ? lx - w : a === 'middle' ? lx - w / 2 : lx;
        return { t: e.textContent, x0, x1: x0 + w, y0: ly - fs, y1: ly + fs * 0.3 };
      });
      const be = svg.querySelector('line.breakeven');
      if (be) {
        const by = Number(be.getAttribute('y1'));
        for (const A of boxes) expect(A.y0 < by && A.y1 > by, `labX ${labX}: "${A.t}" crosses the break-even line`).toBe(false);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]; const Bx = boxes[j];
        const hit = A.x0 < Bx.x1 && A.x1 > Bx.x0 && A.y0 < Bx.y1 && A.y1 > Bx.y0;
        expect(hit, `labX ${labX}: "${A.t}" overlaps "${Bx.t}"`).toBe(false);
      }
    }
  });

  it('moves the break-even label off a calibration point that sits under its default position', () => {
    // 02-computed's real calibration: the x=10 point (1.73x) sits just above the break-even line,
    // right where the left-anchored label used to go. Box estimate matches chart.js (0.6 em/char).
    const cal = [{ x: 10, ratio: 1.73 }, { x: 100, ratio: 7.16 }, { x: 1000, ratio: 32.53 }, { x: 5000, ratio: 203.24 }];
    const svg = curveChart({ calibration: cal, labX: 1000, xLabel: 'x', live: { redo: 32.8 } });
    const be = [...svg.querySelectorAll('text')].find((el) => el.textContent.startsWith('break-even'));
    const fs = Number(be.getAttribute('font-size')); const w = 0.6 * fs * be.textContent.length;
    const bx = Number(be.getAttribute('x')); const by = Number(be.getAttribute('y'));
    const anchor = be.getAttribute('text-anchor');
    const x0 = anchor === 'end' ? bx - w : anchor === 'middle' ? bx - w / 2 : bx;
    const box = { x0, x1: x0 + w, y0: by - fs, y1: by + fs * 0.3 };
    const pt = svg.querySelector('circle.calpt'); // first = x=10
    const cx = Number(pt.getAttribute('cx')); const cy = Number(pt.getAttribute('cy')); const r = Number(pt.getAttribute('r'));
    // Distance from the point's edge to the label box.
    const dx = Math.max(box.x0 - cx, 0, cx - box.x1); const dy = Math.max(box.y0 - cy, 0, cy - box.y1);
    expect(Math.hypot(dx, dy) - r).toBeGreaterThanOrEqual(8);
  });
});

