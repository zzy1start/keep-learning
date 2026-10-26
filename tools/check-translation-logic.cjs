/* ============ check-translation-logic.cjs : 翻译逻辑自检 ============
 * 覆盖三块：①chrF 移植是否与上游一致 ②完整性/对齐等本地规则 ③四维缩放不变量。
 *
 * 【golden 值的来源】
 * 下方 GOLDEN 中的 chrF 数值由**上游 sacrebleu 实现**（vendor/sacrebleu/chrf.py，
 * commit c596d9d2072a8f84200574a7a5c56c618e8d37e8，Apache-2.0）在同样入参下算出，
 * 与 js/translate-metric.js 的移植结果逐条比对通过（19/19，误差 < 1e-9）。
 * 上游需要最小包壳才能直接调用，可复现实现在 tools/sacrebleu-crosscheck/：
 * 因此这些数字不是手写估计值，而是可直接追溯到上游实现的对照值。
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require(path.join(__dirname, '../js/translate-metric.js'));

const TOL = 1e-6;
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < TOL, (message || '') + ' 期望 ' + expected + '，实际 ' + actual);
}

/* ---------- 一、chrF 与上游一致（golden 来自 sacrebleu） ---------- */
const GOLDEN = [
  ['identical-en', 'The results surprised the team.', 'The results surprised the team.', {}, 100],
  ['unrelated-en', 'The cat sat on the mat.', 'Quantum physics explains gravity.', {}, 7.872978559559033],
  ['partial-en', 'The results surprised the team.', 'The results shocked the team.', {}, 69.13862146890712],
  ['partial-zh', '结果让团队感到意外。', '结果让团队非常意外。', {}, 40.317460317460316],
  ['punctuation-en', 'Hello, world!', 'Hello world', {}, 56.34300935055761],
  ['whitespace-on', 'a b c', 'abc', { whitespace: true }, 29.411764705882348],
  ['beta-1', 'The results surprised the team.', 'The results shocked the team.', { beta: 1 }, 67.38260078902864],
  ['chrfpp-en', 'The results surprised the team, and the manager was happy.',
    'The results surprised the team, and the manager was pleased.', { wordOrder: 2 }, 85.56596376771287],
  ['chrfpp-punct', 'Hello, (world)! Yes.', 'Hello (world) Yes.', { wordOrder: 2 }, 54.37807710970915],
  ['cross-lingual-en-zh', 'In traditional Chinese culture, exchanging gifts is a courtesy.',
    '在中国传统文化中，亲朋好友之间互赠礼物是一种礼俗。', {}, 0],
];

for (const [name, hyp, ref, opts, expected] of GOLDEN) {
  check('chrF 与上游一致：' + name, () => near(M.chrf(hyp, ref, opts), expected, name));
}

check('空串/单侧为空都返回 0，不抛异常', () => {
  near(M.chrf('', ''), 0);
  near(M.chrf('', '结果'), 0);
  near(M.chrf('结果', ''), 0);
});

check('完全相同的长文本得满分 100', () => {
  const s = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼俗。';
  near(M.chrf(s, s), 100);
});

check('相似度单调：改一个字比改一半分低', () => {
  const ref = 'The results surprised the team completely.';
  const close = M.chrf('The results surprised the team completely!', ref);
  const far = M.chrf('A cat sat quietly on the mat.', ref);
  assert.ok(close > far, '相近译文应得分更高：' + close + ' vs ' + far);
});

check('chrfMulti 取多参考中的最高分', () => {
  const hyp = '结果让团队感到意外。';
  const best = M.chrfMulti(hyp, ['完全无关的句子。', hyp]);
  near(best, 100);
  near(M.chrfMulti(hyp, []), 0);
});

/* ---------- 二、完整性检查 ---------- */
check('题号标记识别：考研英语一 5 个编号句', () => {
  const src = '(46) He went home.\n(47) She stayed.\n(48) They left.\n(49) It rained.\n(50) We waited.';
  assert.equal(M.countItemMarkers(src), 5);
});

