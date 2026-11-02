/* ============ check-brand-res.cjs : Android 品牌图标/启动页防回归自检 ============
 * 背景：android/ 不入库，`cap add android` 会用 Capacitor 默认素材（蓝色 X + 网格）覆盖
 * 图标与启动页；1.1.48 就是这样丢掉了 ZY 品牌标。品牌素材现在入库在
 * native/android/brand-res/，本脚本校验：
 *   1) 26 个 PNG 齐全、尺寸正确、SHA-256 与清单一致（防止被默认素材或别的图替换）
 *   2) 安装脚本 tools/install-brand-res.cjs 存在，且 tools/init-android.cjs 会调用它
 *   3) 若本机存在 android/ 工程：逐字节比对 android res 是否已装好品牌素材
 * CI 里跑 1) + 2)；本机构建前跑 3) 可提前发现"工程被重建但没装图标"。
 * ========================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'native', 'android', 'brand-res');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

/* 清单：相对 native/android/brand-res/ 的路径 → [宽, 高, SHA-256] */
const EXPECTED = {
  'drawable-land-hdpi/splash.png': [800, 480, '3f6aa5f356d9ff5024b46b9936dfb588e3bd792cf01c395d897cef8a8bdb11a2'],
  'drawable-land-mdpi/splash.png': [480, 320, '04ec7ac96f476094a5ba13febba86b4c4ac0c9c4dfd4eb0d7b6ecf4c8ef0ebd4'],
  'drawable-land-xhdpi/splash.png': [1280, 720, '3d4f24550988ab27b59fcb26e61daf5267544c7117ab68935b335c543c221d1b'],
  'drawable-land-xxhdpi/splash.png': [1600, 960, '66c2ca96af49b9cfb8787a978946a9c7f453cf6759978e7ea3f0d947ac92ecb0'],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280, '0a07bd1f1754ccea98ff0f9b9676500e16af4e3ccccdfd94fe1c49f0c0da882e'],
  'drawable-port-hdpi/splash.png': [480, 800, '21999581efae7f5901bb51b1d3c3af054834b3f21e504a62ca5b5af536d4b1fe'],
  'drawable-port-mdpi/splash.png': [320, 480, '6c3b3e961f72ed5ac92cb1a271da6359ab72053fb5d9ac79b3c79650ff21a162'],
  'drawable-port-xhdpi/splash.png': [720, 1280, '4d355687429019575d486a637131f7bc35ac3b9e00fd1e91c697ae3524e6506e'],
  'drawable-port-xxhdpi/splash.png': [960, 1600, 'd5a278f9f14ae4d3fd8edd9db8058fb60df3e19124b255ee009f5d3a4de16dc1'],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920, '443c8333c6dec720cf76b07399a14bc7ae4259d881bc17332111c20b86100695'],
  'drawable/splash.png': [480, 320, '04ec7ac96f476094a5ba13febba86b4c4ac0c9c4dfd4eb0d7b6ecf4c8ef0ebd4'],
  'mipmap-hdpi/ic_launcher_foreground.png': [162, 162, 'b434cc208f186eab87f0be76f663cace8ab303533de9e5dd350cd04e151b333d'],
  'mipmap-hdpi/ic_launcher_round.png': [72, 72, '39bcd65d16376e41d2abc54ca791a24a84ab0c76b0c678049c8ea4ea4d85c534'],
  'mipmap-hdpi/ic_launcher.png': [72, 72, 'efe390239df7f37e509ceb3fea9f837f83790bca42119a2ab302b592f7eb7e39'],
  'mipmap-mdpi/ic_launcher_foreground.png': [108, 108, 'ef041808b3c638e5718240db6c60f7fc718ba62f0a057c3976b6e182884857b6'],
  'mipmap-mdpi/ic_launcher_round.png': [48, 48, 'ff41faac57ed77015d71f5ee796c14632f2ee8878124d78a6173c81336ce87ab'],
  'mipmap-mdpi/ic_launcher.png': [48, 48, '5a7355f20583cb585fe508b37e6fc75b23d4b36b5949f5fc08ae5f27fad2eac5'],
  'mipmap-xhdpi/ic_launcher_foreground.png': [216, 216, '272a5df002377281b5227823b320e6f1dc3d22a85fffc035040fdcd6bd4faf87'],
  'mipmap-xhdpi/ic_launcher_round.png': [96, 96, '5b08d2f09c9089398e2edd58fafff49b15df46b669a1e3d6c0f9ffb701e3d24a'],
  'mipmap-xhdpi/ic_launcher.png': [96, 96, 'b2b4604fcc48dd019f9282d4c7b5b203fe9bd1bfcc8f72adfaa1aa60081ec0c1'],
  'mipmap-xxhdpi/ic_launcher_foreground.png': [324, 324, 'b117d7671a0eb46c2779164a2f379de3cc9ee0f45a6e3ecb5812de5f4c1f36ce'],
  'mipmap-xxhdpi/ic_launcher_round.png': [144, 144, '235d8e0ca30250d5ee8ba172198a7a3f4bd311d73e7b9eeca74782f7fa94d7ba'],
  'mipmap-xxhdpi/ic_launcher.png': [144, 144, '893f611cee9f82d28c56394bf70a7f3fdf9bc70ad52241b5157ee4dae26cd5fb'],
  'mipmap-xxxhdpi/ic_launcher_foreground.png': [432, 432, '99ae6bb327c0dda80792f49351db01f1baddc80370236e705a5dac4e36ee914f'],
  'mipmap-xxxhdpi/ic_launcher_round.png': [192, 192, '43eaf0894f2ec518d83a78397f20fb16fa91a9ec8e7464d2819efde8e67d70e5'],
  'mipmap-xxxhdpi/ic_launcher.png': [192, 192, '9dc18d561b2af8e6e04491b232dd2f6cf5635772acbf7dfd4bb23f48457bce45'],
};

