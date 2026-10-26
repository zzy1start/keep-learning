/* ============ check-ui-round2.cjs : 第二轮真机走查问题回归 ============
 * 覆盖：APK 隐藏关闭服务器按钮 / 导出取消不报错 / 原生打印插件 /
 * 整句高亮 / 已掌握口径 / 篇目「导入」标识 / 限时按选项长度 / 标点残留清理。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failed = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

check('APK 上隐藏「退出学习并关闭服务器」（PWA 遗留按钮）', () => {
  const src = read('js/views/home.js');
  assert.ok(src.includes("const exitZone = root.querySelector('.exit-zone')"), '缺少 exit-zone 隐藏逻辑');
  assert.ok(src.includes('App.isNative()'), '应按原生环境判断');
  assert.ok(read('js/core.js').includes('App.isNative = () =>'), '缺少 App.isNative 帮助函数');
});

check('导出取消不报错：有取消分支 + 成功提示', () => {
  const src = read('js/core.js');
  assert.ok(/已生成 ' \+ name/.test(src), '成功应提示已生成文件');
  assert.ok(/cancel/i.test(src) && src.includes("已取消保存"), '取消分享应走「已取消」而不是抛错');
});

check('Android 打印插件：PDF 导出不再依赖 WebView window.print', () => {
  const js = read('js/pdf.js');
  assert.ok(js.includes('Plugins.Print') && js.includes('printHtml'), 'PDF.print 应优先用原生 Print 插件');
  assert.ok(js.includes("document.createElement('iframe')"), '浏览器端 iframe 打印兜底应保留');
  assert.ok(fs.existsSync(path.join(ROOT, 'android/app/src/main/java/com/keeplrn/tablet/PrintPlugin.java')), '缺少 PrintPlugin.java');
  const act = read('android/app/src/main/java/com/keeplrn/tablet/MainActivity.java');
  assert.ok(act.includes('registerPlugin(PrintPlugin.class)'), 'PrintPlugin 未注册');
  const java = read('android/app/src/main/java/com/keeplrn/tablet/PrintPlugin.java');
  assert.ok(java.includes('PrintManager') && java.includes('createPrintDocumentAdapter'), '插件应调用系统打印框架');
});

check('长难句模式点词/句：整句每个词都高亮（提示与视觉一致）', () => {
  const src = read('js/views/reading.js');
  const m = src.match(/_setTransientSentence\(node\) \{([\s\S]*?)\n  \},/);
  assert.ok(m, '找不到 _setTransientSentence');
  assert.ok(m[1].includes("querySelectorAll('[data-w]')") && m[1].includes('forEach'), '应对句内每个词上色');
});

check('「已掌握」统一按词书口径（L4 且作答过），生词本手动标记改名', () => {
  const stats = read('js/views/stats.js');
  assert.ok(stats.includes('masteredTotal'), '统计应汇总词书已掌握');
  assert.ok(!stats.includes("['已掌握', d.notebook.filter"), '统计的已掌握不应再用生词本手动标记');
  const nb = read('js/views/notebook.js');
  assert.ok(nb.includes('手动标记'), '生词本应改为「手动标记」');
  assert.ok(!nb.includes("['mastered', '已掌握'"), '生词本筛选不应再用「已掌握」');
});

check('听力/阅读/写作篇目加来源标识，内置与导入不再同名混淆', () => {
  const picker = read('js/picker.js');
  assert.ok(picker.includes("item.mine ? '（导入）'"), 'Picker.partLabel 应标出来源');
  assert.ok(read('js/views/listening.js').includes("p.mine ? '（导入）'"), '听力篇目 tab 应标出导入');
  const ctx = vm.createContext({ window: {}, console });
  vm.runInContext(picker, ctx);
  const P = ctx.window.Picker;
  const label = P.partLabel({ no: 1, title: 'Conversation 1', mine: true, questions: [1] }, 0, '篇');
  assert.ok(label.includes('（导入）'), '导入篇目标签应带（导入）: ' + label);
  assert.ok(!P.partLabel({ no: 1, title: 'The Problem with Speed' }, 0, '篇').includes('（导入）'), '内置不应标导入');
});

check('单词限时按选项阅读量加时（4 行英文释义不再 5s 硬判错）', () => {
  const src = read('js/views/vocab.js');
  assert.ok(src.includes("document.querySelectorAll('#view .choice')"), '应统计选项文本长度');
  assert.ok(src.includes('chars > 120') && src.includes('limit +='), '应按阅读量给限时加余量');
});

check('PDF 标点残留：导入时清理 + 旧存档一次性迁移', () => {
  assert.ok(read('js/importer.js').includes('/\\.\\s*,\\s*/g'), '导入 polish 应去掉「句号后多余逗号」');
  const store = read('js/store.js');
  assert.ok(store.includes('__punctRepairV1'), '旧存档需要一次性迁移标记');
  assert.ok(store.includes('contentBackup'), '迁移应覆盖导入内容备份');
});

check('写作「AI 练习题」：点 tab 即出 AI 题，不再显示内置真题；来源标 AI 生成', () => {
  const src = read('js/views/writing.js');
  assert.ok(src.includes("this.tab === 'ai' && !(this.curTask && String(this.curTask.id || '').startsWith('ai'))"), '缺少进入 AI tab 自动出题');
  assert.ok(src.includes('this._genTask();'), '应调用 _genTask');
  assert.ok(src.includes("'AI 生成题目'"), 'AI 题应标明来源');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + passed + ' 项第二轮走查回归通过');