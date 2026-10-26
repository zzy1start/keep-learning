/* ============ check-memory-inputs.cjs : 翻译/写作「最近 5 条输入」记忆 ============
 * 覆盖：
 * 1) Store.def() 默认字段 + 旧存档字段类型错乱时的归一；
 * 2) rememberInput：最多 5 条、最新在前、同 id 去重并移到最前、空文本不占位；
 * 3) recentInputs / clearInputs：两页互相独立；
 * 4) 写入立刻 flush 到 localStorage，模拟刷新/重启后仍能读回；
 * 5) 视图接线（功能）：翻译页/写作页输入后真的调用 Store.rememberInput，
 *    同一编辑会话 id 稳定、reset 后换新 id；恢复记录会回填文本并切题；
 * 6) 源码接线：两页都有「🕘 最近记录」入口、recentInputs/clearInputs 调用，
 *    并在提交/换题/切 tab/离开页面前 flush。
 * 用捆绑 node 运行：node tools/check-memory-inputs.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + ((e && e.message) || e)); }
}

/** 用给定 localStorage 载荷启动 store.js（参考 check-data-integrity.cjs 的 boot） */
function boot(stored) {
  const state = { value: stored == null ? null : stored };
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, String, Number, Promise, RegExp,
    setTimeout, clearTimeout,
    localStorage: {
      getItem: () => state.value,
      setItem: (_k, v) => { state.value = String(v); },
      removeItem: () => { state.value = null; },
    },
    window: {},
    App: { today: () => '2026-10-23', debounce: fn => fn, toast() {} },
  });
  vm.runInContext(read('js/store.js'), ctx);
  const Store = vm.runInContext('Store', ctx);
  Store.load();
  return { Store, state };
}

function makeEntry(id, text, extra) {
  return Object.assign({
    id,
    at: '2026-10-23T10:00:00.000Z',
    taskId: 'task-' + id,
    taskTitle: '题目 ' + id,
    mode: 'exam',
    dir: 'en2cn',
    text,
    chars: Array.from(text.replace(/\s+/gu, '')).length,
  }, extra || {});
}

/** 加载翻译视图（含 translate-metric），Store 换成只记录调用的桩 */
function makeTranslateHarness() {
  const calls = [];
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, String, Number, Promise, RegExp,
    setInterval, clearInterval,
    window: {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    App: {
      debounce: fn => fn,
      freshView: () => ({}),
      today: () => '2026-10-23',
      fmtDate: d => new Date(d == null ? Date.now() : d).toISOString().slice(0, 10),
      toast() {}, closeModal() {}, confirm() {},
    },
    Store: {
      d: { translationHistory: [], writingHistory: [] },
      rememberInput(kind, entry) { calls.push([kind, entry]); },
      recentInputs() { return []; },
      clearInputs() { return 0; },
    },
    esc: v => String(v == null ? '' : v),
    $: () => null, $$: () => [],
  });
  vm.runInContext(read('js/translate-metric.js'), ctx);
  vm.runInContext(read('js/views/translation.js'), ctx);
  return { view: ctx.window.ViewTranslate, calls };
}

/** 加载写作视图，Store 换成只记录调用的桩 */
function makeWriteHarness() {
  const calls = [];
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, String, Number, Promise, RegExp,
    setInterval, clearInterval,
    window: {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    Dict: { content: { writing: { tasks: [], sentenceTasks: [] } } },
    App: {
      debounce: fn => fn,
      freshView: () => ({}),
      today: () => '2026-10-23',
      fmtDate: d => new Date(d == null ? Date.now() : d).toISOString().slice(0, 10),
      toast() {}, closeModal() {}, confirm() {},
    },
    Store: {
      d: { translationHistory: [], writingHistory: [] },
      rememberInput(kind, entry) { calls.push([kind, entry]); },
      recentInputs() { return []; },
      clearInputs() { return 0; },
    },
    esc: v => String(v == null ? '' : v),
    $: () => null, $$: () => [],
  });
  vm.runInContext(read('js/views/writing.js'), ctx);
  return { view: ctx.window.ViewWrite, calls };
}

