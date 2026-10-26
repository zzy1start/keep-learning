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
