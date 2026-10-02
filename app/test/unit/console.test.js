// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Console } from '../../public/js/console.js';

function mk() {
  document.body.innerHTML = `<section id="console"><div class="bar">
    <button data-lane="sql"></button><button data-lane="mongo"></button>
    <button id="run"></button><button id="history"></button></div>
    <div id="editor-sql"></div><div id="editor-mongo"></div><div id="status"></div><div id="out"></div></section>`;
  return new Console(document.querySelector('#console'));
}

describe('Console.load', () => {
  it('fills both editors and shows the lane of the card that was clicked', () => {
    const c = mk();
    c.load('sql', 'SELECT 1 FROM dual', 'db.aggregate([{ $sql: "SELECT 1 FROM dual" }])');
    expect(c.lane).toBe('sql');
    expect(c.editors.sql.get()).toBe('SELECT 1 FROM dual');
    expect(c.editors.mongo.get()).toBe('db.aggregate([{ $sql: "SELECT 1 FROM dual" }])');
    expect(document.querySelector('#editor-mongo').hidden).toBe(true);
  });
  it('works from a MongoDB card too', () => {
    const c = mk();
    c.load('mongo', 'db.t.find({})', 'SELECT * FROM t');
    expect(c.lane).toBe('mongo');
    expect(c.editors.sql.get()).toBe('SELECT * FROM t');
    expect(c.editors.mongo.get()).toBe('db.t.find({})');
  });
  it('leaves the other editor alone when there is no equivalent', () => {
    const c = mk();
    c.editors.mongo.set('show collections');
    c.load('sql', 'SELECT 2 FROM dual');
    expect(c.editors.mongo.get()).toBe('show collections');
  });
});
