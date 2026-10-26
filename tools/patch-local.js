/* 补丁2：修复局部重渲染区域的监听器累积 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'js', 'views');
const edits = [
  // 听力：重新渲染整个 left 容器前换节点
  ['listening.js', "  _body() {\n    const box = $('#lsnBody');",
    "  _body() {\n    const box = App.freshNode('#lsnBody');\n    if (!box) return;"],
  // 阅读：分析面板局部刷新前换节点
  ['reading.js', "  _bindPanel() {\n    const box = $('#anBox');",
    "  _bindPanel() {\n    const box = App.freshNode('#anBox');\n    if (!box) return;"],
  // 阅读：段落重渲染
  ['reading.js', "  _reRenderPassage() {\n    const p = this.cur;\n    $('#passage').innerHTML =",
    "  _reRenderPassage() {\n    const p = this.cur;\n    const ps = App.freshNode('#passage');\n    if (!ps) return;\n    ps.innerHTML ="],
];
for (const [f, a, b] of edits) {
  const p = path.join(D, f);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(a)) { console.log('MISS  ' + f + ' :: ' + a.split('\n')[0]); continue; }
  if (s.includes(b)) { console.log('SKIP  ' + f); continue; }
  fs.writeFileSync(p, s.replace(a, b));
  console.log('OK    ' + f);
}