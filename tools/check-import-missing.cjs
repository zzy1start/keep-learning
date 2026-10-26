/* ============ check-import-missing.cjs : 导入缺失问题的离线验收 ============
 * 把本轮四个问题变成可重跑的程序断言。夹具全部是**本轮真实数据**：
 *   · debug/device-raw-items.json  平板 WebView 里当前真实入库的 mine 条目（修复前快照）
 *   · debug/text-set1.txt         2024-06 六级第 1 套 PDF.js 抽取原文
 *   · debug/text-set3src.txt      2024-06 六级第 3 套 PDF.js 抽取原文
 * 纯 Node，不发 AI 请求、不连平板/ADB。
 *
 * 断言分组：
 *   [批次]      buildBatches 不许把题干与它的 A–D 选项切成两批
 *               （set1 真实分页缺陷：Q53 的 C/D 选项被切到下一批；set3 要求 Q51–55 同批）
 *   [回填]      repairFromSource 能从批内原文补齐缺失选项（依赖 [批次] 先修好）
 *   [SectionA/B] completeImportedReadingItem：A 每题 q 非空 + opts 非空；B 每题 q 非空 + opts 为段落字母
 *   [补全-traditional] completeImportedReadingItem：set3 Q55 opts 补到 4 个；set1 Passage Two 缺的 Q54 补齐
 *   [听力]      completeImportedListeningItem：清掉 "Question N"/纯题号伪造题干；空题干标 stemMissing 可统计
 *   [听力警告]  validateBatch 对空/占位题干给 STEM_* warning（不是 error）
 *   [写作]      polishImportedEnglish：Directions:For / part,you / ofdigital 等补空格、拆粘连、结尾完整
 *   [写作-截断] device 写作 prompt 与源文同源未截断（源文结尾 at the beginning of your essay.）
 *
 * 用法：node tools/check-import-missing.cjs [--items=<device-raw-items.json 路径>]
 * 退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 夹具/模块加载失败。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const FIXTURE = {
  items: 'debug/device-raw-items.json',
  set1: 'debug/text-set1.txt',
  set3: 'debug/text-set3src.txt',
};
const CODE = {
  pipeline: 'js/import-pipeline.js',
  importer: 'js/importer.js',
  repair: 'js/text-repair.js',
};
const DICT_FILE = 'data/dictionary.min.json';
const WRITING_ESSAYS = ['imp-writing-1792500127930-0', 'imp-writing-1792500480844-0'];
const READING_A = ['imp-reading-1792500127790-0', 'imp-reading-1792500480676-0'];
const READING_B = ['imp-reading-1792500127790-1', 'imp-reading-1792500480676-1'];

const argv = process.argv.slice(2);
const itemsOverride = (argv.find(a => a.startsWith('--items=')) || '').slice('--items='.length);
const itemsPath = itemsOverride ? path.resolve(itemsOverride) : path.join(ROOT, FIXTURE.items);

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function readJson(p) { return JSON.parse(readText(p)); }
function sha1(text) { return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12); }
function plain(v) { return JSON.parse(JSON.stringify(v)); }
function loose(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, ''); }
function short(v, n = 80) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
function expect(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- 加载被测模块（与 tools/check-import-pipeline.cjs 相同的 vm 方式） ---------- */
let pipelineSrc, importerSrc, repairedSrc;
try {
  pipelineSrc = readText(path.join(ROOT, CODE.pipeline));
  importerSrc = readText(path.join(ROOT, CODE.importer));
  repairedSrc = readText(path.join(ROOT, CODE.repair));
} catch (e) {
  console.error('FATAL 读取源码失败：' + (e && e.message));
  process.exit(2);
}

/* 真实词典（data/dictionary.min.json）：写作拆 "ofdigital / thebeginning" 这类粘连词需要词表。
 * 注入到 importer 的 vm 上下文（Dict.get），修法若走词典就能离线验证。*/
let dictWords = null;
try {
  const dict = JSON.parse(readText(path.join(ROOT, DICT_FILE)));
  dictWords = new Set(Object.keys(dict));
  console.log('INFO 已加载真实词典 ' + DICT_FILE + '（' + dictWords.size + ' 词，供写作拆粘连词）');
} catch (e) {
  console.log('INFO 词典 ' + DICT_FILE + ' 不可用（写作拆粘连词会失败）：' + (e && e.message));
}

