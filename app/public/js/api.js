// app/public/js/api.js
async function call(url, init) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
export const getJSON = (url) => call(url);
export const postJSON = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
