/* ============ check-vocab-round-stats.cjs : 轮外练习（拼写/随机）完成页统计 ============
 * 用户真机反馈：拼写进度完成后出现「本轮征服 / 本轮正确率 / 升级」为空（正确率显示 —%）。
 * 根因：拼写/随机是轮外练习（vocabRound=null，判分走 engine.gradeFree），
 * 完成页只从 engine.report(round) 取数，取不到就退化成 queue.length 和 "—"。
 * 本套盯住：轮外练习也要有真实的本轮数字，且完成页不再出现 "—%"。
 */
'use strict';
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

function makeBook() {
  const words = [
    { w: 'deserve', ph: '', tr: [{ t: 'v', d: '值得' }], ex: [], freq: 90 },
    { w: 'abandon', ph: '', tr: [{ t: 'v', d: '放弃' }], ex: [], freq: 89 },
    { w: 'etiquette', ph: '', tr: [{ t: 'n', d: '礼仪' }], ex: [], freq: 88 },
    { w: 'scale', ph: '', tr: [{ t: 'n', d: '规模' }], ex: [], freq: 87 },
    { w: 'compliment', ph: '', tr: [{ t: 'n', d: '赞美' }], ex: [], freq: 86 },
    { w: 'mitigate', ph: '', tr: [{ t: 'v', d: '缓解' }], ex: [], freq: 85 },
  ];
  return { id: 'cet6', name: '测试词书', size: words.length, words };
}

function loadView() {
  const view = { innerHTML: '' };
  const store = {
    d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} }, vocabEngine: null, createdAt: '2026-10-01' },
    flush() {}, srsOf(book, w) { return (store.d.srs[book] || {})[w] || null; },
    srsUpdate(book, w, rec) { (store.d.srs[book] = store.d.srs[book] || {})[w] = rec; },
    nbHas() { return false; }, addStat() {}, logActivity() {}, nbAdd() { return true; },
    bookProgress() { return { total: 6, learned: 3, mastered: 1, reviewing: 2 }; },
    skipInfo() { return { liveSkipped: 0, batches: 0, last: null }; },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    window: {}, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: null,
    App: { today: () => '2026-10-16', fmtDate: () => '2026-10-16', toast() {}, freshView: () => view,
      shuffle: a => a.slice(), pick: (a, n) => a.slice(0, n), pageSeconds: () => 60, resetPageTimer() {} },
    Store: store, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    on: () => {}, BOOKS: [{ id: 'cet6', name: '测试词书' }],
    Speech: { stop() {}, stopIfBusy() {}, speakWord() {}, speak() {} },
    SRS: { schedule: rec => rec || {}, describe: () => '待复习', stageName: s => ['新词', '学习中', '短期', '中期', '长期'][Math.min(4, s || 0)] },
    WordLevel: null, buildChoices: () => ({ opts: ['a', 'b', 'c', 'd'], answer: 0 }),
    bk0name: b => b.name, modeName: m => ({ smart: '智能', new: '新词', review: '复习', random: '随机', spell: '拼写' }[m] || m),
    Dict: { content: {}, cache: {}, meaningRows: w => w.tr || [] },
    Garden: { noteWord() {} }, AI: { ready: false, lookup: async () => ({}) },
  });
  ctx.window = ctx;
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  load('js/vocab-engine.js');
  vm.runInContext('window.VocabEngine = VocabEngine;', ctx);
  load('js/vocab-quiz.js');
  load('js/views/vocab.js');
  const V = vm.runInContext('ViewVocab', ctx);
  V.book = makeBook();
  return { V, ctx, store, view };
}

check('轮外练习统计：拼写 3 对 1 错 → total=4 / 正确率 75% / 难词与升级可列出', () => {
  const { V } = loadView();
  V.mode = 'spell';
  V._resetFreeStats('spell');
  V._noteFreeResult({ correct: true }, 'cet6:deserve', 's0');
  V._noteFreeResult({ correct: true }, 'cet6:abandon', 's0');
  V._noteFreeResult({ correct: false }, 'cet6:etiquette', 's0');
  V._noteFreeResult({ correct: true, feedback: { upgraded: true } }, 'cet6:scale', 's0');
  const rep = V._freeReport();
  assert.ok(rep, '轮外练习必须有报告，不能是 null');
  assert.equal(rep.total, 4, '本轮词位数应为 4，实际 ' + rep.total);
  assert.equal(rep.correct, 3);
  assert.equal(Math.round((1 - rep.roundErrorRate) * 100), 75, '正确率应为 75%，实际 ' + rep.roundErrorRate);
  assert.equal(rep.upgraded.length, 1, '升级词应被记录');
  assert.equal(rep.nextRoundFocus.length, 1, '错词应进入下轮优先');
  assert.equal(rep.upgraded[0].wordId, 'cet6:scale');
});

check('同一词位重复作答不重复计入本轮征服（第一次对错定正确率）', () => {
  const { V } = loadView();
  V._resetFreeStats('spell');
  V._noteFreeResult({ correct: false }, 'cet6:deserve', 's0');
  V._noteFreeResult({ correct: true }, 'cet6:deserve', 's0');
  const rep = V._freeReport();
  assert.equal(rep.total, 1, '一个词位只算一次，实际 ' + rep.total);
  assert.equal(rep.correct, 0, '正确率按第一次作答，拼写重试后答对不应改成正确');
});

