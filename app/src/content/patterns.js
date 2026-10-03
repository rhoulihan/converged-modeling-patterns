import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { parseSqlFile, isSetup } from './sqlParser.js';
import { parseMongoScript } from './mongoScript.js';
import { parseMongoCommand } from './mongoCommand.js';

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
    // Optional one-paragraph verdict shown at the top of the Measure it tab: what the measured
    // write means for the whole workload (e.g. which model wins the read-heavy day).
    if (fm.measure.verdict !== undefined && (typeof fm.measure.verdict !== 'string' || !fm.measure.verdict.trim())) {
      throw new Error(`${file}: measure.verdict must be a non-empty string when present`);
    }
    // Optional sizes the live sweep measures at (Measure it runs the pair once per size).
    let sizes = null;
    if (fm.measure.sizes !== undefined) {
      sizes = Array.isArray(fm.measure.sizes) ? fm.measure.sizes.map(Number) : [];
      if (sizes.length < 3 || sizes.some((n) => !Number.isInteger(n) || n <= 0) || sizes.some((n, i) => i && n <= sizes[i - 1])) {
        throw new Error(`${file}: measure.sizes must be 3 or more ascending positive integers`);
      }
    }
    measure = { xLabel: String(fm.measure.x_label), labX, deckSlides: String(fm.measure.deck_slides ?? fm.deck), calibration: cal,
      verdict: fm.measure.verdict ? fm.measure.verdict.trim() : null, sizes };
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
  // Every card carries its equivalent in the other language, so Load can fill both console tabs.
  for (const [file, cards] of [[docFile, lanes.document], [convFile, lanes.converged]]) {
    for (const s of cards) {
      if (!s.mongo) throw new Error(`${file}: card "${s.title}" needs a -- @mongo equivalent`);
      try { parseMongoCommand(s.mongo); } catch (e) { throw new Error(`${file}: card "${s.title}" @mongo: ${e.message}`); }
    }
  }
  for (const st of mongo) {
    if (!st.sql || !parseSqlFile(st.sql).length) throw new Error(`${dir}: card "${st.title}" needs a // @sql equivalent`);
  }
  if (!lanes.document.length || !lanes.converged.length) throw new Error(`${dir}: needs at least one @step in each .sql file`);
  if (!measures.length) throw new Error(`${dir}: needs at least one @measure pair`);

  // @measure-read pairs the read each model serves the same question with; the sweep counts the
  // blocks each touches at every size, so reads and writes share one unit (logical reads).
  const reads = [];
  const docReads = new Map(doc.filter((s) => s.measureRead).map((s) => [s.measureRead, s]));
  const convReads = new Map(conv.filter((s) => s.measureRead).map((s) => [s.measureRead, s]));
  for (const tag of new Set([...docReads.keys(), ...convReads.keys()])) {
    if (!docReads.has(tag) || !convReads.has(tag)) throw new Error(`${dir}: measure-read "${tag}" must appear in both 01-document-model.sql and 02-converged.sql`);
    for (const [st, f] of [[docReads.get(tag), docFile], [convReads.get(tag), convFile]]) {
      if (!/^\s*(SELECT|WITH)\b/i.test(st.sql)) throw new Error(`${f}: measure-read "${tag}" must be a SELECT`);
    }
    reads.push({ tag, document: docReads.get(tag), converged: convReads.get(tag) });
  }

  const setup = { document: doc.filter(isSetup), converged: conv.filter(isSetup) };
  // calibrate.sql resizes the measured data to :n on both sides; the live sweep runs it per size.
  const calFile = path.join(dir, 'calibrate.sql');
  const calibrate = fs.existsSync(calFile) ? parseSqlFile(fs.readFileSync(calFile, 'utf8')).map((s) => s.sql) : null;
  if (meta.measure?.sizes && !calibrate) throw new Error(`${dir}: measure.sizes needs a calibrate.sql`);
  const version = crypto.createHash('sha256')
    .update([...setup.document, ...setup.converged].map((s) => s.sql).join('\n;\n'))
    .digest('hex')
    .slice(0, 16);
  return { id, meta, lanes, setup, measures, reads, calibrate, version };
}

export function loadPatterns(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((id) => loadOne(root, id));
}
