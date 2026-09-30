import { describe, it, expect, vi, afterEach } from 'vitest';
import { createExecPool } from '../../src/db/oracle.js';

const tick = () => new Promise((r) => setImmediate(r));

function makeConn() {
  let closeCount = 0;
  return {
    closed: false,
    lastCloseArgs: undefined,
    async close(...args) {
      closeCount++;
      this.lastCloseArgs = args[0];
      if (closeCount > 1) throw new Error('NJS-003: invalid connection'); // mirrors real driver's ERR_INVALID_CONNECTION
      this.closed = true;
    },
  };
}

const cfg = (poolMax = 1, queueTimeoutMs = 1000) => ({ db: { poolMax }, gate: { queueTimeoutMs } });

afterEach(() => vi.useRealTimers());

describe('createExecPool', () => {
  it('caps concurrent connections at poolMax — a second getConnection waits', async () => {
    const pool = createExecPool(cfg(1), { connect: async () => makeConn() });
    const c1 = await pool.getConnection();
    let resolved = false;
    const p2 = pool.getConnection().then((c) => { resolved = true; return c; });
    await tick();
    expect(resolved).toBe(false);
    await c1.close();
    const c2 = await p2;
    expect(resolved).toBe(true);
    expect(c2).toBeDefined();
  });

  it('rejects a queued getConnection at queueTimeoutMs', async () => {
    vi.useFakeTimers();
    const pool = createExecPool(cfg(1, 500), { connect: async () => makeConn() });
    await pool.getConnection(); // holds the only slot
    const waiting = pool.getConnection();
    const assertion = expect(waiting).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('returns the slot after close({ drop: true })', async () => {
    const pool = createExecPool(cfg(1), { connect: async () => makeConn() });
    const c1 = await pool.getConnection();
    await c1.close({ drop: true });
    expect(c1.lastCloseArgs).toEqual({ drop: true });
    let resolved = false;
    pool.getConnection().then(() => { resolved = true; });
    await tick();
    expect(resolved).toBe(true); // slot was free, no wait needed
  });

  it('a double close releases only once — the cap still holds afterwards', async () => {
    const pool = createExecPool(cfg(1), { connect: async () => makeConn() });
    const c1 = await pool.getConnection();
    await c1.close();
    await c1.close().catch(() => {}); // real driver rejects the second close; callers often swallow it
    const c2 = await pool.getConnection(); // one slot was freed by the (single) release — this succeeds
    let resolved = false;
    pool.getConnection().then(() => { resolved = true; });
    await tick();
    expect(resolved).toBe(false); // a second release would have wrongly freed a slot for this one too
    expect(c2).toBeDefined();
  });

  it('a failed connect returns the slot', async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('ORA-01017: invalid username/password; logon denied'))
      .mockResolvedValue(makeConn());
    const pool = createExecPool(cfg(1), { connect });
    await expect(pool.getConnection()).rejects.toThrow(/ORA-01017/);
    let resolved = false;
    pool.getConnection().then(() => { resolved = true; });
    await tick();
    expect(resolved).toBe(true); // the failed attempt did not leak the slot
  });

  it('close() rejects a queued waiter and later getConnection() calls', async () => {
    const pool = createExecPool(cfg(1), { connect: async () => makeConn() });
    const c1 = await pool.getConnection(); // holds the only slot
    const waiting = pool.getConnection();
    const waitingAssertion = expect(waiting).rejects.toThrow(/closing/);
    await pool.close();
    await waitingAssertion;
    expect(c1.closed).toBe(true); // tracked live connections are closed on shutdown
    await expect(pool.getConnection()).rejects.toThrow(/closed/);
  });
});
