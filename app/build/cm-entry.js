// app/build/cm-entry.js
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { sql, PLSQL } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';

export function createEditor(parent, { lang, doc = '', onRun }) {
  const view = new EditorView({
    parent,
    doc,
    extensions: [
      basicSetup,
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
