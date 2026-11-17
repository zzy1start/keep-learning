/* ============ check-notebook-export.cjs : 生词本 PDF 导出（来源/时间汇总 + 音标 + 原型 + 词性） ============
 * 【为什么需要】用户发来的生词本 PDF 截图暴露四个问题：
 *   ① 逐词重复「阅读划线 02:48」，两栏很密；来源/时间只需在当天标题出现一次；
 *   ② 音标格式不统一：有的带 /…/、有的不带，坏数据还混入英文词（"rent rent"、"sprɪŋ spring"）；
 *   ③ 划词是单复数/时态时，词头原样导出（implemented/distortions/boiling）；
 *   ④ 释义缺词性（tr[].t 为空，或词性写成 a/ad 等）。
 * 本套 vm 加载真实 js/pdf.js，用最小 Dict/Store/App/esc/document 桩覆盖以上四点，
 * 并验证日标题汇总只出现一次来源/时间、导出 HTML 无 undefined/NaN。
 * 【不能测什么】真实打印对话框与最终 PDF 的排版观感（浏览器 A4 两栏），
 * 本套只覆盖"导出 HTML 的数据与版式标记"，不覆盖浏览器打印渲染。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 最小 iframe 桩：PDF.print 会写 contentDocument，然后在 350ms 后调 print() */
function makeDom() {
  const iframes = [];
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), style: { cssText: '' },
      children: [], remove() {}, appendChild(c) { this.children.push(c); return c; },
    };
    if (String(tag).toLowerCase() === 'iframe') {
      el.contentDocument = {
        _written: '', open() {}, write(s) { this._written += String(s); }, close() {},
      };
      el.contentWindow = { focus() {}, print() { el._printed = (el._printed || 0) + 1; } };
      iframes.push(el);
    }
    return el;
  }
  const body = makeEl('body');
  return { iframes, body, document: { body, createElement: makeEl } };
}

/* 60s 的 iframe 清理定时器不要真跑，否则自检要等一分钟才退出 */
const longTimers = [];
function stubSetTimeout(fn, ms) {
  if (Number(ms) >= 1000) { longTimers.push(fn); return 0; }
  return setTimeout(fn, ms);
}

/* ---------- 词典 / 词书桩：第三项就是 lemma（与真实 Dict.get 同构） ---------- */
const GLOBAL_DICT = {
  implement: ['ˈɪmplɪment', 'vt.实施，执行,使生效,实现,落实（政策）,把…填满 n.工具，器械,家具,手段', 'implement'],
  distortion: ["dɪ'stɔ:ʃn", 'n.扭曲，变形,失真，畸变', 'distortion'],
  boil: ['bɔɪl', 'n.煮沸，沸腾,疔，疖子 vt.& vi.（使）沸腾，开 vt.用开水煮', 'boil'],
  boiling: ['ˈbɔɪlɪŋ', 'n.煮沸,沸腾 adj.沸腾的', 'boiling'],
  rent: ['rent', 'n.租金,地租 vt.& vi.出租,付地租', 'rent'],
  spring: ['sprɪŋ', 'n.春季,泉水 vi.跳，跃', 'spring'],
  tool: ['tuːl', 'n.工具', 'tool'],
};
const FORMS = { implemented: 'implement', distortions: 'distortion', boiling: 'boil' };
const BOOK = {
  implement: { ph: '/ ˈɪmplɪment /', tr: [{ t: 'n', d: '工具，器械' }, { t: 'vt', d: '使生效，履行' }] },
  distortion: { ph: "/ dɪ'stɔ:ʃn /", tr: [{ t: 'n', d: '歪曲；畸变' }] },
  tool: { ph: '', tr: [] },
};

function makeDict() {
  return {
    /* 词形索引桩：真实 Dict.formsIdx 是 Map，_nbBase 在「词自己也有条目」时靠它兜底 */
    formsIdx: new Map(Object.keys(FORMS).map(k => [k, FORMS[k]])),
    get(word) {
      const w = String(word == null ? '' : word).toLowerCase().trim();
      const key = GLOBAL_DICT[w] ? w : (FORMS[w] || '');
      if (!key || !GLOBAL_DICT[key]) return null;
      return [GLOBAL_DICT[key][0], GLOBAL_DICT[key][1], key];
    },
    inBook(bookId, word) {
      if (bookId !== 'cet6') return null;
      const w = String(word == null ? '' : word).toLowerCase().trim();
      return BOOK[w] || BOOK[FORMS[w] || ''] || null;
    },
  };
}

