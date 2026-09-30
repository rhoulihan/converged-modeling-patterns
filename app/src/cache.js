import crypto from 'node:crypto';

export function normalizeSql(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
    .trim();
}

export function isReadOnlySql(statements) {
  if (statements.length !== 1) return false;
  const n = normalizeSql(statements[0]);
  return /^(SELECT|WITH)\b/i.test(n) && !/\bFOR\s+UPDATE\b/i.test(n);
}

const MONGO_READ_OPS = new Set(['find', 'findOne', 'countDocuments']);

// The SQL text of a $sql stage: the string form, or the object form's `statement`.
// null when the object form carries no string statement (the caller treats that as a write).
export function sqlStageText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.statement === 'string') return value.statement;
  return null;
}

export function isReadOnlyMongo(cmd) {
  if (cmd.kind === 'showCollections') return true;
  if (MONGO_READ_OPS.has(cmd.op)) return true;
  if (cmd.op !== 'aggregate') return false;
  const pipeline = cmd.args[0] ?? [];
  return pipeline.every((stage) => {
    if ('$out' in stage || '$merge' in stage) return false;
    if (!('$sql' in stage)) return true;
    const sql = sqlStageText(stage.$sql);
    return sql !== null && isReadOnlySql([sql]);
  });
}

export const PATTERN_PREFIXES = {
  xr: '01-extended-reference', cp: '02-computed', bk: '03-bucket', sb: '04-subset', tr: '05-tree-hierarchy', ol: '06-outlier',
};

export function patternsTouched(text, allIds) {
  const found = new Set();
  for (const m of String(text).matchAll(/\b(xr|cp|bk|sb|tr|ol)_\w+/gi)) {
    const id = PATTERN_PREFIXES[m[1].toLowerCase()];
    if (allIds.includes(id)) found.add(id);
  }
  return found.size ? [...found] : [...allIds];
}

export class ResultCache {
  #map = new Map();
  #max;
  enabled = true;

  constructor({ maxEntries = 500 } = {}) {
    this.#max = maxEntries;
  }

  // Only card text is ever cached (the runner checks), so the key is the raw text with
  // leading/trailing whitespace trimmed — no comment or whitespace normalization inside.
  key(patternId, text, version) {
    const h = crypto.createHash('sha256').update(String(text).trim()).digest('hex');
    return `${patternId}|${version}|${h}`;
  }

  get(key) {
    if (!this.enabled || !this.#map.has(key)) return undefined;
    const v = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value);
  }

  clear() {
    this.#map.clear();
  }

  get size() {
    return this.#map.size;
  }
}
