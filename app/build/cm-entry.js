// app/build/cm-entry.js
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { sql, PLSQL } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Colours come from lab.css tokens, so the editor follows the page's light/dark scheme
// (CodeMirror's default highlight style is light-only and unreadable on the dark panel).
const labHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--flow)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hot)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--cool)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--cool)' },
]);
const labTheme = EditorView.theme({
  '&': { color: 'var(--ink)', backgroundColor: 'var(--panel)' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--faint)', borderRight: '1px solid var(--hairline)' },
  '.cm-activeLine': { backgroundColor: 'var(--flow-soft)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--chip)', color: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--flow-soft)' },
});

export function createEditor(parent, { lang, doc = '', onRun }) {
  const view = new EditorView({
    parent,
    doc,
    extensions: [
      basicSetup,
      labTheme,
      syntaxHighlighting(labHighlight),
      lang === 'sql' ? sql({ dialect: PLSQL }) : javascript(),
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { onRun?.(); return true; } }])),
      EditorView.lineWrapping,
    ],
  });
  return {
    get: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
  };
}
