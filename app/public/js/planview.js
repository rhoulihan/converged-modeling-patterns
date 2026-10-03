// Measure it, "Plans & stats" tab: what the database did for each measured statement at each
// size, in plain steps (planwords.js), with the raw plan and statistics one click away.
import { planSteps, planChange, whyDiffers } from './planwords.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—');
const isPlsql = (sql) => /^\s*(BEGIN|DECLARE)\b/i.test(sql ?? '');

const STATEMENTS = [
  { key: 'docWrite', title: 'Document write', side: 'document', kind: 'write', pick: (q) => q.document },
  { key: 'convWrite', title: 'Converged write', side: 'converged', kind: 'write', pick: (q) => q.converged },
  { key: 'docRead', title: 'Document read', side: 'document', kind: 'read', pick: (q) => q.reads?.document },
  { key: 'convRead', title: 'Converged read', side: 'converged', kind: 'read', pick: (q) => q.reads?.converged },
];

function rawDetails(s) {
  const d = h('details', 'raw');
  d.append(h('summary', null, 'Show the raw plan and statistics'));
  if (s.plan?.length) {
    const t = h('table', 'raw-table');
    const hr = h('tr'); for (const c of ['id', 'operation', 'object', 'estimated rows', 'actual rows', 'blocks (incl. inner steps)']) hr.append(h('th', null, c));
    t.append(hr);
    for (const st of s.plan) {
      const tr = h('tr');
      const op = h('td', 'op'); op.style.paddingLeft = `${6 + st.depth * 14}px`; op.textContent = `${st.operation} ${st.options ?? ''}`.trim();
      tr.append(h('td', null, st.id), op, h('td', null, st.object ?? ''), h('td', 'num', num(st.estRows)), h('td', 'num', num(st.rows)), h('td', 'num', num(st.blocks)));
      t.append(tr);
    }
    d.append(t);
  }
  const st = h('table', 'raw-table');
  const sh = h('tr'); sh.append(h('th', null, 'session statistic'), h('th', 'num', 'value')); st.append(sh);
  for (const [k, v] of Object.entries(s.stats ?? {}).sort()) { const tr = h('tr'); tr.append(h('td', null, k), h('td', 'num', num(v))); st.append(tr); }
  d.append(st);
  return d;
}

function statementCard(def, s) {
  const card = h('div', `plan-card ${def.side}`);
  card.append(h('h5', null, def.title));
  if (!s || s.result?.kind === 'error') { card.append(h('p', 'rmeta', s?.result?.error ?? 'not measured')); return card; }
  const lio = s.stats?.['session logical reads'];
  if (isPlsql(s.sql) || !s.plan?.length) {
    card.append(h('p', 'rmeta', isPlsql(s.sql)
      ? 'This write is a block of several statements (PL/SQL), so there is no single plan to show; its totals are below.'
      : 'No plan was captured for this statement.'));
  } else {
    const steps = planSteps(s.plan, def.side, { rowsAffected: s.result?.rowsAffected });
    const ol = h('ol', 'plan-steps');
    for (const st of steps) {
      const li = h('li', st.warn ? 'warn' : null);
      const line = h('div', 'step-line');
      line.append(h('span', 'step-text', st.text));
      const meta = [st.rows !== null && st.rows !== undefined && !st.write ? `${num(st.rows)} ${st.rows === 1 ? 'row' : 'rows'} out` : null,
        `${num(st.blocks)} ${st.blocks === 1 ? 'block' : 'blocks'}`].filter(Boolean).join(' · ');
      line.append(h('span', 'step-meta', meta));
      li.append(line);
      const bar = h('div', 'step-bar'); const fill = h('span'); fill.style.width = `${Math.max(st.blocks ? 2 : 0, Math.round(st.share * 100))}%`; bar.append(fill);
      li.append(bar);
      if (st.warn) li.append(h('div', 'step-warn', `⚠ ${st.warn}`));
      ol.append(li);
    }
    card.append(ol);
  }
  const total = h('p', 'plan-total');
  const redo = s.stats?.['redo size'];
  total.append(h('strong', null, `Total: ${num(lio)} blocks touched`),
    def.kind === 'write' && redo ? ` · ${redo >= 1048576 ? `${(redo / 1048576).toFixed(1)} MB` : `${(redo / 1024).toFixed(1)} KB`} written to the log` : '',
    def.kind === 'read' && s.rows !== undefined ? ` · ${num(s.rows)} ${s.rows === 1 ? 'row' : 'rows'} returned` : '');
  card.append(total, rawDetails(s));
  return card;
}

export function renderPlans(sw, { pattern } = {}) {
  const meas = pattern?.meta?.measure;
  const box = h('div', 'plans');
  const pts = sw.points.filter((q) => q.document && q.converged);
  if (!pts.length) { box.append(h('p', 'rmeta', 'No measurements to show.')); return box; }
  box.append(h('p', 'plans-intro', 'What the database did for each measured statement, step by step, in the order it did them. Each step shows the blocks it touched itself; the bar is its share of the statement\'s total. Pick a size to see how the steps change.'));
  // Where the approach changes across sizes, per statement.
  const changes = STATEMENTS.map((d) => ({ d, c: planChange(pts, d.pick, d.side) })).filter((x) => x.c);
  for (const { d, c } of changes) {
    box.append(h('p', 'plan-change', `${d.title}: the database changed its approach at ${c.at.toLocaleString('en-US')} ${meas?.xLabel ?? ''}. At ${c.before.toLocaleString('en-US')} its first step was "${c.was}"; from ${c.at.toLocaleString('en-US')} it was "${c.now}".`));
  }
  const picker = h('div', 'size-picker'); picker.append(h('span', 'rmeta', `${meas?.xLabel ?? 'size'}:`));
  const body = h('div', 'plans-body');
  const show = (i) => {
    for (const [j, b] of [...picker.querySelectorAll('button')].entries()) b.classList.toggle('on', j === i);
    const q = pts[i];
    body.replaceChildren();
    for (const [kind, a, b] of [['write', STATEMENTS[0], STATEMENTS[1]], ['read', STATEMENTS[2], STATEMENTS[3]]]) {
      if (kind === 'read' && !q.reads) continue;
      const pair = h('div', 'plan-pair');
      pair.append(statementCard(a, a.pick(q)), statementCard(b, b.pick(q)));
      body.append(h('h4', 'plan-pair-title', kind === 'write' ? 'The write' : 'The read'), pair, h('p', 'plan-why', whyDiffers(kind, a.pick(q), b.pick(q))));
    }
  };
  pts.forEach((q, i) => { const b = h('button', 'btn', q.x.toLocaleString('en-US')); b.type = 'button'; b.addEventListener('click', () => show(i)); picker.append(b); });
  box.append(picker, body);
  show(pts.length - 1);   // the largest size first: where the differences are clearest
  return box;
}
