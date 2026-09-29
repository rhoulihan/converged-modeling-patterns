// app/public/js/admin.js
import { getJSON, postJSON } from './api.js';

const view = document.getElementById('view');
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const btn = (label, onClick, cls = 'btn') => { const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
let timer;

function login(msg = '') {
  const f = h('form', 'signin');
  const l = h('label', null, 'Admin password'); const i = h('input'); i.type = 'password'; i.name = 'password'; l.append(i);
  const s = h('button', 'btn primary', 'Sign in'); s.type = 'submit';
  f.append(h('h2', null, 'Instructor sign-in'), l, s, h('div', 'flash', msg));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await postJSON('/api/admin/login', { password: i.value });
    if (r.status === 200) render(); else login(r.body?.error ?? 'sign-in failed');
  });
  view.replaceChildren(f);
}

async function render() {
  clearTimeout(timer);
  const r = await getJSON('/api/admin/status');
  if (r.status === 401) return login();
  if (r.status === 404) { view.replaceChildren(h('p', 'problem', 'The admin page is only available in event mode (LAB_MODE=event).')); return; }
  const { gate, cache, attendees } = r.body;
  const top = h('div', 'card');
  top.append(h('h3', null, `Queue: ${gate.queued.length} waiting · ${gate.running.length} running · ${gate.paused ? 'PAUSED' : 'live'}`));
  gate.running.forEach((x) => {
    const row = h('div', 'actions');
    row.append(h('span', 'rmeta', `${x.userId} · ${x.label} · ${Math.round(x.elapsedMs / 100) / 10}s`), btn('Cancel', async () => { await postJSON('/api/admin/cancel', { id: x.id }); render(); }));
    top.append(row);
  });
  const controls = h('div', 'actions');
  const n = h('input'); n.type = 'number'; n.min = 1; n.max = 200; n.value = 10; n.style.width = '70px';
  controls.append(
    btn(gate.paused ? 'Resume execution' : 'Pause execution', async () => { await postJSON('/api/admin/pause', { on: !gate.paused }); render(); }, 'btn primary'),
    btn(`Cache: ${cache.enabled ? 'on' : 'off'} (${cache.size})`, async () => { await postJSON('/api/admin/cache', { enabled: !cache.enabled }); render(); }),
    n, btn('Pre-warm workspaces', async () => { await postJSON('/api/admin/prewarm', { count: Number(n.value) }); render(); }),
    btn(`Timeouts: ${r.body.timeouts.sqlMs / 1000}s`, async () => {
      const v = Number(prompt('Statement timeout in seconds (1–60)', String(r.body.timeouts.sqlMs / 1000)));
      if (Number.isFinite(v)) { await postJSON('/api/admin/timeouts', { sqlMs: Math.round(v * 1000), mongoMs: Math.round(v * 1000) }); render(); }
    }),
    btn('Reset every attendee', async () => {
      if (!confirm('Rebuild every pattern in every workspace? This queues behind attendee work.')) return;
      await postJSON('/api/admin/reset-attendee', { schema: '*' }); render();
    }),
    btn('End event (drop all workspaces)', async () => {
      if (prompt('Type END to drop every attendee workspace') !== 'END') return;
      const x = await postJSON('/api/admin/end-event', {});
      const d = x.body?.dropped ?? 0, p = x.body?.pending ?? 0;
      alert(p ? `Dropped ${d} workspaces; ${p} still connected (locked, removed automatically within a few minutes)` : `Dropped ${d} workspaces`);
      render();
    }),
  );
  top.append(controls);
  const t = h('table', 'grid');
  const head = h('tr'); ['Schema', 'Name', 'Email', 'Built patterns', ''].forEach((c) => head.append(h('th', null, c)));
  t.append(head);
  attendees.forEach((a) => {
    const tr = h('tr');
    const td = h('td'); td.append(btn('Reset all patterns', async () => { await postJSON('/api/admin/reset-attendee', { schema: a.schema }); render(); }));
    tr.append(h('td', null, a.schema), h('td', null, a.name ?? '(prewarmed)'), h('td', null, a.email ?? ''), h('td', null, a.built.length), td);
    t.append(tr);
  });
  const list = h('div', 'card'); list.append(h('h3', null, `Attendees (${attendees.length})`), t);
  view.replaceChildren(top, list);
  timer = setTimeout(render, 2000);
}

render();
