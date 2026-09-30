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
  it('draws the calibration line, points, break-even line and a live marker', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'CDR items', live: { redo: 32.8, blocks: 1.9 } });
    expect(svg.querySelector('path.cal')).not.toBeNull();
    expect(svg.querySelectorAll('circle.calpt').length).toBe(4);
    expect(svg.querySelector('line.breakeven')).not.toBeNull();
    expect(svg.querySelector('circle.live-redo')).not.toBeNull();
    expect(svg.querySelector('circle.live-blocks')).not.toBeNull();
    expect(svg.textContent).toContain('you · 32.8× redo');
  });
  it('no marker when the live ratio is not finite', () => {
    const svg = curveChart({ calibration: CAL, labX: 1000, xLabel: 'x', live: { redo: Infinity, blocks: null } });
    expect(svg.querySelector('circle.live-redo')).toBeNull();
    expect(svg.querySelector('circle.live-blocks')).toBeNull();
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('offsets the live markers apart when they would otherwise coincide with a calibration point', () => {
    // labX is the first calibration x, and both live ratios equal that point's reference ratio —
    // both the "near-equal to each other" and "on top of a calibration point" triggers fire.
    const svg = curveChart({ calibration: CAL, labX: 10, xLabel: 'x', live: { redo: 1.2, blocks: 1.2 } });
    const dot = svg.querySelector('circle.live-redo');
    const ring = svg.querySelector('circle.live-blocks');
    expect(dot.getAttribute('cx')).not.toBe(ring.getAttribute('cx'));
  });
  it('anchors the live label at the end when labX sits at the maximum calibration x', () => {
    // Live ratio kept off the 5000 calibration point: that point is now a label obstacle, and a
    // label sitting on it would (correctly) move above instead of anchoring at the end.
    const svg = curveChart({ calibration: CAL, labX: 5000, xLabel: 'x', live: { redo: 120, blocks: null } });
    const label = [...svg.querySelectorAll('text')].find((el) => el.textContent.startsWith('you'));
    expect(label.getAttribute('text-anchor')).toBe('end');
    expect(Number(label.getAttribute('x'))).toBeLessThanOrEqual(540);
  });

  it('moves the break-even label off a calibration point that sits under its default position', () => {
    // 02-computed's real calibration: the x=10 point (1.73x) sits just above the break-even line,
    // right where the left-anchored label used to go. Box estimate matches chart.js (0.6 em/char).
    const cal = [{ x: 10, ratio: 1.73 }, { x: 100, ratio: 7.16 }, { x: 1000, ratio: 32.53 }, { x: 5000, ratio: 203.24 }];
    const svg = curveChart({ calibration: cal, labX: 1000, xLabel: 'x', live: { redo: 32.8, blocks: 2 } });
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

