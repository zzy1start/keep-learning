/* ============ check-exam-scoring.cjs : 四六级写作/翻译评分标准 ============
 * 用户反馈：
 *   1. 作文明显跑题仍得 19/30（63%）；
 *   2. 四六级写作/翻译不是 30 分制；
 *   3. 修改建议“综合”和“结构”重复。
 * 本套锁住：标准分制、偏题最低档、四六级 prompt、建议页签互斥。
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

function loadAI() {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Map, Set,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) },
    App: { toast() {}, modal() {}, closeModal() {} },
    Store: { d: { settings: { ai: {} }, writing: {}, translation: {} } },
    fetch: async () => { throw new Error('network disabled'); },
    navigator: {},
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ai.js'), 'utf8'), ctx);
  return { ctx, AI: vm.runInContext('AI', ctx), LocalAI: vm.runInContext('LocalAI', ctx) };
}

function loadTranslationView(AI) {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Map, Set,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {},
    document: { querySelector: () => null, querySelectorAll: () => [] },
    App: { toast() {}, modal() {}, closeModal() {} },
    Store: { d: { translation: {}, settings: {} } },
    AI,
    $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    on: () => {}, Dict: { content: { writing: { tasks: [] } } },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'views', 'translation.js'), 'utf8'), ctx);
  return { ctx, V: vm.runInContext('ViewTranslate', ctx) };
}

const { AI, LocalAI } = loadAI();

check('标准分制：四六级写作 15、翻译 15；考研写作 20、英语一翻译 10、英语二翻译 15', () => {
  assert.equal(AI.examMax({ level: 'CET-4' }, 'writing'), 15);
  assert.equal(AI.examMax({ level: 'CET-6' }, 'writing'), 15);
  assert.equal(AI.examMax({ level: 'CET-6' }, 'translation'), 15);
  assert.equal(AI.examMax({ level: '考研' }, 'writing'), 20);
  assert.equal(AI.examMax({ examPaper: 'english-1' }, 'translation'), 10);
  assert.equal(AI.examMax({ examPaper: 'english-2' }, 'translation'), 15);
});

check('写作 prompt：四六级标准、满分 15、四维之和 = total、偏题 ≤5/15', () => {
  const s = AI.writingStandard('CET-6', 15);
  assert.match(s, /大学英语四\/六级/);
  assert.match(s, /15 分/);
  assert.match(s, /四维之和必须等于 total/);
  assert.match(s, /≤5\/15/);
  assert.match(s, /偏题|跑题/);
  const k = AI.writingStandard('考研', 20);
  assert.match(k, /考研/);
  assert.match(k, /≤6\.6\/20/);
});

check('偏题硬门槛：19/30 压到 5/15，四维同步缩放且 comment 首句标注', () => {
  const r = AI.capWritingTaskResponse({
    score: { TR: 4, CC: 6, LR: 5, GRA: 4, total: 19, max: 30 },
    taskResponse: { onTopic: false, openingMatched: false, reason: '写成如何交朋友，未使用规定开头句' },
    comment: '语言尚可。',
  }, 15);
  assert.equal(r.score.total, 5);
  assert.equal(r.score.max, 15);
  assert.ok(Math.abs((r.score.TR + r.score.CC + r.score.LR + r.score.GRA) - 5) < 1e-6);
  assert.ok(r.comment.startsWith('【偏题/未按要求开头】'));
  assert.equal(r.offTopic, true);
});

check('偏题硬门槛：模型漏填 taskResponse，但评语写“完全偏题”也要压分', () => {
  const r = AI.capWritingTaskResponse({
    score: { TR: 4, CC: 6, LR: 5, GRA: 4, total: 19, max: 30 },
    comment: '最大问题是完全偏题：题目要求 appearance anxiety，本文写成如何交真正的朋友。',
  }, 15);
  assert.equal(r.score.total, 5);
  assert.equal(r.offTopic, true);
});

check('偏题硬门槛：切题作文不被误压', () => {
  const r = AI.capWritingTaskResponse({
    score: { TR: 12, CC: 11, LR: 11, GRA: 10, total: 44, max: 60 },
    taskResponse: { onTopic: true, openingMatched: true },
    comment: '切题。',
  }, 15);
  assert.equal(r.score.total, 44, '切题时不在这里压分；等比换算由 writing 视图统一处理');
  assert.equal(r.score.max, 60);
  assert.equal(r.offTopic, undefined);
});

check('本地兜底评分跟随标准满分（不再写死 30）', () => {
  const r = LocalAI.gradeWriting('题目', 'This is a short essay about the topic. It has several sentences. However, it is still short.', { max: 15 });
  assert.equal(r.score.max, 15);
  assert.ok(r.score.total > 0 && r.score.total <= 15);
  assert.match(r.comment, /\/15/);
});

check('翻译页满分：四六级 15，不被旧 expectScore=30 覆盖；英语一 10', () => {
  const { V } = loadTranslationView(AI);
  V.mode = 'exam';
  assert.equal(V._maxScore({ level: 'CET-6', expectScore: 30 }), 15);
  assert.equal(V._maxScore({ examPaper: 'english-1', expectScore: 30 }), 10);
  assert.equal(V._maxScore({ examPaper: 'english-2', expectScore: 30 }), 15);
  assert.equal(V._maxScore({ expectScore: 10 }), 10);   // 自定义题保留自填
});

check('修改建议：去掉重复的“综合”，四个页签互斥（内容/结构、语言、词汇、句式）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'views', 'writing.js'), 'utf8');
  assert.ok(!src.includes("['all', '综合']"), '不应再有“综合”页签');
  for (const label of ['内容与结构', '语言表达', '词汇升级', '句式语法', '语义与信息', '译文表达']) {
    assert.ok(src.includes(label), '缺少页签：' + label);
  }
  assert.ok(!/tab === 'all'/.test(src), 'sugHTML 不应再拼“全部”重复列表');
  assert.ok(src.includes("sugHTML(r, 'structure')"), '默认应显示内容/结构分类');
});

check('题目要求给定开头句：代码侧硬门槛把 19/30 压到 5/15', () => {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Map, Set,
    window: {}, document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) },
    App: { toast() {}, modal() {}, closeModal() {} },
    Store: { d: { writing: {}, translation: {}, settings: {} } },
    AI, esc: v => String(v == null ? '' : v), on: () => {},
    Picker: {}, Dict: { content: { writing: { tasks: [] } } }, Speech: {},
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'views', 'writing.js'), 'utf8'), ctx);
  const cap = vm.runInContext('capMissingOpening', ctx);
  const prompt = `Directions: For this part, you are allowed 30 minutes to write an essay that begins with the sentence "People are now increasingly aware of the danger of 'appearance anxiety' or being obsessed with one's looks." You should make comments.`;
  const r = { score: { TR: 4, CC: 6, LR: 5, GRA: 4, total: 19, max: 30 }, comment: '语言尚可。' };
  cap(r, prompt, 'With the development of technology, more people like to judge a person from appearance.', 15);
  assert.equal(r.score.total, 5);
  assert.equal(r.score.max, 15);
  assert.ok(r.comment.includes('未按题目要求开头'));
  assert.equal(r.offTopic, true);
  const ok = { score: { TR: 3, CC: 3, LR: 3, GRA: 3, total: 12, max: 15 }, comment: '切题。' };
  cap(ok, prompt, prompt.match(/sentence "([^"]+)/)[1] + ' I agree with this view and will discuss it below.', 15);
  assert.equal(ok.score.total, 12, '按要求开头的作文不应被这道门槛压分');
});

check('题库：所有 CET 写作题 expectScore 改为 15', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'content', 'writing.json'), 'utf8'));
  const bad = (d.tasks || []).filter(t => /CET|四级|六级/i.test(String(t.level || '')) && Number(t.expectScore) !== 15);
  assert.deepEqual(bad.map(t => t.id), [], '仍有 CET 题不是 15 分');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项四六级评分标准检查通过');
