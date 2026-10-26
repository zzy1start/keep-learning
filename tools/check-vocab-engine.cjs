/* ============ check-vocab-engine.cjs : 词汇学习引擎自检（含 §8 golden test）============
 * 规约：docs/27-词汇学习引擎设计.md
 * 覆盖：
 *   · §8 场景 A 定级 / B 完整一轮 8 题 / C 焦躁保护 / D 间隔复现
 *   · §5.3 出题规则（多义辨析干扰项、答案下标）
 *   · §6 边界：同词每轮最多 2 次、MIN_GAP、单日新词目标（软目标，可继续加学）、短轮、错误率截断、旧 srs 迁移
 *   · §4.3 持久化上限（事件 500 / 轮 50）、srs 镜像双写
 *   · 纯逻辑：不依赖 DOM（上下文里没有 document 也能跑）
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* 【固定时区/时钟】引擎用本地时间算"今天"与间隔日期；本机时区是 Asia/Shanghai，
 * 跨 UTC 日界线会让 "+7 天" 的绝对日期差一天（与代码逻辑无关）。测试统一按 UTC 跑，
 * 并把 _now 固定在 today（见 load()），保证结果与运行日期无关。*/
process.env.TZ = 'UTC';

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

/** 加载引擎 + 出题模块（**故意不提供 document**：证明是纯逻辑） */
function load(opts = {}) {
  const store = opts.store || {
    d: { srs: {}, settings: {}, stats: { daily: {} } },
    flush() { store.flushes = (store.flushes || 0) + 1; },
  };
  const ctx = vm.createContext({
    console, Math, JSON, Object, Array, String, Number, Date, Set, Map, Promise,
    Store: store,
    localStorage: null,
    window: {},
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-engine.js'), 'utf8') + '\nwindow.VocabEngine = VocabEngine;', ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/vocab-quiz.js'), 'utf8'), ctx);
  const Engine = ctx.window.VocabEngine;
  const Quiz = ctx.window.VocabQuiz;
  Engine.reset();
  Engine.load(store);
  /* 【固定时钟】引擎的间隔排期走 _today()/_now()，测试里 today 固定为 2026-10-16。
   * 不注入的话，换一天跑（真机日期 2026-10-23）就会把 +7/+15 天算成另一天，
   * 出现与代码无关的"日期漂移"失败。*/
  Engine._now = () => Date.parse('2026-10-16T12:00:00Z');
  if (opts.rand != null) Engine._rand = () => opts.rand;
  return { Engine, Quiz, store, ctx };
}

/* ---------- 造词条（§4.1 结构，词库缺字段时由 VocabQuiz 适配，这里直接给全字段） ---------- */
function entry(wordId, word, band, opts = {}) {
  const senses = (opts.senses || ['释义一']).map((d, i) => ({
    senseId: 's' + i, defZh: d, exampleEn: '', exampleZh: '',
  }));
  return {
    wordId, word, band, senses,
    confusableWith: opts.confusableWith || [],
    morphemeSplit: null,
  };
}
const DAY = 864e5;
const today = '2026-10-16';

