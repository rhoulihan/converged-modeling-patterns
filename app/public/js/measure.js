// app/public/js/measure.js
const SVGNS = 'http://www.w3.org/2000/svg';
const STATS = ['redo size', 'db block changes', 'session logical reads', 'CPU used by this session'];
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
const fmt = (n) => (num(n) === null ? '—' : n.toLocaleString('en-US'));
const ratio = (d, c) => (num(d) === null || !num(c) ? '—' : `${(d / c).toFixed(1)}×`);
const rowsAffected = (r) => (r.kind === 'dml' ? r.rowsAffected : null);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const s = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = String(text); return e; };

export function renderMeasure(m) {
  const box = h('div', 'measure-out');
  for (const [name, sd] of [['document model', m.document], ['converged', m.converged]]) {
    if (sd.result.kind === 'error') box.append(h('div', 'result error', `${name}: ${sd.result.code ?? ''} ${sd.result.error}`));
  }
  const t = h('table', 'measure-table');
  const head = h('tr');
  ['', 'Document model', 'Converged', 'Ratio'].forEach((c) => head.append(h('th', null, c)));
  t.append(head);
  const rows = [...STATS.map((n) => [n, m.document.stats[n], m.converged.stats[n]]),
    ['rows affected', rowsAffected(m.document.result), rowsAffected(m.converged.result)],
    ['elapsed ms', m.document.result.elapsedMs, m.converged.result.elapsedMs]];
  for (const [n, d, c] of rows) {
    const tr = h('tr');
    tr.append(h('td', null, n), h('td', 'hot', fmt(d)), h('td', 'cool', fmt(c)), h('td', null, ratio(d, c)));
    t.append(tr);
  }
  box.append(t);

  const W = 560; const H = 150; const x0 = 150; const maxW = W - x0 - 90;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'redo size and block changes, document model vs converged' });
  ['redo size', 'db block changes'].forEach((stat, gi) => {
    const d = m.document.stats[stat]; const c = m.converged.stats[stat];
    const max = Math.max(num(d) ?? 0, num(c) ?? 0, 1);
    const y = 20 + gi * 62;
    svg.append(s('text', { x: 16, y: y + 22, 'font-size': 12, fill: 'var(--muted)' }, stat));
    [[d, 'var(--hot)', 0], [c, 'var(--cool)', 24]].forEach(([v, color, dy]) => {
      const w = Math.max(2, Math.round(((num(v) ?? 0) / max) * maxW));
      svg.append(s('rect', { class: 'bar', x: x0, y: y + dy, width: w, height: 18, rx: 3, fill: color }));
      svg.append(s('text', { x: x0 + w + 8, y: y + dy + 13, 'font-size': 11.5, fill: 'var(--ink)' }, fmt(v)));
    });
  });
  box.append(svg);
  return box;
}
