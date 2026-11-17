/* ============ check-progress-fixes.cjs : 连续天数 / 树成长 / 词汇量测试计数 ============
 * 对应 2026-11-14 用户反馈：
 *   1. “今天学了第几天”似乎有错（连续天数在东八区凌晨被重置）
 *   2. “树的成长没有变化”（旧版树没有被 recordActivity 计入）
 *   3. “单词界面为什么是 21/3991，我之前做过词汇量测试”
 *      （测试定级没有持久化/恢复，估算只剩一个数字）
 *
 * 这一套直接跑真实源码（vm），不 mock 业务判断：
 *   · 用可控时钟把“现在”固定在东八区 00:30，验证跨天连续；
 *   · 用旧版存档里的树（无 trackingVersion）验证迁移后真的会长；
 *   · 用 vocabTest.placement 验证换设备/丢状态后能恢复跳过带。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

const KEY = 'keeplrn_v1';
const mem = Object.create(null);
const RealDate = Date;

function makeCtx() {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date: RealDate, Math, JSON, Object, Array, String, Number, Boolean,
    Promise, Set, Map, RegExp, Error, parseInt, parseFloat, isNaN, encodeURIComponent,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
      clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
    },
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, replaceWith() {} }),
    },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  load('js/core.js');
  ctx.App = vm.runInContext('App', ctx);
  load('js/garden.js');
  ctx.Garden = vm.runInContext('Garden', ctx);
  load('js/garden-view.js');
  load('js/store.js');
  ctx.Store = vm.runInContext('Store', ctx);
  /* 业务代码里用的是 const 声明；挂到 ctx 上方便测试直接调用 */
  ctx.App = vm.runInContext('App', ctx);
  ctx.Store = vm.runInContext('Store', ctx);
  ctx.Garden = vm.runInContext('Garden', ctx);
  return ctx;
}

/** 把 vm 里的“现在”固定到指定本地时间；Date.now 与 new Date() 都受控 */
function setClock(ctx, y, m, d, hh = 12, mm = 0) {
  const ms = new RealDate(y, m - 1, d, hh, mm, 0, 0).getTime();
  const FakeDate = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [ms])); }
    static now() { return ms; }
  };
  ctx.Date = FakeDate;
  ctx.App.now = () => new ctx.Date();
  return ctx;
}

function seed(ctx, data) {
  mem[KEY] = JSON.stringify(Object.assign({ __punctRepairV1: 1 }, data));
  ctx.Store.d = null;
  ctx.Store.load();
}

const ctx = makeCtx();

/* ------------------------------------------------------------------ */
check('连续天数：东八区 00:30 学习仍接上昨天（旧实现会重置成 1）', () => {
  setClock(ctx, 2026, 11, 14, 0, 30);
  seed(ctx, {
    stats: {
      days: ['2026-11-11', '2026-11-12', '2026-11-13'], streak: 3, lastStudy: '2026-11-13',
      daily: {
        '2026-11-11': { words: 5 }, '2026-11-12': { words: 5 }, '2026-11-13': { words: 5 },
      },
    },
  });
  assert.equal(ctx.Store.d.stats.streak, 3, '启动自愈后应保持 3');
  const day = ctx.Store.markStudy();
  assert.ok(day && typeof day === 'object', 'markStudy 应返回当天统计对象');
  assert.equal(ctx.Store.d.stats.streak, 4, '00:30 学习应接上昨天 → 4，而不是重置成 1');
  assert.equal(ctx.Store.d.stats.lastStudy, '2026-11-14');
  assert.ok(ctx.Store.d.stats.days.includes('2026-11-14'));
});

check('连续天数：存档里已被算错的 streak=1 会按 days 自愈（5 天连击）', () => {
  setClock(ctx, 2026, 11, 14, 10, 0);
  seed(ctx, {
    stats: {
      days: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'],
      streak: 1, lastStudy: '2026-11-14',
      daily: { '2026-11-10': { words: 1 }, '2026-11-11': { words: 1 }, '2026-11-12': { words: 1 }, '2026-11-13': { words: 1 }, '2026-11-14': { words: 1 } },
    },
  });
  assert.equal(ctx.Store.d.stats.streak, 5, '应按本地日历从 days 重算为 5');
});

check('连续天数：隔了两天再打开 → 连续归 0（不再显示过期天数）', () => {
  setClock(ctx, 2026, 11, 14, 10, 0);
  seed(ctx, {
    stats: {
      days: ['2026-11-10', '2026-11-11'], streak: 2, lastStudy: '2026-11-11',
      daily: { '2026-11-10': { words: 1 }, '2026-11-11': { words: 1 } },
    },
  });
  assert.equal(ctx.Store.d.stats.streak, 0);
  assert.equal(ctx.Store.d.stats.lastStudy, '2026-11-11');
});