let TextRepair = null;
try {
  try { global.tokenizer = require(path.join(ROOT, 'vendor/sbd/dist/sbd.js')); } catch (e) { /* 断句器可选，polish 不依赖 */ }
  TextRepair = require(path.join(ROOT, CODE.repair));
} catch (e) {
  console.log('INFO js/text-repair.js 加载失败（写作断言会失败）：' + (e && e.message));
}

function loadPipeline() {
  const ctx = vm.createContext({ window: {}, console });
  vm.runInContext(pipelineSrc, ctx);
  const IP = ctx.window.ImportPipeline;
  if (!IP) throw new Error('js/import-pipeline.js 没有导出 window.ImportPipeline');
  return IP;
}

function loadImporter(IP) {
  const store = {};
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    location: { href: 'http://127.0.0.1:8777/' },
    App: { modal() {}, toast() {}, closeModal() {}, go() {} },
    Store: { d: { settings: { ai: {} }, srs: {}, stats: { daily: {} } }, flush() {} },
    AI: { ready: false },
    Dict: {
      content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } },
      get(word) {
        if (!dictWords) return null;
        const key = String(word == null ? '' : word).toLowerCase();
        return dictWords.has(key) ? [key] : null;
      },
    },
    TextRepair,
    $: () => null, esc: v => String(v == null ? '' : v),
  });
  vm.runInContext(pipelineSrc, ctx);
  ctx.ImportPipeline = ctx.window.ImportPipeline;
  vm.runInContext(importerSrc, ctx);
  return ctx;
}

let raw, set1, set3, IP, importer;
try {
  raw = readJson(itemsPath);
  set1 = readText(path.join(ROOT, FIXTURE.set1));
  set3 = readText(path.join(ROOT, FIXTURE.set3));
  IP = loadPipeline();
  importer = loadImporter(IP);
} catch (e) {
  console.error('FATAL 夹具/模块加载失败：' + (e && e.message));
  process.exit(2);
}

const allReading = [].concat(raw.readingSet1 || [], raw.readingSet3 || []);
const sourceOf = setNo => (Number(setNo) === 3 ? set3 : set1);
function entryById(list, id) {
  return (list || []).find(x => x && x.id === id) || null;
}
function completeReading(id) {
  const item = plain(entryById(allReading, id));
  if (!item) throw new Error('device 快照里找不到阅读条目 ' + id);
  item.__sourceText = sourceOf(item.setNo);
  return importer.completeImportedReadingItem(item);
}
function completeListening(entry) {
  const item = plain(entry);
  item.__sourceText = sourceOf(item.setNo);
  return importer.completeImportedListeningItem(item);
}
/* 【新快照兼容】重新导入后条目 id 是新的时间戳；本脚本的断言按基线 id 选条目。
 * 若旧 id 在快照里找不到，就按「题型 + setNo 顺序」把新条目别名到基线 id（只改内存）。
 * 这样同一套断言既能验旧快照（修复前缺陷），也能验重新导入后的新快照。*/
(function aliasSnapshot() {
  const oldIdsPresent = READING_A.some(id => entryById(allReading, id));
  if (oldIdsPresent) return;
  const byType = type => allReading.filter(x => String(x && x.readingType) === type)
    .sort((a, b) => Number(a.setNo) - Number(b.setNo));
  [[READING_A, 'section-a'], [READING_B, 'section-b']].forEach(([ids, type]) => {
    const list = byType(type);
    ids.forEach((id, i) => { if (list[i]) list[i].id = id; });
  });
  const essays = (raw.writingMine || []).filter(x => String(x && x.writingType) === 'essay')
    .sort((a, b) => Number(a.setNo) - Number(b.setNo));
  WRITING_ESSAYS.forEach((id, i) => { if (essays[i]) essays[i].id = id; });
  console.log('INFO 新快照：已按题型/套别把条目别名到基线 id（section-a ' + byType('section-a').length + ' / section-b ' + byType('section-b').length + ' / essay ' + essays.length + '）');
})();

