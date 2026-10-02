// Stand-in for the browser editor bundle (/vendor/cm.js, built at image time) in jsdom tests.
export function createEditor(el, { doc = '' } = {}) {
  let text = doc;
  return { get: () => text, set: (t) => { text = t; }, focus: () => {} };
}
