/* ============ check-reading-feedback.cjs : 2026-11 阅读模块用户反馈回归 ============
 * 覆盖用户本轮 11 条反馈（选词填空本段翻译/词库词性释义/按正确答案分析/语法语义判断/
 * 词库可划词/固定搭配释义/修改模式吸顶/段落匹配重复字母与判分/AI 核验/页脚混入）。
 * 做法：vm 加载真实 js/views/reading.js + 真实 js/text-repair.js，stub Dict/AI/App/DOM，
 * 直接调用方法断言行为；不启动浏览器、不发网络请求。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/views/reading.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/modules.css'), 'utf8');
const NL = String.fromCharCode(10);

let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

const BOOK = {
  advocate: [{ t: 'n', d: '拥护者，支持者，提倡者' }, { t: 'v', d: '主张，拥护，鼓吹' }],
  arise: [{ t: 'v', d: '(问题或困境)出现，发生' }],
  emphasized: [{ t: 'v', d: '强调，使明显' }],
  encounter: [{ t: 'n', d: '相遇，邂逅' }, { t: 'v', d: '遇到，遭遇' }],
  essential: [{ t: 'n', d: '必需品，必不可少的东西' }, { t: 'adj', d: '必不可少的' }],
  evaporation: [{ t: 'n', d: '蒸发' }],
  extinction: [{ t: 'n', d: '灭绝，绝种' }],
  obscure: [{ t: 'adj', d: '无名的，鲜为人知的；费解的' }],
  particular: [{ t: 'adj', d: '特定的，特指的' }],
  posed: [{ t: 'v', d: '造成，引起，产生(问题、危机等)' }],
  scenario: [{ t: 'n', d: '（行动的）方案，剧情概要，分镜头剧本' }, { t: 'n', d: '可能发生的事，可能出现的情况，情形' }],
  severely: [{ t: 'adv', d: '严重地' }],
  shrewdly: [{ t: 'adv', d: '精明干练地' }],
  species: [{ t: 'n', d: '种，物种' }],
  variety: [{ t: 'n', d: '多样化，种类，品种' }],
  qualitative: [{ t: 'adj', d: '性质的，定性的' }],
  argue: [{ t: 'v', d: '争论，争辩' }],
};

function makeDict() {
  const entries = {};
  Object.keys(BOOK).forEach(w => {
    entries[w] = { w: w, ph: '', tr: BOOK[w], phr: [], ex: [] };
  });
  entries.argue.phr = [{ p: 'argue with', d: '与…争论' }, { p: 'argue about', d: '就…争论' }];
  return {
    content: { reading: { passages: [] } },
    get(word) {
      const w = String(word || '').toLowerCase();
      if (entries[w]) return ['', 'v. 争论', ''];
      return null;
    },
    inBook(book, word) { return entries[String(word || '').toLowerCase()] || null; },
  };
}

function loadView(opts) {
  const o = opts || {};
  const view = { innerHTML: '' };
  const store = {
    d: { activeBook: 'cet6', readLog: {} },
    flush() {}, addStat() {}, logActivity() {}, nbAdd() { return true; },
  };
  const ai = {
    ready: !!o.ready,
    translate: async text => { ai.__lastTranslate = text; return '译文'; },
    verifyReading: async () => ({ status: 'verified', items: [] }),
    explainCloze: async () => ({ status: 'failed', items: [] }),
    verifyMatching: async () => ({ status: 'failed', items: [] }),
    glossPhrase: async () => ({ cn: '' }),
  };
  const documentStub = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {}, contains() { return true; }, toggle() {} }, style: {}, innerHTML: '', appendChild() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: null, document: documentStub, localStorage: null,
    App: {
      toast() {}, freshView: () => view, freshNode: () => null,
      closeModal() {}, modal() {}, confirm() {}, mmss: s => String(s),
      words: t => String(t || '').trim().split(/\s+/).filter(Boolean), pageSeconds: () => 60, resetPageTimer() {},
    },
    Store: store, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    on: () => {}, Picker: { html: () => '', bind() {}, filter: a => a, familyLabel: x => x },
    /* 允许由真实 js/done.js 覆盖（见下），这里留占位避免未加载时引用报错 */
    Dict: makeDict(), AI: ai, Speech: { stop() {}, speak() {} },
    ViewNotebook: { open() {} }, Importer: { open() {} },
    fullLabel: () => '', sessionLabel: x => x,
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/text-repair.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/done.js'), 'utf8'), ctx);
  vm.runInContext(SRC, ctx);
  const V = vm.runInContext('ViewRead', ctx);
  V.mode = 'edit'; V.submitted = false; V.answers = {}; V.marks = {};
  V.readType = 'section-a'; V._paraCn = {}; V._paraOpen = new Set(); V._reRenderPassage = () => {};
  return { V, ctx, ai, store, view };
}

