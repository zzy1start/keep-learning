/* ============ check-listening-sent.cjs : 单句听力（听音选句 + 音色可见）============
 * 【用户要求（原话）】"单句听力播放时，右侧可以选择该句的英文原句；其他的不要"。
 * 也就是右侧**只有一个题型**：听英文原句 → 从 4 个英文句子里选出听到的那一句；
 * 不要方向切换（英→中 / 中→英）、不要中文选项的题目、不要"听写关键词"。
 *
 * 覆盖：① 题目与答案 ② 缓存版本 ③ 关键词听写/方向切换/中文选项均已删净
 *       ④ 播放行为（主播放键与句旁复现都读英文原句）⑤ 播放区写明"本句音色"
 * 【不能测什么】真实浏览器里的听感与渲染观感。
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

const SENTS = [
  { en: 'Interdisciplinary education encourages students to connect knowledge across different fields.', cn: '跨学科教育鼓励学生将不同领域的知识联系起来。' },
  { en: 'The lecture will begin at nine a.m. in the main building.', cn: '讲座将于上午九点在主楼开始。' },
  { en: 'Please make sure to submit your assignment before the deadline.', cn: '请确保在截止日期前提交作业。' },
  { en: 'Researchers have found that sleep deprivation impairs memory formation.', cn: '研究人员发现睡眠不足会损害记忆形成。' },
  { en: 'Climate change poses a serious threat to coastal ecosystems.', cn: '气候变化对沿海生态系统构成严重威胁。' },
];

/** 加载 SentQuiz（listening-sent.js） */
function loadSent(cache) {
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number,
    Store: { d: { settings: {}, lsnQuiz: cache }, flush() {} },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening-sent.js'), 'utf8'), ctx);
  return ctx.window.SentQuiz;
}