check('完成页：拼写模式不再显示 "—%" / 升级 0，而是本轮真实数字', () => {
  const { V, store, view } = loadView();
  store.d.srs.cet6 = { deserve: { reps: 2 }, abandon: { reps: 2 }, etiquette: { reps: 2 } };
  V._begin('spell');
  assert.ok(V.slots.length >= 2, '拼写轮应有词位，实际 ' + V.slots.length);
  V._resetFreeStats('spell');
  V._noteFreeResult({ correct: true }, V.slots[0].wordId, V.slots[0].senseId);
  V._noteFreeResult({ correct: false }, V.slots[1].wordId, V.slots[1].senseId);
  V._finish();
  const html = view.innerHTML;
  assert.ok(/本轮正确率/.test(html), '完成页缺少"本轮正确率"');
  assert.ok(!/—%/.test(html), '完成页仍显示 "—%"：' + html.slice(0, 200));
  assert.ok(/50%/.test(html), '两个词位一对一错应显示 50%');
  assert.ok(/本轮征服/.test(html) && />2</.test(html), '本轮征服应显示 2');
});

check('引擎统计：已学/已掌握都只算真正作答过的词（定级批量写入不算）', () => {
  const { V, ctx, store } = loadView();
  const E = ctx.window.VocabEngine;
  E.reset(); E.load(store);
  const a = E.stateOf('cet6:deserve', 's0', true);
  a.level = 4; a.attempts = 0;              // 定级/迁移批量写入的 L4：没作答，不算已掌握
  const b = E.stateOf('cet6:abandon', 's0', true);
  b.level = 2; b.attempts = 3;              // 学过但只在 L2
  const c = E.stateOf('cet6:scale', 's0', true);
  c.level = 4; c.attempts = 5;              // 学过且到 L4：才算已掌握
  const st = E.stats();
  assert.equal(st.learned, 2, '已学应为 2（abandon/scale），实际 ' + st.learned);
  assert.equal(st.mastered, 1, '已掌握应为 1（scale），实际 ' + st.mastered);
  assert.ok(st.learned >= st.mastered, '已学不应小于已掌握');
});

check('拼写/随机 _begin 会先载入引擎真实存档（不会从空状态判分、完成页不会显示已学 0）', () => {
  const { V, ctx, store } = loadView();
  const E = ctx.window.VocabEngine;
  E.reset();
  store.d.vocabEngine = { user: {}, words: { 'cet6:deserve#s0': { level: 4, attempts: 2 } }, events: [], rounds: [], round: null };
  store.d.srs.cet6 = { deserve: { reps: 2 }, abandon: { reps: 2 } };
  V._begin('spell');
  assert.ok(V.slots.length >= 1, '拼写轮应能组出词位，实际 ' + V.slots.length);
  const loaded = E.load();
  assert.ok(loaded.words['cet6:deserve#s0'], '_begin 应把 Store.d.vocabEngine 载入引擎');
  assert.ok(E.stats().learned >= 1, '完成页 engStats 应能看到真实已学数，实际 ' + E.stats().learned);
});

check('引擎 save：写回 Store.d.vocabEngine 后再 load 不会丢掉刚写的状态', () => {
  const { ctx, store } = loadView();
  const E = ctx.window.VocabEngine;
  E.reset();
  E.load(store);
  E.stateOf('cet6:abandon', 's0', true).level = 3;
  assert.equal(E.save(store), true, '应写回 Store');
  assert.ok(store.d.vocabEngine && store.d.vocabEngine.words['cet6:abandon#s0'], '存档里应有刚写的词');
  const again = E.load(store);
  assert.ok(again.words['cet6:abandon#s0'], '再次 load 仍应读到该词');
});

check('镜像回 Store.d.srs：L4 写 interval(30 天)，首页"已掌握"不再恒 0', () => {
  const { V, ctx, store } = loadView();
  const E = ctx.window.VocabEngine;
  E.reset(); E.load(store);
  const a = E.stateOf('cet6:deserve', 's0', true);
  a.level = 4; a.attempts = 3;
  const b = E.stateOf('cet6:abandon', 's0', true);
  b.level = 2; b.attempts = 2;
  const c = E.stateOf('cet6:scale', 's0', true);
  c.level = 4; c.attempts = 0;
  E.mirrorToSrs(store, 'cet6', wid => String(wid).split(':').pop());
  assert.equal(store.d.srs.cet6.scale.interval, 0, '定级直通 L4（没作答）不应写掌握间隔');
  const prog = store.bookProgress('cet6');
  assert.ok(prog.learned >= 2, '镜像后应能算出已学 ≥2，实际 ' + prog.learned + ' keys=' + JSON.stringify(Object.keys(store.d.srs.cet6 || {})));
  assert.equal(prog.mastered, 1, 'L4 词应写入 interval>=21 → 已掌握 1，实际 ' + prog.mastered);
});

console.log('');
if (failed) { console.log('有 ' + failed + ' 项失败'); process.exitCode = 1; }
else console.log('全部 ' + passed + ' 项轮外练习统计检查通过');