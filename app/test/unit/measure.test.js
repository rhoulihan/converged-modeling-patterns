// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const P = { id: '02-computed', meta: { deck: '18–21', measure: { xLabel: 'CDR items', labX: 1000, deckSlides: '18–21',
  calibration: [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }] } } };
const side = (redo, blocks, kind = 'dml') => ({ sql: 'x', stats: { 'redo size': redo, 'db block changes': blocks, 'session logical reads': 10, 'CPU used by this session': 0 },
  result: kind === 'dml' ? { kind, rowsAffected: 1, elapsedMs: 2 } : { kind, elapsedMs: 2 } });

describe('renderMeasure', () => {
  it('renders the curve with a live marker, log bars with ratios, and explainers', () => {
    const el = renderMeasure({ tag: 't', document: side(52160, 21), converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('svg.curve circle.live-redo')).not.toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
    expect(el.textContent).toContain('32.8×');
    expect(el.querySelector('.what-happened')).not.toBeNull();
    expect(el.querySelector('.deck-thumb img').getAttribute('src')).toBe('/figures/02-computed/model-curve.svg');
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('an error side shows the error and no live marker', () => {
    const err = { sql: 'x', stats: {}, result: { kind: 'error', code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } };
    const el = renderMeasure({ tag: 't', document: err, converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('.result.error').textContent).toContain('LAB-MEASURE');
    expect(el.querySelector('circle.live-redo')).toBeNull();
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });
  it('a PL/SQL (kind ok) side shows — for rows affected', () => {
    const el = renderMeasure({ tag: 't', document: side(4752, 21, 'ok'), converged: side(864, 6) }, { pattern: P });
    expect(el.querySelector('.rows-affected').textContent).toContain('—');
  });
  it('a pattern without calibration still renders the bars', () => {
    const el = renderMeasure({ tag: 't', document: side(3060, 17), converged: side(500, 3) }, { pattern: { id: 'x', meta: { deck: '1', measure: null } } });
    expect(el.querySelector('svg.curve')).toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
  });
});