/** 加载 listening.js，并收集 on(...) 注册的委托处理器 —— 这样能**真的驱动一次点击** */
function loadViewWithHandlers(opts = {}) {
  const handlers = [];
  const statusEl = { _history: [], set innerHTML(v) { this._history.push(String(v)); }, get innerHTML() { return this._history[this._history.length - 1] || ''; } };
  const lineEl = {
    dataset: { say: SENTS[0].en },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    closest: () => null,
  };
  const spoken = [];
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    App: { toast() {}, freshNode: () => null },
    $: sel => (sel === '#playStatus' ? statusEl : (sel === '#spd' ? { value: '1' } : null)),
    $$: sel => (sel === '.script-line' ? [lineEl] : []),
    esc: v => String(v == null ? '' : v),
    on: (root, evt, sel, fn) => { handlers.push({ sel, fn }); },
    Store: { d: { settings: Object.assign({ speechRate: 1, listenLeadIn: 0 }, opts.settings || {}) }, flush() {} },
    AI: { ready: false },
    Dict: { content: { listening: { sentences: opts.sentences || SENTS, dialogues: [], passages: [] } } },
    Speech: {
      list: () => [], _isCloud: () => false, stop() {}, primeAudio() {}, prefetch() {}, hasLang: () => true,
      chime: () => Promise.resolve(true),
      speak(text, o) {
        spoken.push({ text: String(text), lang: (o && o.lang) || 'en' });
        if (o && o.onend) setTimeout(() => o.onend({}), 1);
      },
    },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8'), ctx);
  const view = ctx.window.ViewListen;
  view.kind = 'sentence';
  view.idx = 0;
  view._body = () => {};
  view.stopHL = () => {};
  /* _playLines 用桩替掉：它读的就是英文原文，替掉后能一眼看出走的是哪条路 */
  view._playLines = ls => { spoken.push({ text: 'EN-LINES:' + ls.map(x => x.text).join(' | '), lang: 'en' }); return Promise.resolve(); };
  view._bindCommon({}, SENTS[0].en);
  return { view, handlers, spoken, statusEl, lineEl };
}
const clickPlay = h => h.fn({}, { dataset: { act: 'play' }, classList: { add() {}, remove() {} } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await check('题目：4 个选项都是英文句子，答案是本句英文，干扰项不含本句也不重复', () => {
    const quiz = loadSent().buildQuiz(SENTS);
    for (let i = 0; i < SENTS.length; i++) {
      const q = quiz[i];
      assert.ok(q && q.pick, '第 ' + i + ' 句必须有题目');
      assert.ok(q.pick.opts.length >= 2, '要有选项');
      assert.equal(q.pick.opts[q.pick.a], SENTS[i].en, '正确答案必须是本句英文原句');
      assert.equal(new Set(q.pick.opts).size, q.pick.opts.length, '选项不能重复');
      assert.equal(q.pick.opts.filter(o => o === SENTS[i].en).length, 1, '本句英文只能出现一次');
      assert.ok(q.pick.opts.every(o => /[A-Za-z]/.test(o)), '选项必须都是英文（不能混中文）');
    }
  });

  await check('题库里不再有中文选项 / 第二题型（pickEn）', () => {
    const quiz = loadSent().buildQuiz(SENTS);
    assert.ok(!quiz[0].pickEn, '不应再有 pickEn（中→英）的第二套题');
    const cn = SENTS.map(x => x.cn);
    assert.ok(!quiz[0].pick.opts.some(o => cn.includes(o)), '选项里不能出现中文译文');
  });

  await check('题目缓存版本升级到 3：旧缓存（含 pickEn/中文选项）会自动重建', () => {
    const SentQuiz = loadSent({ __n: 5, __v: 2, 0: { pick: { opts: ['旧的中文选项', 'x'], a: 0 }, pickEn: { opts: [], a: 0 } } });
    assert.equal(SentQuiz.CACHE_V, 3, '缓存版本应为 3');
    const quiz = SentQuiz.getQuiz(SENTS);
    assert.equal(quiz.__v, 3, '应写入当前版本');
    assert.equal(quiz[0].pick.opts[quiz[0].pick.a], SENTS[0].en, '重建后应是英文题');
    assert.ok(!quiz[0].pickEn);
  });

  await check('「听写关键词」已删干净（题目数据、视图、导出 API 三处）', () => {
    const sent = fs.readFileSync(path.join(ROOT, 'js/views/listening-sent.js'), 'utf8');
    assert.ok(!/spell/.test(sent), 'listening-sent.js 里不应再有 spell');
    assert.ok(!/gradeSpell|keywordsOf/.test(sent), '不再导出听写判分 API');
    const view = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(!/spellIn|_spellInput|关键词听写/.test(view), '视图里不应再有关键词听写');
  });

  await check('方向切换与中文朗读已删干净（用户要求"其他的不要"）', () => {
    const view = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(!/data-sqdir|_sentDir|_paintSentDir|lsnSentDir/.test(view), '不应再有方向切换与方向提示');
    const playBlock = view.slice(view.indexOf('const playSentence'), view.indexOf('const playExam'));
    assert.ok(!/zh-CN/.test(playBlock), '单句播放不应再有"读中文"的分支');
    assert.ok(!/data-cn/.test(view), '原文行不应再带 data-cn');
    const store = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
    assert.ok(!/lsnSentDir/.test(store), '设置里不应再有 lsnSentDir');
  });

  await check('★ 主播放键：读这一句英文原文（走 _playLines），不会再读中文', async () => {
    const m = loadViewWithHandlers();
    clickPlay(m.handlers.find(h => h.sel === '[data-act]'));
    await sleep(40);
    assert.ok(m.spoken.some(x => String(x.text).startsWith('EN-LINES')), '应走英文原文播放：' + JSON.stringify(m.spoken));
    assert.ok(!m.spoken.some(x => x.lang === 'zh-CN'), '不得再朗读中文：' + JSON.stringify(m.spoken));
  });

  await check('★ 句旁「播放（复现）」：读该句英文，且不会抛错', async () => {
    const m = loadViewWithHandlers();
    const say = m.handlers.find(h => h.sel === '[data-say]');
    assert.ok(say, '应有 [data-say] 复现处理器');
    assert.doesNotThrow(() => say.fn({}, { dataset: { say: SENTS[0].en }, closest: () => m.lineEl }));
    await sleep(20);
    assert.ok(m.spoken.some(x => x.text === SENTS[0].en), '应朗读该句英文：' + JSON.stringify(m.spoken));
    assert.ok(m.statusEl._history.some(h => /复现/.test(h)), '状态行应提示正在复现');
  });

  await check('卡片写清"本句音色"：本地机器声时给出「改用云端音色」一键入口', () => {
    const mk = (speech) => {
      const el = { innerHTML: '' };
      const ctx = vm.createContext({
        window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        App: { toast() {}, freshNode: () => null },
        $: sel => (sel === '#voiceNow' ? el : null),
        $$: () => [], esc: v => String(v == null ? '' : v), on: () => {},
        Store: { d: { settings: {} }, flush() {} },
        AI: { ready: false },
        Dict: { content: { listening: { sentences: SENTS, dialogues: [], passages: [] } } },
        Speech: speech,
      });
      ctx.window = ctx;
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8'), ctx);
      ctx.window.ViewListen._paintVoiceNow({});
      return el.innerHTML;
    };
    const local = mk({ list: () => [{ name: 'Aria Online', localService: false }], _isCloud: () => true,
      previewVoice: () => ({ name: 'Microsoft Hazel - English (United Kingdom)', cloud: false, source: '听力女声设置' }) });
    assert.ok(/Microsoft Hazel/.test(local) && /本地音色·机器声/.test(local), '要写明音色与"机器声"：' + local);
    assert.ok(/data-act="cloudVoice"/.test(local), '本地音色时必须给一键改用云端');
    const cloud = mk({ list: () => [{ name: 'Aria Online', localService: false }], _isCloud: () => true,
      previewVoice: () => ({ name: 'Microsoft Aria Online (Natural)', cloud: true, source: '自动（优先云端神经音色）' }) });
    assert.ok(/云端神经音色/.test(cloud) && !/cloudVoice/.test(cloud), '已是云端就不需要按钮');
  });

  await check('单句播放不再走"考场顺序"（原来读完会弹"没有题目数据"）', () => {
    const view = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/const playSentence = /.test(view), '应有单句专用播放函数');
    assert.ok(/this\.kind === 'sentence'\s*\n\s*\? playSentence\(\w*\)/.test(view), 'play 分支必须把单句分流到 playSentence()');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项单句听力检查通过');
})();
