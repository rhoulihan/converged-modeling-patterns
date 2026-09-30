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
    const svg = curveChart({ calibration: CAL, labX: 5000, xLabel: 'x', live: { redo: 260, blocks: null } });
    const label = [...svg.querySelectorAll('text')].find((el) => el.textContent.startsWith('you'));
    expect(label.getAttribute('text-anchor')).toBe('end');
  });
});
