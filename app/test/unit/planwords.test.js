// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { phrase, planSteps, planChange, whyDiffers } from '../../public/js/planwords.js';
import { renderPlans } from '../../public/js/planview.js';

const st = (id, parentId, depth, operation, options, object, rows, blocks, extra = {}) =>
  ({ id, parentId, depth, operation, options, object, rows, blocks, estRows: rows, indexTable: null, ...extra });

// Real plans from the lab (pattern 1 at 1,000 copies, pattern 5 at 3,000 parts).
const P1_CONV_READ = [
  st(0, null, 0, 'SELECT STATEMENT', null, null, 1, 3),
  st(1, 0, 1, 'TABLE ACCESS', 'BY INDEX ROWID', 'XR_ADVISORS', 1, 2),
  st(2, 1, 2, 'INDEX', 'UNIQUE SCAN', 'SYS_C0019914', 1, 1, { indexTable: 'XR_ADVISORS' }),
  st(3, 0, 1, 'TABLE ACCESS', 'BY INDEX ROWID', 'XR_CLIENTS', 1, 3),
  st(4, 3, 2, 'INDEX', 'UNIQUE SCAN', 'SYS_C0019918', 1, 2, { indexTable: 'XR_CLIENTS' }),
];
const P1_DOC_WRITE = [
  st(0, null, 0, 'UPDATE STATEMENT', null, null, 0, 10266),
  st(1, 0, 1, 'UPDATE', null, 'XR_CLIENT_DOC', 0, 10266),
  st(2, 1, 2, 'TABLE ACCESS', 'BY INDEX ROWID BATCHED', 'XR_CLIENT_DOC', 1000, 40),
  st(3, 2, 3, 'INDEX', 'RANGE SCAN', 'XR_IX_DOC_ADVISOR', 1000, 5, { indexTable: 'XR_CLIENT_DOC' }),
];
const P5_ADAPTIVE = [
  st(0, null, 0, 'SELECT STATEMENT', null, null, 10, 20),
  st(1, 0, 1, 'HASH JOIN', null, null, 10, 20),
  st(2, 1, 2, 'STATISTICS COLLECTOR', null, null, 10, 0),
  st(3, 2, 3, 'CONNECT BY', 'PUMP', null, 10, 0),
  st(4, 1, 2, 'TABLE ACCESS', 'FULL', 'TR_BOM_EDGES', 0, 0),
  st(5, 1, 2, 'INDEX', 'RANGE SCAN (MULTI VALUE)', 'TR_IX_BOM_PATHS', 10, 20, { indexTable: 'TR_BOM_DOC' }),
];

describe('phrase', () => {
  it('names primary keys and indexes in plain words', () => {
    expect(phrase(P1_CONV_READ[2], 'converged').text).toBe('Looked up one key in the primary key of xr_advisors');
    expect(phrase(P1_DOC_WRITE[3], 'document').text).toBe('Looked up the matching keys in index xr_ix_doc_advisor (on xr_client_doc)');
    expect(phrase(P5_ADAPTIVE[5], 'document').text).toBe('Looked up the matching paths in the multivalue index tr_ix_bom_paths (on tr_bom_doc)');
  });
  it('documents on the document side, rows on the converged side; full scans are flagged', () => {
    expect(phrase(P1_DOC_WRITE[2], 'document').text).toBe('Fetched the 1,000 documents it found from xr_client_doc');
    expect(phrase(P1_DOC_WRITE[1], 'document', { rowsAffected: 1000 }).text).toBe('Updated 1,000 documents in xr_client_doc');
    const full = phrase(st(9, 0, 1, 'TABLE ACCESS', 'FULL', 'CP_SUBSCRIBER_DOC', 1, 7), 'document');
    expect(full).toEqual({ text: 'Read every document of cp_subscriber_doc', warn: 'scans the whole table' });
  });
});

