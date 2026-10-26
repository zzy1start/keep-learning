/* ============ check-vocab-queue.cjs : 背单词队列自检 ============
 * 目标：证明「同一个词在一轮学习里只出现一次」，并说明重复的根因（词库数据重复）。
 *
 * 两层检查：
 *   ① 词库装配层（js/dict.js）：同一拼写只保留一条，且保留信息量更大的那条；
 *      用**真实数据文件**跑（cet4/cet6/sat 本来就有重复拼写）；
 *   ② 队列层（js/views/vocab.js）：_dedupeQueue 兜底，任何来源的重复都挡掉。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

/* ---------- ① 词库装配层：真实数据 ---------- */
function loadDict() {
  const src = fs.readFileSync(path.join(ROOT, 'js/dict.js'), 'utf8');
  const fetchStub = async url => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')),
    text: async () => fs.readFileSync(path.join(ROOT, url), 'utf8'),
  });
  const ctx = vm.createContext({ fetch: fetchStub, console, Store: { d: {} } });
  vm.runInContext(src, ctx);
  return vm.runInContext('Dict', ctx);   // 顶层 const 在全局词法环境里，求值取回
}

(async () => {
  const Dict = loadDict();
  for (const id of ['cet4', 'cet6', 'sat']) {
    const bk = await Dict.load(id);
    check('词书 ' + id + ' 装配后拼写唯一（原始 ' + bk.rawTotal + ' 条 → 去重 ' + bk.words.length + ' 条）', () => {
      const keys = bk.words.map(w => String(w.w).toLowerCase());
      assert.equal(new Set(keys).size, keys.length, '仍存在重复拼写');
      assert.equal(bk.total, bk.words.length, 'total 必须等于去重后的真实数量');
      assert.ok(bk.words.length < bk.rawTotal, '这版数据本来就有重复，去重后应变少');
    });
  }

  const cet4 = Dict.books.cet4;
  check('重复词只保留一条，且保留的是信息量更大的释义', () => {
    const hits = cet4.words.filter(w => w.w === 'absorb');
    assert.equal(hits.length, 1, 'absorb 应只剩一条');
    // 原始数据里 05.json 那条释义最全（vt./吸引…注意/并入），去重后应当保留它
    assert.ok(hits[0].tr[0].d.includes('吸'), '释义应可读：' + JSON.stringify(hits[0].tr));
  });

  check('去重不改变“高频词在前”的顺序', () => {
    const freqs = cet4.words.map(w => Number(w.freq) || 0);
    for (let i = 1; i < freqs.length; i++) {
      assert.ok(freqs[i - 1] >= freqs[i], '第 ' + i + ' 条词频高于前一条，排序被破坏');
    }
  });

  /* ---------- ② 队列层：_dedupeQueue ---------- */
  const vctx = vm.createContext({ window: {}, console, document: { querySelector: () => null, querySelectorAll: () => [] },
    App: { freshView: () => ({}), toast() {}, today: () => '2026-10-06', shuffle: a => a.slice(), pick: (a, n) => a.slice(0, n) },
    Store: { d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} } }, flush() {}, srsOf: () => ({}), srsUpdate() {}, bookProgress: () => ({ total: 0, learned: 0 }), skipInfo: () => ({}) },
    $: () => null, $$: () => [], esc: v => String(v == null ? '' : v), Speech: { stop() {}, speakWord() {} },
    SRS: { schedule: () => ({}), stageName: () => '' }, WordLevel: null, buildChoices: () => [], bk0name: () => '', modeName: () => '', Dict: { content: {}, cache: {} },
  });
  /* 队列现在由词汇引擎组轮（docs/27 §5.2）：先在同一个上下文里加载引擎与出题模块 */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-engine.js'), 'utf8')
    + '\nwindow.VocabEngine = VocabEngine;', vctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-quiz.js'), 'utf8'), vctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8'), vctx);
  const V = vm.runInContext('ViewVocab', vctx);
  V._renderStudy = () => {};      // 只测队列构建，不碰 DOM

  check('_dedupeQueue：同一拼写只留第一次出现（大小写无关），缺拼写的条目丢弃', () => {
    const out = V._dedupeQueue([
      { w: 'Deserve' }, { w: 'deserve' }, { w: 'etiquette' }, { w: '' }, null, { w: 'ETIQUETTE' }, { w: 'abandon' },
    ]);
    assert.equal(out.length, 3, '去重后应只剩 3 个词');
    assert.equal(out[0].w, 'Deserve', '保留第一次出现的那条');
    assert.deepEqual(out.map(x => x.w), ['Deserve', 'etiquette', 'abandon']);
  });

  check('即使词库数据带重复，_begin 生成的队列也没有重复词（新词模式）', () => {
    const dupBook = { id: 'cet6', name: '测试词书', words: [
      { w: 'deserve', freq: 9, tr: [{ t: 'v', d: '值得' }] },
      { w: 'deserve', freq: 9, tr: [{ t: 'v', d: '值得' }] },
      { w: 'etiquette', freq: 8, tr: [{ t: 'n', d: '礼仪' }] },
      { w: 'Etiquette', freq: 7, tr: [{ t: 'n', d: '礼仪' }] },
      { w: 'abandon', freq: 6, tr: [{ t: 'v', d: '放弃' }] },
    ] };
    V.book = dupBook;
    V.mode = 'new';
    V._begin('new');
    const keys = V.queue.map(w => String(w.w).toLowerCase());
    assert.equal(new Set(keys).size, keys.length, '队列里仍有重复：' + JSON.stringify(keys));
    assert.equal(keys.length, 3, '去重后应是 3 个词，实际 ' + keys.length);
  });

  check('引擎组轮时同一个词只占一个词位（复习池/新词池不会把同词算两次）', () => {
    const now = Date.now();
    const book = { id: 'cet6', name: '测试词书', words: [
      { w: 'deserve', freq: 9, tr: [{ t: 'v', d: '值得' }] },
      { w: 'abandon', freq: 8, tr: [{ t: 'v', d: '放弃' }] },
    ] };
    V.book = book;
    V.vocabRound = null; V._doneSlots = [];
    // 让 deserve 处于 L2（复习池），abandon 从未出场（新词池）
    const E = vctx.window.VocabEngine;
    E.reset(); E.load({ d: {} , flush() {} });
    E.stateOf('cet6:deserve', 's0', true).level = 2;
    V._begin('smart');
    const keys = V.queue.map(w => String(w.w).toLowerCase());
    assert.equal(keys.filter(k => k === 'deserve').length, 1, 'deserve 只应出现一次：' + JSON.stringify(keys));
    assert.equal(new Set(keys).size, keys.length, '一轮内不允许重复词位：' + JSON.stringify(keys));
    assert.ok(now > 0);
  });

  check('背单词卡片的发音入口走 Speech.speakWord（1.0 语速 + 防吞音）', () => {
    const calls = [];
    const vctx2 = vm.createContext({
      window: {}, console,
      document: { querySelector: () => null, querySelectorAll: () => [] },
      App: { toast() {}, today: () => '2026-10-06' },
      Store: { d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} } } },
      $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
      Speech: { stopIfBusy() { calls.push(['stopIfBusy']); }, speakWord(w) { calls.push(['speakWord', w]); }, speak(w) { calls.push(['speak', w]); } },
      SRS: {}, WordLevel: null, buildChoices: () => [], bk0name: () => '', modeName: () => '', Dict: { content: {}, cache: {} },
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8'), vctx2);
    const V2 = vm.runInContext('ViewVocab', vctx2);
    V2.cur = { w: { w: 'deserve' } };
    V2._sayCur(false);
    assert.ok(calls.some(c => c[0] === 'speakWord' && c[1] === 'deserve'),
      '应调用 speakWord，实际：' + JSON.stringify(calls));
    assert.ok(!calls.some(c => c[0] === 'speak'), '不应再直接调用 speak（会丢掉防吞音参数）');
  });

  check('点认识/不认识/熟悉会强制重播单词（自动朗读仍去重）', () => {
    const calls = [];
    let stops = 0;
    const vctx3 = vm.createContext({
      window: {}, console, setTimeout, clearTimeout,
      document: { querySelector: () => null, querySelectorAll: () => [] },
      App: { toast() {}, today: () => '2026-10-06' },
      Store: { d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} } } },
      $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
      Speech: { stopIfBusy() { stops++; }, speakWord(w) { calls.push(w); }, speak(w) { calls.push(w); } },
      SRS: {}, WordLevel: null, buildChoices: () => [], bk0name: () => '', modeName: () => '', Dict: { content: {}, cache: {} },
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8'), vctx3);
    const V3 = vm.runInContext('ViewVocab', vctx3);
    V3.cur = { w: { w: 'deserve' } };
    V3._sayCur(true);                      // 进入卡片自动播放
    assert.equal(calls.length, 1, '自动播放一次');
    V3._sayCur(true);                      // 800ms 内重渲染 → 去重
    assert.equal(calls.length, 1, '自动朗读应去重，避免连读两遍');
    assert.equal(stops, 1, '重复自动朗读不应打断第一次朗读');
    V3._forceSay = true;                   // 用户点了 认识 / 不认识 / 熟悉
    V3._sayCur(true);
    assert.equal(calls.length, 2, '用户点击必须重播该单词');
    assert.equal(stops, 2, '手动重播应打断前一次朗读');
    assert.equal(V3._forceSay, false, '强制标记只生效一次');
  });
  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项队列检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
