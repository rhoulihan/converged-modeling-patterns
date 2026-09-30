// app/test/unit/measure.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMeasure } from '../../public/js/measure.js';

const side = (redo, blocks, rows) => ({
  sql: 'UPDATE x SET y = 1',
  stats: { 'redo size': redo, 'db block changes': blocks, 'session logical reads': 10, 'CPU used by this session': 0 },
  result: { kind: 'dml', rowsAffected: rows, elapsedMs: 4 },
});

describe('renderMeasure', () => {
  it('tabulates both sides and draws four bars', () => {
    const el = renderMeasure({ tag: 'advisor-move', document: side(12000, 40, 2), converged: side(600, 4, 1) });
    expect(el.querySelector('table').textContent).toContain('redo size');
    expect(el.textContent).toContain('12,000');
    expect(el.textContent).toContain('20.0×');
    expect(el.querySelectorAll('svg rect.bar')).toHaveLength(4);
  });
  it('shows an error side instead of numbers', () => {
    const el = renderMeasure({ tag: 't', document: { sql: 'x', stats: {}, result: { kind: 'error', code: 'ORA-00942', error: 'nope', elapsedMs: 0 } }, converged: side(1, 1, 1) });
    expect(el.textContent).toContain('ORA-00942');
  });
  const row = (el, name) => [...el.querySelectorAll('table tr')].find((tr) => tr.cells[0].textContent === name);
  const cells = (tr) => [...tr.cells].slice(1).map((td) => td.textContent);
  it('shows — for rows affected on a PL/SQL (kind ok) side, never NaN', () => {
    const ok = { ...side(4752, 21, 0), result: { kind: 'ok', elapsedMs: 5 } };
    const el = renderMeasure({ tag: 't', document: ok, converged: side(864, 6, 1) });
    expect(el.textContent).not.toContain('NaN');
    expect(cells(row(el, 'rows affected'))).toEqual(['—', '1', '—']);
    expect(cells(row(el, 'redo size'))).toEqual(['4,752', '864', '5.5×']);
  });
  it('shows — for every stat on an error side, never NaN or a false 0', () => {
    const err = { sql: 'x', stats: {}, result: { kind: 'error', code: 'LAB-MEASURE', error: 'nope', elapsedMs: 0 } };
    const el = renderMeasure({ tag: 't', document: err, converged: err });
    expect(el.textContent).not.toContain('NaN');
    expect(cells(row(el, 'redo size'))).toEqual(['—', '—', '—']);
    expect(cells(row(el, 'rows affected'))).toEqual(['—', '—', '—']);
  });
});
