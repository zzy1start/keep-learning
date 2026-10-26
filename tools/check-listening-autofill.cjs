/* ============ check-listening-autofill.cjs : 听力自动补全（原文/题干）自检 ============
 * 对照 work/listening-autofill-contract.md（冻结契约）：
 *   §3 纯函数：normalizeText / stemIsPlaceholder / stemsComplete / missingStemIndexes /
 *              paperAudioKey / findStemDonors / copyStemsFromDonor / extractStemsFromScript /
 *              verifyStemInScript / buildTranscriptQueries / buildStemQueries /
 *              verifyTranscriptMatch / applyStemJson / readPatches / writePatch / applyPatches
 *   §4 编排：run 三条主路径（同套共享 / 联网补原文 / 联网补题干）+ 失败降级；afterImport
 *   §5 接线：listening.js / importer.js / index.html 源码断言（阶段二）
 *
 * 运行：node tools/check-listening-autofill.cjs
 * 原则：不依赖真实网络与真实 AI。webSearch/AI/store 全部注入 stub，
 *       因为契约要求这些依赖**只能从 opts 注入**或在函数内按需读全局。
 *       纯函数断言只锚定契约（签名/返回固定字段），不锁实现细节。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'js/listening-autofill.js');
const LISTENING_SRC = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
const IMPORTER_SRC = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let AF = null;
let LOAD_ERROR = '';
try {
  AF = require(MODULE_PATH);
} catch (error) {
  LOAD_ERROR = (error && error.message) || String(error);
}

let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + ((error && error.message) || error));
  }
}

/* 模块缺失时不静默跳过：直接 FAIL 一条，后面每条断言也会因 AF 为 null 失败，
 * 但这里给一句可读的原因，方便区分"实现缺失"和"实现行为不对"。 */
if (!AF) {
  failed++;
  console.error('FAIL 模块可加载: require(js/listening-autofill.js) 失败：' + LOAD_ERROR);
}

/* ---------------- fixture ---------------- */

/* 四个选项文本即"同一套听力"的指纹：选项顺序、文本都必须参与比对。 */
const OPTS_A = [
  ['The man wants to change his major.', 'The woman is a new student here.', 'The lecture was cancelled.', 'The exam has been postponed.'],
  ['In the library.', 'In the cafeteria.', 'In the classroom.', 'In the bookstore.'],
  ['She is a teacher.', 'She is a doctor.', 'She is a student.', 'She is a journalist.'],
  ['By bus.', 'By train.', 'By plane.', 'On foot.'],
];
const OPTS_B = [
  ['The man wants to change his job.', 'The woman is a new teacher.', 'The lecture was delayed.', 'The exam has been moved.'],
  ['In the lab.', 'In the gym.', 'In the office.', 'In the museum.'],
  ['She is a nurse.', 'She is a driver.', 'She is a writer.', 'She is a lawyer.'],
  ['By taxi.', 'By ship.', 'By bike.', 'By subway.'],
];
const REAL_STEMS = [
  'What does the man want to do?',
  'Where does the conversation most probably take place?',
  'What is the woman?',
  'How will the man go there?',
];
const PLACEHOLDERS = ['Question 1', 'Question 2', 'Question 3', 'Question 4'];

