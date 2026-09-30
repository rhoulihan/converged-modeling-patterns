// app/public/js/app.js
import { getJSON, postJSON } from './api.js';
import { Console, exec } from './console.js';
import { Dock } from './dock.js';
import { renderRun } from './results.js';
import { renderMeasure } from './measure.js';
import { helpTrigger } from './help.js';

const view = document.getElementById('view');
const who = document.getElementById('who');
let config; let patterns = []; let cons; let common = {};

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };
const btn = (label, onClick, cls = 'btn') => { const b = h('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
const MSG = { 409: 'you already have a request queued', 423: 'paused by instructor', 429: 'busy, try again' };

async function copy(text, b) {
  try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select & copy'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1200);
}

// One combined ⓘ for the Copy/Load/Run row: each entry is what+why on one line, Run also keeps
// its "look" line (what to check after running).
function cardButtonsHelp() {
  const line = (key) => { const c = common[key]; return c ? [c.what, c.why].filter(Boolean).join(' ') : ''; };
  const items = [
    { label: 'Copy', text: line('copy') },
    { label: 'Load into console', text: line('load') },
    { label: 'Run', text: [line('run'), common.run?.look].filter(Boolean).join(' ') },
  ].filter((it) => it.text);
  return items.length ? { title: 'The card buttons', items } : null;
}

function card(title, notes, code, lane, patternId, measureTag, help) {
  const c = h('div', 'card');
  if (measureTag) c.append(h('span', 'badge hot', `measured: ${measureTag}`));
  const t = h('h3', null, title);
  const hi = helpTrigger(help, { label: title, patternId });
  if (hi) t.append(hi);
  c.append(t);
  notes.forEach((n) => c.append(h('p', 'note', n)));
  c.append(h('pre', 'code', code));
  const out = h('div', 'card-out');
  const copyBtn = btn('Copy', () => copy(code, copyBtn));
  const runBtn = btn('Run', async () => {
    runBtn.disabled = true;
    const r = await exec({ lane, text: code, patternId }, (s) => { out.textContent = s; });
    runBtn.disabled = false;
    out.replaceChildren(r.ok ? renderRun(r.run) : h('div', 'result error', r.message));
  });
  const actions = h('div', 'actions');
  actions.append(copyBtn, btn('Load into console', () => cons.load(lane, code)), runBtn);
  const actionsHelp = helpTrigger(cardButtonsHelp(), { label: 'card buttons' });
  if (actionsHelp) actions.append(actionsHelp);
  c.append(actions, out);
  return c;
}

function measureCard(p, m) {
  const c = h('div', 'card measure');
  const title = h('h3', null, `Measure it · ${m.tag}`);
  const th = helpTrigger(p.meta.help.tabs.measure, { label: 'Measure it', patternId: p.id }); if (th) title.append(th);
  const kd = h('div', 'kicker', 'Document model'); const kdh = helpTrigger(m.help?.document, { label: 'document write', patternId: p.id }); if (kdh) kd.append(kdh);
  const kc = h('div', 'kicker', 'Converged'); const kch = helpTrigger(m.help?.converged, { label: 'converged write', patternId: p.id }); if (kch) kc.append(kch);
  c.append(title, kd, h('pre', 'code', m.documentSql), kc, h('pre', 'code', m.convergedSql));
  const out = h('div', 'card-out');
  const b = btn('Measure it', async () => {
    b.disabled = true; out.textContent = 'measuring… (waits for an exclusive slot)';
    const r = await postJSON('/api/measure', { patternId: p.id, tag: m.tag });
    b.disabled = false;
    out.replaceChildren(r.status === 200 ? renderMeasure(r.body, { pattern: p }) : h('div', 'result error', MSG[r.status] ?? r.body?.error ?? `error ${r.status}`));
  }, 'btn primary');
  c.append(b, out);
  return c;
}

function home() {
  cons.setPattern(null);
  const grid = h('div', 'patterns');
  patterns.forEach((p, i) => {
    const a = h('a', 'pcard');
    a.href = `#/p/${p.id}`;
    a.append(h('div', 'kicker', `Pattern ${i + 1} · ${p.meta.industry}`), h('h3', null, p.meta.title), h('p', 'problem', p.meta.problem), h('div', 'rmeta', `Deck slides ${p.meta.deck}`));
    grid.append(a);
  });
  view.replaceChildren(h('h1', null, 'Model the domain, not the engine'),
    h('p', 'problem', 'Six document-modeling patterns, each with the document-model starting point and the converged alternative. Copy a query, change it, run it in the console below: SQL or the MongoDB API, same data.'), grid);
}

function patternPage(id) {
  const p = patterns.find((x) => x.id === id);
  if (!p) return home();
  cons.setPattern(id);
  const n = patterns.indexOf(p) + 1;
  const head = h('div');
  const knobs = h('div', 'knobs');
  p.meta.knobs.forEach((k) => { const s = h('span', `knob${k.hot ? ' hot' : ''}`); s.append(h('b', null, `${k.name}: `), document.createTextNode(k.setting)); const hi = helpTrigger(k.help ? { why: k.help, figure: { file: 'model-curve.svg', caption: 'The three knobs and where they flip this pattern (deck)' } } : null, { label: k.name, patternId: id }); if (hi) s.append(hi); knobs.append(s); });
  const status = h('span', 'rmeta');
  const reset = btn('Reset this pattern', async () => {
    reset.disabled = true; status.textContent = 'resetting…';
    const r = await postJSON('/api/reset', { patternId: id });
    reset.disabled = false;
    status.textContent = r.status === 200 ? (r.body.ok ? 'reset done' : `reset failed: ${r.body.errors[0]?.error}`) : (MSG[r.status] ?? `error ${r.status}`);
  });
  const resetHelp = helpTrigger(common.reset, { label: 'Reset' });
  head.append(h('div', 'kicker', `Pattern ${n} · ${p.meta.industry} · deck slides ${p.meta.deck}`), h('h1', null, p.meta.title), h('p', 'problem', p.meta.problem), knobs, reset);
  if (resetHelp) head.append(resetHelp);
  head.append(status);

  const tabs = [
    ['Document model', () => p.cards.document.map((c) => card(c.title, c.notes, c.sql, 'sql', id, c.measure, c.help))],
    ['Converged', () => p.cards.converged.map((c) => card(c.title, c.notes, c.sql, 'sql', id, c.measure, c.help))],
    ...(p.cards.mongo.length ? [['MongoDB API', () => p.cards.mongo.map((c) => card(c.title, c.notes, c.command, 'mongo', id, null, c.help))]] : []),
    ['Measure it', () => p.measures.map((m) => measureCard(p, m))],
  ];
  const TABKEY = { 'Document model': 'document', 'Converged': 'converged', 'MongoDB API': 'mongo', 'Measure it': 'measure' };
  const bar = h('div', 'tabs');
  const body = h('div');
  const select = (i) => {
    [...bar.querySelectorAll('.tab')].forEach((b, j) => b.classList.toggle('on', i === j));
    body.replaceChildren(...tabs[i][1]());
  };
  tabs.forEach(([label], i) => {
    bar.append(btn(label, () => select(i), 'tab'));
    const hi = helpTrigger(p.meta.help.tabs[TABKEY[label]], { label, patternId: id });
    if (hi) bar.append(hi);
  });
  view.replaceChildren(head, bar, body);
  select(0);
}

function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) patternPage(m[1]); else home();
  window.scrollTo(0, 0);
}

