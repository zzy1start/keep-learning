/* ============ check-feedback-mail.cjs : 反馈入口回归 ============
 * 2026-10-26 开源发布：反馈从个人邮箱改为 GitHub Issues。
 * 锁住：设置页「关于」里有 Issues 链接、外链属性、复制兜底，且不再出现个人邮箱/手机号。
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
const SETTINGS = read('js/views/settings.js');
const URL = 'https://github.com/zzy1start/keep-learning/issues';

check('设置页「关于」里有 GitHub Issues 链接', () => {
  assert.ok(SETTINGS.includes(URL), '缺少 Issues 链接');
  assert.ok(SETTINGS.includes('id="fbMail"'), '缺少 fbMail 入口');
});

check('Issues 链接是新窗口打开（target=_blank + rel=noopener）', () => {
  assert.ok(SETTINGS.includes('target="_blank"'), '缺少 target="_blank"');
  assert.ok(SETTINGS.includes('rel="noopener"'), '缺少 rel="noopener"');
});

check('不再出现个人邮箱/手机号', () => {
  assert.ok(!/@163\.com/.test(SETTINGS), '仍存在 163 邮箱');
  assert.ok(!/\b1[3-9]\d{9}\b/.test(SETTINGS), '仍存在手机号');
  assert.ok(!SETTINGS.includes('mailto:'), '仍存在 mailto 链接');
});

check('有「复制链接」按钮与剪贴板兜底（APK WebView 里外链可能打不开）', () => {
  assert.ok(SETTINGS.includes('id="btnCopyMail"'), '缺少复制按钮');
  assert.ok(SETTINGS.includes('navigator.clipboard'), '复制按钮应优先用 clipboard API');
  assert.ok(SETTINGS.includes("execCommand('copy')"), 'clipboard 不可用时应退回 execCommand');
  assert.ok(SETTINGS.includes('issues/new/choose'), '复制内容应是 Issues 链接');
});

check('反馈入口在「关于」卡片内（不是别处误放）', () => {
  const i = SETTINGS.indexOf('反馈与建议');
  assert.ok(i > 0, '缺少「反馈与建议」标题');
  const about = SETTINGS.indexOf('>关于<');
  assert.ok(about > 0 && i > about, '反馈入口应在「关于」卡片之后');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项反馈入口检查通过');