check('只译一句 → 覆盖率 0.2 并给出漏译原因', () => {
  const src = '(46) He went home. (47) She stayed. (48) They left.';
  const cov = M.coverage(src, '他回家了。', { direction: 'en2cn' });
  assert.equal(cov.ratio, 0.2);
  assert.ok(cov.triggers.some(t => t.includes('明显漏译')), '应提示明显漏译：' + cov.note);
});

check('完整作答不触发任何门槛', () => {
  const src = 'He went home and read a book about Chinese history.';
  const cov = M.coverage(src, '他回家后读了一本关于中国历史的书。', { direction: 'en2cn' });
  assert.equal(cov.ratio, 1, '不该误伤正常译文：' + cov.note);
  assert.equal(cov.triggers.length, 0);
});

check('空译文覆盖率 0', () => {
  const cov = M.coverage('He went home.', '', { direction: 'en2cn' });
  assert.equal(cov.ratio, 0);
});

/* ---------- 三、无 AI 时的本地评分 ---------- */
const sentence = { en: 'The results surprised the team.', cn: '结果让团队感到意外。' };
const fullSentence = { en: 'The results surprised the team.', cn: '结果让团队感到意外。' };

check('无参考译文时如实拒绝评分，不猜分', () => {
  const r = M.localGrade({ prompt: 'Some English source.' }, '某段中文译文。', { direction: 'en2cn', max: 10 });
  assert.equal(r.gradingFailed, true);
  assert.ok(!r.score || !r.score.total, '不该给出编造的分数');
});

check('有参考译文时给出分数、四维与参考译文', () => {
  const r = M.localGrade(fullSentence, '结果让团队感到意外。', { direction: 'en2cn', max: 10 });
  assert.equal(r.gradingFailed, undefined);
  assert.equal(r.score.max, 10);
  assert.ok(r.score.total > 8, '与参考译文完全一致的翻译应得高分，实际 ' + r.score.total);
  assert.equal(r.polished, fullSentence.cn);
  assert.equal(r.degraded, true);
  assert.ok(r.comment.includes('chrF'), '评语要说明依据是 chrF');
});

check('本地评分区分好坏译文', () => {
  const good = M.localGrade(fullSentence, '结果让团队感到意外。', { direction: 'en2cn', max: 10 });
  const bad = M.localGrade(fullSentence, '猫坐在垫子上。', { direction: 'en2cn', max: 10 });
  assert.ok(good.score.total > bad.score.total, '贴合参考译文的得分应更高');
});

check('本地评分的四维之和等于总分且不超每维上限', () => {
  const r = M.localGrade(fullSentence, '结果让团队感到意外。', { direction: 'en2cn', max: 10 });
  const s = r.score;
  const sum = s.TR + s.CC + s.LR + s.GRA;
  near(sum, s.total, '四维之和应等于总分');
  for (const k of ['TR', 'CC', 'LR', 'GRA']) assert.ok(s[k] <= s.max / 4 + 0.01, k + ' 超过每维上限');
});

/* ---------- 四、AI 结果的对齐校正 ---------- */
check('相似度极低却给高分 → 建议压到满分一半', () => {
  const a = M.align(28, 30, 8, { reference: '结果让团队感到意外。', referenceLength: 10 });
  assert.equal(a.checked, true);
  assert.equal(a.relation, 'mismatch-high-score');
  assert.equal(a.suggestCap, 15);
  assert.ok(M.alignNote(a, 28, 15).includes('建议人工复核'));
});

check('相似度极低且本来就是低分 → 只确认不压分', () => {
  const a = M.align(4, 30, 8, { reference: '结果让团队感到意外。', referenceLength: 10 });
  assert.equal(a.relation, 'low-aligned');
  assert.equal(a.suggestCap, null);
});

