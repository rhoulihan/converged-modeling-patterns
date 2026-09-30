// Console dock: a 40 px bar that slides the console up on hover, focus, load or run, and back
// down 600 ms after the pointer leaves, unless the editor has focus, a run is in flight or the
// dock is pinned. Touch devices (no hover) toggle on tap only.
const OPEN_DELAY = 150;
const CLOSE_DELAY = 600;
const KEY = 'lab.dock.pinned';

export class Dock {
  constructor(root, { storage = globalThis.localStorage } = {}) {
    this.root = root;
    this.storage = storage;
    this.toggle = root.querySelector('#dock-toggle');
    this.pinBtn = root.querySelector('#dock-pin');
    this.focused = false; this.busy = false; this.timer = null;
    this.hoverable = globalThis.matchMedia?.('(hover: hover)').matches ?? true;
    this.#setPinned(this.#read() === 'true');
    this.#render(this.pinned);
    if (this.hoverable) {
      root.addEventListener('pointerenter', () => this.#schedule(() => this.open('hover'), OPEN_DELAY));
      root.addEventListener('pointerleave', () => this.#schedule(() => this.close(), CLOSE_DELAY));
    }
    root.addEventListener('focusin', () => { this.focused = true; this.open('focus'); });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) this.focused = false; });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.pinned) { this.focused = false; this.close(true); this.toggle?.focus(); } });
    this.toggle?.addEventListener('click', () => (this.expanded ? this.close(true) : this.open('toggle')));
    this.pinBtn?.addEventListener('click', () => this.togglePin());
    globalThis.addEventListener?.('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); this.expanded ? this.close(true) : this.open('key'); } });
  }

  get expanded() { return this.root.classList.contains('expanded'); }

  open() { clearTimeout(this.timer); this.#render(true); }

  close(force = false) {
    clearTimeout(this.timer);
    if (this.pinned || this.busy || (this.focused && !force)) return;
    this.#render(false);
  }

  setBusy(on) { this.busy = on; this.root.classList.toggle('busy', on); if (on) this.open('run'); }

  togglePin() {
    this.#setPinned(!this.pinned);
    try { this.storage?.setItem(KEY, String(this.pinned)); } catch { /* storage unavailable */ }
    if (this.pinned) this.open('pin');
  }

  #setPinned(v) {
    this.pinned = v;
    this.root.classList.toggle('pinned', v);
    this.pinBtn?.setAttribute('aria-pressed', String(v));
  }

  #read() { try { return this.storage?.getItem(KEY); } catch { return null; } }

  #schedule(fn, ms) { clearTimeout(this.timer); this.timer = setTimeout(fn, ms); }

  #render(on) {
    this.root.classList.toggle('expanded', on);
    this.toggle?.setAttribute('aria-expanded', String(on));
    if (this.toggle) this.toggle.textContent = on ? '▼ Console' : '▲ Console';
  }
}
