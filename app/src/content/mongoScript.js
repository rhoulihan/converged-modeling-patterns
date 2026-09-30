import * as acorn from 'acorn';
import { parseMongoCommand } from './mongoCommand.js';
import { addHelp } from './sqlParser.js';

const ANNOT = /^\s*@(step|note|why|look|figure)\b\s*(.*)$/i;

export function parseMongoScript(text, file = 'script') {
  const comments = [];
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true, onComment: comments });
  const annos = comments
    .filter((c) => c.type === 'Line')
    .map((c) => ({ c, m: c.value.match(ANNOT) }))
    .filter((x) => x.m);
  const steps = [];
  let ai = 0;
  let prevEnd = 0;
  for (const st of ast.body) {
    const mine = [];
    while (ai < annos.length && annos[ai].c.end <= st.start) {
      if (annos[ai].c.start >= prevEnd) mine.push(annos[ai]);
      ai++;
    }
    prevEnd = st.end;
    const stepAnno = mine.filter((x) => x.m[1].toLowerCase() === 'step').pop();
    if (!stepAnno) continue;
    const node = st.type === 'VariableDeclaration' && st.declarations.length === 1 ? st.declarations[0].init
      : st.type === 'ExpressionStatement' ? st.expression : null;
    const where = `${file}:${st.loc.start.line}`;
    if (!node) throw new Error(`${where}: @step must precede a db.* expression or "const x = db.*"`);
    const command = text.slice(node.start, node.end).replace(/\.toArray\(\s*\)\s*$/, '');
    try {
      parseMongoCommand(command);
    } catch (e) {
      throw new Error(`${where}: ${e.message}`);
    }
    const help = { why: null, look: null, figure: null };
    for (const x of mine) {
      const k = x.m[1].toLowerCase();
      if (k === 'why' || k === 'look' || k === 'figure') addHelp(help, k, x.m[2].trim(), where);
    }
    steps.push({
      title: stepAnno.m[2].trim(),
      notes: mine.filter((x) => x.m[1].toLowerCase() === 'note').map((x) => x.m[2].trim()),
      help,
      command,
      line: st.loc.start.line,
    });
  }
  return steps;
}
