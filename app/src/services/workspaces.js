// app/src/services/workspaces.js
import oracledb from 'oracledb';
import crypto from 'node:crypto';

const OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const k = (schema, patternId) => `${schema}|${patternId}`;

export class Workspaces {
  cfg;
  pools;
  #dirty = new Set();
  #built = new Map();

  constructor({ cfg, pools }) {
    this.cfg = cfg;
    this.pools = pools;
  }

  async withControl(fn) {
    const c = await this.pools.control.getConnection();
    try {
      return await fn(c);
    } finally {
      await c.close();
    }
  }

  async load() {
    await this.withControl(async (c) => {
      this.#dirty.clear();
      this.#built.clear();
      (await c.execute('SELECT schema_name, pattern_id FROM lab_dirty', [], OBJ)).rows
        .forEach((r) => this.#dirty.add(k(r.SCHEMA_NAME, r.PATTERN_ID)));
      (await c.execute('SELECT schema_name, pattern_id, version FROM lab_built', [], OBJ)).rows
        .forEach((r) => this.#built.set(k(r.SCHEMA_NAME, r.PATTERN_ID), r.VERSION));
    });
  }

  solo() {
    return { userId: 'solo', schema: this.cfg.db.cmpUser, password: this.cfg.db.cmpPassword };
  }

  isDirty(schema, patternId) {
    return this.#dirty.has(k(schema, patternId));
  }

  async markDirty(schema, patternIds) {
    const add = patternIds.filter((p) => !this.isDirty(schema, p));
    if (!add.length) return;
    await this.withControl((c) => c.executeMany(
      `MERGE INTO lab_dirty d USING (SELECT :s AS s, :p AS p FROM dual) x
         ON (d.schema_name = x.s AND d.pattern_id = x.p)
       WHEN NOT MATCHED THEN INSERT (schema_name, pattern_id) VALUES (x.s, x.p)`,
      add.map((p) => ({ s: schema, p })), { autoCommit: true }));
    add.forEach((p) => this.#dirty.add(k(schema, p)));
  }

  async clearDirty(schema, patternId) {
    await this.withControl((c) => c.execute('DELETE FROM lab_dirty WHERE schema_name = :s AND pattern_id = :p',
      { s: schema, p: patternId }, { autoCommit: true }));
    this.#dirty.delete(k(schema, patternId));
  }

  builtVersion(schema, patternId) {
    return this.#built.get(k(schema, patternId)) ?? null;
  }

  async markBuilt(schema, patternId, version) {
    await this.withControl((c) => c.execute(
      `MERGE INTO lab_built b USING (SELECT :s AS s, :p AS p, :v AS v FROM dual) x
         ON (b.schema_name = x.s AND b.pattern_id = x.p)
       WHEN MATCHED THEN UPDATE SET b.version = x.v
       WHEN NOT MATCHED THEN INSERT (schema_name, pattern_id, version) VALUES (x.s, x.p, x.v)`,
      { s: schema, p: patternId, v: version }, { autoCommit: true }));
    this.#built.set(k(schema, patternId), version);
  }

  forgetInMemory(schema) {
    for (const key of [...this.#dirty]) if (key.startsWith(`${schema}|`)) this.#dirty.delete(key);
    for (const key of [...this.#built.keys()]) if (key.startsWith(`${schema}|`)) this.#built.delete(key);
  }

  async sessionSecret() {
    return this.withControl(async (c) => {
      const r = await c.execute("SELECT v FROM lab_settings WHERE k = 'session_secret'", [], OBJ);
      if (r.rows.length) return r.rows[0].V;
      const v = crypto.randomBytes(32).toString('hex');
      await c.execute(
        `MERGE INTO lab_settings s USING (SELECT 'session_secret' AS k, :v AS v FROM dual) x ON (s.k = x.k)
         WHEN NOT MATCHED THEN INSERT (k, v) VALUES (x.k, x.v)`, { v }, { autoCommit: true });
      return (await c.execute("SELECT v FROM lab_settings WHERE k = 'session_secret'", [], OBJ)).rows[0].V;
    });
  }

  #row(r) {
    return r ? { userId: r.SCHEMA_NAME, schema: r.SCHEMA_NAME, password: r.SCHEMA_PASSWORD, email: r.EMAIL, name: r.DISPLAY_NAME } : null;
  }

  async findByEmail(email) {
    return this.withControl(async (c) => this.#row((await c.execute(
      'SELECT * FROM lab_users WHERE email = :e', { e: email.trim().toLowerCase() }, OBJ)).rows[0]));
  }

  async findBySchema(schema) {
    return this.withControl(async (c) => this.#row((await c.execute(
      'SELECT * FROM lab_users WHERE schema_name = :s', { s: schema }, OBJ)).rows[0]));
  }