let failed = 0;
function check(name, run) {
  try { run(); console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function pngDims(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('不是合法 PNG');
  }
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

check('品牌素材目录存在', () => {
  if (!fs.existsSync(SRC)) throw new Error('缺少 native/android/brand-res/');
});

check('26 个 PNG 齐全（无缺失、无多余）', () => {
  const found = [];
  (function walk(dir, base) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? path.join(base, e.name) : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, rel);
      else if (e.name.toLowerCase().endsWith('.png')) found.push(rel.split(path.sep).join('/'));
    }
  })(SRC, '');
  found.sort();
  const want = Object.keys(EXPECTED).sort();
  const missing = want.filter((k) => !found.includes(k));
  const extra = found.filter((k) => !want.includes(k));
  if (missing.length) throw new Error('缺少：' + missing.join(', '));
  if (extra.length) throw new Error('多余：' + extra.join(', '));
});

check('尺寸与 SHA-256 与清单一致（防被 Capacitor 默认素材替换）', () => {
  const bad = [];
  for (const [rel, [w, h, want]] of Object.entries(EXPECTED)) {
    const file = path.join(SRC, rel);
    const buf = fs.readFileSync(file);
    const [aw, ah] = pngDims(buf);
    if (aw !== w || ah !== h) bad.push(`${rel} 尺寸 ${aw}x${ah}，期望 ${w}x${h}`);
    const got = sha256(buf);
    if (got !== want) bad.push(`${rel} SHA-256 不一致`);
  }
  if (bad.length) throw new Error(bad.join('；'));
});

check('install-brand-res.cjs 存在且有安装逻辑', () => {
  const p = path.join(ROOT, 'tools', 'install-brand-res.cjs');
  if (!fs.existsSync(p)) throw new Error('缺少 tools/install-brand-res.cjs');
  const src = fs.readFileSync(p, 'utf8');
  if (!src.includes('copyFileSync')) throw new Error('安装脚本没有复制逻辑');
});

check('init-android.cjs 在生成 android 工程后会安装品牌素材', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'init-android.cjs'), 'utf8');
  const addAt = Math.max(
    src.indexOf("runCap(['add', 'android'])"),
    src.indexOf("runNpx(['cap', 'add', 'android'])"),
  );
  const installAt = src.indexOf('install-brand-res.cjs');
  if (installAt < 0) throw new Error('init-android.cjs 没有调用 install-brand-res.cjs');
  if (addAt < 0) throw new Error('init-android.cjs 里找不到 cap add android');
  if (installAt < addAt) throw new Error('安装品牌素材必须发生在 cap add android 之后');
});

if (fs.existsSync(RES)) {
  check('本机 android 工程已装好品牌素材（逐字节比对）', () => {
    const bad = [];
    for (const rel of Object.keys(EXPECTED)) {
      const dst = path.join(RES, rel);
      if (!fs.existsSync(dst)) { bad.push(rel + ' 未安装'); continue; }
      const same = sha256(fs.readFileSync(dst)) === EXPECTED[rel][2];
      if (!same) bad.push(rel + ' 与品牌素材不一致');
    }
    if (bad.length) throw new Error(bad.join('；') + '（重新执行 node tools/install-brand-res.cjs）');
  });
} else {
  console.log('SKIP 本机无 android/ 工程，跳过逐字节比对（CI 场景正常）');
}

if (failed) {
  console.error('品牌图标自检失败：' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('全部品牌图标检查通过');
}
