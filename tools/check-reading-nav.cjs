/* ============ check-reading-nav.cjs : 阅读导航回归 ============
 * 历史：曾经在阅读页加过一条「筛选结果条」（点篇目切篇 + 上下篇），
 * 用户明确要求删除，因此这里反过来**断言它已经不存在**，避免又被误加回来。
 * 另外保留一个真实 bug 的回归：AI 生成新文章后不要用「全量数组下标」当翻页下标。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/views/reading.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/modules.css'), 'utf8');
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

check('阅读页不再有「筛选结果条」（按用户要求删除，勿加回）', () => {
  for (const token of ['_passageStrip', 'data-passage', 'rd-strip']) {
    assert.ok(!SRC.includes(token), 'reading.js 仍含 ' + token);
  }
  assert.ok(!CSS.includes('rd-strip'), 'modules.css 仍含 rd-strip 样式');
  assert.ok(!/data-passage-nav/.test(SRC), '上下篇按钮也应一并移除');
});

check('换篇仍走「篇章」下拉框（Picker），该通道未被误删', () => {
  assert.ok(SRC.includes('Picker.html'), '缺少筛选器渲染');
  assert.ok(SRC.includes('Picker.bind'), '缺少筛选器事件绑定');
  assert.ok(SRC.includes('partItems: this._pickerParts(all)'), '筛选器应基于当前题型取篇目');
});

check('回归：AI 生成新文章后按 id 定位，不再用全量数组下标当翻页下标', () => {
  assert.ok(!SRC.includes('this.pi = Dict.content.reading.passages.indexOf(p)'),
    '旧的全局下标写法应已删除（渲染用的是筛选后列表下标）');
  assert.ok(SRC.includes("no: 'id:' + p.id"), '生成新文章后应把筛选条件指向它自己');
});

check('回归：点题型 tab 后 sel 只剩 {no:\'all\'} 也不能把题目筛空（Picker.filter 缺省键按全部处理）', () => {
  const vm = require('node:vm');
  const pickerSrc = fs.readFileSync(path.join(ROOT, 'js/picker.js'), 'utf8');
  const ctx = vm.createContext({ window: {}, console });
  vm.runInContext(pickerSrc, ctx);
  const P = ctx.window.Picker;
  const items = [
    { id: 'a', level: 'CET-6', year: 2024, session: '06', setNo: 1, no: 1, readingType: 'section-a', title: 'A' },
    { id: 'b', level: 'CET-6', year: 2024, session: '06', setNo: 3, no: 1, readingType: 'section-a', title: 'B' },
    { id: 'c', level: 'CET-6', year: 2023, session: '06', no: 1, readingType: 'traditional', title: 'C' },
  ];
  assert.equal(P.filter(items, { no: 'all' }).length, 3, '只有 no 键时不应筛掉任何题（旧 bug：返回 0）');
  assert.equal(P.filter(items, {}).length, 3, '空 sel 应返回全部');
  assert.equal(P.filter(items, { level: 'cet6', no: 'all' }).length, 3, 'level 筛选仍生效');
  assert.equal(P.filter(items, { level: 'cet6', set: '3', no: 'all' }).length, 1, 'set 筛选仍生效');
  assert.equal(P.filter(items, { level: 'cet6', year: 2024, session: '06', set: 'all', no: 'all' }).length, 2, '完整筛选仍生效');
  assert.ok((SRC.match(/level: 'all', year: 'all', session: 'all', set: 'all', no: 'all'/g) || []).length >= 2,
    '阅读页两处题型 tab 处理器都应补全筛选默认值');
});

check('回归：Section A 空位下拉/答案 select 上的点击不触发“点句取整句”长难句分析', () => {
  assert.ok(SRC.includes('interactiveTarget'), '应加交互控件守卫（select/option/button 等）');
  assert.ok(/select, option, input, textarea, button, a, \[data-special-answer\]/.test(SRC), '守卫应包含 select/option 等控件');
  assert.ok(SRC.includes('if (interactiveTarget(e.target)) return;'), 'touchend 应先判断交互控件再取整句');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项阅读导航检查通过');