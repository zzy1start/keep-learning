// 阅读特殊题型 AI 核验自检：选词填空讲解 / 段落匹配核对 / 固定搭配释义。
// 全部把 AI.jsonRetry 替换为本地构造数据，不联网、不消耗真实 Key。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const warns = [];
const context = vm.createContext({
  window: {},
  setTimeout,
  clearTimeout,
  console: { warn: (...args) => warns.push(args.map(String).join(' ')), log() {} },
  Store: {
    d: {
      settings: {
        ai: { baseUrl: 'https://api.example.com/v1', key: 'fixture-key', model: 'deepseek-v4-pro', enabled: true },
      },
    },
  },
  App: { toast() {}, modal() {} },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8'), context);
const ai = context.window.AI;
assert.ok(ai, 'js/ai.js 必须暴露 window.AI');
const cfg = context.Store.d.settings.ai;
const READY_CFG = { baseUrl: cfg.baseUrl, key: cfg.key, model: cfg.model, enabled: cfg.enabled };
function restoreCfg() { Object.assign(cfg, READY_CFG); }

let calls = [];
let queue = [];
ai.jsonRetry = async (messages, opts) => {
  calls.push({ messages, opts });
  const next = queue.shift();
  if (next instanceof Error) throw next;
  if (typeof next === 'function') return next(messages, opts);
  return next === undefined ? { items: [] } : next;
};

function reset() { calls = []; queue = []; warns.length = 0; }
/* vm 里创建的对象/数组原型与宿主 realm 不同，node:assert/strict 的 deepEqual 会因此判不相等。
 * 统一先 JSON 往返成宿主普通值再比较，避免测到"跨 realm 原型"这种无关差异。*/
const plain = value => JSON.parse(JSON.stringify(value));
function deepEqual(actual, expected, msg) { assert.deepEqual(plain(actual), expected, msg); }
function userPayload(i) {
  const msg = calls[i].messages.find(m => m.role === 'user');
  return JSON.parse(msg.content);
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
  reset();
  try {
    await fn();
    passed++;
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '：' + (e && e.message));
    process.exitCode = 1;
  } finally {
    restoreCfg();
  }
}

/* ---------------- 选词填空夹具 ---------------- */
const CLOZE_TEXT = [
  'Sleep matters more than most people assume. A growing body of research shows',
  'that a (1) ______ share of adults fails to get enough rest. The (2) ______ to concentrate',
  'suffers first: attention wanders, short-term memory weakens, and judgement becomes less (3) ______.',
  'Over months, sleep debt can (4) ______ to mood problems and weakened immunity.',
  'Experts therefore (5) ______ that adults keep a regular schedule.',
].join('\n');
const WORD_BANK = [
  { letter: 'A', word: 'ability' },
  { letter: 'B', word: 'capacity' },
  { letter: 'C', word: 'decline' },
  { letter: 'D', word: 'essential' },
  { letter: 'E', word: 'contribute' },
  { letter: 'F', word: 'significant' },
  { letter: 'G', word: 'maintain' },
  { letter: 'H', word: 'reliable' },
];
const CLOZE_QUESTIONS = [
  { number: 1, q: 'A growing body of research shows that a ______ share of adults fails to get enough rest.', a: 'F' },
  { number: 2, q: 'The ______ to concentrate suffers first.', a: 'B' },
  { number: 3, q: 'judgement becomes less ______.', a: 'H' },
  { number: 4, q: 'Over months, sleep debt can ______ to mood problems.', a: 'E' },
  { number: 5, q: 'Experts therefore ______ that adults keep a regular schedule.', a: 'G' },
];
const CLOZE_BATCH1 = {
  items: [
    {
      index: 0, answer: 'f', word: 'insignificant',
      grammar: '此处需要形容词修饰 share，前面有不定冠词 a，且与"growing body of research"呼应，应表示"相当大的"而非"不重要的"。',
      semantics: '上下文说研究越来越多，语义上是"相当大比例"的成年人睡眠不足，所以填 significant。',
      meaning: '相当大的；占比可观的',
      evidence: 'A growing body of research shows that a (1) ______ share of adults fails to get enough rest.',
    },
    {
      index: 1, answer: 'B', word: 'ability',
      grammar: 'The 后接名词作主语，后面 to concentrate 是定语，需要能与 to do 搭配的名词。',
      semantics: '结合"attention wanders, short-term memory weakens"，这里说的是"专注的能力"先受影响，选 capacity。',
      meaning: '（专注的）能力',
      evidence: 'The (2) ______ to concentrate suffers first',
    },
    {
      index: 2, answer: 'H',
      grammar: 'less 后接形容词原级，构成比较结构，需填能被 less 修饰的形容词。',
      semantics: '前文说注意力涣散、记忆变弱，语义上判断力变得"不那么可靠"，选 reliable。',
      meaning: '可靠的；可信的',
      evidence: 'judgement becomes less (3) ______',
    },
    {
      index: 3, answer: 'E',
      grammar: '情态动词 can 后接动词原形，且需与介词 to 搭配，构成 contribute to 结构。',
      semantics: '语义是睡眠债"导致/促成"情绪问题和免疫力下降，选 contribute。',
      meaning: '促成；导致（contribute to）',
      evidence: 'sleep debt can (4) ______ to mood problems',
    },
  ],
};
const CLOZE_BATCH2 = {
  items: [
    {
      index: 4, answer: 'G',
      grammar: '主语 Experts 后缺谓语动词，that 从句作宾语，需要及物动词 maintain。',
      semantics: '语义是专家建议成年人"保持"规律作息，maintain a regular schedule 搭配成立。',
      meaning: '保持；维持（规律作息）',
      evidence: 'Experts therefore (5) ______ that adults keep a regular schedule.',
    },
  ],
};
function clozePayload(questions) {
  return { title: 'Sleep and health', clozeText: CLOZE_TEXT, wordBank: WORD_BANK, questions: questions || CLOZE_QUESTIONS };
}

/* ---------------- 段落匹配夹具 ---------------- */
const MATCH_PARAGRAPHS = [
  { label: 'A', text: 'Public libraries increasingly function as community centres, offering study space and job-search support.' },
  { label: 'B', text: 'Critics worry that social services divert funding from the core purpose of lending books.' },
  { label: 'C', text: 'Supporters reply that a library people no longer visit cannot sustain its funding base.' },
];
const MATCH_QUESTIONS = [
  { number: 1, statement: 'Libraries now offer services beyond lending books.' },
  { number: 2, statement: 'Some argue that new services take money away from book lending.' },
  { number: 3, statement: 'A library nobody visits may lose its funding.' },
];
const MATCH_REPLY = {
  items: [
    {
      index: 0, answer: 'a',
      grammar: '陈述用一般现在时 now offer，与 A 段 increasingly function 的时态和主谓结构一致，offering 分词短语正是"提供额外服务"的语法线索。',
      semantics: 'A 段讲图书馆如今充当社区中心、提供学习空间和求职支持，语义上就是"借书之外的服务"。',
      evidence: 'offering study space and job-search support',
    },
    {
      index: 1, answer: 'B',
      grammar: '陈述 take money away from 与 B 段 divert funding from 构成同义替换，均为"把资金从……转移走"的动宾结构。',
      semantics: 'B 段讲批评者担心社会服务挤占购书核心经费，与"新服务拿走买书的钱"语义一致。',
      evidence: 'social services divert funding from the core purpose',
    },
    {
      index: 2, answer: 'c',
      grammar: '陈述 may lose 表推测，与 C 段 cannot sustain 的否定情态在语气上对应；a library nobody visits 与 people no longer visit 为同义结构。',
      semantics: 'C 段说没人再去的图书馆难以维持经费，语义正是"可能失去经费"。',
      evidence: 'cannot sustain its funding base',
    },
  ],
};
function matchPayload(questions) {
  return { paragraphs: MATCH_PARAGRAPHS, questions: questions || MATCH_QUESTIONS };
}

(async () => {
  /* ---------- 1) 未配置 → unavailable ---------- */
  await check('explainCloze 未配置 AI → unavailable，且不发请求', async () => {
    cfg.key = '';
    const out = await ai.explainCloze(clozePayload());
    deepEqual(out, { status: 'unavailable', items: [], error: '' });
    assert.equal(calls.length, 0, '未配置时不应调用模型');
  });

  await check('verifyMatching 未配置 AI → unavailable', async () => {
    cfg.key = '';
    const out = await ai.verifyMatching(matchPayload());
    deepEqual(out, { status: 'unavailable', items: [], error: '' });
    assert.equal(calls.length, 0);
  });

  /* ---------- 2) 选词填空正常条目通过 ---------- */
  await check('explainCloze 正常条目通过：每批 4 题、预算 12000/300s、word 以词库为准', async () => {
    queue = [CLOZE_BATCH1, CLOZE_BATCH2];
    const out = await ai.explainCloze(clozePayload());
    assert.equal(out.status, 'verified', 'error=' + out.error);
    assert.equal(out.items.length, 5);
    deepEqual(out.items.map(x => x.index), [0, 1, 2, 3, 4], 'items 应按原题号升序');
    assert.equal(calls.length, 2, '5 题应拆成 2 批（4+1）');
    for (const call of calls) {
      deepEqual(call.opts, { max: 12000, timeout: 300000, tries: 2, temp: 0.1 });
    }
    const first = userPayload(0);
    assert.equal(first.wordBank.length, 8);
    assert.equal(first.questions.length, 4);
    assert.equal(userPayload(1).questions.length, 1);
    assert.equal(userPayload(1).questions[0].index, 4);
    const system = calls[0].messages[0].content;
    assert.match(system, /语法判断/);
    assert.match(system, /语义判断/);
    assert.match(system, /编造/);
    // 提示词必须要求语境义 meaning，并禁止照抄词典第一义项
    assert.match(system, /meaning/);
    assert.match(system, /语境/);
    assert.match(system, /词典第一/);
    assert.ok(CLOZE_TEXT.includes('shows\nthat'), '夹具应覆盖跨行空白');
    // 模型把字母配错词（F→insignificant、B→ability）时必须以词库为准
    assert.equal(out.items[0].answer, 'F', 'answer 应统一大写');
    assert.equal(out.items[0].word, 'significant', 'word 必须取词库，不能照抄模型错词');
    assert.equal(out.items[1].word, 'capacity');
    assert.equal(out.items[2].word, 'reliable');
    assert.equal(out.items[3].word, 'contribute');
    assert.equal(out.items[4].word, 'maintain');
    // evidence 跨行归一化后仍应命中原文
    assert.ok(out.items[0].evidence.startsWith('A growing body of research'), '跨行 evidence 应保留');
    for (const item of out.items) {
      assert.ok(item.grammar && /[\u4e00-\u9fa5]/.test(item.grammar), 'grammar 必须是中文');
      assert.ok(item.semantics && /[\u4e00-\u9fa5]/.test(item.semantics), 'semantics 必须是中文');
    }
    // 语境义 meaning：正常条目应带中文语境义
    deepEqual(out.items.map(x => x.meaning),
      ['相当大的；占比可观的', '（专注的）能力', '可靠的；可信的', '促成；导致（contribute to）', '保持；维持（规律作息）']);
    for (const item of out.items) {
      assert.ok(item.meaning && /[\u4e00-\u9fa5]/.test(item.meaning), 'meaning 必须是中文语境义');
    }
  });

  /* ---------- 3) answer 不在词库 → 丢弃 ---------- */
  await check('explainCloze answer 不在词库 → 丢弃该题（其余保留为 partial）', async () => {
    queue = [{ items: [
      CLOZE_BATCH1.items[0],
      { ...CLOZE_BATCH1.items[1], index: 1, answer: 'Z' },
    ] }];
    const out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 2)));
    assert.equal(out.status, 'partial');
    deepEqual(out.items.map(x => x.index), [0]);
    assert.equal(out.items[0].word, 'significant');
  });

  /* ---------- 4) grammar 空 / 非中文 → 丢弃 ---------- */
  await check('explainCloze grammar 空或纯英文 → 丢弃', async () => {
    queue = [{ items: [{ index: 0, answer: 'F', grammar: '', semantics: '语义上表示比例很大。', evidence: '' }] }];
    let out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'failed');
    assert.equal(out.items.length, 0);

    reset();
    queue = [{ items: [{ index: 0, answer: 'F', grammar: 'verb form', semantics: '语义上表示比例很大。', evidence: '' }] }];
    out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'failed', '纯英文 grammar 不算讲解');
    assert.equal(out.items.length, 0);
  });

  /* ---------- 5) evidence 不在原文 → 清空但保留答案 ---------- */
  await check('explainCloze evidence 不在原文 → 清空 evidence，保留答案与讲解', async () => {
    queue = [{ items: [{
      index: 0, answer: 'F', grammar: '需要形容词修饰 share。', semantics: '语义上是"相当大的比例"。',
      evidence: 'This exact sentence never appears in the passage.',
    }] }];
    const out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'verified', '答案与讲解有效时整题仍可用');
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].answer, 'F');
    assert.equal(out.items[0].evidence, '', '编造的依据必须清空');
    assert.equal(out.items[0].word, 'significant');
    assert.equal(out.items[0].meaning, '', '缺 meaning 字段时置空，不拖垮整题');
  });

  /* ---------- 6) meaning 不合法 → 置空但保留整题 ---------- */
  await check('explainCloze meaning 空/纯英文/词典义项罗列 → 置空，保留答案与讲解', async () => {
    queue = [{ items: [
      { index: 0, answer: 'F', grammar: '需要形容词修饰 share。', semantics: '语义上是"相当大的比例"。', meaning: '', evidence: '' },
      { index: 1, answer: 'B', grammar: 'The 后接名词作主语。', semantics: '语义是"专注的能力"。', meaning: 'ability', evidence: '' },
      { index: 2, answer: 'H', grammar: 'less 后接形容词原级。', semantics: '语义是"不那么可靠"。', meaning: '（行动的）方案,剧情概要,分镜头剧本', evidence: '' },
    ] }];
    const out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 3)));
    assert.equal(out.status, 'verified', 'meaning 不合法不能丢弃整题');
    assert.equal(out.items.length, 3);
    deepEqual(out.items.map(x => x.meaning), ['', '', '']);
    assert.equal(out.items[0].answer, 'F');
    assert.equal(out.items[0].word, 'significant');
    assert.ok(out.items[0].grammar && out.items[0].semantics, '语法/语义判断必须保留');
  });

  /* ---------- 7) meaning 不干扰其它校验 ---------- */
  await check('explainCloze meaning 不干扰其它校验：坏 evidence 仍清空、词库外 answer 仍丢弃', async () => {
    queue = [{ items: [{
      index: 0, answer: 'F', grammar: '需要形容词修饰 share。', semantics: '语义上是"相当大的比例"。',
      meaning: '相当大的', evidence: 'This exact sentence never appears in the passage.',
    }] }];
    let out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'verified');
    assert.equal(out.items[0].meaning, '相当大的');
    assert.equal(out.items[0].evidence, '', 'meaning 合法也不能让坏 evidence 蒙混过关');

    reset();
    queue = [{ items: [{
      index: 0, answer: 'Z', grammar: '需要形容词修饰 share。', semantics: '语义上是"相当大的比例"。',
      meaning: '相当大的', evidence: '',
    }] }];
    out = await ai.explainCloze(clozePayload(CLOZE_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'failed', '词库外 answer 即使 meaning 合法也要丢弃');
    assert.equal(out.items.length, 0);
  });

  /* ---------- 8) 输入防御 ---------- */
  await check('explainCloze 输入防御：缺参/字符串题库/重复字母/整数答案都不抛错', async () => {
    let out = await ai.explainCloze();
    deepEqual(out, { status: 'failed', items: [], error: '没有可核对的题目。' });
    assert.equal(calls.length, 0);

    out = await ai.explainCloze({ wordBank: 'not-an-array', questions: 'not-an-array' });
    assert.equal(out.status, 'failed');
    assert.equal(calls.length, 0);

    out = await ai.explainCloze({ wordBank: [], questions: CLOZE_QUESTIONS });
    assert.equal(out.status, 'failed');
    assert.match(out.error, /词库为空/);
    assert.equal(calls.length, 0);

    reset();
    queue = [{ items: [{ index: 0, answer: 'b', grammar: '需要名词作主语。', semantics: '语义是"专注的能力"。', evidence: '' }] }];
    out = await ai.explainCloze({
      wordBank: ['A ability', 'a again', 'B capacity'],
      questions: [{ number: 1, q: 'The ______ to concentrate suffers first.', a: 1 }],
    });
    assert.equal(out.status, 'verified');
    assert.equal(out.items[0].answer, 'B', '整数答案按 0=A 归一化');
    assert.equal(out.items[0].word, 'capacity');
    assert.equal(out.items[0].meaning, '', '模型没给 meaning 时置空，不丢题');
    assert.equal(userPayload(0).wordBank.length, 2, '重复字母只保留第一条');
  });

  /* ---------- 7) 单批失败不影响其他批 ---------- */
  await check('explainCloze 单批异常不影响其他批，error 带真实原因', async () => {
    queue = [new Error('HTTP 500：上游错误'), CLOZE_BATCH2];
    const out = await ai.explainCloze(clozePayload());
    assert.equal(out.status, 'partial');
    deepEqual(out.items.map(x => x.index), [4]);
    assert.match(out.error, /HTTP 500/);
  });

  /* ---------- 8) 段落匹配正常 ---------- */
  await check('verifyMatching 正常条目通过：answer/evidence 按段落核验，预算一致', async () => {
    queue = [MATCH_REPLY];
    const out = await ai.verifyMatching(matchPayload());
    assert.equal(out.status, 'verified', 'error=' + out.error);
    assert.equal(out.items.length, 3);
    deepEqual(out.items.map(x => x.answer), ['A', 'B', 'C'], 'answer 统一大写并等于段落 label');
    assert.equal(calls.length, 1);
    deepEqual(calls[0].opts, { max: 12000, timeout: 300000, tries: 2, temp: 0.1 });
    const payload = userPayload(0);
    assert.equal(payload.paragraphs.length, 3);
    deepEqual(payload.questions.map(x => x.number), [1, 2, 3]);
    assert.match(calls[0].messages[0].content, /段落匹配/);
    assert.match(calls[0].messages[0].content, /逐字/);
    for (const item of out.items) {
      assert.ok(item.grammar && /[\u4e00-\u9fa5]/.test(item.grammar));
      assert.ok(item.semantics && /[\u4e00-\u9fa5]/.test(item.semantics));
      assert.ok(item.evidence, '每条都应有原文依据');
    }
  });

  /* ---------- 9) answer 不在段落 → 丢弃 ---------- */
  await check('verifyMatching answer 不在段落 → 丢弃该题', async () => {
    queue = [{ items: [{ ...MATCH_REPLY.items[0], answer: 'D' }] }];
    const out = await ai.verifyMatching(matchPayload(MATCH_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'failed');
    assert.equal(out.items.length, 0);
  });

  /* ---------- 10) evidence 不在对应段 → 丢弃 ---------- */
  await check('verifyMatching evidence 不在 answer 对应段落 → 丢弃', async () => {
    queue = [{ items: [{ ...MATCH_REPLY.items[0], evidence: 'social services divert funding from the core purpose' }] }];
    const out = await ai.verifyMatching(matchPayload(MATCH_QUESTIONS.slice(0, 1)));
    assert.equal(out.status, 'failed', '引句来自别的段落，不能证明本题对应关系');
    assert.equal(out.items.length, 0);

    reset();
    queue = [{ items: [{ ...MATCH_REPLY.items[0], evidence: '' }] }];
    const out2 = await ai.verifyMatching(matchPayload(MATCH_QUESTIONS.slice(0, 1)));
    assert.equal(out2.status, 'failed', '缺 evidence 的段落匹配题不可用');
    assert.equal(out2.items.length, 0);
  });

  /* ---------- 11) 段落匹配输入防御 ---------- */
  await check('verifyMatching 输入防御：字符串段落/缺参不抛错', async () => {
    let out = await ai.verifyMatching();
    assert.equal(out.status, 'failed');
    assert.equal(calls.length, 0);

    out = await ai.verifyMatching({ paragraphs: 'oops', questions: MATCH_QUESTIONS });
    assert.equal(out.status, 'failed');
    assert.equal(calls.length, 0);

    reset();
    queue = [{ items: [{ index: 0, answer: 'A', grammar: '主谓结构一致。', semantics: '语义是"提供借书以外的服务"。',
      evidence: 'offering study space and job-search support' }] }];
    out = await ai.verifyMatching({
      paragraphs: ['A) Public libraries increasingly function as community centres, offering study space and job-search support.'],
      questions: ['Libraries now offer services beyond lending books.'],
    });
    assert.equal(out.status, 'verified');
    assert.equal(out.items[0].answer, 'A');
    assert.equal(userPayload(0).questions[0].statement, 'Libraries now offer services beyond lending books.');
  });

  /* ---------- 12) 固定搭配：未配置 / 失败 / 成功 / 非中文 ---------- */
  await check('glossPhrase 未配置 → degraded 且不抛错、不发请求', async () => {
    cfg.key = '';
    const out = await ai.glossPhrase('be essential to', 'essential', 'Reading is essential to learning.');
    deepEqual(out, { phrase: 'be essential to', cn: '', note: '', degraded: true, errMsg: '未配置 AI' });
    assert.equal(calls.length, 0);
  });

  await check('glossPhrase AI 失败 → 降级返回真实原因，绝不抛异常', async () => {
    queue = [new Error('请求超时（300s）。推理型模型批改长文本可能较慢，可稍后重试或换用更快的模型。')];
    let out;
    await assert.doesNotReject(async () => {
      out = await ai.glossPhrase('be essential to', 'essential', '');
    });
    assert.equal(out.phrase, 'be essential to');
    assert.equal(out.cn, '');
    assert.equal(out.degraded, true);
    assert.match(out.errMsg, /请求超时/);
    assert.ok(warns.length >= 1, '失败原因必须 console.warn 出来');
    assert.match(warns.join(' '), /glossPhrase/);
  });

  await check('glossPhrase 正常返回中文释义与用法提示', async () => {
    queue = [{ cn: '对……至关重要', note: '常用结构 be essential to sth；to 是介词，后接名词或动名词。' }];
    const out = await ai.glossPhrase('be essential to', 'essential', 'Reading is essential to learning.');
    deepEqual(out, { phrase: 'be essential to', cn: '对……至关重要', note: '常用结构 be essential to sth；to 是介词，后接名词或动名词。' });
    assert.equal(calls.length, 1);
    deepEqual(calls[0].opts, { max: 8000, timeout: 180000, tries: 2, temp: 0.2 });
    const payload = userPayload(0);
    assert.equal(payload.phrase, 'be essential to');
    assert.equal(payload.word, 'essential');
    assert.equal(payload.context, 'Reading is essential to learning.');
  });

  await check('glossPhrase 模型返回英文释义 → 按失败降级，不污染中文释义位', async () => {
    queue = [{ cn: 'be very important to', note: 'common structure' }];
    const out = await ai.glossPhrase('be essential to', 'essential', '');
    assert.equal(out.degraded, true);
    assert.equal(out.cn, '');
    assert.match(out.errMsg, /中文/);
  });

  await check('glossPhrase 空短语 → 降级且不发请求', async () => {
    const out = await ai.glossPhrase('   ', '', '');
    assert.equal(out.degraded, true);
    assert.equal(out.phrase, '');
    assert.equal(calls.length, 0);
  });

  /* ---------- 13) 既有方法未受影响 ---------- */
  await check('既有 verifyReading 仍按选项序号核验（行为未变）', async () => {
    queue = [{ items: [{
      index: 0, answer: 1, evidence: 'Sleep matters more than most people assume',
      explain: '首句直接说明睡眠比多数人以为的更重要。',
    }] }];
    const out = await ai.verifyReading({ text: 'Sleep matters more than most people assume. It affects health.' }, [
      { q: 'What matters according to the passage?', opts: ['Sleep', 'Money'] },
    ]);
    assert.equal(out.status, 'verified');
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].answer, 1);
    assert.equal(typeof ai.lookup, 'function');
    assert.equal(typeof ai.gradeTranslation, 'function');
    assert.equal(typeof ai.translate, 'function');
  });

  console.log('');
  console.log('全部 ' + passed + ' 项阅读 AI 检查通过（本地假 jsonRetry，无真实请求）');
  if (failed) {
    console.log(failed + ' 项失败');
    process.exit(1);
  }
})();
