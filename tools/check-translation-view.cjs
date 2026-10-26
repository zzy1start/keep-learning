const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../js/views/translation.js'), 'utf8');
const exam = { id: 'exam-1', writingType: 'translation', title: 'Exam translation',
  translationText: 'Translate this paragraph into Chinese.', expectScore: 15 };
const sentences = [
  { id: 'essay-prompt', en: 'Describe the benefits of reading.', cn: '描述阅读的好处。' },
  { id: 'ky-tr-1', level: '考研', exam: 'kaoyan', en: 'The results surprised the team.', cn: '结果让团队感到意外。' },
];

function makeView(tasks = [exam]) {
  const root = { innerHTML: '', addEventListener() {}, appendChild() {} };
  const fields = {
    '#ctEn': { value: 'A custom translation source.' },
    '#ctCn': { value: '自定义翻译参考译文。' },
    '#ctS': { value: '10' },
    '#ctOk': { onclick: null },
    '#gradeBox': { innerHTML: '' },
    '#trReference': { style: {} },
    '#trPolished': { textContent: '' },
  };
  const store = { d: { translationCustomTasks: [], writeLog: [] }, addStat() {}, flush() {} };
  const aiCalls = [];
  const result = { translation: true, score: { TR: 2, CC: 2, LR: 2, GRA: 2, total: 8, max: 10 },
    comment: '评价', polished: 'A polished translation.', suggestions: {} };
  const context = vm.createContext({
    window: { gradeHTML: () => 'GRADE' },
    Dict: { content: { writing: { tasks, sentenceTasks: sentences } } },
    Store: store,
    Picker: { html: () => '<div id="trPicker"></div>', filter: items => items,
      bind(_root, items) { aiCalls.push(['picker', items.length]); } },
    AI: { ready: true, async gradeTranslation(task, answer, imgs, max, opts) {
      aiCalls.push(['translation', task, answer, imgs, max, opts]); return result;
    }, async gradeWriting() { aiCalls.push(['writing']); throw new Error('writing grader used'); } },
    App: {
      // 视图用 App.views.translation.ic 渲染头部图标，真实环境由 app.js 提供
      views: { translation: { ic: '<path d="M5 8h10"/>' } },
      freshView: () => root, toast() {}, closeModal() {},
      mmss: seconds => String(seconds),   // 计时条要显示 mm:ss
      modal(_title, _html, onMount) { onMount(fields); } },
    $: (selector, base) => base === fields ? fields[selector] :
      selector === '#trPicker' && root.innerHTML.includes('id="trPicker"') ? {} : fields[selector] || null,
    esc: value => String(value == null ? '' : value),
    // 计时器用到的全局（真实浏览器里由 window 提供）
    setInterval, clearInterval,
    document: { getElementById: () => null, querySelector: () => null },
    console,
  });
  // 真实环境里 translate-metric.js 先于视图加载（index.html 顺序），这里保持一致
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/translate-metric.js'), 'utf8'), context);
  vm.runInContext(code, context);
  return { view: context.window.ViewTranslate, root, fields, store, aiCalls };
}

let failed = 0, passed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