function readingPassage(title, setNo) {
  const hit = allReading.find(x => Number(x.setNo) === Number(setNo)
    && String(x.title || '').trim().toLowerCase() === String(title).toLowerCase());
  expect(hit, 'device 快照里找不到 set' + setNo + ' ' + title);
  const copy = plain(hit);
  copy.__sourceText = sourceOf(copy.setNo);
  return importer.completeImportedReadingItem(copy);
}

function findBatchAt(text, batches, needle) {
  const offset = text.indexOf(needle);
  if (offset < 0) return null;
  return batches.find(b => offset >= b.start && offset < b.end) || null;
}

/* ---------- 输出环境与真实夹具概况（让每次复跑可追溯） ---------- */
const header = [
  '导入缺失离线验收（纯 Node，不发 AI 请求，不连平板）',
  'node ' + process.version,
  '夹具: ' + rel(itemsPath) + ' (' + raw.listeningMine.length + ' 听力 / ' + allReading.length + ' 阅读 / ' + (raw.writingMine || []).length + ' 写作)',
  '原文: ' + FIXTURE.set1 + ' (' + set1.length + ' 字符) + ' + FIXTURE.set3 + ' (' + set3.length + ' 字符)',
  '代码: ' + CODE.pipeline + ' sha1 ' + sha1(pipelineSrc) + ' | ' + CODE.importer + ' sha1 ' + sha1(importerSrc) + ' | ' + CODE.repair + ' sha1 ' + sha1(repairedSrc),
];
header.forEach(line => console.log(line));
console.log('');

/* 修复前快照状态：证明夹具确实带缺陷（真实数据，不是造出来的） */
(function rawState() {
  const aMissing = READING_A.reduce((sum, id) => {
    const it = entryById(allReading, id); const qs = (it && it.questions) || [];
    return sum + qs.filter(q => !String(q && q.q || '').trim()).length;
  }, 0);
  const bMissing = READING_B.reduce((sum, id) => {
    const it = entryById(allReading, id); const qs = (it && it.questions) || [];
    return sum + qs.filter(q => !String(q && q.q || '').trim()).length;
  }, 0);
  let placeholder = 0, totalListen = 0;
  (raw.listeningMine || []).forEach(it => {
    (it.qs || []).forEach(q => { totalListen++; if (/^Question\s*\d+$/i.test(String(q && q.q || '').trim())) placeholder++; });
  });
  let writingBad = 0;
  WRITING_ESSAYS.forEach(id => {
    const it = entryById(raw.writingMine || [], id);
    if (it && /Directions:For|part,you|ofdigital|comments,cite|thebeginning|ofyour/.test(String(it.prompt || ''))) writingBad++;
  });
  console.log('INFO 修复前快照状态：Section A/B 题干为空 ' + (aMissing + bMissing) + '/40；听力 "Question N" 占位 ' + placeholder + '/' + totalListen + '；写作空格/粘连 ' + writingBad + '/' + WRITING_ESSAYS.length);
  console.log('');
})();

/* ---------- 断言框架 ---------- */
const results = [];
function check(group, name, run) {
  try {
    const detail = run();
    results.push({ group, name, ok: true, detail: detail || '' });
    console.log('PASS [' + group + '] ' + name + (detail ? '\n     证据: ' + detail : ''));
  } catch (e) {
    const msg = (e && e.message) || String(e);
    results.push({ group, name, ok: false, detail: msg });
    console.log('FAIL [' + group + '] ' + name + '\n     原因: ' + msg.replace(/\n/g, '\n           '));
  }
}

