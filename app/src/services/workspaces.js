// app/src/services/workspaces.js
import oracledb from 'oracledb';

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
}
