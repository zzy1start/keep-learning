/* ============ check-listening-playback-refresh.cjs : 补充听力后播放状态刷新 ============
 * 用户反馈（2026-10-26）：
 *   「当点击互联网补充听力后，如果补充完整后，点击播放会直接会播放题干语音，
 *     补充听力后要刷新当前听力文本状态。」
 *
 * 根因（本自检锁定）：
 *   _bindCommon 在**绑定点击事件时**就把原文行快照成常量（lines = $$('.script-line' …)），
 *   而联网补充原文是进篇之后才异步完成、只做局部重渲染（_refreshPassage）。
 *   重渲染不会重绑事件 → 补全后点播放，闭包里读到的还是补全前的空数组：
 *   原文一步被跳过，直接进题干播报，听起来就是「补全后只读题干」。
 *   题干也有一模一样的快照问题（dataStems 在绑定时就算好了）。
 *
 * 覆盖：
 *   A. 绑定之后原文才补进页面（模拟联网补全 + _refreshPassage 重渲染）→ 点播放必须读新原文；
 *   B. 绑定之后题干才补齐 → 点播放必须读新题干；
 *   C. 源码接线：所有播放路径都必须“点击时现取”（linesNow()/dataStems()），不能退回快照。
 *
 * 运行：node tools/check-listening-playback-refresh.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');

let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 行元素桩：播放只读 dataset.say 与 classList，外加高亮用 getBoundingClientRect。 */
function lineNode(text) {
  return {
    dataset: { say: text },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
  };
}

function makeHarness() {
  const handlers = [];
  const state = { lines: [] };          // 模拟 #scriptCard 里当前渲染出来的 .script-line
  const plays = [];
  const statusEl = { innerHTML: '' };
  const ctx = vm.createContext({
    window: {},
    console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, RegExp, Error,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    App: { toast() {}, modal() {}, closeModal() {}, freshNode: () => null },
    $: sel => (sel === '#playStatus' ? statusEl : (sel === '#spd' ? { value: '1' } : null)),
    $$: sel => (sel === '.script-line' ? state.lines : []),
    esc: v => String(v == null ? '' : v),
    on: (root, evt, sel, fn) => { handlers.push({ sel, fn }); },
    Store: { d: { settings: { speechRate: 1, listenLeadIn: 0 } }, flush() {} },
    AI: { ready: false },
    Speech: {
      voices: ['test-voice'], primeAudio() {}, prefetch() {}, stop() {}, stopIfBusy() {},
      chime: () => Promise.resolve(true), hasLang: () => true,
      speak() {},
    },
  });
  vm.runInContext(SRC, ctx);
  const view = ctx.window.ViewListen;
  view.kind = 'cet6';
  view.mode = 'read';
  /* 只截获「原文 + 题干」这两样，播放细节由 check-listening-exam.cjs 覆盖 */
  view._playExamOrder = async (lines, stems) => { plays.push({ lines: lines || [], stems: stems || [] }); };
  view._playLines = async () => {};
  view.stopHL = () => {};
  return { view, handlers, state, plays, statusEl };
}

const clickAct = (handlers, act) => {
  const h = handlers.find(x => x.sel === '[data-act]');
  assert.ok(h, '没找到 [data-act] 点击处理器');
  const target = { dataset: { act }, classList: { add() {}, remove() {} } };
  return h.fn({}, target);
};

