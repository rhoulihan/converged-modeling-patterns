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
  const FIG = /^[a-z0-9-]+\.svg$/;
  const tabHelp = (t, k) => {
    if (t == null) return undefined;
    if (t.figure != null && !FIG.test(String(t.figure))) throw new Error(`${file}: help.tabs.${k}.figure must be a plain .svg name`);
    return { why: t.why ? String(t.why) : null, look: t.look ? String(t.look) : null,
      figure: t.figure ? { file: String(t.figure), caption: t.caption ? String(t.caption) : null } : null };
  };
  const tabs = {};
  for (const k of ['document', 'converged', 'mongo', 'measure']) {
    const v = tabHelp(fm.help?.tabs?.[k], k);
    if (v) tabs[k] = v;
  }
  let measure = null;
  if (fm.measure) {
    const cal = (fm.measure.calibration ?? []).map((c) => ({ x: Number(c.x), ratio: Number(c.ratio) }));
    if (cal.length < 4 || cal.some((c) => !(c.x > 0) || !(c.ratio > 0))) throw new Error(`${file}: measure.calibration needs ≥ 4 points with x > 0 and ratio > 0`);
    cal.sort((a, b) => a.x - b.x);
    if (typeof fm.measure.x_label !== 'string' || !fm.measure.x_label.trim()) throw new Error(`${file}: measure.x_label must be a non-empty string`);
    const labX = Number(fm.measure.lab_x);
    if (!(labX >= cal[0].x && labX <= cal[cal.length - 1].x)) throw new Error(`${file}: measure.lab_x must lie inside the calibrated x range`);
    measure = { xLabel: String(fm.measure.x_label), labX, deckSlides: String(fm.measure.deck_slides ?? fm.deck), calibration: cal };
  }
  return {
    title: String(fm.title),
    industry: String(fm.industry),
    deck: String(fm.deck),
    problem: String(fm.problem).trim(),
    knobs: fm.knobs.map((k) => ({ name: String(k.name), setting: String(k.setting), hot: k.hot === true, help: k.help ? String(k.help) : null })),
    help: { tabs },
    measure,
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