/* ------------------------------------------------------------------ */
check('树成长：旧版树（无 trackingVersion）迁移后，学习 10 分钟真的会长', () => {
  setClock(ctx, 2026, 11, 14, 10, 0);
  seed(ctx, {
    stats: { days: ['2026-11-14'], streak: 1, lastStudy: '2026-11-14', daily: { '2026-10-05': { seconds: 6000 } } },
    garden: {
      trees: [{
        id: 'old-tree', date: '2026-10-05', species: '樱花',
        growth: 0.77, state: 'long', words: [], investedMin: 238,
      }],
    },
  });
  const t = ctx.Store.d.garden.trees[0];
  const before = t.growth;
  ctx.Garden.recordActivity(600);
  assert.equal(t.trackingVersion, 2, '旧树应迁移到 v2，否则 recordActivity 会直接 return');
  assert.ok(t.investedMin > 238, '应把这次 10 分钟加进去，实际 ' + t.investedMin);
  assert.ok(t.growth > before, '成长度应增加：' + before + ' → ' + t.growth);
});

check('树成长：迁移不会让已有成长度倒退；只增不减', () => {
  setClock(ctx, 2026, 11, 14, 10, 0);
  seed(ctx, {
    stats: { days: [], streak: 0, lastStudy: '', daily: {} },
    garden: {
      trees: [{
        id: 'old-2', date: '2026-10-01', species: '油松',
        growth: 0.82, state: 'long', words: [], investedMin: 0,
      }],
    },
  });
  ctx.Garden.refresh();
  const t = ctx.Store.d.garden.trees[0];
  assert.equal(t.trackingVersion, 2);
  assert.ok(t.growth >= 0.82, '迁移后不能倒退，实际 ' + t.growth);
  assert.ok(t.investedMin >= 0.82 * 90 * 20 - 1, '应把 82% 折算成等效投入分钟');
});

check('树成长：0.3% 这种小变化不再被四舍五入成 0%', () => {
  assert.equal(ctx.Garden.growthPercent(0.003), 0.3);
  assert.equal(ctx.Garden.growthPercent(0.5), 50);
  assert.equal(ctx.Garden.growthPercent(1), 100);
  assert.equal(ctx.Garden.growthPercent(0.9999), 99.9);
});

check('统计页“分钟”日志：读 seconds 换算，旧存档回退 min', () => {
  assert.equal(ctx.Store.dayMinutes({ seconds: 1200 }), 20);
  assert.equal(ctx.Store.dayMinutes({ seconds: 30 }), 1);
  assert.equal(ctx.Store.dayMinutes({ min: 7 }), 7);
  assert.equal(ctx.Store.dayMinutes(null), 0);
});

/* ------------------------------------------------------------------ */
/* 词汇量测试定级：单独一个上下文，带上 vocab 视图所需的桩 */
function makeVocabCtx() {
  /* 这里不能加载 store.js：它在 vm 里是 const Store 词法绑定，测试无法替换。
   * 只加载 core.js，把 Store 作为全局属性注入，vocab.js 的 Store 就会解析到桩对象。*/
  const c = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date: RealDate, Math, JSON, Object, Array, String, Number, Boolean,
    Promise, Set, Map, RegExp, Error, parseInt, parseFloat, isNaN,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, replaceWith() {} }),
    },
  };
  vm.createContext(c);
  c.window = c;
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  load('js/core.js');
  const App = vm.runInContext('App', c);
  let lastView = null;
  Object.assign(App, {
    today: () => '2026-11-14', fmtDate: () => '2026-11-14', toast() {},
    freshView: () => (lastView = {
      innerHTML: '', addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
    }),
    shuffle: a => a.slice(), pick: (a, n) => a.slice(0, n),
    pageSeconds: () => 60, resetPageTimer() {},
    confirm: (msg, cb) => cb(), closeModal() {},
  });
  const words = [];
  for (let i = 0; i < 60; i++) words.push({ w: 'w' + i, tr: [{ t: 'n', d: '义' + i }], freq: 100 - i });
  const book = { id: 'cet6', name: 'CET6', total: 3991, words };
  const store = {
    d: {
      createdAt: '2026-10-01', settings: { dailyNew: 30 }, srs: {}, stats: { daily: {} },
      garden: { trees: [] }, vocabTest: {}, activeBook: 'cet6',
    },
    flush() {}, save() {},
    srsOf() { return null; },
    srsUpdate() {},
    nbHas() { return false; }, nbAdd() { return true; },
    addStat() {}, logActivity() {}, logStudyTime() {},
    bookProgress() { return { total: 60, learned: 0, mastered: 0, reviewing: 0 }; },
    skipInfo() { return { liveSkipped: 0, batches: 0, last: null }; },
  };
  c.Store = store;
  c.BOOKS = [{ id: 'cet6', name: 'CET6' }];
  c.Dict = { content: {}, cache: {}, meaningRows: w => w.tr || [] };
  c.SRS = { schedule: r => r, describe: () => '待复习', stageName: () => '新词' };
  c.Speech = { stop() {}, speakWord() {}, speak() {} };
  c.Garden = { noteWord() {}, recordActivity() {} };
  c.AI = { ready: false, lookup: async () => ({}) };
  c.WordLevel = null;
  c.buildChoices = () => ({ opts: ['a', 'b', 'c', 'd'], answer: 0 });
  c.bk0name = b => b.name;
  c.modeName = m => m;
  load('js/vocab-engine.js');
  c.VocabEngine = vm.runInContext('VocabEngine', c);
  load('js/vocab-quiz.js');
  c.VocabQuiz = vm.runInContext('VocabQuiz', c);
  load('js/views/vocab.js');
  const V = vm.runInContext('ViewVocab', c);
  V.book = book;
  return { c, V, store, book, getView: () => lastView };
}

