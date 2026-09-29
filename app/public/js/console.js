// app/public/js/console.js
import { createEditor } from '/vendor/cm.js';
import { getJSON, postJSON } from './api.js';
import { renderRun } from './results.js';

const MESSAGES = { 401: 'please sign in again', 409: 'you already have a request queued', 423: 'paused by instructor', 429: 'busy — the database is serving others, try again' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export async function exec({ lane, text, patternId }, onStatus) {
  let done = false;
  onStatus('running…');
  const poll = (async () => {
    await sleep(400);
    while (!done) {
      const q = await getJSON('/api/queue').catch(() => null);
      if (!done && q?.body) onStatus(q.body.paused ? 'paused by instructor' : q.body.position === null ? 'running…' : `queued · ${q.body.position} ahead`);
      await sleep(750);
    }
  })();
  try {
    const r = await postJSON('/api/run', { lane, patternId, text });
    if (r.status === 200) return { ok: true, run: r.body };
    return { ok: false, message: MESSAGES[r.status] ?? r.body?.error ?? `error ${r.status}` };
  } catch {
    return { ok: false, message: 'network error' };
  } finally {
    done = true;
    await poll.catch(() => {});
  }
}

export class Console {
  constructor(root) {
    this.root = root;
    this.lane = 'sql';
    this.patternId = null;
    this.statusEl = root.querySelector('#status');
    this.out = root.querySelector('#out');
    this.editors = {
      sql: createEditor(root.querySelector('#editor-sql'), { lang: 'sql', doc: store.get('lab.last.sql') ?? 'SELECT 1 FROM dual', onRun: () => this.run() }),
      mongo: createEditor(root.querySelector('#editor-mongo'), { lang: 'mongo', doc: store.get('lab.last.mongo') ?? 'show collections', onRun: () => this.run() }),
    };
    root.querySelectorAll('.bar [data-lane]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.lane)));
    root.querySelector('#run').addEventListener('click', () => this.run());
    root.querySelector('#history').addEventListener('click', () => this.showHistory());
  }

  show(lane) {
    this.lane = lane;
    this.root.querySelectorAll('.bar [data-lane]').forEach((b) => b.classList.toggle('on', b.dataset.lane === lane));
    this.root.querySelector('#editor-sql').hidden = lane !== 'sql';
    this.root.querySelector('#editor-mongo').hidden = lane !== 'mongo';
    this.editors[lane].focus();
  }

  load(lane, text) {
    this.show(lane);
    this.editors[lane].set(text);
    this.editors[lane].focus();
  }

  setPattern(id) {
    this.patternId = id;
  }

  async run() {
    const lane = this.lane;
    const text = this.editors[lane].get();
    if (!text.trim()) return;
    store.set(`lab.last.${lane}`, text);
    const hist = (store.get(`lab.hist.${lane}`) ?? []).filter((t) => t !== text);
    store.set(`lab.hist.${lane}`, [text, ...hist].slice(0, 20));
    const btn = this.root.querySelector('#run');
    btn.disabled = true;
    const r = await exec({ lane, text, patternId: this.patternId }, (s) => { this.statusEl.textContent = s; });
    btn.disabled = false;
    this.statusEl.textContent = r.ok ? 'ready' : r.message;
    this.out.replaceChildren(r.ok ? renderRun(r.run) : Object.assign(document.createElement('div'), { className: 'result error', textContent: r.message }));
  }

  showHistory() {
    const list = document.createElement('div');
    const items = store.get(`lab.hist.${this.lane}`) ?? [];
    if (!items.length) list.textContent = 'No history yet.';
    for (const t of items) {
      const pre = Object.assign(document.createElement('pre'), { className: 'code', textContent: t, title: 'Click to load' });
      pre.style.cursor = 'pointer';
      pre.addEventListener('click', () => this.load(this.lane, t));
      list.append(pre);
    }
    this.out.replaceChildren(list);
  }
}
