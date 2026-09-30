// ⓘ help: a small button that opens one popover at a time with "What it does / Why it matters /
// What to look for" (or a labelled list of items) and an optional deck figure — the popover widens
// (.has-fig) and the figure links to the full-size file when one is shown. Hover opens a tooltip
// (desktop) that describes its trigger (aria-describedby) and closes on Esc from anywhere; click,
// Enter or Space opens a dialog that keeps focus until Esc or an outside click.
// Text via textContent only.
const GUTTER = 16;
const GAP = 8;
// Grace period for a hover tooltip: long enough to cross the gap from the ⓘ into the
// popover (and reach its links), short enough that it still feels like hover.
const LEAVE_GRACE = 350;
let leaveTimer = null;
const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = null; };
const scheduleLeave = () => { cancelLeave(); leaveTimer = setTimeout(() => { if (current && !current.modal) closeCurrent(); }, LEAVE_GRACE); };
let current = null;
let seq = 0;

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

export function placePopover(rect, size, vp) {
  const below = rect.bottom + GAP;
  const side = below + size.height <= vp.height - GUTTER || rect.top - GAP - size.height < GUTTER ? 'below' : 'above';
  const top = side === 'below' ? below : rect.top - GAP - size.height;
  const left = Math.max(GUTTER, Math.min(rect.left, vp.width - GUTTER - size.width));
  return { top, left, side };
}

function closeCurrent(returnFocus = false) {
  cancelLeave();
  if (!current) return;
  const { pop, trigger } = current;
  pop.remove();
  trigger.setAttribute('aria-expanded', 'false');
  trigger.removeAttribute('aria-describedby');
  current = null;
  if (returnFocus) trigger.focus();
}

function build(content, { label, patternId }, modal) {
  const pop = h('div', 'help-pop');
  pop.id = `help-pop-${++seq}`;
  pop.setAttribute('role', modal ? 'dialog' : 'tooltip');
  pop.setAttribute('aria-label', `About: ${label}`);
  pop.tabIndex = -1;
  if (content.title) pop.append(h('div', 'help-title', content.title));
  content.items?.forEach((it) => pop.append(h('div', 'help-k', it.label), h('p', null, it.text)));
  if (content.what) pop.append(h('div', 'help-k', 'What it does'), h('p', null, content.what));
  if (content.why) pop.append(h('div', 'help-k', 'Why it matters'), h('p', null, content.why));
  if (content.look) pop.append(h('div', 'help-k', 'What to look for'), h('p', null, content.look));
  if (content.figure && patternId) {
    pop.classList.add('has-fig');
    const href = `/figures/${patternId}/${content.figure.file}`;
    const fig = h('figure', 'help-fig');
    const link = h('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = h('img');
    img.src = href;
    img.alt = content.figure.caption ?? label;
    img.loading = 'lazy';
    link.append(img);
    // The full-size link goes ABOVE the figure: a tall figure pushes anything below it
    // out of the popover's visible area, where a hover tooltip can't be scrolled to.
    const open = h('a', 'help-fig-open', 'Open full size ↗');
    open.href = href;
    open.target = '_blank';
    open.rel = 'noopener';
    fig.append(open, link);
    if (content.figure.caption) fig.append(h('figcaption', null, content.figure.caption));
    pop.append(fig);
  }
  return pop;
}

function open(trigger, content, opts, modal) {
  if (current?.trigger === trigger && current.modal === modal) return;
  closeCurrent();
  const pop = build(content, opts, modal);
  document.body.append(pop);
  const r = trigger.getBoundingClientRect();
  const size = { width: pop.offsetWidth || 420, height: pop.offsetHeight || 200 };
  const p = placePopover(r, size, { width: window.innerWidth, height: window.innerHeight });
  pop.style.top = `${p.top + window.scrollY}px`;
  pop.style.left = `${p.left + window.scrollX}px`;
  pop.dataset.side = p.side;
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCurrent(true); } });
  pop.addEventListener('pointerenter', () => { if (!modal) cancelLeave(); });
  pop.addEventListener('pointerleave', () => { if (!modal) scheduleLeave(); });
  trigger.setAttribute('aria-expanded', 'true');
  if (!modal) trigger.setAttribute('aria-describedby', pop.id);
  current = { pop, trigger, modal };
  if (modal) pop.focus();
}

document.addEventListener?.('pointerdown', (e) => {
  if (current && !current.pop.contains(e.target) && e.target !== current.trigger) closeCurrent();
});

// A hover tooltip never takes focus, so its own keydown never fires — Esc is caught here instead.
document.addEventListener?.('keydown', (e) => {
  if (e.key === 'Escape' && current && !current.modal) closeCurrent();
});

// Open a dialog popover anchored to any element (e.g. the Measure-it deck thumbnail).
export function openHelp(anchor, content, opts) { open(anchor, content, opts, true); }

export function helpTrigger(content, opts) {
  if (!content || !(content.why || content.look || content.what || content.figure || content.items?.length)) return null;
  const b = h('button', 'help-i', 'ⓘ');
  b.type = 'button';
  b.setAttribute('aria-label', `About: ${opts.label}`);
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  let hoverTimer = null;
  b.addEventListener('click', (e) => { e.stopPropagation(); open(b, content, opts, true); });
  b.addEventListener('pointerenter', () => {
    if (current?.trigger === b && !current.modal) { cancelLeave(); return; }
    hoverTimer = setTimeout(() => open(b, content, opts, false), 200);
  });
  b.addEventListener('pointerleave', (e) => {
    clearTimeout(hoverTimer);
    if (current?.trigger === b && !current.modal && !current.pop.contains(e.relatedTarget)) scheduleLeave();
  });
  return b;
}
