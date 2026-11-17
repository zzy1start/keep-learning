/* ============ check-brand-res.cjs : Android 品牌图标/启动页防回归自检 ============
 * 背景：android/ 不入库，`cap add android` 会用 Capacitor 默认素材（蓝色 X + 网格）覆盖
 * 图标与启动页；1.1.48 就是这样丢掉了当次品牌标。品牌素材现在入库在
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
  'drawable-land-hdpi/splash.png': [800, 480, 'f10de2788cac9127d0d55d116b12a92974bd500045b63652840ef86346ef5ac4'],
  'drawable-land-mdpi/splash.png': [480, 320, '14bc7b9229d3612e997c81ee0ae948194682b421be375b405fcdd72b24846b12'],
  'drawable-land-xhdpi/splash.png': [1280, 720, '3842ccf3a87546037c1c018dd6239f735f8b17d10dd29c40cd6b63512c426a9c'],
  'drawable-land-xxhdpi/splash.png': [1600, 960, '347cd9e43830d09e5e4ae9891fc2de70bc44b221a4952713b9660552bd0d389c'],
  'drawable-land-xxxhdpi/splash.png': [1920, 1280, 'd15f1bf421cf38c050e23bdda7a93d5e7e4d5d66311aa7822f0165e6a2d20d7e'],
  'drawable-port-hdpi/splash.png': [480, 800, '6773a3387c541e15fda34def79ad5b0e9515ff83bb74738746e1cc87833f9136'],
  'drawable-port-mdpi/splash.png': [320, 480, '790677ed41bbe51a328b2a3aee588612113684435cd6691dee62fcd50740d100'],
  'drawable-port-xhdpi/splash.png': [720, 1280, '83216ae1d56e610391181b0c5eb1b7730a10f70c45ef8249f91174f8f77ec84a'],
  'drawable-port-xxhdpi/splash.png': [960, 1600, 'f4194ff565e54cb9a9cee3dc6e5aef4c4eb7bdc38136038f3524947e9c81fe98'],
  'drawable-port-xxxhdpi/splash.png': [1280, 1920, '1264bc562797b3f4c01252805a1399eb4d202055fc6fe1df34605951b40ffb2a'],
  'drawable/splash.png': [480, 320, '14bc7b9229d3612e997c81ee0ae948194682b421be375b405fcdd72b24846b12'],
  'mipmap-hdpi/ic_launcher.png': [72, 72, '83e3ab3ac4aec4ceec8f2f57e9d8ab32bafc8797ad89ba0fc7e33f94f8180756'],
  'mipmap-hdpi/ic_launcher_foreground.png': [162, 162, 'e953644a21dbeb803f7c472fddd39542b7505cb6e0c02dbaf112de39e4196d9f'],
  'mipmap-hdpi/ic_launcher_round.png': [72, 72, '2d1cd3b9e117bc52625b7b379eda1f451caaa504adcc182ba907528e31d7de22'],
  'mipmap-mdpi/ic_launcher.png': [48, 48, '778d5d95edff23ecc4ba60f1514698225448275737de9cdfa00138819298647f'],
  'mipmap-mdpi/ic_launcher_foreground.png': [108, 108, '7bd6c3863c04b643178a2cd426bf442bcbc46597856556a08e1f8e1ebcdb895d'],
  'mipmap-mdpi/ic_launcher_round.png': [48, 48, 'f8a7110acd361b3517af0a87ecaea7cf1e8693e7262af0c2e70a71d74ed128c0'],
  'mipmap-xhdpi/ic_launcher.png': [96, 96, '49db8822c8023ca01824f8ccf382be5b045460590b79755b82b0d4713627516a'],
  'mipmap-xhdpi/ic_launcher_foreground.png': [216, 216, 'e6745ce030bf00cc08455515308dadd7e696d26c99c7b317241fc70fa345e9ca'],
  'mipmap-xhdpi/ic_launcher_round.png': [96, 96, '6b609834707bc3eac1ff66bbe83efa2a5befed09fc9883cb8f0be029da61301a'],
  'mipmap-xxhdpi/ic_launcher.png': [144, 144, 'a06bd6063ea4a82635ecc383222026b3d098eca11d2711705db043006d9d6862'],
  'mipmap-xxhdpi/ic_launcher_foreground.png': [324, 324, '76c377cc51851f9b9f9eb723b417ffd6e89fddf3b49fb17a4d37e1bbe681d702'],
  'mipmap-xxhdpi/ic_launcher_round.png': [144, 144, 'a53e2f63723980f902502d3e08761c43abb831c211977a9aa8249d57b25f8bed'],
  'mipmap-xxxhdpi/ic_launcher.png': [192, 192, '6fb4fffe7fcc8de0e620802b6e719a98153948d5064a71bb6f09cf035db407fb'],
  'mipmap-xxxhdpi/ic_launcher_foreground.png': [432, 432, 'c4af45419adaa57190b76f10b0f70c7fdd545af77561ba829808a81e66d828ac'],
  'mipmap-xxxhdpi/ic_launcher_round.png': [192, 192, '6f3329d239cc6d56d2e5d44890cd2107246e9bbbbfb4c823293dd2077fff16ae'],
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
