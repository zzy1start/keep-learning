/* ============ check-ui-layout.cjs : 平板竖屏排版回归 ============
 * 2026-10-22：翻译页原来套用两列 .wr-layout，原文被挤成窄条、右侧评分栏大片空白；
 * 写作同样问题。这里锁住：翻译用 tr-layout（原文通栏 + 译文/评分并排后叠）、
 * 写作与阅读在 ≤1180px 时单列。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

check('翻译页：原文通栏，译文与 AI 评分在 tr-bottom 中并排/窄屏叠放', () => {
  const s = read('js/views/translation.js');
  assert.ok(s.includes('<div class="tr-layout">'), '缺少 tr-layout');
  assert.ok(s.includes('<div class="tr-bottom">'), '缺少 tr-bottom');
  assert.ok(!s.includes('class="wr-layout"'), '翻译页不应再用写作的双列布局');
  const css = read('css/modules.css');
  assert.ok(css.includes('.tr-layout{display:grid;grid-template-columns:minmax(0,1fr)'), 'tr-layout 应单列通栏');
  assert.ok(css.includes('.tr-bottom{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)'), 'tr-bottom 应为译文/评分两列');
  assert.ok(css.includes('@media (max-width:900px){.tr-bottom{grid-template-columns:minmax(0,1fr)}}'), '窄屏下应叠成单列');
});

check('写作页：≤1180px 也改为单列，避免左窄栏 + 右侧空白', () => {
  const css = read('css/modules.css');
  const block = css.slice(css.indexOf('@media(max-width:1180px){'), css.indexOf('@media(max-width:1180px){') + 600);
  assert.ok(block.includes('.wr-layout{grid-template-columns:minmax(0,1fr)}'), '写作在窄屏应单列');
});

check('阅读题目：落单题居中只在两列（>1180px）生效，单列/侧栏题卡保持通栏', () => {
  const css = read('css/modules.css');
  // 旧实现把“最后一道落单题居中”绑在 min-width:700px 上，但 .two-col 在 ≤1180px
  // 已折成单列，平板 1024px 下就会出现最后一题比前面窄一截、左边缩进不一致。
  assert.ok(!/@media \(min-width:700px\)\{[\s\S]{0,300}\.two-col > \.q-item:last-child:nth-child\(odd\)/.test(css),
    '落单题居中不应绑在 700px（会漏进单列布局）');
  const anchor = '.two-col > .q-item:last-child:nth-child(odd)';
  const idx = css.indexOf(anchor);
  assert.ok(idx > -1, '缺少两列落单题居中规则');
  const head = css.slice(Math.max(0, idx - 400), idx);
  assert.ok(head.includes('@media (min-width:1181px)'), '落单题居中应位于 min-width:1181px 媒体查询内');
  assert.ok(/\.read-question-side #qWrap > \.q-item:last-child:nth-child\(odd\)\{[\s\S]{0,120}max-width:none/.test(css),
    '侧栏单列题卡应取消 max-width（避免最后一题缩窄）');
  assert.ok(/\.read-question-side #qWrap \.qt\{min-height:0\}/.test(css), '侧栏单列题卡不应强制题干最小高度');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项排版检查通过');
