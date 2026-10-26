/* ============================================================================
 * tools/init-android.cjs — 从零重建 Android 工程
 * ============================================================================
 *
 * 为什么需要这个脚本：
 *   android/ 目录不入库（构建产物 + Gradle 缓存体积大、跨平台易冲突），
 *   但 6 个自研原生插件是本项目核心代码，不能跟着 android/ 一起丢。
 *   因此插件源码与 Gradle 自定义配置保存在 native/android/ 下，
 *   由本脚本在 clone 后重新生成完整可构建的 android/ 工程。
 *
 * 用法：
 *   node tools/init-android.cjs           # 重建（若 android/ 已存在会覆盖）
 *   node tools/init-android.cjs --force   # 同上（显式覆盖）
 *
 * 前置条件：
 *   - Node.js ≥ 18
 *   - 已执行 npm install（提供 @capacitor/cli）
 *   - 已安装 Android SDK（ANDROID_HOME 或 local.properties 指向）
 *   - JDK 21（Capacitor 7 要求）
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NATIVE = path.join(ROOT, 'native', 'android');
const ANDROID = path.join(ROOT, 'android');
/* Java 包名按点分层，目录必须是 com/keeplrn/tablet，
 * 不能把 'com.keeplrn.tablet' 当成单级目录名（会拼出错误的路径）。 */
const PLUGIN_PKG = 'com.keeplrn.tablet';
const PLUGIN_PKG_PATH = PLUGIN_PKG.split('.').join(path.sep);

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
};
const log = (...a) => console.log(...a);
const step = (m) => log(`${c.blue}▶${c.reset} ${m}`);
const ok = (m) => log(`  ${c.green}✓${c.reset} ${m}`);
const warn = (m) => log(`  ${c.yellow}!${c.reset} ${m}`);
const die = (m) => { log(`  ${c.red}✗ ${m}${c.reset}`); process.exit(1); };

/* ---------------------------------------------------------------- 工具 */
/* Windows 上直接 spawn `npx.cmd` 会抛 EINVAL（status=null，非真实退出码）：
 * Node 出于安全收紧拒绝直接执行 .cmd 批处理文件，必须经 cmd.exe /c 转发。
 * 这里统一走 shell，避开该限制。 */
function runNpx(args, opts = {}) {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';
  return execFileSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    ...(isWin ? { shell: true } : {}),
    ...opts,
  });
}

function has(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}
function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

/* -------------------------------------------------- 0. 前置条件检查 */
step('检查前置条件');

if (!fs.existsSync(path.join(ROOT, 'node_modules', '@capacitor', 'cli'))) {
  die('未找到 @capacitor/cli。请先执行：npm install');
}
ok('依赖已安装 (@capacitor/cli)');

if (!fs.existsSync(path.join(ROOT, 'capacitor.config.json'))) {
  die('未找到 capacitor.config.json。仓库内容不完整，请重新 clone。');
}
ok('capacitor.config.json 存在');

/* --------------------------------------------- 1. 生成 dist-android 资源 */
step('生成打包资源目录 dist-android/');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-android.cjs')], {
    stdio: 'inherit', cwd: ROOT,
  });
  ok('dist-android/ 已生成');
} catch (e) {
  warn('build-android.cjs 执行失败（若 dist-android 已存在可忽略）');
}

/* --------------------------------------------- 2. cap add android */
if (fs.existsSync(ANDROID)) {
  step('移除已存在的 android/ 目录');
  fs.rmSync(ANDROID, { recursive: true, force: true });
  ok('已清理');
}

step('npx cap add android');
try {
  runNpx(['cap', 'add', 'android']);
  ok('android 工程已创建');
} catch (e) {
  die('cap add android 失败。请检查 Node/JDK 版本与网络（需拉取 @capacitor/android）');
}

/* --------------------------------------------- 3. cap sync */
step('npx cap sync android');
try {
  runNpx(['cap', 'sync', 'android']);
  ok('依赖已同步');
} catch (e) {
  warn('cap sync 失败，请手动重试：npx cap sync android');
}

/* --------------------------------------------- 4. 放回自研插件源码 */
step('安装自研原生插件');
const pluginSrc = path.join(NATIVE, 'app', 'src', 'main', 'java', PLUGIN_PKG_PATH);
const pluginDst = path.join(ANDROID, 'app', 'src', 'main', 'java', PLUGIN_PKG_PATH);
if (fs.existsSync(pluginSrc)) {
  fs.mkdirSync(pluginDst, { recursive: true });
  for (const f of fs.readdirSync(pluginSrc)) {
    fs.copyFileSync(path.join(pluginSrc, f), path.join(pluginDst, f));
  }
  const list = fs.readdirSync(pluginSrc).filter(f => f.endsWith('.java'));
  ok(`已安装 ${list.length} 个插件源码：${list.map(f => f.replace('.java', '')).join(', ')}`);
} else {
  die(`未找到插件源码目录：${pluginSrc}（仓库内容不完整）`);
}

/* --------------------------------------------- 5. 放回原生库 aar */
const aarSrc = path.join(NATIVE, 'app', 'libs');
const aarDst = path.join(ANDROID, 'app', 'libs');
if (fs.existsSync(aarSrc)) {
  copyDir(aarSrc, aarDst);
  const aars = fs.readdirSync(aarDst).filter(f => f.endsWith('.aar'));
  ok(`已安装原生库：${aars.join(', ') || '(无)'}`);
} else {
  warn('未找到 native/android/app/libs/，sherpa-onnx.aar 缺失（本地 TTS 功能将不可用）');
}