/* ---------- 夹具：真实的 2023-06 CET6 选词填空（三段 + 一段里有页脚） ---------- */
const BANK = ['advocate', 'arise', 'emphasized', 'encounter', 'essential', 'evaporation', 'extinction', 'obscure', 'particular', 'posed', 'scenario', 'severely', 'shrewdly', 'species', 'variety']
  .map((w, i) => ({ letter: String.fromCharCode(65 + i), word: w }));
const P1 = 'Unthinkable as it may be, humanity, every last person, could someday be wiped from the face of the Earth. We have learned to worry about asteroids and super volcanoes, but the more likely __26__ , according to Nick Bostrom, a professor of philosophy at Oxford, is that we humans will destroy ourselves.';
const P2 = 'Professor Bostrom has argued that human __27__ risks are poorly understood and, worse still, __28__ underestimated by society.';
const P3 = 'At the same time, when a system no longer provides opportunities for the majority to participate in wealth building, it not only robs those who are excluded from opportunities, but 2023 年 3 月英语六级真题第 1 套第 5 页，共 8 页 also deprives them of their dignity.';
const CLoze = [P1, P2, P3].join(NL + NL);

function sectionA(overrides) {
  const p = Object.assign({
    id: 'test-section-a', title: 'Philosophy/Technology', level: 'CET-6', readingType: 'section-a',
    paragraphs: [CLoze], clozeText: CLoze, wordBank: BANK.map(x => ({ letter: x.letter, word: x.word })),
    totalScore: 5,
    questions: [
      { number: 26, q: P1, a: 'K' },
      { number: 27, q: P2, a: 'N' },
      { number: 28, q: P2, a: 'L' },
      { number: 29, q: P3, a: 'H' },
    ],
  }, overrides || {});
  return p;
}

function sectionB(overrides) {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'I', 'K', 'L', 'M', 'N', 'O'];
  const paragraphs = labels.map((label, i) => ({ label: label, text: 'Paragraph ' + (i + 1) + ' source sentence.' }));
  return Object.assign({
    id: 'test-section-b', title: 'San Francisco', level: 'CET-6', readingType: 'section-b',
    paragraphs: paragraphs, totalScore: 10,
    questions: [
      { number: 36, statement: 'Housing is expensive.', a: null },
      { number: 37, statement: 'Approval should be simplified.', a: null },
    ],
  }, overrides || {});
}

