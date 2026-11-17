/* ============ check-reading-sectionb-parse.cjs : 段落匹配按原卷字母重切（2026-11-11）============
 * 真实 bug：2023-03 六级第 1 套的 H 段跨页（第 4 页以 "...but" 结尾，第 5 页页脚之后
 * 才接 "also deprives..."）。PDF 按页用空行连接 → AI 把 H 拆成 H/I 两段 → 后面字母
 * 全部右移一位（界面里的 K 段其实是原卷 J 段），段落匹配答案全部错位。
 * 本套用真实 PDF 文本层夹具（tools/fixtures/cet6-2023-03-sectionb.txt）验证：
 *   1) parseParagraphMatchingSource 按 A)–M) 重切，H 恢复为一段；
 *   2) cleanImportedParagraphs 清掉页脚且不粘词；
 *   3) completeImportedReadingItem 用权威分段覆盖 AI 的错误分段，q.opts 跟着正确；
 *   4) 没有印字母的文本不猜测（返回 null，保留 AI 结果）。
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

const TextRepair = require(path.join(ROOT, 'js/text-repair.js'));
const FIXTURE = fs.readFileSync(path.join(ROOT, 'tools/fixtures/cet6-2023-03-sectionb.txt'), 'utf8');

function loadImporter() {
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'http://127.0.0.1:8777/' },
    App: { modal() {}, toast() {}, closeModal() {}, go() {} },
    Store: { d: { settings: { ai: {} }, srs: {}, stats: { daily: {} } }, flush() {} },
    AI: { ready: false },
    Dict: { content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } }, get() { return null; } },
    TextRepair, $: () => null, esc: v => String(v == null ? '' : v),
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8'), ctx);
  ctx.ImportPipeline = ctx.window.ImportPipeline;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8'), ctx);
  return ctx;
}

const ctx = loadImporter();
const PARSED = ctx.parseParagraphMatchingSource(FIXTURE);

check('真实 PDF 夹具：按原卷字母切出 13 段 A–M（不是 AI 的 14 段）', () => {
  assert.ok(Array.isArray(PARSED), '应解析出段落数组');
  assert.equal(PARSED.length, 13, '应 13 段（A–M），实际 ' + (PARSED && PARSED.length));
  assert.equal(PARSED.map(p => p.label).join(','), 'A,B,C,D,E,F,G,H,I,J,K,L,M');
});

check('跨页 H 段恢复为一段：包含 At the same time + also deprives，页脚仍在原文里', () => {
  const h = PARSED.find(p => p.label === 'H');
  assert.ok(h, '缺少 H 段');
  assert.ok(h.text.indexOf('At the same time') >= 0, 'H 段缺少 At the same time（被拆走）');
  assert.ok(h.text.indexOf('also deprives') >= 0, 'H 段缺少 also deprives（跨页后半句）');
  assert.ok(h.text.indexOf('2023 年 3 月') >= 0, '夹具应保留原始页脚，供清洗断言');
});

check('清洗后：页脚被删、but 与 also 不粘词', () => {
  const cleaned = ctx.cleanImportedParagraphs(PARSED, FIXTURE);
  const h = cleaned.find(p => p.label === 'H');
  assert.ok(h.text.indexOf('共 8 页') < 0, '页脚没清掉');
  assert.ok(h.text.indexOf('but also deprives') >= 0, '删除页脚后应保持 but also（不粘词）：' + h.text.slice(-80));
});

check('字母不再右移：K 段是原卷 K（Real estate alone），不是原卷 J（The housing crisis）', () => {
  const k = PARSED.find(p => p.label === 'K');
  const j = PARSED.find(p => p.label === 'J');
  assert.ok(k.text.indexOf('Real estate alone') === 0, 'K 段内容不对：' + k.text.slice(0, 40));
  assert.ok(j.text.indexOf('The housing crisis is caused') === 0, 'J 段内容不对：' + j.text.slice(0, 40));
});

check('入库补全：AI 的错误分段被权威分段覆盖，题目的段落选项 = A–M', () => {
  /* 模拟线上坏数据：AI 把 H 拆成 H + 假 I，后面字母右移（真实用户截图形态）*/
  const bad = [
    { label: 'A', text: 'A text' }, { label: 'B', text: 'B text' }, { label: 'C', text: 'C text' },
    { label: 'D', text: 'D text' }, { label: 'E', text: 'E text' }, { label: 'F', text: 'F text' },
    { label: 'G', text: 'G text' }, { label: 'H', text: 'H part one' }, { label: 'I', text: 'H part two' },
    { label: 'I', text: 'Real I' }, { label: 'J', text: 'Real J' }, { label: 'K', text: 'Real K' },
    { label: 'L', text: 'Real L' }, { label: 'M', text: 'Real M' },
  ];
  const item = {
    readingType: 'section-b', title: 'San Francisco', paragraphs: bad,
    questions: [
      { number: 36, statement: 'The higher rate of employment did not make it easier to buy a house.', a: 'E' },
      { number: 37, statement: 'One way is to simplify approval procedures.', a: 'K' },
    ],
    __sourceText: FIXTURE,
  };
  const fixed = ctx.completeImportedReadingItem(item);
  assert.equal(fixed.paragraphs.length, 13, 'AI 的 14 段应被覆盖成 13 段，实际 ' + fixed.paragraphs.length);
  assert.equal(fixed.paragraphs.map(p => p.label).join(','), 'A,B,C,D,E,F,G,H,I,J,K,L,M');
  assert.equal(fixed.questions[0].opts.join(','), 'A,B,C,D,E,F,G,H,I,J,K,L,M');
  assert.ok(fixed.questions[0].q.indexOf('higher rate of employment') >= 0, '题干应保留');
});

check('没有印段落字母的文本不猜：parse 返回 null，AI 分段保持原样', () => {
  assert.equal(ctx.parseParagraphMatchingSource('Just a plain passage.\n\nAnother paragraph.'), null);
  const aiParagraphs = [{ label: 'A', text: 'One' }, { label: 'B', text: 'Two' }];
  const item = { readingType: 'section-b', paragraphs: aiParagraphs, questions: [{ number: 1, statement: 'x', a: 'A' }], __sourceText: 'no letters here' };
  const fixed = ctx.completeImportedReadingItem(item);
  assert.equal(fixed.paragraphs.length, 2, '不应删除 AI 段落');
  assert.equal(fixed.paragraphs[0].label, 'A');
});

check('解析器不受更早的 A)–D) 选项块干扰（取连续字母最长的一组）', () => {
  const noisy = 'A) one\nB) two\nC) three\nD) four\n\n' + FIXTURE;
  const parsed = ctx.parseParagraphMatchingSource(noisy);
  assert.equal(parsed.length, 13, '应仍取 13 段的正文，实际 ' + (parsed && parsed.length));
  assert.equal(parsed[0].label, 'A');
});

check('PDF 页间拼接：跨页续句不再补空行（真实页 4/页 5 形态）', () => {
  const prev = 'H)  If  contributing  factors ... their  objective  standard  of  living.  At  the  same  time, ... but';
  const next = '2023  年  3  月英语六级真题第  1  套  第  5  页，共  8  页\nalso  deprives  them  of  their  dignity.\nI)  San  Francisco ...';
  assert.equal(ctx.pdfPageContinues(prev, next), true, '跨页续句应返回 true（页脚应被跳过）');
  assert.equal(ctx.pdfPageContinues('... objective standard of living.', next), false, '上一页已句末：不拼');
  assert.equal(ctx.pdfPageContinues(prev, 'I)  San  Francisco ...'), false, '下一页以段落字母开头：不拼');
  assert.equal(ctx.pdfPageContinues(prev, 'Questions 36 to 45 are based on ...'), false, '结构行：不拼');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项段落匹配分段检查通过');