/* ---------- [批次] ---------- */
check('[批次]', 'buildBatches 不把题干与它的 A–D 选项切成两批（set1 真实缺陷 Q53；set3 要求 Q51–55 同批）', () => {
  const problems = [];
  const scan = (label, text) => {
    const batches = plain(IP.buildBatches(text, {}));
    const full = IP.numberedQuestions(text);
    batches.forEach((b, i) => {
      const parsed = IP.numberedQuestions(b.text);
      parsed.forEach((info, n) => {
        const src = full.get(n);
        if (!src) return;
        const want = src.opts.filter(Boolean).length;
        const got = info.opts.filter(Boolean).length;
        if (want === 4 && got < 4) problems.push(label + ' b' + i + '(module=' + b.module + ') Q' + n + ' 题干在批内但选项只有 ' + got + '/4');
      });
      if (i > 0) {
        const first = String(b.text).replace(/^\s+/, '').split('\n')[0].trim();
        if (/^[A-D]\s*[).、]/.test(first)) problems.push(label + ' b' + i + '(module=' + b.module + ') 以选项行开头：' + short(first, 50));
      }
    });
    return batches;
  };
  const batches3 = scan('set3', set3);
  scan('set1', set1);

  /* set3：包含 Passage Two Q51 的批次必须同时包含 Q55 的 4 个选项（题面指定断言） */
  const b51 = findBatchAt(set3, batches3, 'What does the passage say about infants');
  expect(b51, 'set3 里定位不到 Passage Two Q51 所在批次');
  const full3 = IP.numberedQuestions(set3);
  const q55 = full3.get(55);
  expect(q55 && q55.opts.filter(Boolean).length === 4, 'set3 原文里 Q55 解析不出 4 个选项：' + JSON.stringify(q55 && q55.opts));
  const missing = q55.opts.filter(Boolean).filter(o => !IP.containsSource(b51.text, o));
  expect(missing.length === 0, 'set3 含 Q51 的批次 b' + b51.index + ' 缺 Q55 选项：' + missing.map(o => short(o, 30)).join(' / '));
  const parsed55 = IP.numberedQuestions(b51.text).get(55);
  expect(parsed55 && parsed55.opts.filter(Boolean).length === 4, 'set3 批次 b' + b51.index + ' 内 Q55 选项解析结果不是 4 个');
  expect(problems.length === 0, '发现 ' + problems.length + ' 处题干/选项被拆批：' + problems.slice(0, 8).join('；') + (problems.length > 8 ? ' …' : ''));
  return 'set3 共 ' + batches3.length + ' 批，Q51 与 Q55 四选项同在 b' + b51.index + '；set1/set3 无题干-选项跨批切法';
});

/* ---------- [回填] ---------- */
check('[回填]', 'repairFromSource 能从批内原文补齐缺失选项（set3 Q55；set1 Q53 依赖批次先修好）', () => {
  const batches3 = plain(IP.buildBatches(set3, {}));
  const b51 = findBatchAt(set3, batches3, 'What does the passage say about infants');
  expect(b51, 'set3 里定位不到 Q51 所在批次');
  const parsed3 = IP.numberedQuestions(b51.text);
  const simulate = nums => ({
    module: 'reading',
    items: [{
      readingType: 'traditional', title: 'Passage Two', paragraphs: ['x'],
      questions: nums.map(n => {
        const info = parsed3.get(n) || { stem: '', opts: [] };
        return { number: n, q: info.stem, opts: n === 55 ? [] : info.opts.slice(0, 4), a: null };
      }),
    }],
  });
  const fixed3 = plain(IP.repairFromSource(simulate([51, 52, 53, 54, 55]), b51, { module: 'reading' }));
  const q55 = (fixed3.result.items[0].questions || []).find(q => Number(q.number) === 55);
  expect(q55, '回填结果里没有 Q55');
  const filled = (q55.opts || []).filter(o => String(o == null ? '' : o).trim()).length;
  expect(filled === 4, 'set3 Q55 回填后仍只有 ' + filled + '/4 个选项');

  /* set1 真实缺陷：Q53 的 C/D 选项被切到下一批，回填只能拿到 2 个 → 批次修好后这里才会 4 个 */
  const batches1 = plain(IP.buildBatches(set1, {}));
  const b53 = findBatchAt(set1, batches1, 'What point does the author want to make with cities like Burlington');
  expect(b53, 'set1 里定位不到 Q53 所在批次');
  const parsed53 = IP.numberedQuestions(b53.text).get(53);
  const sim53 = { module: 'reading', items: [{ readingType: 'traditional', title: 'Passage Two', paragraphs: ['x'], questions: [{ number: 53, q: parsed53 ? parsed53.stem : '', opts: [], a: null }] }] };
  const fixed53 = plain(IP.repairFromSource(sim53, b53, { module: 'reading' }));
  const q53 = (fixed53.result.items[0].questions || []).find(q => Number(q.number) === 53);
  const got53 = ((q53 && q53.opts) || []).filter(o => String(o == null ? '' : o).trim()).length;
  expect(got53 === 4, 'set1 Q53 回填后只有 ' + got53 + '/4 个选项（所在批次 b' + b53.index + ' 缺 C/D，说明题干与选项被拆批）');
  return 'set3 Q55 回填 4/4；set1 Q53 回填 4/4（b' + b53.index + ' 已含全部选项）';
});

