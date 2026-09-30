// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const P = { id: '02-computed', meta: { deck: '18–21', measure: { xLabel: 'CDR items', labX: 1000, deckSlides: '18–21',
  calibration: [{ x: 10, ratio: 1.2 }, { x: 100, ratio: 5 }, { x: 1000, ratio: 33 }, { x: 5000, ratio: 260 }] } } };
const side = (redo, blocks, kind = 'dml') => ({ sql: 'x', stats: { 'redo size': redo, 'db block changes': blocks, 'session logical reads': 10, 'CPU used by this session': 0 },
  result: kind === 'dml' ? { kind, rowsAffected: 1, elapsedMs: 2 } : { kind, elapsedMs: 2 } });
// `.stat-name` also carries an ⓘ button once one is appended, so its textContent is the name plus
// "ⓘ" — match on the prefix rather than equality.
const statRow = (el, name) => [...el.querySelectorAll('.stat')].find((r) => r.querySelector('.stat-name').textContent.startsWith(name));

describe('renderMeasure', () => {
  it('renders the curve with a live marker, per-row scaled bars with ratios, and explainers', () => {
    const el = renderMeasure({ tag: 't', document: side(52160, 21), converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('svg.curve circle.live-redo')).not.toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
    expect(el.textContent).toContain('32.8×');
    expect(el.querySelector('.what-happened')).not.toBeNull();
    expect(el.querySelector('.deck-thumb img').getAttribute('src')).toBe('/figures/02-computed/model-curve.svg');
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('scales each stat row to its own max, not a scale shared across rows', () => {
    // A 33x gap (52160 vs 1592) must read as a 33x gap, not the ~1.5x a shared log scale draws.
    const el = renderMeasure({ tag: 't', document: side(52160, 21), converged: side(1592, 11) }, { pattern: P });
    const row = statRow(el, 'redo size');
    const coolBar = row.querySelector('.stat-bar.cool');
    expect(parseFloat(coolBar.style.width)).toBeLessThan(5);
  });

  it('an error side shows the error, no live marker and — for every ratio, even with stats on the error side', () => {
    // The error side still carries stats (the failed statement did some work before it failed),
    // so a ratio could be computed — it must not be: it would compare a partial write to a full one.
    const err = { ...side(52160, 21), result: { kind: 'error', code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } };
    const el = renderMeasure({ tag: 't', document: err, converged: side(1592, 11) }, { pattern: P });
    expect(el.querySelector('.result.error').textContent).toContain('LAB-MEASURE');
    expect(el.querySelector('svg.curve')).not.toBeNull();
    expect(el.querySelector('circle.live-redo')).toBeNull();
    const ratios = [...el.querySelectorAll('.stat-ratio')].map((r) => r.textContent);
    expect(ratios).toEqual(['—', '—', '—', '—']);
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows — for every stat ratio when both sides error', () => {
    const err = { sql: 'x', stats: {}, result: { kind: 'error', code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } };
    const el = renderMeasure({ tag: 't', document: err, converged: err }, { pattern: P });
    const ratios = [...el.querySelectorAll('.stat-ratio')].map((r) => r.textContent);
    expect(ratios).toEqual(['—', '—', '—', '—']);
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows exact stat values and the ratio for a specific run', () => {
    const el = renderMeasure({ tag: 't', document: side(4752, 21, 'ok'), converged: side(864, 6) }, { pattern: P });
    const row = statRow(el, 'redo size');
    const vals = [...row.querySelectorAll('.stat-val')].map((v) => v.textContent);
    expect(vals).toEqual(['4,752', '864']);
    expect(row.querySelector('.stat-ratio').textContent).toBe('5.5×');
  });

  it('a PL/SQL (kind ok) side shows — for rows affected', () => {
    const el = renderMeasure({ tag: 't', document: side(4752, 21, 'ok'), converged: side(864, 6) }, { pattern: P });
    expect(el.querySelector('.rows-affected').textContent).toContain('rows affected — vs 1');
  });

  it('a pattern without calibration still renders the bars and collapses to one column', () => {
    const el = renderMeasure({ tag: 't', document: side(3060, 17), converged: side(500, 3) }, { pattern: { id: 'x', meta: { deck: '1', measure: null } } });
    expect(el.querySelector('svg.curve')).toBeNull();
    expect(el.querySelector('.stat-bars')).not.toBeNull();
    expect(el.querySelector('.measure-grid').classList.contains('no-curve')).toBe(true);
  });
});
