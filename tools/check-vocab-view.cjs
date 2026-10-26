/* ============ check-vocab-view.cjs : 背单词页接线（UI 不变、规则换引擎）============
 * 用户要求：按 docs/27 重设背单词的**逻辑规则**，**不改变 UI**。
 * 本套盯的就是这条边界：
 *   · 卡片/选项/按钮的 markup 与旧版逐项一致（只多了限时标签）
 *   · 学习轮由 VocabEngine 组轮（有 quiz/review/new 角色），选项由 VocabQuiz 生成（带 ids）
 *   · 自评/跳过/作答/拼写都写进引擎状态，并镜像回 Store.d.srs（旧页面/树园/统计不受影响）
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

function makeBook() {
  const words = [
    { w: 'deserve', ph: '/dɪˈzɜːv/', tr: [{ t: 'v', d: '值得' }], ex: [{ en: 'You deserve it.', cn: '这是你应得的。' }], freq: 90 },
    { w: 'abandon', ph: '/əˈbændən/', tr: [{ t: 'v', d: '放弃' }], ex: [], freq: 89 },
    { w: 'etiquette', ph: '', tr: [{ t: 'n', d: '礼仪' }], ex: [], freq: 88 },
    { w: 'scale', ph: '', tr: [{ t: 'n', d: '规模' }, { t: 'n', d: '比例' }], ex: [], freq: 87 },
    { w: 'compliment', ph: '', tr: [{ t: 'n', d: '赞美' }], ex: [], freq: 86 },
    { w: 'mitigate', ph: '', tr: [{ t: 'v', d: '缓解' }], ex: [], freq: 85 },
    { w: 'ubiquitous', ph: '', tr: [{ t: 'a', d: '无处不在的' }], ex: [], freq: 84 },
    { w: 'resilient', ph: '', tr: [{ t: 'a', d: '有韧性的' }], ex: [], freq: 83 },
    { w: 'complement', ph: '', tr: [{ t: 'v', d: '补充' }], ex: [], freq: 82 },
    { w: 'precise', ph: '', tr: [{ t: 'a', d: '精确的' }], ex: [], freq: 81 },
    { w: 'sustain', ph: '', tr: [{ t: 'v', d: '维持' }], ex: [], freq: 80 },
    { w: 'welfare', ph: '', tr: [{ t: 'n', d: '福利' }], ex: [], freq: 79 },
  ];
  return { id: 'cet6', name: '测试词书', size: words.length, words };
}

function loadView() {
  const flushed = { n: 0 };
  const view = { innerHTML: '' };
  const store = {
    d: { srs: {}, settings: { dailyNew: 30 }, stats: { daily: {} }, vocabEngine: null, createdAt: '2026-10-01' },
    flush() { flushed.n++; },
    srsOf(book, w) { return (store.d.srs[book] || {})[w] || null; },
    srsUpdate(book, w, rec) { (store.d.srs[book] = store.d.srs[book] || {})[w] = rec; },
    nbHas() { return false; },
    addStat() {},
    logActivity() {},
    nbAdd() { return true; },
    bookProgress() { return { total: 12, learned: 3, mastered: 1, reviewing: 2 }; },
    skipInfo() { return { liveSkipped: 0, batches: 0, last: null }; },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    window: {}, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: null,
    App: { today: () => '2026-10-16', fmtDate: () => '2026-10-16', toast() {}, freshView: () => view, shuffle: a => a.slice(), pick: (a, n) => a.slice(0, n), pageSeconds: () => 60, resetPageTimer() {} },
    Store: store, $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    on: () => {}, BOOKS: [{ id: 'cet6', name: '测试词书' }],
    Speech: { stop() {}, stopIfBusy() {}, speakWord() {}, speak() {} },
    SRS: { schedule: rec => rec || {}, describe: () => '待复习', stageName: s => ['新词', '学习中', '短期', '中期', '长期'][Math.min(4, s || 0)] },
    WordLevel: null, buildChoices: () => ({ opts: ['a', 'b', 'c', 'd'], answer: 0 }),
    bk0name: b => b.name, modeName: m => ({ smart: '智能模式', new: '新词学习', review: '复习巩固', random: '随机练习', spell: '拼写练习' }[m] || m),
    Dict: { content: {}, cache: {}, meaningRows: w => w.tr || [] },
    Garden: { noteWord() {} }, AI: { ready: false, lookup: async () => ({}) },
  });
  ctx.window = ctx;
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  load('js/vocab-engine.js');
  vm.runInContext('window.VocabEngine = VocabEngine;', ctx);
  load('js/vocab-quiz.js');
  load('js/views/vocab.js');
  const V = vm.runInContext('ViewVocab', ctx);
  V.book = makeBook();
  return { V, ctx, store, view };
}

const BOOK = makeBook();

(async () => {
  await check('组轮：_begin 用引擎组出带 quiz/review/new 角色的轮（不再直取 srs 到期词）', () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    // 让三个词分别处于 L3 / L2 / 新词
    E.stateOf('cet6:deserve', 's0', true).level = 3;
    E.stateOf('cet6:abandon', 's0', true).level = 2;
    V._begin('smart');
    assert.ok(V.slots.length >= 3, '轮里应该有计划词位，实际 ' + V.slots.length);
    const roles = V.slots.map(x => x.role);
    assert.ok(roles.includes('quiz'), '应含抽检位：' + JSON.stringify(roles));
    assert.ok(roles.includes('review'), '应含复习位：' + JSON.stringify(roles));
    assert.ok(roles.includes('new'), '应含新词位：' + JSON.stringify(roles));
    assert.ok(V.queue.length === V.slots.length, 'queue 与 slots 必须一一对应');
    assert.ok(V.queue.every(w => w && w.w), 'queue 里仍是原始词条对象（UI 渲染不用改）');
  });

  await check('UI 不变：教学卡仍是 不认识/认识/熟悉 三个按钮 + 词卡结构', () => {
    const { V } = loadView();
    const w = BOOK.words[0];
    V.cur = { w, opts: { opts: ['a', 'b', 'c', 'd'], answer: 0 }, levelName: '模糊' };
    const html = V._cardHTML(w, V.cur.opts);
    for (const act of ['data-act="no"', 'data-act="know"', 'data-act="familiar"', 'data-act="skip"', 'class="wcard-word"']) {
      assert.ok(html.includes(act), '教学卡缺少旧结构：' + act);
    }
    assert.ok(html.includes('模糊'), '阶段标签应显示引擎层级名');
  });

  await check('UI 不变：选项卡仍是 4 个 .choice + 字母徽标，只多一个限时标签', () => {
    const { V, ctx } = loadView();
    const w = BOOK.words[3];
    /* 真实引擎词位自带 entry/word/sense；这里补上，才能像真实流程一样出题 */
    const slot = { wordId: 'cet6:scale', senseId: 's0', wordRef: w, word: 'scale', entry: ctx.window.VocabQuiz.entryOf(makeBook(), w) };
    const opts = ctx.window.VocabQuiz.choiceFor(slot, makeBook(), { rand: () => 0.5 });
    V.cur = { w, opts, slot };
    const html = V._choiceHTML(w, opts);
    assert.equal((html.match(/class="choice"/g) || []).length, 4, '应有 4 个选项');
    assert.ok(/<span class="k">A<\/span>/.test(html), '选项字母徽标结构不能变');
    assert.ok(html.includes('id="qTime"'), '限时标签应挂在原有提示行旁');
    assert.ok(opts.ids && opts.ids.length === 4, '选项要带 id（用于判定多义/形近错因），实际 ' + JSON.stringify(opts));
  });

  await check('自评"很熟"：只进抽检池（L3），不会被当成已掌握', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V._begin('new');
    V.qi = 0;
    const slot = V.slots[0];
    V.cur = { w: slot.wordRef, opts: { opts: [], answer: 0 }, slot, levelName: '' };
    V._graded = {};
    V._grade(3, true);                       // 熟悉 → 自评认识
    const st = E.stateOf(slot.wordId, slot.senseId, false);
    assert.equal(st.level, 3, '自评认识 → L3');
    assert.equal(st.inQuizPool, true, '必须进抽检池（抽检错会被打回 L2）');
    assert.ok(store.d.srs.cet6 && Object.keys(store.d.srs.cet6).length > 0, '应双写回 srs 镜像');
  });

  await check('自评"不认识"：教学卡揭晓 + 本轮安排重考（不记错误率）', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V._begin('new');
    const slot = V.slots[0];
    V.cur = { w: slot.wordRef, opts: { opts: [], answer: 0 }, slot, levelName: '' };
    V._graded = {};
    const before = E.load().round.slots.length;
    V._grade(0);
    const live = E.load().round;
    assert.ok(live.slots.length >= before, '应插入重考位（长度 ' + live.slots.length + ' vs ' + before + '）');
    assert.equal(E.stateOf(slot.wordId, slot.senseId).errors, 0, '教学不算错');
  });

  await check('选择作答：判分走引擎（多义/形近错因 + 计时 + 轮统计）', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V._begin('new');
    const slot = V.slots[0];
    const w = slot.wordRef;
    const Q = ctx.window.VocabQuiz;
    const opts = Q.choiceFor(slot, BOOK, { rand: () => 0.5 });
    V.cur = { w, opts, slot, levelName: '' };
    V._graded = {};
    V._qStart = Date.now() - 2000;
    V._answer(opts.answer, false);           // 答对
    const live = E.load().round;
    assert.ok(live.results.length >= 1, '引擎应记录本次作答');
    const ev = live.results[live.results.length - 1];
    assert.equal(ev.correct, true);
    assert.ok(ev.responseMs >= 2000, '计时应从题目渲染开始，实际 ' + ev.responseMs);
    assert.ok(store.d.srs.cet6 && Object.keys(store.d.srs.cet6).length > 0, '应双写回 srs 镜像');
  });

  await check('完成页：保持原版式，文案用引擎报告且正向框架', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V._begin('new');
    V.vocabRound = E.load().round;
    assert.doesNotThrow(() => V._finish(), '完成页不应抛错');
    const src = fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8');
    assert.ok(/本轮学习完成/.test(src), '保留原标题');
    assert.ok(/个升级/.test(src) && /抽检通过/.test(src), '报告文案应含"升级 / 抽检通过"');
    assert.ok(/下轮优先/.test(src) && /本轮征服/.test(src), '报告应含引擎的升级列表与下轮焦点');
    assert.ok(!/错了 \d+ 个/.test(src), '禁止"错了 N 个"式呈现');
  });


  await check('选项卡：重考/回血题与当前层级用标签写明（小改 UI，不改版式）', () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    const w = BOOK.words[0];
    const Q = ctx.window.VocabQuiz;
    const slot = { wordId: 'cet6:deserve', senseId: 's0', wordRef: w, word: 'deserve', entry: Q.entryOf(BOOK, w), isRetry: true };
    E.stateOf(slot.wordId, slot.senseId, true).level = 1;
    const opts = Q.choiceFor(slot, BOOK, { rand: () => 0.5 });
    V.cur = { w, opts, slot, levelName: '眼熟' };
    let html = V._choiceHTML(w, opts);
    assert.ok(html.includes('再考一次'), '重考位要标明"再考一次"');
    assert.ok(html.includes('眼熟'), '要显示当前层级名');
    slot.isRetry = false; slot.isRecovery = true;
    html = V._choiceHTML(w, opts);
    assert.ok(html.includes('回血题'), '恢复题要标明"回血题"');
  });

  await check('词汇量测试完成后按频带给引擎定级（跳过带/起点带/估算词汇量）', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    const bk = makeBook();
    V.book = bk;
    // 造一份"按频带做的测试"：40 题里每题对象带 w；这里用 12 个词模拟，前 2 带全对、后 2 带全错
    const qs = bk.words.map(w => ({ w: w.w, opts: ['a', 'b', 'c', 'd'], a: 0 }));
    const answered = qs.map((q, i) => (i < 6 ? 0 : 1));    // 前 6 题对、其余错
    const p = V._runPlacement({ qs, answered }, bk);
    assert.ok(p, '应产出定级结果');
    assert.ok(p.rows.some(r => r.sampled > 0), '应有分带样本');
    assert.equal(E.load().user.vocabEstimate, p.vocabEstimate, '估算词汇量要写进引擎');
    assert.ok(E.load().user.bandAccuracy && Object.keys(E.load().user.bandAccuracy).length > 0, '要记住每带正确率');
    // 抽样答对的词 → 惰性定级应为 L3
    const firstWord = bk.words[0];
    const st = E.ensurePlacementLevel(ctx.window.VocabQuiz.entryOf(bk, firstWord));
    assert.equal(st.level, 3, '抽样答对的词应定到 L3');
  });

  await check('复习/抽检位进入选题时也会自动朗读（不能变成默读选择题）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8');
    const line = src.split('\n').find(l => l.includes("this.phase === 'detail' || this.phase === 'choice'"));
    assert.ok(line, '自动朗读条件应包含 choice（复习/抽检位直接进选择题）');
    assert.ok(/800ms/.test(src), '仍需保留同一词的自动朗读去重');
  });

  await check('详情页（选完意思后）有"再听一遍"按钮', () => {
    const { V } = loadView();
    const html = V._detailHTML(BOOK.words[0], null);
    assert.ok(html.includes('再听一遍'), '详情页底部应能再次播放单词');
    assert.ok(html.includes('data-act="say"'), '按钮要接到已有的发音入口');
  });

  /* ===== 2026-10-23：每日新词目标真正生效（用户反馈"这个设定没有用"） ===== */
  await check('词书页：今日新词按引擎计数显示 X/目标；达标后仍可"继续学习新单词"', () => {
    const { V, ctx, store, view } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    E.load().user.dailyNewDate = '2026-10-16';
    E.load().user.dailyNewCount = 12;
    E.save();
    V._renderShell(null);
    assert.ok(/12<small[^>]*> \/ 30/.test(view.innerHTML), '今日新词应显示 12 / 30，实际片段：'
      + (view.innerHTML.match(/今日新词[\s\S]{0,160}/) || [''])[0].replace(/\s+/g, ' '));
    assert.ok(view.innerHTML.includes('开始学习') || view.innerHTML.includes('继续学习'), '未达标时仍可开始学习');

    E.load().user.dailyNewCount = 30; E.save();
    V._renderShell(null);
    assert.ok(view.innerHTML.includes('今日 30 个新词已完成'), '达标后应说明目标已完成');
    assert.ok(view.innerHTML.includes('继续学习新单词'), '达标后主按钮应继续学新词，而不是转复习');
    assert.ok(/再加 \d+ 词/.test(view.innerHTML), '应写明可"再加 N 词"（加学）');
    assert.ok(/data-act="start-new"/.test(view.innerHTML), '主按钮应仍走新词学习');

    // 达标后点"新词学习" → 仍出新词（加学），不自动改复习；复习是独立入口
    V._begin('new');
    assert.ok(V.vocabRound && !V.vocabRound.fallbackFromNew, '目标完成不应回退为复习轮');
    assert.equal(V.vocabRound.mode, 'new', '应仍是新词学习轮，实际 ' + V.vocabRound.mode);
    assert.equal(V.vocabRound.newOverGoal, true, '应标记为目标完成后的加学轮');
    assert.ok(V.vocabRound.slots.filter(x => x.role === 'new').length > 0, '应继续出新词位');

    // 词书本身没有 L0 新词时，文案仍是"新词已学完"
    for (const e of ctx.window.VocabQuiz.bookEntries(V.book)) E.stateOf(e.wordId, 's0', true).level = 1;
    E.save();
    V._renderShell(null);
    assert.ok(view.innerHTML.includes('新词已学完'), '没有 L0 新词时应提示"新词已学完"');
  });

  await check('今日新词不把"本轮还没轮到的新词"算成已学（中途退出不虚高）', () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    E.load().user.dailyNewDate = '2026-10-16';
    E.load().user.dailyNewCount = 10;
    E.save();
    V._begin('new');                                   // 组轮 +10 → 20
    assert.equal(E.load().user.dailyNewCount, 20, '组轮时把本轮计划新词一次性计入');
    assert.ok(V.slots.filter(s => s.role === 'new').length > 0, '应有新词位');
    assert.equal(V._dailyNewUsed(true), 10, '返回词书口径：扣掉本轮还没轮到的新词位');
    assert.equal(V._dailyNewUsed(), 20, 'HUD 口径保留原始计数，再自己减剩余');
    const news = V.slots.filter(s => s.role === 'new');
    E.consumeSlot(news[0].wordId, news[0].senseId, news[0]);
    assert.equal(V._dailyNewUsed(true), 11, '消费 1 个新词位后今日已学应为 11');
  });

  /* ===== 2026-10-23：点"熟悉/跳过/词条详情"后不再循环同一个词 ===== */
  await check('新词卡点"熟悉，查看词义和搭配"→ 下一个：消费词位、不循环同一个词', () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    V._begin('new');
    const total = V.slots.length;
    const first = V.slots[0];
    V.cur = { w: first.wordRef, opts: { opts: [], answer: 0 }, slot: first, levelName: '' };
    V._grade(3, true);                                  // 熟悉 → 自评认识 + 详情页
    assert.equal(V.phase, 'detail', '熟悉后应进入详情页');
    const roundSlotsBefore = E.load().round.slots.length;
    V._next();                                          // 详情页"下一个 →"
    assert.equal(E.load().round.slots.length, roundSlotsBefore - 1, '引擎轮里该词位应被消费');
    assert.notEqual(V.slots[V.qi], first, '推进后不能再回到同一个词');
    assert.equal(V.slots.length, total, 'done + rest 长度守恒，且不重复');
    assert.equal(new Set(V.slots.map(s => s.wordId + '#' + s.senseId)).size, V.slots.length, '队列里不能有重复词位');

    // 连续再点几次"熟悉"，每次都前进到新词
    let prev = V.slots[V.qi];
    for (let i = 0; i < 3; i++) {
      V.cur = { w: prev.wordRef, opts: { opts: [], answer: 0 }, slot: prev, levelName: '' };
      V._grade(3, true);
      V._next();
      assert.notEqual(V.slots[V.qi], prev, '第 ' + (i + 2) + ' 次点熟悉也应前进');
      prev = V.slots[V.qi];
    }
  });

  await check('跳过 / 词条详情 → 下一个：同样消费词位、不循环', async () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    V._begin('new');
    const skipFirst = V.slots[0];
    V.cur = { w: skipFirst.wordRef, opts: { opts: [], answer: 0 }, slot: skipFirst, levelName: '' };
    await V._onAct('skip', {});
    assert.notEqual(V.slots[V.qi], skipFirst, '跳过后应前进');
    assert.equal(new Set(V.slots.slice(V.qi).map(s => s.wordId + '#' + s.senseId)).size,
      V.slots.length - V.qi, '剩余队列不能有重复词位');

    V._begin('new');
    const detailFirst = V.slots[0];
    V.cur = { w: detailFirst.wordRef, opts: { opts: [], answer: 0 }, slot: detailFirst, levelName: '' };
    await V._onAct('detail', {});
    assert.equal(V.phase, 'detail');
    await V._onAct('nextWord', {});
    assert.notEqual(V.slots[V.qi], detailFirst, '详情后应前进而不是原地重来');
  });

  await check('完成页新增「继续学习 →」按钮，原有"返回词书 / 再来一组拼写"不丢', () => {
    const { V, ctx, store, view } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    V._begin('new');
    V.vocabRound = E.load().round;
    V._finish();
    assert.ok(/data-act="more"/.test(view.innerHTML), '完成页应有继续学习按钮');
    assert.ok(/继续学习/.test(view.innerHTML), '按钮文案应含"继续学习"');
    assert.ok(/返回词书/.test(view.innerHTML), '原有"返回词书"不能丢');
    assert.ok(/再来一组拼写/.test(view.innerHTML), '原有"再来一组拼写"不能丢');
  });

  await check('选择题卡不再显示例句（2026-10-17：例句与目标义项无对应关系，避免误导）', () => {
    const { V, ctx } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(ctx.Store);
    const w = BOOK.words[0];
    const Q = ctx.window.VocabQuiz;
    const slot = { wordId: 'cet6:deserve', senseId: 's0', wordRef: w, word: 'deserve', entry: Q.entryOf(BOOK, w) };
    const opts = Q.choiceFor(slot, BOOK, { rand: () => 0.5 });
    V.cur = { w, opts, slot, levelName: '' };
    const html = V._choiceHTML(w, opts);
    assert.ok(!/class="ex-item"/.test(html), '选择题卡不应再出现例句块');
    assert.ok(html.includes('wcard-word') && html.includes('deserve'), '单词仍要显示');
    assert.equal((html.match(/class="choice"/g) || []).length, opts.opts.length, '选项数量应正常');
    assert.ok(html.includes('id="qTime"'), '限时标签仍保留');
  });

  /* ===== 2026-10-26 用户反馈：音标 / 已掌握口径 / 今日复习进度 / 拼写轮换 ===== */
  await check('音标：词书 ph 为空占位（"/  /"）时回退内置词典，不再显示 "//"', () => {
    const { V, ctx } = loadView();
    const w = { w: 'destined', ph: '/  /', tr: [{ t: 'adj', d: '命中注定的' }] };
    let html = V._cardHTML(w, { opts: [], answer: 0 });
    assert.ok(!/wcard-ph">\s*\/\s*\//.test(html), '空音标占位不应原样渲染：' + (html.match(/wcard-ph[^<]*/) || [''])[0]);
    ctx.Dict.get = () => ["'destɪn", '命中注定的', 'destined'];
    html = V._cardHTML(w, { opts: [], answer: 0 });
    assert.ok(html.includes('/ˈdestɪn/'), '应回退到内置词典音标（并补 / /、修 ʼ→ˈ）');
    const detail = V._detailHTML(w, null);
    assert.ok(detail.includes('/ˈdestɪn/'), '详情页音标也要回退');
  });

  await check('词书页：测试跳过的简单词计入「已掌握」/「已学」，今日复习显示实际进度', () => {
    const { V, ctx, store, view } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    // 两个词：语言测试整带跳过 → L3 且从未作答
    E.stateOf('cet6:deserve', 's0', true).level = 3;
    E.stateOf('cet6:deserve', 's0', true).attempts = 0;
    E.stateOf('cet6:abandon', 's0', true).level = 3;
    E.stateOf('cet6:abandon', 's0', true).attempts = 0;
    // 一个词：真正作答过且 L4 → 已掌握
    E.stateOf('cet6:welfare', 's0', true).level = 4;
    E.stateOf('cet6:welfare', 's0', true).attempts = 3;
    // 今天复习过 2 个；其中一条是"新词"不计入复习
    const today = new Date('2026-10-16T10:00:00+08:00').getTime();   // 与 App.today() 的桩保持一致
    E.load().events.push(
      { ts: today, wordId: 'cet6:deserve', role: 'review', correct: true },
      { ts: today, wordId: 'cet6:abandon', role: 'quiz', correct: true },
      { ts: today, wordId: 'cet6:welfare', role: 'new', correct: true }
    );
    E.save();
    const counts = V._engineCounts();
    assert.equal(counts.skippedKnown, 2, '整带跳过词数应为 2，实际 ' + counts.skippedKnown);
    /* 有 skipBands 时按频带稳定统计：练过、甚至被降级也不该从"已掌握"里消失 */
    E.load().user.skipBands = [0];
    E.save();
    const bandCounts = V._engineCounts();
    assert.ok(bandCounts.skippedKnown >= 2, '按频带统计应覆盖跳过带的词，实际 ' + bandCounts.skippedKnown);
    E.stateOf('cet6:deserve', 's0', true).attempts = 3;   // 练过一次
    E.save();
    const after = V._engineCounts();
    assert.equal(after.skippedKnown, bandCounts.skippedKnown, '练过之后跳过带的词仍应计入已掌握');
    assert.equal(V._todayReviewDone(), 2, '今日复习应只算 review/quiz 去重词，实际 ' + V._todayReviewDone());
    V._renderShell(null);
    assert.ok(view.innerHTML.includes('含测试跳过'), '已掌握应标注含测试跳过');
    assert.ok(view.innerHTML.includes('待复习'), '今日复习应同时给出待复习数');
    assert.ok(/今日复习[\s\S]{0,120}>2</.test(view.innerHTML), '今日复习应显示实际进度 2');
  });

  await check('拼写练习：queue 与 slots 同步；按时间排序用引擎逐词真实作答时间（不再永远同一批）', async () => {
    const { V, ctx, store } = loadView();
    const E = ctx.window.VocabEngine;
    E.reset(); E.load(store);
    store.d.srs.cet6 = {
      deserve: { reps: 2 }, abandon: { reps: 2 }, etiquette: { reps: 2 },
    };
    // 引擎里逐词真实作答时间：deserve 最早、abandon 最晚
    E.stateOf('cet6:deserve', 's0', true).lastGradedAt = new Date('2026-10-16T01:00:00+08:00').toISOString();
    E.stateOf('cet6:abandon', 's0', true).lastGradedAt = new Date('2026-10-16T03:00:00+08:00').toISOString();
    E.stateOf('cet6:etiquette', 's0', true).lastGradedAt = new Date('2026-10-16T02:00:00+08:00').toISOString();
    E.save();
    V.book = makeBook(); V.mode = 'spell'; V.spellOrder = 'time';
    V._begin('spell');
    assert.equal(V.queue.length, V.slots.length, '拼写轮 queue 必须与 slots 一一对应');
    assert.deepEqual(V.queue.map(w => w.w), V.slots.map(sl => sl.wordRef.w), 'queue 应等于 slots 的词');
    const order = V.slots.map(sl => sl.wordRef.w);
    assert.ok(order.indexOf('deserve') < order.indexOf('etiquette'), '按时间：更早作答的 deserve 应排在 etiquette 前：' + JSON.stringify(order));
    assert.ok(order.indexOf('etiquette') < order.indexOf('abandon'), '按时间：etiquette 应排在 abandon 前：' + JSON.stringify(order));

    // 点「乱序」必须真的改变当前拼写轮的状态，而不是改另一个模式遗留的 queue
    V.qi = 0;
    const before = V.slots.map(sl => sl.wordRef.w);
    await V._onAct('spellOrder', { dataset: { order: 'random' } });
    assert.equal(V.spellOrder, 'random', '应记录乱序选择');
    assert.equal(V.queue.length, V.slots.length, '乱序后 queue 仍应与 slots 对应');
    assert.ok(V.slots.slice(0, 1).map(x => x.wordRef.w).join() === before.slice(0, 1).join(), '当前题不动');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项背单词接线检查通过');
})();
