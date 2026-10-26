/* ============ check-icon.cjs : 桌面图标自检 ============ */
/* 背景：桌面快捷方式显示成默认图标（白色文档 + 箭头）时，有两种可能：
 *   ① assets/english-app.ico 或 .lnk 里的 IconLocation 有问题（文件层面，可自动检查）
 *   ② 文件都正常，只是 Windows 图标缓存没刷新（见 修复图标.bat）
 * 这个脚本负责把手动判断变成可复现的证据。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyIco } = require(path.join(__dirname, 'make-lnk.js'));

const ICON = path.join(__dirname, '..', 'assets', 'english-app.ico');
let failed = 0;
function check(name, run) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

check('图标文件存在且能被 Windows 解析（ICONDIR + 每张图数据都在文件内）', () => {
  assert.ok(fs.existsSync(ICON), '缺少 ' + ICON);
  const buf = fs.readFileSync(ICON);
  const errors = verifyIco(buf);
  assert.deepEqual(errors, [], '图标结构问题：' + errors.join('；'));
  assert.ok(buf.readUInt16LE(4) >= 3, '至少需要多档尺寸，实际 ' + buf.readUInt16LE(4) + ' 档');
});

check('图标包含资源管理器常用的小尺寸（16/32/48）', () => {
  const buf = fs.readFileSync(ICON);
  const sizes = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const o = 6 + i * 16;
    sizes.push((buf[o] || 256) + 'x' + (buf[o + 1] || 256));
  }
  for (const need of ['16x16', '32x32', '48x48']) {
    assert.ok(sizes.includes(need), '缺少 ' + need + '，实际：' + sizes.join(','));
  }
});

check('损坏的图标会被拒绝（空文件 / 截断 / 类型错误）', () => {
  assert.ok(verifyIco(Buffer.alloc(0)).length > 0);
  const good = fs.readFileSync(ICON);
  assert.ok(verifyIco(good.slice(0, 40)).length > 0, '截断文件必须报错');
  const wrongType = Buffer.from(good);
  wrongType.writeUInt16LE(2, 2);
  assert.ok(verifyIco(wrongType).some(e => e.includes('图标类型')), '类型错误必须报错');
});

check('桌面快捷方式的创建脚本会先校验图标，再写 .lnk', () => {
  const src = fs.readFileSync(path.join(__dirname, 'make-lnk.js'), 'utf8');
  const iconCheck = src.indexOf('verifyIco(fs.readFileSync(iconPath))');
  const save = src.indexOf('$link.Save()');
  assert.ok(iconCheck > 0, '缺少图标校验调用');
  assert.ok(save > 0, '缺少 .lnk 写入逻辑');
  assert.ok(iconCheck < src.indexOf('const payload'), '图标校验必须发生在生成快捷方式之前');
});

if (failed) process.exitCode = 1;
else console.log('全部 4 项图标检查通过');