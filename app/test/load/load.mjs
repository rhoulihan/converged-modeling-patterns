// app/test/load/load.mjs
// Requires LAB_MODE=event. Env: LAB_URL, EVENT_CODE, USERS (150), WRITERS (0.2),
// DB_HOST/DB_PORT (host-mapped, default localhost:1522), LAB_ADMIN_PASSWORD,
// ADMIN_PASSWORD (to prewarm workspaces before sign-in; PREWARM=0 skips it).
import oracledb from 'oracledb';

const URL = process.env.LAB_URL ?? 'http://localhost:3100';
const USERS = Number(process.env.USERS ?? 150);
const WRITERS = Number(process.env.WRITERS ?? 0.2);
const PATTERN = '01-extended-reference';
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(jar, path, body) {
  const res = await fetch(URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: jar.c ?? '' }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) jar.c = set.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}
const get = async (jar, path) => {
  const res = await fetch(URL + path, { headers: { cookie: jar.c ?? '' } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const cfg = await (await fetch(`${URL}/api/config`)).json();
if (cfg.mode !== 'event') { console.error('load test needs LAB_MODE=event'); process.exit(2); }
const users = Array.from({ length: USERS }, (_, i) => ({ i, jar: {} }));

// Sign-in provisions a workspace under the exclusive gate unless a prewarmed one is free;
// prewarm first (as an instructor would) so sign-in is a claim, not a CREATE USER.
if (process.env.PREWARM !== '0' && process.env.ADMIN_PASSWORD) {
  const admin = {};
  const login = await post(admin, '/api/admin/login', { password: process.env.ADMIN_PASSWORD });
  if (login.status !== 200) { console.error('admin login failed', login); process.exit(1); }
  const free = async () => (await get(admin, '/api/admin/status')).body.attendees.filter((a) => !a.email).length;
  const need = USERS - await free();
  if (need > 0) {
    console.log(`prewarming ${need} workspaces…`);
    const r = await post(admin, '/api/admin/prewarm', { count: need });
    if (r.status !== 202) { console.error('prewarm failed', r); process.exit(1); }
    const t = Date.now();
    for (let n = await free(); n < USERS; n = await free()) {
      if (Date.now() - t > 90 * 60_000) { console.error(`prewarm stalled at ${n}/${USERS}`); process.exit(1); }
      process.stdout.write(`\r  ${n}/${USERS} ready (${Math.round((Date.now() - t) / 1000)} s)`);
      await sleep(5000);
    }
    console.log(`\n  prewarmed in ${Math.round((Date.now() - t) / 1000)} s`);
  }
}

console.log(`signing in ${USERS} attendees…`);
const signin = { ms: [], status429: 0 };
for (const u of users) {
  for (let attempt = 0; ; attempt++) {
    const s = Date.now();
    const r = await post(u.jar, '/api/signin', { name: `Load ${u.i}`, email: `load${u.i}@example.com`, code: process.env.EVENT_CODE });
    if (r.status === 200) { signin.ms.push(Date.now() - s); break; }
    if (r.status === 429 && attempt < 5) { signin.status429++; continue; }
    console.error('sign-in failed', r); process.exit(1);
  }
}
// /api/patterns needs a session in event mode, so read it as the first attendee.
const patterns = (await get(users[0].jar, '/api/patterns')).body;
const cards = patterns.find((p) => p.id === PATTERN).cards.converged;
const read = cards.find((c) => /^\s*(SELECT|WITH)\b/i.test(c.sql)).sql;

console.log('warming (builds pattern 01 in every workspace, one at a time)…');
for (const u of users) {
  const r = await post(u.jar, '/api/run', { lane: 'sql', patternId: PATTERN, text: read });
  if (r.status !== 200) { console.error('warm-up failed', r.status, r.body); process.exit(1); }
}

const conn = await oracledb.getConnection({ user: 'lab_admin', password: process.env.LAB_ADMIN_PASSWORD ?? 'LabAdmin2026', connectString: `${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? 1522}/FREEPDB1` });
let maxActive = 0; let samples = 0; let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const r = await conn.execute("SELECT COUNT(*) FROM v$session WHERE username LIKE 'WS\\_%' ESCAPE '\\' AND status = 'ACTIVE'");
    maxActive = Math.max(maxActive, r.rows[0][0]);
    samples++;
    await new Promise((res) => setTimeout(res, 50));
  }
})();

console.log(`burst: ${USERS} attendees click Run at once (${Math.round(WRITERS * 100)}% write)…`);
const t0 = Date.now();
const outcomes = await Promise.all(users.map(async (u) => {
  const write = u.i < USERS * WRITERS;
  const text = write ? `UPDATE xr_advisors SET office = 'LOAD-${u.i}' WHERE ROWNUM = 1` : read;
  const s = Date.now();
  const r = await post(u.jar, '/api/run', { lane: 'sql', patternId: PATTERN, text });
  return { status: r.status, cached: r.body?.cached === true, ms: Date.now() - s, write };
}));
const wallMs = Date.now() - t0;
sampling = false;
await sampler;
await conn.close();

const lat = outcomes.filter((o) => o.status === 200).map((o) => o.ms);
const report = {
  users: USERS,
  signin: { status429: signin.status429, p50ms: pct(signin.ms, 0.5), p95ms: pct(signin.ms, 0.95) },
  wallMs,
  statuses: outcomes.reduce((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {}),
  cachedReads: outcomes.filter((o) => o.cached).length,
  executed: outcomes.filter((o) => o.status === 200 && !o.cached).length,
  maxActiveAttendeeSessions: maxActive,
  sessionSamples: samples,
  p50ms: pct(lat, 0.5),
  p95ms: pct(lat, 0.95),
};
console.log(JSON.stringify(report, null, 2));

const problems = [];
if (maxActive > 1) problems.push(`gate breached: ${maxActive} attendee sessions active at once`);
if (Object.keys(report.statuses).some((s) => Number(s) >= 500)) problems.push('server errors during burst');
if (report.executed > USERS * WRITERS + 1) problems.push(`cache did not absorb the reads: ${report.executed} executions`);
if (problems.length) { console.error(`LOAD FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('LOAD PASS');