describe('planSteps', () => {
  it('lists steps in execution order with the blocks each touched itself', () => {
    const steps = planSteps(P1_CONV_READ, 'converged');
    expect(steps.map((s) => s.text)).toEqual([
      'Looked up one key in the primary key of xr_advisors', 'Fetched the 1 row it found from xr_advisors',
      'Looked up one key in the primary key of xr_clients', 'Fetched the 1 row it found from xr_clients']);
    expect(steps.map((s) => s.blocks)).toEqual([1, 1, 2, 1]);
  });
  it('hides plan plumbing and an adaptive plan\'s unused branch', () => {
    const texts = planSteps(P5_ADAPTIVE, 'document').map((s) => s.text);
    expect(texts).toEqual(['Looked up the matching paths in the multivalue index tr_ix_bom_paths (on tr_bom_doc)']);   // the hash join's other input never ran
  });
});

describe('planChange and whyDiffers', () => {
  it('spots where a statement\'s approach changes between sizes', () => {
    const full = [st(0, null, 0, 'SELECT STATEMENT', null, null, 1, 7), st(1, 0, 1, 'TABLE ACCESS', 'FULL', 'X_DOC', 1, 7)];
    const idx = [st(0, null, 0, 'SELECT STATEMENT', null, null, 1, 3), st(1, 0, 1, 'TABLE ACCESS', 'BY INDEX ROWID', 'X_DOC', 1, 1),
      st(2, 1, 2, 'INDEX', 'RANGE SCAN', 'X_IX', 1, 2, { indexTable: 'X_DOC' })];
    const pts = [{ x: 1, r: { plan: full } }, { x: 10, r: { plan: idx } }, { x: 100, r: { plan: idx } }];
    const c = planChange(pts, (q) => q.r, 'document');
    expect(c).toEqual({ at: 10, before: 1, was: 'Read every document of x_doc', now: 'Looked up the matching keys in index x_ix (on x_doc)' });
  });
  it('explains a write and a read difference in one line', () => {
    const w = whyDiffers('write', { stats: { 'redo size': 1445568 }, result: { rowsAffected: 1000 } }, { stats: { 'redo size': 500 }, result: { rowsAffected: 1 } });
    expect(w).toBe('The document write rewrote 1,000 documents and wrote 1.4 MB to the log; the converged write changed 1 row and wrote 0.5 KB.');
    const r = whyDiffers('read', { stats: { 'session logical reads': 3 }, plan: [] }, { stats: { 'session logical reads': 5 }, plan: P1_CONV_READ.concat([st(5, 0, 1, 'NESTED LOOPS', null, null, 1, 3)]) });
    expect(r).toBe('The converged read touched 2 more blocks: it reads 2 tables to put together what the document stores in one place.');
  });
});

describe('renderPlans', () => {
  it('shows the largest size first, both pairs, a size picker and the raw toggle', () => {
    const side = (plan, redo, lio, rows) => ({ sql: 'SELECT 1 FROM dual', plan, rows, stats: { 'redo size': redo, 'session logical reads': lio }, result: { kind: 'dml', rowsAffected: rows } });
    const q = (x) => ({ x, document: side(P1_DOC_WRITE, 1445568, 10266, 1000), converged: side(P1_CONV_READ, 500, 4, 1),
      reads: { document: side(P1_CONV_READ, 0, 3, 1), converged: side(P1_CONV_READ, 0, 5, 1) } });
    const el = renderPlans({ points: [q(1), q(1000)] }, { pattern: { meta: { measure: { xLabel: 'copies' } } } });
    expect([...el.querySelectorAll('.size-picker button')].map((b) => b.textContent)).toEqual(['1', '1,000']);
    expect(el.querySelector('.size-picker button.on').textContent).toBe('1,000');
    expect(el.querySelectorAll('.plan-card').length).toBe(4);
    expect(el.querySelectorAll('details.raw').length).toBe(4);
    expect(el.textContent).toContain('Updated 1,000 documents in xr_client_doc');
    expect(el.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe('phrase: inserts and plumbing', () => {
  it('translates conventional loads, sequences and union-all', () => {
    expect(phrase(st(1, 0, 1, 'LOAD TABLE CONVENTIONAL', null, 'BK_SENSOR_READINGS', 0, 5), 'converged').text).toBe('Inserted into bk_sensor_readings');
    expect(phrase(st(2, 1, 2, 'SEQUENCE', null, 'ISEQ$$_1', 1, 1), 'converged').text).toBe("Took the next number from a sequence (for the new row's id)");
    expect(phrase(st(3, 1, 2, 'UNION-ALL', null, null, 3, 0), 'converged').text).toBe('Combined the rows from each part of the query');
  });
});
