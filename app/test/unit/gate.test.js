import { describe, it, expect, vi, afterEach } from 'vitest';
import { Gate, GateError } from '../../src/gate.js';

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => vi.useRealTimers());

describe('Gate', () => {
  it('runs one operation at a time with one permit', async () => {
    const g = new Gate({ permits: 1 });
    let active = 0; let max = 0;
    const d = [deferred(), deferred(), deferred()];
    const ps = d.map((x, i) => g.run({ userId: `u${i}`, label: 'q' }, async () => { active++; max = Math.max(max, active); await x.p; active--; return i; }));
    await tick();
    expect(active).toBe(1);
    d.forEach((x) => x.resolve());
    expect(await Promise.all(ps)).toEqual([0, 1, 2]);
    expect(max).toBe(1);
  });

  it('runs up to N operations at once with N permits, and no more', async () => {
    const g = new Gate({ permits: 4 });
    let running = 0; let peak = 0;
    const work = () => g.run({ userId: `u${Math.random()}`, label: 't' }, async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    });
    await Promise.all(Array.from({ length: 10 }, work));
    expect(peak).toBe(4);
  });

  it('is first-in first-out across users', async () => {
    const g = new Gate({ permits: 1 });
    const order = [];
    const hold = deferred();
    const first = g.run({ userId: 'a', label: 'q' }, async () => { await hold.p; order.push('a'); });
    const rest = ['b', 'c', 'd'].map((u) => g.run({ userId: u, label: 'q' }, async () => { order.push(u); }));
    hold.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('makes an exclusive request wait for every permit and blocks later requests', async () => {
    const g = new Gate({ permits: 2 });
    const order = []; const holdA = deferred();
    const a = g.run({ userId: 'a', label: 'n' }, async () => { order.push('a+'); await holdA.p; order.push('a-'); });
    const x = g.run({ userId: 'x', label: 'm', exclusive: true }, async () => { order.push('x'); });
    const b = g.run({ userId: 'b', label: 'n' }, async () => { order.push('b'); });
    await tick();
    expect(order).toEqual(['a+']);
    holdA.resolve();
    await Promise.all([a, x, b]);
    expect(order).toEqual(['a+', 'a-', 'x', 'b']);
  });

  it('allows only one queued request per user', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    const running = g.run({ userId: 'u1', label: 'q' }, () => hold.p);
    const queued = g.run({ userId: 'u2', label: 'q' }, async () => 'ok');
    await expect(g.run({ userId: 'u2', label: 'q' }, async () => 'dup')).rejects.toMatchObject({ code: 'already_queued', status: 409 });
    const u1Again = g.run({ userId: 'u1', label: 'q' }, async () => 'u1-second'); // u1 is running, not queued
    hold.resolve();
    expect(await queued).toBe('ok');
    expect(await u1Again).toBe('u1-second');
    await running;
  });

  it('rejects with busy after the queue timeout', async () => {
    vi.useFakeTimers();
    const g = new Gate({ permits: 1, queueTimeoutMs: 30000 });
    g.run({ userId: 'a', label: 'q' }, () => new Promise(() => {}));
    const waiting = g.run({ userId: 'b', label: 'q' }, async () => 'never');
    vi.advanceTimersByTime(30000);
    await expect(waiting).rejects.toMatchObject({ code: 'busy', status: 429 });
    expect(g.status().queued).toHaveLength(0);
  });

  it('pause rejects queued and new requests; resume accepts again', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    const running = g.run({ userId: 'a', label: 'q' }, () => hold.p);
    const queued = g.run({ userId: 'b', label: 'q' }, async () => 1);
    g.pause(true);
    await expect(queued).rejects.toMatchObject({ code: 'paused', status: 423 });
    await expect(g.run({ userId: 'c', label: 'q' }, async () => 1)).rejects.toBeInstanceOf(GateError);
    g.pause(false);
    hold.resolve(); await running;
    expect(await g.run({ userId: 'c', label: 'q' }, async () => 2)).toBe(2);
  });

  it('reports queue position', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    g.run({ userId: 'a', label: 'q' }, () => hold.p);
    g.run({ userId: 'b', label: 'q' }, async () => 1);
    g.run({ userId: 'c', label: 'q' }, async () => 1);
    await tick();
    expect(g.position('b')).toBe(0);
    expect(g.position('c')).toBe(1);
    expect(g.position('a')).toBe(null);
    hold.resolve();
  });

  it('releases the permit when the operation throws', async () => {
    const g = new Gate({ permits: 1 });
    await expect(g.run({ userId: 'a', label: 'q' }, async () => { throw new Error('ORA-00942'); })).rejects.toThrow('ORA-00942');
    expect(await g.run({ userId: 'b', label: 'q' }, async () => 'next')).toBe('next');
  });

  it('cancel calls the running operation cancel hook', async () => {
    const g = new Gate({ permits: 1 });
    const cancel = vi.fn();
    const hold = deferred();
    const p = g.run({ userId: 'a', label: 'q' }, (ctx) => { ctx.cancel = () => { cancel(); hold.reject(new Error('cancelled')); }; return hold.p; });
    await tick();
    const [{ id }] = g.status().running;
    expect(g.cancel(id)).toBe(true);
    await expect(p).rejects.toThrow('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancel sets ctx.cancelled for statement loops to check', async () => {
    const g = new Gate({ permits: 1 });
    const hold = deferred();
    let seen;
    const p = g.run({ userId: 'a', label: 'q' }, async (ctx) => { ctx.cancel = () => {}; await hold.p; seen = ctx.cancelled; });
    await tick();
    const [{ id }] = g.status().running;
    expect(g.cancel(id)).toBe(true);
    hold.resolve();
    await p;
    expect(seen).toBe(true);
  });
});