(async () => {
  /* ================= 场景 A · 定级 ================= */
  await check('§8-A 定级：skipBands/起点带/估算词汇量', () => {
    const { Engine } = load();
    const results = [
      { band: 0, sampled: 12, correct: 12 }, { band: 1, sampled: 12, correct: 11 },
      { band: 2, sampled: 12, correct: 10 }, { band: 3, sampled: 12, correct: 5 },
      { band: 4, sampled: 12, correct: 2 }, { band: 5, sampled: 12, correct: 1 },
    ];
    const sizes = [1000, 1500, 1500, 2000, 2000, 3000];
    const p = Engine.placement(results, sizes);
    assert.equal(JSON.stringify(p.accuracy.map(x => Math.round(x * 1000) / 1000)),
      JSON.stringify([1, 0.917, 0.833, 0.417, 0.167, 0.083]), 'accuracy = ' + JSON.stringify(p.accuracy));
    /* vm 上下文里的数组原型与宿主不同，deepEqual(strict) 会误判 → 按 JSON 比较内容 */
    assert.equal(JSON.stringify(Array.from(p.skipBands)), JSON.stringify([0, 1, 2]), 'skipBands 应为 [0,1,2]');
    assert.equal(p.bandPlacement, 3, '起点带应为 3');
    assert.equal(p.vocabEstimate, 5042, '估算词汇量应为 5042，实际 ' + p.vocabEstimate);
    assert.equal(p.calibrationRoundsLeft, 2);
    // 逐词定级：跳过带 → L3+抽检池；起点带及以后 → L0；
    Engine.applyPlacement(p);
    const correctIds = new Set(['w:l0a', 'w:l3a']);
    const byWord = (id, band) => Engine.placeWord(entry(id, id, band), p, correctIds);
    assert.equal(byWord('w:l0a', 0).level, 3, '跳过带的词 → L3');
    assert.equal(byWord('w:l0a', 0).inQuizPool, true);
    assert.equal(byWord('w:l3a', 3).level, 3, '抽样答对的词一律 L3 进抽检池');
    assert.equal(byWord('w:l1a', 1).level, 3, '命中跳过带 → L3');
    assert.equal(byWord('w:l4a', 4).level, 0, '起点带之后的带 → L0');
  });

  /* ================= 场景 B · 完整一轮 ================= */
  await check('§8-B 组轮：quiz→review→new，短轮，抽检位受候选数限制', () => {
    const { Engine } = load({ rand: 0.99 });
    const s = Engine.load();
    /* golden 的候选池只有这 5 个词（compliment 只作为 complement 的形近词存在，
     * 不进入词表——否则它自己会占一个"新词位"，与 golden 计划不符）。*/
    const entries = [
      entry('w:mitigate', 'mitigate', 5),
      entry('w:complement', 'complement', 4, { confusableWith: ['w:compliment'] }),
      entry('w:scale', 'scale', 3, { senses: ['规模', '比例', '鳞片'] }),
      entry('w:ubiquitous', 'ubiquitous', 5),
      entry('w:resilient', 'resilient', 4),
    ];
    // 初始状态按 golden：mitigate L3；complement L1；scale L2；两个 L0 新词
    const setLevel = (wid, sid, level) => { const st = Engine.stateOf(wid, sid, true); st.level = level; return st; };
    setLevel('w:mitigate', 's0', 3);
    const comp = setLevel('w:complement', 's0', 1);
    comp.errorTypes = { polysemy: 0, confusable: 1, forgotten: 1, timeout: 0 };
    setLevel('w:scale', 's0', 2);
    const round = Engine.startRound({ entries, mode: 'smart', today });
    const plan = round.slots.map(x => x.wordId.replace('w:', '') + ':' + x.role);
    assert.equal(plan.length, 5, '实际计划 ' + JSON.stringify(plan));
    assert.equal(JSON.stringify(plan), JSON.stringify(['mitigate:quiz', 'complement:review', 'scale:review', 'ubiquitous:new', 'resilient:new']),
      '实际计划 ' + JSON.stringify(plan));
    assert.equal(round.quiz.total, 1, '候选池只有 1 个 L3/L4 词 → 抽检位 1 个');
    return round;
  });

  await check('§8-B 逐题判定：8 题后的状态与报告与规约一致', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [
      entry('w:mitigate', 'mitigate', 5),
      entry('w:complement', 'complement', 4, { confusableWith: ['w:compliment'] }),
      entry('w:scale', 'scale', 3, { senses: ['规模', '比例', '鳞片'] }),
      entry('w:ubiquitous', 'ubiquitous', 5),
      entry('w:resilient', 'resilient', 4),
    ];
    const setLevel = (wid, sid, level) => { const st = Engine.stateOf(wid, sid, true); st.level = level; return st; };
    setLevel('w:mitigate', 's0', 3);
    setLevel('w:complement', 's0', 1);
    setLevel('w:scale', 's0', 2);
    Engine.startRound({ entries, mode: 'smart', today });
    const g = o => Engine.grade(o);
    const co = (wid, role, correct, ms, extra = {}) => g(Object.assign({ wordId: wid, senseId: 's0', role, correct, responseMs: ms }, extra));

    // #1 mitigate quiz 4s 答对 → L4 +7 天
    let r = co('w:mitigate', 'quiz', true, 4000);
    assert.equal(Engine.stateOf('w:mitigate', 's0').level, 4, 'mitigate 应升 L4');
    assert.equal(Engine.stateOf('w:mitigate', 's0').nextDueAt, '2026-10-23', 'L4 首返 +7 天');
    assert.equal(r.feedback.correct, true);

    // #2 complement review 选成 compliment 的释义 → confusable，3 题后重考
    r = co('w:complement', 'review', false, 5000, { selectedOptionId: 'w:compliment#s0' });
    assert.equal(r.feedback.errorType, 'confusable', '错误类型应为 confusable，实际 ' + r.feedback.errorType);
    assert.equal(Engine.stateOf('w:complement', 's0').confusableRisk, true);
    assert.equal(r.retry, true, '应安排同轮重考');

    // #3 scale review 12s 答对 → 0.5（犹豫）
    r = co('w:scale', 'review', true, 12000);
    assert.equal(r.feedback.score, 0.5, '超时答对应算半次，实际 ' + r.feedback.score);
    assert.equal(Engine.stateOf('w:scale', 's0').streak, 0.5);
    assert.equal(Engine.stateOf('w:scale', 's0').hesitationMsSum, 12000);

    // #4 ubiquitous new 8s 答对 → L1
    r = co('w:ubiquitous', 'new', true, 8000, { levelBeforeTeaching: true });
    assert.equal(Engine.stateOf('w:ubiquitous', 's0').level, 1, 'L0→L1');

    // #5 resilient new 15s 超时未答 → 0，安排重考
    r = co('w:resilient', 'new', false, 15000, { answered: false });
    assert.equal(r.feedback.errorType, 'timeout');
    assert.equal(r.retry, true, '超时应安排重考');

    // #6 complement retry 答对（间隔 3 题） → L1→L2
    const retryOrder = Engine.load().round.slots.map(x => x.wordId.replace('w:', '') + ':' + x.role);
    r = co('w:complement', 'retry', true, 3000);
    assert.equal(Engine.stateOf('w:complement', 's0').level, 2, 'L1→L2');

    // #7 scale retry 3s 答对 → L2→L3（streak 1.5 且 levelAttempts 2）
    r = co('w:scale', 'retry', true, 3000);
    assert.equal(Engine.stateOf('w:scale', 's0').level, 3, 'L2→L3');
    assert.equal(retryOrder[0], 'complement:retry', '重考插入点：第 6 题应是 complement，实际 ' + JSON.stringify(retryOrder));

    // #8 resilient retry 答错（同轮第 2 次错）→ 熔断
    r = co('w:resilient', 'retry', false, 6000);
    assert.equal(Engine.stateOf('w:resilient', 's0').level, 0, '熔断保持 L0');
    assert.equal(Engine.stateOf('w:resilient', 's0').hardWord, true, '熔断要标记 hardWord');
    assert.equal(r.endRound, true, '8 题后应结束本轮');

    const rep = Engine.report(Engine.load().round);
    const ups = rep.upgraded.map(x => String(x.wordId).replace('w:', '')).sort();
    assert.equal(JSON.stringify(ups), JSON.stringify(['mitigate', 'scale', 'ubiquitous', 'complement'].sort()),
      'upgraded = ' + JSON.stringify(ups));
    assert.equal(rep.hardWords.length, 1);
    assert.equal(rep.hardWords[0].wordId, 'w:resilient');
    assert.equal(rep.hardWords[0].action, 'break');
    assert.equal(rep.quizzed.total, 1);
    assert.equal(rep.quizzed.passed, 1, 'mitigate 抽检通过 → passed 1');
    assert.equal(Math.round(rep.roundErrorRate * 1000) / 1000, 0.375, '错误率应为 3/8，实际 ' + rep.roundErrorRate);
    assert.equal(rep.truncated, false);
    assert.equal(Engine.load().round.consecutiveWrongPeak, 1, '连续错误峰值应为 1（未触发干预）');
  });

  /* ================= 场景 C · 焦躁保护 ================= */
  await check('§8-C 连续两次答错 → 下一题必须是恢复题（L4 池非空）', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [
      entry('w:easy4', 'easy4', 1),
      entry('w:a', 'a', 3), entry('w:b', 'b', 3), entry('w:c', 'c', 3), entry('w:d', 'd', 3),
    ];
    const s4 = Engine.stateOf('w:easy4', 's0', true); s4.level = 4; s4.nextDueAt = '2026-10-01';
    for (const w of ['w:a', 'w:b', 'w:c', 'w:d']) Engine.stateOf(w, 's0', true).level = 1;
    Engine.startRound({ entries, mode: 'review', today });
    const g = (wid, correct) => Engine.grade({ wordId: wid, senseId: 's0', role: 'review', correct, responseMs: 2000, selectedOptionId: correct ? null : 'w:x#s0' });
    g('w:a', false); g('w:b', false);          // 连续两错
    const next = Engine.load().round.slots.find(x => x.role === 'recovery');
    assert.ok(next, '应插入恢复题，实际队列 ' + JSON.stringify(Engine.load().round.slots.map(x => x.role)));
    assert.equal(next.wordId, 'w:easy4', '恢复题应来自 L4 池');
  });

  await check('§8-C 轮错误率 > 40% 且有新词未完成 → 截断，剩余新词顺延', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 6; i++) entries.push(entry('w:r' + i, 'r' + i, 3));
    for (let i = 0; i < 4; i++) entries.push(entry('w:n' + i, 'n' + i, 5));
    Engine.startRound({ entries, mode: 'smart', today });
    const round = Engine.load().round;
    assert.ok(round.slots.some(x => x.role === 'new'), '初始应有新词位');
    // 5 题错 3 题 = 0.6 > 0.40
    const order = round.slots.slice();
    const pick = role => order.find(x => x.role === role);
    let n = 0;
    while (n < 5) {
      const slot = Engine.load().round.slots[0];
      if (!slot) break;
      const wrong = (n === 0 || n === 1 || n === 3);
      Engine.grade({ wordId: slot.wordId, senseId: slot.senseId, role: slot.role, correct: !wrong, responseMs: 2000, selectedOptionId: wrong ? 'w:zzz#s0' : null });
      n++;
      if (Engine.load().round.truncated) break;
    }
    assert.equal(Engine.load().round.truncated, true, '错误率 0.6 > 0.40 应截断');
    assert.equal(Engine.load().round.slots.some(x => x.role === 'new'), false, '截断后不应再有新词位');
  });

  /* ================= 场景 D · 间隔复现 ================= */
  await check('§8-D L4 到点优先抽检；答错打回 L2 并当天可复习；答对进入 15 天档', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [entry('w:due', 'due', 2), entry('w:due2', 'due2', 2)];
    const st = Engine.stateOf('w:due', 's0', true); st.level = 4; st.nextDueAt = '2026-10-14';   // 已 overdue 2 天
    const st2 = Engine.stateOf('w:due2', 's0', true); st2.level = 4; st2.nextDueAt = '2026-10-16';
    const round = Engine.startRound({ entries, mode: 'review', today });
    assert.equal(round.slots[0].wordId, 'w:due', 'overdue 更久的应先抽到');
    Engine.grade({ wordId: 'w:due', senseId: 's0', role: 'quiz', correct: false, responseMs: 3000, selectedOptionId: 'w:x#s0' });
    assert.equal(Engine.stateOf('w:due', 's0').level, 2, '抽检答错 → L2');
    assert.equal(Engine.stateOf('w:due', 's0').nextDueAt, null, '打回 L2 后 nextDueAt 清空（立即可复习）');

    // 另一轮：限时内答对 → +15 天
    Engine.reset(); Engine.load(); Engine._rand = () => 0.99;
    const st3 = Engine.stateOf('w:due2', 's0', true); st3.level = 4; st3.intervalIdx = 0; st3.nextDueAt = '2026-10-16';
    Engine.startRound({ entries: [entry('w:due2', 'due2', 2)], mode: 'review', today });
    Engine.grade({ wordId: 'w:due2', senseId: 's0', role: 'quiz', correct: true, responseMs: 2000 });
    assert.equal(Engine.stateOf('w:due2', 's0').level, 4);
    assert.equal(Engine.stateOf('w:due2', 's0').nextDueAt, '2026-10-31', '第二档应为 +15 天，实际 ' + Engine.stateOf('w:due2', 's0').nextDueAt);
  });

  /* ================= 边界与持久化 ================= */
  await check('§6-#4 同词每轮最多 2 次作答；重考按 MIN_GAP 插入', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [entry('w:a', 'a', 3)];
    for (let i = 0; i < 8; i++) entries.push(entry('w:f' + i, 'f' + i, 3));
    for (let i = 0; i < 8; i++) Engine.stateOf('w:f' + i, 's0', true).level = 1;
    Engine.stateOf('w:a', 's0', true).level = 1;
    Engine.startRound({ entries, mode: 'review', today });
    let attempts = 0;
    for (let i = 0; i < 4; i++) {
      const slot = Engine.load().round.slots.find(x => x.wordId === 'w:a');
      if (!slot) break;
      Engine.grade({ wordId: 'w:a', senseId: 's0', role: slot.role, correct: false, responseMs: 1000, selectedOptionId: 'w:zz#s0' });
      attempts++;
      // 强行使该词再次成为队首，模拟"又轮到它"
      const q = Engine.load().round.slots;
      const idx = q.findIndex(x => x.wordId === 'w:a');
      if (idx < 0) break;
    }
    const evs = Engine.load().events.filter(e => e.wordId === 'w:a');
    assert.ok(evs.length <= 2, '同词每轮最多 2 次作答，实际 ' + evs.length);
  });

  await check('§6-#7 未传 dailyNewTarget 时保持软目标：达到日目标后仍可继续加学（兼容旧调用）', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 40; i++) entries.push(entry('w:n' + i, 'n' + i, 5));
    Engine.load().user.dailyNewCount = 20;      // 模拟：今天已经学了 20 个新词（日目标已达成）
    Engine.load().user.dailyNewDate = today;
    const round = Engine.startRound({ entries, mode: 'new', today });
    assert.ok(round.slots.length > 0, '达到日目标后仍应能继续出新词轮（可以继续学）');
    assert.ok(round.slots.every(x => x.role === 'new'), '新词模式只出新词位：' + JSON.stringify(round.slots.map(x => x.role)));
    assert.ok(round.slots.length <= Engine.CONFIG.NEW_PER_ROUND.max,
      '每轮新词数仍受 NEW_PER_ROUND.max 限制，实际 ' + round.slots.length);
    assert.equal(Engine.load().user.dailyNewCount, 20 + round.slots.length, 'dailyNewCount 继续累计（只用于展示统计）');
  });

  /* ===== 2026-10-23：每日新词目标真正生效（用户反馈"这个设定没有用"） ===== */
  await check('§6-#7b 按日配额出词：30 目标 = 10+10+10；达标后继续加学新词，不强制复习', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 60; i++) entries.push(entry('w:q' + i, 'q' + i, 5));
    /* 学完一轮 = 把该轮的新词位全部消费掉（正常学习会判分/自评/跳过，都会消费） */
    const finishRound = round => {
      for (const slot of round.slots.slice()) Engine.consumeSlot(slot.wordId, slot.senseId, slot);
    };
    const r1 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(r1.slots.filter(x => x.role === 'new').length, 10, '第 1 轮 10 个新词');
    assert.equal(Engine.load().user.dailyNewCount, 10, '今日已安排 10 个');
    finishRound(r1);
    const r2 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(Engine.load().user.dailyNewCount, 20, '第 2 轮后累计 20 个');
    finishRound(r2);
    const r3 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(Engine.load().user.dailyNewCount, 30, '第 3 轮后累计 30 个（达成目标）');
    assert.equal(r3.dailyNewTarget, 30, '轮上要带日目标供 UI 展示');
    finishRound(r3);
    const r4 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(r4.mode, 'new', '达标后点新词学习仍应出新词（继续加学），不能自动改复习');
    assert.equal(r4.fallbackFromNew, false, '目标完成不是回退理由');
    assert.equal(r4.slots.filter(x => x.role === 'new').length, 10, '达标后每轮仍出 ≤10 个新词（加学）');
    assert.equal(r4.newOverGoal, true, '应标记这是"目标完成后的加学轮"');
    assert.equal(Engine.load().user.dailyNewCount, 40, 'dailyNewCount 继续累计（用于展示已加学多少）');
    finishRound(r4);

    // 只有"词书已没有 L0 新词"才回退复习轮
    for (const e of entries) Engine.stateOf(e.wordId, 's0', true).level = 1;
    const r5 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(r5.mode, 'smart', '词书没有新词时应回退复习轮');
    assert.equal(r5.fallbackFromNew, true);
    assert.equal(r5.fallbackReason, 'no-new', '回退原因应是词书学完（不是日目标）');
  });

  await check('§6-#7e 今日只剩 5 个额度时下一轮只出 5 个（补满目标）', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 40; i++) entries.push(entry('w:u' + i, 'u' + i, 5));
    Engine.load().user.dailyNewDate = today;
    Engine.load().user.dailyNewCount = 25;
    const r = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(r.slots.filter(x => x.role === 'new').length, 5, '应只补 5 个到今日目标，实际 ' + r.slots.length);
    assert.equal(Engine.load().user.dailyNewCount, 30);
    assert.equal(r.newOverGoal, false, '本轮属于达标前，不标记加学');
  });

  await check('§6-#7c 每日目标小于每轮上限时按目标出词（目标 5 → 一轮 5 个）', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push(entry('w:s' + i, 's' + i, 5));
    const r = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 5 });
    assert.equal(r.slots.filter(x => x.role === 'new').length, 5, '应按目标 5 出词，实际 ' + r.slots.length);
    assert.equal(Engine.load().user.dailyNewCount, 5);
  });

  await check('§6-#7d 中途退出换轮对账：上一轮没学的新词位不重复占用今日额度', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 40; i++) entries.push(entry('w:t' + i, 't' + i, 5));
    const r1 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(r1.slots.filter(x => x.role === 'new').length, 10);
    // 一点没学就切走（返回词书后再开始）
    const r2 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    assert.equal(Engine.load().user.dailyNewCount, 10, '未学的 10 个应被扣回，今日仍只占 10 个，实际 ' + Engine.load().user.dailyNewCount);
    assert.equal(r2.slots.filter(x => x.role === 'new').length, 10);
  });

  await check('§5.2 consumeSlot：熟悉/跳过/详情消费词位，不误删同词重考位', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 12; i++) entries.push(entry('w:c' + i, 'c' + i, 5));
    const round = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    const first = round.slots[0];
    const before = round.slots.length;
    assert.equal(Engine.consumeSlot(first.wordId, first.senseId, first), true, '应按对象身份移除词位');
    assert.equal(Engine.load().round.slots.length, before - 1, '队列应少一个词位');
    assert.ok(!Engine.load().round.slots.includes(first), '被消费的词位不应还在队列里');
    assert.equal(Engine.load().user.dailyNewCount, round.slots.length + 1, '每日计数不受消费影响');

    // 教学揭晓会插入一个同词的重考位：消费原词位时不能把重考位一起删掉
    const round2 = Engine.startRound({ entries, mode: 'new', today, dailyNewTarget: 30 });
    const origin = round2.slots.find(x => x.role === 'new');
    Engine.teachingReveal(origin.wordId, origin.senseId);
    const retries = Engine.load().round.slots.filter(x => x.wordId === origin.wordId);
    assert.equal(retries.length, 1, '应插入 1 个重考位');
    assert.equal(retries[0].role, 'retry');
    assert.equal(Engine.consumeSlot(origin.wordId, origin.senseId, origin), false, '原词位已被揭晓消费，不能误删重考位');
    assert.equal(Engine.load().round.slots.filter(x => x.wordId === origin.wordId).length, 1, '重考位必须保留');
  });

  await check('§5.2 新词池为空时点"新词/继续学习"自动改组复习轮（不弹"明天再来"）', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [];
    for (let i = 0; i < 20; i++) entries.push(entry('w:r' + i, 'r' + i, 2));
    for (let i = 0; i < 20; i++) Engine.stateOf('w:r' + i, 's0', true).level = 1;   // 全部是复习词，无 L0
    const round = Engine.startRound({ entries, mode: 'new', today });
    assert.equal(round.mode, 'smart', '新词池空时自动改组智能轮，实际 ' + round.mode);
    assert.equal(round.fallbackFromNew, true, '应带 fallbackFromNew 标记供 UI 提示');
    assert.ok(round.slots.length > 0, '应组出复习轮而不是空轮');
    assert.ok(round.slots.every(x => x.role === 'review' || x.role === 'quiz'),
      '不应出现新词位：' + JSON.stringify(round.slots.map(x => x.role)));
  });

  await check('§4.3 事件环形日志 500 条上限、轮历史 50 上限', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [entry('w:x', 'x', 3)];
    Engine.stateOf('w:x', 's0', true).level = 1;
    Engine.startRound({ entries, mode: 'review', today });
    for (let i = 0; i < 600; i++) Engine._record({ roundId: 'r', wordId: 'w:x', senseId: 's0', correct: true });
    assert.equal(Engine.load().events.length, 500, '事件日志应封顶 500');
  });

  await check('§6-#12 旧 srs 数据迁移：stage 0~4 → L0~L4，抽检池为空', () => {
    const { Engine, store } = load();
    store.d.srs = { cet6: { deserve: { stage: 3, reps: 5, next: Date.now() + DAY }, abandon: { stage: 1, reps: 2 } } };
    const n = Engine.migrateFromSrs(store.d.srs.cet6, w => 'cet6:' + w);
    assert.equal(n, 2, '应迁移 2 个词');
    assert.equal(Engine.stateOf('cet6:deserve', 's0').level, 3);
    assert.equal(Engine.stateOf('cet6:abandon', 's0').level, 1);
    assert.equal(Engine.stateOf('cet6:deserve', 's0').inQuizPool, false, '迁移不把词放进抽检池');
  });

  await check('过渡期双写：引擎状态可镜像回 Store.d.srs（树园/统计/旧页面继续有效）', () => {
    const { Engine, store } = load();
    Engine.stateOf('cet6:deserve', 's0', true).level = 2;
    Engine.load().words['cet6:deserve#s0'].attempts = 3;
    const n = Engine.mirrorToSrs(store, 'cet6', id => id.split(':')[1]);
    assert.ok(n >= 1);
    assert.equal(store.d.srs.cet6.deserve.stage, 2, 'srs 镜像 stage 应等于引擎层级');
    assert.equal(store.d.srs.cet6.deserve.reps, 3);
  });

  await check('§5.3 出题：4 选 1、答案下标正确、同一词的其他义项不得当干扰项（2026-10-17 修复）', () => {
    const { Quiz } = load();
    const book = { id: 'cet6', words: [
      { w: 'scale', tr: [{ t: 'n', d: '规模' }, { t: 'n', d: '比例' }, { t: 'n', d: '鳞片' }], freq: 9 },
      { w: 'scalp', tr: [{ t: 'n', d: '头皮' }], freq: 8 },
      { w: 'scan', tr: [{ t: 'v', d: '扫描' }], freq: 7 },
      { w: 'scare', tr: [{ t: 'v', d: '惊吓' }], freq: 6 },
      { w: 'scene', tr: [{ t: 'n', d: '场景' }], freq: 5 },
    ] };
    const e = Quiz.entryOf(book, book.words[0]);
    assert.equal(e.senses.length, 3, 'senses 应按 tr 展开');
    const q = Quiz.choiceFor({ entry: e, sense: e.senses[1] }, book, { rand: () => 0.5 });
    assert.equal(q.opts.length, 4, '应给 4 个选项');
    /* 2026-10-25：选项统一带词性前缀（"n. 比例"），断言改为比较去掉前缀后的释义文本 */
    const bare = s => String(s || '').replace(/^[a-z]+\.\s*/i, '');
    assert.equal(bare(q.opts[q.answer]), '比例', '正确项必须是该义项：' + q.opts[q.answer]);
    assert.ok(!q.opts.some(o => /规模|鳞片/.test(o)),
      '同一词的其他义项不能作为干扰项（否则选项里会有多个正确释义）：' + JSON.stringify(q.opts));
    assert.equal(new Set(q.opts).size, 4, '选项不能重复');
    assert.equal(q.ids[q.answer], e.wordId + '#s1');
    assert.ok(q.ids.filter(id => id.startsWith(e.wordId + '#')).length === 1,
      '选项里必须只有本题目标词的一个义项：' + JSON.stringify(q.ids));

    /* 跨词性多义词（grave：名词/动词/形容词/副词）同样不能出现第二个自词义项 */
    const graveBook = { id: 'cetx', words: [
      { w: 'grave', tr: [
        { t: 'n', d: '坟墓；墓穴' }, { t: 'vt', d: '雕刻' },
        { t: 'adj', d: '严重的；严肃的' }, { t: 'adv', d: '沉重地' },
      ], freq: 9 },
      { w: 'graph', tr: [{ t: 'n', d: '图表' }], freq: 8 },
      { w: 'grasp', tr: [{ t: 'v', d: '抓住' }], freq: 7 },
      { w: 'grateful', tr: [{ t: 'adj', d: '感激的' }], freq: 6 },
      { w: 'gravity', tr: [{ t: 'n', d: '重力' }], freq: 5 },
      { w: 'grape', tr: [{ t: 'n', d: '葡萄' }], freq: 4 },
      { w: 'grant', tr: [{ t: 'v', d: '授予' }], freq: 3 },
    ] };
    let seed = 20261017;
    const graveRand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const grave = Quiz.entryOf(graveBook, graveBook.words[0]);
    const gq = Quiz.choiceFor({ entry: grave, sense: grave.senses[2] }, graveBook, { rand: graveRand });
    assert.equal(gq.opts.length, 4, '应给 4 个选项');
    assert.equal(String(gq.opts[gq.answer]).replace(/^[a-z]+\.\s*/i, ''), '严重的；严肃的', '正确项应是形容词义：' + gq.opts[gq.answer]);
    assert.ok(!gq.opts.some(o => /坟墓|墓穴|雕刻|沉重/.test(o)),
      '同一词的其他义项不应出现在选项里：' + JSON.stringify(gq.opts));
  });

  await check('词库适配：band 按词频分位、wordId 稳定、形近词来自同前缀', () => {
    const { Quiz } = load();
    const words = [];
    for (let i = 0; i < 60; i++) words.push({ w: 'word' + i, tr: [{ d: '释义' + i }], freq: 100 - i });
    words.push({ w: 'adapt', tr: [{ d: '适应' }], freq: 1 });
    words.push({ w: 'adopt', tr: [{ d: '采用' }], freq: 2 });
    const book = { id: 'cet6', words };
    const a = Quiz.entryOf(book, words[0]);
    const z = Quiz.entryOf(book, words[59]);
    assert.ok(a.band <= z.band, '高频词 band 不应大于低频词：' + a.band + ' vs ' + z.band);
    assert.equal(a.wordId, 'cet6:word0');
    const adapt = Quiz.entryOf(book, words[60]);
    const adopt = Quiz.entryOf(book, words[61]);
    assert.ok(adapt.confusableWith.includes(adopt.wordId), 'adapt 的形近词应包含 adopt：' + JSON.stringify(adapt.confusableWith));
  });


  await check('教学卡揭晓（"不认识"）会在本轮安排一道重考', () => {
    const { Engine } = load({ rand: 0.99 });
    const entries = [entry('w:n1', 'n1', 5), entry('w:n2', 'n2', 5)];
    const round = Engine.startRound({ entries, mode: 'new', today });
    const first = round.slots[0];
    const r = Engine.teachingReveal(first.wordId, first.senseId);
    assert.equal(r.inserted, true, '应插入重考词位');
    assert.equal(Engine.stateOf(first.wordId, first.senseId).errors, 0, '教学不算错误（不进 errorRate）');
    const has = Engine.load().round.slots.some(x => x.wordId === first.wordId && x.role === 'retry');
    assert.equal(has, true, '重考词位应在本轮队列里');
  });

  await check('轮外评分 gradeFree：随机/拼写练习也走同一套迁移与状态', () => {
    const { Engine } = load();
    const e = entry('w:free', 'free', 3);
    Engine.stateOf('w:free', 's0', true).level = 0;
    let r = Engine.gradeFree({ wordId: 'w:free', senseId: 's0', correct: true, responseMs: 2000, entry: e });
    assert.equal(r.transition.upgraded, true, 'L0 答对 → L1');
    assert.equal(Engine.stateOf('w:free', 's0').level, 1);
    Engine.stateOf('w:free', 's0').level = 4;
    Engine.stateOf('w:free', 's0').subject = 0;
    Engine.stateOf('w:free', 's0').intervalIdx = 0;
    Engine.stateOf('w:free', 's0').nextDueAt = today;
    r = Engine.gradeFree({ wordId: 'w:free', senseId: 's0', correct: false, responseMs: 2000, entry: e });
    assert.equal(Engine.stateOf('w:free', 's0').level, 2, 'L4 答错 → 打回 L2');
    assert.equal(r.feedback.demote, true);
  });


  await check('定级结果驱动"惰性起点"：跳过带→L3+抽检池，边界带→L1，起点带及以后→L0', () => {
    const { Engine } = load();
    const results = [
      { band: 0, sampled: 12, correct: 12 }, { band: 1, sampled: 12, correct: 11 },
      { band: 2, sampled: 12, correct: 10 }, { band: 3, sampled: 12, correct: 5 },
      { band: 4, sampled: 12, correct: 2 }, { band: 5, sampled: 12, correct: 1 },
    ];
    Engine.applyPlacement(Engine.placement(results, [1000, 1500, 1500, 2000, 2000, 3000]));
    const lv = b => Engine.ensurePlacementLevel(entry('w:b' + b, 'b' + b, b)).level;
    assert.equal(lv(0), 3, '跳过带 → L3');
    assert.equal(Engine.ensurePlacementLevel(entry('w:b0', 'b0', 0)).inQuizPool, true, '跳过带要进抽检池');
    assert.equal(lv(3), 0, '起点带（3）→ L0');
    assert.equal(lv(5), 0, '起点带之后 → L0');
    /* 边界带：正确率落在 0.5~0.8 —— 构造一个 */
    const r2 = [{ band: 0, sampled: 10, correct: 6 }];
    Engine.reset(); Engine.load();
    Engine.applyPlacement(Engine.placement(r2, [1000]));
    assert.equal(Engine.ensurePlacementLevel(entry('w:b0', 'b0', 0)).level, 1, '边界带 → L1');
  });

  await check('组轮会用定级结果决定新词角色（L3 的词進抽检位、L0 的进新词位）', () => {
    const { Engine } = load({ rand: 0.99 });
    const results = [
      { band: 0, sampled: 10, correct: 10 }, { band: 1, sampled: 10, correct: 10 },
    ];
    Engine.applyPlacement(Engine.placement(results, [1000, 1000]));
    const entries = [entry('w:easy', 'easy', 0), entry('w:hard', 'hard', 1)];
    const round = Engine.startRound({ entries, mode: 'smart', today });
    const roles = round.slots.map(x => x.wordId.replace('w:', '') + ':' + x.role);
    assert.ok(!roles.some(x => x.startsWith('hard:new')), '跳过带的词不该再当新词教：' + JSON.stringify(roles));
  });


  await check('定级时"抽样答对的词"一律 L3 + 抽检池（§5.1 步 3 末条）', () => {
    const { Engine } = load();
    const p = Engine.placement([{ band: 5, sampled: 10, correct: 3 }], [1000]);
    Engine.applyPlacement(p, ['w:lucky']);
    const st = Engine.ensurePlacementLevel(entry('w:lucky', 'lucky', 5));
    assert.equal(st.level, 3, '抽样答对的词即使在高带也要置 L3');
    assert.equal(st.inQuizPool, true);
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项词汇引擎检查通过');
})();
