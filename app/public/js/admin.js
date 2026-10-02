// app/public/js/admin.js
import { landing } from './brand.js';
import { getJSON, postJSON } from './api.js';

const view = document.getElementById('view');
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const btn = (label, onClick, cls = 'btn') => { const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
let timer;
// Alert the server's error on a non-200 response; returns true on success.
const ok = (r) => {
  if (r.status >= 200 && r.status < 300) return true;
  alert(r.body?.error ?? `Request failed (${r.status})`);
  return false;
};

function login(msg = '') {
  const f = h('form', 'signin');
  const l = h('label', null, 'Admin password'); const i = h('input'); i.type = 'password'; i.name = 'password'; l.append(i);
  const s = h('button', 'btn primary', 'Sign in'); s.type = 'submit';
  f.append(h('h2', null, 'Instructor sign-in'), h('p', 'problem', 'Run the event from here: the queue, attendee workspaces and the deck.'), l, s, h('div', 'flash', msg));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await postJSON('/api/admin/login', { password: i.value });
    if (r.status === 200) render(); else login(r.body?.error ?? 'sign-in failed');
  });
  view.replaceChildren(landing(f, {
    title: 'Converged Data Modeling Lab',
    lede: 'Instructor console',
    note: 'Present the deck, pause the room while you talk, pre-warm workspaces and reset an attendee who gets stuck.',
  }));
}

// The instructor deck, served by this lab host at /deck/ behind the same sign-in as this page.
function deckCard() {
  const c = h('div', 'card');
  const a = h('a', 'btn primary', 'Open the instructor deck');
  a.href = '/deck/'; a.target = '_blank'; a.rel = 'noopener';
  const row = h('div', 'actions'); row.append(a);
  c.append(h('h3', null, 'Presentation'), h('p', 'note', 'Workshop 1: Model the domain, not the engine. Opens in a new tab; press N for the speaker notes, arrow keys to move.'), row);
  return c;
}

async function render() {
  clearTimeout(timer);
  let r;
  try {
    r = await getJSON('/api/admin/status');
  } catch {
    r = { status: 0, body: null };
  }
  if (r.status === 401) return login();
  if (r.status === 404) { view.replaceChildren(h('p', 'problem', 'The admin page is only available in event mode (LAB_MODE=event).')); return; }
  if (r.status !== 200 || !r.body?.gate) {
    // One failed poll (a restart, a busy database) must not stop the page: say so, retry.
    const note = h('p', 'flash', `Status unavailable (${r.status ? `HTTP ${r.status}` : 'no response'}), retrying…`);
    const old = view.querySelector('p.flash.stale');
    if (old) old.replaceWith(note); else view.prepend(note);
    note.classList.add('stale');
    timer = setTimeout(render, 2000);
    return;
  }
  const { gate, cache, attendees, resets, pending } = r.body;
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
    btn(`Cache: ${cache.enabled ? 'on' : 'off'} (${cache.size})`, async () => { ok(await postJSON('/api/admin/cache', { enabled: !cache.enabled })); render(); }),
    n, btn('Pre-warm workspaces', async () => { ok(await postJSON('/api/admin/prewarm', { count: Number(n.value) })); render(); }),
    btn(`Timeouts: ${r.body.timeouts.sqlMs / 1000}s`, async () => {
      const raw = prompt('Statement timeout in seconds (1–60)', String(r.body.timeouts.sqlMs / 1000));
      if (raw === null || !/^\s*\d+\s*$/.test(raw)) return;
      const v = Number(raw);
      if (v < 1 || v > 60) return;
      ok(await postJSON('/api/admin/timeouts', { sqlMs: v * 1000, mongoMs: v * 1000 })); render();
    }),
    btn('Reset every attendee', async () => {
      if (!confirm('Rebuild every pattern in every workspace? This queues behind attendee work.')) return;
      ok(await postJSON('/api/admin/reset-attendee', { schema: '*' })); render();
    }),
    btn('End event (drop all workspaces)', async () => {
      if (prompt('Type END to drop every attendee workspace') !== 'END') return;
      const x = await postJSON('/api/admin/end-event', {});
      if (ok(x)) {
        const d = x.body?.dropped ?? 0, p = x.body?.pending ?? 0;
        alert(p ? `Event ended: ${p} workspaces locked and queued for removal (pending falls to 0 within a few minutes)` : `Event ended: no workspaces to remove`);
      }
      render();
    }),
  );
  top.append(controls);
  if (resets && (resets.running || resets.total)) {
    const line = resets.running
      ? `Resetting every attendee: ${resets.done} of ${resets.total} done`
      : `Last reset of every attendee: ${resets.done} of ${resets.total} done`;
    top.append(h('p', 'rmeta', `${line} · ${resets.failed.length} failed`));
    resets.failed.forEach((f) => top.append(h('p', 'problem', `${f.schema}: ${f.error}`)));
  }
  if (pending) top.append(h('p', 'rmeta', `${pending} ended workspace(s) still being dropped (locked; removed automatically)`));
  const t = h('table', 'grid');
  const head = h('tr'); ['Schema', 'Name', 'Email', 'Built patterns', ''].forEach((c) => head.append(h('th', null, c)));
  t.append(head);
  attendees.forEach((a) => {
    const tr = h('tr');
    const td = h('td'); td.append(btn('Reset all patterns', async () => { ok(await postJSON('/api/admin/reset-attendee', { schema: a.schema })); render(); }));
    tr.append(h('td', null, a.schema), h('td', null, a.name ?? '(prewarmed)'), h('td', null, a.email ?? ''), h('td', null, a.built.length), td);
    t.append(tr);
  });
  const list = h('div', 'card'); list.append(h('h3', null, `Attendees (${attendees.length})`), t);
  const hero = h('section', 'hero');
  hero.append(h('h1', null, 'Instructor console'), h('p', 'problem', 'Present the deck, watch the queue and look after attendee workspaces.'));
  view.replaceChildren(hero, deckCard(), top, list);
  timer = setTimeout(render, 2000);
}

render();
