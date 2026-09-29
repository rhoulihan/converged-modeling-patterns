import * as acorn from 'acorn';
import { ObjectId } from 'mongodb';

export class MongoParseError extends Error {}

const COLL_OPS = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'insertOne', 'insertMany',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany']);
const CURSOR_MODS = new Set(['sort', 'limit', 'skip', 'toArray']);

const fail = (node, msg) => new MongoParseError(node && node.start !== undefined ? `${msg} (at char ${node.start})` : msg);

function lit(node) {
  switch (node.type) {
    case 'Literal':
      return node.regex ? new RegExp(node.regex.pattern, node.regex.flags) : node.value;
    case 'TemplateLiteral':
      if (node.expressions.length) throw fail(node, 'template literals with ${…} are not supported');
      return node.quasis.map((q) => q.value.cooked).join('');
    case 'ArrayExpression':
      return node.elements.map((el) => {
        if (!el || el.type === 'SpreadElement') throw fail(node, 'unsupported array element');
        return lit(el);
      });
    case 'ObjectExpression': {
      const o = {};
      for (const p of node.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) throw fail(p, 'unsupported object property');
        o[p.key.type === 'Identifier' ? p.key.name : String(p.key.value)] = lit(p.value);
      }
      return o;
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return -node.argument.value;
      break;
    case 'NewExpression':
    case 'CallExpression': {
      const name = node.callee.type === 'Identifier' ? node.callee.name : null;
      if (name === 'Date' || name === 'ISODate') {
        const a = node.arguments.map(lit);
        return a.length ? new Date(a[0]) : new Date();
      }
      if (name === 'ObjectId') return new ObjectId(lit(node.arguments[0]));
      break;
    }
    default:
      break;
  }
  throw fail(node, `unsupported syntax: ${node.type}`);
}

const prop = (m) => (m.computed ? (m.property.type === 'Literal' ? String(m.property.value) : null) : m.property.name);
const isDb = (n) => n.type === 'Identifier' && n.name === 'db';

function collectionName(n) {
  if (n.type === 'MemberExpression' && isDb(n.object)) return prop(n);
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && isDb(n.callee.object) && prop(n.callee) === 'getCollection') {
    return lit(n.arguments[0]);
  }
  return null;
}

export function parseMongoCommand(text) {
  const src = String(text).trim().replace(/;\s*$/, '');
  if (/^show\s+collections$/i.test(src)) return { kind: 'showCollections' };
  let expr;
  try {
    expr = acorn.parseExpressionAt(src, 0, { ecmaVersion: 'latest' });
  } catch (e) {
    throw new MongoParseError(`could not parse: ${e.message}`);
  }
  if (src.slice(expr.end).trim()) throw new MongoParseError('only one command at a time');
  const shapeErr = () => new MongoParseError('expected db.<collection>.<operation>(…) or db.aggregate([…])');

  const mods = {};
  let node = expr;
  while (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && CURSOR_MODS.has(prop(node.callee))) {
    const name = prop(node.callee);
    if (name !== 'toArray') mods[name] = lit(node.arguments[0]);
    node = node.callee.object;
  }
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') throw shapeErr();
  const op = prop(node.callee);
  const target = node.callee.object;
  const args = node.arguments.map(lit);
  if (isDb(target)) {
    if (op !== 'aggregate') throw new MongoParseError(`unsupported operation db.${op}`);
    return { kind: 'db', op, args, mods };
  }
  const collection = collectionName(target);
  if (!collection) throw shapeErr();
  if (!COLL_OPS.has(op)) throw new MongoParseError(`unsupported operation ${op}`);
  if (Object.keys(mods).length && op !== 'find') throw new MongoParseError('sort/limit/skip only apply to find');
  return { kind: 'collection', collection, op, args, mods };
}
