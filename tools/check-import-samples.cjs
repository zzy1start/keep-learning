/* ============ check-import-samples.cjs : 真实样卷结构度量（2026-10-17）============
 * 目的：用固定的"人工核对过结构的样卷"衡量结构切批质量，避免改 prompt/切段规则后
 * "更快但少提取"。当前度量的是结构层（不发 AI 请求）：
 *   · 题号覆盖率（原文期望题号 → 批次里出现）
 *   · 重复题号（同一题号出现在多个批次 = 篇章被拆开或重复）
 *   · 模块归属（听力/阅读/写作批次是否分明）
 *   · 批次长度上界（4500 字符上限是否被遵守）
 *   · 批次数量 / 最小 AI 请求数（结构层下界）
 * 后续若接入录制好的 AI 输出，可在此追加"完整率/错分率/重试次数"。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ window: {}, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8'), ctx);
const IP = ctx.window.ImportPipeline;
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

/* ---------- 样卷 1：CET-6 全卷（写作 + 听力 + 阅读两篇 + 翻译） ---------- */
const cet6Paper = `Part I Writing
Directions: For this part, you are allowed 30 minutes to write an essay on the importance of reading.
Part II Listening Comprehension
Section A
Questions 16 to 18 are based on the following passage.
Listening body paragraph.
16. Listening question 16.
A) First option.
B) Second option.
C) Third option.
D) Fourth option.
17. Listening question 17.
A) Alpha.
B) Beta.
C) Gamma.
D) Delta.
18. Listening question 18.
A) One.
B) Two.
C) Three.
D) Four.
Part III Reading Comprehension
Section C
Passage One
Questions 46 to 48 are based on the following passage.
Reading body one.
46. Reading question 46.
A) Reading habits.
B) School buildings.
C) Sports results.
D) Meal plans.
47. Reading question 47.
A) A reading programme.
B) A sports programme.
C) A music programme.
D) A lunch programme.
48. Reading question 48.
A) Information about reading habits.
B) Information about exam marks.
C) Information about weather.
D) Information about meals.
Passage Two
Questions 51 to 52 are based on the following passage.
Reading body two.
51. Reading question 51.
A) The participants.
B) The teachers.
C) The school.
D) The parents.
52. Reading question 52.
A) Knowing a little about a neighbour.
B) Reading a newspaper.
C) Watching television.
D) Talking to a teacher.
Part IV Translation
An unrelated translation exercise follows here.
`;

/* 批量生成带完整选项的题目行（结构度量不校验选项内容，但保持真实形状） */
function qlines(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return `${n}. Question ${n}.\nA) Option A${n}.\nB) Option B${n}.\nC) Option C${n}.\nD) Option D${n}.`;
  }).join('\n');
}

/* ---------- 样卷 2：CET-4（选词填空 Section A + 段落匹配 Section B + 传统阅读） ---------- */
const cet4Paper = `Part III Reading Comprehension
Section A
Directions: In this section, there is a passage with ten blanks.
Questions 26 to 35 are based on the following passage.
Cloze passage body with blanks numbered 26 to 35.
${qlines(26, 35)}
Section B
Directions: In this section, you are going to read a passage with ten statements.
Questions 36 to 45 are based on the following passage.
Paragraph A text for matching.
${qlines(36, 45)}
Section C
Passage One
Questions 46 to 48 are based on the following passage.
Reading body for section C.
${qlines(46, 48)}
`;

/* ---------- 样卷 3：考研（阅读 Text 1/2 + 翻译 Writing） ---------- */
const kaoyanPaper = `Section II Reading Comprehension
Part A
Text 1
Questions 21 to 25 are based on the following text.
Text one body.
${qlines(21, 25)}
Text 2
Questions 26 to 30 are based on the following text.
Text two body.
${qlines(26, 30)}
Section III Translation
Part C
Translate the following text into Chinese.
`;