(async () => {
  /* ---------- Store 数据层 ---------- */
  await check('默认字段：新存档自带 translationHistory / writingHistory 空数组', () => {
    const { Store } = boot(null);
    assert.ok(Array.isArray(Store.d.translationHistory), 'translationHistory 应为数组');
    assert.ok(Array.isArray(Store.d.writingHistory), 'writingHistory 应为数组');
    assert.equal(Store.d.translationHistory.length, 0);
    assert.equal(Store.d.writingHistory.length, 0);
    const def = Store.def();
    assert.ok(Array.isArray(def.translationHistory) && Array.isArray(def.writingHistory), 'def() 应包含这两个字段');
  });

  await check('旧存档字段类型错乱（字符串/对象）→ 归一为空数组，不崩', () => {
    const { Store } = boot(JSON.stringify({ translationHistory: 'oops', writingHistory: { a: 1 } }));
    assert.ok(Array.isArray(Store.d.translationHistory), '字符串应被归一为数组');
    assert.ok(Array.isArray(Store.d.writingHistory), '对象应被归一为数组');
    assert.equal(Store.recentInputs('translation').length, 0);
    assert.equal(Store.recentInputs('writing').length, 0);
  });

  await check('旧存档数组里混入坏条目 → recentInputs 跳过坏条目，不抛错', () => {
    const { Store } = boot(JSON.stringify({ translationHistory: [null, 3, 'x', { id: 'ok', text: '正常文本' }] }));
    const list = Store.recentInputs('translation');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'ok');
  });

  await check('rememberInput：最多保留 5 条，最新在前', () => {
    const { Store } = boot(null);
    for (let i = 1; i <= 7; i++) Store.rememberInput('translation', makeEntry('e' + i, '文本' + i));
    const list = Store.recentInputs('translation');
    assert.equal(list.map(x => x.id).join(','), 'e7,e6,e5,e4,e3', '应只留最近 5 条且最新在前');
    assert.equal(Store.d.translationHistory.length, 5, '落盘数组也不应超过 5');
    assert.ok(!list.some(x => x.id === 'e1' || x.id === 'e2'), '最旧的两条应被挤掉');
  });

  await check('rememberInput：同 id 去重（更新内容/时间并移到最前，不新增条目）', () => {
    const { Store } = boot(null);
    Store.rememberInput('translation', makeEntry('a', '第一版'));
    Store.rememberInput('translation', makeEntry('b', '另一条'));
    Store.rememberInput('translation', makeEntry('a', '第二版', { at: '2026-10-23T11:00:00.000Z' }));
    const list = Store.recentInputs('translation');
    assert.equal(list.map(x => x.id).join(','), 'a,b', '同 id 应移到最前且不重复');
    assert.equal(list[0].text, '第二版', '应更新为最新内容');
    assert.equal(list[0].at, '2026-10-23T11:00:00.000Z', '时间应更新为最新一次');
    assert.equal(Store.d.translationHistory.length, 2);
  });

  await check('rememberInput：空文本不占位；chars 自动按非空白字符计算', () => {
    const { Store } = boot(null);
    Store.rememberInput('translation', makeEntry('blank', '   '));
    assert.equal(Store.recentInputs('translation').length, 0, '空文本不应写入');
    Store.rememberInput('writing', { id: 'c1', text: '你好 世界' });
    const one = Store.recentInputs('writing')[0];
    assert.equal(one.chars, 4, 'chars 应为去掉空白后的字符数');
    assert.ok(!isNaN(Date.parse(one.at)), 'at 应为可解析的 ISO 时间');
  });

  await check('recentInputs 返回副本（外部修改不会污染 Store）', () => {
    const { Store } = boot(null);
    Store.rememberInput('translation', makeEntry('x', '内容'));
    const copy = Store.recentInputs('translation');
    copy.push(makeEntry('y', '外部塞入'));
    copy[0].text = '外部篡改';
    assert.equal(Store.recentInputs('translation').length, 1);
    assert.equal(Store.recentInputs('translation')[0].text, '内容');
  });

  await check('clearInputs：只清一类，另一类与数组上限互不影响', () => {
    const { Store } = boot(null);
    Store.rememberInput('translation', makeEntry('t1', '译文'));
    Store.rememberInput('writing', makeEntry('w1', '作文'));
    const removed = Store.clearInputs('translation');
    assert.equal(removed, 1);
    assert.equal(Store.recentInputs('translation').length, 0);
    assert.equal(Store.recentInputs('writing').map(x => x.id).join(','), 'w1', '写作记录不应被一起清掉');
    assert.equal(Store.clearInputs('unexpected-kind'), 0, '未知类型应安全返回 0');
  });

  await check('持久化：rememberInput 立刻 flush，模拟刷新/重启后仍能读回', () => {
    const first = boot(null);
    first.Store.rememberInput('translation', makeEntry('p1', '刷新前写的译文'));
    first.Store.rememberInput('writing', makeEntry('p2', '刷新前写的作文'));
    const second = boot(first.state.value);   // 用同一份 localStorage 重新启动
    assert.equal(second.Store.recentInputs('translation').map(x => x.id).join(','), 'p1', '翻译记录应还在');
    assert.equal(second.Store.recentInputs('writing').map(x => x.id).join(','), 'p2', '写作记录应还在');
  });

  /* ---------- 视图接线（功能） ---------- */
  await check('翻译页：输入后真的写 translation 记录；同一会话 id 稳定，reset 后换新 id', () => {
    const h = makeTranslateHarness();
    const v = h.view;
    v.mode = 'exam';
    v.task = { id: 'tr-1', title: '题一', translationText: 'Source text.' };
    v.answer = '第一版';
    v._memoSoon('第一版');
    assert.equal(h.calls.length, 1, '输入后应调用 Store.rememberInput');
    assert.equal(h.calls[0][0], 'translation', '写的是翻译页自己的记录');
    assert.equal(h.calls[0][1].text, '第一版');
    assert.equal(h.calls[0][1].mode, 'exam');
    assert.equal(h.calls[0][1].taskId, 'tr-1');
    assert.equal(h.calls[0][1].dir, 'en2cn');
    const firstId = h.calls[0][1].id;
    v._memoSoon('第一版改');
    assert.equal(h.calls[1][1].id, firstId, '同一题目连续输入应复用同一条记录 id');
    v._resetMemo();
    v._memoSoon('提交后新一段');
    assert.notEqual(h.calls[2][1].id, firstId, '换题/提交后应生成新记录 id');
  });

  await check('翻译页：恢复记录回填文本、切到对应题目并清理旧评分（不自动提交）', () => {
    const h = makeTranslateHarness();
    const v = h.view;
    let renders = 0;
    v._shell = () => { renders++; };
    v.mode = 'exam';
    v.answer = '旧文本';
    v.result = { score: { total: 1 } };
    const target = { id: 'tr-9', title: '目标题', translationText: 'B.' };
    v._pool = () => [target];
    v._restoreMemo({ id: 'memo-1', text: '要恢复的文本', mode: 'exam', taskId: 'tr-9', dir: 'cn2en' });
    assert.equal(v.answer, '要恢复的文本', '文本应回填编辑器');
    assert.equal(v.task, target, '应切到记录对应的题目');
    assert.equal(v.dir, 'cn2en', '方向也应恢复');
    assert.equal(v.result, null, '恢复不应保留上一次评分');
    assert.equal(v._memo.id, 'memo-1', '恢复后继续编辑应更新同一条记录');
    assert.equal(renders, 1, '恢复后应重渲染编辑器');
  });

  await check('写作页：输入后真的写 writing 记录（带 tab/taskId），reset 后换新 id', () => {
    const h = makeWriteHarness();
    const v = h.view;
    v.tab = 'task';
    v.curTask = { id: 'wr-1', title: '作文题一' };
    v.essay = 'My first draft.';
    v._memoSoon('My first draft.');
    assert.equal(h.calls.length, 1, '输入后应调用 Store.rememberInput');
    assert.equal(h.calls[0][0], 'writing', '写的是写作页自己的记录');
    assert.equal(h.calls[0][1].tab, 'task');
    assert.equal(h.calls[0][1].taskId, 'wr-1');
    assert.equal(h.calls[0][1].taskTitle, '作文题一');
    v._resetMemo();
    v._memoSoon('第二版');
    assert.equal(h.calls.length, 2);
    assert.notEqual(h.calls[1][1].id, h.calls[0][1].id);
  });

  await check('写作页：恢复记录会切到对应 tab/题目并回填文本', () => {
    const h = makeWriteHarness();
    const v = h.view;
    let renders = 0;
    v._shell = () => { renders++; };
    v.tab = 'task';
    v.curTask = { id: 'wr-cur', title: '当前题' };
    v.essay = '旧稿';
    const target = { id: 'wr-9', title: '目标作文' };
    v._taskPool = () => [target];
    v._restoreMemo({ id: 'memo-2', text: '恢复的作文', tab: 'task', taskId: 'wr-9' });
    assert.equal(v.tab, 'task');
    assert.equal(v.curTask, target, '应切到记录对应的题目');
    assert.equal(v.essay, '恢复的作文', '文本应回填编辑器');
    assert.equal(v._memo.id, 'memo-2');
    assert.equal(renders, 1);
  });

  await check('写作页：恢复到单句练习 tab 时也恢复翻译方向', () => {
    const h = makeWriteHarness();
    const v = h.view;
    v._shell = () => {};
    v.tab = 'task';
    const sent = { id: 's-1', en: 'Hello.', cn: '你好。' };
    v._sentencePool = () => [sent];
    v._restoreMemo({ id: 'memo-3', text: '你好。', tab: 'sentence', taskId: 's-1', dir: 'cn2en' });
    assert.equal(v.tab, 'sentence');
    assert.equal(v.sentTask, sent);
    assert.equal(v.trDir, 'cn2en');
  });

  await check('翻译页：记录里的题目已不存在 → 只回填文本，不切题型/题目', () => {
    const h = makeTranslateHarness();
    const v = h.view;
    v._shell = () => {};
    v.mode = 'exam';
    const cur = { id: 'tr-cur', title: '当前题', translationText: 'A.' };
    v.task = cur;
    v.answer = '旧';
    v._pool = () => [];
    v._restoreMemo({ id: 'memo-x', text: '只剩文本', mode: 'sentence', taskId: 'gone' });
    assert.equal(v.answer, '只剩文本', '文本仍应回填');
    assert.equal(v.mode, 'exam', '找不到题不应切题型');
    assert.equal(v.task, cur, '找不到题不应换当前题目');
  });

  await check('写作页：记录里的题目已不存在 → 只回填文本，不切 tab/题目', () => {
    const h = makeWriteHarness();
    const v = h.view;
    v._shell = () => {};
    v.tab = 'task';
    const cur = { id: 'wr-cur', title: '当前题' };
    v.curTask = cur;
    v.essay = '旧';
    v._taskPool = () => [];
    v._restoreMemo({ id: 'memo-y', text: '只剩文本', tab: 'sentence', taskId: 'gone' });
    assert.equal(v.essay, '只剩文本', '文本仍应回填');
    assert.equal(v.tab, 'task', '找不到题不应切 tab');
    assert.equal(v.curTask, cur, '找不到题不应换当前题目');
  });

  /* ---------- 源码接线 ---------- */
  await check('Store 源码：def 有字段、load 用 asArr 归一、三个方法齐全', () => {
    const src = read('js/store.js');
    assert.ok(src.includes('translationHistory: []'), 'def() 缺 translationHistory');
    assert.ok(src.includes('writingHistory: []'), 'def() 缺 writingHistory');
    assert.ok(src.includes('this.d.translationHistory = asArr(this.d.translationHistory)'), 'load() 未归一 translationHistory');
    assert.ok(src.includes('this.d.writingHistory = asArr(this.d.writingHistory)'), 'load() 未归一 writingHistory');
    assert.ok(src.includes('rememberInput(kind, entry)'), '缺 rememberInput');
    assert.ok(src.includes('recentInputs(kind)'), '缺 recentInputs');
    assert.ok(src.includes('clearInputs(kind)'), '缺 clearInputs');
    assert.ok(src.includes('list.slice(0, 5)'), '上限应为 5');
  });

  await check('翻译页源码：有「🕘 最近记录」入口、读写 Store、恢复与 flush 点', () => {
    const src = read('js/views/translation.js');
    for (const anchor of [
      'data-act="memo"', '最近记录', 'data-memo="${i}"', 'data-memo-clear',
      "Store.recentInputs('translation')", "Store.rememberInput('translation'", "Store.clearInputs('translation')",
      '_restoreMemo(entry)', '_openMemo()', '_clearMemo()',
      'App.debounce(() => this._memoFlush(), 800)', '_memoListen()',
      "window.addEventListener('beforeunload', flush)", "window.addEventListener('pagehide', flush)",
      "window.addEventListener('hashchange', flush)",
    ]) assert.ok(src.includes(anchor), '翻译页缺接线锚点：' + anchor);
    assert.ok(/ta\.oninput[\s\S]{0,300}_memoSoon/.test(src), '编辑器 oninput 应挂 _memoSoon');
    assert.ok(/async _grade\(root\) \{[\s\S]{0,160}_memoFlush\(\)/.test(src), '提交评分前应 flush');
    assert.ok(/_next\(mode, root\) \{[\s\S]{0,160}_memoFlush\(\)/.test(src), '换一题前应 flush');
    assert.ok(/if \(tab\) \{[\s\S]{0,160}_memoFlush\(\)/.test(src), '切题型 tab 前应 flush');
  });

  await check('写作页源码：有「🕘 最近记录」入口、读写 Store、恢复与 flush 点', () => {
    const src = read('js/views/writing.js');
    for (const anchor of [
      'data-act="memo"', '最近记录', 'data-memo="${i}"', 'data-memo-clear',
      "Store.recentInputs('writing')", "Store.rememberInput('writing'", "Store.clearInputs('writing')",
      '_restoreMemo(entry)', '_openMemo()', '_clearMemo()', '_findMemoTask(tab, taskId)',
      'App.debounce(() => this._memoFlush(), 800)', '_memoListen()',
      "window.addEventListener('beforeunload', flush)", "window.addEventListener('pagehide', flush)",
      "window.addEventListener('hashchange', flush)",
    ]) assert.ok(src.includes(anchor), '写作页缺接线锚点：' + anchor);
    assert.ok(/ed\.oninput[\s\S]{0,320}_memoSoon/.test(src), '编辑器 oninput 应挂 _memoSoon');
    assert.ok(/_resetTaskState\(\) \{[\s\S]{0,160}_memoFlush\(\)/.test(src), '换题/切 tab 前应 flush');
    assert.ok(/async _grade\(task, isSentence\) \{[\s\S]{0,160}_memoFlush\(\)/.test(src), '提交评分前应 flush');
    assert.ok(/a === 'save'[\s\S]{0,320}_memoFlush\(\)/.test(src), '保存草稿前应 flush');
    assert.ok(/a === 'nextTask'[\s\S]{0,160}_memoFlush\(\)/.test(src), '换一题前应 flush');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项最近输入记忆检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
