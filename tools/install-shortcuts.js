/* 在桌面创建 Keep Learning 快捷方式：启动本地服务并自动打开学习页面。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLnk, verifyLnk } = require('./make-lnk');

const APP = path.join(__dirname, '..');
const PORT = 8777;
const URL = `http://127.0.0.1:${PORT}/`;
const desktop = path.join(os.homedir(), 'Desktop');
const SERVE = path.join(APP, 'serve.js');
const ICON = path.join(APP, 'assets', 'english-app.ico');
const LNK = path.join(desktop, 'Keep Learning.lnk');

const created = [];

/* 主入口指向 node.exe，参数为 serve.js + 固定端口 + 自动开页开关。
 * make-lnk.js 调用 Windows 自带的 Shell Link COM 接口并读回关键字段。 */
let mode = '.lnk（Windows Shell Link 接口生成）';

/* 0) 先清理历史遗留的旧图标
 * 历次迭代在桌面留下过：Keep Learning 英语学习.url、Keep Learning 启动.bat、
 * Keep Learning 停止服务.url。它们的名称都带 "Keep Learning"，
 * 与主图标并排显示时用户会以为是几个不同的应用。
 * 这里只删明确由本脚本创建的已知文件名，不碰用户自己的东西。*/
const LEGACY = [
  'Keep Learning 英语学习.url',
  'Keep Learning 启动.bat',
  'Keep Learning 停止服务.url',
];
let cleaned = 0;
for (const name of LEGACY) {
  const p = path.join(desktop, name);
  try {
    if (fs.existsSync(p)) { fs.unlinkSync(p); cleaned++; }
  } catch (e) { /* 占用中则跳过，不影响主流程 */ }
}
if (cleaned) console.log(`  已清理 ${cleaned} 个旧图标`);

try {
  const args = `"${SERVE}" ${PORT} --open`;
  createLnk(process.execPath, args, APP, 'Keep Learning', LNK, ICON);

  // 读回桌面文件，校验结构与本次启动参数。
  const bad = verifyLnk(fs.readFileSync(LNK), ['serve.js', String(PORT), '--open']);
  if (bad.length) throw new Error('字段校验失败: ' + bad.join(', '));
  created.push(LNK);
} catch (e) {
  // 不留下已知无效的旧 .lnk；有效旧链接保留，随后仍提供 .bat 回退入口。
  try {
    if (fs.existsSync(LNK)
      && verifyLnk(fs.readFileSync(LNK), ['serve.js', String(PORT), '--open']).length) {
      fs.unlinkSync(LNK);
    }
  } catch (removeError) { /* 若文件被占用，保留安装失败信息 */ }
  console.log('  [!] .lnk 创建失败: ' + e.message);
  mode = '.bat 回退方案';
}

// 2) 回退：.lnk 不可用时，复制启动 bat 到桌面（会显示命令行窗口）
if (!created.length) {
  const bat = path.join(APP, '启动.bat');
  if (fs.existsSync(bat)) {
    const dst = path.join(desktop, 'Keep Learning 启动.bat');
    fs.copyFileSync(bat, dst);
    created.push(dst);
  }
}

// 3) 停止服务：保留一个入口（这个用 .url 指向 bat 即可，能点开就行）
/* 【只留一个图标】
 * 之前额外放了「Keep Learning 停止服务.url」，与主页新增的
 *「退出学习并关闭服务器」按钮功能重复。
 * 名称都带 "Keep Learning"，用户会误以为是两个同款应用、
 * 不知道该点哪个。现在桌面只保留主图标，停止服务走主页按钮。
 * 如需命令行方式，english-app 目录下的 停止服务.bat 仍然可用。
 */

console.log('快捷方式创建方式：' + mode);
console.log('已在桌面创建：');
created.forEach(p => console.log('  + ' + path.basename(p)));

// 校验
console.log('\n校验：');
let bad = 0;
created.forEach(p => {
  const ok = fs.existsSync(p);
  console.log(`  ${ok ? '+' : 'x'} ${path.basename(p)}  ${ok ? fs.statSync(p).size : 0} bytes`);
  if (!ok) bad++;
});

// .bat 必须是纯 ASCII，否则 cmd 下中文乱码会导致命令被截断、脚本失效
['启动.bat', '停止服务.bat'].forEach(f => {
  const p = path.join(APP, f);
  if (!fs.existsSync(p)) return;
  const buf = fs.readFileSync(p);
  const nonAscii = [...buf].filter(x => x > 127).length;
  console.log(`  ${nonAscii === 0 ? '+' : 'x'} ${f} 纯ASCII（${nonAscii} 个非ASCII字节）`);
  if (nonAscii > 0) bad++;
});

// 校验启动器与退出接口都存在
[['serve.js', '本地服务器（含 --open 自动开页）']].forEach(([f, label]) => {
  const ok = fs.existsSync(path.join(APP, f));
  console.log(`  ${ok ? '+' : 'x'} ${label} ${f}`);
  if (!ok) bad++;
});

// 确认 serve.js 里确实实现了 --open，否则快捷方式开了也不开页面
try {
  const src = fs.readFileSync(path.join(APP, 'serve.js'), 'utf8');
  const ok = src.includes('--open') && src.includes('start');
  console.log(`  ${ok ? '+' : 'x'} serve.js 支持 --open 自动打开浏览器`);
  if (!ok) bad++;
} catch (e) { /* 上面已检查文件存在 */ }

console.log(bad ? `\n有 ${bad} 项异常，请检查` : '\n全部正常');
