// app/public/js/brand.js
// Oracle brand chrome shared by the attendee and instructor landing pages. The wordmark is the
// official file from oracle.com (red on light only, never recoloured); Oracle red stays out of
// the lab's data visuals, where red already means "rewritten" and green "converged".
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = String(text); return e; };

export function oracleLogo(cls = 'oracle-logo') {
  const img = h('img', cls);
  img.src = '/brand/oracle-logo.svg';
  img.alt = 'Oracle';
  return img;
}

// The split landing layout: the brand panel (wordmark, lab name, what you'll do) beside the
// sign-in form. Stacks to one column on narrow screens.
export function landing(form, { title, lede, note }) {
  const panel = h('div', 'landing-brand');
  // The panel is light in both themes, so its wordmark needs no dark-mode chip.
  const mark = h('div', 'logo-chip on-light'); mark.append(oracleLogo('oracle-logo big'));
  panel.append(mark, h('h1', 'landing-title', title), h('p', 'landing-lede', lede));
  if (note) panel.append(h('p', 'landing-note', note));
  panel.append(h('p', 'landing-foot', 'Built on Oracle AI Database 26ai'));
  const wrap = h('section', 'landing');
  wrap.append(panel, form);
  return wrap;
}