  async provision({ email = null, name = null } = {}) {
    const schema = `WS_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const password = `Ws${crypto.randomBytes(12).toString('hex')}`;
    await this.withControl(async (c) => {
      const ddl = [
        `CREATE USER ${schema} IDENTIFIED BY "${password}" QUOTA 50M ON users`,
        `GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE, CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH, SODA_APP TO ${schema}`,
        `GRANT SELECT ON sys.v_$mystat TO ${schema}`,
        `GRANT SELECT ON sys.v_$statname TO ${schema}`,
        `BEGIN ORDS_METADATA.ORDS_ADMIN.ENABLE_SCHEMA(p_enabled => TRUE, p_schema => '${schema}', p_url_mapping_type => 'BASE_PATH', p_url_mapping_pattern => '${schema.toLowerCase()}', p_auto_rest_auth => FALSE); COMMIT; END;`,
      ];
      for (const s of ddl) await c.execute(s);
      await c.execute(
        `INSERT INTO lab_users (schema_name, schema_password, email, display_name, assigned_at)
         VALUES (:s, :p, :e, :n, CASE WHEN :e IS NULL THEN NULL ELSE SYSTIMESTAMP END)`,
        { s: schema, p: password, e: email ? email.trim().toLowerCase() : null, n: name }, { autoCommit: true });
    });
    return { userId: schema, schema, password, email, name };
  }

  async assign({ email, name }) {
    const existing = await this.findByEmail(email);
    if (existing) return existing;
    const claimed = await this.withControl(async (c) => {
      // FOR UPDATE cannot be combined with FETCH FIRST (it is implemented via an analytic
      // ROW_NUMBER() internally, which Oracle rejects with ORA-02014, same as DISTINCT/GROUP BY).
      // An ORDER BY inside the locked inline view hits the same restriction, so this picks an
      // arbitrary unassigned row (ROWNUM = 1, no ORDER BY) rather than strictly the oldest one —
      // acceptable here since prewarmed workspaces are interchangeable.
      const r = await c.execute(
        `SELECT schema_name FROM (
           SELECT schema_name FROM lab_users WHERE email IS NULL
         ) WHERE ROWNUM = 1 FOR UPDATE SKIP LOCKED`, [], OBJ);
      if (!r.rows.length) return null;
      await c.execute('UPDATE lab_users SET email = :e, display_name = :n, assigned_at = SYSTIMESTAMP WHERE schema_name = :s',
        { e: email.trim().toLowerCase(), n: name, s: r.rows[0].SCHEMA_NAME }, { autoCommit: true });
      return r.rows[0].SCHEMA_NAME;
    });
    return claimed ? this.findBySchema(claimed) : this.provision({ email, name });
  }

  async list() {
    return this.withControl(async (c) => (await c.execute(
      `SELECT u.schema_name, u.email, u.display_name, u.created_at, u.assigned_at,
              (SELECT LISTAGG(b.pattern_id, ',') WITHIN GROUP (ORDER BY b.pattern_id) FROM lab_built b WHERE b.schema_name = u.schema_name) AS built
         FROM lab_users u ORDER BY u.created_at`, [], OBJ)).rows.map((r) => ({
      schema: r.SCHEMA_NAME, email: r.EMAIL, name: r.DISPLAY_NAME, createdAt: r.CREATED_AT, assignedAt: r.ASSIGNED_AT,
      built: r.BUILT ? r.BUILT.split(',') : [],
    })));
  }

  // End event is synchronous only up to here: every workspace is cut off immediately
  // (ACCOUNT LOCK — no new connections possible, whatever the DB session behind it is
  // doing) and moved out of lab_users (so list()/findByEmail/findBySchema stop seeing it)
  // into lab_pending_drop. The actual DROP USER happens in reapPending(), called once
  // here and then on a timer (startReaper) — some Oracle API for MongoDB sessions stay
  // open well past the client disconnecting (see task-11-report.md), so DROP USER ...
  // CASCADE can't be relied on to succeed synchronously. Returns the counts from that
  // one immediate reap pass; a still-connected workspace resolves later via the reaper.
  async dropAll(mongoPool) {
    const users = await this.list();
    await Promise.all(users.map((u) => mongoPool?.drop(u.schema)));
    await this.withControl(async (c) => {
      for (const u of users) {
        await c.execute(`ALTER USER ${u.schema} ACCOUNT LOCK`).catch((e) => { if (e.errorNum !== 1918) throw e; });
        await c.execute(
          `MERGE INTO lab_pending_drop d USING (SELECT :s AS s FROM dual) x ON (d.schema_name = x.s)
           WHEN NOT MATCHED THEN INSERT (schema_name) VALUES (x.s)`, { s: u.schema });
        await c.execute('DELETE FROM lab_dirty WHERE schema_name = :s', { s: u.schema });
        await c.execute('DELETE FROM lab_built WHERE schema_name = :s', { s: u.schema });
        await c.execute('DELETE FROM lab_users WHERE schema_name = :s', { s: u.schema });
        await c.commit();
        this.forgetInMemory(u.schema);
      }
    });
    return this.reapPending();
  }

  // One pass over lab_pending_drop: DROP USER ... CASCADE each row. ORA-01918 (user
  // already gone) counts as dropped. ORA-01940 (still connected) leaves the row in place
  // with last_error recorded, for a later pass to retry. Idempotent — a row only leaves
  // the table once its DROP actually succeeds (or the user already doesn't exist) — and
  // safe to call repeatedly/concurrently: the control pool has a single connection, so
  // calls serialize, and re-attempting a DROP that already succeeded just yields ORA-01918.
  async reapPending() {
    return this.withControl(async (c) => {
      const rows = (await c.execute('SELECT schema_name FROM lab_pending_drop', [], OBJ)).rows;
      let dropped = 0;
      for (const r of rows) {
        const schema = r.SCHEMA_NAME;
        try {
          await c.execute(`DROP USER ${schema} CASCADE`);
        } catch (e) {
          if (e.errorNum === 1940) {
            await c.execute('UPDATE lab_pending_drop SET last_error = :m WHERE schema_name = :s',
              { m: e.message.slice(0, 400), s: schema }, { autoCommit: true });
            continue;
          }
          if (e.errorNum !== 1918) throw e; // anything but "already gone" is unexpected
        }
        await c.execute('DELETE FROM lab_pending_drop WHERE schema_name = :s', { s: schema }, { autoCommit: true });
        dropped++;
      }
      return { dropped, pending: rows.length - dropped };
    });
  }

  // Background sweep for whatever reapPending() couldn't finish synchronously. Unref'd so
  // it never keeps the process alive on its own; never throws (a DB hiccup just gets
  // logged and retried on the next tick). Logs one line per pass, and only when there was
  // something to report, so a quiet lab doesn't spam the log every 30s. `runPass` wraps each
  // pass (the server routes it through the gate exclusively); a tick is skipped while the
  // previous pass is still in flight, and a gate refusal (busy/paused) is just retried next tick.
  startReaper(intervalMs = 30000, runPass = (fn) => fn()) {
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { dropped, pending } = await runPass(() => this.reapPending());
        if (dropped || pending) console.log(`[lab-ui] reapPending: dropped ${dropped}, pending ${pending}`);
      } catch (e) {
        console.error(`[lab-ui] reapPending failed: ${e.message}`);
      } finally {
        inFlight = false;
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
