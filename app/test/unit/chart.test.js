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
  const pts = (pairs) => pairs.map(([x, ratio]) => ({ x, ratio }));
  it('draws the attendee\'s curve: one labelled point per size, break-even and a legend', () => {
    const svg = curveChart({ points: pts([[10, 1.2], [100, 5], [1000, 32.8], [5000, 260]]), xLabel: 'CDR items' });
    expect(svg.querySelector('path.run')).not.toBeNull();
    expect(svg.querySelectorAll('circle.runpt').length).toBe(4);
    expect([...svg.querySelectorAll('text.pt-label')].map((e) => e.textContent)).toEqual(['1.2×', '5.0×', '33×', '260×']);
    expect(svg.querySelector('line.breakeven')).not.toBeNull();
    expect(svg.textContent).toContain('your runs: one per size, measured just now');
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('skips points whose ratio is not finite', () => {
    const svg = curveChart({ points: [{ x: 10, ratio: 2 }, { x: 100, ratio: Infinity }, { x: 1000, ratio: 20 }], xLabel: 'x' });
    expect(svg.querySelectorAll('circle.runpt').length).toBe(2);
    expect(svg.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('no label overlaps another label or crosses the break-even line, for every pattern\'s shape', () => {
    const shapes = [
      [[1, 3.5], [2, 6.1], [10, 30.6], [100, 304], [1000, 3036]],
      [[1, 2.8], [2, 4.0], [4, 6.1], [6, 8.3], [7, 9.4]],
      [[33, 3.8], [100, 8.8], [1000, 38.7], [3600, 165]],
      [[3, 1.6], [10, 2.0], [100, 6.1], [1000, 26.3]],
      [[3, 6.8], [30, 53.8], [300, 527], [3000, 5137]],
      [[10, 1.6], [100, 5.0], [800, 17], [2000, 43.4]],
    ];
    for (const shape of shapes) {
      const svg = curveChart({ points: pts(shape), xLabel: 'x' });
      const boxes = [...svg.querySelectorAll('text.pt-label')].map((e) => {
        const fs = Number(e.getAttribute('font-size')); const w = 0.6 * fs * e.textContent.length;
        const lx = Number(e.getAttribute('x')); const ly = Number(e.getAttribute('y')); const a = e.getAttribute('text-anchor');
        const x0 = a === 'end' ? lx - w : a === 'middle' ? lx - w / 2 : lx;
        return { t: e.textContent, x0, x1: x0 + w, y0: ly - fs, y1: ly + fs * 0.3 };
      });
      const be = svg.querySelector('line.breakeven');
      for (const A of boxes) if (be) expect(A.y0 < Number(be.getAttribute('y1')) && A.y1 > Number(be.getAttribute('y1')), `"${A.t}" crosses break-even`).toBe(false);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]; const Bx = boxes[j];
        expect(A.x0 < Bx.x1 && A.x1 > Bx.x0 && A.y0 < Bx.y1 && A.y1 > Bx.y0, `"${A.t}" overlaps "${Bx.t}"`).toBe(false);
      }
    }
  });
});
