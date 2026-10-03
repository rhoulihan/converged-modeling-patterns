// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const P = { id: '01-extended-reference', meta: { deck: '14–17', measure: { xLabel: 'documents embedding the moved advisor', labX: 2, deckSlides: '14–17', sizes: [1, 10, 100] } } };
const side = (redo, kind = 'dml') => ({ sql: 'x', stats: { 'redo size': redo, 'db block changes': 3 },
  result: kind === 'error' ? { kind, code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } : { kind, rowsAffected: 1, elapsedMs: 2 } });
const pt = (x, d, c, kind) => ({ x, document: side(d, kind), converged: side(c), ratio: kind === 'error' ? null : d / c });
const sweep = (points, extra = {}) => ({ tag: 't', sizes: [1, 10, 100], error: null, restored: true, points, ...extra });

describe('renderMeasure (sweep)', () => {
  it('states the trend in words, plots one point per size and lists every size in a table', () => {
    const el = renderMeasure(sweep([pt(1, 1750, 500), pt(10, 15300, 500), pt(100, 151900, 500)]), { pattern: P });
    expect(el.querySelector('.measure-headline').textContent)
      .toBe('Your runs: at the smallest size (1) the document model wrote 3.5× the redo of the converged model; at the largest (100), 304×. The bigger the size, the bigger the gap.');
    expect(el.querySelectorAll('svg.curve circle.runpt').length).toBe(3);
    const rows = [...el.querySelectorAll('.sweep-table tbody tr')].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([['1', '1,750', '500', '3.5×'], ['10', '15,300', '500', '31×'], ['100', '151,900', '500', '304×']]);
    expect(el.querySelector('.what-happened').textContent).toContain('3 sizes');
    expect(el.querySelector('.deck-thumb img').getAttribute('src')).toBe('/figures/01-extended-reference/model-curve.svg');
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('a failed size shows its error, is left off the chart, and shows — in the table', () => {
    const el = renderMeasure(sweep([pt(1, 1750, 500), pt(10, 15300, 500), pt(100, 9, 500, 'error')]), { pattern: P });
    expect(el.querySelector('.result.error').textContent).toContain('size 100, document model');
    expect(el.querySelectorAll('svg.curve circle.runpt').length).toBe(2);
    expect(el.querySelector('.sweep-table tbody tr:last-child td:last-child').textContent).toBe('—');
    expect(el.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('a sweep-level error or a failed rebuild is reported; fewer than 2 good sizes draws no chart', () => {
    const el = renderMeasure(sweep([pt(1, 1750, 500)], { error: { code: 'LAB-CANCELLED', error: 'Measurement was cancelled' }, restored: false }), { pattern: P });
    const errs = [...el.querySelectorAll('.result.error')].map((e) => e.textContent).join(' | ');
    expect(errs).toContain('LAB-CANCELLED');
    expect(errs).toContain('could not be rebuilt');
    expect(el.querySelector('svg.curve')).toBeNull();
    expect(el.querySelector('.measure-headline')).toBeNull();
  });
});

describe('renderMeasure (read side)', () => {
  const lioSide = (lio, kind = 'dml') => ({ sql: 'x', stats: { 'redo size': lio * 100, 'session logical reads': lio }, rows: 1, result: { kind, rowsAffected: 1, elapsedMs: 1 } });
  const rp = (x, dw, cw, dr, cr) => ({ x, document: lioSide(dw), converged: lioSide(cw), ratio: dw / cw,
    reads: { document: lioSide(dr, 'rows'), converged: lioSide(cr, 'rows') } });
  it('renders both read charts, the blocks table and the note on reading block counts', () => {
    const P2 = { ...P, meta: { ...P.meta, measure: { ...P.meta.measure, workload: { readsPerWrite: 2000, label: 'test mix' } } } };
    const el = renderMeasure(sweep([rp(1, 20, 3, 3, 4), rp(10, 112, 4, 3, 4), rp(100, 1031, 3, 3, 4)]), { pattern: P2 });
    expect(el.querySelectorAll('.read-side svg.curve').length).toBe(2);
    expect(el.querySelectorAll('.blocks-table tbody tr').length).toBe(3);
    expect(el.querySelector('.read-note').textContent).toContain('not the number of references');
    expect(el.textContent).toContain('the document model wins at every size measured');
  });
});