/* 阅读题库桩：验证「老词回填卷面」的三级证据（原句 → 标题 → 词只出现在哪一套）。
 * 两套 2023-03 六级第一套 + 一套 2023-06 六级第二套 + 一篇内置教材（mine:false）。*/
const READ_CONTENT = {
  reading: {
    passages: [
      { id: 'p1', year: 2023, session: '03', setNo: 1, level: 'CET-6', mine: true,
        title: 'Passage One',
        paragraphs: ['Unthinkable as it may be, humanity, every last person, could someday be wiped from the face of the Earth.'] },
      { id: 'p2', year: 2023, session: '03', setNo: 1, level: 'CET-6', mine: true,
        title: 'The Rise of Remote Work',
        paragraphs: ['Remote work has reshaped how companies think about offices and commuting.'] },
      { id: 'p3', year: 2023, session: '06', setNo: 2, level: 'CET-6', mine: true,
        title: 'Passage One',
        paragraphs: ['A totally different article about libraries and public spaces.'] },
      { id: 'b1', year: 2023, session: '06', setNo: '', level: 'CET-6', mine: false,
        title: 'Interdisciplinary Education',
        paragraphs: ['Interdisciplinary education combines biology and economics.'] },
      /* 段落匹配（section-b）真实形态：段落是 { label, text } 对象，不是字符串 */
      { id: 'p4', year: 2024, session: '06', setNo: 1, level: 'CET-6', mine: true,
        title: 'Sleep And Memory',
        paragraphs: [{ label: 'A', text: 'Most people treat sleep as the one part of the day that can be shortened.' }] },
    ],
  },
};

/** 带阅读题库的 Dict 桩（makeDict 的 get/inBook 行为不变） */
function dictWithReading() {
  const d = makeDict();
  d.content = READ_CONTENT;
  return d;
}

