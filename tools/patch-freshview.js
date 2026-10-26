/* 一次性补丁：为各视图渲染入口插入 App.freshView()，防止事件委托监听器累积 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'js', 'views');

const edits = [
  ['home.js', '  render(root) {\n    const st = Store.d.stats;',
    '  render(root) {\n    root = App.freshView();\n    const st = Store.d.stats;'],
  ['vocab.js', '  _renderShell(root) {\n    const b = this.book;',
    '  _renderShell(root) {\n    root = App.freshView();\n    const b = this.book;'],
  ['vocab.js', "  _renderStudy() {\n    const root = $('#view');",
    "  _renderStudy() {\n    const root = App.freshView();"],
  ['vocab.js', "  _finish() {\n    const root = $('#view');",
    "  _finish() {\n    const root = App.freshView();"],
  ['listening.js', '  _shell(root) {\n    const L = Dict.content.listening;',
    '  _shell(root) {\n    root = App.freshView();\n    const L = Dict.content.listening;'],
  ['reading.js', '  _shell(root) {\n    const R = Dict.content.reading.passages;',
    '  _shell(root) {\n    root = App.freshView();\n    const R = Dict.content.reading.passages;'],
  ['writing.js', '  _shell(root) {\n    const W = Dict.content.writing;',
    '  _shell(root) {\n    root = App.freshView();\n    const W = Dict.content.writing;'],
  ['notebook.js', '  _shell(root) {\n    const nb = Store.d.notebook;',
    '  _shell(root) {\n    root = App.freshView();\n    const nb = Store.d.notebook;'],
  ['stats.js', '  render(root) {\n    const d = Store.d;',
    '  render(root) {\n    root = App.freshView();\n    const d = Store.d;'],
  ['settings.js', '  render(root) {\n    const s = Store.d.settings;',
    '  render(root) {\n    root = App.freshView();\n    const s = Store.d.settings;'],
];

for (const [f, a, b] of edits) {
  const p = path.join(D, f);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(a)) { console.log('MISS  ' + f + ' :: ' + a.split('\n')[0]); continue; }
  if (s.includes(b)) { console.log('SKIP  ' + f); continue; }
  s = s.replace(a, b);
  fs.writeFileSync(p, s);
  console.log('OK    ' + f + ' :: ' + a.split('\n')[0]);
}