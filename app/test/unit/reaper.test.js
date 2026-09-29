import { describe, it, expect, vi, afterEach } from 'vitest';
import { Workspaces } from '../../src/services/workspaces.js';

const deferred = () => { let resolve; const p = new Promise((a) => { resolve = a; }); return { p, resolve }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.restoreAllMocks());

describe('Workspaces.startReaper', () => {
  it('skips a tick while the previous pass is still in flight, and resumes after it finishes', async () => {
    const ws = new Workspaces({ cfg: {}, pools: {} });
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