(async () => {
  await check('A. 绑定后才补进原文（联网补全 + 局部重渲染）→ 点播放读到新原文，不再是空数组', async () => {
    const m = makeHarness();
    const item = {
      id: 'imp-playback-refresh', type: 'cet6', title: 'Questions 1 to 4',
      script: [], qs: [{ q: '', opts: ['A1', 'B1', 'C1', 'D1'] }],
    };
    m.view._bindCommon({}, '', item);

    /* 绑定还没发生时：没有原文，点播放只能读到 0 行（这一步是补全前的真实现状） */
    await clickAct(m.handlers, 'play');
    await sleep(5);
    assert.equal(m.plays.length, 1, '第一次点击应只产生一次播放');
    assert.equal(m.plays[0].lines.length, 0, '补全前本来就没有原文');

    /* 模拟联网补全完成：applyPatches 把 script 写进篇目，_refreshPassage 重渲染原文卡 */
    item.script = [{ s: 0, en: '1M: Hello, doctor.' }, { s: 1, en: '2W: Please take a seat.' }];
    m.state.lines = m.view._normalizeSpeakerLines(item.script)
      .map(l => lineNode(l.en));   // 重渲染后的 DOM 行（data-say 用规范文本）

    await clickAct(m.handlers, 'play');
    await sleep(5);
    assert.equal(m.plays.length, 2, '第二次点击应再产生一次播放');
    assert.equal(m.plays[1].lines.map(x => x.text).join(' | '), 'Hello, doctor. | Please take a seat.',
      '补充原文后点播放必须读新补进来的原文（且不念 1M/2W 标记），实际：'
      + JSON.stringify(m.plays[1].lines.map(x => x.text)));
  });

  await check('B. 绑定后才补齐题干（联网补全题干）→ 点播放读到新题干', async () => {
    const m = makeHarness();
    const item = {
      id: 'imp-playback-stem', type: 'cet6', title: 'Questions 1 to 4',
      script: [{ s: 0, en: 'M: Hello, doctor.' }], qs: [{ q: '', opts: ['A1', 'B1', 'C1', 'D1'] }],
    };
    m.state.lines = [lineNode('Hello, doctor.')];
    m.view._bindCommon({}, '', item);
    await clickAct(m.handlers, 'play');
    await sleep(5);
    assert.equal(m.plays.length, 1);

    /* 题干随后补入（_applyPatches 写 q.q，_renderQuiz 重渲染答题卡） */
    item.qs = [{ q: 'Why does the man go to see the doctor?', opts: ['A1', 'B1', 'C1', 'D1'] }];
    await clickAct(m.handlers, 'play');
    await sleep(5);
    assert.equal(m.plays.length, 2);
    assert.ok(m.plays[1].stems.length === 1, '补全题干后应读到 1 道题干，实际 ' + m.plays[1].stems.length);
    assert.ok(/Why does the man go to see the doctor\?/.test(String(m.plays[1].stems[0].text)),
      '补全题干后点播放必须读新题干，实际：' + JSON.stringify(m.plays[1].stems[0].text));
  });

  await check('C. 源码接线：原文/题干都在点击时现取（不能退回绑定时快照）', async () => {
    assert.ok(/const linesNow = \(\) => \$\$\('\.script-line'/.test(SRC),
      '应有点击时读取原文行的 linesNow()');
    assert.ok(/this\._playExamOrder\(linesNow\(\), stemsNow\(\),/.test(SRC),
      '考场顺序播放必须在点击时取原文（linesNow()）');
    assert.ok(/const playSentence = session => this\._playLines\(linesNow\(\),/.test(SRC),
      '单句播放必须在点击时取原文（linesNow()）');
    assert.ok(/this\._playLines\(linesNow\(\), \{ rate: rate\(\), session \}\)/.test(SRC),
      '循环播放在点击/每轮开始时取原文（linesNow()）');
    assert.ok(/this\._seqRead\(linesNow\(\), rate\(\)\)/.test(SRC),
      '逐句复现必须在点击时取原文（linesNow()）');
    assert.ok(/const dataStems = \(\) =>/.test(SRC),
      '题干数据兜底必须每次现取（item.qs 会在补全后更新），不能是绑定时快照');
    assert.ok(!/const lines = \$\$\(\'\.script-line\', box\)/.test(SRC),
      '不应再出现绑定时快照的 const lines = $$(\'.script-line\', box)');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项「补充听力后播放刷新」检查通过');
})();
