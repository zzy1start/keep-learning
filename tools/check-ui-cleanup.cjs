/* ============ check-ui-cleanup.cjs : 方案A 冗余入口清理回归 ============
 * 断言：重复按钮已删、AI 辅助改名、阅读导出改名、设置诊断已折叠。
 * 若以后有人把入口加回来，这里会失败。
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

check('写作/翻译：顶部「开始批改 / 评分」已删，只保留底部提交并评分', () => {
  for (const p of ['js/views/writing.js', 'js/views/translation.js']) {
    const s = read(p);
    assert.ok(!s.includes('开始批改 / 评分'), p + ' 仍有顶部批改按钮');
    assert.ok(s.includes('提交并评分'), p + ' 缺少底部提交按钮');
  }
});

check('阅读页：顶部「生词本」重复入口已删；导出按钮改名为「导出阅读生词 PDF」', () => {
  const s = read('js/views/reading.js');
  assert.ok(!s.includes('data-act="nb">生词本'), '阅读页仍保留生词本按钮');
  assert.ok(s.includes('导出阅读生词 PDF'), '导出按钮未改名');
});

check('统计页：顶部「导出学习报告 PDF / 备份数据」重复按钮已删', () => {
  const s = read('js/views/stats.js');
  assert.ok(!s.includes('data-act="report">导出学习报告 PDF'), '统计页仍有导出按钮');
  assert.ok(!s.includes('data-act="backup">备份数据'), '统计页仍有备份按钮');
});

check('设置→数据管理：只删重复的「导出生词本」；学习报告 PDF 保留唯一入口', () => {
  const s = read('js/views/settings.js');
  assert.ok(!s.includes('data-act="exportNb"'), '设置仍有导出生词本');
  assert.ok(s.includes('data-act="report">学习报告 PDF'), '学习报告 PDF 应保留在设置页唯一入口');
  assert.ok(!read('js/views/stats.js').includes('data-act="report"'), '统计页不应再有重复入口');
});

check('设置→词库：调试按钮「重新统计词库规模」已删，绑定有空值保护', () => {
  const s = read('js/views/settings.js');
  assert.ok(!s.includes('>重新统计词库规模<'), '按钮仍在');
  assert.ok(s.includes("const rb = $('#reloadBooks')") && s.includes('if (rb) rb.onclick'), '绑定未加空值保护');
});

check('单词页：新词卡片里重复的「做词汇量测试」按钮已删，只留顶部入口', () => {
  const s = read('js/views/vocab.js');
  const n = (s.match(/data-act="test"/g) || []).length;
  assert.equal(n, 1, 'data-act="test" 应只剩 1 处，实际 ' + n);
});

check('写作「AI 辅助开关」改名为「AI 辅助说明」', () => {
  const s = read('js/views/writing.js');
  assert.ok(s.includes('AI 辅助说明'), '未改名');
  assert.ok(!s.includes('AI 辅助开关'), '旧文案仍在');
});

check('设置页诊断入口收进 <details> 高级折叠，主界面保留试听句子', () => {
  const s = read('js/views/settings.js');
  assert.ok(s.includes('<details class="adv-diag">'), '缺少折叠容器');
  assert.ok(s.includes('发音与音色诊断（高级）'), '缺少折叠标题');
  assert.ok(s.includes('id="testSay"'), '主界面应保留试听句子');
  const idx = s.indexOf('<details class="adv-diag">');
  for (const id of ['testWord', 'testVoices', 'diagRefresh', 'autoVoices', 'voiceDiag', 'cloudRetry', 'testOnlineTts']) {
    const at = s.indexOf('id="' + id + '"');
    assert.ok(at > idx, id + ' 未收进折叠区');
  }
  assert.ok(read('css/modules.css').includes('.adv-diag'), '缺少折叠区样式');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项冗余入口清理检查通过');