/* ---------- [SectionA/B] ---------- */
check('[SectionA/B]', 'completeImportedReadingItem：A 每题 q 非空 + opts 非空；B 每题 q 非空 + opts 为段落字母', () => {
  expect(typeof importer.completeImportedReadingItem === 'function', 'js/importer.js 未导出 completeImportedReadingItem（补全逻辑缺失或在 vm 上下文不可见）');
  const problems = [];
  const evidence = [];
  READING_A.forEach(id => {
    const item = completeReading(id);
    const qs = Array.isArray(item.questions) ? item.questions : [];
    if (qs.length !== 10) problems.push(id + ' 题数 ' + qs.length + ' != 10');
    qs.forEach(q => {
      const num = Number(q && q.number);
      if (!String(q && q.q || '').trim()) problems.push(id + ' Q' + num + ' q 为空');
      const opts = Array.isArray(q && q.opts) ? q.opts.filter(o => String(o == null ? '' : o).trim()) : [];
      if (!opts.length) problems.push(id + ' Q' + num + ' opts 为空');
    });
    const first = qs[0] || {};
    evidence.push(id + ' A：q[0]=' + JSON.stringify(short(first.q, 46)) + ' opts[0]=' + ((first.opts || []).length) + ' 项(' + (first.optionMode || '?') + ')');
  });
  READING_B.forEach(id => {
    const item = completeReading(id);
    const qs = Array.isArray(item.questions) ? item.questions : [];
    if (qs.length !== 10) problems.push(id + ' 题数 ' + qs.length + ' != 10');
    qs.forEach(q => {
      const num = Number(q && q.number);
      if (!String(q && q.q || '').trim()) problems.push(id + ' Q' + num + ' q 为空（陈述句没搬到 q）');
      const opts = Array.isArray(q && q.opts) ? q.opts : [];
      if (!opts.length) problems.push(id + ' Q' + num + ' opts 为空');
      else if (!opts.every(o => /^[A-Z]$/.test(String(o || '').trim()))) problems.push(id + ' Q' + num + ' opts 不是段落字母：' + JSON.stringify(opts.slice(0, 5)));
    });
    const first = qs[0] || {};
    evidence.push(id + ' B：q[0]=' + JSON.stringify(short(first.q, 46)) + ' opts[0]=' + ((first.opts || []).length) + ' 项(' + (first.optionMode || '?') + ')');
  });
  expect(problems.length === 0, '发现 ' + problems.length + ' 处缺失：' + problems.slice(0, 10).join('；') + (problems.length > 10 ? ' …' : ''));
  return evidence.join(' | ');
});

/* ---------- [补全-traditional] ---------- */
check('[补全-traditional]', 'completeImportedReadingItem：set3 Q55 补到 4 个选项；set1 Passage Two 缺的 Q54 补齐', () => {
  expect(typeof importer.completeImportedReadingItem === 'function', 'js/importer.js 未导出 completeImportedReadingItem');
  const p2set3 = readingPassage('Passage Two', 3);
  const q55 = (p2set3.questions || []).find(q => Number(q.number) === 55);
  expect(q55, 'set3 Passage Two 补全后没有 Q55');
  const filled3 = (q55.opts || []).filter(o => String(o == null ? '' : o).trim()).length;
  expect(filled3 === 4, 'set3 Q55 补全后 opts 只有 ' + filled3 + '/4：' + JSON.stringify(q55.opts));

  const p2set1 = readingPassage('Passage Two', 1);
  const nums = (p2set1.questions || []).map(q => Number(q.number)).sort((a, b) => a - b);
  [51, 52, 53, 54, 55].forEach(n => expect(nums.includes(n), 'set1 Passage Two 补全后仍缺 Q' + n + '（实际题号 ' + nums.join(',') + '）'));
  [51, 52, 53, 54, 55].forEach(n => {
    const q = (p2set1.questions || []).find(x => Number(x.number) === n);
    const c = ((q && q.opts) || []).filter(o => String(o == null ? '' : o).trim()).length;
    expect(c === 4, 'set1 Q' + n + ' 补全后 opts ' + c + '/4');
  });
  return 'set3 Q55 opts 4/4；set1 P2 题号 ' + nums.join(',') + '，各题 opts 4/4';
});

