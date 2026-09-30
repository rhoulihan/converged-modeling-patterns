import { describe, it, expect } from 'vitest';
import { runMongo } from '../../src/db/mongo.js';
import { parseMongoCommand } from '../../src/content/mongoCommand.js';

// The Oracle API for MongoDB does not honour maxTimeMS at all (verified against the
// live cmp-oracle container: a 1-second $sql aggregate and a listCollections both
// completed successfully with maxTimeMS: 1 passed straight through the driver — no
// timeout error). So the timing-based integration test the review suggested would be
// flaky-or-always-pass, not a real assertion. Instead these tests stub the driver and
// assert the *options object actually handed to it*: the system timeoutMs must always
// win over any maxTimeMS a user supplies in their command's options literal, on every
// path that accepts one (db.aggregate, collection aggregate, updateOne, updateMany,
// listCollections) — this is the actual line of defence for the single-permit gate.

function fakeCursor(docs = []) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: async () => (i < docs.length ? { value: docs[i++], done: false } : { value: undefined, done: true }) };
    },
    close: async () => {},
  };
}

function fakeClient(capture) {
  const coll = {
    aggregate(pipeline, opts) { capture.collAggregate = opts; return fakeCursor(); },
    updateOne(filter, update, opts) { capture.updateOne = opts; return Promise.resolve({ matchedCount: 0, modifiedCount: 0 }); },
    updateMany(filter, update, opts) { capture.updateMany = opts; return Promise.resolve({ matchedCount: 0, modifiedCount: 0 }); },
    find() { return fakeCursor(); },
    findOne: async () => null,
    countDocuments: async () => 0,
    insertOne: async () => ({ acknowledged: true }),
    insertMany: async () => ({ acknowledged: true }),
    deleteOne: async () => ({ acknowledged: true }),
    deleteMany: async () => ({ acknowledged: true }),
  };
  const db = {
    listCollections(filter, opts) { capture.listCollections = opts; return { toArray: async () => [] }; },
    aggregate(pipeline, opts) { capture.dbAggregate = opts; return fakeCursor(); },
    collection() { return coll; },
  };
  return { db: () => db };
}

const opts = { timeoutMs: 5, maxRows: 500, maxBytes: 1048576 };

describe('runMongo enforces the system maxTimeMS cap', () => {
  it('forces maxTimeMS on db.aggregate, overriding a larger user-supplied value', async () => {
    const capture = {};
    const client = fakeClient(capture);
    await runMongo(client, 'CMP_USER', parseMongoCommand('db.aggregate([{ $sql: `select 1 from dual` }], { maxTimeMS: 600000 })'), opts);
    expect(capture.dbAggregate.maxTimeMS).toBe(5);
  });

  it('forces maxTimeMS on collection aggregate, overriding a larger user-supplied value', async () => {
    const capture = {};
    const client = fakeClient(capture);
    await runMongo(client, 'CMP_USER', parseMongoCommand('db.lab_it_docs.aggregate([{$match:{}}], { maxTimeMS: 600000 })'), opts);
    expect(capture.collAggregate.maxTimeMS).toBe(5);
  });

  it('forces maxTimeMS on updateOne, overriding a larger user-supplied value', async () => {
    const capture = {};
    const client = fakeClient(capture);
    await runMongo(client, 'CMP_USER', parseMongoCommand('db.lab_it_docs.updateOne({_id:"a"}, {$set:{n:1}}, { maxTimeMS: 600000 })'), opts);
    expect(capture.updateOne.maxTimeMS).toBe(5);
  });

  it('forces maxTimeMS on updateMany, overriding a larger user-supplied value', async () => {
    const capture = {};
    const client = fakeClient(capture);
    await runMongo(client, 'CMP_USER', parseMongoCommand('db.lab_it_docs.updateMany({}, {$set:{n:1}}, { maxTimeMS: 600000 })'), opts);
    expect(capture.updateMany.maxTimeMS).toBe(5);
  });

  it('sets maxTimeMS on show collections (listCollections)', async () => {
    const capture = {};
    const client = fakeClient(capture);
    await runMongo(client, 'CMP_USER', parseMongoCommand('show collections'), opts);
    expect(capture.listCollections.maxTimeMS).toBe(5);
  });
});