check('相似度极高却给低分 → 只提示，不自动加分', () => {
  const a = M.align(5, 30, 96, { reference: '结果让团队感到意外。', referenceLength: 10 });
  assert.equal(a.relation, 'mismatch-low-score');
  assert.equal(a.suggestCap, null, '不得自动加分');
  assert.ok(M.alignNote(a, 5, 5).includes('未自动加分'));
});

check('参考译文过短 → 不参与对齐（避免噪声）', () => {
  const a = M.align(28, 30, 90, { reference: '礼物', referenceLength: 2 });
  assert.equal(a.checked, false);
});

/* ---------- 五、缩分不变量 ---------- */
check('scaleScore：四维等比缩放且和严格等于新总分', () => {
  const score = { TR: 7, CC: 8, LR: 6, GRA: 5, total: 26, max: 30 };
  const scaled = M.scaleScore(score, 15);
  near(scaled.total, 15);
  near(scaled.TR + scaled.CC + scaled.LR + scaled.GRA, 15, '四维之和');
  for (const k of ['TR', 'CC', 'LR', 'GRA']) assert.ok(scaled[k] <= 7.5 + 1e-9, k + ' 超过 max/4');
});

check('scaleScore：封顶到满分时每维恰好 max/4', () => {
  const scaled = M.scaleScore({ TR: 0, CC: 0, LR: 0, GRA: 0, total: 0, max: 10 }, 10);
  near(scaled.TR, 2.5);
  near(scaled.CC, 2.5);
  near(scaled.LR, 2.5);
  near(scaled.GRA, 2.5);
  near(scaled.total, 10);
});

check('scaleScore：目标为 0 时不产生负数', () => {
  const scaled = M.scaleScore({ TR: 5, CC: 5, LR: 5, GRA: 5, total: 20, max: 20 }, 0);
  near(scaled.total, 0);
  near(scaled.TR + scaled.CC + scaled.LR + scaled.GRA, 0);
});

check('localRatio：chrF 越高、完整性越差越低', () => {
  assert.ok(M.localRatio(100, 1) > M.localRatio(60, 1));
  assert.ok(M.localRatio(60, 1) > M.localRatio(60, 0.2));
  assert.ok(M.localRatio(0, 1) >= 0 && M.localRatio(100, 1) <= 1);
});

check('语种判定：汉字 vs 拉丁字母', () => {
  assert.equal(M.script('在中国传统文化中，亲朋好友之间互赠礼物'), 'zh');
  assert.equal(M.script('A library gives people a quiet place to read.'), 'en');
  assert.equal(M.script('12345 .,!?'), 'unknown');
  assert.equal(M.script(''), 'unknown');
});

check('方向自动判定：中文原文=汉译英，英文原文=英译汉', () => {
  const zh = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。';
  assert.equal(M.directionOf(zh), 'cn2en', '中文原卷应判为汉译英');
  assert.equal(M.directionOf('A library gives people a quiet place to read and learn.'), 'en2cn');
  assert.equal(M.directionOf(''), null);
});

check('方向判定不被夹带的英文注释带偏（真实四级题：中文正文 + 英文括注）', () => {
  const real = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。'
    + '中国人遵循“礼尚往来”(mutually exchanging courtesies)的传统。';
  assert.equal(M.directionOf(real), 'cn2en');
});
check('原文来源口径：translationText 优先于 prompt（与界面一致）', () => {
  const task = { prompt: 'Part IV Translation (30 minutes) Directions: ...', translationText: '在中国传统文化中，互赠礼物是一种礼仪。', title: '中国传统赠礼' };
  assert.equal(M.sourceOf(task), '在中国传统文化中，互赠礼物是一种礼仪。');
  assert.equal(M.sourceOf({ prompt: 'Directions: ...' }), 'Directions: ...', '没有正文时才退到 prompt');
  assert.equal(M.sourceOf({ en: 'A library.', cn: '图书馆。' }), 'A library.', '单句题退到 en');
  assert.equal(M.sourceOf({}), '');
});
if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项检查通过');