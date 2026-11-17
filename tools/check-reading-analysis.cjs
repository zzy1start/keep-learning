/* ============ check-reading-analysis.cjs : 传统阅读教辅式解析回归 ============
 * 2026-11-12 用户反馈：阅读提交后每题只显示「解析 · 待核验 / 原文依据：」两行空内容，
 * 要求像官方《答案详解》那样给出【定位】【精析】【避错】。
 * 覆盖：
 *  A. AI 层：提示词契约、字母答案、1 基序号识别、依据逐字/容错定位、编造依据不丢弃整题、
 *     避错过滤、partial 状态；
 *  B. 页面层：_locateEvidence 段句定位、核验写回 _analysis、结构化解析卡、待核验空态、
 *     导入数据兼容、整页渲染烟雾测试、CSS 契约。
 * 做法：vm 加载真实 js/ai.js 与 js/views/reading.js，stub 网络/词典/DOM；不联网、不写文件。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'css/modules.css'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '：' + (e && e.message));
    process.exitCode = 1;
  }
}

/* 用户截图里的那篇（2023.03 CET-6 Passage One）同题面文本，用于验证定位与解析卡 */
const P1 = 'It has long been thought that humans are unique in their ability to think intelligently. But a study published in Science challenges our understanding of the bird world.';
const P2 = 'In the experiment, researchers presented ducks with objects of different colours and shapes. The ducks received no training at all.';
const P3 = 'The researchers found that most ducks could tell whether the objects were the same or different. Dr. Wasserman noted that our knowledge of animal minds is still limited.';
const PASSAGE = [P1, P2, P3].join('\n\n');
const Q1 = {
  number: 46,
  q: 'In what way were humans thought to be unique?',
  opts: ['Being a major source of animal intelligence.', 'Being the cornerstone of the creative world.',
    'Being capable of same-different discrimination.', 'Being able to distinguish abstract from concrete.'],
  a: 'C',
};
const Q2 = {
  number: 47,
  q: 'What do we learn from the study published in Science?',
  opts: ['Our understanding of the bird world was biased.', 'Our conception of birds intelligence was wrong.',
    'Our communication with birds was far from adequate.', 'Our knowledge about bird psychology needs updating.'],
  a: 'B',
};
const EVIDENCE1 = 'It has long been thought that humans are unique in their ability to think intelligently.';
const EVIDENCE2 = 'The ducks received no training at all.';

function analysisItem(overrides) {
  return Object.assign({
    index: 0,
    answer: 'C',
    evidence: EVIDENCE1,
    explain: '事实细节题。题干问人类曾被认为在哪方面独一无二；首句说人类被认为能进行 intelligent thought，也就是区分异同的能力，故选 C。',
    wrong: {
      A: '原文只说人类被认为能进行 intelligent thought，并没有说人类是动物智力的主要来源，属于无中生有。',
      B: 'cornerstone of the creative world 是把定位句外的东西拼在一起，原文没有提到创造世界。',
      D: '原文没有提到抽象与具体的区分，D 是把抽象词硬套上去的干扰项。',
    },
  }, overrides || {});
}