/* ---------- [听力] ---------- */
check('[听力]', 'completeImportedListeningItem：清掉伪造题干（Question N / 纯题号），空题干标 stemMissing 且可统计', () => {
  expect(typeof importer.completeImportedListeningItem === 'function', 'js/importer.js 未导出 completeImportedListeningItem（补全逻辑缺失或在 vm 上下文不可见）');
  const issues = [];
  let total = 0, empty = 0, stemMissing = 0, placeholder = 0, numberOnly = 0, realStem = 0;
  (raw.listeningMine || []).forEach(entry => {
    const item = completeListening(entry);
    const qs = Array.isArray(item.qs) ? item.qs : [];
    const range = String(item.title || '').match(/Questions?\s+(\d+)\s+to\s+(\d+)/i);
    if (range) {
      const want = Number(range[2]) - Number(range[1]) + 1;
      if (qs.length !== want) issues.push(item.id + ' 题数 ' + qs.length + ' != 卷面 ' + want + '（静默丢题）');
    }
    qs.forEach((q, qi) => {
      total++;
      const numText = Number.isFinite(Number(q && q.number)) ? 'Q' + Number(q.number) : 'Q#' + (qi + 1);
      const stem = String(q && q.q == null ? '' : q.q).trim();
      if (!stem) {
        empty++;
        if (q && q.stemMissing === true) stemMissing++;
        else issues.push(item.id + ' ' + numText + ' q 为空但没有 stemMissing 标记');
        return;
      }
      if (/^Question\s*\d+$/i.test(stem)) { placeholder++; issues.push(item.id + ' ' + numText + ' 仍是 "Question N" 占位：' + JSON.stringify(stem)); return; }
      if (/^Questions?\s+\d+\s*(?:to|[-–—])\s*\d+\s+are\s+based\s+on/i.test(stem)) { placeholder++; issues.push(item.id + ' ' + numText + ' 题干是题组范围行：' + JSON.stringify(stem)); return; }
      if (/^\s*\d+\s*[.、)）]?\s*$/.test(stem)) { numberOnly++; issues.push(item.id + ' ' + numText + ' 题干只是题号：' + JSON.stringify(stem)); return; }
      realStem++;
    });
  });
  expect(issues.length === 0, '发现 ' + issues.length + ' 处：' + issues.slice(0, 10).join('；') + (issues.length > 10 ? ' …' : ''));
  return total + ' 题：空题干 ' + empty + '（stemMissing ' + stemMissing + '）/ 纯题号 ' + numberOnly + ' / Question N 占位 ' + placeholder + ' / 真实题干 ' + realStem;
});

