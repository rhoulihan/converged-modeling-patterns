import { describe, it, expect, vi, afterEach } from 'vitest';
import { Workspaces } from '../../src/services/workspaces.js';

const deferred = () => { let resolve; const p = new Promise((a) => { resolve = a; }); return { p, resolve }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.restoreAllMocks());

describe('Workspaces.startReaper', () => {
  it('skips a tick while the previous pass is still in flight, and resumes after it finishes', async () => {
    const ws = new Workspaces({ cfg: {}, pools: {} });
    vi.spyOn(ws, 'pendingCount').mockResolvedValue(1);
    const reap = vi.spyOn(ws, 'reapPending').mockResolvedValue({ dropped: 0, pending: 0 });
    const hold = deferred();
    const runPass = vi.fn(async (fn) => { const out = await fn(); await hold.p; return out; });

    const stop = ws.startReaper(20, runPass);
    try {
      await sleep(150); // well over 2 intervals while the first pass is blocked
      expect(runPass).toHaveBeenCalledTimes(1);
      expect(reap).toHaveBeenCalledTimes(1);

      hold.resolve();
      await sleep(100);
      expect(reap.mock.calls.length).toBeGreaterThan(1); // the in-flight flag was cleared
    } finally {
      stop();
    }
  });

  it('logs a failed pass (e.g. a busy gate) as one line and retries on the next tick', async () => {
    const ws = new Workspaces({ cfg: {}, pools: {} });
    vi.spyOn(ws, 'pendingCount').mockResolvedValue(1);
    vi.spyOn(ws, 'reapPending').mockResolvedValue({ dropped: 0, pending: 0 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runPass = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy, retry'), { status: 429 }))
      .mockImplementation((fn) => fn());

    const stop = ws.startReaper(20, runPass);
    try {
      await sleep(100);
      expect(err).toHaveBeenCalledWith('[lab-ui] reapPending failed: busy, retry');
      expect(runPass.mock.calls.length).toBeGreaterThan(1);
    } finally {
      stop();
    }
  });
});

// A stand-in control pool: `handler(sql, binds)` returns the execute() result (default: no rows).
function fakeControl(handler = () => undefined) {
  const calls = [];
  const conn = {
    execute: vi.fn(async (sql, binds) => { calls.push(sql); return (await handler(sql, binds)) ?? { rows: [] }; }),
    commit: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { pools: { control: { getConnection: async () => conn } }, calls };
}

describe('reaper gate use (M2)', () => {
  it('checks lab_pending_drop first and takes the gate only when there is something to reap', async () => {
    const { pools, calls } = fakeControl((sql) => (/COUNT\(\*\)/.test(sql) ? { rows: [{ N: 0 }] } : undefined));
    const ws = new Workspaces({ cfg: {}, pools });
    const runPass = vi.fn((fn) => fn());
    const stop = ws.startReaper(20, runPass);
    try {
      await sleep(100);
      expect(calls.some((s) => /SELECT COUNT\(\*\) AS n FROM lab_pending_drop/.test(s))).toBe(true);
      expect(runPass).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

describe('Workspaces.dropAll (M3 + name check)', () => {
  it('locks and parks WS_ workspaces, skips a non-WS_ name, and returns without reaping', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pools, calls } = fakeControl();
    const ws = new Workspaces({ cfg: {}, pools });
    vi.spyOn(ws, 'list').mockResolvedValue([{ schema: 'WS_ABC123' }, { schema: 'CMP_USER; DROP' }]);
    const reap = vi.spyOn(ws, 'reapPending');
    const drop = vi.fn(async () => {});
    expect(await ws.dropAll({ drop })).toEqual({ dropped: 0, pending: 1 });
    expect(reap).not.toHaveBeenCalled();
    expect(calls.filter((s) => /ACCOUNT LOCK/.test(s))).toEqual(['ALTER USER WS_ABC123 ACCOUNT LOCK']);
    expect(calls.some((s) => /CMP_USER/.test(s))).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/skipped "CMP_USER; DROP": not a WS_ workspace name/));
  });
});

describe('Workspaces.reapPending session kill', () => {
  it('ignores KILLED sessions and tolerates ORA-00031 while killing', async () => {
    let drops = 0;
    const { pools, calls } = fakeControl((sql) => {
      if (/FROM lab_pending_drop/.test(sql) && /parked_sec/.test(sql)) return { rows: [{ SCHEMA_NAME: 'WS_ABC123', PARKED_SEC: 300 }] };
      if (/^DROP USER/.test(sql)) { drops += 1; if (drops === 1) throw Object.assign(new Error('ORA-01940'), { errorNum: 1940 }); return undefined; }
      if (/SELECT sid/.test(sql)) return { rows: [{ SID: 10, SERIAL: 20 }] };
      if (/KILL SESSION/.test(sql)) throw Object.assign(new Error('ORA-00031: session marked for kill'), { errorNum: 31 });
      if (/COUNT\(\*\) AS n FROM v\$session/.test(sql)) return { rows: [{ N: 0 }] };
      return undefined;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ws = new Workspaces({ cfg: {}, pools });
    expect(await ws.reapPending()).toEqual({ dropped: 1, pending: 0 });
    expect(calls.find((s) => /SELECT sid/.test(s))).toMatch(/status <> 'KILLED'/);
  });
});
