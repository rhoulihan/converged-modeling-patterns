// app/src/db/mongo.js
import { performance } from 'node:perf_hooks';
import { MongoClient, BSON } from 'mongodb';

const IDLE_MS = 5 * 60 * 1000;

export function mongoUri({ host, port, user, password }) {
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `mongodb://${u}:${p}@${host}:${port}/${user.toUpperCase()}?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true`;
}

export class MongoPool {
  #cfg;
  #clients = new Map();

  constructor(cfg) {
    this.#cfg = cfg;
  }

  client(user, password) {
    const key = user.toUpperCase();
    let e = this.#clients.get(key);
    if (!e) {
      const c = new MongoClient(mongoUri({ host: this.#cfg.mongo.host, port: this.#cfg.mongo.port, user: key, password }), {
        maxPoolSize: this.#cfg.mongo.poolMax,
      });
      e = { client: c, timer: null };
      this.#clients.set(key, e);
    }
    clearTimeout(e.timer);
    e.timer = setTimeout(() => this.drop(key), IDLE_MS);
    e.timer.unref?.();
    return e.client;
  }

  async drop(user) {
    const key = user.toUpperCase();
    const e = this.#clients.get(key);
    if (!e) return;
    this.#clients.delete(key);
    clearTimeout(e.timer);
    await e.client.close(true).catch(() => {});
  }

  async closeAll() {
    await Promise.all([...this.#clients.keys()].map((k) => this.drop(k)));
  }
}

const toJson = (doc) => BSON.EJSON.serialize(doc, { relaxed: true });

async function take(cursor, maxRows, maxBytes) {
  const docs = [];
  let truncated = false;
  for await (const d of cursor) {
    if (docs.length === maxRows) { truncated = true; break; }
    docs.push(toJson(d));
  }
  await cursor.close();
  while (docs.length && JSON.stringify(docs).length > maxBytes) {
    docs.splice(Math.floor(docs.length * 0.8));
    truncated = true;
  }
  return { docs, truncated };
}

export async function runMongo(client, dbName, cmd, { timeoutMs, maxRows, maxBytes }) {
  const start = performance.now();
  const elapsedMs = () => Math.round(performance.now() - start);
  const db = client.db(dbName);
  const o = { maxTimeMS: timeoutMs };
  try {
    if (cmd.kind === 'showCollections') {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
      return { kind: 'collections', names, elapsedMs: elapsedMs() };
    }
    if (cmd.kind === 'db') {
      const { docs, truncated } = await take(db.aggregate(cmd.args[0] ?? [], { ...o, ...(cmd.args[1] ?? {}) }), maxRows, maxBytes);
      return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
    }
    const coll = db.collection(cmd.collection);
    const [a0 = {}, a1, a2] = cmd.args;
    switch (cmd.op) {
      case 'find': {
        let cur = coll.find(a0, { ...o, ...(a1 ? { projection: a1 } : {}) });
        if (cmd.mods.sort) cur = cur.sort(cmd.mods.sort);
        if (cmd.mods.skip) cur = cur.skip(cmd.mods.skip);
        cur = cur.limit(Math.min(cmd.mods.limit ?? maxRows + 1, maxRows + 1));
        const { docs, truncated } = await take(cur, maxRows, maxBytes);
        return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
      }
      case 'findOne': {
        const d = await coll.findOne(a0, { ...o, ...(a1 ? { projection: a1 } : {}) });
        return { kind: 'docs', docs: d ? [toJson(d)] : [], count: d ? 1 : 0, truncated: false, elapsedMs: elapsedMs() };
      }
      case 'aggregate': {
        const { docs, truncated } = await take(coll.aggregate(a0, { ...o, ...(a1 ?? {}) }), maxRows, maxBytes);
        return { kind: 'docs', docs, count: docs.length, truncated, elapsedMs: elapsedMs() };
      }
      case 'countDocuments':
        return { kind: 'count', count: await coll.countDocuments(a0, o), elapsedMs: elapsedMs() };
      case 'insertOne': return { kind: 'write', result: toJson(await coll.insertOne(a0, o)), elapsedMs: elapsedMs() };
      case 'insertMany': return { kind: 'write', result: toJson(await coll.insertMany(a0, o)), elapsedMs: elapsedMs() };
      case 'updateOne': return { kind: 'write', result: toJson(await coll.updateOne(a0, a1, { ...o, ...(a2 ?? {}) })), elapsedMs: elapsedMs() };
      case 'updateMany': return { kind: 'write', result: toJson(await coll.updateMany(a0, a1, { ...o, ...(a2 ?? {}) })), elapsedMs: elapsedMs() };
      case 'deleteOne': return { kind: 'write', result: toJson(await coll.deleteOne(a0, o)), elapsedMs: elapsedMs() };
      case 'deleteMany': return { kind: 'write', result: toJson(await coll.deleteMany(a0, o)), elapsedMs: elapsedMs() };
      default: return { kind: 'error', error: `unsupported operation ${cmd.op}`, code: null, elapsedMs: elapsedMs() };
    }
  } catch (err) {
    return { kind: 'error', error: err.message, code: err.code ?? err.codeName ?? null, elapsedMs: elapsedMs() };
  }
}
