// app/public/js/results.js
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
};

// node-oracledb DATE/TIMESTAMP values come back through res.json() as ISO-8601
// strings (e.g. "2026-01-10T09:00:00.000Z"), not Date objects. Reformat those
// for readability; anything that isn't a full ISO timestamp is left untouched.
const ISO_TS = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.(\d+))?Z$/;
function formatTimestamp(s) {
  const m = ISO_TS.exec(s);
  if (!m) return null;
  const [, date, time, , frac] = m;
  const keepFrac = frac && /[1-9]/.test(frac) ? `.${frac}` : '';
  return `${date} ${time}${keepFrac}`;
}

function tree(value, key) {
  if (value === null || typeof value !== 'object') {
    const row = h('div', 'jv');
    if (key !== undefined) row.append(h('span', 'jk', `${key}: `));
    const text = typeof value === 'string' ? (formatTimestamp(value) ?? JSON.stringify(value)) : JSON.stringify(value);
    row.append(h('span', `jval ${value === null ? 'jnull' : typeof value}`, text));
    return row;
  }
  const d = h('details', 'jt');
  d.open = true;
  const isArr = Array.isArray(value);
  const n = isArr ? value.length : Object.keys(value).length;
  d.append(h('summary', null, `${key !== undefined ? `${key}: ` : ''}${isArr ? `[ ${n} ]` : `{ ${n} }`}`));
  for (const [k, v] of Object.entries(value)) d.append(tree(v, isArr ? Number(k) : k));
  return d;
}

const meta = (r, extra = '') => h('div', 'rmeta', `${extra}${extra ? ' · ' : ''}${r.elapsedMs ?? 0} ms${r.truncated ? ' · truncated (500 rows / 1 MB limit)' : ''}`);

export function renderResult(r) {
  const box = h('div', `result ${r.kind}`);
  switch (r.kind) {
    case 'rows': {
      const t = h('table', 'grid');
      const tr = h('tr');
      r.columns.forEach((c) => tr.append(h('th', null, c)));
      const thead = h('thead');
      thead.append(tr);
      t.append(thead);
      const tb = h('tbody');
      for (const row of r.rows) {
        const x = h('tr');
        for (const c of r.columns) {
          const v = row[c];
          const td = h('td');
          if (v !== null && typeof v === 'object') td.append(tree(v));
          else if (v === null) td.textContent = 'NULL';
          else td.textContent = typeof v === 'string' ? (formatTimestamp(v) ?? v) : String(v);
          x.append(td);
        }
        tb.append(x);
      }
      t.append(tb);
      box.append(t, meta(r, `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}`));
      break;
    }
    case 'docs':
      r.docs.forEach((d) => box.append(tree(d)));
      box.append(meta(r, `${r.count} document${r.count === 1 ? '' : 's'}`));
      break;
    case 'dml': box.append(h('div', 'msg', `${r.rowsAffected} rows affected`), meta(r)); break;
    case 'ok': box.append(h('div', 'msg', 'Statement executed'), meta(r)); break;
    case 'count': box.append(h('div', 'msg', `count: ${r.count}`), meta(r)); break;
    case 'collections': box.append(h('div', 'msg', r.names.join('  ·  ') || '(no collections)'), meta(r)); break;
    case 'write': box.append(tree(r.result), meta(r)); break;
    case 'error': box.append(h('div', 'msg', r.error), meta(r, r.code ?? 'error')); box.classList.add('error'); break;
    default: box.append(h('div', 'msg', JSON.stringify(r)));
  }
  return box;
}

export function renderRun(run) {
  const wrap = h('div', 'run');
  if (run.cached) wrap.append(h('span', 'badge cool', 'served from cache'));
  run.results.forEach((r) => wrap.append(renderResult(r)));
  return wrap;
}
