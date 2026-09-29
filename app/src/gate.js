export class GateError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const busy = () => new GateError('busy', 429, 'busy, retry');
const paused = () => new GateError('paused', 423, 'paused by instructor');

export class Gate {
  #permits;
  #free;
  #queueTimeoutMs;
  #queue = [];
  #running = new Map();
  #paused = false;
  #seq = 0;

  constructor({ permits = 1, queueTimeoutMs = 30000 } = {}) {
    if (!Number.isInteger(permits) || permits < 1) throw new Error('permits must be >= 1');
    this.#permits = permits;
    this.#free = permits;
    this.#queueTimeoutMs = queueTimeoutMs;
  }

  run(who, fn) {
    if (this.#paused) return Promise.reject(paused());
    if (this.#queue.some((e) => e.userId === who.userId)) {
      return Promise.reject(new GateError('already_queued', 409, 'already queued — wait for your previous request'));
    }
    const weight = who.exclusive ? this.#permits : 1;
    return new Promise((resolve, reject) => {
      const entry = { id: ++this.#seq, userId: who.userId, label: who.label, weight, fn, resolve, reject, enqueuedAt: Date.now() };
      entry.timer = setTimeout(() => {
        const i = this.#queue.indexOf(entry);
        if (i !== -1) {
          this.#queue.splice(i, 1);
          reject(busy());
          this.#pump();
        }
      }, this.#queueTimeoutMs);
      this.#queue.push(entry);
      this.#pump();
    });
  }

  #pump() {
    while (this.#queue.length && this.#queue[0].weight <= this.#free) {
      const e = this.#queue.shift();
      clearTimeout(e.timer);
      this.#free -= e.weight;
      const ctx = {};
      this.#running.set(e.id, { id: e.id, userId: e.userId, label: e.label, startedAt: Date.now(), ctx });
      Promise.resolve()
        .then(() => e.fn(ctx))
        .then(e.resolve, e.reject)
        .finally(() => {
          this.#running.delete(e.id);
          this.#free += e.weight;
          this.#pump();
        });
    }
  }

  position(userId) {
    const i = this.#queue.findIndex((e) => e.userId === userId);
    return i === -1 ? null : i;
  }

  status() {
    const now = Date.now();
    return {
      permits: this.#permits,
      free: this.#free,
      paused: this.#paused,
      queued: this.#queue.map((e) => ({ userId: e.userId, label: e.label, waitingMs: now - e.enqueuedAt })),
      running: [...this.#running.values()].map((r) => ({ id: r.id, userId: r.userId, label: r.label, elapsedMs: now - r.startedAt })),
    };
  }

  pause(on) {
    this.#paused = Boolean(on);
    if (this.#paused) {
      for (const e of this.#queue.splice(0)) {
        clearTimeout(e.timer);
        e.reject(paused());
      }
    }
  }

  // Sets ctx.cancelled (statement loops check it before each statement) and calls the
  // operation's cancel hook. Returns whether the operation had a hook to stop it.
  cancel(id) {
    const r = this.#running.get(id);
    if (!r) return false;
    r.ctx.cancelled = true;
    if (typeof r.ctx.cancel !== 'function') return false;
    r.ctx.cancel();
    return true;
  }
}