/* ---------- [听力警告] ---------- */
check('[听力警告]', 'validateBatch 对空/占位题干给 STEM_* warning（不是 error），供上层统计', () => {
  const batches = plain(IP.buildBatches(set1, {}));
  const batch = batches.find(b => b.module === 'listening' && /Questions\s+9\s+to\s+11/.test(b.text));
  expect(batch, 'text-set1 的 buildBatches 结果里找不到含 "Questions 9 to 11" 的听力批次');
  const mkQs = (start, end) => {
    const list = raw.listeningMine || [];
    const byNumbers = list.find(x => {
      const nums = (x.qs || []).map(q => Number(q.number));
      return nums.includes(start) && nums.includes(end);
    });
    const entry = byNumbers || list.find(x => new RegExp('^Questions? ' + start + ' to ' + end).test(String(x.title)));
    expect(entry, 'device 听力条目缺 Questions ' + start + ' to ' + end);
    return plain(entry).qs.map(q => ({ number: Number(q.number), q: String(q.q == null ? '' : q.q), opts: (q.opts || []).slice(0, 4), a: null }));
  };
  const qs = mkQs(1, 4).concat(mkQs(9, 11));
  const result = IP.validateBatch({ module: 'listening', items: [{ title: '听力验收夹具', words: [], script: [], qs }] }, batch, { module: 'listening', partial: true });
  const stemWarnings = (result.warnings || []).filter(w => /STEM/i.test(String(w.code)));
  const stemErrors = (result.errors || []).filter(e => /STEM/i.test(String(e.code)));
  expect(stemErrors.length === 0, '题干问题被做成了 error（应为 warning）：' + JSON.stringify(stemErrors));
  expect(result.ok === true, '这组夹具本身不该有其它错误：' + JSON.stringify(result.errors));
  const statStem = Object.keys(result.stats || {}).filter(k => /stem/i.test(k)).reduce((sum, k) => sum + (Number(result.stats[k]) || 0), 0);
  expect(stemWarnings.length >= 2 || statStem >= 2, '没有为无题干题产生可统计的 STEM warning：warnings=' + JSON.stringify(result.warnings) + ' stats=' + JSON.stringify(result.stats));
  const codes = Array.from(new Set(stemWarnings.map(w => w.code)));
  return 'STEM warning ' + stemWarnings.length + ' 条' + (codes.length ? '（' + codes.join(',') + '）' : '') + '，stats stem 计数 ' + statStem + '，errors ' + result.errors.length + ' 条';
});

/* ---------- [写作] ---------- */
check('[写作]', 'polishImportedEnglish：Directions/逗号/冒号补空格、ofdigital 等粘连拆开、结尾完整', () => {
  expect(typeof importer.polishImportedEnglish === 'function', 'js/importer.js 未导出 polishImportedEnglish（写作修复缺失或在 vm 上下文不可见）');
  const issues = [];
  const evidence = [];
  WRITING_ESSAYS.forEach(id => {
    const item = entryById(raw.writingMine || [], id);
    expect(item, 'device 写作条目缺 ' + id);
    const source = sourceOf(item.setNo);
    const out = String(importer.polishImportedEnglish(item.prompt, source, {}) || '');
    expect(out.trim().length >= String(item.prompt || '').trim().length * 0.9, id + ' polish 后长度异常缩短：' + String(item.prompt || '').length + ' -> ' + out.length);
    const rules = [
      [/Directions:For/, /Directions: For/, 'Directions:For → Directions: For'],
      [/part,you/, /part, you/, 'part,you → part, you'],
    ];
    if (/comments,cite/.test(String(item.prompt))) rules.push([/comments,cite/, /comments, cite/, 'comments,cite → comments, cite']);
    if (/ofdigital/.test(String(item.prompt))) rules.push([/ofdigital/, /of digital/, 'ofdigital → of digital']);
    if (/thebeginning/.test(String(item.prompt))) rules.push([/thebeginning/, /the beginning/, 'thebeginning → the beginning']);
    if (/ofyour/.test(String(item.prompt))) rules.push([/ofyour/, /of your/, 'ofyour → of your']);
    rules.forEach(([bad, good, label]) => {
      if (bad.test(out)) issues.push(id + ' 仍有 ' + label.split('→')[0].trim());
      else if (!good.test(out)) issues.push(id + ' 没有修成 ' + label);
    });
    if (!/at the beginning of your essay\.?\)?$/.test(out.trim())) issues.push(id + ' 结尾不是完整 Directions 句：' + JSON.stringify(short(out.slice(-70), 70)));
    evidence.push(id + ' -> ' + JSON.stringify(short(out, 100)));
  });
  expect(issues.length === 0, issues.slice(0, 12).join('；'));
  return evidence.join(' | ');
});

