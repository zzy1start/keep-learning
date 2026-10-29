/* ============ check-listening-speakers.cjs : 导入原文的说话人标签回归 ============
 * 用户要求：导出/导入的四六级听力在 AI 取到文本后，按文本男女对问朗读。
 * 现实：内置数据有 sp 字段；导入文本/AI 原文常写成 "W: ..." / "Man: ..."。
 * 这种情况必须：① 不把「W:」念出来；② 能识别成男女说话人，交给语音库切换音色。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, Promise, Object, Array, String, Number, JSON, Math, Date, RegExp, Error,
  document: { querySelector: () => null, getElementById: () => null, querySelectorAll: () => [] },
  window: {},
  Store: { d: { settings: {}, contentBackup: null }, flush() {} },
  App: { toast() {}, modal() {}, closeModal() {} },
  Speech: { speak() {}, stop() {}, prefetch() {}, _forceGender: '', gender: 'female' },
  $: () => null, $$: () => [], esc: s => String(s == null ? '' : s),
  AI: { ready: false },
  analyzeScript: null,
});
ctx.window = ctx.window;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8'), ctx);
const V = vm.runInContext('ViewListen', ctx);

check('W:/M:/Man:/Woman: 前缀 → 拆出 sp 并去掉前缀（不会念「W colon」）', () => {
  const out = V._normalizeSpeakerLines([
    { en: 'W: Hi, are you volunteering this Saturday?' },
    { en: 'Man: I signed up yesterday.' },
    { en: 'Woman：This is the student centre.' },
    { en: 'M: Good morning.' },
  ]);
  assert.equal(out[0].en, 'Hi, are you volunteering this Saturday?');
  assert.equal(out[0].sp, 'W');
  assert.equal(out[1].en, 'I signed up yesterday.');
  assert.equal(out[1].sp, 'M');
  assert.equal(out[2].en, 'This is the student centre.');
  assert.equal(out[2].sp, 'W');
  assert.equal(out[3].en, 'Good morning.');
  assert.equal(out[3].sp, 'M');
});

check('没有标签的行保持原样（旁白/题干不误判）', () => {
  const out = V._normalizeSpeakerLines([
    { en: 'Questions 1 to 5 are based on the conversation.' },
    { en: 'Attention please, all students.' },
  ]);
  assert.equal(out[0].en, 'Questions 1 to 5 are based on the conversation.');
  assert.equal(out[0].sp, undefined);
  assert.equal(out[1].sp, undefined);
});

check('内置数据原有 sp 不被覆盖，文本也不变', () => {
  const out = V._normalizeSpeakerLines([{ sp: 'W', en: 'I lost a black umbrella last Tuesday.' }]);
  assert.equal(out[0].sp, 'W');
  assert.equal(out[0].en, 'I lost a black umbrella last Tuesday.');
});


const parseSpeakerLabel = vm.runInContext('parseSpeakerLabel', ctx);
check('联网原文的「轮次号 + 说话人」标签：1M:/2W:/1. W:/W1: 都能拆出性别与干净文本', () => {
  const cases = [
    ['1M: Hello, doctor.', 'M', 'Hello, doctor.'],
    ['2W：Hello, please take a seat.', 'W', 'Hello, please take a seat.'],
    ['3 M: So then why do I feel so poorly?', 'M', 'So then why do I feel so poorly?'],
    ['4. Woman: It is probably due to overwork.', 'W', 'It is probably due to overwork.'],
    ['5、Man：No, it can not be.', 'M', 'No, it can not be.'],
    ['10W: That is right.', 'W', 'That is right.'],
    ['W6: Yes, most days.', 'W', 'Yes, most days.'],
    ['M7: But what about my feeling tired?', 'M', 'But what about my feeling tired?'],
    ['Speaker 2: Good morning.', '', 'Good morning.'],
    ['(12) W: Nice to meet you.', 'W', 'Nice to meet you.'],
  ];
  cases.forEach(([raw, sp, text]) => {
    const got = parseSpeakerLabel(raw);
    assert.ok(got, '应识别为说话人标签：' + raw);
    assert.equal(got.sp, sp, '性别不符：' + raw + ' → ' + got.sp);
    assert.equal(got.text, text, '去标签后的文本不符：' + raw + ' → ' + got.text);
  });
});

check('不是说话人标签的行一律原样保留（不误删正文/数字）', () => {
  const lines = [
    'Questions 1 to 4 are based on the conversation you have just heard.',
    '1.5 million people live in this city.',
    'M is the thirteenth letter of the alphabet.',
    'The man said he would come at 10:30.',
  ];
  lines.forEach(raw => assert.equal(parseSpeakerLabel(raw), null, '不应误判：' + raw));
});

check('★ 导入/联网原文带编号标签时：_normalizeSpeakerLines 同时去标签 + 赋性别（不再念「1M」）', () => {
  const out = V._normalizeSpeakerLines([
    { en: '1M: Hello, doctor.' },
    { en: '2W：Hello, please take a seat.' },
    { en: '3 M: So then why do I feel so poorly?' },
    { en: '4. Woman: It is probably due to overwork.' },
    { en: 'W5: Yes, most days.' },
  ]);
  assert.deepEqual(out.map(l => l.en), [
    'Hello, doctor.',
    'Hello, please take a seat.',
    'So then why do I feel so poorly?',
    'It is probably due to overwork.',
    'Yes, most days.',
  ]);
  assert.deepEqual(out.map(l => l.sp), ['M', 'W', 'M', 'W', 'W']);
});

check('★ 原文行显示：行号 + 说话人标签只出现一次，data-say 不含「1M:」', () => {
  const card = { innerHTML: '' };
  const lines = V._normalizeSpeakerLines([{ en: '1M: Hello, doctor.' }, { en: '2W: Please take a seat.' }]);
  V._script(card, lines, 'Questions 1 to 4');
  const html = String(card.innerHTML);
  assert.ok(html.indexOf('data-say="Hello, doctor."') >= 0, 'data-say 应是干净文本：' + html);
  assert.ok(html.indexOf('data-say="Please take a seat."') >= 0, 'data-say 应是干净文本：' + html);
  assert.ok(!/data-say="1M:/.test(html), 'data-say 不能带 1M: 前缀');
  assert.ok(/<span class="n">1<\/span>/.test(html), '行号应正常显示');
  assert.ok(/<b class="sp">M<\/b>/.test(html), '说话人标签应显示一次（M）');
  assert.ok(!/1M:/.test(html), '页面文本里不应再出现 1M: 这种重复标记');
});

const cleanStemText = vm.runInContext('cleanStemText', ctx);
check('★ 题干里从口播带出来的「3M:/2W:」也要去掉（显示/朗读都不能念轮次号）', () => {
  assert.equal(cleanStemText('3M: So then why do I feel so poorly all the time?'),
    'So then why do I feel so poorly all the time?');
  assert.equal(cleanStemText('12W: That is not all.'), 'That is not all.');
  assert.equal(cleanStemText('Question 5. 3M: Why did the speaker retire so early?'),
    'Why did the speaker retire so early?');
  assert.equal(cleanStemText('5. What is the main idea?'), 'What is the main idea?');
  // 正文里的数字不能被当成题号删掉
  assert.equal(cleanStemText('25 million people live in this city.'), '25 million people live in this city.');
  assert.equal(cleanStemText('Why does the man go to see the doctor?'), 'Why does the man go to see the doctor?');
});

check('★ _stemInfo：库存里的旧题干带 3M: 前缀，显示时也要干净', () => {
  const st = V._stemInfo({ q: '3M: So then why do I feel so poorly all the time?', opts: [] }, 0, { title: 'Questions 1 to 4' });
  assert.equal(st.text, 'So then why do I feel so poorly all the time?');
  assert.equal(st.missing, false);
});

check('_passage 走统一规范化（源码接线，不回归成直接读 p.script）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
  assert.ok(/const lines = this\._normalizeSpeakerLines\(p\.script \|\| \[\]\)/.test(src), '未接 _normalizeSpeakerLines');
});

(async () => {
  /* async 用例：手动跑最后一条 */
  await check('detectGenders：带 M/W 标签 → 男女对话 + 逐行性别映射', async () => {
    const info = await V.detectGenders([
      { sp: 'W', en: 'Hi, are you volunteering?' },
      { sp: 'M', en: 'I signed up yesterday.' },
    ]);
    assert.ok(/男女/.test(String(info)), '应识别为男女对话，实际：' + info);
    assert.equal(V._spGender[0], 'female');
    assert.equal(V._spGender[1], 'male');
  });
  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项说话人标签检查通过');
})();
