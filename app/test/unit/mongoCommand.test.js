import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { parseMongoCommand, MongoParseError } from '../../src/content/mongoCommand.js';

describe('parseMongoCommand', () => {
  it('parses a collection findOne with an unquoted-key filter', () => {
    expect(parseMongoCommand('db.xr_client_dv.findOne({_id: "C-001"});')).toEqual({
      kind: 'collection', collection: 'xr_client_dv', op: 'findOne', args: [{ _id: 'C-001' }], mods: {},
    });
  });
  it('parses db.aggregate with a multi-line $sql template literal and .toArray()', () => {
    const c = parseMongoCommand('db.aggregate([{ $sql: `select machine_id\n  from bk_sensor_readings` }]).toArray()');
    expect(c.kind).toBe('db');
    expect(c.op).toBe('aggregate');
    expect(c.args[0][0].$sql).toContain('from bk_sensor_readings');
  });
  it('collects sort/limit/skip modifiers on find', () => {
    const c = parseMongoCommand('db.c.find({a:{$gt:-1}}).sort({a:-1}).skip(2).limit(5)');
    expect(c.args).toEqual([{ a: { $gt: -1 } }]);
    expect(c.mods).toEqual({ sort: { a: -1 }, skip: 2, limit: 5 });
  });
  it('supports getCollection, regex, ISODate and ObjectId', () => {
    const c = parseMongoCommand('db.getCollection("x").find({n:/^A/i, d:{$gte:ISODate("2026-08-01T00:00:00Z")}, o:ObjectId("65f000000000000000000001")})');
    expect(c.collection).toBe('x');
    expect(c.args[0].n).toBeInstanceOf(RegExp);
    expect(c.args[0].d.$gte).toBeInstanceOf(Date);
    expect(c.args[0].o).toBeInstanceOf(ObjectId);
  });
  it('parses show collections', () => {
    expect(parseMongoCommand('show collections')).toEqual({ kind: 'showCollections' });
  });
  it.each([
    ['db.c.drop()', /unsupported operation/],
    ['db.c.find({a: `${x}`})', /template/],
    ['db.c.find(process.exit())', /unsupported syntax/],
    ['db.c.find({}); db.c.find({})', /one command/],
    ['require("fs")', /db\.<collection>/],
    ['db.c.findOne({}).limit(1)', /only apply to find/],
    ['db.c.find({...x})', /unsupported/],
  ])('rejects %s', (text, msg) => {
    expect(() => parseMongoCommand(text)).toThrow(MongoParseError);
    expect(() => parseMongoCommand(text)).toThrow(msg);
  });
});