/* ---------- [写作-截断] ---------- */
check('[写作-截断]', 'device 写作 prompt 与源文同源未截断（源文结尾 at the beginning of your essay.）', () => {
  expect(typeof importer.extractWritingPrompt === 'function', 'js/importer.js 未导出 extractWritingPrompt（无法从源文核对写作 prompt）');
  const evidence = [];
  WRITING_ESSAYS.forEach(id => {
    const item = entryById(raw.writingMine || [], id);
    expect(item, 'device 写作条目缺 ' + id);
    const source = sourceOf(item.setNo);
    const srcPrompt = String(importer.extractWritingPrompt(source) || '');
    expect(srcPrompt.length > 100, id + ' 源文里抽不出写作 prompt（长度 ' + srcPrompt.length + '）');
    const srcTail = 'atthebeginningofyouressay';
    expect(loose(srcPrompt).endsWith(srcTail), id + ' 源文 prompt 结尾不是完整句：' + JSON.stringify(short(srcPrompt.slice(-80), 80)));
    const promptLoose = loose(item.prompt);
    expect(promptLoose.endsWith(srcTail), id + ' device prompt 结尾被截断（期待 ...' + srcTail + '，实际 ' + JSON.stringify(short(item.prompt.slice(-60), 60)) + '）');
    expect(promptLoose === loose(srcPrompt) || promptLoose.length >= loose(srcPrompt).length - 20, id + ' device prompt 与源文差异过大（可能被截断）：device ' + promptLoose.length + ' / 源文 ' + loose(srcPrompt).length + ' 字符');
    evidence.push(id + '：device ' + String(item.prompt).length + ' 字符 / 源文 ' + srcPrompt.length + ' 字符，结尾 ' + JSON.stringify('at the beginning of your essay.'));
  });
  return evidence.join(' | ');
});

/* ---------- [形态兼容] ---------- */
check('[形态兼容]', '选词填空词库为字符串数组时也能归一化并补全 q/opts；写作批次 prompt 含翻译 schema', () => {
  expect(typeof importer.completeImportedReadingItem === 'function', '缺少 completeImportedReadingItem');
  const item = {
    readingType: 'section-a', title: 't', genre: '选词填空',
    clozeText: 'The  Sun  Is  Also  a  Star  is  a  lovely  story. She ___26___ in America. He ___27___ true love.',
    wordBank: ['alleviate', 'clarity', 'cognitive', 'composers', 'hurt', 'inhibiting', 'interrogation',
      'intrinsically', 'loose', 'majestic', 'mandatory', 'recover', 'significantly', 'soothing', 'wards'],
    questions: [{ number: 26, a: 'A' }, { number: 27, a: 'B' }],
  };
  const fixed = importer.completeImportedReadingItem(item);
  expect(Array.isArray(fixed.wordBank) && fixed.wordBank.every(w => w && w.letter && w.word),
    '字符串词库没有被归一化成 {letter,word}：' + JSON.stringify(fixed.wordBank && fixed.wordBank[0]));
  expect(fixed.questions.every(q => String(q.q || '').trim()), '字符串词库场景下题干没补上');
  expect(fixed.questions.every(q => Array.isArray(q.opts) && q.opts.length === 15), '字符串词库场景下选项没补上：' + JSON.stringify(fixed.questions.map(q => (q.opts || []).length)));
  const batch = { index: 0, module: 'writing', text: 'Part IV Translation (30 minutes)\nDirections: translate.', pageStart: 1, pageEnd: 1 };
  const ImporterObj = (importer.window && importer.window.Importer) || importer.Importer;
  expect(ImporterObj && typeof ImporterObj._batchPrompt === 'function', 'vm 上下文里取不到 Importer._batchPrompt');
  const prompt = ImporterObj._batchPrompt(batch, { type: 'cet6' }, [], '');
  expect(/"writingType":"translation"/.test(prompt.system), '写作批次 schema 未包含 translation 变体（翻译题会被 AI 漏掉）');
  expect(/translationText/.test(prompt.system), '写作批次 schema 未要求 translationText');
  return '字符串词库 → 2 题 q/opts 齐（opts 15）；写作 schema 含 translation';
});

/* ---------- 汇总 ---------- */
const failed = results.filter(r => !r.ok);
console.log('');
console.log('===== 汇总：' + results.length + ' 项，PASS ' + (results.length - failed.length) + ' / FAIL ' + failed.length + ' =====');
if (failed.length) {
  failed.forEach(f => console.log('  FAIL [' + f.group + '] ' + f.name));
  process.exitCode = 1;
} else {
  console.log('全部导入缺失验收检查通过');
}