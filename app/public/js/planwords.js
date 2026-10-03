// Executed plans in plain words for developers: each plan step becomes a sentence ("Looked up
// one key in the primary key of xr_clients"), in the order the database did them, with the
// blocks that step itself touched. Internal plan plumbing is hidden.
const lc = (s) => (s ? String(s).toLowerCase() : '');
const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

// Internal operations a developer does not need to see.
const HIDDEN = new Set(['STATISTICS COLLECTOR', 'CONNECT BY PUMP', 'MULTI VALUE', 'VIEW', 'FAST DUAL', 'SELECT STATEMENT', 'UPDATE STATEMENT',
  'INSERT STATEMENT', 'DELETE STATEMENT', 'MERGE STATEMENT']);

function indexName(st) {
  const table = lc(st.indexTable);
  if (/^SYS_C\d+/.test(st.object ?? '')) return `the primary key of ${table}`;
  return `index ${lc(st.object)}${table ? ` (on ${table})` : ''}`;
}

// One plan step in words. side: 'document' | 'converged' (documents vs rows); ctx.rowsAffected
// is the statement's row count for DML (the plan's DML step itself reports 0 rows).
export function phrase(st, side, ctx = {}) {
  const items = (n) => plural(n, side === 'document' ? 'document' : 'row', side === 'document' ? 'documents' : 'rows');
  const op = st.operation; const opt = st.options ?? ''; const table = lc(st.object);
  if (op === 'INDEX') {
    if (opt === 'UNIQUE SCAN') return { text: `Looked up one key in ${indexName(st)}` };
    if (opt.includes('MULTI VALUE')) return { text: `Looked up the matching paths in the multivalue ${indexName(st)}` };
    if (opt.startsWith('RANGE SCAN')) return { text: `Looked up the matching keys in ${indexName(st)}` };
    if (opt.includes('FULL')) return { text: `Read the whole ${indexName(st)}`, warn: 'reads every entry of the index' };
    return { text: `Used ${indexName(st)}` };
  }
  if (op === 'TABLE ACCESS') {
    if (opt === 'FULL') return { text: `Read every ${side === 'document' ? 'document' : 'row'} of ${table}`, warn: 'scans the whole table' };
    if (opt.startsWith('BY INDEX ROWID')) return { text: `Fetched the ${items(st.rows ?? 0)} it found from ${table}` };
    return { text: `Read ${table}` };
  }
  if (op === 'UPDATE') return { text: `Updated ${items(ctx.rowsAffected ?? 0)} in ${table}`, write: true };
  if (op === 'INSERT' || op.startsWith('LOAD TABLE')) return { text: `Inserted into ${table}`, write: true };
  if (op === 'SEQUENCE') return { text: 'Took the next number from a sequence (for the new row\'s id)' };
  if (op === 'UNION-ALL') return { text: 'Combined the rows from each part of the query' };
  if (op === 'DELETE') return { text: `Deleted from ${table}`, write: true };
  if (op === 'NESTED LOOPS') return { text: 'Joined them: for each one, looked up its match' };
  if (op === 'HASH JOIN') return { text: 'Joined the two sets using a hash table' };
  if (op === 'MERGE JOIN') return { text: 'Joined the two sorted sets' };
  if (op === 'SORT' && opt === 'ORDER BY') return { text: `Sorted the ${plural(st.rows ?? 0, 'result', 'results')}` };
  if (op === 'SORT' && opt === 'AGGREGATE') return { text: 'Combined the results into one value' };
  if ((op === 'SORT' || op === 'HASH') && opt === 'GROUP BY') return { text: 'Grouped the values back together' };
  if (op === 'HASH' && opt === 'UNIQUE') return { text: 'Removed duplicate matches' };
  if (op === 'CONNECT BY') return { text: 'Walked the hierarchy level by level, finding each item\'s children' };
  if (op === 'JSONTABLE EVALUATION') return { text: 'Unpacked a JSON array into rows' };
  if (op === 'COUNT' && opt === 'STOPKEY') return { text: 'Stopped as soon as it had the rows it needed' };
  if (op === 'WINDOW' && opt.includes('STOPKEY')) return { text: 'Kept only the first rows in order, then stopped' };
  if (op === 'FILTER') return { text: 'Filtered the rows' };
  return { text: lc(`${op} ${opt}`).trim() };
}

