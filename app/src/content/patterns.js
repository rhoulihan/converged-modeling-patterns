import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { parseSqlFile, isSetup } from './sqlParser.js';
import { parseMongoScript } from './mongoScript.js';

function frontMatter(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: missing YAML front matter block`);
  const fm = YAML.parse(m[1]);
  for (const k of ['title', 'industry', 'deck', 'problem']) {
    if (!fm?.[k]) throw new Error(`${file}: front matter needs "${k}"`);
  }
  if (!Array.isArray(fm.knobs) || fm.knobs.length !== 3) throw new Error(`${file}: front matter needs exactly 3 knobs`);
  return {
    title: String(fm.title),
    industry: String(fm.industry),
    deck: String(fm.deck),
    problem: String(fm.problem).trim(),
    knobs: fm.knobs.map((k) => ({ name: String(k.name), setting: String(k.setting), hot: k.hot === true })),
  };
}

const readSql = (p) => (fs.existsSync(p) ? parseSqlFile(fs.readFileSync(p, 'utf8')) : []);

function checkMeasure(stmt, where) {
  const ok = stmt.plsql || /^(UPDATE|INSERT|DELETE|MERGE)\b/i.test(stmt.sql);
  if (!ok) throw new Error(`${where}: measure "${stmt.measure}" must be UPDATE/INSERT/DELETE/MERGE or PL/SQL`);
  if (/\bCOMMIT\b/i.test(stmt.sql)) throw new Error(`${where}: measure "${stmt.measure}" must not COMMIT (it runs in a rolled-back transaction)`);
}

function loadOne(root, id) {
  const dir = path.join(root, id);
  const meta = frontMatter(path.join(dir, 'README.md'));
  const docFile = path.join(dir, '01-document-model.sql');
  const convFile = path.join(dir, '02-converged.sql');
  const doc = readSql(docFile);
  const conv = readSql(convFile);
  const mongo = fs.readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .sort()
    .flatMap((n) => parseMongoScript(fs.readFileSync(path.join(dir, n), 'utf8'), path.join(dir, n)));

  const measures = [];
  const docTags = new Map(doc.filter((s) => s.measure).map((s) => [s.measure, s]));
  const convTags = new Map(conv.filter((s) => s.measure).map((s) => [s.measure, s]));
  for (const tag of new Set([...docTags.keys(), ...convTags.keys()])) {
    if (!docTags.has(tag) || !convTags.has(tag)) throw new Error(`${dir}: measure "${tag}" must appear in both 01-document-model.sql and 02-converged.sql`);
    checkMeasure(docTags.get(tag), docFile);
    checkMeasure(convTags.get(tag), convFile);
    measures.push({ tag, document: docTags.get(tag), converged: convTags.get(tag) });
  }

  const lanes = { document: doc.filter((s) => s.title), converged: conv.filter((s) => s.title), mongo };
  if (!lanes.document.length || !lanes.converged.length) throw new Error(`${dir}: needs at least one @step in each .sql file`);
  if (!measures.length) throw new Error(`${dir}: needs at least one @measure pair`);

  const setup = { document: doc.filter(isSetup), converged: conv.filter(isSetup) };
  const version = crypto.createHash('sha256')
    .update([...setup.document, ...setup.converged].map((s) => s.sql).join('\n;\n'))
    .digest('hex')
    .slice(0, 16);
  return { id, meta, lanes, setup, measures, version };
}

export function loadPatterns(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((id) => loadOne(root, id));
}
