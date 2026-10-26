/* ============ check-import-pipeline.cjs : AI 导入流水线（结构切批 + 位置/覆盖校验）============
 * 2026-10-17 起，importer 的 AI 切分改为「结构优先、长度兜底」：
 *   · 先按 Section/Passage/Questions N to M 等边界切结构块，块内保持原文完整；
 *   · 批次记录 [start,end) 字符区间与页码（PDF 页码不再丢）；
 *   · AI 结果由程序校验：题号完整性（对照原文的 Questions N to M/编号行）、选项数量、
 *     答案下标/词库/段落字母、题干与选项能否在批次原文中定位（覆盖率）；
 *   · 校验失败返回结构化 errors，供「只修复失败范围」使用。
 * 本套只测纯逻辑模块 js/import-pipeline.js，不发 AI 请求。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8');
const ctx = vm.createContext({ window: {}, console });
vm.runInContext(src, ctx);
const IP = ctx.window.ImportPipeline;
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

/* ---------- 真实源文本夹具：2024-06 六级第一/三套 PDF.js 抽取结果（与平板 App 抽取同一份） ---------- */
const REAL_SET1 = fs.readFileSync(path.join(ROOT, 'debug/text-set1.txt'), 'utf8');
const REAL_SET3SRC = fs.readFileSync(path.join(ROOT, 'debug/text-set3src.txt'), 'utf8');
/** 找 "53." 这类题号行在原文里的偏移（行首数字 + 分隔符，避免把 "53" 行内数字当题号） */
function questionLineOffset(text, n) {
  const num = String(n);
  let off = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith(num) && '.,、)）'.includes(t.charAt(num.length))) return off + line.indexOf(t);
    off += line.length + 1;
  }
  return -1;
}
function batchIndexAt(batches, offset) {
  return batches.findIndex(b => offset >= b.start && offset < b.end);
}


/* ---------- 样例试卷（含听力/阅读/写作三段结构，用于切批与校验） ---------- */
const listeningPassage = 'A research team studied how people form expectations about unfamiliar neighbours. They recorded the information available to each participant before conducting the study.';
const readingBody = 'A school introduced a reading programme for its students. Teachers collected information about reading habits and compared the results with those of another school.';
const readingBody2 = 'The researchers then followed the participants for several weeks. The results showed that knowing a little about a neighbour changed the decisions people made.';

const paper = `Part I Writing
Directions: For this part, you are allowed 30 minutes to write an essay on the importance of reading.
Part II Listening Comprehension
Section A
Questions 16 to 18 are based on the following passage.
${listeningPassage}
16. A listening question about the participants.
A) First option.
B) Second option.
C) Third option.
D) Fourth option.
17. Another listening question.
A) Alpha.
B) Beta.
C) Gamma.
D) Delta.
18. Third listening question.
A) One.
B) Two.
C) Three.
D) Four.
Part III Reading Comprehension
Section C
Passage One
Questions 46 to 48 are based on the following passage.
${readingBody}
46. What did the teachers compare in the reading programme?
A) Reading habits.
B) School buildings.
C) Sports results.
D) Meal plans.
47. What did the school introduce?
A) A reading programme.
B) A sports programme.
C) A music programme.
D) A lunch programme.
48. What did teachers collect?
A) Information about reading habits.
B) Information about exam marks.
C) Information about weather.
D) Information about meals.
Passage Two
Questions 51 to 52 are based on the following passage.
${readingBody2}
51. What did the researchers follow?
A) The participants.
B) The teachers.
C) The school.
D) The parents.
52. What changed the decisions people made?
A) Knowing a little about a neighbour.
B) Reading a newspaper.
C) Watching television.
D) Talking to a teacher.
Part IV Translation
An unrelated translation exercise follows here.
`;

/* 模拟「段落/页码」：把样例切成 3 页，给出字符区间 */
function makePages(text) {
  const cuts = [0, Math.floor(text.length / 3), Math.floor(text.length * 2 / 3), text.length];
  return [1, 2, 3].map(i => ({ no: i, start: cuts[i - 1], end: cuts[i] }));
}