// The visible steps of a plan, in execution order (a step's inputs come before it), each with
// the blocks it touched itself (its total minus its children's) and its share of the statement.
export function planSteps(plan, side, ctx = {}) {
  if (!plan?.length) return [];
  const kids = new Map(); for (const st of plan) if (st.parentId !== null) kids.set(st.parentId, [...(kids.get(st.parentId) ?? []), st]);
  const total = plan[0].blocks || 1;
  const self = (st) => Math.max(0, st.blocks - (kids.get(st.id) ?? []).reduce((a, c) => a + c.blocks, 0));
  const unusedBranch = (st) => st.operation === 'TABLE ACCESS' && st.options === 'FULL' && !st.rows && !st.blocks;
  const out = [];
  const visit = (st) => {
    for (const c of kids.get(st.id) ?? []) visit(c);
    if (HIDDEN.has(st.operation) || HIDDEN.has(`${st.operation} ${st.options ?? ''}`.trim()) || unusedBranch(st)) return;
    // An adaptive plan's alternative join, whose other input never ran: the database used the
    // nested loop instead, so this join is not something it did.
    if (/JOIN/.test(st.operation) && (kids.get(st.id) ?? []).some(unusedBranch)) return;
    const p = phrase(st, side, ctx);
    out.push({ ...p, id: st.id, rows: st.rows, blocks: self(st), share: self(st) / total });
  };
  visit(plan[0]);
  return out;
}

// A short signature of a plan's approach (operations and objects, no numbers), to spot where a
// statement's plan changes between sizes.
export const planShape = (plan, side) => planSteps(plan, side, { rowsAffected: 0 }).map((s) => s.text.replace(/[\d,]+ (documents?|rows?|results?)/g, 'N')).join(' | ');

// Where the database changed its approach across the sizes, in words, or null.
export function planChange(points, pick, side) {
  const shapes = points.map((q) => ({ x: q.x, shape: pick(q)?.plan ? planShape(pick(q).plan, side) : null })).filter((s) => s.shape);
  for (let i = 1; i < shapes.length; i++) {
    if (shapes[i].shape !== shapes[i - 1].shape) {
      const was = shapes[i - 1].shape.split(' | ')[0]; const now = shapes[i].shape.split(' | ')[0];
      return { at: shapes[i].x, before: shapes[i - 1].x, was, now };
    }
  }
  return null;
}

// One line on why the document and converged numbers differ, from the blocks and the plans.
export function whyDiffers(kind, doc, conv) {
  const lio = (s) => s?.stats?.['session logical reads'] ?? 0;
  const kb = (s) => { const b = s?.stats?.['redo size'] ?? 0; return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`; };
  if (kind === 'write') {
    const n = (s) => (s?.result?.rowsAffected ?? null);
    const dn = n(doc); const cn = n(conv);
    const what = (k, side) => (k === null ? 'ran its block of statements' : side === 'document' ? `rewrote ${plural(k, 'document', 'documents')}` : `changed ${plural(k, 'row', 'rows')}`);
    return `The document write ${what(dn, 'document')} and wrote ${kb(doc)} to the log; the converged write ${what(cn, 'converged')} and wrote ${kb(conv)}.`;
  }
  const d = lio(doc); const c = lio(conv);
  const tables = (plan) => new Set((plan ?? []).filter((s) => s.operation === 'TABLE ACCESS' && (s.rows || s.blocks)).map((s) => s.object)).size;
  const scans = (doc?.plan ?? []).some((s) => s.operation === 'TABLE ACCESS' && s.options === 'FULL' && s.blocks > 0);
  const ct = tables(conv?.plan); const dt = tables(doc?.plan);
  if (c > d) return `The converged read touched ${(c - d).toLocaleString('en-US')} more ${c - d === 1 ? 'block' : 'blocks'}${ct > dt ? `: it reads ${ct} tables to put together what the document stores in one place` : ''}.`;
  if (d > c) return `The document read touched ${(d - c).toLocaleString('en-US')} more ${d - c === 1 ? 'block' : 'blocks'}${scans ? ': it scanned a whole table' : ': the document holds more than this read needs'}.`;
  return 'Both reads touched the same number of blocks.';
}
