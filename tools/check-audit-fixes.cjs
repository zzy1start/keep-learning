/* ============ check-audit-fixes.cjs : 2026-10-29 全功能审计修复回归 ============
 * 来源：work/audit-report.md（独立 QA）+ 真机走查。这些修复多为交互/状态时序，
 * 用源码断言锁住关键顺序与文案，防止以后又被改回去：
 *   P0  词汇引擎惰性状态 + 存量裁剪 + flush 返回值
 *   P1  写作「自定义题目」确认前不重置计时器
 *   P2  阅读计时器重渲染不重置 / 未答提交确认 / 备份恢复校验落盘 / 确认弹窗保留换行 / AI 回退文案
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = {
  vocab: read('js/vocab-engine.js'),
  app: read('js/app.js'),
  store: read('js/store.js'),
  home: read('js/views/home.js'),
  writing: read('js/views/writing.js'),
  reading: read('js/views/reading.js'),
  settings: read('js/views/settings.js'),
  core: read('js/core.js'),
};

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

check('P0 词汇引擎：定级临时状态不落盘（无 hasPlacement 返回 null；有定级返回 __transient）', () => {
  assert.ok(/if \(!hasPlacement\) return null;/.test(SRC.vocab), '无定级信息时不能创建持久状态');
  assert.ok(/st\.__transient = true;/.test(SRC.vocab), '定级临时状态要打标');
  assert.ok(/const existing = this\.stateOf\(entry\.wordId, 's0', false\);/.test(SRC.vocab), '先只读已有状态');
  assert.ok(/pruneEmptyStates\(opts = \{\}\)/.test(SRC.vocab), '缺少 pruneEmptyStates');
});

check('P0 词汇引擎：组轮 push 时才把定级起点落盘（不再整本书写状态）', () => {
  const i = SRC.vocab.indexOf('const push = (r, role) => {');
  assert.ok(i >= 0, '找不到 slots push');
  const seg = SRC.vocab.slice(i, i + 900);
  assert.ok(/r\.tempPlacement/.test(seg) && /stateOf\(r\.entry\.wordId, r\.sense\.senseId, true\)/.test(seg),
    'push 里应只为选中的词创建状态：' + seg.slice(0, 200));
});

check('P0 启动裁剪：app.js 启动时调用 pruneEmptyStates({store:Store})', () => {
  assert.ok(/VocabEngine\.pruneEmptyStates\(\{ store: Store \}\)/.test(SRC.app), '启动时要裁掉历史空状态');
});

check('P0 落盘可见：Store.flush 返回 true/false 并记录 lastFlushOk；backup 前裁剪', () => {
  assert.ok(/this\.lastFlushOk = true;\s*\n\s*return true;/.test(SRC.store), 'flush 成功应返回 true');
  assert.ok(/this\.lastFlushOk = false;/.test(SRC.store) && /return false;/.test(SRC.store), 'flush 失败应返回 false');
  assert.ok(/pruneEmptyStates\(\{ store: this \}\)/.test(SRC.store), '导出备份前应裁剪空状态');
});

check('P1 写作：打开自定义题目弹窗前不 reset，确认「开始写作」后才 reset', () => {
  const start = SRC.writing.indexOf('_customTask() {');
  const modal = SRC.writing.indexOf('App.modal(', start);
  const reset = SRC.writing.indexOf('this._resetTaskState();', start);
  const okBtn = SRC.writing.indexOf("#cuOk", start);
  assert.ok(start >= 0 && modal > start && reset > modal && okBtn > start && reset > okBtn,
    '调用顺序应为 _customTask → App.modal → #cuOk 确认 → _resetTaskState；实际 modal@' + modal + ' ok@' + okBtn + ' reset@' + reset);
});

check('P2 阅读：计时器重渲染不重置（_timerPassageId 守卫）', () => {
  assert.ok(/_timerPassageId !== p\.id/.test(SRC.reading), '缺少篇目/状态守卫');
  assert.ok(/this\._timerPassageId = p\.id;/.test(SRC.reading), '缺少记录当前篇目');
});

check('P2 阅读：有未答题目提交前先确认；AI 回退文案如实说明本地模板', () => {
  assert.ok(/还有 ' \+ \(qs\.length - answered\) \+ ' 题未作答，确定提交/.test(SRC.reading), '缺少未答提交确认');
  assert.ok(/未配置 AI，已用本地模板生成文章/.test(SRC.reading), 'AI 未配置时应说明本地模板');
});

check('P2 设置：恢复备份后检查 Store.flush 结果，失败不得提示成功', () => {
  assert.ok(/const ok = Store\.flush\(\);/.test(SRC.settings), '全量恢复应检查 flush 结果');
  assert.ok(/Store\.lastFlushOk === false/.test(SRC.settings), '进度恢复应检查 lastFlushOk');
  assert.ok(/导入失败：本机存储空间不足/.test(SRC.settings), '失败时要给明确提示');
});

check('P2 通用：App.confirm 保留换行（white-space:pre-line）', () => {
  assert.ok(/white-space:pre-line/.test(SRC.core), '确认弹窗应保留换行');
});

check('首页文案：streak 标为「连续学习」而不是「开始学习的第 N 天」', () => {
  assert.ok(/今天是你连续学习的第/.test(SRC.home), '首页 streak 文案口径不对');
  assert.equal(SRC.home.indexOf('今天是开始学习的第'), -1, '旧文案应删除');
});

if (failed) {
  console.error('\n' + failed + ' 项失败，' + passed + ' 项通过');
  process.exitCode = 1;
} else {
  console.log('\n全部 ' + passed + ' 项审计修复回归通过');
}
