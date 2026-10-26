/* ============ check-home-daily-words.cjs : 首页「今日新学单词」口径 ============
 * 用户反馈：首页"今日新学单词"要统一成新口径（只算新词），或给出说明。
 * 本套锁住：首页与词书页「今日新词 X / 目标」同一口径（引擎 dailyNewCount），
 * 并且扣掉当前未完成轮里还没轮到的新词位；引擎不可用时回落到旧统计。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const DAY = '2026-10-16';
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

function boot(opts = {}) {
  const view = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const day = { words: opts.dailyWords == null ? 39 : opts.dailyWords, listen: 0, read: 0, write: 0, min: 0 };
  const store = {
    d: {
      stats: { days: [], streak: 8, lastStudy: DAY, daily: { [DAY]: day } },
      notebook: [],
      settings: { dailyNew: 30 },
      srs: {},
    },
    flush() {},
    bookProgress() { return { total: 0, learned: 0, mastered: 0 }; },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    window: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => view },
    localStorage: null,
    App: {
      freshView: () => view, today: () => DAY,
      fmtDate: d => DAY, bars: () => '', ring: () => '', toast() {}, modal() {}, closeModal() {},
      go() {}, isNative: () => false, confirm() {}, download() {},
    },
    Store: store,
    BOOKS: [{ id: 'cet6', name: 'CET-6', sub: '', size: 100, color: '#4a7dff' }],
    Garden: {
      SPECIES: [], renderGarden: () => '<div class="garden-stub"></div>', panelHTML: () => '',
      setSchoolTree() {}, clearSchoolTree() {}, _g: () => ({ trees: [], schoolTree: null }),
      infoOf: () => null, _miniTree: () => '', ironState: () => null, drawIron: () => '',
      drawTree: () => '', investedMinutes: () => 0, dailyQuality: () => ({}),
    },
    on: () => {}, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
  });
  if (opts.engine !== false) {
    // 极简引擎桩：首页只读 load()/load().user/load().round
    const state = {
      user: { dailyNewDate: opts.engineDate === undefined ? DAY : opts.engineDate, dailyNewCount: opts.engineCount == null ? 0 : opts.engineCount },
      round: opts.round || null,
    };
    ctx.VocabEngine = { load: () => state };
  }
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/home.js'), 'utf8'), ctx);
  const V = vm.runInContext('ViewHome', ctx);
  V.render(null);
  return { html: view.innerHTML, ctx };
}

/** 从首页 HTML 里取出「今日新学单词」的数字 */
function todayWords(html) {
  const m = html.match(/今日新学单词<\/div>\s*<div class="v">(\d+)/);
  assert.ok(m, '首页应渲染「今日新学单词」卡片');
  return Number(m[1]);
}

check('首页「今日新学单词」= 引擎新词数（不再用 stats.daily.words=39 的错误口径）', () => {
  const { html } = boot({ dailyWords: 39, engineCount: 12 });
  assert.equal(todayWords(html), 12, '应显示引擎口径的 12，实际 ' + todayWords(html));
  assert.ok(html.includes('只算新词'), '页面应有口径说明（不含复习/抽检/拼写）');
});

check('首页与词书页一致：扣掉当前未完成轮里还没轮到的新词位', () => {
  const round = {
    finished: false,
    slots: [
      { role: 'new' }, { role: 'new' }, { role: 'new' }, { role: 'new' }, { role: 'new' },
      { role: 'review' },
    ],
  };
  const { html } = boot({ engineCount: 20, round });
  assert.equal(todayWords(html), 15, '20 - 5 个未轮到的新词位 = 15');
});

check('跨天（引擎计数是昨天的）→ 首页今日新词为 0', () => {
  const { html } = boot({ engineCount: 30, engineDate: '2026-10-15' });
  assert.equal(todayWords(html), 0);
});

check('引擎不可用时回落旧统计，首页不崩', () => {
  const { html } = boot({ dailyWords: 39, engine: false });
  assert.equal(todayWords(html), 39);
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项首页新词口径检查通过');
