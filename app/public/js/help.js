// ⓘ help: a small button that opens one popover at a time with "What it does / Why it matters /
// What to look for" and an optional deck figure. Hover opens a tooltip (desktop); click, Enter or
// Space opens a dialog that keeps focus until Esc or an outside click. Text via textContent only.
const GUTTER = 16;
const GAP = 8;
let current = null;

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

export function placePopover(rect, size, vp) {
  const below = rect.bottom + GAP;
  const side = below + size.height <= vp.height - GUTTER || rect.top - GAP - size.height < GUTTER ? 'below' : 'above';
  const top = side === 'below' ? below : rect.top - GAP - size.height;
  const left = Math.max(GUTTER, Math.min(rect.left, vp.width - GUTTER - size.width));
  return { top, left, side };
}

function closeCurrent(returnFocus = false) {
  if (!current) return;
  const { pop, trigger } = current;
  pop.remove();
  trigger.setAttribute('aria-expanded', 'false');
  current = null;
  if (returnFocus) trigger.focus();
}

function build(content, { label, patternId }, modal) {
  const pop = h('div', 'help-pop');
  pop.setAttribute('role', modal ? 'dialog' : 'tooltip');
  pop.setAttribute('aria-label', `About: ${label}`);
  pop.tabIndex = -1;
  if (content.title) pop.append(h('div', 'help-title', content.title));
  if (content.what) pop.append(h('div', 'help-k', 'What it does'), h('p', null, content.what));
  if (content.why) pop.append(h('div', 'help-k', 'Why it matters'), h('p', null, content.why));
  if (content.look) pop.append(h('div', 'help-k', 'What to look for'), h('p', null, content.look));
  if (content.figure && patternId) {
    const fig = h('figure', 'help-fig');
    const img = h('img');
    img.src = `/figures/${patternId}/${content.figure.file}`;
    img.alt = content.figure.caption ?? label;
    img.loading = 'lazy';
    fig.append(img);
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
  pop.addEventListener('pointerleave', () => { if (!modal) closeCurrent(); });
  trigger.setAttribute('aria-expanded', 'true');
  current = { pop, trigger, modal };
  if (modal) pop.focus();
}

document.addEventListener?.('pointerdown', (e) => {
  if (current && !current.pop.contains(e.target) && e.target !== current.trigger) closeCurrent();
});

// Open a dialog popover anchored to any element (e.g. the Measure-it deck thumbnail).
export function openHelp(anchor, content, opts) { open(anchor, content, opts, true); }

export function helpTrigger(content, opts) {
  if (!content || !(content.why || content.look || content.what || content.figure)) return null;
  const b = h('button', 'help-i', 'ⓘ');
  b.type = 'button';
  b.setAttribute('aria-label', `About: ${opts.label}`);
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  let hoverTimer = null;
  b.addEventListener('click', (e) => { e.stopPropagation(); open(b, content, opts, true); });
  b.addEventListener('pointerenter', () => { hoverTimer = setTimeout(() => open(b, content, opts, false), 200); });
  b.addEventListener('pointerleave', (e) => {
    clearTimeout(hoverTimer);
    if (current?.trigger === b && !current.modal && !current.pop.contains(e.relatedTarget)) closeCurrent();
  });
  return b;
}
