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

  it('closes 600ms after focus leaves to outside the dock, with the pointer not on it (Load into console, then click away)', () => {
    const { root, ed, dock } = mk();
    dock.open('load');
    ed.focus(); root.dispatchEvent(new Event('focusin'));
    ed.blur(); root.dispatchEvent(new Event('focusout')); // relatedTarget is outside root
    vi.advanceTimersByTime(599);
    expect(root.classList.contains('expanded')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(false);
  });

  it('stays open if focus leaves the dock while the pointer is still hovering it', () => {
    const { root, ed } = mk();
    root.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(150);
    expect(root.classList.contains('expanded')).toBe(true);
    ed.focus(); root.dispatchEvent(new Event('focusin'));
    ed.blur(); root.dispatchEvent(new Event('focusout'));
    vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
  });

  it('closes 600ms after a run finishes (setBusy(false)) with no hover and no focus', () => {
    const { root, dock } = mk();
    dock.setBusy(true);
    expect(root.classList.contains('expanded')).toBe(true);
    dock.setBusy(false);
    vi.advanceTimersByTime(599);
    expect(root.classList.contains('expanded')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(root.classList.contains('expanded')).toBe(false);
  });

  it('never closes while pinned, even after a run finishes with no hover or focus', () => {
    const { root, dock } = mk();
    dock.togglePin();
    dock.setBusy(true);
    dock.setBusy(false);
    vi.advanceTimersByTime(2000);
    expect(root.classList.contains('expanded')).toBe(true);
  });

  it('Esc from the editor collapses the dock and leaves focus on the toggle without reopening it', () => {
    const { root, t, ed, dock } = mk();
    dock.open('load');
    ed.focus(); ed.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    t.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(2000);
    expect(document.activeElement).toBe(t);
    expect(root.classList.contains('expanded')).toBe(false);
  });

  it('on a touch device (hover: none), focus then click on the toggle toggles exactly once per click', () => {
    const orig = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: false });
    try {
      const { root, t, dock } = mk();
      expect(dock.hoverable).toBe(false);
      t.focus(); t.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); t.click();
      expect(root.classList.contains('expanded')).toBe(true);
      t.click();
      expect(root.classList.contains('expanded')).toBe(false);
    } finally { globalThis.matchMedia = orig; }
  });

  it('keyboard focus on the toggle or pin alone does not expand the dock; focus elsewhere inside does', () => {
    const { root, t, pin, ed } = mk();
    t.focus(); t.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(root.classList.contains('expanded')).toBe(false);
    pin.focus(); pin.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(root.classList.contains('expanded')).toBe(false);
    ed.focus(); ed.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(root.classList.contains('expanded')).toBe(true);
  });

  it('pinning toggles the dock-pinned class on body so the page can pad for the dock', () => {
    const { dock } = mk();
    expect(document.body.classList.contains('dock-pinned')).toBe(false);
    dock.togglePin();
    expect(document.body.classList.contains('dock-pinned')).toBe(true);
    dock.togglePin();
    expect(document.body.classList.contains('dock-pinned')).toBe(false);
  });
});
