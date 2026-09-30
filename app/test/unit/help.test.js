// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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
