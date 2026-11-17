/* ============ check-reading-phonetic.cjs : 划线分析「音标 + 排版」回归 ============
 * 2026-11-12 用户反馈（截图）：划线分析·词性翻译面板里 prevalence 没有音标，
 * 单词下方孤零零一个「读」按钮，要求补音标并优化排版。
 * 覆盖：
 *  A. 音标清洗：词书 ph 带空格/斜杠/ASCII 撇号 → 统一 /…/；空占位 "/  /" 回退内置词典；
 *  B. 页面契约：词性翻译面板输出 单词 + 音标 + 朗读按钮 同一行，无音标显示占位；
 *  C. 浮窗与生词本：词旁浮窗也显示音标，存入生词本的 ph 是清洗后的 /…/（不再是 "// 'x //"）；
 *  D. 真实词库：data/cet6 里 prevalence 的 ph 经清洗得到 /ˈprevələns/；
 *  E. CSS：.an-word-h / .an-ph / .an-say 契约，「读」按钮不再用负 margin 吊在下面。
 * 做法：vm 加载真实 js/views/reading.js + js/text-repair.js，stub Dict/Store/DOM；不联网、不写文件。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/views/reading.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/modules.css'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '：' + (e && e.message)); process.exitCode = 1; }
}

/* ---------- 受控词库：prevalence 有真实格式的音标；destined 是空占位；emptyph 两边都没有 ---------- */
const BOOK = {
  prevalence: {
    w: 'prevalence', ph: "/ 'prevələns /",
    tr: [{ t: 'n', d: '流行，普遍' }],
    phr: [{ p: 'prevalence rate', d: '流行率' }],
    ex: [{ en: 'Despite its prevalence, schizophrenia has existed behind a wall of secrecy.', cn: '尽管精神分裂症患者为数众多，但多年来这种病一直被捂着掩着。' }],
  },
  destined: { w: 'destined', ph: '/  /', tr: [{ t: 'adj', d: '命中注定的' }], phr: [], ex: [] },
  emptyph: { w: 'emptyph', ph: '', tr: [{ t: 'adj', d: '测试词' }], phr: [], ex: [] },
};
const GLOBAL = {
  prevalence: ["'prevələns", 'n.流行,盛行,普遍'],
  destined: ['ˈdestɪnd', 'adj.命中注定的'],
};

function makeDict() {
  return {
    content: { reading: { passages: [] } },
    books: {},
    get(word) {
      const w = String(word || '').toLowerCase();
      const hit = GLOBAL[w];
      return hit ? [hit[0], hit[1], w] : null;
    },
    inBook(book, word) {
      const w = String(word || '').toLowerCase();
      return BOOK[w] || null;
    },
  };
}