(async () => {
  /* ---------- ① 本段翻译：逐段、带正确选项 ---------- */
  await check('本段翻译：导入篇 paragraphs 只有 1 段时，仍按 clozeText 切成 3 段（第 2/3 段可点）', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    assert.equal(V._parasOf(p).length, 3, '应有 3 段，实际 ' + V._parasOf(p).length);
    assert.ok(V._parasOf(p)[1].indexOf('Professor Bostrom') === 0, '第 2 段应是 Professor 段');
  });

  await check('本段翻译：按段翻译，不再把全文塞给 AI；正确选项已填回空位', async () => {
    const { V, ai } = loadView();
    const p = sectionA();
    V.cur = p;
    V.answers[0] = 'C';                         // 用户选错（C=emphasized）
    V._reRenderPassage = () => {};
    await V._togglePara(1);
    assert.ok(ai.__lastTranslate.indexOf('Professor Bostrom') === 0, '翻的应是第 2 段：' + ai.__lastTranslate.slice(0, 40));
    assert.ok(ai.__lastTranslate.indexOf('species') >= 0, '第 27 空应填入正确选项 species');
    assert.ok(ai.__lastTranslate.indexOf('severely') >= 0, '第 28 空应填入正确选项 severely');
    assert.ok(ai.__lastTranslate.length < 400, '不应是整篇（实际 ' + ai.__lastTranslate.length + ' 字符）');
  });

  await check('本段翻译：段内附「本段正确选项 + 中文释义」', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    V._paraOpen.add(p.id + '_0');
    const html = V._paraTransHTML(p, V._parasOf(p)[0], 0);
    assert.ok(html.indexOf('本段正确选项') >= 0, '缺少正确选项块');
    assert.ok(html.indexOf('scenario') >= 0, '缺少正确选项词');
    assert.ok(/[\u4e00-\u9fff]{2}/.test(html), '缺少正确选项中文释义');
    /* 没有展开译文时允许回退词典义；有译文/AI 语境义的一致性由下面两项专测 */
    assert.ok(html.indexOf('k) scenario') >= 0 || html.indexOf('K) scenario') >= 0, '应显示字母+单词');
  });

  /* ---------- ② 长难句分析用正确答案 ---------- */
  await check('长难句分析：选词填空的句子用正确答案（不用用户选错的答案）', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    V.answers[0] = 'C';
    const sentence = V._clozeSentenceText(P1, p);
    assert.ok(sentence.indexOf('scenario') >= 0, '应使用正确答案 scenario：' + sentence.slice(0, 80));
    assert.ok(sentence.indexOf('emphasized') < 0, '不应使用用户错误答案 emphasized');
  });

  /* ---------- ③ 修改模式词库：可点 + 按词性释义 ---------- */
  await check('词库：修改模式下每个词都渲染成可点单词（data-w），做题模式仍是纯文本', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    V.mode = 'edit';
    const editHtml = V._renderWordBank(p, true);
    assert.ok(editHtml.indexOf('data-w="advocate"') >= 0, '修改模式词库缺少可点单词');
    V.mode = 'exam';
    const examHtml = V._renderWordBank(p, true);
    assert.ok(examHtml.indexOf('data-w=') < 0, '做题模式不应渲染可点单词');
  });

  await check('词库：修改模式给出按词性分类的释义（名词在动词前，字母+词+意思）', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    const html = V._wordBankAnalysisHTML(p);
    assert.ok(html.indexOf('read-bank-analysis') >= 0, '缺少词性释义块');
    const n = html.indexOf('<b>名词</b>');
    const v = html.indexOf('<b>动词</b>');
    assert.ok(n >= 0 && v > n, '应先列名词再列动词：n=' + n + ' v=' + v);
    assert.ok(html.indexOf('<i>A)</i>') >= 0 && html.indexOf('advocate') >= 0, '缺少 A) advocate 形式');
    assert.ok(html.indexOf('拥护者') >= 0 && html.indexOf('主张，拥护') >= 0, '一词多义应分别列在各词性下');
  });

  /* ---------- ④ 语法判断 / 语义判断 ---------- */
  await check('答案解析：用【语法判断】【语义判断】替代「原文依据」', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    V.submitted = true;
    V.answers[0] = 'C';
    p.questions[0]._clozeExplain = { grammar: 'more likely 后接名词，作表语', semantics: '语境指「更可能出现的情形」' };
    const html = V._clozeExplanationHTML(0);
    assert.ok(html.indexOf('语法判断') >= 0 && html.indexOf('语义判断') >= 0, '缺少语法/语义判断');
    assert.ok(html.indexOf('原文依据') < 0, '不应再出现「原文依据」');
    assert.ok(html.indexOf('正确答案') >= 0 && html.indexOf('scenario') >= 0, '应显示正确选项');
    assert.ok(html.indexOf('名词') >= 0, '应显示正确选项词性');
  });

  /* ---------- ⑤ 固定搭配：点击显示释义 ---------- */
  await check('固定搭配：面板 chip 带本地释义与点击查询标记', () => {
    const { V } = loadView();
    V.cur = sectionA();
    V.selected = { type: 'word', text: 'argue' };
    V.anTab = 'word'; V.hist = []; V.aiInline = false;
    const html = V._anPanel();
    assert.ok(html.indexOf('data-colloc="argue with"') >= 0, '固定搭配缺少 data-colloc');
    assert.ok(html.indexOf('data-cn="与…争论"') >= 0, '固定搭配缺少本地中文释义');
    assert.ok(html.indexOf('an-colloc-row') >= 0, '缺少点击释义容器');
  });

  await check('固定搭配：_showColloc 把释义写进容器（本地已有释义直接显示）', async () => {
    const { V } = loadView();
    const box = { classList: { add() {}, contains() { return true; } }, innerHTML: '' };
    const row = { parentElement: {}, nextElementSibling: box, closest: () => row };
    const chip = { dataset: { colloc: 'argue with', cn: '与…争论' }, closest: () => row, parentElement: row };
    await V._showColloc(chip);
    assert.ok(box.innerHTML.indexOf('argue with') >= 0, '未显示搭配本身');
    assert.ok(box.innerHTML.indexOf('与…争论') >= 0, '未显示搭配释义');
  });

  await check('固定搭配：AI 深度解析里的搭配 chip 也可点（data-colloc）', () => {
    const { V } = loadView();
    const html = V._aiInlineHTML({ word: 'argue', collocation: ['argue with', 'argue about'], pos: [], synonym: [], antonym: [], recent: [] });
    assert.ok(html.indexOf('data-colloc="argue with"') >= 0, 'AI 块搭配缺少 data-colloc');
    assert.ok(SRC.indexOf("'[data-colloc]'") >= 0, '缺少 data-colloc 点击绑定');
  });

  /* ---------- ⑥ 段落匹配：重复字母修复 / 判分 ---------- */
  await check('段落匹配：重复 I（缺 J）自动修成 A–O，选项唯一', () => {
    const { V } = loadView();
    const p = sectionB();
    V.cur = p;
    V.readType = 'section-b';
    const labels = V._matchingLabels(p);
    assert.equal(labels.length, 15);
    assert.equal(JSON.stringify(labels), JSON.stringify('ABCDEFGHIJKLMNO'.split('')));
    const values = V._answerOptions(p).map(o => o.value);
    assert.equal(new Set(values).size, values.length, '选项字母仍有重复：' + values.join(','));
  });

  await check('段落匹配：本来就跳过 I 的 14 段卷子（A–H,J–O）保持原字母不被顺延', () => {
    const { V } = loadView();
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O'];
    const p = sectionB({ paragraphs: labels.map((l, i) => ({ label: l, text: 'p' + i })) });
    assert.equal(JSON.stringify(V._matchingLabels(p)), JSON.stringify(labels));
  });

  await check('段落匹配：数字答案按修好的段落字母映射（不再全判错）', () => {
    const { V } = loadView();
    const p = sectionB();
    V.cur = p;
    V.readType = 'section-b';
    p.questions[0].a = 7;
    assert.equal(V._answerValue(p.questions[0].a), 'H', '下标 7 应映射 H');
    assert.equal(V._answerValue('j'), 'J');
  });

  await check('段落匹配：提交后得分按字母正确计算', () => {
    const { V } = loadView();
    const p = sectionB({ totalScore: 10 });
    V.cur = p;
    V.readType = 'section-b';
    p.questions[0].a = 'H';
    p.questions[1].a = 'I';
    V.answers = { 0: 'H', 1: 'I' };
    V.submitted = true;
    assert.equal(V._score(), 10, '全对应得 10 分');
    V.answers = { 0: 'H', 1: 'K' };
    assert.equal(V._score(), 5, '错一题应得 5 分');
  });

  await check('段落匹配：提交后每题显示 ✓/✗ 与正确答案', () => {
    const { V } = loadView();
    const p = sectionB({ questions: [{ number: 36, statement: 'Housing is expensive.', a: 'H' }] });
    V.cur = p;
    V.readType = 'section-b';
    V.submitted = true;
    V.answers = { 0: 'I' };
    const html = V._renderQuestions(p);
    assert.ok(html.indexOf('read-special-question wrong') >= 0, '错误题缺少 wrong 样式');
    assert.ok(html.indexOf('✗ 错误') >= 0, '缺少 ✗ 错误');
    assert.ok(html.indexOf('正确答案 H') >= 0, '缺少正确答案字母');
    V.answers = { 0: 'H' };
    const ok = V._renderQuestions(p);
    assert.ok(ok.indexOf('read-special-question right') >= 0 && ok.indexOf('✓ 正确') >= 0, '正确题未显示 ✓');
  });

  /* ---------- ⑦ 特殊题型 AI 自动核验 ---------- */
  await check('AI 核验：选词填空提交时自动核验并写回语法/语义判断', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = sectionA();
    p.questions[0].a = null;
    V.cur = p;
    ai.explainCloze = async args => {
      assert.ok(args.wordBank && args.wordBank.length === 15, '应传入词库');
      assert.equal(args.questions.length, 4, '应传入全部题目');
      return { status: 'partial', items: [{ index: 0, answer: 'K', word: 'scenario', grammar: 'g', semantics: 's', meaning: '可能出现的情形', evidence: '' }] };
    };
    await V._verifyCurrentReading();
    assert.equal(p.questions[0].a, 'K', '缺答案时应补上 AI 核验答案');
    assert.equal(p.questions[0]._clozeExplain.grammar, 'g');
    assert.equal(p.questions[0]._clozeExplain.meaning, '可能出现的情形', '语境义应写回');
    assert.equal(p._answerVerification.status, 'partial');
  });

  await check('AI 核验：题库已有答案时不覆盖，只标出 AI 不一致', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = sectionA();
    V.cur = p;
    ai.explainCloze = async () => ({ status: 'partial', items: [{ index: 0, answer: 'A', grammar: 'g', semantics: 's' }] });
    await V._verifyCurrentReading();
    assert.equal(p.questions[0].a, 'K', '不应覆盖题库答案');
    assert.equal(p.questions[0]._aiAnswer, 'A', '应记录 AI 核对结果');
  });

  await check('AI 核验：段落匹配提交时自动核验，答案/语法语义写回', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = sectionB();
    V.cur = p;
    V.readType = 'section-b';
    ai.verifyMatching = async args => {
      assert.equal(args.paragraphs.length, 15);
      assert.equal(args.paragraphs[9].label, 'J', '第 10 段应修成 J');
      return { status: 'verified', items: [
        { index: 0, answer: 'H', grammar: '陈述与段落 H 的因果结构一致', semantics: 'H 段讲住房成本', evidence: 'Paragraph 8 source sentence.' },
      ] };
    };
    await V._verifyCurrentReading();
    assert.equal(p.questions[0].a, 'H');
    assert.equal(p.questions[0]._matchingJudgement.semantics.length > 0, true);
    assert.equal(p._answerVerification.status, 'partial', '只核验 2 题中的 1 题应为 partial');
  });

  await check('AI 核验：未配置 AI 时落 unavailable 状态且不抛错（重新核验按钮可点）', async () => {
    const { V } = loadView({ ready: false });
    const p = sectionB();
    V.cur = p;
    V.readType = 'section-b';
    V.submitted = true;
    await V._verifyCurrentReading();
    assert.equal(p._answerVerification.status, 'unavailable');
    const actions = V._answerActionsHTML(p);
    assert.ok(actions.indexOf('未配置 AI') >= 0, '按钮区应提示未配置 AI');
  });

  await check('AI 核验：核验后清空过期的本段翻译缓存（答案变了译文要重生成）', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = sectionA();
    V.cur = p;
    V._paraCn = { 'x_0': '旧译文' };
    V._paraOpen = new Set(['x_0']);
    ai.explainCloze = async () => ({ status: 'verified', items: [] });
    await V._verifyCurrentReading();
    assert.equal(Object.keys(V._paraCn).length, 0, '过期译文缓存应清空');
    assert.equal(V._paraOpen.size, 0, '过期展开态应清空');
  });

  /* ---------- ⑦b 词义一致性 / 解析折叠 / 错题红框（2026-11 第二轮反馈） ---------- */
  await check('本段正确选项：优先 AI 语境义（与译文一致），不再显示词典第一义', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    p.questions[0]._clozeExplain = { grammar: 'g', semantics: 's', meaning: '可能出现的情形' };
    V._paraOpen.add(p.id + '_0');
    const html = V._paraTransHTML(p, V._parasOf(p)[0], 0);
    assert.ok(html.indexOf('可能出现的情形') >= 0, '缺少 AI 语境义');
    assert.ok(html.indexOf('分镜头剧本') < 0, '不应显示词典第一义（方案/剧情）');
  });

  await check('没有 AI 语境义时：按本段译文挑义项（scenario → 情形，而不是方案/剧情）', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    p.questions[0]._clozeExplain = null;
    V._paraCn[p.id + '_0'] = '更可能的情形是我们人类会毁灭自己。';
    V._paraOpen.add(p.id + '_0');
    const html = V._paraTransHTML(p, V._parasOf(p)[0], 0);
    assert.ok(html.indexOf('情形') >= 0, '应挑到含「情形」的义项');
    assert.ok(html.indexOf('分镜头剧本') < 0, '不应显示词典第一义');
  });

  await check('一段多空：只展开一题解析，其余折叠（details，默认开 1 个）', () => {
    const { V } = loadView();
    const p = sectionA({ clozeText: P2, paragraphs: [P2],
      questions: [{ number: 27, q: P2, a: 'N' }, { number: 28, q: P2, a: 'L' }] });
    V.cur = p; V.submitted = true; V.answers = { 0: 'B', 1: 'L' };
    const html = V._renderCloze(p, true);
    assert.ok(html.indexOf('section-a-explain-details') >= 0, '多空应折叠');
    assert.equal((html.match(/\bopen\b/g) || []).length, 1, '只允许一题默认展开');
    assert.equal((html.match(/sa-explain-summary/g) || []).length, 2, '两题都应有摘要');
  });

  await check('单空段落不折叠：保持原来的解析卡', () => {
    const { V } = loadView();
    const p = sectionA({ clozeText: P1, paragraphs: [P1], questions: [{ number: 26, q: P1, a: 'K' }] });
    V.cur = p; V.submitted = true; V.answers = { 0: 'K' };
    const html = V._renderCloze(p, true);
    assert.ok(html.indexOf('section-a-explain-details') < 0, '单空不应折叠');
    assert.ok(html.indexOf('section-a-explain ') >= 0 || html.indexOf('section-a-explain right') >= 0, '应保留解析卡');
  });

  await check('段落匹配：答错整卡红框、答对绿框、未提交无色', () => {
    const { V } = loadView();
    const p = sectionB({ questions: [{ number: 36, statement: 'Housing is expensive.', a: 'H' }] });
    V.cur = p; V.readType = 'section-b'; V.submitted = true;
    V.answers = { 0: 'I' };
    assert.ok(V._matchingReviewCard(p.questions[0], 0).indexOf('review-wrong') >= 0, '错题应加 review-wrong');
    V.answers = { 0: 'H' };
    assert.ok(V._matchingReviewCard(p.questions[0], 0).indexOf('review-right') >= 0, '对题应加 review-right');
    V.submitted = false;
    assert.ok(V._matchingReviewCard(p.questions[0], 0).indexOf('review-') < 0, '未提交不应标色');
  });

  /* ---------- ⑧ 页脚混入正文 ---------- */
  await check('页脚：段落中混入的「2023 年 3 月英语六级真题…共 8 页」会被清掉且不粘词', () => {
    const { V } = loadView();
    const p = sectionA();
    V.cur = p;
    const text = V._parasOf(p)[2];
    assert.ok(text.indexOf('共 8 页') < 0, '页脚未被清除：' + text.slice(-90));
    assert.ok(text.indexOf('but also deprives') >= 0, '删除页脚后应保持 but also（不粘连）：' + text.slice(-90));
  });

  await check('页面首渲染也走清洗后的段落（传统阅读不再显示页脚）', () => {
    const { V } = loadView();
    const p = { id: 't', title: 't', level: 'CET-6', readingType: 'traditional', totalScore: 10,
      paragraphs: ['Intro sentence __ no blank here. ' + 'At the same time it not only robs them, but 2023 年 3 月英语六级真题第 1 套第 5 页，共 8 页 also deprives them.'],
      questions: [] };
    V.cur = p; V.readType = 'traditional'; V.mode = 'edit';
    const html = V._readingContentHTML(p);
    assert.ok(html.indexOf('共 8 页') < 0, '首渲染仍带页脚');
    assert.ok(html.indexOf('数据') < 0);
    assert.ok(V._parasOf(p)[0].indexOf('but also deprives') >= 0);
  });

  /* ---------- ⑨ 修改模式吸顶布局（CSS 契约） ---------- */
  await check('布局：修改模式词库不再吸顶，且渲染带 is-static', () => {
    assert.ok(CSS.indexOf('.read-section-a-bank-wrap.is-static{position:static') >= 0, 'CSS 缺少 is-static 规则');
    assert.ok(SRC.indexOf("'is-static'") >= 0, 'reading.js 未按模式输出 is-static');
  });

  await check('布局：右侧划线分析用撑满整行的 an-side 包裹，sticky 才有行程', () => {
    assert.ok(SRC.indexOf('<div class="an-side"><div class="an-panel">') >= 0, 'reading.js 缺少 an-side 包裹');
    assert.ok(CSS.indexOf('.an-side{align-self:stretch') >= 0, 'CSS 缺少 an-side 拉伸');
    assert.ok(CSS.indexOf('@media (min-width:1181px)') >= 0 && CSS.indexOf('.an-side>.an-panel{position:sticky') >= 0, 'CSS 缺少桌面 an-side 内 sticky');
    assert.ok(CSS.indexOf('@media (max-width:1180px)') >= 0 && CSS.indexOf('.an-side>.an-panel{position:static') >= 0, '窄屏应回退为普通流');
  });

  await check('布局：置顶工具条 z-index 高于词库条，词库不会盖住分析面板', () => {
    const topbar = CSS.match(/\.rd-topbar\{[^}]*\}/);
    assert.ok(topbar, '缺少 .rd-topbar 规则');
    assert.ok(/z-index:20/.test(topbar[0]), '.rd-topbar 应 z-index:20，实际：' + topbar[0]);
    assert.ok(CSS.indexOf('.read-section-a-bank-wrap{position:sticky;top:64px;z-index:10') >= 0, '词库条 z-index 应为 10（低于工具条）');
  });

  /* ---------- ⑦c 页头「已做过」徽章用分数 ---------- */
  await check('页头徽章：本篇已做过显示 7/10 分，不再只显示 70%', () => {
    const { V, ctx, view, store } = loadView();
    const p = sectionA();
    ctx.Dict.content.reading.passages.push(p);
    store.d.readLog = {};
    store.d.readLog[p.id] = { score: 7, total: 10, at: 1762819200000 };
    V.readType = 'section-a'; V.mode = 'edit';
    V.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
    V._shell({ innerHTML: '' });
    const html = view.innerHTML || '';
    assert.ok(html.indexOf('本篇已做过 · 7/10 分') >= 0, '徽章应显示 7/10 分');
    assert.ok(html.indexOf('本篇已做过 · 70%') < 0, '不应再只显示 70%');
    assert.equal(ctx.DoneBook.scoreText({ score: 7, total: 10 }), '7/10 分');
    assert.equal(ctx.DoneBook.scoreText({ score: 0, total: 0 }), '');
    assert.equal(ctx.DoneBook.label('reading', p), '✓已做 7/10 分', 'Picker 下拉也应用分数');
    const listening = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(listening.indexOf('DoneBook.scoreText(doneRec)') >= 0, '听力页徽章也应用分数');
  });

  /* ---------- ⑩ 整页渲染烟雾测试：接线错误会在这里暴露（而不是用户白屏） ---------- */
  await check('整页渲染：选词填空修改模式完整渲染（词库释义 / 本段翻译按钮 / an-side 面板）', () => {
    const { V, ctx, view } = loadView();
    const p = sectionA();
    ctx.Dict.content.reading.passages.push(p);
    V.readType = 'section-a'; V.mode = 'edit';
    V.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
    V.mode = 'edit';
    V._shell({ innerHTML: '' });
    const html = view.innerHTML || '';
    assert.ok(html.length > 2000, '整页 HTML 过短：' + html.length);
    assert.ok(html.indexOf('read-bank-analysis') >= 0, '缺少词性与释义块');
    assert.ok(html.indexOf('本段翻译') >= 0, '缺少本段翻译按钮');
    assert.ok(html.indexOf('an-side') >= 0, '缺少右侧分析面板');
    assert.ok(html.indexOf('is-static') >= 0, '修改模式词库应带 is-static');
    assert.ok(html.indexOf('data-colloc') >= 0 || html.indexOf('划线分析') >= 0, '右侧面板未渲染');
  });

  await check('整页渲染：段落匹配做题模式没有重复段落字母', () => {
    const { V, ctx, view } = loadView();
    const p = sectionB();
    ctx.Dict.content.reading.passages.push(p);
    V.readType = 'section-b'; V.mode = 'exam';
    V.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
    V._shell({ innerHTML: '' });
    const html = view.innerHTML || '';
    const options = (html.match(/read-matching-options[\s\S]*?<\/div>/) || [''])[0];
    const letters = [...options.matchAll(/<strong>([A-Z])<\/strong>/g)].map(m => m[1]);
    assert.ok(letters.length >= 15, '段落选项不足 15 个：' + letters.join(','));
    assert.equal(new Set(letters).size, letters.length, '段落选项字母重复：' + letters.join(','));
  });

  await check('整页渲染：传统阅读修改模式不显示混入正文的页脚', () => {
    const { V, ctx, view } = loadView();
    const p = { id: 't2', title: 't', level: 'CET-6', readingType: 'traditional', totalScore: 10,
      paragraphs: ['At the same time it not only robs them, but 2023 年 3 月英语六级真题第 1 套第 5 页，共 8 页 also deprives them.'], questions: [] };
    ctx.Dict.content.reading.passages.push(p);
    V.readType = 'traditional'; V.mode = 'edit';
    V.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
    V._shell({ innerHTML: '' });
    const html = view.innerHTML || '';
    assert.ok(html.indexOf('共 8 页') < 0, '整页仍渲染页脚');
    assert.ok(html.indexOf('but also deprives') >= 0, '正文被误伤：' + html.slice(0, 200));
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项阅读反馈检查通过');
})();
