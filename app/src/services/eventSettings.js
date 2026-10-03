// app/src/services/eventSettings.js
// The live event code and instructor password. Start from .env (EVENT_CODE, ADMIN_PASSWORD);
// the instructor can change either from the admin page, and the change is saved in the control
// table lab_settings so it survives restarts. A changed password is stored as a salted scrypt
// hash, never in clear.
import crypto from 'node:crypto';

const equal = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  `scrypt$${salt}$${crypto.scryptSync(String(password), salt, 32).toString('hex')}`;
const verify = (password, stored) => {
  const [, salt, digest] = String(stored).split('$');
  return equal(hash(password, salt).split('$')[2], digest);
};

export const newEventCode = () => `CMP${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
export const MIN_PASSWORD = 12;

export class EventSettings {
  #code; #password; #passwordHash = null; #store;

  // store: { get(): Promise<{name: value}>, set(name, value): Promise } (the control table), or
  // null for a store-less settings object (unit tests, solo mode).
  constructor({ cfg, store = null }) {
    this.#code = cfg.event.code;
    this.#password = cfg.event.adminPassword;
    this.#store = store;
  }

  async load() {
    if (!this.#store) return this;
    const s = await this.#store.get();
    if (s.event_code) this.#code = s.event_code;
    if (s.admin_password_hash) this.#passwordHash = s.admin_password_hash;
    return this;
  }

  get code() { return this.#code; }

  checkPassword(password) {
    if (this.#passwordHash) return verify(password ?? '', this.#passwordHash);
    return Boolean(this.#password) && equal(password ?? '', this.#password);
  }

  async setCode(code) {
    if (!/^[A-Za-z0-9-]{4,24}$/.test(code)) throw Object.assign(new Error('the event code must be 4 to 24 letters, digits or dashes'), { status: 400 });
    if (this.#store) await this.#store.set('event_code', code);
    this.#code = code;
    return code;
  }

  async setPassword(current, next) {
    if (!this.checkPassword(current)) throw Object.assign(new Error('the current password is wrong'), { status: 403 });
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) throw Object.assign(new Error(`the new password needs at least ${MIN_PASSWORD} characters`), { status: 400 });
    const h = hash(next);
    if (this.#store) await this.#store.set('admin_password_hash', h);
    this.#passwordHash = h;
  }
}
