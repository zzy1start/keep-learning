/* 生成 Capacitor Android 用的发布资源目录 dist-android/
 * - 只复制运行时需要的白名单文件
 * - 删除 data/content 中 mine:true 的个人题目（不能打进 APK）
 * - 不包含 serve.js / sw.js / docs / tools / raw / 备份 / .git
 * - 生成 build-report.json 并做隐私扫描
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-android');
const CONTENT = path.join(ROOT, 'data', 'content');
const AUDIO = path.join(ROOT, 'assets', 'audio');
/* --no-audio：官方 lite 包不包含离线音频（音频由用户本地生成，避免再分发 Edge TTS 产物） */
const NO_AUDIO = process.argv.includes('--no-audio') || process.env.KEEP_LRN_NO_AUDIO === '1';
const report = { builtAt: new Date().toISOString(), audio: '', files: 0, bytes: 0, maxFile: '', maxBytes: 0, removedPersonal: 0, removedTitles: [], privacy: [] };

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!filter(entry.name)) continue;
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}
function copyFile(rel) {
  const s = path.join(ROOT, rel), d = path.join(OUT, rel);
  if (!fs.existsSync(s)) throw new Error('missing required file: ' + rel);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.copyFileSync(s, d);
}
function walk(dir, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, cb); else cb(p);
  }
}

// 1) 清理并复制白名单
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'favicon.svg']) copyFile(f);
for (const d of ['css', 'js', 'data']) copyDir(path.join(ROOT, d), path.join(OUT, d), n => n !== '.' && n !== '..');
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'),
  n => n !== 'english-app.ico' && !(NO_AUDIO && n === 'audio'));
if (NO_AUDIO) {
  report.audio = 'excluded (--no-audio)';
} else if (fs.existsSync(AUDIO)) {
  report.audio = 'included';
} else {
  report.audio = 'absent (lite)';
  console.warn('assets/audio 不存在：本次构建为 lite（无离线音频）。需要时运行 node tools/gen-audio-pack.cjs');
}
copyFile('vendor/sbd/dist/sbd.js');
copyFile('vendor/pdf-lib.min.js');
copyDir(path.join(ROOT, 'vendor', 'pdfjs'), path.join(OUT, 'vendor', 'pdfjs'));

// 2) data/content 去个人题目
for (const name of fs.readdirSync(CONTENT).filter(n => n.endsWith('.json'))) {
  const src = path.join(CONTENT, name);
  const dst = path.join(OUT, 'data', 'content', name);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { throw new Error('bad json ' + name + ': ' + e.message); }
  const lists = ['passages', 'tasks', 'sentenceTasks'];
  let changed = false;
  for (const key of lists) {
    if (!Array.isArray(raw[key])) continue;
    const kept = raw[key].filter(item => {
      if (item && item.mine === true) {
        report.removedPersonal++;
        report.removedTitles.push({ file: name, list: key, id: item.id, title: item.title || item.number || '' });
        return false;
      }
      return true;
    });
    if (kept.length !== raw[key].length) { raw[key] = kept; changed = true; }
  }
  fs.writeFileSync(dst, changed ? JSON.stringify(raw, null, 2) : fs.readFileSync(src));
}

// 3) 静态引用检查（index.html 的 src/href）
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
  .filter(u => !/^(https?:|data:|#|mailto:)/.test(u));
const missing = refs.filter(u => !fs.existsSync(path.join(OUT, u.split('?')[0])));
if (missing.length) throw new Error('missing index refs: ' + missing.join(', '));

// 4) 隐私扫描
const scanPatterns = [
  { name: 'personal-question', re: /"mine"\s*:\s*true/ },
  { name: 'api-key-like', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];
walk(OUT, p => {
  const ext = path.extname(p).toLowerCase();
  if (!['.json', '.js', '.html', '.webmanifest', '.css'].includes(ext)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const s of scanPatterns) {
    if (s.re.test(text)) report.privacy.push({ file: path.relative(OUT, p), type: s.name });
  }
});

// 5) 统计
walk(OUT, p => {
  const st = fs.statSync(p);
  report.files++;
  report.bytes += st.size;
  if (st.size > report.maxBytes) { report.maxBytes = st.size; report.maxFile = path.relative(OUT, p); }
});
report.maxMB = +(report.maxBytes / 1048576).toFixed(2);
report.totalMB = +(report.bytes / 1048576).toFixed(2);
report.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, 'index.html'))).digest('hex');
/* 报告写在仓库内 work/（已 gitignore），不要再写到仓库外——开源仓库/CI 没有那个目录的权限 */
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true });
const reportPath = path.join(ROOT, 'work', 'android-build-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
if (report.privacy.length) {
  console.error('PRIVACY SCAN FAILED');
  process.exit(2);
}