function loadView() {
  const created = [];
  const node = () => ({
    style: {}, className: '', id: '', innerHTML: '', textContent: '',
    offsetWidth: 220, offsetHeight: 120,
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, remove() {}, querySelector() { return { onclick: null }; },
    getBoundingClientRect() { return { left: 10, top: 10, width: 40, height: 20, bottom: 30 }; },
    isConnected: true, contains() { return false; },
  });
  const documentStub = {
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement() { const el = node(); created.push(el); return el; },
    addEventListener() {}, removeEventListener() {},
  };
  const store = {
    d: { activeBook: 'cet6', readLog: {} },
    flush() {}, addStat() {}, logActivity() {},
    added: [],
    nbAdd(item) { store.added.push(item); return true; },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1200, innerHeight: 900,
    window: null, document: documentStub, localStorage: null,
    App: {
      toast() {}, freshView: () => ({ innerHTML: '' }), freshNode: () => null,
      closeModal() {}, modal() {}, confirm() {}, mmss: s => String(s),
      words: t => String(t || '').trim().split(/\s+/).filter(Boolean),
      pageSeconds: () => 60, resetPageTimer() {},
    },
    Store: store, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    on: () => {}, Picker: { html: () => '', bind() {}, filter: a => a, familyLabel: x => x },
    Dict: makeDict(), AI: { ready: false },
    Speech: { stop() {}, speak() {} },
    ViewNotebook: { open() {} }, Importer: { open() {} },
    fullLabel: () => '', sessionLabel: x => x,
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/text-repair.js'), 'utf8'), ctx);
  vm.runInContext(SRC, ctx);
  const V = vm.runInContext('ViewRead', ctx);
  V.mode = 'edit'; V.submitted = false; V.answers = {}; V.marks = {};
  V.readType = 'section-a'; V._paraCn = {}; V._paraOpen = new Set();
  V._reRenderPassage = () => {};
  V.cur = { id: 'p1', title: 'Test Passage', level: 'CET-6', paragraphs: ['prevalence rate is high.'] };
  V.anTab = 'word';
  V.hist = [];
  V.aiInline = false; V.aiData = null;
  return { V, store, created };
}

function panel(V, word) {
  V.selected = { type: 'word', text: word };
  return V._anPanel();
}

/* ---------- A. 音标清洗 ---------- */
check("音标清洗：词书 \" / 'prevələns / \" → /ˈprevələns/（撇号转 IPA）", () => {
  const { V } = loadView();
  assert.equal(V._phoneticText("/ 'prevələns /"), '/ˈprevələns/');
});

check('音标清洗：已带双斜杠的脏串 "//ˈprevələns//" 也不会留下多余斜杠', () => {
  const { V } = loadView();
  assert.equal(V._phoneticText('//ˈprevələns//'), '/ˈprevələns/');
});

check('音标清洗：空占位 "/  /" 视为没有音标（不输出 //）', () => {
  const { V } = loadView();
  assert.equal(V._phoneticText('/  /'), '');
  assert.equal(V._phoneticText(''), '');
});

check('音标回退：词书空占位时回退内置词典（destined → /ˈdestɪnd/）', () => {
  const { V } = loadView();
  assert.equal(V._wordPhonetic(V._wordInfo('destined')), '/ˈdestɪnd/');
});

/* ---------- B. 词性翻译面板契约 ---------- */
check('面板排版：单词 + 音标 + 朗读按钮包在 .an-word-h 标题行里', () => {
  const { V } = loadView();
  const html = panel(V, 'prevalence');
  assert.match(html, /class="an-word-h"/, '缺少标题行容器');
  assert.match(html, /<div class="an-word">prevalence<\/div>/, '缺少单词');
  assert.match(html, /<div class="an-ph" title="国际音标">\/ˈprevələns\/<\/div>/, '缺少音标');
  assert.match(html, /data-say="prevalence"/, '缺少朗读按钮的朗读目标');
  assert.match(html, />朗读<\/button>/, '朗读按钮文案');
  const head = html.slice(html.indexOf('an-word-h'), html.indexOf('an-defs'));
  assert.ok(head.indexOf('an-ph') < head.indexOf('an-say'), '音标应排在朗读按钮之前');
});

check('面板排版：释义放进 .an-defs，不再用内联 margin 撑开', () => {
  const { V } = loadView();
  const html = panel(V, 'prevalence');
  assert.match(html, /<div class="an-defs">/);
  assert.match(html, /<div class="pos-line"><span class="t">n\.<\/span><span>流行，普遍<\/span><\/div>/);
  assert.ok(!/font-size:13\.5px;margin:8px 0 4px/.test(html), '仍残留旧内联样式');
});

check('面板按钮：发音只保留标题行一个入口，底部不再重复 🔊 发音', () => {
  const { V } = loadView();
  const html = panel(V, 'prevalence');
  assert.ok(html.indexOf('🔊 发音') < 0, '底部仍有重复发音按钮');
  assert.match(html, /<div class="row an-actions">/);
  assert.match(html, /data-act="nbAddWord"/);
  assert.match(html, /data-act="nbAddTomorrow"/);
});

check('面板空态：词书有词但音标缺失时显示「暂无音标」而不是空白', () => {
  const { V } = loadView();
  const html = panel(V, 'emptyph');
  assert.match(html, /class="an-ph an-ph-none">暂无音标<\/div>/);
});

check('面板未收录：本地词库和词典都没有时仍给出 AI 解析引导', () => {
  const { V } = loadView();
  const html = panel(V, 'notaword');
  assert.match(html, /本地词库未收录/);
});

/* ---------- C. 浮窗 / 生词本 ---------- */
check('词旁浮窗：rw-head 里显示同一份音标', () => {
  const { V, created } = loadView();
  V._showWordPop(null, 'prevalence');
  const pop = created[created.length - 1];
  assert.match(pop.innerHTML, /<div class="rw-head"><b>prevalence<\/b><span>\/ˈprevələns\/<\/span><\/div>/);
});

check('词旁浮窗：词书空占位时也回退内置词典音标（destined → /ˈdestɪnd/）', () => {
  const { V, created } = loadView();
  V._showWordPop(null, 'destined');
  const pop = created[created.length - 1];
  assert.match(pop.innerHTML, /<span>\/ˈdestɪnd\/<\/span>/);
});

check("加入生词本：ph 存清洗后的 /…/，不再是 \"// 'prevələns //\"", () => {
  const { V, store } = loadView();
  V.selected = { type: 'word', text: 'prevalence' };
  V._nbWord(false);
  assert.equal(store.added.length, 1);
  assert.equal(store.added[0].ph, '/ˈprevələns/');
});

/* ---------- D. 真实词库里的 prevalence ---------- */
check('真实词库：data/cet6 的 prevalence.ph 清洗后为 /ˈprevələns/（用户截图那个词）', () => {
  const dir = path.join(ROOT, 'data/cet6');
  let entry = null;
  for (const f of fs.readdirSync(dir).filter(x => /^\d+\.json$/.test(x))) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hit = arr.find(x => String(x.w || '').toLowerCase() === 'prevalence');
    if (hit) { entry = hit; break; }
  }
  assert.ok(entry, 'cet6 词库里找不到 prevalence');
  assert.equal(entry.ph, "/ 'prevələns /");
  const { V } = loadView();
  assert.equal(V._phoneticText(entry.ph), '/ˈprevələns/');
});

/* ---------- E. CSS 契约 ---------- */
check('CSS：标题行是 flex 基线对齐，音标用 IPA 字体，释义有 .an-defs', () => {
  assert.match(CSS, /\.an-word-h\{[^}]*display:flex/);
  assert.match(CSS, /\.an-word-h\{[^}]*align-items:baseline/);
  assert.match(CSS, /\.an-ph\{[^}]*font-family:var\(--ipa\)/);
  assert.match(CSS, /\.an-defs\{[^}]*font-size:13\.5px/);
});

check('CSS：.an-say 不再用负 margin 把按钮吊到单词下方', () => {
  assert.ok(!/\.an-say\{[^}]*margin:-/.test(CSS), '仍存在负 margin 定位');
  assert.match(CSS, /\.an-word-h \.an-say\{[^}]*margin-left:auto/);
});

console.log('\n' + (failed ? '有 ' + failed + ' 项失败' : '全部通过') + '（通过 ' + passed + ' / 失败 ' + failed + '）');
