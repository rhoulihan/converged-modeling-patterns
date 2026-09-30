import { sqlStageText } from './cache.js';

// Defence in depth only: the isolation boundary is each attendee's schema privileges.
const RULES = [
  [/\bALTER SYSTEM\b/, 'ALTER SYSTEM'],
  [/\bALTER DATABASE\b/, 'ALTER DATABASE'],
  [/\b(CREATE|ALTER|DROP) USER\b/, 'CREATE/ALTER/DROP USER'],
  [/\bGRANT\b/, 'GRANT'],
  [/\bREVOKE\b/, 'REVOKE'],
  [/\bDATABASE LINK\b/, 'DATABASE LINK'],
  [/\bDBMS_SCHEDULER\b/, 'DBMS_SCHEDULER'],
  [/\bDBMS_JOB\b/, 'DBMS_JOB'],
  [/\bUTL_[A-Z_]+/, 'UTL_* packages'],
  [/\bDBMS_PIPE\b/, 'DBMS_PIPE'],
  [/\bCREATE (OR REPLACE )?DIRECTORY\b/, 'CREATE DIRECTORY'],
];

export function normalizeForGuard(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifySql(text) {
  const n = normalizeForGuard(text);
  if (!n) return { allowed: false, reason: 'Empty statement' };
  for (const [re, label] of RULES) if (re.test(n)) return { allowed: false, reason: `Blocked in this lab: ${label}` };
  return { allowed: true };
}

function sqlStages(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => sqlStages(v, out));
  else if (value && typeof value === 'object' && !(value instanceof RegExp) && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      const sql = k === '$sql' ? sqlStageText(v) : null;
      if (sql !== null) out.push(sql); // string form, or the object form's `statement`
      else sqlStages(v, out);
    }
  }
  return out;
}

export function classifyMongo(cmd) {
  for (const sql of sqlStages(cmd.args ?? [])) {
    const r = classifySql(sql);
    if (!r.allowed) return r;
  }
  return { allowed: true };
}