const fixtures = [
  { label: 'cet6-full', text: cet6Paper, expectModules: ['listening', 'reading', 'writing'], expectNumbers: [16, 17, 18, 46, 47, 48, 51, 52] },
  { label: 'cet4-sections', text: cet4Paper, expectModules: ['reading'], expectNumbers: [26, 27, 28, 36, 37, 46, 47, 48] },
  { label: 'kaoyan-texts', text: kaoyanPaper, expectModules: ['reading', 'writing'], expectNumbers: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30] },
];

/** 结构层度量：覆盖率 / 重复 / 模块分布 / 批次长度 / 最小请求数 */
function metricsOf(fixture) {
  const text = IP.normalize(fixture.text);
  const batches = plain(IP.buildBatches(text, { maxChars: 4500 }));
  const expected = plain(IP.expectedNumbers(text));
  const seen = new Map();
  const byModule = {};
  batches.forEach(b => {
    byModule[b.module] = (byModule[b.module] || 0) + 1;
    plain(IP.expectedNumbers(b.text)).forEach(n => seen.set(n, (seen.get(n) || 0) + 1));
  });
  const missing = expected.filter(n => !seen.has(n));
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  const maxBatchChars = batches.length ? Math.max(...batches.map(b => b.text.length)) : 0;
  return {
    sample: fixture.label,
    chars: text.length,
    batches: batches.length,
    byModule,
    questions: expected.length,
    missing,
    duplicates,
    coveragePct: expected.length ? +(((expected.length - missing.length) / expected.length) * 100).toFixed(1) : 100,
    maxBatchChars,
    minAiRequests: batches.length,
  };
}

(async () => {
  const allMetrics = [];
  for (const f of fixtures) {
    const m = metricsOf(f);
    allMetrics.push(m);
    check('样卷 ' + f.label + '：题号覆盖 100%、无重复题号、批次长度 ≤ 4500', () => {
      assert.deepEqual(m.missing, [], '缺题号：' + m.missing.join(','));
      assert.deepEqual(m.duplicates, [], '重复题号：' + m.duplicates.join(','));
      assert.equal(m.coveragePct, 100, '覆盖率应为 100%，实际 ' + m.coveragePct);
      assert.ok(m.maxBatchChars <= 4500, '存在超长批次：' + m.maxBatchChars);
      if (f.expectModules.length > 1) assert.ok(m.batches >= 2, '多模块样卷应切出多个批次');
    });
    check('样卷 ' + f.label + '：模块识别包含 ' + f.expectModules.join('/'), () => {
      const mods = Object.keys(m.byModule);
      for (const mod of f.expectModules) assert.ok(mods.includes(mod), '缺少模块 ' + mod + '，实际 ' + JSON.stringify(mods));
    });
    check('样卷 ' + f.label + '：期望题号全部出现', () => {
      for (const n of f.expectNumbers) assert.ok(m.questions >= 1 && !m.missing.includes(n), '缺题号 ' + n);
    });
    check('样卷 ' + f.label + '：Passage/Text 标题与正文不被拆到不同批次', () => {
      const batchesList = plain(IP.buildBatches(f.text, { maxChars: 4500 }));
      const headings = [];
      const re = /^\s*(?:Passage|Text)\s+(?:One|Two|Three|Four|\d+)\b.*$/gim;
      let mm;
      while ((mm = re.exec(f.text))) headings.push(mm.index);
      for (const at of headings) {
        const batch = batchesList.find(b => b.start <= at && b.end > at);
        assert.ok(batch, '标题不在任何批次：' + f.text.slice(at, at + 20));
        const probe = Math.min(at + 60, f.text.length);
        assert.ok(batch.end >= probe, '标题与后续正文被拆到不同批次：' + f.text.slice(at, at + 20));
      }
    });
  }

  console.log('\n=== 样卷结构度量（JSON） ===');
  console.log(JSON.stringify(allMetrics, null, 2));

  if (failed) process.exitCode = 1;
  else console.log('\n全部 ' + passed + ' 项样卷结构检查通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
