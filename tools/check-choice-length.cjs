/* ============ check-choice-length.cjs : 「答案总是最长的那条」长度偏差自检 ============
 * 背景（2026-10-25 用户反馈）：词汇量测试与背单词的四选一里，正确项几乎总是最长的一项，
 *   可以只看长度猜答案。根因：
 *     · js/dict.js buildChoices：正确项 = 1~2 个词性的释义拼起来，干扰项只有 1 条；
 *     · js/vocab-quiz.js choiceFor：正确项 _correctDef 拼前两个义项，干扰项只 1 条。
 * 修复：四项统一为「词性 + 单条常见释义」，并按 |字数差| 优先挑长度接近的干扰项。
 * 本套用真实词库统计「正确项是不是最长 / 长度排名 / 长度比」，断言长度不再泄露答案：
 *   · 正确项"严格最长"比例 ≤ 0.35（随机期望 0.25）
 *   · 正确项"严格最短"比例 ≤ 0.35
 *   · 平均长度排名 ∈ [2.0, 3.0]（1=最长 … 4=最短，随机期望 2.5）
 *   · 正确项字数 / 其它三项平均字数 ∈ [0.8, 1.3]
 * 覆盖 5 本词书 × 两条出题链路（背单词 choiceFor / 词汇量测试 buildVocabTest）。
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
function seededRand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function loadDict() {
  const src = fs.readFileSync(path.join(ROOT, 'js/dict.js'), 'utf8');
  const fetchStub = async url => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')),
    text: async () => fs.readFileSync(path.join(ROOT, url), 'utf8'),
  });
  const ctx = vm.createContext({ fetch: fetchStub, console, Store: { d: {} } });
  vm.runInContext(src, ctx);
  return vm.runInContext('Dict', ctx);
}
/** 统计一批选项的长度分布：返回 {n, longest, shortest, rankSum, ratioSum} */
function makeStats() {
  return { n: 0, longest: 0, shortest: 0, rankSum: 0, ratioSum: 0, tieTop: 0, empty: 0, dup: 0, worst: [] };
}
function addStats(st, opts, ai, tag) {
  if (!opts || opts.length !== 4 || ai < 0) return;
  const texts = opts.map(o => String(o == null ? '' : o));
  const lens = texts.map(o => o.length);
  const cl = lens[ai];
  const others = lens.filter((_, i) => i !== ai);
  const otherAvg = others.reduce((a, b) => a + b, 0) / others.length;
  const max = Math.max(...lens), min = Math.min(...lens);
  if (cl === max && lens.filter(x => x === max).length === 1) st.longest++;
  if (cl === min && lens.filter(x => x === min).length === 1) st.shortest++;
  /* 并列最长时选"最长"仍然选不到唯一答案（不构成答案泄露），单独统计 */
  if (cl === max) st.tieTop++;
  if (texts.some(t => !t.trim())) st.empty++;
  if (new Set(texts).size !== 4) st.dup++;
  // 排名：1 = 最长；并列取平均名次
  const rank = 1 + lens.filter(x => x > cl).length + (lens.filter(x => x === cl).length - 1) / 2;
  st.rankSum += rank;
  if (otherAvg > 0) st.ratioSum += cl / otherAvg;
  st.n++;
  const dev = Math.abs(cl - otherAvg);
  if (st.worst.length < 5 && dev >= 6) st.worst.push(tag + ' [' + lens.join(',') + '] ' + JSON.stringify(opts[ai]));
}
function fmt(st) {
  return {
    n: st.n,
    longest: +(st.longest / st.n).toFixed(3),
    tieTop: +(st.tieTop / st.n).toFixed(3),
    shortest: +(st.shortest / st.n).toFixed(3),
    meanRank: +(st.rankSum / st.n).toFixed(2),
    ratio: +(st.ratioSum / st.n).toFixed(3),
    empty: st.empty,
    dup: st.dup,
  };
}

const BOOKS = ['cet4', 'cet6', 'kaoyan', 'sat', 'toefl'];