(async () => {
  /* ---------- 1. 结构切批 ---------- */
  check('buildBatches：按 Section/Passage 结构切批，不把 Passage 标题、正文、题目拆开', () => {
    const batches = plain(IP.buildBatches(paper, { maxChars: 4500 }));
    assert.ok(batches.length >= 2, '至少应切出听力/阅读等批次，实际 ' + batches.length);
    const modules = new Set(batches.map(b => b.module));
    assert.ok(modules.has('listening'), '应识别出听力批次');
    assert.ok(modules.has('reading'), '应识别出阅读批次');
    /* 每个 Passage 的标题、正文、Questions 行、题目必须在同一批次里 */
    for (const [title, body] of [['Passage One', readingBody], ['Passage Two', readingBody2]]) {
      const batch = batches.find(b => b.text.includes(title) && b.text.includes(body));
      assert.ok(batch, title + ' 的标题/正文/题目被拆散了');
      assert.ok(/Questions\s+5?1?\d\s*to/.test(batch.text), title + ' 的 Questions 范围行应与正文同批');
    }
  });

  check('buildBatches：批次记录原文区间与页码，区间可回切原文', () => {
    const pages = makePages(paper);
    const batches = plain(IP.buildBatches(paper, { pages, maxChars: 4500 }));
    for (const b of batches) {
      assert.ok(b.start >= 0 && b.end <= paper.length && b.end > b.start, '区间非法：' + JSON.stringify([b.start, b.end]));
      assert.equal(paper.slice(b.start, b.end), b.text, 'start/end 回切原文应与批次文本一致');
      assert.ok(b.pageStart != null && b.pageEnd != null, '应带页码');
      assert.ok(b.pageStart <= b.pageEnd);
    }
  });

  check('buildBatches：超长结构块优先在段落边界拆，且不丢字符', () => {
    const paragraph = readingBody;
    const longBlock = `Passage One\nQuestions 61 to 65 are based on the following passage.\n` + Array.from({ length: 40 }, (_, i) => `${paragraph} Para ${i}.`).join('\n\n') + `\n61. Q1\nA) a\nB) b\nC) c\nD) d\n62. Q2\nA) a\nB) b\nC) c\nD) d\n63. Q3\nA) a\nB) b\nC) c\nD) d\n64. Q4\nA) a\nB) b\nC) c\nD) d\n65. Q5\nA) a\nB) b\nC) c\nD) d\n`;
    const batches = plain(IP.buildBatches(longBlock, { maxChars: 1200 }));
    assert.ok(batches.length > 1, '超长块应被拆成多批');
    assert.equal(batches.map(b => b.text).join(''), longBlock, '拆批不能丢字符');
    assert.ok(batches.slice(1).every(b => b.continuation), '后续批次应标记 continuation');
    assert.ok(batches.every(b => b.text.length <= 1200 + 200), '拆批后单批长度应在上限附近');
    assert.ok(batches.every(b => !/^[A-D]\)/.test(b.text.trim())), '不应从选项中间开始切批');
  });

  check('expectedNumbers：从 Questions N to M 与编号行推导期望题号（兼容 "5 1." OCR 拆分）', () => {
    const nums = plain(IP.expectedNumbers(paper));
    assert.deepEqual(nums, [16, 17, 18, 46, 47, 48, 51, 52]);
    assert.deepEqual(plain(IP.expectedNumbers('Questions 26 to 28 are based on the following passage.\n5 1. Question text\nA) x\n')), [26, 27, 28, 51]);
  });

  /* ---------- 2. 覆盖校验 ---------- */
  const readingBatch = plain(IP.buildBatches(paper, { maxChars: 4500 }))
    .find(b => b.text.includes('Passage One'));

  function goodReadingResult() {
    return {
      module: 'reading',
      complete: true,
      items: [{
        readingType: 'traditional', title: 'Passage One', genre: 'reading',
        paragraphs: [readingBody],
        questions: [
          { number: 46, q: 'What did the teachers compare in the reading programme?', opts: ['Reading habits.', 'School buildings.', 'Sports results.', 'Meal plans.'], a: 0 },
          { number: 47, q: 'What did the school introduce?', opts: ['A reading programme.', 'A sports programme.', 'A music programme.', 'A lunch programme.'], a: 0 },
          { number: 48, q: 'What did teachers collect?', opts: ['Information about reading habits.', 'Information about exam marks.', 'Information about weather.', 'Information about meals.'], a: 0 },
        ],
      }, {
        readingType: 'traditional', title: 'Passage Two', genre: 'reading',
        paragraphs: [readingBody2],
        questions: [
          { number: 51, q: 'What did the researchers follow?', opts: ['The participants.', 'The teachers.', 'The school.', 'The parents.'], a: 0 },
          { number: 52, q: 'What changed the decisions people made?', opts: ['Knowing a little about a neighbour.', 'Reading a newspaper.', 'Watching television.', 'Talking to a teacher.'], a: 0 },
        ],
      }],
    };
  }

  check('validateBatch：完整结果通过，题号/选项覆盖统计正确', () => {
    const r = plain(IP.validateBatch(goodReadingResult(), readingBatch));
    assert.equal(r.ok, true, '应通过：' + JSON.stringify(r.errors));
    assert.equal(r.errors.length, 0);
    assert.equal(r.stats.questions, 5);
    assert.equal(r.stats.expectedQuestions, 5);
    assert.equal(r.stats.uncoveredOptions, 0, '选项应都能在原文定位');
  });

  check('validateBatch：漏题/题号重复/选项不足/答案越界都会报错', () => {
    const bad = goodReadingResult();
    bad.items[0].questions.pop();                           // 漏 48
    bad.items[0].questions[1].number = 46;                  // 题号重复
    bad.items[0].questions[0].opts = ['A', 'B', 'C'];       // 选项只有 3 个
    bad.items[0].questions[0].a = 9;                        // 答案下标越界
    const r = plain(IP.validateBatch(bad, readingBatch));
    assert.equal(r.ok, false);
    const codes = r.errors.map(e => e.code);
    for (const code of ['MISSING_QUESTIONS', 'DUP_QUESTION_NUMBER', 'OPTIONS_NOT_4', 'ANSWER_INDEX_INVALID']) {
      assert.ok(codes.includes(code), '缺少错误码 ' + code + '，实际 ' + JSON.stringify(codes));
    }
  });

  check('validateBatch：AI 改写题干/选项时给出"未能定位"警告，而不是直接判错', () => {
    const result = goodReadingResult();
    result.items[0].questions[0].q = 'What did the teachers compare in the programme?';  // 改写
    const r = plain(IP.validateBatch(result, readingBatch));
    assert.equal(r.ok, true, '改写只警告不应判失败');
    assert.ok(r.warnings.some(w => w.code === 'STEM_NOT_IN_SOURCE'), '应提示题干未能在原文定位');
    assert.ok(r.stats.uncoveredStems >= 1);
  });

  check('validateBatch：Section A 的答案必须是词库字母，缺词库会报错', () => {
    const batch = { text: 'Section A\n26. Choose ___26___\nA) alpha\nB) beta\n' };
    const noBank = { module: 'reading', items: [{ readingType: 'section-a', title: '选词填空', clozeText: 'Choose ___26___', questions: [{ number: 26, a: 'A' }] }] };
    assert.ok(plain(IP.validateBatch(noBank, batch)).errors.some(e => e.code === 'NO_WORD_BANK'));
    const banked = { module: 'reading', items: [{ readingType: 'section-a', title: '选词填空', clozeText: 'Choose ___26___', wordBank: [{ letter: 'A', word: 'alpha' }], questions: [{ number: 26, a: 'A' }] }] };
    assert.ok(plain(IP.validateBatch(banked, batch)).ok, '有词库且答案合法应通过');
  });

  /* ---------- 3. 缓存 key ---------- */
  check('批次缓存 key：同原文同模块稳定，换原文/模块会变', () => {
    const k1 = IP.batchKey(readingBatch, { type: 'cet6' }, 'v2');
    const k2 = IP.batchKey({ ...readingBatch }, { type: 'cet6' }, 'v2');
    const k3 = IP.batchKey({ ...readingBatch, text: readingBatch.text + 'x' }, { type: 'cet6' }, 'v2');
    const k4 = IP.batchKey({ ...readingBatch, module: 'listening' }, { type: 'cet6' }, 'v2');
    assert.equal(k1, k2);
    assert.notEqual(k1, k3);
    assert.notEqual(k1, k4);
  });

  /* ---------- 4. importer 接线（静态检查，避免只写模块没接上） ---------- */
  check('importer 已接入结构切批：模块脚本先于 importer 加载、每批单模块、校验失败可回退', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const importer = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
    const iMod = html.indexOf('js/import-pipeline.js');
    const iImp = html.indexOf('js/importer.js');
    assert.ok(iMod > 0, 'index.html 未加载 import-pipeline.js');
    assert.ok(iMod < iImp, 'import-pipeline.js 必须在 importer.js 之前加载');
    assert.ok(/_aiSplitBatched/.test(importer), 'importer 未接入结构切批');
    assert.ok(/_aiSplitLegacy/.test(importer), 'importer 缺少旧整卷切分兜底');
    assert.ok(/只输出本批所属模块/.test(importer), '单批 prompt 未限制只输出本批模块');
    assert.ok(/_batchCacheSet/.test(importer) && /_batchCacheGet/.test(importer), '缺少批次缓存');
    assert.ok(/importBatchReport/.test(importer), '缺少批次校验报告');
    assert.ok(/pages: pageInfo/.test(importer), 'PDF 页码区间没有传给切批');
    assert.ok(/sourcePages/.test(importer), '缺少原文位置（页码）状态');
  });

  /* ---------- 5. importer 动态接线：用假 AI 跑通「切批 → 每批校验 → 合并 → 缓存/续跑」 ---------- */
  const importerSrc = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
  const meta = { type: 'cet6', year: 2024, session: '06', typeVerification: 'unverified' };
  function loadImporter(handler) {
    const calls = [];
    const mockAI = {
      ready: true,
      calls,
      async jsonRetry(messages) {
        calls.push(messages);
        return handler(messages, calls.length);
      },
    };
    /* 浏览器 localStorage 的最小 shim（批次缓存用） */
    const store = {};
    const localStorageShim = {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    };
    const ctx = vm.createContext({
      window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
      document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
      localStorage: localStorageShim, location: { href: 'http://127.0.0.1:8777/' },
      App: { modal() {}, toast() {}, closeModal() {}, go() {} },
      Store: { d: { settings: { ai: {} }, srs: {}, stats: { daily: {} } }, flush() {} },
      AI: mockAI,
      Dict: { content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } } },
      ImportPipeline: IP,
      $: () => null, esc: v => String(v == null ? '' : v),
    });
    vm.runInContext(importerSrc, ctx);
    return { Importer: ctx.window.Importer, calls };
  }
  const moduleOf = messages => {
    const m = String(messages[0].content).match(/模块 (listening|reading|writing)/);
    return m ? m[1] : '';
  };
  const userText = messages => String(messages[1].content);
  function normalResult(messages) {
    const mod = moduleOf(messages);
    if (mod === 'reading') {
      const nums = plain(IP.expectedNumbers(userText(messages)));
      return { module: 'reading', items: [{ readingType: 'traditional', title: 'Imported', paragraphs: ['x'], questions: nums.map(n => ({ number: n, q: 'Question ' + n, opts: ['A', 'B', 'C', 'D'], a: 0 })) }], complete: true };
    }
    if (mod === 'listening') {
      const nums = plain(IP.expectedNumbers(userText(messages)));
      return { module: 'listening', items: [{ title: 'Listening', words: [], script: [{ s: 0, en: 'script' }], qs: nums.map(n => ({ number: n, q: 'Q' + n, opts: ['A', 'B', 'C', 'D'], a: 0 })) }], complete: true };
    }
    return { module: 'writing', items: [{ writingType: 'essay', prompt: 'For this part, you are allowed 30 minutes to write an essay on reading.' }], complete: true };
  }

  async function checkAsync(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
  }

  await checkAsync('importer 动态：结构切批 → 每批单模块校验 → 合并入库，无失败批次', async () => {
    const { Importer } = loadImporter(messages => normalResult(messages));
    const out = await Importer._aiSplitBatched(paper, meta);
    const rep = out.importBatchReport;
    assert.ok(rep && rep.batches >= 4, '应至少 4 批（写作/听力/阅读/翻译），实际 ' + (rep && rep.batches));
    assert.equal(rep.failures.length, 0, '全部批次应通过校验：' + JSON.stringify(rep.failures));
    assert.ok(out.modules.listening.length >= 1, '应有听力材料');
    assert.ok(out.modules.reading.length >= 1, '应有阅读篇章');
    assert.ok(out.modules.writing.length >= 1, '应有写作题');
    assert.equal(rep.cacheHits, 0, '首次导入不应命中缓存');
  });

  await checkAsync('importer 动态：成功批次按原文哈希缓存，重跑同一份文件命中缓存、不再调用 AI', async () => {
    const { Importer, calls } = loadImporter(messages => normalResult(messages));
    await Importer._aiSplitBatched(paper, meta);
    const firstCalls = calls.length;
    const again = await Importer._aiSplitBatched(paper, meta);
    assert.equal(calls.length, firstCalls, '缓存命中后不应再发 AI 请求');
    assert.equal(again.importBatchReport.cacheHits, again.importBatchReport.batches, '应全部命中缓存');
  });

  await checkAsync('importer 动态：某批校验失败时只带错误清单重试该批，修好即通过', async () => {
    const readingCalls = { n: 0 };
    const { Importer } = loadImporter(messages => {
      if (moduleOf(messages) === 'reading') {
        readingCalls.n++;
        if (readingCalls.n === 1) {
          const nums = plain(IP.expectedNumbers(userText(messages)));
          return { module: 'reading', items: [{ readingType: 'traditional', title: 'Imported', paragraphs: ['x'], questions: nums.slice(0, 1).map(n => ({ number: n, q: 'Question ' + n, opts: ['A', 'B', 'C', 'D'], a: 0 })) }], complete: true };
        }
      }
      return normalResult(messages);
    });
    const out = await Importer._aiSplitBatched(paper, meta);
    assert.equal(out.importBatchReport.failures.length, 0, '重试后应通过：' + JSON.stringify(out.importBatchReport.failures));
    assert.ok(readingCalls.n >= 2, '阅读批应至少重试一次，实际 ' + readingCalls.n);
  });

  await checkAsync('importer 动态：本地也补不了的批次（听力无题）进入失败清单，不再整卷重解析', async () => {
    const { Importer } = loadImporter(messages => {
      if (moduleOf(messages) === 'listening') return { module: 'listening', items: [], complete: true };
      return normalResult(messages);
    });
    const out = await Importer._aiSplitBatched(paper, meta);
    const rep = out.importBatchReport;
    assert.equal(rep.failures.length, 1, '听力批应记为失败：' + JSON.stringify(rep.failures));
    assert.ok(rep.failures[0].errors.length > 0, '应带结构化错误');
    assert.ok(out.modules.reading.length >= 1 || out.modules.writing.length >= 1, '其它批次不受影响，仍应合并入库');
  });

  await checkAsync('考试类型核验：证据必须能在正文找到，编造的证据不通过', async () => {
    const text = paper + '\n2024年6月大学英语六级考试\n';
    const { Importer: good } = loadImporter(() => ({ examType: 'cet6', confidence: 0.95, evidence: ['大学英语六级考试'] }));
    const ok = await good._classifyExamType(text);
    assert.equal(ok.verified, true, '正文里有依据时应核验通过');
    assert.equal(ok.type, 'cet6');
    assert.equal(ok.evidenceVerified, true);

    const { Importer: fake } = loadImporter(() => ({ examType: 'cet6', confidence: 0.95, evidence: ['试卷正文明确写着六级'] }));
    const bad = await fake._classifyExamType(text);
    assert.equal(bad.verified, false, '证据在正文找不到时不能核验通过');
    assert.equal(bad.type, null, '不通过时 type 应为 null，交给人工确认');
    assert.equal(bad.suggestedType, 'cet6', '仍保留 AI 建议值供人工参考');
  });

  check('repairFromSource：缺选项按题号从原文回填，回填后校验通过', () => {
    const batch = plain(IP.buildBatches(paper, { maxChars: 4500 })).find(b => b.text.includes('Passage One'));
    const bad = goodReadingResult();
    bad.items[0].questions[0].opts = ['Reading habits.', 'School buildings.', undefined, ''];   // 缺 C/D
    const r = plain(IP.validateBatch(bad, batch));
    assert.equal(r.ok, false, '缺选项应先判失败');
    const fixed = plain(IP.repairFromSource(bad, batch, { module: 'reading' }));
    assert.ok(fixed.repairs.some(x => x.code === 'FILLED_OPTIONS'), '应报告回填选项：' + JSON.stringify(fixed.repairs));
    const again = plain(IP.validateBatch(fixed.result, batch, { module: 'reading' }));
    assert.equal(again.ok, true, '回填后应通过：' + JSON.stringify(again.errors));
  });

  check('repairFromSource：阅读漏题从原文题号行补题，Section A/B 不硬填', () => {
    const batch = plain(IP.buildBatches(paper, { maxChars: 4500 })).find(b => b.text.includes('Passage One'));
    const partial = { module: 'reading', items: [{ readingType: 'traditional', title: 'Passage One', paragraphs: ['x'], questions: [
      { number: 46, q: 'x', opts: ['A', 'B', 'C', 'D'], a: 0 },
    ] }] };
    const fixed = plain(IP.repairFromSource(partial, batch, { module: 'reading' }));
    assert.ok(fixed.repairs.some(x => x.code === 'LOCAL_BACKFILL'), '应报告回填漏题');
    const numbers = fixed.result.items.flatMap(it => (it.questions || []).map(q => q.number)).sort((a, b) => a - b);
    for (const n of [46, 47, 48, 51, 52]) assert.ok(numbers.includes(n), '缺少题号 ' + n);
    const sectionABatch = { text: 'Section A\n26. Choose ___26___\nA) alpha\nB) beta\nC) gamma\nD) delta\n', module: 'reading' };
    const noTouch = plain(IP.repairFromSource({ module: 'reading', items: [] }, sectionABatch, { module: 'reading' }));
    assert.equal(noTouch.repairs.length, 0, 'Section A 批次不应被硬填选项/题目');
  });

  /* ---------- 6. 真实源文本夹具回归（2024-06 六级第三套 / 第一套 PDF.js 抽取文本） ---------- */
  check('真实夹具 set3：Passage Two 的 Q51-Q55 同批，Q55 四选项可达并可回填', () => {
    const batches = plain(IP.buildBatches(REAL_SET3SRC, { maxChars: 4500 }));
    const batchOf = {};
    for (const n of [51, 52, 53, 54, 55]) {
      const off = questionLineOffset(REAL_SET3SRC, n);
      assert.ok(off >= 0, 'set3 原文找不到第 ' + n + ' 题题号行');
      batchOf[n] = batchIndexAt(batches, off);
      assert.ok(batchOf[n] >= 0, '第 ' + n + ' 题不在任何批次内');
    }
    assert.equal(new Set(Object.values(batchOf)).size, 1, 'Q51-Q55 被拆到不同批次：' + JSON.stringify(batchOf));
    const batch = batches[batchOf[51]];
    const parsed = IP.numberedQuestions(batch.text);
    for (const n of [51, 52, 53, 54, 55]) {
      const q = parsed.get(n);
      assert.ok(q, '批次原文里解析不到第 ' + n + ' 题');
      assert.equal(q.opts.filter(Boolean).length, 4, '第 ' + n + ' 题在批次原文里选项不足 4 个');
    }
    for (const opt of ['A)Highlight which aspects of a task', 'B)Use the principle of variability in teaching', 'C)Arouse people', 'D)Apply the principle of variability']) {
      assert.ok(batch.text.includes(opt), '批次原文缺少 Q55 选项：' + opt);
    }
    /* 回归平板数据里的 Q55 opts:[]：校验应报错，repairFromSource 按原文回填满 4 个选项 */
    const items = [{
      readingType: 'traditional', title: 'Passage Two', genre: '学习与认知',
      paragraphs: ['Variability is crucially important for learning new skills.'],
      questions: [51, 52, 53, 54, 55].map(n => ({
        number: n,
        q: parsed.get(n).stem,
        opts: n === 55 ? [] : parsed.get(n).opts.slice(0, 4),
        a: null,
      })),
    }];
    const bad = plain(IP.validateBatch({ module: 'reading', items }, batch, { module: 'reading' }));
    assert.ok(bad.errors.some(e => e.code === 'OPTIONS_NOT_4'), 'AI 给的 Q55 空选项应先判失败');
    const repaired = plain(IP.repairFromSource({ module: 'reading', items }, batch, { module: 'reading' }));
    const q55 = repaired.result.items[0].questions.filter(q => q.number === 55)[0];
    assert.ok(q55, '回填结果里应保留第 55 题');
    assert.equal(q55.opts.filter(Boolean).length, 4, 'repairFromSource 应回填 Q55 的四个选项');
    assert.ok(repaired.repairs.some(r => r.code === 'FILLED_OPTIONS' && r.question === 55), '应报告 Q55 选项回填：' + JSON.stringify(repaired.repairs));
    const again = plain(IP.validateBatch(repaired.result, batch, { module: 'reading' }));
    assert.equal(again.ok, true, '回填后应通过：' + JSON.stringify(again.errors));
  });

  check('回归加固 set1：批次切点不落在一道题的题干与选项之间（Q53 的 C/D 曾整段落到下一批）', () => {
    const batches = plain(IP.buildBatches(REAL_SET1, { maxChars: 4500 }));
    batches.forEach(b => {
      assert.ok(!/^[A-D]\s*[.)、）]/.test(b.text.trim()), '第 ' + b.index + ' 批从选项行中间开始：' + JSON.stringify(b.text.trim().slice(0, 30)));
    });
    const off = questionLineOffset(REAL_SET1, 53);
    assert.ok(off >= 0, 'set1 原文找不到第 53 题题号行');
    const batch = batches[batchIndexAt(batches, off)];
    const parsed = IP.numberedQuestions(batch.text).get(53);
    assert.ok(parsed, '第 53 题应能在所在批次里解析到');
    assert.equal(parsed.opts.filter(Boolean).length, 4, 'Q53 四个选项应与题干同批（被拆开时只能解析到 2 个）');
    assert.ok(batch.text.includes('C)It is arguable whether cities'), 'Q53 的 C 选项应与题干同批');
    assert.ok(batch.text.includes('D)It is debatable whether traditional fossil fuel'), 'Q53 的 D 选项应与题干同批');
  });

  check('切点保护：候选切点落在题干之后、选项之前（题干后空行/分页）时改选次优，题干与 A-D 不拆开', () => {
    const prose = Array.from({ length: 14 }, (_, i) => 'The study reports finding number ' + (i + 1) + ' about how people learn new skills in everyday settings.').join(' ');
    const text = 'Passage One\nQuestions 61 to 62 are based on the following passage.\n\n'
      + prose
      + '\n61. What is the main purpose of the passage?\n\nA) To describe a study.\nB) To compare two theories.\nC) To explain a method.\nD) To criticise a policy.\n'
      + '62. What does the author suggest?\nA) One.\nB) Two.\nC) Three.\nD) Four.\n';
    /* 题干后有一个空行（PDF 分页常见）：空行是段落边界 rank 3，优先级高于题号行，
     * 会先被选成切点，正好落在题干与 A-D 之间——修好前切出的下一批以 "A) ..." 开头。*/
    const maxChars = text.indexOf('\n\nA) To describe a study.') + 2;
    const batches = plain(IP.buildBatches(text, { maxChars }));
    assert.ok(batches.length >= 2, '测试文本应被切成多批，实际 ' + batches.length);
    assert.equal(batches.map(b => b.text).join(''), text, '改切后不能丢字符');
    for (const b of batches) assert.ok(!/^[A-D]\s*[.)、）]/.test(b.text.trim()), '第 ' + b.index + ' 批从选项行开始：' + JSON.stringify(b.text.trim().slice(0, 20)));
    const batch = batches.find(b => b.text.includes('61. What is the main purpose'));
    assert.ok(batch, '第 61 题应在某个批次里');
    const parsed = IP.numberedQuestions(batch.text).get(61);
    assert.ok(parsed, '第 61 题应能在所在批次里解析到');
    assert.equal(parsed.opts.filter(Boolean).length, 4, '题干与四个选项被拆到两批：' + JSON.stringify(batch.text.slice(-120)));
  });

  /* ---------- 7. 听力题干：占位校验 + 原文回填 ---------- */
  check('validateBatch：听力题干为空/占位只告警（STEM_MISSING/STEM_PLACEHOLDER），不判失败', () => {
    const batch = {
      module: 'listening',
      text: 'Part II Listening Comprehension\nSection A\nQuestions 1 to 2 are based on the conversation you have just heard.\n1.A) Alpha.\nB) Beta.\nC) Gamma.\nD) Delta.\n2.A) One.\nB) Two.\nC) Three.\nD) Four.\n',
    };
    const result = {
      module: 'listening',
      items: [{
        title: 'Conversation One', words: [], script: [],
        qs: [
          { number: 1, q: '', opts: ['Alpha.', 'Beta.', 'Gamma.', 'Delta.'], a: 0 },
          { number: 2, q: 'Questions 1 to 2 are based on the conversation you have just heard.', opts: ['One.', 'Two.', 'Three.', 'Four.'], a: 0 },
        ],
      }],
    };
    const r = plain(IP.validateBatch(result, batch, { module: 'listening' }));
    assert.equal(r.ok, true, '题干问题不应判错：' + JSON.stringify(r.errors));
    assert.ok(r.warnings.some(w => w.code === 'STEM_MISSING'), '应提示题干为空');
    assert.ok(r.warnings.some(w => w.code === 'STEM_PLACEHOLDER'), '应提示题干是占位文本');
    assert.equal(r.stats.missingStems, 1);
    assert.equal(r.stats.placeholderStems, 1);
    assert.equal(IP.isPlaceholderStem('Question 9'), true);
    assert.equal(IP.isPlaceholderStem('Questions 1 to 4 are based on the conversation you have just heard.'), true);
    assert.equal(IP.isPlaceholderStem('What did the man suggest?'), false);
  });

  check('repairFromSource：听力题干为空/占位时按原文题号回填，选项行不会被当成题干', () => {
    const batch = {
      module: 'listening',
      text: 'Part II Listening Comprehension\nSection A\nQuestions 1 to 2 are based on the conversation you have just heard.\n1. What did the man suggest to the woman?\nA) To book a room.\nB) To take a train.\nC) To call a friend.\nD) To wait outside.\n2. Why does the woman disagree with the man?\nA) The plan is too costly.\nB) The time is not suitable.\nC) The place is too far.\nD) The weather is bad.\n',
    };
    const result = {
      module: 'listening',
      items: [{
        title: 'Conversation One', words: [], script: [],
        qs: [
          { number: 1, q: 'Question 1', opts: ['To book a room.', 'To take a train.', 'To call a friend.', 'To wait outside.'], a: 0 },
          { number: 2, q: '', opts: ['The plan is too costly.', 'The time is not suitable.', 'The place is too far.', 'The weather is bad.'], a: 0 },
        ],
      }],
    };
    const fixed = plain(IP.repairFromSource(result, batch, { module: 'listening' }));
    const qs = fixed.result.items[0].qs;
    assert.equal(qs[0].q, 'What did the man suggest to the woman?', '占位题干应按原文回填');
    assert.equal(qs[1].q, 'Why does the woman disagree with the man?', '空题干应按原文回填');
    assert.equal(fixed.repairs.filter(r => r.code === 'FILLED_STEM').length, 2, '应报告两处题干回填：' + JSON.stringify(fixed.repairs));

    /* 真实 set1 听力原文只印选项：16.A)... 这种行不能被当成题干回填 */
    const realBatch = {
      module: 'listening',
      text: 'Part II Listening Comprehension\nSection A\nDirections: In this section,you will hear two long conversations.\n16.A)Because they are learned.  C)Because they have to be learned.\nB)Because they are useful.  D)Because they are required.\n',
    };
    const optOnly = {
      module: 'listening',
      items: [{
        title: 'Conversation One', words: [], script: [],
        qs: [{ number: 16, q: 'Question 16', opts: ['Because they are learned.', 'Because they are useful.', '', ''], a: 0 }],
      }],
    };
    const noFill = plain(IP.repairFromSource(optOnly, realBatch, { module: 'listening' }));
    assert.equal(noFill.repairs.filter(r => r.code === 'FILLED_STEM').length, 0, '不能把选项行当题干回填：' + JSON.stringify(noFill.repairs));
    assert.equal(noFill.result.items[0].qs[0].q, 'Question 16', '原文没有真实题干时应保留 AI 原值');

    /* 阅读分支不回填题干（本次只改听力） */
    const readBatch = { module: 'reading', text: 'Passage One\nQuestions 61 to 61 are based on the following passage.\n61. What is the main idea?\nA) a\nB) b\nC) c\nD) d\n' };
    const readResult = { module: 'reading', items: [{ readingType: 'traditional', title: 'Passage One', paragraphs: ['x'], questions: [{ number: 61, q: 'Question 61', opts: ['a', 'b', 'c', 'd'], a: 0 }] }] };
    const readFixed = plain(IP.repairFromSource(readResult, readBatch, { module: 'reading' }));
    assert.equal(readFixed.result.items[0].questions[0].q, 'Question 61', '阅读题干回填不在本次范围');
  });


  /* ---------- 7.5 模块归属：Unicode 罗马数字 Part Ⅲ / Section 继承 ---------- */
  check('buildBatches：Unicode 罗马数字 Part Ⅲ 能识别，阅读批次不会被错标成 listening（真实 set1 文本）', () => {
    const batches = plain(IP.buildBatches(REAL_SET1, { maxChars: 4500 }));
    for (const b of batches) {
      const head = b.text.trim();
      if (/^Section B\s*\n?Directions:\s*In this section,you are going to read a passage/i.test(head)) {
        assert.equal(b.module, 'reading', '阅读 Section B 被错标成 ' + b.module);
      }
      if (/^Passage Two\s*\n?Questions 51 to 55 are based on the following passage/i.test(head)) {
        assert.equal(b.module, 'reading', 'Passage Two 被错标成 ' + b.module);
      }
      if (/^Questions 16 to 18 are based on the recording/i.test(head)) {
        assert.equal(b.module, 'listening', '听力 Questions 16–18 被错标成 ' + b.module);
      }
    }
    const reading = batches.filter(b => b.module === 'reading').length;
    const listening = batches.filter(b => b.module === 'listening').length;
    assert.ok(reading >= 6, '阅读批次过少：' + reading);
    assert.ok(listening >= 2, '听力批次过少：' + listening);
    assert.ok(/Part\s+[\u2160-\u217f]\s+Reading/i.test(REAL_SET1), '真实文本应含 Unicode 罗马数字 Part Ⅲ，否则本用例失去意义');
  });

  await checkAsync('importer 动态：AI 两次都没修好时用原文规则回填，不整批作废', async () => {
    const { Importer } = loadImporter(messages => {
      const mod = moduleOf(messages);
      if (mod === 'reading') {
        const nums = plain(IP.expectedNumbers(userText(messages)));
        return { module: 'reading', items: [{ readingType: 'traditional', title: 'Imported', paragraphs: ['x'], questions: nums.map(n => ({ number: n, q: 'Question ' + n, opts: ['A', 'B'], a: 0 })) }], complete: true };
      }
      return normalResult(messages);
    });
    const out = await Importer._aiSplitBatched(paper, meta);
    const rep = out.importBatchReport;
    assert.equal(rep.failures.length, 0, '本地回填后不应再有失败批次：' + JSON.stringify(rep.failures));
    assert.ok((rep.repairs || 0) > 0, '应记录本地回填次数：' + JSON.stringify(rep));
  });

  check('splitBatch：长批在段落/题号/句子边界一分为二，字符区间仍精确且不丢内容', () => {
    const long = `Passage One\nQuestions 61 to 65 are based on the following passage.\n`
      + Array.from({ length: 30 }, (_, i) => readingBody + ' Para ' + i).join('\n\n')
      + '\n61. Q.\nA) a\nB) b\n';
    const batch = plain(IP.buildBatches(long, { maxChars: 100000 }))[0];
    assert.ok(batch.text.length > 900, '测试文本应超过二分下限');
    const halves = plain(IP.splitBatch(batch));
    assert.equal(halves.length, 2);
    assert.equal(halves[0].start, batch.start);
    assert.equal(halves[1].end, batch.end);
    assert.equal(halves[0].end, halves[1].start);
    assert.equal(halves[1].continuation, true);
    assert.equal((halves[0].text + halves[1].text).replace(/\s+/g, ''), batch.text.replace(/\s+/g, ''), '二分不能丢字符');
  });

  await checkAsync('importer 动态：整批两次失败 → 批内二分后合并通过，不再整批作废', async () => {
    const body = Array.from({ length: 20 }, (_, i) => readingBody + ' Paragraph ' + i).join('\n\n');
    const questions = Array.from({ length: 5 }, (_, i) => {
      const n = 61 + i;
      return `${n}. Question ${n}.\nA) A${n}.\nB) B${n}.`;   // 原文只有 A/B 两个选项 → 本地回填也补不满 4 个
    }).join('\n');
    const splitPaper = `Part I Writing\nDirections: Write an essay on reading.\nPart III Reading Comprehension\nSection C\nPassage One\nQuestions 61 to 65 are based on the following passage.\n${body}\n${questions}\n`;
    const { Importer } = loadImporter(messages => {
      const mod = moduleOf(messages);
      if (mod === 'writing') return normalResult(messages);
      const text = userText(messages);
      if (text.length > 2500) return { module: 'reading', items: [], complete: true };   // 整个长批失败
      const nums = [...IP.numberedQuestions(text).keys()].map(Number);
      return { module: 'reading', items: [{ readingType: 'traditional', title: 'Imported', paragraphs: ['x'], questions: nums.map(n => ({ number: n, q: 'Question ' + n, opts: ['A', 'B', 'C', 'D'], a: null })) }], complete: true };
    });
    const out = await Importer._aiSplitBatched(splitPaper, meta);
    const rep = out.importBatchReport;
    assert.equal(rep.failures.length, 0, '二分后应通过：' + JSON.stringify(rep.failures));
    assert.ok((rep.splitBatches || 0) >= 1, '应记录批内二分次数：' + JSON.stringify(rep));
    assert.ok(out.modules.reading.length >= 1, '阅读内容应合并入库');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项导入流水线检查通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
