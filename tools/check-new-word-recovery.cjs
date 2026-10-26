/* ============ check-new-word-recovery.cjs : 「每日新词一直已学完」回归 ============
 * 2026-10-22 用户反馈：词书页的「新单词」永远显示「新词已学完」，每天学不到新词。
 * 真实存档（debug/device-store-backup.json）里的状态：40 题词汇量测试答对 35 题（88%），
 * 定级把 5/6 个频带判成「整带跳过」→ 引擎里 3993 个 cet6 词有 3630 个被惰性定成 L3，
 * L0 新词 = 0，且界面没有恢复入口（「全部取消跳过」只清 srs 镜像，不动引擎层级）。
 * 本回归锁住：
 *   1) _engineNewLeft() 只统计当前词书（跨词书状态不得参与）；
 *   2) 没新词但有「从未真正作答过」的词时，词书页出现「恢复新词」入口；
 *   3) 恢复后新词回来、能组出 new 轮；真正作答过的词不受影响。
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
function makeBook(id, n) {
  const words = [];
  for (let i = 0; i < n; i++) words.push({ w: id + '_w' + i, tr: [{ t: 'n', d: '释义' + i }], freq: 100 - i });
  return { id, name: id.toUpperCase(), total: n, words };
}
function loadView() {
  const view = { innerHTML: '' };
  const store = {
    d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} }, vocabEngine: null, skipBatches: [] },
    flush() {},
    srsOf(b, w) { return (this.d.srs[b] || {})[w] || null; },
    srsUpdate(b, w, r) { (this.d.srs[b] = this.d.srs[b] || {})[w] = r; },
    nbHas() { return false; }, addStat() {}, logActivity() {}, nbAdd() { return true; },
    bookProgress() { return { total: 12, learned: 0, mastered: 0, reviewing: 0, skipped: 0 }; },
    skipInfo(b) { const x = (this.d.skipBatches || []).filter(y => y.book === b); return { batches: x.length, liveSkipped: 0, last: x[x.length - 1] || null }; },
    undoTestSkip(b) {
      const arr = this.d.skipBatches || [];
      let i = arr.length - 1;
      while (i >= 0 && arr[i].book !== b) i--;
      if (i < 0) return 0;
      const batch = arr.splice(i, 1)[0];
      const srs = this.d.srs[b] || (this.d.srs[b] = {});
      let n = 0;
      for (const w of batch.words) if (srs[w] && srs[w].skipped) { delete srs[w]; n++; }
      return n;
    },
  };
  const ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map, RegExp, Error, setTimeout, clearTimeout,
    window: {}, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: null,
    App: { today: () => '2026-10-22', fmtDate: () => '2026-10-22', toast() {}, freshView: () => view, shuffle: a => a.slice(), pick: (a, n) => a.slice(0, n), pageSeconds: () => 60, resetPageTimer() {} },
    Store: store, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v), on: () => {},
    BOOKS: [{ id: 'cet6', name: 'CET-6' }],
    Speech: { stop() {}, stopIfBusy() {}, speakWord() {}, speak() {} },
    SRS: { schedule: r => r || {}, describe: () => '', stageName: s => 'L' + s },
    WordLevel: null, buildChoices: () => ({ opts: ['a', 'b', 'c', 'd'], answer: 0 }),
    bk0name: b => b.name, modeName: m => m,
    Dict: { content: {}, cache: {}, meaningRows: w => w.tr || [] },
    Garden: { noteWord() {} }, AI: { ready: false, lookup: async () => ({}) },
  });
  ctx.window = ctx;
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  load('js/vocab-engine.js');
  ctx.window.VocabEngine = vm.runInContext('VocabEngine', ctx);
  load('js/vocab-quiz.js');
  load('js/views/vocab.js');
  const V = vm.runInContext('ViewVocab', ctx);
  return { V, ctx, store, view };
}
(async () => {
  await check('跨词书：_engineNewLeft 只统计当前词书（旧实现用别书状态数减本书总数 → 恒 0）', () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    for (let i = 0; i < 30; i++) E.stateOf('cet4:other' + i, 's0', true).level = 3;   // 另一本词书 30 个状态
    V.book = makeBook('cet6', 12);
    const left = V._engineNewLeft();
    assert.equal(left, 12, 'cet6 一个词都没学过时，新词数应等于 12，实际 ' + left);
  });

  await check('全被定级成 L3（levelAttempts=0）→ 显示「新词已学完」+「恢复新词」入口', () => {
    const { V, ctx, view, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V.book = makeBook('cet6', 12);
    const Q = ctx.window.VocabQuiz;
    for (const e of Q.bookEntries(V.book)) { const st = E.stateOf(e.wordId, 's0', true); st.level = 3; st.attempts = 0; st.levelAttempts = 0; st.inQuizPool = true; }
    E.load().user.skipBands = [0, 1, 2, 3, 5];
    V._renderShell(null);
    assert.equal(V._engineNewLeft(), 0, '全部定到 L3 后没有 L0 新词');
    assert.equal(V._engineRecoverable(), 12, '12 个词都从未真正作答过，应都可恢复');
    assert.ok(view.innerHTML.includes('新词已学完'), '应提示新词已学完');
    assert.ok(/data-act="recover-new"/.test(view.innerHTML), '应出现「恢复新词」按钮');
    assert.ok(/可恢复 12 词/.test(view.innerHTML), '按钮应写明可恢复数量');
  });

  await check('点「恢复新词」→ 新词回来、能组出 new 轮；真考过的词保持 L3', () => {
    const { V, ctx, view, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V.book = makeBook('cet6', 12);
    const Q = ctx.window.VocabQuiz;
    const entries = Q.bookEntries(V.book);
    entries.forEach((e, i) => {
      const st = E.stateOf(e.wordId, 's0', true);
      if (i === 0) { st.level = 3; st.attempts = 5; st.levelAttempts = 5; }   // 真考过的词
      else { st.level = 3; st.attempts = 0; st.levelAttempts = 0; st.inQuizPool = true; }
    });
    E.load().user.skipBands = [0, 1, 2, 3, 5];
    V._renderShell(null);
    assert.ok(V._engineRecoverable() === 11, '只有 11 个从未作答的词可恢复');
    V._recoverNewWords();
    assert.equal(V._engineNewLeft(), 11, '恢复后应有 11 个新词');
    assert.ok(view.innerHTML.includes('开始学习'), '恢复后主按钮应回到「开始学习」');
    const kept = E.stateOf(entries[0].wordId, 's0', false);
    assert.equal(kept.level, 3, '真正作答过的词不应被重置');
    V._begin('new');
    const round = E.load().round;
    assert.ok(round && round.mode === 'new', '应组出 new 轮');
    assert.ok(round.slots.some(s => s.role === 'new'), '轮里应有新词位');
  });

  await check('定级数据一并清空：恢复后 ensurePlacementLevel 不会再把这些词定回 L1/L3', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V.book = makeBook('cet6', 12);
    const Q = ctx.window.VocabQuiz;
    for (const e of Q.bookEntries(V.book)) { const st = E.stateOf(e.wordId, 's0', true); st.level = 3; st.levelAttempts = 0; }
    E.load().user.bandAccuracy = { 0: 1, 1: 0.9 };
    E.load().user.skipBands = [0, 1];
    V._recoverNewWords();
    const u = E.load().user;
    assert.equal(JSON.stringify(u.skipBands), '[]', 'skipBands 应清空');
    assert.equal(JSON.stringify(u.bandAccuracy), '{}', 'bandAccuracy 应清空');
    const entry = Q.bookEntries(V.book)[0];
    const st = E.ensurePlacementLevel(entry);
    assert.equal(st.level, 0, '恢复后惰性定级不应再把它定到 L1/L3');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项新词恢复检查通过');
})();