check('复习间隔：7/15/30 天按本地日历，不会提前一天到期', () => {
  const { c } = makeVocabCtx();
  const E = c.VocabEngine;
  assert.equal(E._dateFromIndex(E._dayIndex('2026-11-14')), '2026-11-14');
  assert.equal(E._dateFromIndex(E._dayIndex('2026-11-14') + 7), '2026-11-21');
  assert.equal(E._dateFromIndex(E._dayIndex('2026-11-14') + 15), '2026-11-29');
  assert.equal(E._dateFromIndex(E._dayIndex('2026-11-14') + 30), '2026-12-14');
});

check('词汇量测试：逐带丢失时可按整体估算恢复最容易的整带（不跳最难带）', () => {
  const { V } = makeVocabCtx();
  const plan = V._estimateSkipBands(50);
  assert.deepEqual(Array.from(plan.bands), [0, 1, 2, 3, 4]);
  assert.equal(plan.count, 50);
  assert.equal(V._estimateSkipBands(25).count, 20);
  assert.ok(!V._estimateSkipBands(60).bands.includes(5), '最难的一带必须保留，避免新词池归零');
});

check('按测试估算恢复：写入最容易整带，页面计数立即生效', () => {
  const { c, V, store } = makeVocabCtx();
  store.d.vocabTest.cet6 = { correct: 35, total: 40, estimate: 50, rate: 88 };
  V._applyEstimatePlacement();
  const E = c.VocabEngine;
  assert.deepEqual(Array.from(E.load().user.skipBands), [0, 1, 2, 3, 4]);
  assert.equal(E.load().user.placementSource, 'estimate');
  assert.equal(V._engineCounts().skippedKnown, 50);
});

check('词汇量测试：placement 被持久化后，引擎定级丢失也能恢复（不是 21/3991）', () => {
  const { c, V, store } = makeVocabCtx();
  /* 模拟用户真机数据：估算 3500、35/40，跳过 0/1/2/3/5 五个频带 */
  store.d.vocabTest.cet6 = {
    correct: 35, total: 40, estimate: 3517, rate: 88,
    placement: {
      accuracy: [1, 0.857, 1, 0.833, 0.714, 0.857],
      bandResults: [
        { band: 0, sampled: 7, correct: 7 }, { band: 1, sampled: 7, correct: 6 },
        { band: 2, sampled: 7, correct: 7 }, { band: 3, sampled: 6, correct: 5 },
        { band: 4, sampled: 7, correct: 5 }, { band: 5, sampled: 6, correct: 5 },
      ],
      skipBands: [0, 1, 2, 3, 5], bandPlacement: null,
      vocabEstimate: 3500, correctIds: [],
    },
  };
  const E = c.VocabEngine;
  E.reset(); E.load(store);
  assert.equal(E.load().user.skipBands.length, 0, '前置：引擎里没有定级');
  const ok = V._restorePlacementFromTest();
  assert.equal(ok, true, '应从 vocabTest.placement 恢复');
  assert.deepEqual(Array.from(E.load().user.skipBands), [0, 1, 2, 3, 5]);
  assert.equal(E.load().user.vocabEstimate, 3500);
  const counts = V._engineCounts();
  assert.equal(counts.skippedKnown, 50, '60 个词里 5 个频带 × 10 词 = 50 个应计入，实际 ' + counts.skippedKnown);
});

