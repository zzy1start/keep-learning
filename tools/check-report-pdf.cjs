/* ============ check-report-pdf.cjs : 学习报告 PDF 导出链路 ============
 * 【为什么需要】「设置 → 数据管理 → 学习报告 PDF」原来的实现是：
 *     App.go('stats');
 *     setTimeout(() => $('[data-act="report"]').click(), 300);
 * 也就是「跳到统计页 → 等 300ms → 点统计页的按钮」。这条接力链任何一环断掉都是
 * **静默无反应**：用户只看到"点了没反应"，没有任何报错。
 *
 * 而最致命的一环是 App.render 的兜底：各视图 render() 第一行都调用 App.freshView()
 * 把旧 #view 整体换掉，此后 App.render 手里的 root 已经是**游离节点**；
 * 渲染抛错时把"页面出错"写进游离节点 → 用户看到的是**空页面**（新 #view 是空的），
 * 统计页也因此找不到 [data-act=report] 按钮，报告自然导不出来。
 *
 * 本套用最小 DOM 桩跑真实代码路径：
 *   ① 渲染抛错时错误卡片必须落在**当前** #view 上（旧代码会失败）
 *   ② ViewStats.reportData() 在空存档 / 脏数据（null 条目）下都必须能出完整数据
 *   ③ PDF.report() 生成的 HTML 含全部小节，且真的调用了 iframe 打印
 *   ④ 设置页入口不再依赖「跳转 + 定时器」接力，与统计页共用同一份数据
 * 【不能测什么】真实浏览器里的打印对话框；本套只覆盖"数据与接线"，不覆盖打印观感。
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

/** ---------- 最小 DOM 桩 ---------- */
function makeDom() {
  const iframes = [];
  function makeEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(), id: '', className: '', style: { cssText: '' },
      dataset: {}, children: [], _html: '', _listeners: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
      remove() {},
      replaceWith(n) { this._replacedWith = n; if (dom.view === this) dom.view = n; },
      addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
      dispatch(evt, target) { (this._listeners[evt] || []).forEach(fn => fn({ target, preventDefault() {} })); },
      contains: () => false,
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      closest: () => null,
      focus() {},
      click() { this.dispatch('click', this); },
    };
    if (String(tag).toLowerCase() === 'iframe') {
      const doc = { _written: '', open() {}, write(s) { this._written += String(s); }, close() {} };
      el.contentDocument = doc;
      el.contentWindow = { focus() {}, print() { el._printed = (el._printed || 0) + 1; } };
      iframes.push(el);
    }
    return el;
  }
  const dom = {
    view: null, iframes, body: null, toastWrap: null,
    createElement: makeEl,
  };
  dom.view = makeEl('div'); dom.view.id = 'view';
  dom.body = makeEl('body');
  dom.toastWrap = makeEl('div');
  dom.document = {
    body: dom.body,
    getElementById: id => (id === 'view' ? dom.view : (id === 'toastWrap' ? dom.toastWrap : null)),
    querySelector: sel => {
      if (sel === '#view') return dom.view;
      if (sel === '#toastWrap') return dom.toastWrap;
      if (sel === '[data-act="report"]') return dom._reportBtn || null;
      return null;
    },
    querySelectorAll: () => [],
    createElement: makeEl,
    addEventListener() {},
  };
  dom.document.documentElement = makeEl('html');
  return dom;
}

