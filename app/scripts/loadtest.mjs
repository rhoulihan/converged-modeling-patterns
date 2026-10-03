// Load test for an event-mode lab: N simulated attendees sign in, build their patterns, then
// all run lab read cards at once for a few rounds. Reports latency and outcomes per request.
//
// Usage: BASE=http://umt-lab.local:3100 EVENT_CODE=... ADMIN_PASSWORD=... \
//        USERS=25 ROUNDS=5 node scripts/loadtest.mjs [--cleanup]
// --cleanup ends the event afterwards (drops EVERY workspace) only if every attendee on the
// lab is one of this script's loadtest-NN accounts or a known test account.
const BASE = process.env.BASE ?? 'http://localhost:3100';
const USERS = Number(process.env.USERS ?? 25);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const PATTERNS = (process.env.PATTERNS ?? '01-extended-reference,04-subset,05-tree-hierarchy').split(',');
const TEST_EMAIL = /^(loadtest-\d+|p5\.check|deploy\.check|funnel\.check|brand\.check|rl)@example\.com$/;

const post = async (path, body, cookie) => {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const ms = performance.now() - t0;
  let json = null; try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, ms, json, setCookie: r.headers.get('set-cookie') };
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

// 1. Sign in N attendees (sequential: each sign-in provisions a workspace).
const users = [];
for (let i = 1; i <= USERS; i++) {
  const email = `loadtest-${String(i).padStart(2, '0')}@example.com`;
  const r = await post('/api/signin', { name: `Load ${i}`, email, code: process.env.EVENT_CODE });
  if (r.status !== 200) { console.error(`sign-in ${email}: ${r.status} ${JSON.stringify(r.json)}`); process.exit(1); }
  users.push({ email, cookie: r.setCookie.split(';')[0] });
}
console.log(`signed in ${users.length} attendees`);

// 2. The read cards to run, and a warm-up per user (builds each pattern once).
const pats = await (await fetch(`${BASE}/api/patterns`, { headers: { Cookie: users[0].cookie } })).json();
const cards = pats.filter((p) => PATTERNS.includes(p.id)).flatMap((p) => ['document', 'converged'].flatMap((lane) =>
  p.cards[lane].filter((c) => /^\s*(SELECT|WITH)\b/i.test(c.sql)).map((c) => ({ patternId: p.id, sql: c.sql, title: c.title }))));
for (const u of users) for (const id of PATTERNS) await post('/api/run', { lane: 'sql', patternId: id, text: cards.find((c) => c.patternId === id).sql }, u.cookie);
console.log(`warmed: ${PATTERNS.length} patterns built for every attendee; ${cards.length} read cards in the mix`);

// 3. The burst: every attendee runs a random read card, all at once, ROUNDS times.
const results = [];
const t0 = performance.now();
for (let round = 0; round < ROUNDS; round++) {
  await Promise.all(users.map(async (u) => {
    const c = cards[Math.floor(Math.random() * cards.length)];
    const r = await post('/api/run', { lane: 'sql', patternId: c.patternId, text: c.sql }, u.cookie);
    const sqlError = r.json?.results?.find((x) => x.kind === 'error');
    results.push({ status: r.status, ms: r.ms, error: sqlError ? `${sqlError.code ?? ''} ${sqlError.error}` : null });
  }));
}
const wall = (performance.now() - t0) / 1000;
const ok = results.filter((r) => r.status === 200 && !r.error);
const byStatus = results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
const errs = [...new Set(results.filter((r) => r.error).map((r) => r.error))];
const ms = ok.map((r) => r.ms);
console.log(JSON.stringify({ base: BASE, users: USERS, rounds: ROUNDS, requests: results.length, ok: ok.length, byStatus,
  sqlErrors: errs.slice(0, 5), wallSeconds: +wall.toFixed(1), throughputPerSec: +(results.length / wall).toFixed(1),
  latencyMs: { p50: Math.round(pct(ms, 0.5)), p95: Math.round(pct(ms, 0.95)), max: Math.round(Math.max(0, ...ms)) } }, null, 2));

// 4. Optional clean-up: end the event, only when the lab holds nothing but test attendees.
if (process.argv.includes('--cleanup')) {
  const login = await post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
  const admin = login.setCookie.split(';')[0];
  const status = await (await fetch(`${BASE}/api/admin/status`, { headers: { Cookie: admin } })).json();
  const real = status.attendees.filter((a) => a.email && !TEST_EMAIL.test(a.email));
  if (real.length) { console.log(`cleanup skipped: ${real.length} non-test attendee(s) present`); process.exit(0); }
  const r = await post('/api/admin/end-event', {}, admin);
  console.log(`cleanup: end event ${r.status} ${JSON.stringify(r.json)}`);
}