check('词汇量测试：只剩 bandAccuracy 时也能反推跳过带（旧存档不再掉回 21/3991）', () => {
  const { c, V, store } = makeVocabCtx();
  store.d.vocabTest.cet6 = { correct: 35, total: 40, estimate: 3517 };
  const E = c.VocabEngine;
  E.reset(); E.load(store);
  E.load().user.vocabEstimate = 3500;
  E.load().user.bandAccuracy = { 0: 1, 1: 0.857, 2: 1, 3: 0.833, 4: 0.714, 5: 0.857 };
  E.save();
  assert.equal(V._restorePlacementFromTest(), true, '应按 bandAccuracy 补回 skipBands');
  assert.deepEqual(Array.from(E.load().user.skipBands), [0, 1, 2, 3, 5]);
  assert.equal(V._engineCounts().skippedKnown, 50);
});

check('词汇量测试：用户主动“全部从头学”后不自动恢复，估算标注为未跳过', () => {
  const { c, V, store } = makeVocabCtx();
  store.d.vocabTest.cet6 = {
    correct: 35, total: 40, estimate: 3517,
    placement: { accuracy: [1], bandResults: [{ band: 0, sampled: 1, correct: 1 }], skipBands: [0], bandPlacement: null, vocabEstimate: 3500, correctIds: [] },
    placementDisabled: true,
  };
  const E = c.VocabEngine;
  E.reset(); E.load(store);
  assert.equal(V._restorePlacementFromTest(), false);
  assert.equal(E.load().user.skipBands.length, 0);
});

check('releaseUnlearned：取消定级后保留测试估算，但标记 placementDisabled（不会下次又恢复）', () => {
  const { c, store } = makeVocabCtx();
  const E = c.VocabEngine;
  E.reset(); E.load(store);
  E.load().user.vocabEstimate = 3500;
  E.load().user.skipBands = [0, 1];
  E.save();
  store.d.vocabTest.cet6 = { estimate: 3517 };
  const r = E.releaseUnlearned(store, 'cet6');
  assert.ok(r && typeof r.count === 'number');
  assert.equal(E.load().user.vocabEstimate, 3500, '测试估算应保留，页面会标“未跳过”');
  assert.equal(E.load().user.skipBands.length, 0);
  assert.equal(store.d.vocabTest.cet6.placementDisabled, true, '必须记住用户主动取消，防止自动恢复');
});

check('学习进度备份：包含 vocabEngine（否则换设备后定级全丢）且不导出进行中的轮次', () => {
  assert.ok(ctx.Store.PROGRESS_FIELDS.includes('vocabEngine'), 'PROGRESS_FIELDS 应包含 vocabEngine');
  seed(ctx, {
    stats: { days: [], streak: 0, lastStudy: '', daily: {} },
    vocabEngine: {
      user: { vocabEstimate: 3500, skipBands: [0, 1], bandPlacement: null },
      words: {}, events: [], rounds: [],
      round: { slots: [{ wordRef: { w: 'big-object' } }] },
    },
  });
  const j = JSON.parse(ctx.Store.progressBackup());
  assert.ok(j.vocabEngine, '进度文件必须带引擎状态');
  assert.equal(j.vocabEngine.user.vocabEstimate, 3500);
  assert.equal(j.vocabEngine.round, undefined, '进行中的轮次不应跨设备恢复');
});

check('词书页：只剩“估算 3500”而没有跳过带时，明确标注未跳过并解释 21/3991', () => {
  const { c, V, store, book, getView } = makeVocabCtx();
  book.total = 3991;
  /* 用户截图里的真实状态：做过测试、估算 3500，但 skipBands/bandPlacement 都空了 */
  store.d.vocabTest.cet6 = { correct: 35, total: 40, estimate: 3517, rate: 88 };
  const E = c.VocabEngine;
  E.reset(); E.load(store);
  E.load().user.vocabEstimate = 3500;
  for (let i = 0; i < 21; i++) {
    const st = E.stateOf('cet6:w' + i, 's0', true);
    st.attempts = 1;
    st.level = i % 2 ? 1 : 3;
  }
  E.save();
  V._renderShell(null);
  const html = getView().innerHTML;
  assert.match(html, /21/);
  assert.match(html, /3991/);
  assert.match(html, /测试估算（未跳过） 3500/, '不能把估算写成“定级估算”，否则用户会以为已按测试计入已学');
  assert.match(html, /没有启用「测试跳过已知词」/, '必须解释为什么已学只有 21');
  assert.match(html, /data-act="applyEstimate"/, '必须给出“按测试估算恢复”入口');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项连续天数/树成长/测试计数检查通过');