(async () => {
  const Dict = loadDict();
  await Dict.loadGlobal();
  try { await Dict.loadForms(); } catch (e) { /* forms 可选 */ }
  const rand = seededRand(20261025);
  const qctx = vm.createContext({
    window: {}, console, Dict, Math, JSON, Object, Array, String, Number, Set, Map, WeakMap,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-quiz.js'), 'utf8'), qctx);
  const Quiz = vm.runInContext('window.VocabQuiz', qctx);

  const summary = { quiz: {}, placement: {} };
  for (const id of BOOKS) {
    const bk = await Dict.load(id);
    const entries = Quiz.bookEntries(bk);
    const randQ = seededRand(20261025 + id.length);

    /* ---------- 链路 1：背单词 choiceFor（引擎出题） ---------- */
    const sq = makeStats();
    const pick = [];
    for (const e of entries) if ((e.senses || []).length >= 2) pick.push(e);          // 全部多义词
    entries.filter(e => (e.senses || []).length === 1).slice(0, 250).forEach(e => pick.push(e)); // 单义词抽样
    for (const e of pick) {
      for (const s of (e.senses || []).slice(0, 2)) {
        const q = Quiz.choiceFor({ entry: e, sense: s }, bk, { rand: randQ });
        addStats(sq, q.opts, q.answer, id + ':' + e.word + '#' + s.senseId);
      }
    }
    summary.quiz[id] = fmt(sq);
    check('背单词 ' + id + '：正确项不再系统性最长（' + JSON.stringify(summary.quiz[id]) + '）', () => {
      assert.ok(sq.n >= 300, '样本太少：' + sq.n);
      const f = summary.quiz[id];
      assert.ok(f.longest <= 0.35, '正确项"严格最长"比例过高：' + f.longest);
      assert.ok(f.shortest <= 0.35, '正确项"严格最短"比例过高：' + f.shortest);
      assert.ok(f.meanRank >= 2.0 && f.meanRank <= 3.0, '平均长度排名偏离随机：' + f.meanRank);
      assert.ok(f.ratio >= 0.8 && f.ratio <= 1.3, '正确项/其余平均长度比偏离 1：' + f.ratio);
      assert.ok(f.tieTop <= 0.5, '"正确项属于最长（含并列）"比例过高：' + f.tieTop);
      assert.ok(f.empty === 0, '出现空选项：' + f.empty);
      assert.ok(f.dup === 0, '选项重复：' + f.dup);
    });

    /* ---------- 链路 2：词汇量测试 buildVocabTest（dict.js） ---------- */
    const AppStub = {
      shuffle: arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
      pick: (arr, n) => AppStub.shuffle(arr).slice(0, n),
    };
    const dctx = vm.createContext({
      window: {}, console, fetch: async () => ({ ok: false }), Store: { d: {} },
      Dict, App: AppStub, Math, JSON, Object, Array, String, Number, Set, Map, WeakMap,
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/dict.js'), 'utf8'), dctx);
    const buildVocabTest = vm.runInContext('buildVocabTest', dctx);
    const sp = makeStats();
    for (let round = 0; round < 20; round++) {
      const qs = buildVocabTest(bk, 40);
      for (const q of qs) addStats(sp, q.opts, q.a, id + ':' + q.w);
    }
    summary.placement[id] = fmt(sp);
    check('词汇量测试 ' + id + '：正确项不再系统性最长（' + JSON.stringify(summary.placement[id]) + '）', () => {
      assert.ok(sp.n >= 700, '样本太少：' + sp.n);
      const f = summary.placement[id];
      assert.ok(f.longest <= 0.35, '正确项"严格最长"比例过高：' + f.longest);
      assert.ok(f.shortest <= 0.35, '正确项"严格最短"比例过高：' + f.shortest);
      assert.ok(f.meanRank >= 2.0 && f.meanRank <= 3.0, '平均长度排名偏离随机：' + f.meanRank);
      assert.ok(f.ratio >= 0.8 && f.ratio <= 1.3, '正确项/其余平均长度比偏离 1：' + f.ratio);
      assert.ok(f.tieTop <= 0.5, '"正确项属于最长（含并列）"比例过高：' + f.tieTop);
      assert.ok(f.empty === 0, '出现空选项：' + f.empty);
      assert.ok(f.dup === 0, '选项重复：' + f.dup);
    });
  }

  console.log('\n=== 统计汇总（longest/shortest 为严格最长/最短比例，随机期望 0.25；ratio 期望 1.0） ===');
  for (const id of BOOKS) {
    console.log(id.padEnd(7), '背单词 ', JSON.stringify(summary.quiz[id]));
    console.log(id.padEnd(7), '词汇量 ', JSON.stringify(summary.placement[id]));
  }
  console.log('\n结果：' + passed + ' 通过 / ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})();