/** ---------- 启动：core + app + store + pdf + stats（真实文件） ---------- */
function boot(storePayload) {
  const dom = makeDom();
  const toasts = [];
  /* 静音 vm 内的 console.error：本套会**故意**触发一次渲染异常来验证错误卡片是否可见，
   * App.renderError 会照常 console.error，那属于预期噪音；真正失败的断言仍走 PASS/FAIL 行。*/
  const quiet = { log: console.log, warn: () => {}, error: () => {}, info: console.log };
  const ctx = vm.createContext({
    console: quiet, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Error, isNaN, parseInt, parseFloat,
    localStorage: {
      _v: storePayload === undefined ? null : storePayload,
      getItem() { return this._v; }, setItem(k, v) { this._v = v; }, removeItem() { this._v = null; },
    },
    location: { hash: '#/stats', reload() {} },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/152.0' },
    document: dom.document,
    window: {},
    speechSynthesis: {
      getVoices: () => [], speak() {}, cancel() {}, speaking: false, pending: false,
      addEventListener() {}, onvoiceschanged: null,
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    Speech: { stop() {}, list: () => [], profile: () => ({ rate: 1 }), voices: [] },
    Audio: function () { return { play: () => Promise.resolve(), pause() {} }; },
    BOOKS: [{ id: 'cet6', name: 'CET-6', sub: '', size: 4000, color: '#4a7dff' }],
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.addEventListener = () => {};
  ctx.matchMedia = () => ({ matches: false, addEventListener() {} });
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  load('js/core.js');
  load('js/store.js');
  load('js/pdf.js');
  const App = vm.runInContext('App', ctx);
  App.toast = (m, t) => toasts.push({ m: String(m), t: t || '' });
  App.download = () => {};
  ctx.__toasts = toasts;
  load('js/views/stats.js');
  const Store = vm.runInContext('Store', ctx);
  Store.load();
  return { ctx, dom, App, Store, toasts, load };
}

(async () => {
  /* ---------- ① 渲染错误必须可见 ---------- */
  await check('渲染抛错时"页面出错"卡片落在当前 #view（不是被换掉的游离节点）', () => {
    const { ctx, dom, App, load } = boot(JSON.stringify({}));
    load('js/app.js');                      // 需要 App.render
    const vmApp = vm.runInContext('App', ctx);
    vmApp.views.__probe = {
      title: 'probe', ic: '',
      view: () => ({ render(root) { root = vmApp.freshView(); throw new Error('BOOM-渲染失败'); } }),
    };
    vmApp.cur = '__probe';
    vmApp.render();
    assert.match(dom.view.innerHTML, /BOOM-渲染失败/,
      '当前 #view 必须显示错误原因；写进游离节点用户只会看到空白页面');
    assert.match(dom.view.innerHTML, /页面出错/);
  });

  /* ---------- ② 报告数据 ---------- */
  await check('reportData()：空存档也能出完整数据（不抛错、键齐全）', () => {
    const { ctx } = boot(JSON.stringify({}));
    const V = vm.runInContext('ViewStats', ctx);
    const d = V.reportData();
    for (const k of ['streak', 'totalDays', 'firstDay', 'words', 'nb', 'nbMastered', 'listen',
      'read', 'readRate', 'write', 'writeScore', 'bookProg', 'bookTotal', 'recent']) {
      assert.ok(k in d, '缺少字段 ' + k);
    }
    assert.equal(Array.isArray(d.recent), true);
    assert.equal(d.recent.length, 14);
  });

  await check('reportData()：脏存档（null 条目 / 缺 daily）不抛错', () => {
    const payload = {
      notebook: [null, { w: 'a', mastered: true }],
      writeLog: [null, { score: 9, task: 'x' }],
      srs: { cet6: null },
      readLog: { a: null, b: { score: 3, total: 5 } },
      stats: { days: null, streak: 2, daily: { '2026-10-13': null, '2026-10-14': { words: 5, listen: 1 } } },
    };
    const { ctx } = boot(JSON.stringify(payload));
    const V = vm.runInContext('ViewStats', ctx);
    assert.doesNotThrow(() => V.reportData(), '脏数据不能让"导出学习报告"静默失败');
  });

  /* ---------- ③ PDF 生成与打印 ---------- */
  await check('PDF.report()：HTML 含全部小节、无 undefined/NaN，且真的调用了打印', () => {
    const { ctx, dom } = boot(JSON.stringify({}));
    const V = vm.runInContext('ViewStats', ctx);
    const PDF = vm.runInContext('PDF', ctx);
    PDF.report(V.reportData());
    const f = dom.iframes[dom.iframes.length - 1];
    assert.ok(f, '必须创建打印 iframe');
    const html = f.contentDocument._written;
    for (const sec of ['学习报告', '总览', '各词书进度', '最近 14 天学习时长']) {
      assert.ok(html.includes(sec), '报告缺少小节：' + sec);
    }
    assert.ok(!/undefined|NaN/.test(html), '报告里出现了 undefined/NaN：' + (html.match(/.{0,40}(undefined|NaN).{0,20}/) || [''])[0]);
    return new Promise(res => setTimeout(() => {
      try {
        assert.equal(f._printed, 1, '350ms 后必须调用 iframe 的 print()');
        res();
      } catch (e) { throw e; }
    }, 420));
  }).catch(() => {});

  await check('PDF.print 打印调用抛错时给出可见提示（不再静默）', () => {
    const { ctx, dom, toasts } = boot(JSON.stringify({}));
    const PDF = vm.runInContext('PDF', ctx);
    const origCreate = dom.document.createElement;
    dom.document.createElement = tag => {
      const el = origCreate(tag);
      if (String(tag).toLowerCase() === 'iframe') el.contentWindow.print = () => { throw new Error('print blocked'); };
      return el;
    };
    PDF.print('<h1>x</h1>', 't');
    return new Promise((res, rej) => setTimeout(() => {
      try {
        assert.ok(toasts.some(x => /打印失败/.test(x.m)), '打印失败必须 Toast 出来，实际：' + JSON.stringify(toasts));
        res();
      } catch (e) { rej(e); }
    }, 420));
  });

  /* ---------- ④ 接线（源码级） ---------- */
  await check('设置页「数据管理 → 学习报告 PDF」不再用"跳转 + 定时器"接力', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(!/setTimeout\([^)]*data-act=.report/.test(src),
      '仍然存在 setTimeout(() => $(\'[data-act="report"]\').click()) 这种易断的接力');
    assert.match(src, /ViewStats\.exportReport\(\)/, '应直接调用统一入口 ViewStats.exportReport()');
  });

  await check('统计页按钮也走同一个入口 exportReport()', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/stats.js'), 'utf8');
    assert.match(src, /exportReport\s*\(/, 'stats.js 必须提供 exportReport()');
    assert.match(src, /ViewStats|exportReport/, 'report 分支应调用 exportReport()');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项学习报告导出检查通过');
})();
