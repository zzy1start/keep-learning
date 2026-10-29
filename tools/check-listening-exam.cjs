/* ============ check-listening-exam.cjs : 听力按考场顺序播放（原文→逐题题干） ============ */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.log('FAIL ' + name + ': ' + (e && e.message)); failed++; }
}

function makeView(stub) {
  const calls = [];
  const boxes = (stub && stub.inBox) || [];
  const globals = (stub && stub.global) || [];
  const ctx = vm.createContext({
    window: { speechSynthesis: { speak() {}, cancel() {}, speaking: false, pending: false } },
    console, setTimeout, clearTimeout,
    // 视图对象挂在 window 上（listening.js 末尾：window.ViewListen = ViewListen）
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    App: { toast() {}, freshNode: () => null },
    $: () => null, esc: v => String(v == null ? '' : v),
    // $$(sel, root) 的真实语义：root.querySelectorAll(sel)，root 默认 document
    $$: (sel, root) => {
      if (sel === '.w') return (root && root.__words) || [];
      if (stub && stub.lines) return stub.lines;
      return root ? boxes : globals;
    },
    Store: { d: { settings: { speechRate: 1, listenLeadIn: 2 } } },
    AI: { ready: false },   // 未配置 AI：detectGenders 走"未标注 → 全篇同一音色"分支
    Speech: { voices: ['test-voice'], primeAudio() {}, chime() { calls.push(['chime']); return Promise.resolve(true); },
      hasLang: pre => (stub && stub.hasLang != null ? stub.hasLang : pre === 'zh'),
      // ② lookahead 预推理：记录预取调用（真实实现是 Kokoro 的预合成，这里只看"何时预取谁"）
      prefetch(t, o) { calls.push(['prefetch', t, o && o.rate, o && o.gender]); },
      speak(t, o) { calls.push(['q', t, o && o.lang]); if (o && o.onend) setTimeout(o.onend, 1); } },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8'), ctx);
  const view = ctx.window.ViewListen;
  view.playing = false;
  view._playAbort = false;
  view._playLinesReal = view._playLines;   // 保留真实现：本次"只读原文"的根因只能用真的测出来
  view._playLines = async (ls, o) => { calls.push(['src', ls.map(x => x.text).join(' | '), o && o.rate]); };
  return { view: view, calls: calls, speech: ctx.Speech };
}

const stems = qs => qs.map((q, i) => ({
  textContent: (i + 1) + '. ' + q,
  classList: { add() {}, remove() {} },
}));

(async () => {
  await check('顺序：先原文，再按题号逐题读题干', async () => {
    const m = makeView();
    await m.view._playExamOrder(
      [{ text: 'Online learning has grown rapidly.' }, { text: 'It changes how we study.' }],
      stems(['What is the talk mainly about?', 'Why does the speaker mention surveys?']),
      { rate: 1, gapMs: 5, chime: false, endSay: false }
    );
    const seq = m.calls.map(c => c[0] + (c[0] === 'src' ? ':' + c[1] : ':' + c[1]));
    assert.equal(m.calls[0][0], 'src', '第一步必须是原文');
    assert.equal(m.calls[1][0], 'q', '原文之后必须是题干');
    assert.equal(m.calls[1][1], 'Question 1. What is the talk mainly about?', '实际 ' + m.calls[1][1]);
    assert.equal(m.calls[2][1], 'Question 2. Why does the speaker mention surveys?');
    assert.equal(m.calls.length, 3, '原文 1 次 + 题干 2 次，实际 ' + JSON.stringify(seq));
  });

  await check('题干自带编号会被去掉（不读成 Question 1. 1. …）', async () => {
    const m = makeView();
    await m.view._playExamOrder([{ text: 'A.' }], [{ textContent: '3、  What does the man suggest?', classList: { add() {}, remove() {} } }], { gapMs: 0, chime: false });
    assert.equal(m.calls[1][1], 'Question 1. What does the man suggest?', '实际 ' + m.calls[1][1]);
  });

  await check('没有题目的材料（单句/对话）只播原文，行为不变', async () => {
    const m = makeView();
    await m.view._playExamOrder([{ text: 'Excuse me.' }], [], { gapMs: 0, chime: false });
    assert.equal(m.calls.length, 1, '不该读任何题干');
    assert.equal(m.calls[0][0], 'src');
  });

  await check('中途停止：不再继续读后面的题干', async () => {
    const m = makeView();
    const st = stems(['One?', 'Two?', 'Three?']);
    const p = m.view._playExamOrder([{ text: 'A.' }], st, { gapMs: 30, chime: false });
    await new Promise(r => setTimeout(r, 12));
    m.view._playAbort = true;
    await p;
    assert.ok(m.calls.filter(c => c[0] === 'q').length < 3, '停止后不该把 3 道题都读完');
  });

  await check('真实题库：六级篇目 6 题按题号顺序读出', async () => {
    const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content/listening.json'), 'utf8'));
    const p = (L.passages || []).find(x => x.type === 'cet6' && x.qs && x.qs.length);
    assert.ok(p, '找不到六级篇目，题库结构可能变了');
    const m = makeView();
    await m.view._playExamOrder((p.script || []).map(x => ({ text: x.en })), stems(p.qs.map(q => q.q)), { gapMs: 0, chime: false, endSay: false });
    const qs = m.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(qs.length, p.qs.length, '题干数量应与题库一致');
    assert.ok(qs[0].indexOf('Question 1. ' + p.qs[0].q) === 0, '第一题题干不符：' + qs[0]);
    assert.ok(/^Question 6\. /.test(qs[5]), '第六题应以 Question 6. 开头：' + qs[5]);
    assert.equal(m.calls[0][0], 'src', '原文必须在题干之前');
  });

  await check('主播放按钮走考试顺序（防止回退成只读原文）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/\.q-item \.qt/.test(src), '题干应从答题卡读取（.q-item .qt）');
    const playCase = src.slice(src.indexOf("case 'play': case 'playDlg'"));
    assert.ok(/playExam\(\{\s*rate: rate\(\)/.test(playCase.slice(0, 800)), '主播放按钮必须调用 playExam');
  });

  await check('题干必须“点击时”取：_bindCommon 早于 _renderQuiz，快照会是空的', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    // 根因：渲染顺序决定绑定时题干 DOM 还不存在
    const iBind = src.indexOf('this._bindCommon(box, lines.map(l => l.en).join');
    const iQuiz = src.indexOf('this._renderQuiz(box, p.qs, p.id)');
    assert.ok(iBind > 0 && iQuiz > iBind, '_bindCommon 应早于 _renderQuiz（这正是快照为空的原因）');
    assert.ok(/this\._playExamOrder\(linesNow\(\), stemsNow\(\),/.test(src),
      '播放时必须实时取原文（linesNow()）与题干（stemsNow()），不能把快照成常量');
    assert.ok(/const stemsNow = \(\) => \{/.test(src) && /this\._quizStems\(box\)/.test(src),
      'stemsNow 应实时查 DOM（并以题库数据兜底）');
    assert.ok(!/const stems = \$\$\('#quizCard/.test(src), '不该再出现题干快照');
    assert.ok(/_quizStems\(box\) \{/.test(src), '应有 _quizStems 方法');
  });

  await check('播放状态行：原文 → 逐题题干 → 留白 → 完成，全程可见', async () => {
    const m = makeView();
    const st = [];
    await m.view._playExamOrder([{ text: 'A.' }], stems(['One?', 'Two?']),
      { gapMs: 5, chimeBeforeMs: 1, chimeAfterMs: 1, endSay: false, status: t => st.push(t) });
    assert.ok(/正在播报原文/.test(st[0]), '第一步应汇报原文：' + st[0]);
    assert.ok(st.some(t => /第 1\/2 题题干/.test(t)), '应汇报第 1 题：' + JSON.stringify(st));
    assert.ok(st.some(t => /第 2\/2 题题干/.test(t)), '应汇报第 2 题');
    assert.ok(st.some(t => /留白 0 秒/.test(t)) || st.some(t => /留白/.test(t)), '应汇报留白');
    assert.ok(/播放完成/.test(st[st.length - 1]), '最后应汇报完成：' + st[st.length - 1]);
  });

  await check('没有题干时不再静默：状态行明确提示（这正是“只读原文”的可见症状）', async () => {
    const m = makeView();
    const st = [];
    await m.view._playExamOrder([{ text: 'A.' }], [], { gapMs: 0, chime: false, status: t => st.push(t) });
    assert.ok(st.some(t => /没有找到题干/.test(t)), '必须明确提示没有题干：' + JSON.stringify(st));
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/dataStems/.test(src) && /stemsNow/.test(src), '题干应有题库数据兜底（不再只依赖 DOM）');
    assert.ok(/_bindCommon\(box, lines\.map\(l => l\.en\)\.join\(' '\), p\)/.test(src), '应把题目数据 p 传给 _bindCommon');
    assert.ok(/id="playStatus"/.test(src), '播放区应有状态行元素');
  });

  await check('节奏：原文 → 2.5s → 叮咚 → 2.5s → 题干（提示音夹在中间）', async () => {
    const m = makeView();
    const st = [];
    const t0 = Date.now();
    await m.view._playExamOrder([{ text: 'A.' }], stems(['One?']),
      { gapMs: 0, chimeBeforeMs: 120, chimeAfterMs: 120, status: t => st.push(t) });
    const order = m.calls.map(c => c[0]);
    assert.equal(order[0], 'src', '先原文');
    assert.equal(order[1], 'chime', '原文之后必须是叮咚，实际 ' + JSON.stringify(order));
    assert.equal(order[2], 'q', '叮咚之后才是题干');
    assert.ok(Date.now() - t0 >= 240, '提示音前后各留一段间隔（约 2.5s + 2.5s）');
    assert.ok(st.some(t => /提示音/.test(t)), '状态行应显示提示音阶段：' + JSON.stringify(st));
  });

  await check('提示音默认 2.5 秒 + 2.5 秒，可关闭', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/o\.chimeBeforeMs == null \? 2500/.test(src), '原文后默认 2500ms');
    assert.ok(/o\.chimeAfterMs == null \? 2500/.test(src), '叮咚后默认 2500ms');
    assert.ok(/Speech\.primeAudio\(\)/.test(src), '点击时应预热音频上下文（否则提示音播不出来）');
    assert.ok(/id="examChime"/.test(src), '页面应有「叮咚提示音」开关');
    assert.ok(/listenChime: true/.test(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8')), '设置默认开启');
    const off = makeView();
    await off.view._playExamOrder([{ text: 'A.' }], stems(['One?']), { gapMs: 0, chime: false });
    assert.equal(off.calls.filter(c => c[0] === 'chime').length, 0, '关闭后不应有提示音');
    assert.equal(off.calls[1][0], 'q', '关闭后原文直接接题干');
  });

  await check('题干播报回调 + 页面发音诊断（无法听声也能看出走到哪一步）', async () => {
    const m = makeView();
    const seen = [];
    await m.view._playExamOrder([{ text: 'A.' }], stems(['One?', 'Two?']),
      { gapMs: 0, chime: false, question: (n, total, body) => seen.push([n, total, body]) });
    assert.equal(seen.length, 2, '每道题都应回调一次，实际 ' + JSON.stringify(seen));
    assert.deepStrictEqual(seen[0], [1, 2, 'One?']);
    assert.deepStrictEqual(seen[1], [2, 2, 'Two?']);
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/id="diagBtn"/.test(src), '应有发音诊断按钮');
    assert.ok(/Speech\.diag/.test(src), '诊断面板应读取 Speech.diag（现成的朗读日志）');
    assert.ok(/id="qNow"/.test(src), '应有当前题干大字元素');
    assert.ok(/question: \(n, total, body\)/.test(src), '播放时应把当前题干写到页面上');
  });

  await check('★ 带 leadIn 时 _playLines 必须 resolve（本次"只读原文"的根因）', async () => {
    const words = [{ textContent: 'Hello', classList: { add() {}, remove() {} } },
      { textContent: 'world', classList: { add() {}, remove() {} } }];
    const lineEl = {
      classList: { add() {}, remove() {} }, textContent: 'Hello world.', dataset: { say: 'Hello world.' },
      getBoundingClientRect: () => ({ top: 0, bottom: 0 }), __words: words,
    };
    const withLead = makeView({ lines: [lineEl] });
    const p1 = withLead.view._playLinesReal([{ text: 'Hello world.' }], { leadIn: 10, rate: 1 });
    const r1 = await Promise.race([p1.then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('timeout'), 2000))]);
    assert.equal(r1, 'resolved', '带 leadIn 的 _playLines 永不 resolve → 调用方卡死，题干/叮咚都不会执行');
    // 必须在**整篇**读完后才 resolve：否则叮咚/题干会提前启动，和剩下的原文抢语音队列
    const two = makeView({ lines: [lineEl, lineEl] });
    await two.view._playLinesReal([{ text: 'Hello world.' }, { text: 'Good bye.' }], { leadIn: 10, rate: 1 });
    assert.equal(two.calls.filter(c => c[0] === 'q').length, 2,
      '_playLines 应等到两句话都读完才 resolve，实际只读了 ' + two.calls.filter(c => c[0] === 'q').length + ' 句');
    const noLead = makeView({ lines: [lineEl] });
    const r2 = await Promise.race([noLead.view._playLinesReal([{ text: 'Hello world.' }], { rate: 1 }).then(() => 'resolved'),
      new Promise(r => setTimeout(() => r('timeout'), 2000))]);
    assert.equal(r2, 'resolved', '不带 leadIn 时也必须 resolve');
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/step\(\)\.then\(resolve, resolve\)/.test(src), 'leadIn 分支必须把 step() 的 Promise 接出来');
  });

  await check('结尾语：最后一道题的留白结束后，用中文人声播报「听力到此结束」', async () => {
    const m = makeView();
    const st = [];
    await m.view._playExamOrder([{ text: 'A.' }], stems(['One?', 'Two?']),
      { gapMs: 5, chime: false, status: t => st.push(t) });
    const spoken = m.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(spoken.length, 3, '两题 + 结尾语 = 3 次朗读，实际 ' + JSON.stringify(spoken));
    assert.equal(spoken[2], '听力到此结束', '最后一次必须是结尾语：' + spoken[2]);
    const lastQ = m.calls.map(c => c[0]).lastIndexOf('q');
    assert.equal(m.calls[lastQ][2], 'zh-CN', '结尾语应指定中文音色：' + m.calls[lastQ][2]);
    assert.ok(st.some(t => /留白结束/.test(t)), '状态行应显示播报结尾语：' + JSON.stringify(st));
    // 系统没有中文音色 → 改说英文，避免英文音色念中文
    const noZh = makeView({ hasLang: false });
    await noZh.view._playExamOrder([{ text: 'A.' }], stems(['One?']), { gapMs: 1, chime: false });
    const sp2 = noZh.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(sp2[sp2.length - 1], 'This is the end of the listening test.', '无中文音色应回落到英文：' + sp2[sp2.length - 1]);
    // 可关闭
    const off = makeView();
    await off.view._playExamOrder([{ text: 'A.' }], stems(['One?']), { gapMs: 1, chime: false, endSay: false });
    const sp3 = off.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(sp3.length, 1, '关闭后不该有结尾语：' + JSON.stringify(sp3));
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/id="examEnd"/.test(src), '页面应有「结尾语」开关');
    assert.ok(/listenEndText/.test(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8')), '设置里应有结尾语文案');
    assert.ok(/hasLang/.test(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8')), '语音模块应支持按语言找音色');
  });

  await check('★ 听力按整句送引擎：含逗号/分号的句子只读一次（不再按逗号切碎）', async () => {
    const words = [{ textContent: 'Hello', classList: { add() {}, remove() {} } }];
    const lineEl = { classList: { add() {}, remove() {} }, textContent: 'x', dataset: { say: 'x' },
      getBoundingClientRect: () => ({ top: 0, bottom: 0 }), __words: words };
    const m = makeView({ lines: [lineEl] });
    const sentence = 'Online learning has grown rapidly, and it changes how we study; that is clear.';
    await m.view._playLinesReal([{ text: sentence }], { leadIn: 0, rate: 1 });
    const said = m.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(said.length, 1, '整句应只读一次，实际 ' + said.length + ' 次：' + JSON.stringify(said));
    assert.ok(said[0].indexOf(',') > 0 && said[0].indexOf(';') > 0, '句内标点必须完整保留给引擎：' + said[0]);
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/const clauses = \[\{ text: text, gap: 0 \}\]/.test(src), '听力应按整句构造朗读段（不再调用 splitClauses）');
    assert.ok(/_sentenceGap\(text, paraStart\)/.test(src), '句间停顿应支持段落参数');
  });

  await check('★ lookahead 预推理：本句开口前就预取下一句（跳过空行，用下一句自己的音色）', async () => {
    const words = [{ textContent: 'First', classList: { add() {}, remove() {} } }];
    const lineEl = { classList: { add() {}, remove() {} }, textContent: 'x', dataset: { say: 'x' },
      getBoundingClientRect: () => ({ top: 0, bottom: 0 }), __words: words };
    const m = makeView({ lines: [lineEl, lineEl, lineEl] });
    await m.view._playLinesReal([
      { text: 'First sentence.' },
      { text: '   ' },                       // 段落空行：必须跳过它去找真正的下一句
      { text: 'Second sentence.' },
    ], { leadIn: 0, rate: 1 });
    const seq = m.calls.map(c => c[0] === 'prefetch' ? 'prefetch:' + c[1] : c[0] + ':' + c[1]);
    assert.equal(seq[0], 'prefetch:Second sentence.',
      '第一句开口前就应预取下一句（跳过空行），实际顺序 ' + JSON.stringify(seq));
    assert.equal(m.calls.filter(c => c[0] === 'prefetch').length, 1,
      '最后一句之后没有下一句，不该再预取：' + JSON.stringify(seq));
    const said = m.calls.filter(c => c[0] === 'q').map(c => c[1]);
    assert.equal(said.length, 2, '空行不该被朗读：' + JSON.stringify(said));
    assert.equal(m.calls.filter(c => c[0] === 'prefetch')[0][2], 1, '预取必须用与播放相同的语速');
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/Speech\.prefetch\(/.test(src), '听力播放应在当前句开口时预取下一句');
    assert.ok(/for \(let k = idx \+ 1; k < lines\.length; k\+\+\)/.test(src), '预取要往后跳过空行找下一句');
  });

  await check('★ 独白不轮换：没有说话人标注时全篇同一个音色（不再男女交替）', async () => {
    const m = makeView();
    const info = await m.view.detectGenders([{ text: 'Many people enjoy reading.' }, { text: 'It helps them relax.' }]);
    assert.equal(m.view._spGender, null, '未标注的篇章不该逐行指定性别（否则独白被读成男女对话）');
    assert.ok(/同一个音色/.test(info), '提示应说明全篇用同一个音色，实际：' + info);
    assert.ok(!/男女交替/.test(info), '不该再声称按男女交替播放：' + info);

    // 有 M/W 标注的对话仍然分角色
    const m2 = makeView();
    const info2 = await m2.view.detectGenders([{ text: 'Hello.', sp: 'M' }, { text: 'Hi.', sp: 'W' }, { text: 'Bye.' }]);
    assert.equal(m2.view._spGender[0], 'male', 'M 标注应为男声');
    assert.equal(m2.view._spGender[1], 'female', 'W 标注应为女声');
    assert.equal(m2.view._spGender[2], undefined, '没标注的行不能默认成女声（会造成"只有女生"）');
    assert.ok(/男女对话/.test(info2), '应告知是男女对话：' + info2);
  });

  await check('★ 独白句间停顿更小（保持连贯），对话仍保留换气停顿', () => {
    const m = makeView();
    // 独白：没有说话人标注 → 停顿压到换气级别
    m.view._spGender = null;
    const monoSay = m.view._sentenceGap('It helps them relax.', false);
    const monoQ = m.view._sentenceGap('Is that right?', false);
    const monoPara = m.view._sentenceGap('New paragraph starts here.', true);
    assert.ok(monoSay <= 200, '独白句间停顿应 ≤200ms，实际 ' + monoSay);
    assert.ok(monoQ <= 220, '独白疑问句也不该拖，实际 ' + monoQ);
    assert.ok(monoPara <= 400, '独白段落停顿应 ≤400ms，实际 ' + monoPara);
    // 对话：保留原来的停顿
    m.view._spGender = ['male', 'female'];
    const diaSay = m.view._sentenceGap('It helps them relax.', false);
    const diaPara = m.view._sentenceGap('New paragraph starts here.', true);
    assert.ok(diaSay >= 300, '对话句间停顿应保留 ≥300ms，实际 ' + diaSay);
    assert.ok(diaPara >= 600, '对话段落停顿应保留 ≥600ms，实际 ' + diaPara);
    assert.ok(monoSay < diaSay, '独白必须比对话更连贯：' + monoSay + ' vs ' + diaSay);
    // 强制单一音色（点了男声/女声）时也按独白处理
    m.view._spGender = ['male', 'female'];
    m.speech._forceGender = 'male';
    assert.ok(m.view._sentenceGap('It helps them relax.', false) <= 200,
      '强制单一音色时应按独白节奏，实际 ' + m.view._sentenceGap('It helps them relax.', false));
    m.speech._forceGender = '';
  });

  await check('按考场时间：每题后默认留白 15 秒（官方 13-15 秒）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/o\.gapMs == null \? 15000 : o\.gapMs/.test(src), '默认留白应为 15000ms');
    assert.ok(/13-15 秒/.test(src), '源码里应写明官方依据');
    assert.ok(/listenQaPause: 15/.test(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8')), '设置默认值应为 15 秒');
    assert.ok(/\[13, 15, 20\]/.test(src), '页面上应可选 13/15/20 秒');
  });

  await check('选项开关：默认不读 ABCD，打开后题干后面跟 A)-D)', async () => {
    const mk = opts => [{ text: 'What is it?', opts: ['Alpha', 'Bravo', 'Charlie', 'Delta'], classList: { add() {}, remove() {} } }];
    const off = makeView();
    await off.view._playExamOrder([{ text: 'A.' }], mk(), { gapMs: 0, readOptions: false, chime: false });
    assert.equal(off.calls[1][1], 'Question 1. What is it?', '默认只读题干：' + off.calls[1][1]);
    const on = makeView();
    await on.view._playExamOrder([{ text: 'A.' }], mk(), { gapMs: 0, readOptions: true, chime: false });
    assert.equal(on.calls[1][1], 'Question 1. What is it? A) Alpha B) Bravo C) Charlie D) Delta', '实际 ' + on.calls[1][1]);
    const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/readOptions/.test(src) && /examOpts/.test(src), '页面应有「连 ABCD 选项一起读」开关');
  });

  await check('_quizStems：从答题卡题目行同时取出题干与四个选项', () => {
    const fakeItem = (stem, opts) => ({
      querySelector: sel => (sel === '.qt' ? { textContent: stem } : null),
      querySelectorAll: () => opts.map(t => ({
        textContent: 'A) ' + t,
        querySelector: () => ({ textContent: t }),
      })),
    });
    const m = makeView({ inBox: [fakeItem('1. What is it?', ['Alpha', 'Bravo', 'Charlie', 'Delta'])], global: [] });
    const got = m.view._quizStems({});
    assert.equal(got.length, 1);
    assert.equal(got[0].text, '1. What is it?');
    assert.equal(got[0].opts.length, 4, '应取到 4 个选项，实际 ' + JSON.stringify(got[0].opts));
    assert.equal(got[0].opts[0], 'Alpha', '选项文本应去掉 A) 前缀：' + got[0].opts[0]);
  });

  await check('_quizStems：答题卡不在 box 内时回退到全文档查找', () => {
    const fake = stem => ({ textContent: stem, querySelector: () => null, querySelectorAll: () => [] });
    const stemsInBox = [fake('1. In box?')];
    const stemsGlobal = [fake('1. Q1?'), fake('2. Q2?')];
    const m1 = makeView({ inBox: stemsInBox, global: stemsGlobal });
    assert.equal(m1.view._quizStems({}).length, 1, 'box 内找到时用 box 内的');
    const m2 = makeView({ inBox: [], global: stemsGlobal });
    assert.equal(m2.view._quizStems({}).length, 2, 'box 内没有应回退到全文档');
  });

  await check('★ 题干带口播说话人标记时：播报不能念「3M:」', async () => {
    const m = makeView();
    await m.view._playExamOrder([{ text: 'A.' }],
      [{ textContent: '1. 3M: So then why do I feel so poorly?', classList: { add() {}, remove() {} } }],
      { gapMs: 0, chime: false, endSay: false });
    const q = m.calls.find(c => c[0] === 'q');
    assert.equal(q[1], 'Question 1. So then why do I feel so poorly?', '实际 ' + q[1]);
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项听力考试顺序检查通过');
})();