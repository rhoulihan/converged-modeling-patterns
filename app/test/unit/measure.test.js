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
});
