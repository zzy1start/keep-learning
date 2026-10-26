/* ============ check-listening-fixes.cjs : 听力四项修复回归 ============
 * A 写模式模糊题干时保留题号（.qt-no 清晰 / .q-stem 模糊）
 * B 六级/导入卷 explain 为空：正确答案兜底 + AI 整篇补全 + Store.d 缓存 + 静默降级
 * C 补原文弹窗「联网抓取」：extractArticleText 纯函数 + URL 校验 + 10s 超时 + 失败原因
 * D 说话人识别失败兜底：对话类按轮次交替男女声，独白保持全篇同一音色
 *
 * 运行：node tools/check-listening-fixes.cjs
 * 说明：listening.js 依赖 DOM；这里用 node:vm + 最小 stub 加载（参考
 *       check-listening-exam / check-listening-speakers 的做法），
 *       结构相关的断言用源码/真实 CSS 检查，逻辑相关的直接跑纯函数。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/modules.css'), 'utf8');

let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function makeCard() {
  return {
    innerHTML: '',
    addEventListener() {},
    contains() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeView(opts) {
  opts = opts || {};
  const bank = { toast: [], ai: [], fetch: [] };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Promise, Object, Array, String, Number, JSON,
    Math, Date, RegExp, Error, URL, AbortController,
    window: {},
    document: { querySelector: () => null, getElementById: () => null, querySelectorAll: () => [] },
    Store: {
      d: { settings: { speechRate: 1, listenLeadIn: 2 } },
      flush() {}, addStat() {}, logActivity() {},
    },
    App: {
      toast(m, t) { bank.toast.push([m, t]); },
      modal() {}, closeModal() {}, freshNode: () => null,
    },
    Speech: { voices: [], stop() {}, speak() {}, prefetch() {}, _forceGender: '', gender: 'female' },
    $: () => null, $$: () => [], on: () => {},
    esc: esc,
    AI: opts.ai || { ready: false },
  });
  ctx.fetch = opts.fetch || (() => Promise.reject(new Error('fetch not stubbed')));
  vm.runInContext(SRC, ctx);
  const view = ctx.window.ViewListen;
  view.mode = 'read';
  view.shown = [];
  return { ctx: ctx, view: view, bank: bank, fn: name => vm.runInContext(name, ctx) };
}

function stubAI(impl) {
  const ai = {
    ready: true, calls: [],
    json: async function () { ai.calls.push({ kind: 'json' }); return impl.apply(null, arguments); },
    jsonRetry: async function () { ai.calls.push({ kind: 'jsonRetry' }); return impl.apply(null, arguments); },
  };
  return ai;
}

(async () => {
  /* ---------------- A. 题号保留 ---------------- */
  await check('A1. 写模式：题号包 .qt-no 保持清晰，题干只包 .q-stem 被模糊', () => {
    const m = makeView();
    m.view.mode = 'write';
    m.view.submitted = false;
    m.view.shown = [{ id: 'p-a1', type: 'cet6', title: 'The Rise of Online Learning' }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    const qs = [{ q: 'What is the main purpose of the talk?', opts: ['A1', 'B1', 'C1', 'D1'], a: 2 }];
    m.view._renderQuiz({}, qs, 'p-a1');
    assert.ok(card, '_renderQuiz 应拿到答题卡');
    assert.ok(/class="qt-no">1\.<\/span>/.test(card.innerHTML), '题号应包在 .qt-no：' + card.innerHTML.slice(0, 300));
    assert.ok(/class="q-stem">/.test(card.innerHTML), '题干应包在 .q-stem');
    assert.ok(/listen-quiz-question-hidden/.test(card.innerHTML), '写模式默认应隐藏题干');
    assert.ok(card.innerHTML.indexOf('What is the main purpose of the talk?') >= 0, '题干文本不能丢失');
    assert.ok(CHECK_CSS(), 'CSS 规则不符合预期');
    function CHECK_CSS() {
      return CSS.indexOf('.listen-quiz-question-hidden .q-stem{filter:blur') >= 0
        && !/\.listen-quiz-question-hidden \.qt\{filter/.test(CSS)
        && /\.q-item \.qt \.qt-no\{/.test(CSS);
    }
  });

  await check('A2. 题干缺失时占位仍在 .q-stem 内，题号依旧清晰', () => {
    const m = makeView();
    m.view.mode = 'write';
    m.view.shown = [{ id: 'p-a2', type: 'cet6', title: 'Questions 1 to 3' }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    m.view._renderQuiz({}, [{ q: 'Question 2', opts: ['a', 'b', 'c', 'd'], a: 0 }], 'p-a2');
    assert.ok(/class="qt-no">2\.<\/span>/.test(card.innerHTML), '题号 2 应清晰可见：' + card.innerHTML.slice(0, 300));
    assert.ok(/class="q-stem"><span class="q-missing">/.test(card.innerHTML), '缺题干占位应位于 .q-stem 内');
  });

  /* ---------------- B. 空解析兜底 + AI 补全 ---------------- */
  await check('B1. 兜底 HTML：至少显示「正确答案：B. 选项原文」且转义', () => {
    const m = makeView();
    const fallback = m.fn('listenExplainFallbackHTML');
    const html = fallback({ opts: ['Alpha', 'Bravo', 'Charlie'], a: 1 }, '解析暂缺，已显示正确答案');
    assert.ok(html.indexOf('正确答案：B. Bravo') >= 0, '实际：' + html);
    assert.ok(html.indexOf('解析暂缺，已显示正确答案') >= 0, '应有轻提示');
    assert.ok(html.indexOf('lsn-explain-fallback') >= 0, '应有兜底样式类');
    const html2 = fallback({ opts: ['<x>', 'B'], a: 0 });
    assert.ok(html2.indexOf('&lt;x&gt;') >= 0, '选项必须转义：' + html2);
  });

  await check('B2. 提交后 explain 为空：不再渲染空“解析”框，改显示正确答案', () => {
    const m = makeView();
    m.view.submitted = true;
    m.view.shown = [{ id: 'p-b2', type: 'cet6', title: 'X', script: [{ en: 'A script line.' }] }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    const qs = [{ q: 'Q1?', opts: ['Alpha', 'Bravo', 'Charlie'], a: 1 }];
    m.view._renderQuiz({}, qs, 'p-b2');
    assert.ok(card.innerHTML.indexOf('正确答案：B. Bravo') >= 0, '应显示正确答案：' + card.innerHTML.slice(0, 500));
    assert.ok(card.innerHTML.indexOf('lsn-explain-fallback') >= 0, '应使用兜底框');
    assert.ok(!/<b>解析<\/b>　<\/div>/.test(card.innerHTML), '不应再出现空的解析蓝框');
    assert.ok(card.innerHTML.indexOf('解析暂缺，已显示正确答案') >= 0, '未配置 AI 应显示轻提示');
    assert.equal(m.bank.toast.length, 1, '未配置 AI 时给一次轻提示，实际 ' + m.bank.toast.length);
    m.view._renderQuiz({}, qs, 'p-b2');
    assert.equal(m.bank.toast.length, 1, '同一篇不应重复提示');
  });

  await check('B3. CET4 已有 explain/evidence 行为不变（不调 AI、不加兜底框）', () => {
    const ai = stubAI(() => ({ items: [] }));
    const m = makeView({ ai: ai });
    m.view.submitted = true;
    m.view.shown = [{ id: 'p-b3', type: 'cet4', title: 'Volunteer', script: [{ en: 'I can drive the truck.' }] }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    const qs = [{ q: 'What?', opts: ['Pick supplies', 'Drive the truck', 'Train', 'Supervise'], a: 1, explain: '男子说自己会开卡车。', evidence: 'I can drive the truck.' }];
    m.view._renderQuiz({}, qs, 'p-b3');
    assert.ok(card.innerHTML.indexOf('男子说自己会开卡车。') >= 0, '原解析应保留');
    assert.ok(card.innerHTML.indexOf('原文依据：I can drive the truck.') >= 0, '原 evidence 应保留');
    assert.ok(card.innerHTML.indexOf('lsn-explain-fallback') < 0, '有解析时不应出现兜底框');
    assert.equal(ai.calls.length, 0, '已有解析时不应调用 AI');
  });

  await check('B4. Store.d.lsnExplain[passId] 缓存会在提交后渲染', () => {
    const m = makeView();
    m.ctx.Store.d.lsnExplain = { 'p-b4': { 0: { explain: '缓存里的解析', evidence: 'Cached original sentence.' } } };
    m.view.submitted = true;
    m.view.shown = [{ id: 'p-b4', type: 'cet6', title: 'Cached', script: [{ en: 'Cached original sentence.' }] }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    m.view._renderQuiz({}, [{ q: 'Q?', opts: ['a', 'b'], a: 0 }], 'p-b4');
    assert.ok(card.innerHTML.indexOf('缓存里的解析') >= 0, '缓存解析应被渲染：' + card.innerHTML.slice(0, 400));
    assert.ok(card.innerHTML.indexOf('原文依据：Cached original sentence.') >= 0, '缓存 evidence 应渲染');
  });

  await check('B5. AI 一次补全整篇：写缓存、evidence 必须来自原文、不重复花钱', async () => {
    const ai = stubAI(() => ({
      items: [
        { i: 0, explain: '第一题解析', evidence: 'This is the original sentence.' },
        { i: 1, explain: '第二题解析', evidence: 'This sentence was never in the script.' },
      ],
    }));
    const m = makeView({ ai: ai });
    const p = {
      id: 'p-b5', type: 'cet6', title: 'AI Fill',
      script: [{ en: 'This is the original sentence.' }, { en: 'This is another line.' }],
    };
    m.view.shown = [p];
    m.view.piPass = 0;
    m.view.submitted = true;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    const qs = [{ q: 'Q1?', opts: ['a', 'b'], a: 0 }, { q: 'Q2?', opts: ['a', 'b'], a: 1 }];
    m.view._renderQuiz({}, qs, 'p-b5');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(ai.calls.length, 1, '整篇应只请求一次，实际 ' + ai.calls.length);
    const saved = m.ctx.Store.d.lsnExplain && m.ctx.Store.d.lsnExplain['p-b5'];
    assert.ok(saved && saved[0] && saved[0].explain === '第一题解析', '应写入第一题解析');
    assert.equal(saved[0].evidence, 'This is the original sentence.', '原文原句应保留');
    assert.equal(saved[1].evidence, '', '编造的 evidence 必须丢弃');
    m.view._renderQuiz({}, qs, 'p-b5');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(ai.calls.length, 1, '已有缓存/已尝试后不应再次请求');
    assert.ok(card.innerHTML.indexOf('第一题解析') >= 0, '重渲染后应显示 AI 解析');
  });

  await check('B6. AI 失败：静默降级为正确答案、不再重试、不阻塞得分', async () => {
    const ai = stubAI(() => { throw new Error('network down'); });
    const m = makeView({ ai: ai });
    m.view.submitted = true;
    m.view.shown = [{ id: 'p-b6', type: 'cet6', title: 'Fail', script: [{ en: 'Some script.' }] }];
    m.view.piPass = 0;
    let card = null;
    m.ctx.App.freshNode = () => (card = makeCard());
    const qs = [{ q: 'Q?', opts: ['Alpha', 'Bravo'], a: 1 }];
    m.view._renderQuiz({}, qs, 'p-b6');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(ai.calls.length, 1, '失败后应只尝试一次');
    assert.equal(m.view._explainFailed['p-b6'], true, '应记录失败状态');
    m.view._renderQuiz({}, qs, 'p-b6');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(ai.calls.length, 1, '失败后重渲染不应重复请求');
    assert.ok(card.innerHTML.indexOf('解析暂缺，已显示正确答案') >= 0, '应显示轻提示');
    assert.ok(card.innerHTML.indexOf('正确答案：B. Bravo') >= 0, '应显示正确答案');
    assert.ok(card.innerHTML.indexOf('得分 ') >= 0, '得分仍应正常显示');
  });

  await check('B7. 源码接线：提交后不阻塞地补解析，缓存键为 passId', () => {
    assert.ok(/if \(this\.submitted\) this\._ensureMissingExplains\(p, qs, explains\);/.test(SRC), '提交后应触发补解析');
    assert.ok(/Store\.d\.lsnExplain/.test(SRC), '应有 Store.d.lsnExplain 持久缓存');
    assert.ok(/AI\.jsonRetry\(/.test(SRC), '应使用 AI.jsonRetry');
    assert.ok(/listenExplainFallbackHTML\(q, explainNote\)/.test(SRC), '空解析应走兜底 HTML');
  });

  /* ---------------- C. 联网抓取 ---------------- */
  await check('C1. extractArticleText：去 script/style/标签、解实体、压空白', () => {
    const m = makeView();
    const extract = m.fn('extractArticleText');
    const html = '<html><head><title>T</title><style>.x{color:red}</style></head><body>'
      + '<script>var secret = "<p>do not read</p>";</script>'
      + '<h1>Conversation One</h1><p>Hello &amp; welcome&nbsp;to <b>the</b> show.</p>'
      + '<div>Second<br>line</div><p>&#8220;Quoted&#8221; &#x4E2D;文</p></body></html>';
    const text = extract(html);
    assert.ok(text.indexOf('Conversation One') >= 0, '应保留正文标题：' + text);
    assert.ok(text.indexOf('Hello & welcome to the show.') >= 0, '实体/标签处理不符：' + text);
    assert.ok(text.indexOf('Second\nline') >= 0, 'br 应转换成换行：' + text);
    assert.ok(text.indexOf('secret') < 0 && text.indexOf('do not read') < 0, 'script 内容必须删除');
    assert.ok(text.indexOf('color:red') < 0, 'style 内容必须删除');
    assert.ok(text.indexOf('“Quoted” 中文') >= 0, '实体解码不符：' + text);
    assert.ok(text.indexOf('<') < 0, '不应残留标签：' + text);
  });

  await check('C2. extractArticleText：未闭合 script 也不会把 JS 当正文', () => {
    const m = makeView();
    const text = m.fn('extractArticleText')('<p>Keep this sentence.</p><script>var x = 1;');
    assert.ok(text.indexOf('Keep this sentence.') >= 0, '正文应保留：' + text);
    assert.ok(text.indexOf('var x') < 0, '未闭合 script 也必须整段删除');
  });

  await check('C3. 抓取实现不依赖 DOMParser；有 10 秒超时与 http/https 限制', () => {
    assert.ok(!/new\s+DOMParser|DOMParser\s*\(|parseFromString/.test(SRC), '不能使用 DOMParser（Node 自检要能跑）');
    assert.ok(/function extractArticleText\(html\)/.test(SRC), '应有纯函数 extractArticleText');
    assert.ok(/10 秒超时/.test(SRC) && /10000/.test(SRC), '应有 10 秒超时');
    assert.ok(/只支持 http\/https/.test(SRC), '只允许 http/https');
  });

  await check('C4. 抓取成功：填入 textarea、显示字符数、不自动调 AI', async () => {
    const ai = stubAI(() => ({}));
    const body = 'This is the listening tapescript. '.repeat(6);
    const m = makeView({
      ai: ai,
      fetch: async () => ({
        ok: true, status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><body><p>' + body + '</p></body></html>',
      }),
    });
    const ta = { value: '' };
    const msg = { innerHTML: '' };
    const btn = { disabled: false, textContent: '联网抓取' };
    await m.view._fetchTranscriptUrl('https://example.com/tapescript', ta, msg, btn);
    assert.ok(ta.value.indexOf('This is the listening tapescript.') >= 0, '应填入正文：' + ta.value.slice(0, 120));
    assert.ok(/已抓取 \d+ 字符/.test(msg.innerHTML), '应显示字符数：' + msg.innerHTML);
    assert.equal(btn.disabled, false, '成功后按钮应恢复');
    assert.equal(ai.calls.length, 0, '抓取后不能自动提交 AI');
  });

  await check('C5. 非 http/https 直接拒绝，不发请求', async () => {
    let fetched = 0;
    const m = makeView({ fetch: async () => { fetched++; throw new Error('should not fetch'); } });
    const msg = { innerHTML: '' };
    const btn = { disabled: false, textContent: '联网抓取' };
    await m.view._fetchTranscriptUrl('ftp://example.com/a.txt', { value: '' }, msg, btn);
    assert.equal(fetched, 0, '非 http/https 不应发请求');
    assert.ok(/只支持 http\/https/.test(msg.innerHTML), '应说明只支持 http/https：' + msg.innerHTML);
  });

  await check('C6. 非 HTML 响应给出具体原因', async () => {
    const m = makeView({
      fetch: async () => ({
        ok: true, status: 200,
        headers: { get: () => 'application/pdf' },
        text: async () => '%PDF-1.7',
      }),
    });
    const msg = { innerHTML: '' };
    await m.view._fetchTranscriptUrl('https://example.com/a.pdf', { value: '' }, msg, { disabled: false, textContent: '联网抓取' });
    assert.ok(/返回的不是网页/.test(msg.innerHTML), '应提示非 HTML：' + msg.innerHTML);
    assert.ok(/application\/pdf/.test(msg.innerHTML), '应给出实际类型：' + msg.innerHTML);
  });

  await check('C7. 网络/CORS 失败给出可操作提示', async () => {
    const m = makeView({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const msg = { innerHTML: '' };
    await m.view._fetchTranscriptUrl('https://example.com/a.html', { value: '' }, msg, { disabled: false, textContent: '联网抓取' });
    assert.ok(/网络请求失败/.test(msg.innerHTML), '应提示网络失败：' + msg.innerHTML);
    assert.ok(/跨域\/CORS/.test(msg.innerHTML), '应提到跨域/CORS：' + msg.innerHTML);
  });

  await check('C8. 站点 HTTP 错误给出状态码，按钮恢复可重试', async () => {
    const m = makeView({
      fetch: async () => ({ ok: false, status: 403, headers: { get: () => 'text/html' }, text: async () => '' }),
    });
    const msg = { innerHTML: '' };
    const btn = { disabled: false, textContent: '联网抓取' };
    await m.view._fetchTranscriptUrl('https://example.com/a.html', { value: '' }, msg, btn);
    assert.ok(/HTTP 403/.test(msg.innerHTML), '应给出状态码：' + msg.innerHTML);
    assert.equal(btn.disabled, false, '失败后按钮应恢复');
  });

  await check('C9. 弹窗有 URL 输入 + 联网抓取按钮，抓取后走现有 AI 审核', () => {
    assert.ok(/id="fillUrl"/.test(SRC), '弹窗应有 URL 输入框');
    assert.ok(/id="fillFetch"/.test(SRC), '弹窗应有「联网抓取」按钮');
    assert.ok(/this\._fetchTranscriptUrl\(urlInp/.test(SRC), '按钮应调用 _fetchTranscriptUrl');
    assert.ok(/再点「AI 审核并补入」/.test(SRC), '应提示用户确认后再点现有 AI 审核');
  });

  /* ---------------- D. 说话人兜底 ---------------- */
  await check('D1. 对话类判定：conversation/dialogue/长对话/对话 → true；独白 → false', () => {
    const isDlg = makeView().fn('isDialogueMaterial');
    assert.equal(isDlg({ type: 'cet6', genre: '长对话' }), true);
    assert.equal(isDlg({ title: 'Conversation 1' }), true);
    assert.equal(isDlg({ type: 'dialogue' }), true);
    assert.equal(isDlg({ title: 'Questions 1 to 8' }, '长对话'), true);
    assert.equal(isDlg({ type: 'cet6', genre: '教育科技', title: 'The Rise of Online Learning' }), false);
    assert.equal(isDlg(null), false);
    assert.equal(isDlg({}), false);
  });

  await check('D2. 交替分配：奇数行男声、偶数行女声', () => {
    const alt = makeView().fn('alternateGenders');
    assert.equal(Array.from(alt(5)).join(','), 'male,female,male,female,male');
    assert.equal(Array.from(alt(0)).length, 0);
    const arr = alt(3);
    assert.equal(arr[0], 'male', '第 1 行应为男声');
    assert.equal(arr[1], 'female', '第 2 行应为女声');
  });

  await check('D3. AI 未配置 + 对话类 → 交替男女声；独白保持同一音色', async () => {
    const m = makeView({ ai: { ready: false } });
    const lines = [{ text: 'Hello, how are you?' }, { text: 'Fine, thanks.' }, { text: 'Shall we start?' }];
    const info = await m.view.detectGenders(lines, { type: 'cet6', title: 'Section A Listening Comprehension' });
    assert.ok(/自动交替男女声/.test(info), '对话类应交替兜底：' + info);
    assert.equal(Array.from(m.view._spGender).join(','), 'male,female,male');
    const m2 = makeView({ ai: { ready: false } });
    const monoLines = [{ text: 'Many people enjoy reading.' }, { text: 'It helps them relax.' }];
    const info2 = await m2.view.detectGenders(monoLines, { type: 'cet6', genre: '教育科技', title: 'The Rise of Online Learning' });
    assert.equal(m2.view._spGender, null, '独白不应逐行指定性别');
    assert.ok(/同一个音色/.test(info2), '独白应保持全篇同一音色：' + info2);
  });

  await check('D4. AI 识别失败 + 对话类 → 交替兜底；独白按独白口径（不再报"说话人识别失败"）', async () => {
    const boom = () => { throw new Error('boom'); };
    const m = makeView({ ai: stubAI(boom) });
    const info = await m.view.detectGenders([{ text: 'Hello?' }, { text: 'Hi.' }], { title: 'Conversation One' });
    assert.ok(/自动交替男女声/.test(info), '对话类失败应交替兜底：' + info);
    assert.equal(Array.from(m.view._spGender).join(','), 'male,female');
    const m2 = makeView({ ai: stubAI(boom) });
    const info2 = await m2.view.detectGenders([{ text: 'A lecture line.' }], { title: 'Lecture on Cities', genre: '讲座' });
    assert.equal(m2.view._spGender, null);
    assert.ok(!/说话人识别失败/.test(info2), '独白不应再显示"说话人识别失败"（用户会以为功能坏了）：' + info2);
    assert.ok(/独白|同一个音色/.test(info2), '独白应说明全篇同一音色：' + info2);
  });

  await check('D5. AI 把对话类误判成独白 → 仍交替兜底', async () => {
    const m = makeView({ ai: stubAI(() => ({ genders: ['female', 'male'], label: '独白' })) });
    const info = await m.view.detectGenders([{ text: 'A?' }, { text: 'B.' }], { title: 'Conversation Two' });
    assert.ok(/自动交替男女声/.test(info), '应交替兜底：' + info);
    assert.equal(Array.from(m.view._spGender).join(','), 'male,female');
  });

  await check('D6. AI 正常识别成对话时仍采用 AI 的逐行性别（不回归）', async () => {
    const m = makeView({ ai: stubAI(() => ({ genders: ['female', 'male', 'female'], label: '男女对话' })) });
    const info = await m.view.detectGenders([{ text: 'A?' }, { text: 'B.' }, { text: 'C?' }], { title: 'Conversation Three' });
    assert.ok(/AI 识别/.test(info), '应标注 AI 识别：' + info);
    assert.equal(Array.from(m.view._spGender).join(','), 'female,male,female');
  });

  await check('D7. 源码接线：_passage/_dialogue 把篇目类型传给 detectGenders', () => {
    assert.ok(/this\.detectGenders\(lines, p\)/.test(SRC), '_passage 应把 p 传给 detectGenders');
    assert.ok(/this\.detectGenders\(turns, \{ type: d\.type, title: d\.title, genre: d\.genre \}\)/.test(SRC),
      '_dialogue 应把对话类型/标题传给 detectGenders');
  });

  if (failed) {
    console.log('\n' + failed + ' 项失败 / ' + (passed + failed) + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n全部 ' + passed + ' 项听力四项修复检查通过');
  }
})().catch(e => {
  console.error('FAIL (uncaught): ' + (e && e.stack || e));
  process.exitCode = 1;
});
