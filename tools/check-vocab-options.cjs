/* ============ check-vocab-options.cjs : 出题选项自检（多义词歧义排查）============
 * 背景（2026-10-17）：用户在做「认识 → 限时四选一」时遇到 grave 的选项里同时出现
 *   "名词 墓地" 和 "形容词 严重的" —— 两个都是正确释义，选哪个都可能被判错。
 * 根因：vocab-quiz.choiceFor 曾把"该词自己的其他义项"当干扰项（旧 §5.3 设计）。
 * 修复：干扰项一律取其他词；多义辨析改由引擎的义项轮换体现（docs/27 §12）。
 *
 * 本套用**真实词库**逐词抽查（所有多义词的全部义项 + 单义词抽样），断言：
 *   · 每题 4 个选项、互不重复
 *   · 正确项 = 目标义项，且选项里只有本题目标词的这一个义项
 *   · 任何该词其他义项的释义文本都不出现在选项里
 * 同时打印每个词书的"多义词规模"，供排查报告引用。
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

/** 可复现的伪随机（审计结果稳定） */
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BOOKS = ['cet4', 'cet6', 'kaoyan', 'sat', 'toefl'];

(async () => {
  const Dict = loadDict();
  /* 【2026-10-17】出题义项现在用「词书 + 内置词典」合并后的常见义，必须把全局词典载入，
   * 否则测到的还是词书单条释义（ear 那种只有生僻义的情况就测不出来）。*/
  await Dict.loadGlobal();
  try { await Dict.loadForms(); } catch (e) { /* 没有 forms 文件时不影响 */ }
  const qctx = vm.createContext({ window: {}, console, Dict, Math, JSON, Object, Array, String, Number, Set, Map });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-quiz.js'), 'utf8'), qctx);
  const Quiz = vm.runInContext('window.VocabQuiz', qctx);
  const rand = seededRand(20261017);
  const isRareDef = d => /^[（(]/.test(d) || /(人名|地名|商标)/.test(d);

  for (const id of BOOKS) {
    const bk = await Dict.load(id);
    const entries = Quiz.bookEntries(bk);
    const multi = entries.filter(e => (e.senses || []).length >= 2);
    let checked = 0;
    const problems = [];

    const verify = (entry, sense) => {
      const q = Quiz.choiceFor({ entry, sense }, bk, { rand });
      checked++;
      const tag = entry.word + '#' + sense.senseId;
      if (q.opts.length !== 4) problems.push(tag + ' 选项数 ' + q.opts.length);
      if (new Set(q.opts).size !== 4) problems.push(tag + ' 选项重复 ' + JSON.stringify(q.opts));
      if (q.ids[q.answer] !== entry.wordId + '#' + sense.senseId) problems.push(tag + ' 答案下标错');
      const own = q.ids.filter(x => x.startsWith(entry.wordId + '#'));
      if (own.length !== 1) problems.push(tag + ' 自词义项出现 ' + own.length + ' 个：' + JSON.stringify(q.ids));
      /* 其他义项若与目标义项释义文本完全相同（词库里有重复释义的数据），不算歧义 */
      const otherDefs = entry.senses
        .filter(s => s.senseId !== sense.senseId && s.defZh !== sense.defZh)
        .map(s => s.defZh);
      const hit = q.opts.filter(o => otherDefs.includes(o));
      if (hit.length) problems.push(tag + ' 干扰项含自词其他义项：' + JSON.stringify(hit));
      /* 常见义优先：带"（…）"限定/人名义的生僻释义不能当正确选项
       * （整词只有生僻义的词无可奈何，单独统计 rareOnly）*/
      if (isRareDef(sense.defZh) && !entry.senses.every(s => isRareDef(s.defZh))) {
        problems.push(tag + ' 生僻义被出成正确项：' + sense.defZh);
      }
    };

    /* 多义词：所有义项都查 */
    for (const e of multi) for (const s of e.senses) verify(e, s);
    /* 单义词：抽样（每本最多 300 个） */
    const singles = entries.filter(e => (e.senses || []).length === 1);
    for (const e of singles.slice(0, 300)) verify(e, e.senses[0]);

    /* 生僻义清理统计。
     * 注意：isRareDef 用“以括号开头”做启发式，会把正常的语法/使动释义也标进来，
     * 例如 “（使）变高”“(he的宾格)他”“（罗马天主教的）教皇”。这些不是生僻义。
     * 真正要防的是 mixedRare（有常见义时仍残留生僻行）和 problems（生僻义被出成正确项）；
     * rareOnly 只是统计量，阈值放宽到 20，避免误伤正常数据。*/
    const rareOnly = entries.filter(e => e.senses.every(s => isRareDef(s.defZh)));
    const mixedRare = entries.filter(e => e.senses.some(s => isRareDef(s.defZh)) && e.senses.some(s => !isRareDef(s.defZh)));

    check('词书 ' + id + '：多义词 ' + multi.length + '/' + entries.length
      + '，抽查 ' + checked + ' 题，无"多个正确释义"、无生僻义正确项'
      + '（纯生僻词 ' + rareOnly.length + '）', () => {
      assert.equal(problems.length, 0, problems.slice(0, 6).join('；') + (problems.length > 6 ? ' …共 ' + problems.length + ' 个' : ''));
      assert.equal(mixedRare.length, 0, '有常见义时仍残留生僻行：' + mixedRare.slice(0, 4).map(e => e.word).join(','));
      assert.ok(rareOnly.length <= 20, '整词只有生僻义的词过多：' + rareOnly.length);
      assert.equal(rareOnly.length, entries.filter(e => e.senses.every(s => isRareDef(s.defZh))).length, '统计口径自洽');
    });

    /* 用户遇到的具体词回归（真实词库里存在才开始断言） */
    const grave = entries.find(e => e.word === 'grave');
    if (grave && grave.senses.length >= 2) {
      check('词书 ' + id + '：grave（4 义项）的题目里不再出现两个正确释义', () => {
        for (const s of grave.senses) {
          const q = Quiz.choiceFor({ entry: grave, sense: s }, bk, { rand });
          const own = q.ids.filter(x => x.startsWith(grave.wordId + '#'));
          assert.equal(own.length, 1, 'grave#' + s.senseId + ' 出现了 ' + own.length + ' 个自词义项：' + JSON.stringify(q.ids));
        }
      });
    }

    /* 用户遇到的 ear 回归：出题义项必须是常见义（耳朵），不能拿"（稻麦等的）穗"这种生僻义当正确项 */
    const ear = entries.find(e => e.word === 'ear');
    if (ear) {
      check('词书 ' + id + '：ear 的出题义项用常见义（耳朵），不用生僻义（稻麦等的）穗', () => {
        const defs = ear.senses.map(s => s.defZh);
        assert.ok(defs.some(d => d.includes('耳朵')), '出题义项应包含常见义"耳朵"：' + JSON.stringify(defs));
        assert.ok(!defs.some(d => /^[（(]/.test(d)), '出题义项不应以（…）生僻义开头：' + JSON.stringify(defs));
        assert.ok(defs[0].includes('耳朵'), '第一义项应是常见义：' + defs[0]);
      });
    }
  }

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项出题选项检查通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