function boot(opts) {
  opts = opts || {};
  const dom = makeDom();
  const quiet = { log: console.log, warn() {}, error() {}, info: console.log };
  const ctx = vm.createContext({
    console: quiet, setTimeout: stubSetTimeout, clearTimeout: clearTimeout,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Error, Map,
    isNaN, parseInt, parseFloat,
    document: dom.document, esc,
    Dict: opts.dict === undefined ? makeDict() : opts.dict,
    Store: opts.store || { d: { activeBook: 'cet6' } },
    App: opts.app || { fmtDate() { return '2026-11-11'; }, fmtTime() { return '12:00'; } },
    window: {},
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pdf.js'), 'utf8'), ctx, { filename: 'js/pdf.js' });
  const PDF = vm.runInContext('PDF', ctx);
  return { ctx, dom, PDF };
}

(async () => {
  await check('_wordRow：不再逐词出现来源/时间，但保留词头、音标、释义、固定搭配', () => {
    const { PDF } = boot();
    const html = PDF._wordRow({
      w: 'implemented', ph: '/ ˈɪmplɪment /', tr: [{ t: '', d: '使生效，履行' }],
      srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z',
      phr: ['implement plan — 执行计划'],
    });
    assert.ok(!html.includes('阅读划线'), '逐词不应再出现来源标签');
    assert.ok(!/[0-9]{2}:[0-9]{2}/.test(html), '逐词不应再出现时间');
    assert.ok(!html.includes('nb-src'), '逐词的 .nb-src 应删除');
    assert.ok(html.includes('<span class="w">implement</span>'), '词头应还原成原型，实际：' + html);
    assert.ok(html.includes('/ˈɪmplɪment/'), '音标应统一成 /…/，实际：' + html);
    assert.ok(html.includes('vt. 使生效，履行'), '释义应补词性，实际：' + html);
    assert.ok(html.includes('implement plan — 执行计划'), '固定搭配行应保留');
    assert.ok(!/undefined|NaN/.test(html), '不应出现 undefined/NaN');
  });

  await check('音标统一：坏数据剥掉混入的英文词、空音标从词典补、仍无则空串', () => {
    const { PDF } = boot();
    assert.equal(PDF._nbPh({ w: 'rent', ph: 'rent rent' }, 'rent'), '/rent/');
    assert.equal(PDF._nbPh({ w: 'spring', ph: 'sprɪŋ spring' }, 'spring'), '/sprɪŋ/');
    assert.equal(PDF._nbPh({ w: 'spring', ph: ' spring ' }, 'spring'), '/sprɪŋ/');
    assert.equal(PDF._nbPh({ w: 'tool', ph: '' }, 'tool'), '/tuːl/');
    assert.equal(PDF._nbPh({ w: 'impl', ph: '/ ɪm /' }, 'impl'), '/ɪm/');
    assert.equal(PDF._nbPh({ w: 'zzz', ph: '' }, 'zzz'), '');
  });

  await check('Dict 不可用：原型原样返回、音标不伪造、不抛错', () => {
    const { PDF } = boot({ dict: null });
    assert.equal(PDF._nbBase('Implemented'), 'implemented');
    assert.equal(PDF._nbPh({ w: 'rent', ph: 'rent rent' }, 'rent'), '');
    assert.equal(PDF._nbPos({ tr: [{ t: 'a', d: '潮湿的' }] }, 'wet'), 'adj. 潮湿的');
    const row = PDF._wordRow({
      w: 'Rent', ph: 'rent rent', tr: [{ t: '', d: '租金' }],
      srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z',
    });
    assert.ok(row.includes('<span class="w">rent</span>'), '词头小写原样，实际：' + row);
    assert.ok(!/undefined|NaN/.test(row), '不应出现 undefined/NaN');
  });

  await check('原型还原：implemented→implement、distortions→distortion、boiling→boil', () => {
    const { PDF } = boot();
    assert.equal(PDF._nbBase('implemented'), 'implement');
    assert.equal(PDF._nbBase('distortions'), 'distortion');
    /* 词典里 boiling 自己也有条目，命中键仍是 boiling，需要 forms 索引兜底成 boil */
    assert.equal(PDF._nbBase('boiling'), 'boil');
    assert.equal(PDF._nbBase('Implement'), 'implement');
    assert.equal(PDF._nbBase('zzz'), 'zzz');
    assert.equal(PDF._nbBase(''), '');
  });

  await check('词形索引指向缩写残条时不能带偏词头（spring 不会变成 spr）', () => {
    const { PDF } = boot({ dict: {
      formsIdx: new Map([['spring', 'spr']]),
      get(w) {
        if (w === 'spring') return ['sprɪŋ', 'n.春季', 'spring'];
        if (w === 'spr') return ['', 'abbr.spring 春季,sponsor 发起人', 'spr'];
        return null;
      },
      inBook() { return null; },
    } });
    assert.equal(PDF._nbBase('spring'), 'spring');
    assert.equal(PDF._nbPh({ w: 'spring', ph: 'sprɪŋ spring' }, 'spring'), '/sprɪŋ/');
  });

  await check('词性补全：t 为空按词书/词典补、a→adj.、不重复标签也不编造', () => {
    const { PDF } = boot();
    assert.equal(
      PDF._nbPos({ w: 'implement', tr: [{ t: '', d: '工具，器械' }, { t: '', d: '使生效，履行' }] }, 'implement'),
      'n. 工具，器械；vt. 使生效，履行');
    assert.equal(PDF._nbPos({ w: 'rent', tr: [{ t: '', d: '租金' }] }, 'rent'), 'n. 租金');
    assert.equal(PDF._nbPos({ tr: [{ t: 'a', d: '潮湿的' }, { t: 'ad', d: '非常' }] }, 'wet'),
      'adj. 潮湿的；adv. 非常');
    assert.equal(PDF._nbPos({ tr: [{ t: '名词', d: '工具' }] }, 'tool'), 'n. 工具');
    assert.equal(PDF._nbPos({ w: 'zzz', tr: [{ t: '', d: '某个没词性的释义' }] }, 'zzz'), '某个没词性的释义');
    assert.equal(PDF._nbPos({ tr: [{ t: 'n', d: '甲' }, { t: 'v', d: '乙' }, { t: 'n', d: '丙' }] }, 'x'),
      'n. 甲，丙；v. 乙');
  });

  await check('日标题信息：只保留来源（用户要求删掉具体时间），多来源去重', () => {
    const { PDF } = boot();
    assert.equal(PDF._nbDayMeta([
      { srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z' },
      { srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z' },
      { srcTag: '', addedAt: '2026-11-11T04:40:00.000Z' },
    ]), '· 阅读划词 / 手动');
    assert.equal(PDF._nbDayMeta([{ srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z' }]),
      '· 阅读划词');
    assert.equal(PDF._nbDayMeta([{ srcTag: '', addedAt: '' }]), '· 手动');
    /* 历史数据里「阅读划线 / 阅读划词」是同一动作，必须合并成一个标签 */
    assert.equal(PDF._nbDayMeta([
      { srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z' },
      { srcTag: '阅读划词', addedAt: '2026-11-11T02:49:00.000Z' },
    ]), '· 阅读划词');
  });

  await check('notebook()：日标题只汇总来源、不出现具体时间，条目区不再重复', () => {
    const { PDF, dom } = boot();
    const items = [
      { w: 'implemented', ph: 'implemented implement', tr: [{ t: '', d: '使生效，履行' }], srcTag: '阅读划线', addedAt: '2026-11-11T04:40:00.000Z' },
      { w: 'distortions', ph: '', tr: [{ t: '', d: '歪曲；畸变' }], srcTag: '阅读划词', addedAt: '2026-11-11T02:48:00.000Z' },
      { w: 'boiling', ph: 'bɔɪlɪŋ boiling', tr: [{ t: '', d: '煮沸' }], srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z' },
    ];
    PDF.notebook(items, { bookName: 'CET-6', layout: 'single' });
    const f = dom.iframes[dom.iframes.length - 1];
    assert.ok(f, '必须创建打印 iframe');
    const html = f.contentDocument._written;
    const head = html.slice(html.indexOf('<h1>'), html.indexOf('<h2>'));
    assert.ok(html.includes('2026-11-11（3 词）'), '日标题只留日期与词数，实际：' + head);
    assert.ok(head.indexOf('来源 <b>阅读划词</b>') >= 0, '顶部「来源」应写明来源标签，实际：' + head);
    assert.equal((html.match(/阅读划词/g) || []).length, 1, '来源只在顶部出现一次（日标题不再重复）');
    assert.ok(html.indexOf('阅读划线') < 0, '历史别名也要归一成「阅读划词」');
    assert.ok(html.indexOf('02:48') < 0 && html.indexOf('04:40') < 0, '导出里不应再出现具体时间');
    assert.ok(html.includes('/bɔɪlɪŋ/'), '混入英文词的音标应清洗，实际：' + html);
    assert.ok(html.includes('歪曲'), '释义应保留');
    assert.ok(!/undefined|NaN/.test(html), '导出 HTML 不应出现 undefined/NaN');
  });

  await check('_wordCard（单条导出）同样用原型/统一音标/补词性', () => {
    const { PDF } = boot();
    const card = PDF._wordCard({
      w: 'implemented', ph: '/ implement /', tr: [{ t: '', d: '使生效，履行' }],
      srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z', origin: '来自阅读',
    });
    assert.ok(card.includes('<span class="w">implement</span>'), '词头原型，实际：' + card.slice(0, 300));
    assert.ok(card.includes('/ˈɪmplɪment/'), '音标统一 /…/');
    assert.ok(card.includes('vt. 使生效，履行'), '释义补词性');
    assert.ok(card.includes('阅读划词'), '单条卡片来源也应归一为「阅读划词」');
    assert.ok(card.indexOf('阅读划线') < 0, '不应出现历史别名');
    assert.ok(!/undefined|NaN/.test(card), '不应出现 undefined/NaN');
  });

  await check('顶部只留「来源 / 词数·导出时间」，旧的书名/天数/单双面/区间不再出现；底部 foot 保留', () => {
    const { PDF, dom } = boot();
    PDF.notebook([{
      w: 'implemented', ph: '', tr: [{ t: 'v', d: '实施' }],
      srcTag: '阅读划线', addedAt: '2026-11-11T02:48:00.000Z',
    }], { bookName: 'CET-6 等' });
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    /* <style> 里的排版注释本身含「单面/区间」等词，这里只看真正印出来的正文 */
    const view = html.slice(html.indexOf('<body>'));
    assert.ok(view.includes('来源 <b>阅读划词</b>'), '顶部应写「来源」，实际：' + view.slice(0, 400));
    assert.ok(view.includes('共 <b>1</b> 词 · 导出于 2026-11-11'), '顶部只留词数与导出日期');
    assert.ok(view.indexOf('1 天') < 0 && view.indexOf('单面') < 0 && view.indexOf('区间') < 0,
      '「1 天 / 单面 / 区间」应全部删掉');
    assert.ok(view.indexOf('CET-6 等') < 0, '词书名不再进顶部');
    assert.ok(view.includes('Keep Learning · 生词本（数据仅存于本机浏览器）'), '底部 foot 保持');
  });

  await check('接线：新划词统一写「阅读划词」，生词本页面展示走 App.nbTag', () => {
    const rd = fs.readFileSync(path.join(ROOT, 'js/views/reading.js'), 'utf8');
    assert.ok(rd.indexOf("srcTag: '阅读划词'") >= 0, '阅读页新加入应写阅读划词');
    /* 词汇来源靠加词时写入的卷面快照（_curPaper），少接一个入口就会退化成只有「阅读划词」 */
    const sites = (rd.match(/this\._curPaper\(\)/g) || []).length;
    assert.ok(sites >= 3, '三个加词入口都应写卷面快照，实际只有 ' + sites + ' 处');
    assert.ok(rd.indexOf('_curPaper() {') >= 0, '缺少 _curPaper() 定义');
    assert.ok(rd.indexOf("srcTag: '阅读划线'") < 0, '不应再写历史别名「阅读划线」');
    const nb = fs.readFileSync(path.join(ROOT, 'js/views/notebook.js'), 'utf8');
    assert.ok(nb.indexOf('App.nbTag') >= 0, '生词本列表/详情应走 App.nbTag 归一');
    const core = fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8');
    assert.ok(core.indexOf('App.nbTag') >= 0, '缺少 App.nbTag 定义');
  });

  /* ---------- 2026-11-11 第四轮：顶部加「词汇来源」并简化 ========== */

  await check('卷面文字：年/月/级别/套别各自可控，认不出就不写', () => {
    const { PDF } = boot();
    assert.equal(PDF._nbPaperLabel({ year: 2023, session: '03', setNo: 1, level: 'CET-6' }),
      '2023 年 3 月 · 六级 · 第一套');
    assert.equal(PDF._nbPaperLabel({ year: 2023, session: '06', level: 'CET-6' }), '2023 年 6 月 · 六级');
    assert.equal(PDF._nbPaperLabel({ level: 'CET-6' }), '六级');
    assert.equal(PDF._nbPaperLabel({ year: 2023, session: '12', setNo: 0, level: 'CET-4' }),
      '2023 年 12 月 · 四级');
    assert.equal(PDF._nbPaperLabel({}), '');
    assert.equal(PDF._nbMonthLabel('03'), '3 月');
    assert.equal(PDF._nbMonthLabel('06'), '6 月');
    assert.equal(PDF._nbMonthLabel('other'), '');
    assert.equal(PDF._nbMonthLabel('english-1'), '英语一');
    assert.equal(PDF._nbSetLabel(''), '');
  });

  await check('顶部来源（B 版）：新数据按加词时的卷面快照拼出「年月 · 级别 · 套别 · 来源」', () => {
    const { PDF, dom } = boot();
    PDF.notebook([{
      w: 'implemented', tr: [{ t: 'v', d: '实施' }], srcTag: '阅读划线',
      addedAt: '2026-11-11T02:48:00.000Z',
      paper: { id: 'p1', year: 2023, session: '03', setNo: 1, level: 'CET-6' },
    }], {});
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    assert.ok(html.includes('来源 <b>2023 年 3 月 · 六级 · 第一套 · 阅读划词</b>'),
      '实际：' + html.slice(0, 400));
    assert.ok(html.includes('共 <b>1</b> 词 · 导出于 2026-11-11'), '右侧只留词数与导出日期');
  });

  await check('多套混导：取第一套做代表并写「等 N 套试题」，不逐套罗列', () => {
    const { PDF, dom } = boot();
    PDF.notebook([
      { w: 'implemented', tr: [], srcTag: '阅读划词', addedAt: '2026-11-11T02:48:00.000Z',
        paper: { year: 2023, session: '03', setNo: 1, level: 'CET-6' } },
      { w: 'distortions', tr: [], srcTag: '阅读划词', addedAt: '2026-11-11T02:49:00.000Z',
        paper: { year: 2023, session: '06', setNo: 2, level: 'CET-6' } },
    ], {});
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    assert.ok(html.includes('2023 年 3 月 六级 第一套 等 2 套试题 · 阅读划词'),
      '实际：' + html.slice(0, 400));
  });

  await check('老数据回填①原句：原句只在一篇出现过就认那一套（标题重名也不影响）', () => {
    const { PDF } = boot({ dict: dictWithReading() });
    const meta = PDF._nbPaperOf({
      w: 'humanity',
      srcTag: '阅读划线',
      origin: '来自阅读文章「Passage One」（CET-6）第1段划线，原句：Unthinkable as it may be, humanity could someday be wiped',
    });
    assert.ok(meta, '应能回填卷面');
    assert.equal(PDF._nbPaperLabel(meta), '2023 年 3 月 · 六级 · 第一套');
  });

  await check('老数据回填②标题：全库只有一套用这个标题才认，重名就放弃', () => {
    const { PDF } = boot({ dict: dictWithReading() });
    const ok = PDF._nbPaperOf({ w: 'zebra', srcTag: '阅读划词', origin: '来自阅读文章《The Rise of Remote Work》（CET-6）' });
    assert.equal(PDF._nbPaperLabel(ok), '2023 年 3 月 · 六级 · 第一套');
    const amb = PDF._nbPaperOf({ w: 'zebra', srcTag: '阅读划词', origin: '来自阅读文章《Passage One》' });
    assert.equal(amb, null, '重名标题应放弃，而不是随便挑一套');
  });

  await check('老数据回填③兜底：词只出现在一套自有卷子里才归属，内置教材不参与', () => {
    const { PDF } = boot({ dict: dictWithReading() });
    const ok = PDF._nbPaperOf({ w: 'libraries', srcTag: '阅读划词', origin: '' });
    assert.equal(PDF._nbPaperLabel(ok), '2023 年 6 月 · 六级 · 第二套');
    const builtin = PDF._nbPaperOf({ w: 'interdisciplinary', srcTag: '阅读划词', origin: '' });
    assert.equal(builtin, null, '只在内置教材出现的词不能算成自有卷子');
    const none = PDF._nbPaperOf({ w: 'passages', srcTag: '阅读划词', origin: '' });
    assert.equal(none, null, '一篇都没命中时不归属');
  });

  await check('认不出来源时只写「阅读划词」，绝不编年份', () => {
    const { PDF, dom } = boot({ dict: dictWithReading() });
    PDF.notebook([{
      w: 'qqzz', tr: [], srcTag: '阅读划词', addedAt: '2026-11-11T02:48:00.000Z',
      origin: '来自阅读文章《不存在的文章》',
    }], {});
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    assert.ok(html.includes('来源 <b>阅读划词</b>'), '实际：' + html.slice(0, 400));
    assert.ok(html.indexOf('2023 年') < 0, '不应凭空出现年份');
  });

  await check('来源不止一种：顶部并列「阅读划词 / 手动添加」，日标题保留标签不合并', () => {
    const { PDF, dom } = boot();
    PDF.notebook([
      { w: 'implemented', tr: [], srcTag: '阅读划词', addedAt: '2026-11-11T02:48:00.000Z',
        paper: { year: 2023, session: '03', setNo: 1, level: 'CET-6' } },
      { w: 'tool', tr: [], srcTag: '', addedAt: '2026-11-11T03:00:00.000Z' },
    ], {});
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    assert.ok(html.includes('2023 年 3 月 · 六级 · 第一套 · 阅读划词 / 手动添加'),
      '实际：' + html.slice(0, 400));
    assert.ok(html.includes('（2 词）· 阅读划词 / 手动'), '日标题应保留两种来源');
  });

  await check('段落匹配的段落是 {label,text} 对象时，按原句回填照样可用', () => {
    const { PDF } = boot({ dict: dictWithReading() });
    const meta = PDF._nbPaperOf({
      w: 'shortened', srcTag: '阅读划词',
      origin: '来自阅读文章「Passage A–M」（CET-6）第1段划线，原句：Most people treat sleep as the one part of the day',
    });
    assert.equal(PDF._nbPaperLabel(meta), '2024 年 6 月 · 六级 · 第一套');
  });

  await check('多日导出：顶部右端改成日期区间（不再写「N 天」和「区间」两行）', () => {
    const { PDF, dom } = boot();
    PDF.notebook([
      { w: 'implemented', tr: [], srcTag: '手动', addedAt: '2026-11-01T02:48:00.000Z' },
      { w: 'tool', tr: [], srcTag: '手动', addedAt: '2026-11-11T02:48:00.000Z' },
    ], {});
    const html = dom.iframes[dom.iframes.length - 1].contentDocument._written;
    const view = html.slice(html.indexOf('<body>'));
    assert.ok(view.includes('共 <b>2</b> 词 · 11-01 ~ 11-11（2 天）'), '实际：' + view.slice(0, 400));
    assert.ok(view.indexOf('1 天') < 0 && view.indexOf('区间') < 0, '旧的两行应删掉');
  });

  if (failed) { process.exitCode = 1; console.log('失败 ' + failed + ' 项，通过 ' + passed + ' 项'); }
  else console.log('全部 ' + passed + ' 项生词本导出检查通过');
})();
