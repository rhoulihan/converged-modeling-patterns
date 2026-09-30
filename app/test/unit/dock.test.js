// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dock } from '../../public/js/dock.js';

function mk() {
  document.body.innerHTML = '';
  const root = document.createElement('section'); root.id = 'console';
  const bar = document.createElement('div'); bar.className = 'bar';
  const t = document.createElement('button'); t.id = 'dock-toggle';
  const pin = document.createElement('button'); pin.id = 'dock-pin';
  const ed = document.createElement('div'); ed.className = 'editor'; ed.tabIndex = 0;
  bar.append(t, pin); root.append(bar, ed); document.body.append(root);
  const mem = {}; const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  return { root, t, pin, ed, storage, dock: new Dock(root, { storage }) };
}

describe('Dock', () => {
  beforeEach(() => vi.useFakeTimers());

  it('starts collapsed with aria-expanded=false', () => {
    const { root, t } = mk();
    expect(root.classList.contains('expanded')).toBe(false);
    expect(t.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens on hover after the intent delay and closes 600 ms after leaving', () => {
    const { root } = mk();
    root.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(149);
    expect(root.classList.contains('expanded')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(true);
    root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(599);
    expect(root.classList.contains('expanded')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(false);
  });
  it('stays open while focused, busy or pinned', () => {
    const { root, ed, dock } = mk();
    dock.open('hover');
    ed.focus(); root.dispatchEvent(new Event('focusin'));
    root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
    ed.blur(); root.dispatchEvent(new Event('focusout'));
    dock.setBusy(true); root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
    dock.setBusy(false); dock.togglePin(); root.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
  });
  it('remembers the pin in storage and tolerates storage that throws', () => {
    const { storage, dock } = mk();
    dock.togglePin();
    expect(storage.getItem('lab.dock.pinned')).toBe('true');
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => new Dock(document.getElementById('console'), { storage: bad }).togglePin()).not.toThrow();
  });
  it('the toggle button opens and closes explicitly', () => {
    const { root, t } = mk();
    t.click(); expect(root.classList.contains('expanded')).toBe(true);
    t.click(); expect(root.classList.contains('expanded')).toBe(false);
  });
});
