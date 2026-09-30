import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testConfig } from './env.js';
import { bootstrap, createPools, executeSql } from '../../src/db/oracle.js';
import { MongoPool, runMongo, mongoUri } from '../../src/db/mongo.js';
import { parseMongoCommand } from '../../src/content/mongoCommand.js';

const cfg = testConfig();
const sqlOpts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
const mOpts = { timeoutMs: 10000, maxRows: 500, maxBytes: 1048576 };
let pools; let conn; let mongo; let client;
const run = (text) => runMongo(client, 'CMP_USER', parseMongoCommand(text), mOpts);

beforeAll(async () => {
  await bootstrap(cfg);
  pools = await createPools(cfg);
  conn = await pools.exec.getConnection({ user: cfg.db.cmpUser, password: cfg.db.cmpPassword });
  await executeSql(conn, 'DROP TABLE lab_it_docs PURGE', sqlOpts);
  await executeSql(conn, 'CREATE JSON COLLECTION TABLE lab_it_docs', sqlOpts);
  mongo = new MongoPool(cfg);
  client = mongo.client(cfg.db.cmpUser, cfg.db.cmpPassword);
});
afterAll(async () => {
  await mongo?.closeAll();
  await executeSql(conn, 'DROP TABLE lab_it_docs PURGE', sqlOpts);
  await conn?.close();
  await pools?.close();
});

describe('mongo layer', () => {
  it('builds the same URI shape run.sh uses', () => {
    expect(mongoUri({ host: 'oracle', port: 27017, user: 'WS_ABC', password: 'p@ss' }))
      .toBe('mongodb://WS_ABC:p%40ss@oracle:27017/WS_ABC?authMechanism=PLAIN&authSource=$external&retryWrites=false&loadBalanced=true');
  });
  it('inserts, finds and counts', async () => {
    expect(await run('db.lab_it_docs.insertMany([{_id:"a", n:1},{_id:"b", n:2},{_id:"c", n:3}])')).toMatchObject({ kind: 'write' });
    const r = await run('db.lab_it_docs.find({n:{$gte:2}}).sort({n:-1})');
    expect(r.kind).toBe('docs');
    expect(r.docs.map((d) => d._id)).toEqual(['c', 'b']);
    expect(await run('db.lab_it_docs.countDocuments({})')).toMatchObject({ kind: 'count', count: 3 });
  });
  it('updates and reads back with findOne', async () => {
    await run('db.lab_it_docs.updateOne({_id:"a"}, {$set:{n:10}})');
    const r = await run('db.lab_it_docs.findOne({_id:"a"})');
    expect(r.docs[0].n).toBe(10);
  });
  it('runs $sql in an aggregation pipeline over the wire', async () => {
    const r = await run('db.aggregate([{ $sql: `select 1 as "one" from dual` }])');
    expect(r.kind).toBe('docs');
    expect(r.docs[0].one).toBe(1);
  });
  it('lists collections', async () => {
    const r = await run('show collections');
    expect(r.kind).toBe('collections');
    expect(r.names.map((n) => n.toLowerCase())).toContain('lab_it_docs');
  });
  it('returns errors instead of throwing', async () => {
    const r = await run('db.aggregate([{ $sql: `select * from no_such_table_xyz` }])');
    expect(r.kind).toBe('error');
    expect(r.error).toBeTruthy();
  });
  it('caps documents at maxRows', async () => {
    const r = await runMongo(client, 'CMP_USER', parseMongoCommand('db.lab_it_docs.find({})'), { ...mOpts, maxRows: 2 });
    expect(r.docs).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
});
