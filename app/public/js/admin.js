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
// Event controls, built once: the page re-renders every few seconds, which would wipe a
// half-typed password. Only the code shown is refreshed.
let eventCardEl = null; let eventCodeEl = null;
function eventCard(code) {
  if (!eventCardEl) {
    const c = h('div', 'card');
    c.append(h('h3', null, 'Event'));
    const line = h('p', 'event-code-line'); eventCodeEl = h('code', 'event-code');
    line.append('Event code: ', eventCodeEl);
    const codeFlash = h('span', 'rmeta');
    const confirmRow = h('div', 'actions'); confirmRow.hidden = true;
    const ask = btn('New event code', () => { confirmRow.hidden = false; ask.hidden = true; });
    confirmRow.append(h('span', 'note', 'Attendees already signed in keep their sessions; anyone new needs the new code.'),
      btn('Generate it', async () => {
        const r = await postJSON('/api/admin/event-code', {});
        codeFlash.textContent = r.status === 200 ? `new code: ${r.body.code}` : (r.body?.error ?? `error ${r.status}`);
        if (r.status === 200) eventCodeEl.textContent = r.body.code;
        confirmRow.hidden = true; ask.hidden = false;
      }, 'btn primary'),
      btn('Cancel', () => { confirmRow.hidden = true; ask.hidden = false; }));
    const codeRow = h('div', 'actions'); codeRow.append(ask, codeFlash);
    // Change the instructor password: the current one is required.
    const f = h('form', 'pw-form');
    const field = (label, name) => { const l = h('label', null, label); const i = h('input'); i.type = 'password'; i.name = name; i.autocomplete = name === 'current' ? 'current-password' : 'new-password'; l.append(i); f.append(l); return i; };
    const cur = field('Current password', 'current'); const nxt = field('New password (12+ characters)', 'next'); const rep = field('New password again', 'repeat');
    const pwFlash = h('span', 'rmeta');
    const save = h('button', 'btn', 'Change password'); save.type = 'submit';
    const pwRow = h('div', 'actions'); pwRow.append(save, pwFlash); f.append(pwRow);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (nxt.value !== rep.value) { pwFlash.textContent = 'the new passwords do not match'; return; }
      const r = await postJSON('/api/admin/password', { current: cur.value, next: nxt.value });
      pwFlash.textContent = r.status === 200 ? 'password changed: use it next time you sign in' : (r.body?.error ?? `error ${r.status}`);
      if (r.status === 200) f.reset();
    });
    c.append(line, codeRow, confirmRow, h('h4', 'pw-title', 'Instructor password'), f);
    eventCardEl = c;
  }
  if (code && eventCodeEl.textContent !== code) eventCodeEl.textContent = code;
  return eventCardEl;
}

function deckCard() {
  const c = h('div', 'card');
  const link = (label, href, cls) => { const a = h('a', cls, label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const row = h('div', 'actions');
  row.append(link('Open the instructor deck', '/deck/', 'btn primary'), link('Dev Day intro deck', '/deck/dev-day-intro.html', 'btn'));
  c.append(h('h3', null, 'Presentations'),
    h('p', 'note', 'Workshop 1: Model the domain, not the engine. Dev Day intro: From RDBMS to NoSQL at Enterprise Scale, the 15-minute edition. Each opens in a new tab; press N for the speaker notes, arrow keys to move.'), row);
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
  const { gate, cache, attendees, resets, pending, storage, eventCode } = r.body;
  const top = h('div', 'card');
  top.append(h('h3', null, `Queue: ${gate.queued.length} waiting · ${gate.running.length} running · ${gate.paused ? 'PAUSED' : 'live'}`));
  if (storage) {
    const gb = (b) => (b / 1024 ** 3).toFixed(2);
    top.append(h('p', storage.full ? 'storage full' : 'storage',
      `Storage: attendee workspaces ${gb(storage.workspaceBytes)} GB of the ${gb(storage.capBytes)} GB cap (${storage.workspaces} workspace${storage.workspaces === 1 ? '' : 's'}) · all user data ${gb(storage.userBytes)} GB of 12 GB (26ai Free limit)`));
    if (storage.full) top.append(h('p', 'storage full', 'New sign-ins are closed: the workspace cap is reached. Returning attendees can still sign in.'));
  }
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
  view.replaceChildren(hero, deckCard(), eventCard(eventCode), top, list);
  timer = setTimeout(render, 2000);
}

render();