function signin() {
  const f = h('form', 'signin');
  f.append(h('h2', null, 'Join the lab'), h('p', 'problem', 'Your own workspace is created on first sign-in. Use the same email to come back to it.'));
  const field = (label, name, type = 'text') => { const l = h('label', null, label); const i = h('input'); i.name = name; i.type = type; i.required = name !== 'code'; l.append(i); f.append(l); };
  field('Name', 'name'); field('Email', 'email', 'email');
  if (config.eventCodeRequired) field('Event code', 'code');
  const flash = h('div', 'flash');
  const submit = h('button', 'btn primary', 'Sign in'); submit.type = 'submit';
  f.append(submit, flash);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true; flash.textContent = 'setting up your workspace…';
    const d = Object.fromEntries(new FormData(f));
    const r = await postJSON('/api/signin', d);
    submit.disabled = false;
    if (r.status === 200) { flash.textContent = ''; boot(); } else flash.textContent = r.body?.error ?? MSG[r.status] ?? `error ${r.status}`;
  });
  document.getElementById('console').hidden = true;
  view.replaceChildren(f);
}

async function boot() {
  config = (await getJSON('/api/config')).body;
  const me = await getJSON('/api/me');
  if (me.status === 401) return signin();
  document.getElementById('console').hidden = false;
  who.textContent = config.mode === 'solo' ? 'solo · CMP_USER' : `${me.body.user.name} · ${me.body.user.schema}`;
  patterns = (await getJSON('/api/patterns')).body;
  common = (await getJSON('/help/common.json')).body ?? {};
  const consoleEl = document.getElementById('console');
  cons ??= new Console(consoleEl, new Dock(consoleEl));
  window.onhashchange = route;
  route();
}

boot();