function makePaper(over) {
  const o = over || {};
  const stems = o.stems || PLACEHOLDERS;
  const opts = o.opts || OPTS_A;
  const qs = stems.map(function (stem, i) {
    return { q: stem, opts: (opts[i] || opts[0]).slice(), a: 0 };
  });
  return {
    id: o.id === undefined ? 'imp-listening-1-0' : o.id,
    title: o.title || 'Questions 1 to 4',
    type: o.type || 'cet6',
    level: 'CET-6',
    year: o.year === undefined ? 2023 : o.year,
    session: o.session || '12',
    setNo: o.setNo === undefined ? 1 : o.setNo,
    script: o.script || [],
    qs: o.qs || qs,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fn(name) {
  if (!AF) throw new Error('模块未加载');
  assert.equal(typeof AF[name], 'function', '缺少导出函数 ' + name);
  return AF[name];
}

/* ---------------- stub：store / AI / WebSearch ---------------- */

function makeStore() {
  return {
    d: {},
    flushCount: 0,
    flush: function () { this.flushCount++; },
  };
}

/* AI stub：按 user prompt 里的关键词路由（契约 4.1 的三种用途各有一句唯一措辞）。
 * 返回普通对象即可——模块内部自己 await ai.jsonRetry(...)。 */
function makeAi(handler) {
  const ai = {
    ready: true,
    calls: [],
    jsonRetry: function (messages, opts) {
      const system = (messages && messages[0] && messages[0].content) || '';
      const user = (messages && messages[1] && messages[1].content) || '';
      ai.calls.push({ system: system, user: user, opts: opts });
      if (typeof handler === 'function') return Promise.resolve(handler({ system: system, user: user, opts: opts, ai: ai }));
      return Promise.resolve(handler || {});
    },
  };
  return ai;
}

/* WebSearch stub：记录调用次数，按配置返回固定结果/抛错，绝不碰真实网络。 */
function makeWebSearch(config) {
  const c = config || {};
  const ws = {
    collectCalls: [],
    searchCalls: [],
    collectTranscriptText: function (meta, opts) {
      ws.collectCalls.push({ meta: meta, opts: opts });
      if (c.collectThrows) return Promise.reject(c.collectThrows);
      return Promise.resolve(typeof c.collectResult === 'function'
        ? c.collectResult(meta, opts) : (c.collectResult || { text: '', sources: [], errors: [], tried: 0 }));
    },
    searchWeb: function (queries, opts) {
      ws.searchCalls.push({ queries: queries, opts: opts });
      if (c.searchThrows) return Promise.reject(c.searchThrows);
      return Promise.resolve(typeof c.searchResult === 'function'
        ? c.searchResult(queries, opts) : (c.searchResult || { results: [], errors: [], tried: 0 }));
    },
  };
  return ws;
}

/* 一份"像 Tapescript"的候选正文：长度 >=600、有 Tapescript/Questions/说话人/Conversation 标记，
 * 且每行都以句号结尾（没有问句），这样"从原文抽题干"不会误把对话里的问句当题干。 */
const TRANSCRIPT_LINES = [
  'Tapescript: 2023年12月英语六级听力原文',
  'Section A Conversation One',
  'Questions 1 to 4 are based on the conversation you have just heard.',
  'W: Good morning, Tom. Did you finish the report about the campus volunteer activity.',
  'M: Not yet, but I am almost done. I will send it to you this afternoon.',
  'W: Great. By the way, the professor asked us to prepare for the presentation next week.',
  'M: I know. Let us meet in the library after class and work on it together.',
  'W: That sounds good. See you then.',
  'M: Many students believe that taking part in volunteer work can help them understand the world better.',
  'W: I agree completely. It is also a good chance to make new friends and learn new skills.',
  'M: The most important thing is to keep practicing every day and never give up.',
  'W: Exactly. Practice makes perfect, and patience is the key to success.',
  'M: Let us start with the first section and then move on to the second one.',
  'W: Sure. We can finish the whole report before the weekend if we work together.',
];
const TRANSCRIPT_TEXT = TRANSCRIPT_LINES.join('\n');
const TRANSCRIPT_EVIDENCE = TRANSCRIPT_LINES[3];
const TRANSCRIPT_SCRIPT = TRANSCRIPT_LINES.slice(3, 9);

/* ================= 一、模块接口 ================= */

(async function main() {
  await check('M1. Node 侧导出全部纯函数与 run/afterImport', function () {
    const names = [
      'normalizeText', 'stemIsPlaceholder', 'stemsComplete', 'missingStemIndexes',
      'paperAudioKey', 'findStemDonors', 'copyStemsFromDonor', 'extractStemsFromScript',
      'verifyStemInScript', 'buildTranscriptQueries', 'buildStemQueries',
      'verifyTranscriptMatch', 'applyStemJson', 'readPatches', 'writePatch', 'applyPatches',
      'run', 'afterImport',
    ];
    names.forEach(function (name) {
      assert.equal(typeof AF[name], 'function', 'module.exports 缺少 ' + name);
    });
  });

  await check('M2. 浏览器侧挂到 window.ListeningAutoFill（模块顶层不碰 DOM/Store/AI）', function () {
    const code = fs.readFileSync(MODULE_PATH, 'utf8');
    const sandbox = { window: {}, console: console };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    assert.equal(typeof sandbox.window.ListeningAutoFill, 'object');
    assert.equal(typeof sandbox.window.ListeningAutoFill.run, 'function');
    assert.equal(typeof sandbox.window.ListeningAutoFill.afterImport, 'function');
    /* 顶层就访问 Store/AI/Dict 会在 Node 下直接 ReferenceError（上面的 vm 已能证明没碰）。
     * 这里再明确断一句，防止以后有人在顶层加 window.Store 访问。 */
    assert.ok(!/^\s*(?:const|let|var)\s+\w+\s*=\s*(?:Store|AI|Dict)\./m.test(code),
      '模块顶层不能读取 Store/AI/Dict');
  });

  /* ================= 二、文本归一与题干占位 ================= */

  await check('P1. normalizeText：小写、弯引号/破折号归一、空白压缩', function () {
    const normalizeText = fn('normalizeText');
    assert.equal(typeof normalizeText(''), 'string');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
    const lower = normalizeText('Hello World');
    assert.ok(!/[A-Z]/.test(lower), '应转小写：' + lower);
    assert.equal(normalizeText('  A   B  '), normalizeText('a b'), '多余空白应压缩');
    assert.equal(normalizeText('“Quoted”'), normalizeText('"Quoted"'), '弯双引号应归一');
    assert.equal(normalizeText('don’t'), normalizeText("don't"), '弯单引号应归一');
    assert.equal(normalizeText('a–b'), normalizeText('a-b'), '长破折号/短破折号应归一');
    assert.equal(normalizeText('\u00a0A\u00a0B'), normalizeText('a b'), '不换行空格应按空白处理');
    assert.equal(normalizeText('Line1\nLine2'), 'line1 line2', '换行/多空白统一成单空格');
  });

  await check('P2. stemIsPlaceholder：空/题号/Directions/中文占位算缺，真实题干不算缺', function () {
    const stemIsPlaceholder = fn('stemIsPlaceholder');
    /* 契约签名写作 stemIsPlaceholder(q)，实际入参是题目对象 {q}（模块内所有调用点都传 qs[i]）。
     * 两种形态都覆盖：对象缺 q / q 为占位串都算缺。 */
    ['', '   ', 'Question 5', 'question 5.', '5.', '5', '第5题',
      'Directions: In this section, you will hear three news reports.',
      '本题题干缺失', '本题题干未印在卷面（只在录音中播报）'].forEach(function (text) {
      assert.equal(stemIsPlaceholder({ q: text }), true, '应判为缺题干：' + JSON.stringify(text));
    });
    assert.equal(stemIsPlaceholder({}), true, '没有 q 字段算缺');
    assert.equal(stemIsPlaceholder(null), true);
    assert.equal(stemIsPlaceholder(undefined), true);
    assert.equal(stemIsPlaceholder({ q: null }), true);
    REAL_STEMS.forEach(function (stem) {
      assert.equal(stemIsPlaceholder({ q: stem }), false, '真实题干不应判缺：' + stem);
    });
  });

  await check('P3. stemsComplete / missingStemIndexes：按题判断、返回升序下标', function () {
    const stemsComplete = fn('stemsComplete');
    const missingStemIndexes = fn('missingStemIndexes');
    const partial = makePaper({ stems: [REAL_STEMS[0], 'Question 2', '', REAL_STEMS[3]] });
    assert.equal(stemsComplete(partial), false);
    assert.deepEqual(Array.from(missingStemIndexes(partial)), [1, 2]);
    const full = makePaper({ stems: REAL_STEMS });
    assert.equal(stemsComplete(full), true);
    assert.deepEqual(Array.from(missingStemIndexes(full)), []);
  });

  /* ================= 三、同一套听力识别与题干复用 ================= */

  await check('K1. paperAudioKey：同听力跨套相等；不同听力/选项换序不等', function () {
    const paperAudioKey = fn('paperAudioKey');
    const base = makePaper({ id: 'a', setNo: 1 });
    const sameOtherSet = makePaper({ id: 'b', setNo: 3, year: 2022, session: '06', title: '另一套标题' });
    const changedText = makePaper({ id: 'c', opts: OPTS_B });
    const swapped = makePaper({ id: 'd' });
    swapped.qs[0].opts = [swapped.qs[0].opts[1], swapped.qs[0].opts[0], swapped.qs[0].opts[2], swapped.qs[0].opts[3]];
    const differentType = makePaper({ id: 'e', type: 'cet4' });
    const fewer = makePaper({ id: 'f', stems: PLACEHOLDERS.slice(0, 3) });

    assert.equal(typeof paperAudioKey(base), 'string');
    assert.ok(paperAudioKey(base).length > 0);
    assert.equal(paperAudioKey(base), paperAudioKey(sameOtherSet), '同听力（仅套别/年份不同）key 必须相等');
    assert.notEqual(paperAudioKey(base), paperAudioKey(changedText), '选项文本不同必须不等');
    assert.notEqual(paperAudioKey(base), paperAudioKey(swapped), '选项顺序变化必须不等（顺序敏感）');
    assert.notEqual(paperAudioKey(base), paperAudioKey(differentType), '考试类型不同必须不等');
    assert.notEqual(paperAudioKey(base), paperAudioKey(fewer), '题目数不同必须不等');
  });

  await check('K2. findStemDonors：同 key + 题干完整 + 选项逐题相等；按 setNo 升序、排除自己', function () {
    const findStemDonors = fn('findStemDonors');
    const self = makePaper({ id: 'imp-self', setNo: 1 });
    const donor2 = makePaper({ id: 'imp-d2', setNo: 2, stems: REAL_STEMS });
    const donor1 = makePaper({ id: 'imp-d1', setNo: 1, stems: REAL_STEMS, year: 2023, session: '06' });
    const incomplete = makePaper({ id: 'imp-d3', setNo: 3, stems: ['Question 1', REAL_STEMS[1], REAL_STEMS[2], REAL_STEMS[3]] });
    const otherListening = makePaper({ id: 'imp-o', setNo: 4, stems: REAL_STEMS, opts: OPTS_B });
    const donors = findStemDonors(self, [self, donor2, incomplete, otherListening, donor1]);
    assert.equal(donors.length, 2, '只应命中 d1/d2，实际 ' + JSON.stringify(donors.map(function (d) { return d.paper && d.paper.id; })));
    assert.deepEqual(donors.map(function (d) { return Number(d.setNo); }), [1, 2], '应按 setNo 升序');
    assert.deepEqual(donors.map(function (d) { return d.paper.id; }), ['imp-d1', 'imp-d2']);
    donors.forEach(function (d) {
      assert.ok(Array.isArray(d.stemIdx), '契约要求返回 stemIdx（缺题干下标）');
      assert.deepEqual(d.stemIdx, [0, 1, 2, 3], '本卷四题都缺题干，stemIdx 应为全部下标');
      assert.ok(d.paper.id !== 'imp-self', '必须排除自己');
    });
  });

  await check('K3. copyStemsFromDonor：只补缺题、不动选项/答案，返回 filled/fromSet', function () {
    const findStemDonors = fn('findStemDonors');
    const copyStemsFromDonor = fn('copyStemsFromDonor');
    const donor = makePaper({ id: 'imp-donor', setNo: 2, stems: REAL_STEMS });
    const target = makePaper({
      id: 'imp-target', setNo: 1,
      stems: [REAL_STEMS[0], 'Question 2', '', REAL_STEMS[3]],
    });
    const donors = findStemDonors(target, [target, donor]);
    assert.equal(donors.length, 1, '应找到 donor');
    const optsBefore = clone(target.qs.map(function (q) { return q.opts; }));
    const answersBefore = target.qs.map(function (q) { return q.a; });
    /* 契约写 copyStemsFromDonor(paper, donor)，但 donor 是 findStemDonors 返回的包装对象
     * 还是里面的 paper，契约没有逐字规定。两种都接受，避免把测试绑死在实现细节上。 */
    let result = null;
    for (const arg of [donors[0].paper, donors[0]]) {
      const copy = makePaper({ id: 'imp-target', setNo: 1, stems: [REAL_STEMS[0], 'Question 2', '', REAL_STEMS[3]] });
      try {
        const out = copyStemsFromDonor(copy, arg);
        if (out && out.filled) { result = { paper: copy, out: out }; break; }
        result = result || { paper: copy, out: out };
      } catch (e) { /* 换一种 donor 传法再试 */ }
    }
    assert.ok(result && result.out.filled === 2, '应通过 donor 篇目补全 2 题');
    const out = result.out;
    assert.equal(out.filled, 2, '只应补 2 题缺题干，实际 ' + out.filled);
    assert.equal(Number(out.fromSet), 2);
    assert.deepEqual(result.paper.qs.map(function (q) { return q.q; }), REAL_STEMS, '补全后应等于 donor 题干');
    assert.deepEqual(result.paper.qs.map(function (q) { return q.opts; }), optsBefore, '选项不能动');
    assert.deepEqual(result.paper.qs.map(function (q) { return q.a; }), answersBefore, '答案不能动');
    /* 目标与 donor 都完整时 filled 应为 0 */
    const full = makePaper({ id: 'imp-full', stems: REAL_STEMS });
    const r2 = copyStemsFromDonor(full, donors[0].paper);
    assert.equal(r2.filled, 0);
  });

  /* ================= 四、从原文抽题干 / 逐字校验 ================= */

  await check('S1. extractStemsFromScript：Question N / N. 两种格式，Directions 不算', function () {
    const extractStemsFromScript = fn('extractStemsFromScript');
    const paper = makePaper({ title: 'Questions 1 to 4' });
    const script = [
      { s: 0, en: 'Directions: In this section, you will hear four questions.' },
      { s: 1, en: 'Question 1. What does the man want to do?' },
      { s: 2, en: 'Question 2. Where does the conversation most probably take place?' },
      { s: 3, en: '3. What is the woman?' },
      { s: 4, en: '4. How will the man go there?' },
    ];
    const out = extractStemsFromScript(paper, script);
    assert.equal(out.found, 4, '应找到 4 个口播题干，实际 ' + out.found);
    assert.deepEqual(
      [0, 1, 2, 3].map(function (i) { return out.stems[i]; }),
      REAL_STEMS
    );
    assert.ok(!Object.values(out.stems).some(function (s) { return /^Directions/i.test(String(s)); }),
      'Directions 不能算题干');
  });

  await check('S2. extractStemsFromScript：按题号映射（Questions 5-8 → 下标 0-3）', function () {
    const extractStemsFromScript = fn('extractStemsFromScript');
    const stems = ['Question 5', 'Question 6', 'Question 7', 'Question 8'];
    const paper = makePaper({ title: 'Questions 5 to 8', stems: stems });
    const script = [
      { s: 0, en: 'Questions 5 to 8 are based on the passage you have just heard.' },
      { s: 1, en: 'Question 5. What is the speaker mainly talking about?' },
      { s: 2, en: 'Question 6. According to the speaker, what is the biggest problem?' },
      { s: 3, en: 'Question 7. What does the speaker suggest we do?' },
      { s: 4, en: 'Question 8. Why does the speaker mention the example?' },
    ];
    const out = extractStemsFromScript(paper, script);
    assert.equal(out.found, 4, '应映射 4 题，实际 ' + out.found);
    assert.equal(out.stems[0], 'What is the speaker mainly talking about?', '第 5 题应映射到下标 0');
    assert.equal(out.stems[3], 'Why does the speaker mention the example?');
  });

  await check('S3. extractStemsFromScript：没有题号线索时按出现顺序兜底；短句不算题干', function () {
    const extractStemsFromScript = fn('extractStemsFromScript');
    const paper = makePaper({ title: 'Questions 1 to 3', stems: PLACEHOLDERS.slice(0, 3) });
    const script = [
      { s: 0, en: 'What does the man want to do?' },
      { s: 1, en: 'Where does the conversation most probably take place?' },
      { s: 2, en: 'What is the woman?' },
      { s: 3, en: 'Okay?' },
    ];
    const out = extractStemsFromScript(paper, script);
    assert.equal(out.found, 3, '应按出现顺序映射 3 题，实际 ' + out.found);
    assert.equal(out.stems[0], 'What does the man want to do?');
    assert.equal(out.stems[2], 'What is the woman?');
    assert.ok(!Object.values(out.stems).some(function (s) { return /^Okay\?$/.test(String(s)); }),
      '少于 3 个英文单词的短句不算题干');
  });

  await check('V1. verifyStemInScript：逐字命中；标点/空格差异仍命中；改写不命中', function () {
    const verifyStemInScript = fn('verifyStemInScript');
    const script = 'W: Good morning, Tom. M: Hi. W: What is the main idea of the talk? It is about cities.';
    assert.equal(verifyStemInScript('What is the main idea of the talk?', script), true, '逐字应命中');
    assert.equal(verifyStemInScript('what is the main idea of the talk', script), true, '大小写/标点差异应命中');
    assert.equal(verifyStemInScript('What  is  the main idea of the talk?', script), true, '多空格差异应命中');
    assert.equal(verifyStemInScript('What is the main topic of the lecture?', script), false, '改写必须不命中（禁止编造）');
    assert.equal(verifyStemInScript('What is the main idea of the talk?', ''), false);
    assert.equal(verifyStemInScript('', script), false);
  });

  /* ================= 五、搜索词与结构化门槛 ================= */

  await check('Q1. buildTranscriptQueries：2~4 条、含年份/月份/类型、无占位词', function () {
    const buildTranscriptQueries = fn('buildTranscriptQueries');
    const queries = buildTranscriptQueries({ type: 'cet6', year: 2023, session: '12', setNo: 1, title: '校园志愿活动' });
    assert.ok(Array.isArray(queries));
    assert.ok(queries.length >= 2 && queries.length <= 4, '应 2~4 条，实际 ' + queries.length);
    assert.equal(new Set(queries).size, queries.length, '搜索词不能重复');
    queries.forEach(function (q) {
      assert.equal(typeof q, 'string');
      assert.ok(q.trim().length > 0);
      assert.ok(!/undefined|null|NaN/.test(q), '不能出现占位词：' + q);
    });
    const joined = queries.join(' ');
    assert.ok(joined.includes('2023'), '缺少年份：' + joined);
    assert.ok(joined.includes('12'), '缺少月份：' + joined);
    assert.ok(/六级|CET[ -]?6/i.test(joined), '缺少考试类型：' + joined);
    assert.ok(/Tapescript|听力原文|真题原文/i.test(joined), '缺少原文关键词：' + joined);
  });

  await check('Q2. buildStemQueries：含年份/月份/题号/类型，用于搜题干', function () {
    const buildStemQueries = fn('buildStemQueries');
    const paper = makePaper({ title: 'Questions 5 to 8', stems: ['Question 5', 'Question 6', 'Question 7', 'Question 8'] });
    const queries = buildStemQueries(paper);
    assert.ok(Array.isArray(queries));
    assert.ok(queries.length >= 1, '至少一条搜索词');
    assert.equal(new Set(queries).size, queries.length, '搜索词不能重复');
    queries.forEach(function (q) {
      assert.equal(typeof q, 'string');
      assert.ok(q.trim().length > 0);
      assert.ok(!/undefined|null|NaN/.test(q));
    });
    const joined = queries.join(' ');
    assert.ok(joined.includes('2023'), '缺少年份：' + joined);
    assert.ok(/六级|CET[ -]?6/i.test(joined), '缺少考试类型：' + joined);
    assert.ok(/5/.test(joined), '缺少题号线索：' + joined);
    assert.ok(/题干|question/i.test(joined), '缺少题干关键词：' + joined);
  });

  await check('Q3. verifyTranscriptMatch：够长+有标记 → ok；太短/无标记 → not ok', function () {
    const verifyTranscriptMatch = fn('verifyTranscriptMatch');
    const paper = makePaper({ title: 'Questions 1 to 4' });
    const body = [
      'Tapescript 2023年12月英语六级听力原文',
      'Section A Conversation One',
      'Questions 1 to 4 are based on the conversation you have just heard.',
      'W: Good morning, Tom. Did you finish the report?',
      'M: Not yet, but I am almost done. I will send it to you this afternoon.',
      'W: Great. By the way, the professor asked us to prepare for the presentation.',
      'M: I know. Let us meet in the library after class and work on it together.',
      'W: That sounds good. See you then.',
    ].join('\n') + '\n' + new Array(12).join('M: I think the most important thing is to practice every day and never give up.\n');
    const good = verifyTranscriptMatch(paper, body);
    assert.equal(good.ok, true, '结构化门槛应通过：' + JSON.stringify(good));
    assert.equal(typeof good.score, 'number');
    assert.ok(Array.isArray(good.hits) && good.hits.length > 0, '应记录命中的结构化标记');
    assert.ok(/(question|conversation|tapescript)/i.test(good.hits.join(' ')), '命中的标记应可读：' + good.hits.join(' '));

    const short = verifyTranscriptMatch(paper, 'Tapescript: hello.');
    assert.equal(short.ok, false, '太短不能通过：' + JSON.stringify(short));

    const noMarker = verifyTranscriptMatch(paper, new Array(20).join(
      'The weather is very nice today and students like to walk around the campus after class. '));
    assert.equal(noMarker.ok, false, '没有 Tapescript/Questions/Conversation 标记不能通过');
    assert.ok(!noMarker.hits.some(function (h) { return /^(label|questions|speakers|genre)/.test(h); }),
      '无标记时 hits 只能有长度项：' + noMarker.hits.join(','));

    assert.equal(verifyTranscriptMatch(paper, '').ok, false);
  });

  /* ================= 六、AI 题干 JSON 校验 ================= */

  await check('J1. applyStemJson：4 个选项且 ≥3/4 匹配才接受，只返回结果不改 paper', function () {
    const applyStemJson = fn('applyStemJson');
    const paper = makePaper({ id: 'j1' });
    const res = applyStemJson({ items: [
      { i: 0, stem: REAL_STEMS[0], options: OPTS_A[0].slice() },
      /* 3/4 匹配：前三个选项一致、第四个是别的题 → 仍应接受 */
      { i: 1, stem: REAL_STEMS[1], options: [OPTS_A[1][0], OPTS_A[1][1], OPTS_A[1][2], 'Violet tornado glacier'] },
    ] }, paper, {});
    assert.equal(res.accepted, 2, '两题都应接受：' + JSON.stringify(res));
    assert.equal(res.rejected, 0);
    assert.equal(res.stems[0], REAL_STEMS[0]);
    assert.equal(res.stems[1], REAL_STEMS[1]);
    assert.equal(paper.qs[0].q, 'Question 1', 'applyStemJson 只返回结果，不直接改 paper');
  });

  await check('J2. applyStemJson：选项不符/缺选项/越界/已有题干/题干不像 → 逐题拒绝', function () {
    const applyStemJson = fn('applyStemJson');
    const paper = makePaper({ id: 'j2' });
    paper.qs[2].q = REAL_STEMS[2];   // 第 3 题已有真实题干
    const res = applyStemJson({ items: [
      { i: 0, stem: REAL_STEMS[0], options: OPTS_B[0] },                    // 选项完全不符
      { i: 1, stem: REAL_STEMS[1] },                                        // 缺 options
      { i: 9, stem: REAL_STEMS[3], options: OPTS_A[3] },                    // 越界
      { i: 2, stem: 'Another made up question here?', options: OPTS_A[2] }, // 已有题干，不能覆盖
      { i: 3, stem: 'Question 4', options: OPTS_A[3] },                     // 题干不像题干
    ] }, paper, {});
    assert.equal(res.accepted, 0, '必须全部拒绝：' + JSON.stringify(res));
    assert.equal(res.rejected, 5, 'rejected 应逐题计数');
    assert.deepEqual(Object.keys(res.stems), []);
  });

  await check('J3. applyStemJson：1-based 下标自动识别；opts 字段；requireOptions:false', function () {
    const applyStemJson = fn('applyStemJson');
    const paper = makePaper({ id: 'j3' });
    const oneBased = applyStemJson([{ index: 1, stem: REAL_STEMS[0], opts: OPTS_A[0].slice() }], paper, {});
    assert.equal(oneBased.accepted, 1, '1-based 下标应映射到下标 0：' + JSON.stringify(oneBased));
    assert.equal(oneBased.stems[0], REAL_STEMS[0]);
    const paper2 = makePaper({ id: 'j3b' });
    const noOptions = applyStemJson({ questions: [{ i: 0, q: REAL_STEMS[0] }] }, paper2, { requireOptions: false });
    assert.equal(noOptions.accepted, 1, 'requireOptions:false 时允许无选项：' + JSON.stringify(noOptions));
    assert.equal(noOptions.stems[0], REAL_STEMS[0]);
  });

  /* ================= 七、补丁读写与应用 ================= */

  await check('F1. readPatches：读 store.d.lsnPatch，缺省/异常返回 {}', function () {
    const readPatches = fn('readPatches');
    const patchMap = { 'imp-a': { stems: { 0: 'x' } } };
    assert.equal(readPatches({ d: { lsnPatch: patchMap } }), patchMap);
    assert.deepEqual(readPatches({ d: {} }), {});
    assert.deepEqual(readPatches({}), {});
    assert.deepEqual(readPatches(null), {});
  });

  await check('F2. writePatch：合并写入、stems 逐题合并、不覆盖已有 script、不负责 flush', function () {
    const writePatch = fn('writePatch');
    const store = makeStore();
    assert.equal(writePatch(store, 'imp-a', { stems: { 0: REAL_STEMS[0] }, stemSource: 'set' }), true);
    assert.equal(writePatch(store, 'imp-a', { stems: { 1: REAL_STEMS[1] }, stemSource: 'transcript' }), true);
    const patch = store.d.lsnPatch['imp-a'];
    assert.equal(patch.stems[0], REAL_STEMS[0], '先写入的题干不能被合并冲掉');
    assert.equal(patch.stems[1], REAL_STEMS[1]);
    assert.equal(patch.stemSource, 'transcript');
    assert.ok(patch.at, '应写入 ISO 时间戳');
    assert.equal(store.flushCount, 0, 'writePatch 不负责 flush');
    writePatch(store, 'imp-a', { script: [{ s: 0, en: 'W: New line.' }], scriptSource: 'web' });
    writePatch(store, 'imp-a', { stems: { 2: REAL_STEMS[2] } });
    assert.equal(store.d.lsnPatch['imp-a'].script.length, 1, '空 script 不能把已有 script 冲掉');
    assert.equal(writePatch(null, 'x', {}), false);
    assert.equal(writePatch(store, '', {}), false);
  });

  await check('F3. applyPatches：script 为空才补、题干缺才补、返回改动篇数', function () {
    const applyPatches = fn('applyPatches');
    const p1 = makePaper({ id: 'imp-a' });
    const p2 = makePaper({ id: 'imp-b',
      stems: ['Question 1', REAL_STEMS[1], REAL_STEMS[2], REAL_STEMS[3]],
      script: [{ s: 0, en: 'W: This is the original script.' }] });
    const p3 = makePaper({ id: 'imp-c', stems: REAL_STEMS, script: [{ s: 0, en: 'W: Complete.' }] });
    const patches = {
      'imp-a': {
        script: [{ s: 0, en: 'W: Hello there, this is the tapescript.' }],
        stems: { 0: REAL_STEMS[0], 1: REAL_STEMS[1] },
        stemSource: 'transcript', at: '2026-10-26T00:00:00.000Z',
      },
      'imp-b': { script: [{ s: 0, en: 'W: SHOULD NOT REPLACE.' }], stems: { 0: REAL_STEMS[0] } },
      'imp-c': { stems: { 0: 'A completely different made up stem here?' } },
    };
    const optsSnapshot = clone(p1.qs.map(function (q) { return q.opts; }));
    const changed = applyPatches([p1, p2, p3], patches);
    assert.equal(changed, 2, '应改动 2 篇，实际 ' + changed);
    assert.equal(p1.script.length, 1, 'script 为空应补');
    assert.equal(p1.qs[0].q, REAL_STEMS[0]);
    assert.equal(p1.qs[1].q, REAL_STEMS[1]);
    assert.equal(p1.qs[2].q, 'Question 3', 'patch 未提供的题不能动');
    assert.deepEqual(p1.qs.map(function (q) { return q.opts; }), optsSnapshot, 'applyPatches 不能动选项');
    assert.equal(p1.stemSource, 'transcript');
    assert.equal(p2.script[0].en, 'W: This is the original script.', '已有原文不能被 patch 覆盖');
    assert.equal(p2.qs[0].q, REAL_STEMS[0]);
    assert.equal(p3.qs[0].q, REAL_STEMS[0], '已有真实题干不能被覆盖');
    assert.equal(p3.script[0].en, 'W: Complete.');
  });

  await check('F4. applyPatches：共享副本 id 回退原 id 补丁；未知 id/空补丁忽略', function () {
    const applyPatches = fn('applyPatches');
    const shared = makePaper({ id: 'imp-x-shared-2', setNo: 2 });
    applyPatches([shared], { 'imp-x': { stems: { 0: REAL_STEMS[0] } } });
    assert.equal(shared.qs[0].q, REAL_STEMS[0], 'xxx-shared-2 应回退到 imp-x 的补丁');
    const unknown = makePaper({ id: 'imp-unknown' });
    assert.equal(applyPatches([unknown], { 'imp-other': { stems: { 0: REAL_STEMS[0] } } }), 0);
    assert.equal(unknown.qs[0].q, 'Question 1');
    assert.equal(applyPatches([unknown], null), 0);
    assert.equal(applyPatches(null, {}), 0);
  });

  /* ================= 八、run 编排（stub 注入，不碰真实网络/AI） ================= */

  await check('R1. run 同套共享：同 key 完整 donor → 补题干、stemsFrom=set、不联网', async function () {
    const run = fn('run');
    const target = makePaper({ id: 'imp-share', setNo: 1, stems: ['Question 1', 'Question 2', 'Question 3', 'Question 4'],
      script: [{ s: 0, en: 'W: This paper already has its tapescript.' }] });
    const donor = makePaper({ id: 'imp-donor', setNo: 2, stems: REAL_STEMS });
    const store = makeStore();
    const ws = makeWebSearch({ collectThrows: new Error('不应该联网') });
    const patches = [];
    const report = await run(target, {
      webSearch: ws, ai: makeAi({}), store: store, pool: [donor],
      onPatch: function (p, patch) { patches.push(patch); },
    });
    assert.equal(report.stemsFilled, 4, '应从 donor 补 4 题：' + JSON.stringify(report));
    assert.equal(report.stemsFrom, 'set');
    assert.equal(Number(report.donorSetNo), 2);
    assert.equal(report.scriptAdded, false);
    assert.equal(report.status, 'done');
    assert.deepEqual(target.qs.map(function (q) { return q.q; }), REAL_STEMS);
    assert.equal(store.d.lsnPatch['imp-share'].stems['0'], REAL_STEMS[0]);
    assert.equal(store.d.lsnPatch['imp-share'].stemSource, 'set');
    assert.equal(store.d.lsnPatch['imp-share'].stemFromSet, 2);
    assert.equal(patches.length, 1);
    assert.equal(ws.collectCalls.length, 0, '同套共享不应联网检索原文');
    assert.equal(ws.searchCalls.length, 0, '同套共享不应联网搜题干');
  });

  await check('R2. run 联网补原文：结构化门槛 + AI 逐字证据 + 切分 → 写 patch(script/url/verdict)', async function () {
    const run = fn('run');
    const paper = makePaper({ id: 'imp-web' });
    const store = makeStore();
    const ws = makeWebSearch({ collectResult: {
      text: TRANSCRIPT_TEXT,
      sources: [{ url: 'https://example.com/tape', title: '2023-12 Tapescript', len: TRANSCRIPT_TEXT.length }],
      errors: [], tried: 1,
    } });
    const ai = makeAi(function (call) {
      if (/Tapescript 校对员/.test(call.user)) return { match: true, evidence: TRANSCRIPT_EVIDENCE, script: TRANSCRIPT_SCRIPT };
      if (/找出原文中/.test(call.user)) return { items: [] };
      if (/找出每道题/.test(call.user)) return { items: [] };
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const patches = [];
    const report = await run(paper, {
      webSearch: ws, ai: ai, store: store, pool: [],
      onPatch: function (p, patch) { patches.push(patch); },
    });
    assert.equal(report.scriptAdded, true, '应补入原文：' + JSON.stringify(report));
    assert.equal(report.scriptUrl, 'https://example.com/tape');
    assert.equal(report.scriptVerdict, 'ai-verified');
    assert.ok(paper.script.length >= 2, '原文应写入篇目');
    assert.equal(paper.scriptSource, 'web');
    assert.equal(paper.scriptUrl, 'https://example.com/tape');
    const patch = store.d.lsnPatch['imp-web'];
    assert.ok(patch && patch.script && patch.script.length >= 2, '补丁应包含 script');
    assert.equal(patch.scriptSource, 'web');
    assert.equal(patch.scriptUrl, 'https://example.com/tape');
    assert.equal(patch.scriptVerdict, 'ai-verified');
    assert.equal(patches.length, 1, 'onPatch 应调用一次');
    assert.ok(ws.collectCalls.length >= 1, '应调用一次联网检索原文');
  });

  await check('R3. run 从原文补题干：Question 5…? 逐字映射，stemsFrom=transcript，无需联网/AI', async function () {
    const run = fn('run');
    const paper = makePaper({ id: 'imp-scripted', title: 'Questions 5 to 8',
      stems: ['Question 5', 'Question 6', 'Question 7', 'Question 8'] });
    paper.script = [
      { s: 0, en: 'W: Now let us listen to the passage.' },
      { s: 1, en: 'Question 5. What is the speaker mainly talking about?' },
      { s: 2, en: 'Question 6. According to the speaker, what is the biggest problem?' },
      { s: 3, en: 'Question 7. What does the speaker suggest we do?' },
      { s: 4, en: 'Question 8. Why does the speaker mention the example?' },
    ];
    const store = makeStore();
    const ws = makeWebSearch({});
    const ai = { ready: false, calls: [], jsonRetry: function () { throw new Error('AI 不应被调用'); } };
    const report = await run(paper, { webSearch: ws, ai: ai, store: store, pool: [] });
    assert.equal(report.stemsFilled, 4, '应补 4 题：' + JSON.stringify(report));
    assert.equal(report.stemsFrom, 'transcript');
    assert.equal(report.status, 'done');
    assert.deepEqual(paper.qs.map(function (q) { return q.q; }), [
      'What is the speaker mainly talking about?',
      'According to the speaker, what is the biggest problem?',
      'What does the speaker suggest we do?',
      'Why does the speaker mention the example?',
    ]);
    const scriptText = paper.script.map(function (l) { return l.en; }).join('\n');
    paper.qs.forEach(function (q) {
      assert.equal(fn('verifyStemInScript')(q.q, scriptText), true, '题干必须逐字在原文中：' + q.q);
    });
    assert.equal(store.d.lsnPatch['imp-scripted'].stemSource, 'transcript');
    assert.equal(store.d.lsnPatch['imp-scripted'].stems['0'], 'What is the speaker mainly talking about?');
    assert.equal(ws.collectCalls.length, 0, '已有原文不应联网');
    assert.equal(ws.searchCalls.length, 0);
  });

  await check('R4. run 联网补题干：选项 ≥3/4 匹配才写入；选项不符整题拒绝且不改卷', async function () {
    const run = fn('run');
    function basePaper(id) {
      const paper = makePaper({ id: id });
      paper.script = [{ s: 0, en: 'W: The passage talks about how students learn English every day.' }];
      return paper;
    }
    const candidate = '2023年12月英语六级听力第1题：What does the man want to do? '
      + 'A) The man wants to change his major. B) The woman is a new student here. '
      + 'C) The lecture was cancelled. D) The exam has been postponed.';
    const result = function () {
      return { results: [{ url: 'https://example.com/stems', text: candidate, title: '题干', score: 5 }], errors: [], tried: 1 };
    };
    const paperOk = basePaper('imp-webstem');
    const storeOk = makeStore();
    const aiOk = makeAi(function (call) {
      if (/找出原文中/.test(call.user)) return { items: [] };
      if (/找出每道题/.test(call.user)) {
        return { items: [{ i: 0, stem: 'What does the man want to do?',
          options: [OPTS_A[0][0], OPTS_A[0][1], OPTS_A[0][2], 'Violet tornado glacier'] }] };
      }
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const reportOk = await run(paperOk, {
      webSearch: makeWebSearch({ searchResult: result }), ai: aiOk, store: storeOk, pool: [],
    });
    assert.equal(reportOk.stemsFilled, 1, '选项 3/4 匹配应接受：' + JSON.stringify(reportOk));
    assert.equal(reportOk.stemsFrom, 'web');
    assert.equal(paperOk.qs[0].q, 'What does the man want to do?');
    assert.equal(storeOk.d.lsnPatch['imp-webstem'].stemSource, 'web');

    const paperBad = basePaper('imp-webstem-bad');
    const before = clone(paperBad.qs);
    const aiBad = makeAi(function (call) {
      if (/找出原文中/.test(call.user)) return { items: [] };
      if (/找出每道题/.test(call.user)) {
        return { items: [{ i: 0, stem: 'What does the man want to do?', options: OPTS_B[0].slice() }] };
      }
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const reportBad = await run(paperBad, {
      webSearch: makeWebSearch({ searchResult: result }), ai: aiBad, store: makeStore(), pool: [],
    });
    assert.equal(reportBad.stemsFilled, 0, '选项不符必须拒绝：' + JSON.stringify(reportBad));
    assert.deepEqual(paperBad.qs, before, '拒绝时不能改动题目');
    assert.ok(reportBad.errors.some(function (e) { return /^verify: 联网题干与本题选项不一致/.test(e); }),
      'errors: ' + JSON.stringify(reportBad.errors));
  });

  await check('R5. run 降级：联网抛错/超时/空结果/AI 未配置 → 不抛异常、不改错数据、errors 可读', async function () {
    const run = fn('run');
    /* 5a 联网检索抛普通错误 */
    const paperA = makePaper({ id: 'imp-fail-a' });
    const storeA = makeStore();
    const reportA = await run(paperA, {
      webSearch: makeWebSearch({ collectThrows: new Error('boom'), searchThrows: new Error('net down') }),
      ai: makeAi({}), store: storeA, pool: [],
    });
    assert.deepEqual(paperA.qs.map(function (q) { return q.q; }), PLACEHOLDERS, '失败不能改卷子');
    assert.equal(paperA.script.length, 0);
    assert.equal(storeA.d.lsnPatch, undefined, '没有改动不应写补丁');
    assert.ok(['skipped', 'partial', 'failed'].indexOf(reportA.status) >= 0);
    assert.ok(reportA.errors.some(function (e) { return /^web: /.test(e); }), 'errors: ' + JSON.stringify(reportA.errors));

    /* 5b 超时（AbortError → 'web: timeout'） */
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const paperB = makePaper({ id: 'imp-fail-b' });
    const reportB = await run(paperB, {
      webSearch: makeWebSearch({ collectThrows: abort }), ai: makeAi({}), store: makeStore(), pool: [],
    });
    assert.ok(reportB.errors.indexOf('web: timeout') >= 0, '超时应记录 web: timeout：' + JSON.stringify(reportB.errors));

    /* 5c 联网返回空文本 */
    const paperC = makePaper({ id: 'imp-fail-c' });
    const reportC = await run(paperC, {
      webSearch: makeWebSearch({ collectResult: { text: '   ', sources: [], errors: [], tried: 0 } }),
      ai: makeAi({}), store: makeStore(), pool: [],
    });
    assert.ok(reportC.errors.indexOf('web: 没有检索到可用网页') >= 0, 'errors: ' + JSON.stringify(reportC.errors));

    /* 5d AI 未配置：不联网、不抛 */
    const paperD = makePaper({ id: 'imp-fail-d' });
    const wsD = makeWebSearch({});
    const reportD = await run(paperD, { webSearch: wsD, ai: { ready: false }, store: makeStore(), pool: [] });
    assert.equal(wsD.collectCalls.length, 0, 'AI 未配置时不应联网检索原文');
    assert.equal(wsD.searchCalls.length, 0, 'AI 未配置时不应联网搜题干');
    assert.ok(reportD.errors.some(function (e) { return /^ai: AI 未配置/.test(e); }), 'errors: ' + JSON.stringify(reportD.errors));
    assert.equal(reportD.status, 'skipped');
    assert.deepEqual(paperD.qs.map(function (q) { return q.q; }), PLACEHOLDERS);
  });

  await check('R6. run 降级：AI 题干不在原文 → 逐字核验丢弃；AI 证据句不在正文 → 丢弃原文', async function () {
    const run = fn('run');
    /* 6a 从原文抽题干：AI 编造的题干必须被 verifyStemInScript 拦下 */
    const paper = makePaper({ id: 'imp-fake-stem' });
    paper.script = [
      { s: 0, en: 'W: The lecture is about the history of the city and its people.' },
      { s: 1, en: 'M: I found the topic very interesting and useful for our project.' },
    ];
    const store = makeStore();
    const ai = makeAi(function (call) {
      if (/找出原文中/.test(call.user)) return { items: [{ i: 0, stem: 'Which statement is completely invented by the model?' }] };
      if (/找出每道题/.test(call.user)) return { items: [] };
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const before = clone(paper.qs);
    const report = await run(paper, { webSearch: makeWebSearch({}), ai: ai, store: store, pool: [] });
    assert.equal(report.stemsFilled, 0, '编造题干必须丢弃：' + JSON.stringify(report));
    assert.deepEqual(paper.qs, before, '卷子不能被改');
    assert.equal(store.d.lsnPatch, undefined);
    assert.equal(ai.calls.filter(function (c) { return /找出原文中/.test(c.user); }).length, 1, '应尝试过一次 AI 从原文抽题干');

    /* 6b 联网原文：AI 证据句不在候选正文 → 整段丢弃，不写 script */
    const paper2 = makePaper({ id: 'imp-fake-evidence' });
    const ws = makeWebSearch({ collectResult: { text: TRANSCRIPT_TEXT, sources: [{ url: 'https://example.com/x' }], errors: [], tried: 1 } });
    const ai2 = makeAi(function (call) {
      if (/Tapescript 校对员/.test(call.user)) {
        return { match: true, evidence: 'This sentence never appears in the candidate text at all.', script: TRANSCRIPT_SCRIPT };
      }
      if (/找出原文中/.test(call.user)) return { items: [] };
      if (/找出每道题/.test(call.user)) return { items: [] };
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const report2 = await run(paper2, { webSearch: ws, ai: ai2, store: makeStore(), pool: [] });
    assert.equal(report2.scriptAdded, false, '证据不逐字必须丢弃：' + JSON.stringify(report2));
    assert.equal(paper2.script.length, 0);
    assert.ok(report2.errors.some(function (e) { return /^verify: AI 证据句未能在候选正文中逐字找到/.test(e); }),
      'errors: ' + JSON.stringify(report2.errors));
  });

  await check('R7. run 选项：allowNetwork=false 时完全不联网，errors 说明已关闭', async function () {
    const run = fn('run');
    const paper = makePaper({ id: 'imp-nonet' });
    const ws = makeWebSearch({});
    const report = await run(paper, { webSearch: ws, ai: makeAi({}), store: makeStore(), pool: [], allowNetwork: false });
    assert.equal(ws.collectCalls.length, 0, 'allowNetwork=false 不能联网检索原文');
    assert.equal(ws.searchCalls.length, 0, 'allowNetwork=false 不能联网搜题干');
    assert.ok(report.errors.indexOf('web: 已关闭联网补全') >= 0, 'errors: ' + JSON.stringify(report.errors));
    assert.equal(report.status, 'skipped');
  });

  await check('R8. run 选项：allowAi=false 时跳过 AI，但原文里确定性题干仍会补', async function () {
    const run = fn('run');
    const paper = makePaper({ id: 'imp-noai', title: 'Questions 5 to 8',
      stems: ['Question 5', 'Question 6', 'Question 7', 'Question 8'] });
    paper.script = [
      { s: 0, en: 'Question 5. What is the speaker mainly talking about?' },
      { s: 1, en: 'Question 6. According to the speaker, what is the biggest problem?' },
    ];
    let aiCalls = 0;
    const ai = { ready: true, jsonRetry: function () { aiCalls++; return Promise.resolve({ items: [] }); } };
    const report = await run(paper, { webSearch: makeWebSearch({}), ai: ai, store: makeStore(), pool: [], allowAi: false });
    assert.equal(aiCalls, 0, 'allowAi=false 不能调用 AI');
    assert.ok(report.stemsFilled >= 2, '原文口播题干是确定性结果，不受 allowAi 影响：' + JSON.stringify(report));
    assert.equal(paper.qs[0].q, 'What is the speaker mainly talking about?');
  });

  await check('R9. pickBestBlock / excerptForQuestions：多页候选里挑最像该篇的一页、按题号截窗口', function () {
    const pickBestBlock = fn('pickBestBlock');
    const excerptForQuestions = fn('excerptForQuestions');
    const paper = makePaper({ id: 'imp-block', title: 'Questions 5 to 8',
      stems: ['Question 5', 'Question 6', 'Question 7', 'Question 8'] });
    const bad = { url: 'https://bad.example', text: 'A page about cooking. It has no exam content at all.\n'.repeat(20) };
    const good = { url: 'https://good.example', text: [
      '2023年12月英语六级听力原文 Tapescript',
      'Questions 5 to 8 are based on the passage you have just heard.',
      'Question 5. What is the speaker mainly talking about?',
      'W: Good morning, this is the actual tapescript line for the passage.',
      'M: Yes, and this is the second line of the tapescript.',
    ].join('\n') };
    const best = pickBestBlock([bad, good], paper);
    assert.ok(best, '应挑出一页');
    assert.equal(best.url, 'https://good.example', '应挑题号/标记命中的那页：' + (best && best.url));
    assert.equal(pickBestBlock([], paper), null);
    assert.equal(pickBestBlock(null, paper), null);

    const pad = new Array(400).join('W: A filler tapescript sentence used only for padding here.\n');
    const long = pad + 'Question 5. This is the real stem sentence in the middle of a very long page.\n' + pad;
    const cut = excerptForQuestions(long, paper, 3000);
    assert.ok(cut.length <= 3000, '截取长度不能超上限：' + cut.length);
    assert.ok(cut.indexOf('Question 5. This is the real stem sentence') >= 0, '截取窗口应包含题号锚点');
    assert.equal(excerptForQuestions('', paper, 3000), '');
  });

  await check('R10. run 联网原文：多页 blocks 时按题号选页喂 AI，并把多引擎/主题门槛传给检索', async function () {
    const run = fn('run');
    const paper = makePaper({ id: 'imp-block-run', title: 'Questions 5 to 8',
      stems: ['Question 5', 'Question 6', 'Question 7', 'Question 8'] });
    const badPage = 'A page about cooking and travelling around the world with friends and family.\n'.repeat(20);
    const goodPage = [
      'Tapescript: 2023年12月英语六级听力原文',
      'Questions 5 to 8 are based on the passage you have just heard.',
      'Question 5. What is the speaker mainly talking about?',
      'W: Good morning, this is the actual tapescript line for the passage.',
      'M: Yes, and this is the second line of the tapescript.',
    ].join('\n');
    const ws = makeWebSearch({ collectResult: {
      text: TRANSCRIPT_TEXT,
      blocks: [
        { url: 'https://bad.example', title: 'cooking', text: badPage },
        { url: 'https://good.example', title: 'tape', text: goodPage },
      ],
      sources: [{ url: 'https://good.example', title: 'tape', len: goodPage.length }],
      errors: [], tried: 2,
    } });
    const ai = makeAi(function (call) {
      if (/Tapescript 校对员/.test(call.user)) {
        return { match: true,
          evidence: 'W: Good morning, this is the actual tapescript line for the passage.',
          script: [
            'W: Good morning, this is the actual tapescript line for the passage.',
            'M: Yes, and this is the second line of the tapescript.',
          ] };
      }
      if (/找出原文中/.test(call.user)) return { items: [] };
      if (/找出每道题/.test(call.user)) return { items: [] };
      throw new Error('unexpected AI prompt: ' + call.user.slice(0, 40));
    });
    const report = await run(paper, { webSearch: ws, ai: ai, store: makeStore(), pool: [] });
    assert.equal(report.scriptAdded, true, '应补入原文：' + JSON.stringify(report));
    const transcriptCall = ai.calls.filter(function (c) { return /Tapescript 校对员/.test(c.user); })[0];
    assert.ok(transcriptCall, '应有原文审核 AI 调用');
    assert.ok(transcriptCall.user.indexOf('actual tapescript line') >= 0, 'AI 应拿到选中的那一页正文');
    assert.ok(transcriptCall.user.indexOf('about cooking') < 0, '不能把无关页喂给 AI');
    const searchOpts = ws.collectCalls[0] && ws.collectCalls[0].opts || {};
    assert.ok(Array.isArray(searchOpts.engines) && searchOpts.engines.indexOf('baidu') >= 0, '应显式传多引擎列表');
    assert.equal(searchOpts.maxPages, 6, '应多抓几页（实网前几条常是文库预览）');
    assert.equal(searchOpts.maxTries, 12);
    assert.ok(searchOpts.requireMatch instanceof RegExp, '应传主题门槛 requireMatch');
  });

  /* ================= 九、afterImport 批量编排 ================= */



  await check('A1. afterImport：过滤无需补全篇目、按顺序串行、汇总字段与回调齐全', async function () {
    const afterImport = fn('afterImport');
    const donor = makePaper({ id: 'imp-donor', setNo: 2, stems: REAL_STEMS });
    const t1 = makePaper({ id: 'imp-ai-1', setNo: 1 });
    const t2 = makePaper({ id: 'imp-ai-2', setNo: 1 });
    const reading = makePaper({ id: 'imp-ai-reading', type: 'reading' });
    const complete = makePaper({ id: 'imp-ai-complete', stems: REAL_STEMS, script: [{ s: 0, en: 'W: done.' }] });
    const store = makeStore();
    const ws = makeWebSearch({});
    const events = [];
    const summary = await afterImport([reading, complete, t1, t2], {
      pool: [donor, t1, t2], ai: { ready: false }, webSearch: ws, store: store,
      onProgress: function (msg, paper) { events.push({ type: 'progress', id: paper && paper.id, msg: msg }); },
      onResult: function (report, paper) { events.push({ type: 'result', id: paper && paper.id, report: report }); },
    });
    assert.equal(summary.busy, false);
    assert.equal(summary.papers, 2, '只处理 2 篇需要补全的听力：' + JSON.stringify(summary));
    assert.equal(summary.reports.length, 2);
    assert.equal(summary.stemsFilled, 8, '两篇各补 4 题：' + summary.stemsFilled);
    assert.equal(summary.scriptAdded, 0);
    assert.equal(summary.failed, 0);
    const resultIds = events.filter(function (e) { return e.type === 'result'; }).map(function (e) { return e.id; });
    assert.deepEqual(resultIds, ['imp-ai-1', 'imp-ai-2'], '必须按传入顺序串行回调');
    assert.ok(events.filter(function (e) { return e.type === 'progress'; }).length >= 2, '每篇应有进度回调');
    ['paperId', 'stemsFilled', 'stemsFrom', 'donorSetNo', 'scriptAdded', 'scriptUrl', 'scriptVerdict', 'status', 'errors']
      .forEach(function (k) {
        summary.reports.forEach(function (r) { assert.ok(Object.prototype.hasOwnProperty.call(r, k), 'report 缺字段 ' + k); });
      });
    assert.equal(store.d.lsnPatch['imp-ai-1'].stems['0'], REAL_STEMS[0]);
    assert.equal(store.d.lsnPatch['imp-ai-2'].stems['0'], REAL_STEMS[0]);
    assert.equal(ws.collectCalls.length, 0, 'AI 未配置时不应联网');
  });

  await check('A2. afterImport：模块级互斥（跑着时 busy:true），结束后可再次执行', async function () {
    const afterImport = fn('afterImport');
    const donor = makePaper({ id: 'imp-donor-b', setNo: 2, stems: REAL_STEMS });
    const t1 = makePaper({ id: 'imp-busy-1', setNo: 1 });
    const t2 = makePaper({ id: 'imp-busy-2', setNo: 1 });
    const opts = { pool: [donor, t1, t2], ai: { ready: false }, webSearch: makeWebSearch({}), store: makeStore() };
    const first = afterImport([t1, t2], opts);
    const second = await afterImport([t1], opts);
    assert.equal(second.busy, true, '已有任务时应直接返回 busy');
    assert.equal(second.papers, 0);
    const summary = await first;
    assert.equal(summary.busy, false);
    assert.equal(summary.papers, 2);
    const third = await afterImport([makePaper({ id: 'imp-busy-3', setNo: 1 })], opts);
    assert.equal(third.busy, false, '任务结束后应可再次执行');
  });

  await check('A3. afterImport：没有需要补全的篇目时立即返回空汇总，不占互斥', async function () {
    const afterImport = fn('afterImport');
    const summary = await afterImport([makePaper({ id: 'imp-none', stems: REAL_STEMS, script: [{ s: 0, en: 'W: ok.' }] })], {});
    assert.equal(summary.busy, false);
    assert.equal(summary.papers, 0);
    assert.deepEqual(summary.reports, []);
  });

  /* ================= 十、源码接线（阶段二：listening.js / importer.js / index.html） ================= */

  await check('W1. listening.js：_shell 先叠加补丁再生效筛选/渲染（applyPatches + readPatches(Store)）', function () {
    assert.ok(/\.applyPatches\(/.test(LISTENING_SRC), 'listening.js 必须调用模块 applyPatches');
    assert.ok(/\.readPatches\(/.test(LISTENING_SRC), 'listening.js 必须用模块 readPatches 读 Store 补丁');
    assert.ok(/readPatches\([^)]*Store/.test(LISTENING_SRC), 'readPatches 应传入 Store');
    const applyAt = LISTENING_SRC.indexOf('this._applyPatches(pool)');
    const filterAt = LISTENING_SRC.indexOf('Picker.filter(pool');
    assert.ok(applyAt >= 0, '_shell 里应对 pool 调 _applyPatches');
    assert.ok(filterAt > applyAt, '补丁必须在 Picker.filter（筛选/渲染）之前叠加');
  });

  await check('W2. listening.js：进入篇目后异步 run（_autoTried 防重复、onProgress/onPatch 状态）', function () {
    assert.ok(/(?:AF|ListeningAutoFill)\.run\(/.test(LISTENING_SRC), '必须在篇目里调用模块 run');
    assert.ok(/_autoTried/.test(LISTENING_SRC), '应有 _autoTried 防止每次重渲染都重跑');
    const runAt = Math.max(LISTENING_SRC.indexOf('AF.run('), LISTENING_SRC.indexOf('ListeningAutoFill.run('));
    const seg = LISTENING_SRC.slice(runAt, runAt + 900);
    assert.ok(/onProgress\s*[:=]/.test(seg), 'run 必须接 onProgress 更新状态行');
    assert.ok(/onPatch\s*[:=]/.test(seg), 'run 必须接 onPatch 落盘/重渲染');
  });

  await check('W3. listening.js：onPatch 里 Store.flush + contentBackup 同步 + 局部重渲染', function () {
    const patchAt = LISTENING_SRC.indexOf('_onAutoPatch(p, patch) {');
    assert.ok(patchAt >= 0, '应有 onPatch 处理函数 _onAutoPatch');
    const seg = LISTENING_SRC.slice(patchAt, patchAt + 2200);
    assert.ok(/Store\.flush\(\)/.test(seg), 'onPatch 应 Store.flush() 持久化');
    assert.ok(/contentBackup/.test(seg), 'onPatch 应同步 Store.d.contentBackup.listening');
    assert.ok(/_refreshPassage\(\)/.test(seg) || /_applyPatches\(\[p\]\)/.test(seg), 'onPatch 后应局部重渲染');
  });

  await check('W4. listening.js：缺题干提示条/无原文卡片能显示自动补全状态与来源，不再只报缺失', function () {
    assert.ok(/没有听力原文/.test(LISTENING_SRC), '原「没有听力原文」卡片应保留');
    assert.ok(/正在检查同套听力|正在[^。；\n]{0,16}(?:检索|补全)/.test(LISTENING_SRC), '缺少 running 状态文案');
    assert.ok(/已补全/.test(LISTENING_SRC), '补全完成后应显示「已补全 N 题」');
    assert.ok(/同套/.test(LISTENING_SRC), '补全来源应能显示「同套第 X 套」');
    assert.ok(/原文口播/.test(LISTENING_SRC), '补全来源应能显示「原文口播」');
    assert.ok(/联网核验/.test(LISTENING_SRC), '补全来源应能显示「联网核验」');
    assert.ok(/重试/.test(LISTENING_SRC), '失败后应有重试按钮');
    assert.ok(/自动联网补全原文/.test(LISTENING_SRC), '无原文卡片应能自动联网补全原文');
    assert.ok(/联网补全题干/.test(LISTENING_SRC), '仍缺题干时应能联网补全题干');
  });

  await check('W5. listening.js：写模式模糊题干规则没被改坏（题号清晰/题干 .q-stem）', function () {
    assert.ok(/class="qt-no"/.test(LISTENING_SRC), '题号 .qt-no 必须保留');
    assert.ok(/class="q-stem"/.test(LISTENING_SRC), '题干 .q-stem 必须保留');
    assert.ok(/listen-quiz-question-hidden/.test(LISTENING_SRC));
  });

  await check('W6. index.html：web-search.js → listening-autofill.js → views/listening.js 顺序', function () {
    const wsAt = INDEX_HTML.indexOf('<script src="js/web-search.js">');
    const autoAt = INDEX_HTML.indexOf('<script src="js/listening-autofill.js">');
    const listenAt = INDEX_HTML.indexOf('<script src="js/views/listening.js">');
    assert.ok(wsAt >= 0, 'index.html 缺少 web-search.js');
    assert.ok(autoAt >= 0, 'index.html 缺少 listening-autofill.js');
    assert.ok(listenAt >= 0, 'index.html 缺少 views/listening.js');
    assert.ok(wsAt < autoAt, 'listening-autofill.js 必须在 web-search.js 之后');
    assert.ok(autoAt < listenAt, 'listening-autofill.js 必须在 views/listening.js 之前');
  });

  await check('W7. sw.js：预缓存 js/listening-autofill.js（且在 views/listening.js 之前），cache 版本 >= v19', function () {
    assert.ok(SW_SRC.indexOf("'js/listening-autofill.js'") >= 0 || /js\/listening-autofill\.js/.test(SW_SRC),
      'sw.js 的 APP_SHELL 缺少 js/listening-autofill.js（离线时模块拿不到）');
    const wsAt = SW_SRC.indexOf('js/web-search.js');
    const autoAt = SW_SRC.indexOf('js/listening-autofill.js');
    const listenAt = SW_SRC.indexOf('js/views/listening.js');
    assert.ok(wsAt >= 0 && autoAt > wsAt, 'web-search.js 应先于 listening-autofill.js 预缓存');
    assert.ok(listenAt > autoAt, 'listening-autofill.js 应先于 views/listening.js 预缓存');
    const m = /const CACHE = 'keeplrn-v(\d+)'/.exec(SW_SRC);
    assert.ok(m, 'sw.js 缺少 CACHE 版本号');
    assert.ok(Number(m[1]) >= 19, '新增脚本后 cache 版本应 >= v19，实际 v' + m[1]);
  });

  await check('I1. importer.js：_persist 之后异步调 afterImport（不 await 阻塞导入弹窗）', function () {
    assert.ok(/\.afterImport\(/.test(IMPORTER_SRC), 'importer.js 必须在入库后调模块 afterImport');
    assert.ok(!/await[^;\n]{0,160}\.afterImport\(/.test(IMPORTER_SRC), '不能 await afterImport 阻塞导入');
    const persistAt = IMPORTER_SRC.indexOf('this._persist(');
    const autoAt = IMPORTER_SRC.indexOf('.afterImport(');
    assert.ok(persistAt >= 0 && autoAt > persistAt, 'afterImport 应在 _persist 之后调用');
  });

  await check('I2. importer.js：onResult 里 Store.flush + 听力页重渲染；队列来自本次新增篇目', function () {
    assert.ok(/_queueListeningAutoFill\(needs/.test(IMPORTER_SRC), '应把本次新增中需补全的篇目排队');
    assert.ok(/added\.filter\([^)]*_listeningNeedsAutoFill/.test(IMPORTER_SRC), '队列应来自本次新增 added');
    assert.ok(/onResult\s*\(report, paper\)/.test(IMPORTER_SRC) || /onResult\s*:/.test(IMPORTER_SRC), '应提供 onResult 回调');
    const resAt = IMPORTER_SRC.indexOf('_onAutoFillResult(report, paper) {');
    assert.ok(resAt >= 0, '应有 onResult 处理函数 _onAutoFillResult');
    const seg = IMPORTER_SRC.slice(resAt, resAt + 1400);
    assert.ok(/Store\.flush\(\)/.test(seg), 'onResult 时应 Store.flush()');
    assert.ok(/_refreshListeningViewIfActive/.test(IMPORTER_SRC), '结束后应在听力页触发重渲染');
  });

  await check('I3. importer.js：用 paperAudioKey + donor 复用同套题干（不联网）', function () {
    assert.ok(/paperAudioKey/.test(IMPORTER_SRC), 'importer.js 必须用 paperAudioKey 识别同套听力');
    assert.ok(/findStemDonors|copyStemsFromDonor/.test(IMPORTER_SRC), 'importer.js 应用 donor 复用题干');
  });

  await check('I4. importer.js：同月不同套同听力标 sharedListening/sharedFromSet/sameListeningAs', function () {
    assert.ok(/sharedListening/.test(IMPORTER_SRC), '缺少 sharedListening 标记');
    assert.ok(/sharedFromSet/.test(IMPORTER_SRC), '缺少 sharedFromSet 标记');
    assert.ok(/sameListeningAs/.test(IMPORTER_SRC), '缺少 sameListeningAs 记录');
  });

  await check('I5. importer.js：从正文证据自动识别套别（识别不到不猜）', function () {
    assert.ok(/setNo/.test(IMPORTER_SRC), 'importer.js 应处理 setNo');
    assert.ok(/(?:第\s*[^;\n]{0,12}套|本套试卷|Set\s*[0-9X])/i.test(IMPORTER_SRC), '缺少「第X套/本套试卷/Set X」证据识别');
  });

  await check('I6. importer.js：noScript toast 改为说明“已在后台自动联网检索/核验”', function () {
    const noScriptAt = IMPORTER_SRC.indexOf("if (targetOverride === 'listening' && noScript");
    assert.ok(noScriptAt >= 0, '缺少 noScript toast');
    const seg = IMPORTER_SRC.slice(noScriptAt, noScriptAt + 700);
    assert.ok(/自动[^。]{0,30}(?:联网|检索)/.test(seg), 'toast 应说明会/已在后台自动联网检索，而不是只报缺失：' + seg.slice(0, 240));
    assert.ok(/失败[^。]{0,20}原因|给出原因/.test(seg), '失败时应说明会给出原因');
  });

  /* ---------------- 汇总 ---------------- */

  const total = passed + failed;
  if (failed) {
    console.error('\n' + failed + ' 项失败 / ' + total + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n全部 ' + passed + ' 项听力自动补全检查通过');
  }
})().catch(function (error) {
  console.error('FAIL (uncaught): ' + ((error && error.stack) || error));
  process.exitCode = 1;
});