/* --------------------------------------------- 6. 应用 Gradle 自定义配置 */
step('应用 Gradle 自定义配置');
const tplDir = path.join(NATIVE, 'gradle-templates');
if (fs.existsSync(tplDir)) {
  const tpls = fs.readdirSync(tplDir);
  for (const t of tpls) {
    if (t === 'app-build.gradle') {
      copyIfExists(path.join(tplDir, t), path.join(ANDROID, 'app', 'build.gradle'));
    } else if (t === 'variables.gradle') {
      copyIfExists(path.join(tplDir, t), path.join(ANDROID, 'variables.gradle'));
    }
  }
  ok(`已应用 ${tpls.length} 个配置模板（签名配置已包含在内）`);
} else {
  warn('未找到 gradle-templates/，Gradle 配置将使用 Capacitor 默认值');
}

/* --------------------------- 6.5 修正 Gradle wrapper 发行版与超时 */
/* Capacitor 生成的 wrapper 默认指向 gradle-*-all.zip（含源码与文档，
 * 体积约为 -bin 的两倍），且 networkTimeout 仅 10s。
 * 在国内网络下 10s 极易超时，且 -all 的下载量并无必要。
 * 这里统一改为 -bin 并放宽超时，避免"重建成功但一进 gradlew 就超时"。 */
step('修正 Gradle wrapper 发行版配置');
const wrapperProps = path.join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.properties');
if (fs.existsSync(wrapperProps)) {
  let wp = fs.readFileSync(wrapperProps, 'utf8');
  const before = wp;
  wp = wp.replace(/gradle-([\d.]+)-all\.zip/, 'gradle-$1-bin.zip');
  wp = wp.replace(/networkTimeout=\d+/, 'networkTimeout=120000');
  if (wp !== before) {
    fs.writeFileSync(wrapperProps, wp);
    ok('已切换为 -bin 发行版并将超时放宽至 120s');
  } else {
    ok('wrapper 配置已是 -bin 且超时充足，无需修改');
  }
} else {
  warn('未找到 gradle-wrapper.properties，跳过 wrapper 配置修正');
}

/* --------------------------------------------- 7. 正式签名配置 */
const propsPath = path.join(ROOT, 'keystore.properties');
if (fs.existsSync(propsPath)) {
  step('配置正式签名（keystore.properties 已存在）');
  const gradleProps = path.join(ANDROID, 'gradle.properties');
  let content = fs.existsSync(gradleProps) ? fs.readFileSync(gradleProps, 'utf8') : '';
  if (!content.includes('keystore.properties')) {
    fs.appendFileSync(gradleProps,
      `\n# 正式签名配置（由 tools/init-android.cjs 追加）\n` +
      `keystorePropertiesFile=../keystore.properties\n`);
    ok('已在 gradle.properties 中引用 keystore.properties');
  } else {
    ok('gradle.properties 已包含签名配置引用');
  }
} else {
  warn('未找到 keystore.properties —— 将使用 debug 签名（仅供本地测试，不可对外发布）');
  warn('生成正式签名：keytool -genkeypair -v -keystore keell-release.jks ' +
       '-alias keell -keyalg RSA -keysize 2048 -validity 10000');
}

/* --------------------------------------------- 8. local.properties */
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const lp = path.join(ANDROID, 'local.properties');
if (!fs.existsSync(lp) && sdkDir) {
  fs.writeFileSync(lp, `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}\n`);
  ok(`已写入 local.properties（sdk.dir=${sdkDir}）`);
} else if (!fs.existsSync(lp)) {
  warn('未检测到 ANDROID_HOME，请手动创建 android/local.properties 并写入 sdk.dir=...');
}

/* --------------------------------------------- 9. 大体积资源提示 */
/* assets/audio/（约 48MB：11,187 词女声 + 62 句男女声）
 * 与 assets/models/piper（约 258MB：4 个 Piper 音色 + espeak-ng-data，离线语音库）
 * 体积远超 GitHub 单文件/仓库建议上限，且可由脚本重新生成，故不入库。
 * 缺失时应用不会崩：AudioPack 加载失败会静默跳过，语音自动退回
 * Web Speech API（系统内置音色），只是音质与自然度下降。
 * 这里主动告知，避免使用者误以为"clone 出来的包发音坏了"。 */
step('检查大体积资源（不入库，可选获取）');
const bigAssets = [
  { dir: path.join(ROOT, 'assets', 'audio'), label: '预生成音频包（约 48MB，11,187 词女声 + 62 句男女声）' },
  { dir: path.join(ROOT, 'assets', 'models', 'piper'), label: 'Piper 离线语音库（约 261MB，jenny/ryan/amy/joe + espeak-ng-data；alan 已按反馈移除）' },
];
const missingAssets = [];
for (const a of bigAssets) {
  if (fs.existsSync(a.dir)) {
    ok(`${a.label} 已就位`);
  } else {
    missingAssets.push(a.label);
    warn(`缺少 ${a.label}`);
  }
}
if (missingAssets.length) {
  log('');
  warn('以上资源未随仓库分发（体积过大）。');
  warn('缺失不影响应用运行：语音会自动退回系统 Web Speech API，');
  warn('但音色自然度与离线合成能力会下降。');
  log('');
}

/* --------------------------------------------- 完成 */
log('');
log(`${c.bold}${c.green}Android 工程重建完成${c.reset}`);
log('');
log('  构建调试包：');
log(`    ${c.dim}cd android && ./gradlew assembleDebug${c.reset}`);
log('  构建发布包（需正式签名）：');
log(`    ${c.dim}cd android && ./gradlew assembleRelease${c.reset}`);
log('  产物位置：');
log(`    ${c.dim}android/app/build/outputs/apk/${c.reset}`);
log('');
