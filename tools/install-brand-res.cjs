/* ============ install-brand-res.cjs : 把品牌图标/启动页装进 Android 工程 ============
 * 背景（1.1.48 事故）：android/ 不入库，tools/init-android.cjs 用 `npx cap add android`
 * 从 Capacitor 模板重建工程。模板自带的 ic_launcher / splash 是 Capacitor 默认素材
 * （蓝色 X + 网格）；10/29 手工换上的 ZY 品牌标在工程重建后被覆盖，导致 1.1.48 的
 * 桌面图标与开屏启动页退回默认素材。
 *
 * 修复：品牌素材入库到 native/android/brand-res/，本脚本把它覆盖到
 * android/app/src/main/res/，由 tools/init-android.cjs 在 `cap add/sync` 之后自动调用。
 *
 * 用法：
 *   node tools/install-brand-res.cjs            # 安装（要求 android/ 工程已存在）
 *   node tools/install-brand-res.cjs --check    # 只校验源素材与安装计划，不写文件
 * 退出码：0 成功；1 失败。
 * ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'native', 'android', 'brand-res');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const EXPECTED_COUNT = 26;

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

if (!fs.existsSync(SRC)) die('缺少品牌素材目录：native/android/brand-res/');

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? path.join(base, e.name) : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, rel));
    else if (e.name.toLowerCase().endsWith('.png')) out.push(rel);
  }
  return out;
}

const files = walk(SRC).sort();
if (files.length !== EXPECTED_COUNT) {
  die('品牌素材数量不对：期望 ' + EXPECTED_COUNT + ' 个 PNG，实际 ' + files.length);
}

const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  console.log('✓ 品牌素材完整：' + files.length + ' 个 PNG');
  for (const rel of files) console.log('  ' + rel);
  process.exit(0);
}

if (!fs.existsSync(RES)) {
  die('找不到 android/app/src/main/res/ —— 请先执行 npx cap add android（或 tools/init-android.cjs）');
}

let copied = 0;
for (const rel of files) {
  const from = path.join(SRC, rel);
  const to = path.join(RES, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}
console.log('✓ 已安装品牌图标/启动页：' + copied + ' 个文件 → ' + path.relative(ROOT, RES));
console.log('  桌面图标与开屏 splash 现在使用 ZY 品牌素材（不再是 Capacitor 默认蓝色 X）');
