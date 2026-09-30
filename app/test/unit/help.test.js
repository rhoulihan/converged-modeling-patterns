// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { helpTrigger, placePopover } from '../../public/js/help.js';

describe('placePopover', () => {
  const vp = { width: 1000, height: 800 };
  it('prefers below the trigger', () => {
    expect(placePopover({ top: 100, bottom: 120, left: 200, right: 216 }, { width: 400, height: 200 }, vp)).toEqual({ top: 128, left: 200, side: 'below' });
  });
  it('flips above when there is no room below', () => {
    expect(placePopover({ top: 700, bottom: 720, left: 200, right: 216 }, { width: 400, height: 200 }, vp).side).toBe('above');
  });
  it('clamps to a 16 px gutter on the right', () => {
    expect(placePopover({ top: 100, bottom: 120, left: 900, right: 916 }, { width: 400, height: 200 }, vp).left).toBe(584);
  });
});

describe('helpTrigger', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('returns null when there is nothing to say', () => {
    expect(helpTrigger({ why: null, look: null, figure: null }, { label: 'x' })).toBeNull();
  });
  it('opens a dialog with text sections on click and closes on Escape', () => {
    const t = helpTrigger({ why: 'Because <b>physics</b>.', look: 'Row count 1.', figure: { file: 'erd.svg', caption: 'The ERD' } }, { label: 'Read it', patternId: '02-computed' });
    document.body.append(t);
    t.click();
    const d = document.querySelector('.help-pop');
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.textContent).toContain('Because <b>physics</b>.');
    expect(d.querySelector('b')).toBeNull();
    expect(d.querySelector('img').getAttribute('src')).toBe('/figures/02-computed/erd.svg');
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.help-pop')).toBeNull();
  });
  it('only one popover is open at a time', () => {
    const a = helpTrigger({ why: 'a' }, { label: 'a' }); const b = helpTrigger({ why: 'b' }, { label: 'b' });
    document.body.append(a, b); a.click(); b.click();
    expect(document.querySelectorAll('.help-pop').length).toBe(1);
    expect(document.querySelector('.help-pop').textContent).toContain('b');
  });
});

describe('helpTrigger items', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('returns null when items is empty and nothing else is set', () => {
    expect(helpTrigger({ items: [] }, { label: 'card buttons' })).toBeNull();
  });
  it('renders all item labels and texts', () => {
    const t = helpTrigger({
      title: 'The card buttons',
      items: [
        { label: 'Copy', text: 'Copies the statement to your clipboard.' },
        { label: 'Load into console', text: 'Opens the statement in the console.' },
        { label: 'Run', text: 'Runs the statement. Elapsed time and rows show under the result.' },
      ],
    }, { label: 'card buttons' });
    document.body.append(t);
    t.click();
    const d = document.querySelector('.help-pop');
    expect(d.querySelector('.help-title').textContent).toBe('The card buttons');
    expect(d.textContent).toContain('Copy');
    expect(d.textContent).toContain('Copies the statement to your clipboard.');
    expect(d.textContent).toContain('Load into console');
    expect(d.textContent).toContain('Opens the statement in the console.');
    expect(d.textContent).toContain('Run');
    expect(d.textContent).toContain('Elapsed time and rows show under the result.');
  });
});

describe('figure popover', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('widens with .has-fig and wraps the figure (and an "open full size" link) to the full file', () => {
    const t = helpTrigger({ why: 'x', figure: { file: 'model-curve.svg', caption: 'cap' } }, { label: 'y', patternId: '02-computed' });
    document.body.append(t);
    t.click();
    const d = document.querySelector('.help-pop');
    expect(d.classList.contains('has-fig')).toBe(true);
    const links = [...d.querySelectorAll('.help-fig a')];
    expect(links).toHaveLength(2);
    links.forEach((a) => {
      expect(a.getAttribute('href')).toBe('/figures/02-computed/model-curve.svg');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
    });
    expect(d.querySelector('.help-fig-open').textContent).toBe('Open full size ↗');
  });
});

describe('hover tooltip', () => {
  beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());
  it('describes its trigger while open, and Esc anywhere closes it and drops the description', () => {
    const t = helpTrigger({ why: 'Because.' }, { label: 'hover me' });
    document.body.append(t);
    t.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(200);
    const pop = document.querySelector('.help-pop');
    expect(pop.getAttribute('role')).toBe('tooltip');
    expect(pop.id).not.toBe('');
    expect(t.getAttribute('aria-describedby')).toBe(pop.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.help-pop')).toBeNull();
    expect(t.hasAttribute('aria-describedby')).toBe(false);
  });
});