(async () => {
  await check('Multiple exam passages bind the picker without throwing', () => {
    const { view, root, aiCalls } = makeView([exam, { ...exam, id: 'exam-2' }]);
    view.mode = 'exam'; view._shell(root);
    assert.ok(aiCalls.some(call => call[0] === 'picker' && call[1] === 2));
  });
  await check('Translation sentences exclude writing prompts', () => {
    const { view } = makeView();
    assert.deepEqual(view._sentencePool().map(item => item.id), ["ky-tr-1"]);
  });
  await check('A custom source is saved and remains selected', () => {
    const { view, fields, store } = makeView();
    view._custom(); fields['#ctOk'].onclick();
    assert.equal(view.mode, 'custom');
    assert.equal(view.task.translationText, fields['#ctEn'].value);
    assert.equal(store.d.translationCustomTasks.length, 1);
  });
  await check('Single sentence uses translation grading and shows the reference', async () => {
    const { view, root, aiCalls } = makeView();
    view.mode = 'sentence'; view.dir = 'cn2en'; view.task = sentences[1];
    view.answer = 'The results surprised the team.';
    view._shell(root); await view._grade(root);
    assert.ok(aiCalls.some(call => call[0] === 'translation' && call[5].direction === 'cn2en'));
    assert.ok(!aiCalls.some(call => call[0] === 'writing'));
    assert.ok(root.innerHTML.includes('id="trReference"'));
  });
  await check('Layout: 原文通栏，译文与 AI 评分在 tr-bottom（窄屏单列）', () => {
    const { view, root } = makeView();
    view.mode = 'exam'; view.task = exam; view._shell(root);
    const html = root.innerHTML;
    for (const anchor of ['class="phead"', 'phead-ic', 'class="an-panel"', 'editor-tool',
      'id="trReference"', 'data-act="copy"', 'id="trTotal"', '🚀 提交并评分',
      'class="tr-layout"', 'class="tr-bottom"']) {
      assert.ok(html.includes(anchor), '翻译页缺少排版锚点：' + anchor);
    }
    assert.ok(!html.includes('class="wr-layout"'), '翻译页不应再复用写作的两列布局');
    assert.ok(html.includes('id="trCount"') && !html.includes('class="inp" id="trAns"'),
      '译文输入应使用 editor 输入区，而不是普通 inp');
    const css = fs.readFileSync(path.join(__dirname, '../css/modules.css'), 'utf8');
    assert.ok(css.includes('.tr-layout{display:grid;grid-template-columns:minmax(0,1fr)'), '缺少原文通栏样式');
    assert.ok(css.includes('@media (max-width:900px){.tr-bottom{grid-template-columns:minmax(0,1fr)}}'), '窄屏应叠成单列');
  });
  await check('Translation max score follows the task type instead of a fixed 30', () => {
    const { view } = makeView();
    view.mode = 'exam';
    assert.equal(view._maxScore({ examPaper: 'english-1' }), 10, '考研英语一翻译 10 分');
    assert.equal(view._maxScore({ examPaper: 'english-2' }), 15, '考研英语二翻译 15 分');
    assert.equal(view._maxScore({ expectScore: 20 }), 20, '题目自带满分优先');
    view.mode = 'sentence';
    assert.equal(view._maxScore({}), 20, '单句练习默认 20 分');
  });
  await check('Only one exam task still renders the filter widget (regression)', () => {
    const { view, root } = makeView([exam]);          // 仅 1 道翻译题
    view.mode = 'exam'; view.task = exam; view._shell(root);
    assert.ok(root.innerHTML.includes('id="trPicker"'),
      '只有 1 道题时也必须渲染筛选器（写作页一直如此，翻译页此前因 pool.length > 1 缺失）');
  });

  await check('No exam task means no filter widget (nothing to filter)', () => {
    const { view, root } = makeView([]);
    view.mode = 'exam'; view.task = null; view._shell(root);
    assert.ok(!root.innerHTML.includes('id="trPicker"'), '无题时不该出现空筛选器');
  });
  await check('Real Picker renders level/year/session/part selects for translation', () => {
    const pickerSrc = fs.readFileSync(path.join(__dirname, '../js/picker.js'), 'utf8');
    const pctx = vm.createContext({ window: {}, console, esc: v => String(v == null ? '' : v) });
    vm.runInContext(pickerSrc, pctx);
    const P = ctxt => ctxt.window.Picker;
    const Real = P(pctx);
    const tasks = [
      { id: 'tr-1', level: 'CET-4', year: 2026, session: '06', no: 2, title: '中国传统赠礼', pickerLabel: '翻译' },
      { id: 'tr-2', level: '考研', year: 2023, session: 'english-1', no: 1, title: '考研翻译', pickerLabel: '翻译' },
    ];
    const html = Real.html({ items: tasks, partItems: tasks, sel: {}, unitWord: '题', levelFilter: true,
      families: ['cet4', 'cet6', 'kaoyan'] });
    for (const anchor of ['id="pkLevel"', 'id="pkYear"', 'id="pkSession"', 'id="pkNo"']) {
      assert.ok(html.includes(anchor), '真实筛选器缺少 ' + anchor);
    }
    assert.ok(html.includes('题 2 / 2'), '应显示当前可用题数');
    assert.ok(html.includes('2026'), '年份下拉应包含 2026');
  });
  await check('Timer bar renders in the same place/way as the reading page', () => {
    const { view, root } = makeView([exam]);
    view.mode = 'exam'; view.task = exam; view._shell(root);
    for (const anchor of ['id="trTimerBox"', 'id="trTStart"', 'id="trLimit"', '开始计时']) {
      assert.ok(root.innerHTML.includes(anchor), '缺计时元素 ' + anchor);
    }
    let renders = 0;
    view._shell = () => { renders++; };
    view._tStart(10);
    assert.equal(view.tState, 'running');
    assert.equal(view.tLeft, 600, '10 分钟应为 600 秒');
    assert.equal(renders, 1, '开始计时后应立刻重渲染');
    view._resetTimer();
    assert.equal(view.tState, 'idle');
    assert.ok(!view.timer, '归零后 interval 必须清掉，否则会多个计时器叠加');
  });

  await check('Direction is auto-detected (Chinese source -> cn2en)', () => {
    const { view, root } = makeView([exam]);
    view.mode = 'exam'; view.task = exam; view._shell(root);
    assert.ok(root.innerHTML.includes('data-dir="auto"'), '应有「自动」档');
    assert.ok(root.innerHTML.includes('英译汉'), '应显示判定结果');
    const cnTask = { id: 'cn-1', writingType: 'translation',
      translationText: '在中国传统文化中，亲朋好友之间互赠礼物是一种重要礼仪。', expectScore: 10 };
    assert.equal(view._resolveDir(cnTask), 'cn2en', '中文原卷应自动判为汉译英');
    view.dir = 'en2cn';
    assert.equal(view._resolveDir(cnTask), 'en2cn', '手动指定应优先于自动判定');
    view.dir = 'auto';
  });
  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项翻译视图检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });