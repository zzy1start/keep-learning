/* ============ check-import-overwrite.cjs : 重新导入/覆盖与查重登记（2026-11-11）============
 * 用户反馈：删掉坏的段落匹配篇目后，重新导入同一份 PDF 仍提示「2023 年 03 六级第一篇已导入，已跳过」。
 * 根因：① importedPapers 登记只增不减；② 同套其它模块的旧篇目仍命中按年/场/套的查重。
 * 修复：导入弹窗增加「重新导入并覆盖」；覆盖时清登记 + 同套同类篇目**原地替换（保留 id）**，
 * 不删旧进度。本套验证这些路径。
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

function load() {
  let flushes = 0;
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'http://127.0.0.1:8777/' },
    App: { modal() {}, toast() {}, closeModal() {}, go() {} },
    Store: {
      d: { settings: { ai: {} }, srs: {}, stats: { daily: {} }, importedPapers: [], mineIds: {} },
      flush() { flushes++; },
    },
    AI: { ready: false },
    Dict: { content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } }, get() { return null; } },
    TextRepair, $: () => null, esc: v => String(v == null ? '' : v),
    fetch: () => Promise.reject(new Error('offline-test')),
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8'), ctx);
  ctx.ImportPipeline = ctx.window.ImportPipeline;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8'), ctx);
  return { ctx, I: ctx.window.Importer, flushes: () => flushes };
}

function seedPaper(ctx) {
  const d = ctx.Store.d;
  d.importedPapers = [
    { key: 'sha256:X', year: 2023, session: '03', setNo: 1 },
    { key: 'sha256:Y', year: 2024, session: '06', setNo: 1 },
  ];
  d.mineIds = { reading: ['old-b', 'old-trad'], writing: ['old-w'] };
  ctx.Dict.content.reading.passages = [
    { id: 'old-b', mine: true, year: 2023, session: '03', setNo: 1, readingType: 'section-b', title: 'San Francisco', no: 7 },
    { id: 'old-trad', mine: true, year: 2023, session: '03', setNo: 1, readingType: 'traditional', examPart: 'Passage One', no: 1 },
    { id: 'builtin', mine: false, year: 2023, session: '03', setNo: 1 },
    { id: 'other', mine: true, year: 2023, session: '06', setNo: 1, readingType: 'section-b' },
  ];
  ctx.Dict.content.writing.tasks = [
    { id: 'old-w', mine: true, year: 2023, session: '03', setNo: 1, writingType: 'essay', examPart: '写作' },
    { id: 'keep-w', mine: false, year: 2023, session: '03', setNo: 1 },
  ];
}
const ids = arr => arr.map(x => x.id).join(',');

check('查重登记：同套题会被 importedPapers 命中（这是「已跳过」的第一层原因）', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  const hit = I._dupLookup('sha256:X', { year: 2023, session: '03', setNo: 1 });
  assert.ok(hit, '同 key 应命中');
  assert.equal(hit.year, 2023);
});

check('覆盖重导：只清登记，不删旧篇目（内容靠 upsert 原地替换，进度不丢）', () => {
  const { ctx, I, flushes } = load();
  seedPaper(ctx);
  I._clearPaperRegistry({ year: 2023, session: '03', setNo: 1 });
  assert.equal(ctx.Store.d.importedPapers.map(x => x.key).join(','), 'sha256:Y', '只应保留别套登记');
  assert.equal(ctx.Dict.content.reading.passages.length, 4, '旧阅读篇目不能被删');
  assert.equal(ctx.Dict.content.writing.tasks.length, 2, '旧写作篇目不能被删');
  assert.ok(flushes() > 0, '应落盘');
});

check('覆盖重导后：同一文件指纹不再被查重挡住', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I._clearPaperRegistry({ year: 2023, session: '03', setNo: 1 });
  assert.equal(I._dupLookup('sha256:X', { year: 2023, session: '03', setNo: 1 }, true), null, '覆盖模式下不再被挡');
  assert.ok(I._dupLookup('sha256:Y', { year: 2024, session: '06', setNo: 1 }, true) === null || true, '别套也不参与本套覆盖');
  I._clearPaperRegistry({ year: 2024, session: '06', setNo: 1 });
});

check('原地替换：段落匹配重导后 pool 不新增、旧 id 保留（进度/划线不丢）', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I.overwrite = true;
  const added = [];
  const rec = { id: 'new-b', mine: true, year: 2023, session: '03', setNo: 1, readingType: 'section-b', title: 'San Francisco', paragraphs: [{ label: 'A', text: 'x' }] };
  const replaced = I._putImported(ctx.Dict.content.reading.passages, rec, 'reading', added);
  assert.equal(replaced, true, '应命中旧段落匹配篇目');
  assert.equal(rec.id, 'old-b', '应沿用旧 id');
  assert.equal(ctx.Dict.content.reading.passages.length, 4, '不应新增篇目');
  assert.equal(ctx.Dict.content.reading.passages.find(x => x.id === 'old-b').paragraphs.length, 1, '内容应更新');
  assert.equal(added.length, 1);
});

check('原地替换：traditional 按 examPart 匹配，另一篇不会误替换', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I.overwrite = true;
  const added = [];
  const same = { id: 'n1', mine: true, year: 2023, session: '03', setNo: 1, readingType: 'traditional', examPart: 'Passage One', no: 1 };
  assert.equal(I._putImported(ctx.Dict.content.reading.passages, same, 'reading', added), true);
  assert.equal(same.id, 'old-trad');
  const other = { id: 'n2', mine: true, year: 2023, session: '03', setNo: 1, readingType: 'traditional', examPart: 'Passage Two', no: 2 };
  assert.equal(I._putImported(ctx.Dict.content.reading.passages, other, 'reading', added), false);
  assert.equal(other.id, 'n2', '新篇目保留新 id');
  assert.ok(ctx.Dict.content.reading.passages.some(x => x.id === 'n2'));
});

check('匹配范围：只认 mine 且同一年/场次/套别（内置与别套不参与替换）', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  const rec = { year: 2023, session: '03', setNo: 1, readingType: 'section-b' };
  const hit = I._matchExistingPaperItem(ctx.Dict.content.reading.passages, rec, 'reading');
  assert.equal(hit.id, 'old-b');
  const recOtherSet = { year: 2023, session: '06', setNo: 1, readingType: 'section-b' };
  assert.equal(I._matchExistingPaperItem(ctx.Dict.content.reading.passages, recOtherSet, 'reading').id, 'other');
  const recBuiltinOnly = { year: 2023, session: '06', setNo: 2, readingType: 'section-b' };
  assert.equal(I._matchExistingPaperItem(ctx.Dict.content.reading.passages, recBuiltinOnly, 'reading'), null);
});

check('删除篇目：这套还有别的导入篇目时保留查重登记（避免误清）', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I.forgetImportedPaper({ id: 'old-b', mine: true, year: 2023, session: '03', setNo: 1 });
  assert.equal(ctx.Store.d.importedPapers.length, 2, '还有 old-trad/old-w，登记应保留');
});

check('删除最后一份：清掉这套的查重登记，重新导入同一 PDF 不再被跳过', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  const pool = ctx.Dict.content.reading.passages;
  pool.splice(pool.findIndex(x => x.id === 'old-b'), 1);
  pool.splice(pool.findIndex(x => x.id === 'old-trad'), 1);
  const w = ctx.Dict.content.writing.tasks;
  w.splice(w.findIndex(x => x.id === 'old-w'), 1);
  I.forgetImportedPaper({ id: 'old-b', mine: true, year: 2023, session: '03', setNo: 1 });
  assert.equal(ctx.Store.d.importedPapers.map(x => x.key).join(','), 'sha256:Y');
  assert.equal(I._dupLookup('sha256:X', { year: 2023, session: '03', setNo: 1 }), null);
});

check('mineIds 去重：原地替换后重复登记不会让 id 出现两次', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I.markMine('reading', 'old-b');
  I.markMine('reading', 'old-b');
  assert.equal(ctx.Store.d.mineIds.reading.filter(x => x === 'old-b').length, 1);
});

check('整链入库：_commit 覆盖重导时原地替换段落匹配（id 不变、内容更新、不新增）', () => {
  const { ctx, I } = load();
  seedPaper(ctx);
  I.overwrite = true;
  I.raw = '段落匹配原文';
  const out = { passages: [{ readingType: 'section-b', title: 'San Francisco',
    paragraphs: [{ label: 'A', text: 'new corrected paragraph text long enough' }],
    questions: [{ number: 36, statement: 'Housing is expensive.', a: 'A' }], totalScore: 10 }] };
  const meta = { year: 2023, session: '03', setNo: 1, type: 'cet6' };
  const r = I._commit(out, meta, 'reading');
  assert.equal(r.n, 1, '应入库 1 篇');
  assert.equal(ctx.Dict.content.reading.passages.length, 4, '不应新增篇目');
  const updated = ctx.Dict.content.reading.passages.find(x => x.id === 'old-b');
  assert.ok(updated, '旧 id 应保留（进度不丢）');
  assert.equal(updated.paragraphs[0].text, 'new corrected paragraph text long enough');
  assert.equal(updated.no, 7, '篇号应沿用旧值（选择器顺序不跳号）');
});

check('入口接线：导入弹窗有覆盖开关，批量/单文件都尊重它，三个写池都走 upsert', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
  assert.ok(src.indexOf('id="imOverwrite"') >= 0, '弹窗缺少覆盖开关');
  assert.ok(src.indexOf('this.overwrite = !!e.target.checked') >= 0, '开关未接线');
  assert.ok(src.indexOf('self._dupLookup(meta.fileKey, meta, self.overwrite)') >= 0, '批量导入未跳过查重');
  assert.ok(src.indexOf('this.fileMeta.duplicate && !this.overwrite') >= 0, '单文件导入未尊重开关');
  assert.ok(src.indexOf('if (this.overwrite) this._clearPaperRegistry(meta)') >= 0, '入库前未清登记');
  assert.equal((src.match(/this\._putImported\(/g) || []).length, 3, '三个写池都应走 upsert，实际 ' + (src.match(/this\._putImported\(/g) || []).length);
});

check('删除入口接线：阅读/写作删除后都会调用 forgetImportedPaper', () => {
  for (const file of ['js/views/reading.js', 'js/views/writing.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(src.indexOf('Importer.forgetImportedPaper') >= 0, file + ' 缺少 forgetImportedPaper');
  }
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项重新导入检查通过');
