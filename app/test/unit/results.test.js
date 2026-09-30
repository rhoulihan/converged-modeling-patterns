// app/test/unit/results.test.js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderResult, renderRun } from '../../public/js/results.js';

describe('renderResult', () => {
  it('renders rows as a table with escaped values', () => {
    const el = renderResult({ kind: 'rows', columns: ['NAME'], rows: [{ NAME: '<img src=x onerror=alert(1)>' }], rowCount: 1, truncated: false, elapsedMs: 3 });
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('td').textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('renders JSON-valued cells and documents as a collapsible tree', () => {
    const el = renderResult({ kind: 'docs', docs: [{ _id: 'C-001', advisor: { office: 'NYC-09' } }], count: 1, truncated: false, elapsedMs: 2 });
    expect(el.querySelectorAll('details').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('NYC-09');
  });
  it('renders DML, DDL, counts, collections and writes as messages', () => {
    expect(renderResult({ kind: 'dml', rowsAffected: 3, elapsedMs: 1 }).textContent).toContain('3 rows affected');
    expect(renderResult({ kind: 'ok', elapsedMs: 1 }).textContent).toContain('Statement executed');
    expect(renderResult({ kind: 'count', count: 7, elapsedMs: 1 }).textContent).toContain('7');
    expect(renderResult({ kind: 'collections', names: ['a', 'b'], elapsedMs: 1 }).textContent).toContain('a');
    expect(renderResult({ kind: 'write', result: { modifiedCount: 1 }, elapsedMs: 1 }).textContent).toContain('modifiedCount');
  });
  it('renders errors with their code', () => {
    const el = renderResult({ kind: 'error', code: 'ORA-00942', error: 'ORA-00942: table or view does not exist', elapsedMs: 1 });
    expect(el.classList.contains('error')).toBe(true);
    expect(el.textContent).toContain('ORA-00942');
  });
  it('flags truncation', () => {
    expect(renderResult({ kind: 'rows', columns: ['N'], rows: [{ N: 1 }], rowCount: 1, truncated: true, elapsedMs: 1 }).textContent)
      .toMatch(/truncated/i);
  });
  it('formats an ISO timestamp cell as YYYY-MM-DD HH:MM:SS', () => {
    const el = renderResult({ kind: 'rows', columns: ['HOUR_START'], rows: [{ HOUR_START: '2026-01-10T09:00:00.000Z' }], rowCount: 1, truncated: false, elapsedMs: 1 });
    expect(el.querySelector('td').textContent).toBe('2026-01-10 09:00:00');
  });
  it('keeps a non-zero fraction on a formatted timestamp cell', () => {
    const el = renderResult({ kind: 'rows', columns: ['CLAIM_TS'], rows: [{ CLAIM_TS: '2026-01-10T09:00:00.123Z' }], rowCount: 1, truncated: false, elapsedMs: 1 });
    expect(el.querySelector('td').textContent).toBe('2026-01-10 09:00:00.123');
  });
  it('leaves a non-timestamp string untouched', () => {
    const el = renderResult({ kind: 'rows', columns: ['NOTE'], rows: [{ NOTE: '2026-01-10 note' }], rowCount: 1, truncated: false, elapsedMs: 1 });
    expect(el.querySelector('td').textContent).toBe('2026-01-10 note');
  });
  it('formats a timestamp inside a docs tree the same way', () => {
    const el = renderResult({ kind: 'docs', docs: [{ _id: 'C-001', claim_ts: '2026-01-10T09:00:00.000Z' }], count: 1, truncated: false, elapsedMs: 1 });
    expect(el.textContent).toContain('2026-01-10 09:00:00');
    expect(el.textContent).not.toContain('2026-01-10T09:00:00.000Z');
  });
});

describe('renderRun', () => {
  it('shows the cache badge', () => {
    const el = renderRun({ lane: 'sql', cached: true, results: [{ kind: 'ok', elapsedMs: 0 }] });
    expect(el.textContent).toContain('served from cache');
  });
});
