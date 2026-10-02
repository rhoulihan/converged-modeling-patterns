// app/src/services/failureLimit.js
// Counts FAILED attempts per key (a client address) in a sliding window. Successful sign-ins
// never count, so a room behind one NAT is not locked out by its own attendees; a key that
// reaches `max` failures is refused until its oldest failure leaves the window.
export class FailureLimit {
  constructor({ max = 10, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    this.max = max; this.windowMs = windowMs; this.now = now;
    this.hits = new Map();   // key -> failure timestamps, oldest first
  }

  #recent(key) {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }

  // Seconds until `key` may try again, or 0 if it is not blocked.
  retryAfter(key) {
    const list = this.#recent(key);
    return list.length < this.max ? 0 : Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  fail(key) {
    const list = this.#recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 10000) this.hits.delete(this.hits.keys().next().value);   // bound memory
  }
}