/* ---------------- A. AI 层 ---------------- */
function makeAi() {
  const state = { calls: [], queue: [] };
  const context = vm.createContext({
    window: {},
    setTimeout,
    clearTimeout,
    console: { warn() {}, log() {} },
    Store: { d: { settings: { ai: { baseUrl: 'https://api.example.com/v1', key: 'fixture-key', model: 'fixture-model', enabled: true } } } },
    App: { toast() {}, modal() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8'), context);
  const ai = context.window.AI;
  ai.jsonRetry = async (messages, opts) => {
    state.calls.push({ messages, opts });
    const next = state.queue.shift();
    if (next instanceof Error) throw next;
    return next === undefined ? { items: [] } : next;
  };
  return {
    ai,
    state,
    push(item) { state.queue.push(item); },
    reset() { state.calls.length = 0; state.queue.length = 0; },
  };
}
function userPayload(call) {
  const msg = call.messages.find(m => m.role === 'user');
  return JSON.parse(msg.content);
}

(async () => {
  await check('AI 提示词：要求 answer 用字母、精析、避错、依据逐字复制', async () => {
    const { ai, state, push } = makeAi();
    push({ items: [analysisItem()] });
    const out = await ai.verifyReading({ paragraphs: [P1, P2, P3] }, [Q1]);
    assert.equal(out.status, 'verified');
    const system = state.calls[0].messages.find(m => m.role === 'system').content;
    assert.match(system, /精析/, '提示词缺少【精析】要求');
    assert.match(system, /避错/, '提示词缺少【避错】要求');
    assert.match(system, /逐字/, '提示词必须要求依据逐字复制');
    assert.match(system, /answer：正确选项字母/, '提示词必须要求 answer 用字母，减少 0/1 基歧义');
    const payload = userPayload(state.calls[0]);
    assert.equal(payload.questions[0].index, 0);
    assert.equal(payload.questions[0].options.length, 4);
  });

  await check('AI 答案容错：模型返回 "C"/"c" 也能转成选项下标 2（旧实现整题作废）', async () => {
    for (const letter of ['C', 'c', '(C)', 'C.']) {
      const { ai, push } = makeAi();
      push({ items: [analysisItem({ answer: letter })] });
      const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
      assert.equal(out.status, 'verified', '字母 ' + letter + ' 应被接受');
      assert.equal(out.items[0].answer, 2, '字母 ' + letter + ' 应转成下标 2');
      assert.equal(out.items[0].letter, 'C');
    }
  });

  await check('AI 答案容错：1 基序号在题库答案能互相印证时按 1 基解释', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ answer: 3, evidence: EVIDENCE1 })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.items[0].answer, 2, '题库答案是 C(2)，模型给 3 应解释成 1 基的 C');
    const second = makeAi();
    const qa = Object.assign({}, Q1, { a: 'A' });
    second.push({ items: [analysisItem({ answer: 1 })] });
    const out2 = await second.ai.verifyReading({ paragraphs: [P1] }, [qa]);
    assert.equal(out2.items[0].answer, 0, '题库答案是 A(0)，模型给 1 应解释成 1 基的 A');
  });

  await check('AI 1 基识别：数字型题库答案（真实数据格式）也能识别 1 基序号', async () => {
    const { ai, push } = makeAi();
    const numericKey = Object.assign({}, Q1, { a: 2 }); /* 题库答案 C，格式为数字 2 */
    push({ items: [analysisItem({ answer: 3 })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [numericKey]);
    assert.equal(out.items[0].answer, 2, '数字题库答案 2 + 模型给 3 应解释成 1 基的 C');
  });

  await check('AI 依据容错：弯引号 / 多空格 / 大小写不同，仍还原成原文原句', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ evidence: '“It has long been thought that  humans are unique in their ability to think intelligently”' })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.items[0].evidence, EVIDENCE1, '应返回原文原句而不是模型复述');
  });

  await check('AI 依据容错：带省略号的依据，两段都能在原文找到时仍可定位', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ evidence: 'It has long been thought ... ability to think intelligently.' })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.items[0].evidence, EVIDENCE1);
  });

  await check('AI 依据编造：依据定位不到时保留答案/精析，但依据留空（不编造原文）', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ evidence: 'Ducks can do advanced calculus and write poetry like humans.' })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.status, 'verified', '依据定位失败不应把整题丢掉');
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].evidence, '', '定位不到的依据必须留空');
    assert.ok(out.items[0].explain.length > 0, '精析应保留');
  });

  await check('AI 精析非中文：英文 explanation 不能当【精析】显示', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ explain: 'English only explanation, no Chinese.' })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.items.length, 0, '非中文精析应丢弃');
    assert.equal(out.status, 'failed');
  });

  await check('AI 精析缺失：没有中文解析的题仍然丢弃（宁缺毋滥）', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ explain: '' })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.status, 'failed');
    assert.equal(out.items.length, 0);
  });

  await check('AI 答案缺失：answer:null 的题丢弃，不猜测', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ answer: null })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.items.length, 0);
  });

  await check('AI 避错过滤：剔除正确项 / 非中文 / 非法字母，只留中文错误项', async () => {
    const { ai, push } = makeAi();
    push({ items: [{
      index: 0, answer: 'B', evidence: 'It has long been thought that humans are unique in their ability to think intelligently.',
      explain: '推理判断题。第二段引用 Science 上的研究，说明我们对鸟脑的认知被挑战，故选 B。',
      wrong: { A: '原文只说挑战了我们对鸟脑的认知，没有说理解有偏差。', b: '这是正确项，不该出现在避错里。', C: 'English only, not Chinese.', E: '字母不在选项里。' },
    }] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q2]);
    assert.equal(out.items[0].answer, 1);
    assert.deepEqual(plain(out.items[0].wrong), { A: '原文只说挑战了我们对鸟脑的认知，没有说理解有偏差。' });
  });

  await check('AI 返回形状容错：模型直接给顶层数组也能核验（旧实现静默 0 条）', async () => {
    const { ai, push } = makeAi();
    push([analysisItem()]);
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    assert.equal(out.status, 'verified');
    assert.equal(out.items.length, 1);
  });

  await check('AI 题号容错：模型把 index 写成原卷题号 46 时，按 number 找回题目', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ index: 46 })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Object.assign({}, Q1, { number: 46 })]);
    assert.equal(out.items.length, 1, '按题号应能匹配到第 0 题');
    assert.equal(out.items[0].index, 0);
    assert.equal(out.items[0].answer, 2);
  });

  await check('AI 请求体：带上 number 供模型按原卷题号回填', async () => {
    const { ai, state, push } = makeAi();
    push({ items: [analysisItem()] });
    await ai.verifyReading({ paragraphs: [P1] }, [Q1]);
    const payload = userPayload(state.calls[0]);
    assert.equal(payload.questions[0].number, 46);
    assert.equal(payload.questions[0].index, 0);
  });

  await check('AI 下标容错：第二批模型按批内 0..3 返回时，映射回全局下标', async () => {
    const { ai, push } = makeAi();
    const five = [0, 1, 2, 3, 4].map(i => Object.assign({}, Q1, { number: 46 + i }));
    push({ items: [0, 1, 2, 3].map(i => analysisItem({ index: i })) });
    push({ items: [analysisItem({ index: 0 })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, five);
    assert.equal(out.status, 'verified');
    assert.deepEqual(plain(out.items.map(x => x.index)), [0, 1, 2, 3, 4]);
  });

  await check('AI 下标口径：整批 1 基（1..4）时统一换算成 0..3，不把答案挂错题', async () => {
    const { ai, push } = makeAi();
    const four = [0, 1, 2, 3].map(i => Object.assign({}, Q1, { number: 46 + i }));
    push({ items: [1, 2, 3, 4].map(i => analysisItem({ index: i })) });
    const out = await ai.verifyReading({ paragraphs: [P1] }, four);
    assert.equal(out.status, 'verified');
    assert.deepEqual(plain(out.items.map(x => x.index)), [0, 1, 2, 3]);
  });

  await check('AI 下标口径：单题批模型返回 1（批内 1 基）时映射回全局下标 4', async () => {
    const { ai, push } = makeAi();
    const five = [0, 1, 2, 3, 4].map(i => Object.assign({}, Q1, { number: 46 + i }));
    push({ items: [0, 1, 2, 3].map(i => analysisItem({ index: i })) });
    push({ items: [analysisItem({ index: 1 })] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, five);
    assert.equal(out.status, 'verified');
    assert.deepEqual(plain(out.items.map(x => x.index)), [0, 1, 2, 3, 4]);
  });

  await check('AI 状态：两题只核验成一题时为 partial', async () => {
    const { ai, push } = makeAi();
    push({ items: [analysisItem({ index: 0 }), { index: 1, answer: 'B', evidence: '', explain: '' }] });
    const out = await ai.verifyReading({ paragraphs: [P1] }, [Q1, Q2]);
    assert.equal(out.status, 'partial');
    assert.equal(out.items.length, 1);
  });

  /* ---------------- B. 页面层 ---------------- */
  function loadView(opts) {
    const o = opts || {};
    const view = { innerHTML: '' };
    const store = {
      d: { activeBook: 'cet6', readLog: {} },
      flush() {}, addStat() {}, logActivity() {}, nbAdd() { return true; },
    };
    const ai = {
      ready: !!o.ready,
      translate: async () => '译文',
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
      addEventListener() {}, removeEventListener() {},
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
      Dict: {
        content: { reading: { passages: [] } },
        get: () => null,
        inBook: () => null,
      },
      AI: ai, Speech: { stop() {}, speak() {} },
      ViewNotebook: { open() {} }, Importer: { open() {} },
      fullLabel: () => '', sessionLabel: x => x,
    });
    ctx.window = ctx;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/text-repair.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/done.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/reading.js'), 'utf8'), ctx);
    const V = vm.runInContext('ViewRead', ctx);
    V.mode = 'edit'; V.submitted = false; V.answers = {}; V.marks = {};
    V.readType = 'traditional'; V._paraCn = {}; V._paraOpen = new Set(); V._reRenderPassage = () => {};
    return { V, ctx, ai, store, view };
  }

  function traditional() {
    return {
      id: 'test-analysis', title: 'Animal minds', level: 'CET-6', readingType: 'traditional', totalScore: 10,
      paragraphs: [P1, P2, P3],
      questions: [
        { number: 46, q: Q1.q, opts: Q1.opts.slice(), a: 2 },
        { number: 47, q: Q2.q, opts: Q2.opts.slice(), a: 1 },
      ],
      year: 2023, session: '03', no: 1,
    };
  }

  await check('页面定位：依据能定位到第 1 段第 1 句，并还原成原句', () => {
    const { V } = loadView();
    const p = traditional();
    V.cur = p;
    const loc = V._locateEvidence(p, EVIDENCE1);
    assert.equal(loc.location, '第1段第1句');
    assert.equal(loc.quote, EVIDENCE1);
    const fuzzy = V._locateEvidence(p, '“It has long been thought that  humans are unique in their ability to think intelligently”');
    assert.equal(fuzzy.location, '第1段第1句', '弯引号/多空格也应能定位');
  });

  await check('核验写回：q._analysis 带定位/原文原句/精析/避错，q.a 更新', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    ai.verifyReading = async () => ({
      status: 'verified',
      items: [{ index: 0, answer: 2, letter: 'C', evidence: EVIDENCE1, explain: '事实细节题。首句指出人类被认为能区分异同。',
        wrong: { A: '无中生有。', B: '原文未提及创造世界。', D: '原文未提及抽象与具体。' } }],
    });
    await V._verifyCurrentReading();
    const q = p.questions[0];
    assert.equal(q.a, 2, 'AI 答案应写回');
    assert.equal(q._aiVerified, true);
    assert.equal(q._analysis.location, '第1段第1句');
    assert.equal(q._analysis.quote, EVIDENCE1);
    assert.equal(q._analysis.explain.indexOf('事实细节题') >= 0, true);
    assert.deepEqual(Object.keys(plain(q._analysis.wrong)).sort(), ['A', 'B', 'D']);
    assert.equal(p._answerVerification.status, 'verified');
  });

  await check('核验重试：上次 failed/unavailable 时提交会重新核验，成功后缓存不重复请求', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    let calls = 0;
    ai.verifyReading = async () => {
      calls++;
      return { status: 'verified', items: [{ index: 0, answer: 2, evidence: EVIDENCE1,
        explain: '事实细节题。', wrong: {} }] };
    };
    p._answerVerification = { status: 'failed', error: '旧版本遗留的失败状态' };
    await V._verifyCurrentReading();
    assert.equal(calls, 1, '上次 failed 时提交必须重新核验（否则永远停在待核验）');
    assert.equal(p._answerVerification.status, 'verified');
    assert.ok(p.questions[0]._analysis, '重试成功后应写回解析');
    await V._verifyCurrentReading();
    assert.equal(calls, 1, '已成功核验应复用缓存，不重复消耗 AI');
  });

  await check('答案保护：AI 与题库答案不一致时不覆盖题库答案，卡片提示分歧且不展示冲突避错', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    ai.verifyReading = async () => ({
      status: 'verified',
      items: [{ index: 0, answer: 0, letter: 'A', evidence: EVIDENCE1,
        explain: '事实细节题。首句指出人类被认为能区分异同。', wrong: { B: '原文未提及。', C: '原文未提及。', D: '原文未提及。' } }],
    });
    await V._verifyCurrentReading();
    const q = p.questions[0];
    assert.equal(q.a, 2, '题库答案 C 必须保留，不能被 AI 的 A 覆盖');
    assert.equal(q._aiAnswer, 'A', '应记录 AI 核对结果');
    V.submitted = true; V.answers = { 0: 2 };
    const html = V._readingAnalysisHTML(q, 0);
    assert.ok(html.indexOf('与题库答案') >= 0 && html.indexOf('不一致') >= 0, '应提示 AI 与题库答案不一致');
    assert.ok(html.indexOf('避错') < 0, '有分歧时不展示按 AI 答案组织的避错');
    assert.ok(html.indexOf('事实细节题') >= 0, '精析仍可参考');
    const actions = V._answerActionsHTML(p);
    assert.ok(actions.indexOf('与题库答案不一致') >= 0, '核验横幅也必须提示分歧，不能写「全部已核验」');
  });

  await check('答案补全：题库没有答案时才用 AI 答案', async () => {
    const { V, ai } = loadView({ ready: true });
    const p = traditional();
    p.questions[0].a = null;
    V.cur = p;
    ai.verifyReading = async () => ({ status: 'partial',
      items: [{ index: 0, answer: 0, letter: 'A', evidence: EVIDENCE1, explain: '事实细节题。', wrong: {} }] });
    await V._verifyCurrentReading();
    assert.equal(p.questions[0].a, 0, '缺答案时应回填 AI 答案');
    assert.equal(p.questions[0]._aiAnswer, undefined);
  });

  await check('解析卡：显示定位/原文/精析/避错，并标出用户选错的选项', async () => {
    const { V } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 3 };
    p.questions[0]._aiVerified = true;
    p.questions[0]._analysis = V._buildAnalysis(p, {
      source: 'ai', quote: EVIDENCE1, explain: '事实细节题。首句指出人类被认为能区分异同，故选 C。',
      wrong: { A: '无中生有。', B: '原文未提及创造世界。', D: '原文未提及抽象与具体。' },
    });
    const html = V._readingAnalysisHTML(p.questions[0], 0);
    assert.ok(html.indexOf('第1段第1句') >= 0, '缺少【定位】');
    assert.ok(html.indexOf('It has long been thought') >= 0, '缺少原文原句');
    assert.ok(html.indexOf('精析') >= 0, '缺少【精析】');
    assert.ok(html.indexOf('避错') >= 0, '缺少【避错】');
    assert.ok(html.indexOf('你选的') >= 0, '用户选错的 D 项应标出「你选的」');
    assert.ok(html.indexOf('is-picked') >= 0);
    assert.ok(html.indexOf('AI 已核验') >= 0);
    assert.ok(html.indexOf('原文依据：') < 0, '不应再出现空的「原文依据：」标签');
  });

  await check('待核验空态：未启用 AI 时说明原因，不再显示空「原文依据：」', () => {
    const { V } = loadView({ ready: false });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 2 };
    const html = V._readingAnalysisHTML(p.questions[0], 0);
    assert.ok(html.indexOf('未启用 AI') >= 0, '应提示未启用 AI');
    assert.ok(html.indexOf('is-pending') >= 0);
    assert.ok(html.indexOf('原文依据：') < 0, '不应再出现空的「原文依据：」标签');
  });

  await check('待核验空态：AI 核验失败时显示失败原因与重试入口', () => {
    const { V } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 2 };
    p._answerVerification = { status: 'failed', error: 'HTTP 500 服务商暂时不可用' };
    const html = V._readingAnalysisHTML(p.questions[0], 0);
    assert.ok(html.indexOf('AI 核验失败') >= 0);
    assert.ok(html.indexOf('HTTP 500') >= 0, '应带上失败原因，避免用户只看到「待核验」');
    assert.ok(html.indexOf('AI 重新核验') >= 0);
  });

  await check('导入数据兼容：题库自带 explain+evidence 也渲染成结构化解析（题库解析）', () => {
    const { V } = loadView({ ready: false });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 3 };
    p.questions[0].explain = '推理判断题。第二段说小鸭子没有经过任何训练，说明实验的新颖之处在于动物未经训练。';
    p.questions[0].evidence = EVIDENCE2;
    const html = V._readingAnalysisHTML(p.questions[0], 0);
    assert.ok(html.indexOf('题库解析') >= 0);
    assert.ok(html.indexOf('第2段第2句') >= 0, '导入依据也应定位到段句');
    assert.ok(html.indexOf('推理判断题') >= 0);
    assert.ok(html.indexOf('原文依据：') < 0);
  });

  await check('未定位依据：只标「依据（未定位）」，不冒充【原文】', () => {
    const { V } = loadView({ ready: false });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 3 };
    p.questions[0].explain = '推理判断题。';
    p.questions[0].evidence = 'This sentence never appears in the passage at all.';
    const html = V._readingAnalysisHTML(p.questions[0], 0);
    assert.ok(html.indexOf('<b>依据</b>') >= 0, '未定位文本应标为「依据」');
    assert.ok(html.indexOf('<b>原文</b>') < 0, '不能把未定位文本标成【原文】');
    assert.ok(html.indexOf('未能在当前正文中逐字定位') >= 0);
  });

  await check('渲染接线：_renderQuestions 的传统阅读分支改用结构化解析卡', () => {
    const { V } = loadView({ ready: true });
    const p = traditional();
    V.cur = p;
    V.submitted = true;
    V.answers = { 0: 2, 1: 1 };
    p.questions[0]._aiVerified = true;
    p.questions[0]._analysis = V._buildAnalysis(p, { source: 'ai', quote: EVIDENCE1, explain: '事实细节题。', wrong: {} });
    const html = V._renderQuestions(p);
    assert.ok(html.indexOf('read-analysis') >= 0);
    assert.ok(html.indexOf('解析 · 待核验') < 0, '旧空标签不应再出现');
  });

  await check('整页渲染：传统阅读提交后能完整渲染，且没有空「原文依据：」', () => {
    const { V, ctx, view } = loadView({ ready: true });
    const p = traditional();
    ctx.Dict.content.reading.passages.push(p);
    V.readType = 'traditional'; V.mode = 'edit';
    V.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
    /* 先渲染一次确定篇目（_shell 在筛选条件变化时会重置 submitted/answers），
       再带入提交态与解析数据渲染第二次，模拟用户提交后的页面。*/
    V._shell({ innerHTML: '' });
    V.submitted = true; V.answers = { 0: 2, 1: 1 };
    p.questions[0]._aiVerified = true;
    p.questions[0]._analysis = V._buildAnalysis(p, { source: 'ai', quote: EVIDENCE1, explain: '事实细节题。', wrong: { D: '无中生有。' } });
    V._shell({ innerHTML: '' });
    const html = view.innerHTML || '';
    assert.ok(html.length > 1500, '整页 HTML 过短：' + html.length);
    assert.ok(html.indexOf('read-analysis') >= 0, '缺少结构化解析卡');
    assert.ok(html.indexOf('原文依据：') < 0, '整页不应再出现空「原文依据：」');
  });

  await check('布局：修改模式传统题改为单列横板，做题模式/完形填空仍两列', () => {
    const { V } = loadView({ ready: true });
    const p = traditional();
    V.cur = p; V.answers = { 0: 2 };
    V.mode = 'edit'; V.submitted = true;
    const editHtml = V._renderQuestions(p);
    assert.ok(editHtml.indexOf('class="read-q-list"') >= 0, '修改模式应输出单列横板 read-q-list');
    assert.ok(editHtml.indexOf('class="two-col"') < 0, '修改模式不应再两列并排');
    V.mode = 'exam';
    const examHtml = V._renderQuestions(p);
    assert.ok(examHtml.indexOf('class="two-col"') >= 0, '做题模式保持原布局（右侧栏 CSS 会折单列）');
    V.mode = 'edit';
    const cloze = Object.assign({}, p, { readingType: 'cloze' });
    assert.ok(V._renderQuestions(cloze).indexOf('class="two-col"') >= 0, '完形填空不改布局');
  });

  await check('CSS 契约：单列横板样式存在（解析卡占满整行）', () => {
    assert.ok(CSS.indexOf('.read-q-list{display:flex;flex-direction:column') >= 0, '缺少 .read-q-list 单列样式');
    assert.ok(CSS.indexOf('.read-q-list .q-item{margin-bottom:0') >= 0, '单列题卡应去掉额外下边距（由 gap 控制）');
  });

  await check('CSS 契约：结构化解析卡有定位/原文/避错/待核验样式', () => {
    assert.ok(CSS.indexOf('.read-analysis .ra-badge.is-ai') >= 0, '缺少 AI 徽章样式');
    assert.ok(CSS.indexOf('.read-analysis .ra-row blockquote') >= 0, '缺少原文引用样式');
    assert.ok(CSS.indexOf('.read-analysis .ra-wrong.is-picked') >= 0, '缺少「你选的」样式');
    assert.ok(CSS.indexOf('.read-analysis.is-pending') >= 0, '缺少待核验样式');
  });

  console.log('');
  console.log('全部 ' + passed + ' 项阅读解析检查通过（本地假 AI，无真实请求）');
  if (failed) {
    console.log(failed + ' 项失败');
    process.exit(1);
  }
})();
