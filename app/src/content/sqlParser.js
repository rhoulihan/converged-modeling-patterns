// Parses the validated pattern .sql files (and console input) into executable statements.
// Limitation: q'[...]' literals and multi-line /* */ comments inside a statement are not
// supported; the pattern files use neither.
// SET TRANSACTION / SET ROLE are SQL statements, not SQL*Plus settings.
const SQLPLUS = /^(SET(?!\s+(TRANSACTION|ROLE)\b)|PROMPT|COLUMN|COL|WHENEVER|EXIT|QUIT|SPOOL|DEFINE|UNDEFINE|SHOW|TTITLE|BTITLE|BREAK|CLEAR)\b|^@/i;
const PLSQL_START = /^(BEGIN|DECLARE)\b|^CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b/i;
const ANNOT = /^--\s*@(step|note|measure-read|measure|why|look|figure)\b\s*(.*)$/i;
const FIGURE = /^([a-z0-9-]+\.svg)\s+(.+)$/;
// -- @mongo lines carry the card's MongoDB equivalent; indentation after "@mongo " is kept.
const MONGO = /^\s*--\s*@mongo\b ?(.*)$/i;

// Shared by the SQL and mongosh parsers: fold one help annotation into an accumulator.
export function addHelp(help, kind, val, where = 'annotation') {
  if (kind === 'figure') {
    const f = val.match(FIGURE);
    if (!f) throw new Error(`${where}: @figure needs "<name>.svg <caption>" with a plain file name`);
    help.figure = { file: f[1], caption: f[2].trim() };
  } else {
    help[kind] = help[kind] ? `${help[kind]} ${val}` : val;
  }
}
const emptyHelp = () => ({ why: null, look: null, figure: null });
const emptyAnno = () => ({ title: null, notes: [], measure: null, measureRead: null, help: emptyHelp(), mongo: [] });

function scanLine(line, inString) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString) {
      if (ch === "'") {
        if (line[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '-' && line[i + 1] === '-') return { end: -1, inString };
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close === -1) return { end: -1, inString };
      i = close + 1;
      continue;
    }
    if (ch === ';') return { end: i, inString };
  }
  return { end: -1, inString };
}

export function parseSqlFile(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let anno = null;
  let buf = [];
  let startLine = 0;
  let plsql = false;
  let inString = false;

  const flush = () => {
    const sql = buf.join('\n').trim();
    if (sql) {
      out.push({ sql, title: anno?.title ?? null, notes: anno?.notes ?? [], measure: anno?.measure ?? null, measureRead: anno?.measureRead ?? null,
        help: anno?.help ?? emptyHelp(), mongo: anno?.mongo.length ? anno.mongo.join('\n') : null, plsql, line: startLine });
    }
    anno = null;
    buf = [];
    plsql = false;
    inString = false;
  };

  const handle = (line, idx) => {
    const t = line.trim();
    if (buf.length === 0) {
      if (!t || t === '/') return;
      const mg = line.match(MONGO);
      if (mg) {
        anno ??= emptyAnno();
        anno.mongo.push(mg[1].trimEnd());
        return;
      }
      const a = t.match(ANNOT);
      if (a) {
        anno ??= emptyAnno();
        const kind = a[1].toLowerCase();
        const val = a[2].trim();
        if (kind === 'step') anno.title = val;
        else if (kind === 'note') anno.notes.push(val);
        else if (kind === 'measure') anno.measure = val;
        else if (kind === 'measure-read') anno.measureRead = val;
        else addHelp(anno.help, kind, val, `line ${idx + 1}`);
        return;
      }
      if (t.startsWith('--') || SQLPLUS.test(t)) return;
      startLine = idx + 1;
      plsql = PLSQL_START.test(t);
    }
    if (plsql) {
      if (t === '/') flush();
      else buf.push(line);
      return;
    }
    if (t === '/') { flush(); return; }
    const r = scanLine(line, inString);
    if (r.end >= 0) {
      buf.push(line.slice(0, r.end));
      flush();
      // Keep scanning after the ';': "SELECT 1 FROM dual; SELECT 2 FROM dual;" is two statements.
      const rest = line.slice(r.end + 1);
      if (rest.trim()) handle(rest, idx);
      return;
    }
    inString = r.inString;
    buf.push(line);
  };
  lines.forEach(handle);
  if (buf.length) flush();
  return out;
}

export const isSetup = (stmt) => stmt.title === null && stmt.measure === null;

export function splitConsoleSql(text) {
  return parseSqlFile(text).map((s) => s.sql);
}
