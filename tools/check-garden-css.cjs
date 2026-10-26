/* ============ check-garden-css.cjs : 树园/页面样式完整性回归 ============
 * 2026-10-22 事故：css/modules.css 被一次错误编辑截断——`.lt-halo{` 少了后面的声明和 `}`，
 * 同时文件末尾 341 行（树园状态卡 / 图例 / 树种库 / 导出弹窗样式）被整段删除。
 * 浏览器遇到未闭合的声明块会把后续规则一并吞掉，表现就是「树园排版全乱」。
 * 本回归锁住三件事：
 *   1) 所有 CSS 文件结构合法（括号 / 注释 / 字符串闭合）；
 *   2) modules.css 体积没有再次异常缩水；
 *   3) 树园与导出弹窗的关键选择器都还在。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

/** 极简 CSS 结构校验：返回错误数组（行号 + 原因） */
function cssErrors(text) {
  const errs = [];
  let i = 0, depth = 0, line = 1;
  const stack = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') line++;
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) { errs.push('line ' + line + ': 注释未闭合'); break; }
      line += (text.slice(i, end).match(/\n/g) || []).length;
      i = end + 2; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; if (text[i] === '\n') line++; i++; }
      if (i >= text.length) { errs.push('line ' + line + ': 字符串未闭合'); break; }
      i++; continue;
    }
    if (c === '{') { depth++; stack.push(line); }
    else if (c === '}') { depth--; stack.pop(); if (depth < 0) { errs.push('line ' + line + ': 多余的 }'); depth = 0; } }
    i++;
  }
  if (depth > 0) errs.push('文件结束时还有 ' + depth + ' 个未闭合的 {（最近一次在 line ' + stack[stack.length - 1] + '）');
  return errs;
}

check('CSS 结构完整：四个样式文件括号/注释/字符串全部闭合', () => {
  for (const f of ['css/base.css', 'css/modules.css', 'css/shell.css', 'css/pages-mobile.css']) {
    const errs = cssErrors(read(f));
    assert.deepEqual(errs, [], f + ' 结构错误: ' + errs.join('; '));
  }
});

check('modules.css 没有再次被截断（体积 ≥ 60000 字节，行数 ≥ 1000）', () => {
  const css = read('css/modules.css');
  assert.ok(Buffer.byteLength(css, 'utf8') >= 60000, 'modules.css 只有 ' + Buffer.byteLength(css, 'utf8') + ' 字节，疑似被截断');
  assert.ok(css.split('\n').length >= 1000, 'modules.css 只有 ' + css.split('\n').length + ' 行，疑似被截断');
});

check('树园关键选择器都在（lawn / lt-* / 状态卡 / 图例 / 树种库 / 校树）', () => {
  const css = read('css/modules.css');
  const must = ['.lawn{', '.lawn-title', '.lawn-body{', '.lawn-tree', '.lt-halo{', '.lt-tag{',
    '.lawn-empty{', '.le-t{', '.le-s{', '.lawn-legend{', '.lg.long', '.lg.stump',
    '.tcard-row{', '.tcard{', '.tcard-flag', '.tcard-art', '.tcard-state', '.tcard-bar', '.tcard-date',
    '.garden-head{', '.gh-title', '.school-note', '.sp-grid{', '.sp-card{', '.sp-item', '.gpanel'];
  const missing = must.filter(sel => !css.includes(sel));
  assert.deepEqual(missing, [], '缺少树园样式: ' + missing.join(', '));
});

check('导出弹窗 / 设置页折叠区样式都在（上一轮被截断的尾部）', () => {
  const css = read('css/modules.css');
  const must = ['.ex-day-row', '.ex-row{', '.ex-radio{', '.ex-hint{', '.adv-diag{', '.adv-body{'];
  const missing = must.filter(sel => !css.includes(sel));
  assert.deepEqual(missing, [], '缺少样式: ' + missing.join(', '));
});

check('树园 markup 用到的所有 class 都有样式（或属于已知无样式的容器）', () => {
  const css = ['css/base.css', 'css/modules.css', 'css/shell.css', 'css/pages-mobile.css'].map(read).join('\n');
  const defined = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]));
  const src = read('js/garden-view.js');
  const used = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const tok of m[1].split(/[\s${}{}?:]+/)) if (/^[a-zA-Z_][\w-]*$/.test(tok)) used.add(tok);
  }
  /* 纯容器 / 由 JS 动态切换的 token（isCur、kind 等）不参与断言 */
  const allow = new Set(['gh-left', 'garden-tree-art', 'rt-info', 'isCur', 'isSchool', 'kind']);
  const missing = [...used].filter(c => !defined.has(c) && !allow.has(c)).sort();
  assert.deepEqual(missing, [], '这些 class 在 CSS 里找不到规则: ' + missing.join(', '));
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项树园样式检查通过');