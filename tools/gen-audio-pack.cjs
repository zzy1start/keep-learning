#!/usr/bin/env node
/* ============================================================
 * gen-audio-pack.cjs — 本地生成离线音频包（仓库不存 MP3）
 *
 * 为什么不在仓库/Release 放 MP3：
 *   现有 11,187 个单词 + 62 句听力音频由 Edge TTS 生成（Sonia/Ryan），
 *   批量再分发微软语音合成产物存在许可风险。改为让用户在本机生成：
 *   生成的 MP3 只留在本机，随本地构建进 APK，不进入仓库/官方 Release。
 *
 * 音色与现有包完全一致（见 assets/audio/index.json 的 voices）：
 *   女声 en-GB-SoniaNeural；男声 en-GB-RyanNeural。
 * 输出：assets/audio/{words/f,sentences/f,sentences/m}/<sha1(text)[:16]>.mp3
 *       assets/audio/index.json（version 3，单词仅女声，句子男女声）
 *
 * 依赖：
 *   - Python 3 + edge-tts：  python -m pip install --upgrade edge-tts
 *   - ffmpeg：               winget install Gyan.FFmpeg / choco install ffmpeg / brew install ffmpeg
 *
 * 用法：
 *   node tools/gen-audio-pack.cjs --dry           只统计/检查依赖，不生成
 *   node tools/gen-audio-pack.cjs --limit 5       先生成 5 条试听
 *   node tools/gen-audio-pack.cjs                 全量生成（断点续跑）
 *   node tools/gen-audio-pack.cjs --force         全部重新生成
 *   node tools/gen-audio-pack.cjs --only words    只生成单词
 *   node tools/gen-audio-pack.cjs --check         只校验现有包
 *   node tools/gen-audio-pack.cjs --mock --out work/test-audio --limit 20
 *                                                 不联网，写占位文件（仅测试管线）
 *
 * 说明：
 *   - 生成的文件不要提交到 git，也不要上传公开 Release；官方 Release 为 lite（不含音频）。
 *   - 音频仅供个人学习使用，使用时请遵守 Microsoft 的服务条款；本项目不随包再分发。
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DEFAULT_OUT = path.join(ROOT, 'assets', 'audio');
const TMP = path.join(ROOT, 'work', 'audio-tmp');
const REPORT = path.join(ROOT, 'work', 'audio-gen-report.json');
const VOICES = { female: 'en-GB-SoniaNeural', male: 'en-GB-RyanNeural' };
const BOOK_DIRS = ['cet4', 'cet6', 'kaoyan', 'sat', 'toefl'];
const CONTENT_FILES = ['listening.json', 'listening-cet4.json'];
const EXPECT = { words: 11187, sentences: 62 };
const TRIM_FILTER =
  'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:' +
  'stop_periods=-1:stop_duration=0.1:stop_threshold=-50dB';

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}
const opt = {
  dry: argv.includes('--dry') || argv.includes('-n'),
  check: argv.includes('--check'),
  force: argv.includes('--force'),
  mock: argv.includes('--mock'),
  quiet: argv.includes('--quiet'),
  limit: Number(arg('--limit', '0')) || 0,
  jobs: Math.max(1, Math.min(8, Number(arg('--jobs', '4')) || 4)),
  retry: Math.max(0, Math.min(5, Number(arg('--retry', '2')) || 0)),
  python: arg('--python', process.env.PYTHON || ''),
  ffmpeg: arg('--ffmpeg', process.env.FFMPEG || ''),
  out: path.resolve(ROOT, arg('--out', DEFAULT_OUT)),
  only: arg('--only', 'all'),
  rate: arg('--rate', ''),
  pitch: arg('--pitch', ''),
};

function log(...a) { if (!opt.quiet) console.log(...a); }
function warn(...a) { console.warn(...a); }
function fail(msg, code = 2) { console.error('ERROR: ' + msg); process.exit(code); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function mb(n) { return (n / 1048576).toFixed(1) + 'MB'; }
function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function hash16(text) { return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16); }

/* ---------- 数据来源：词书 + 内置听力 ---------- */
function deriveWords() {
  const seen = new Set();
  const words = [];
  for (const d of BOOK_DIRS) {
    const dir = path.join(DATA, d);
    if (!fs.existsSync(dir)) { warn('跳过不存在的词书目录：data/' + d); continue; }
    const files = fs.readdirSync(dir).filter(f => /^\d{2}\.json$/.test(f)).sort();
    for (const f of files) {
      let arr;
      try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (e) { warn('跳过无法解析的 ' + d + '/' + f + '：' + e.message); continue; }
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        const w = normText(it && it.w);
        if (!w) continue;
        const key = w.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        words.push(w);
      }
    }
  }
  /* 排序让不同机器生成顺序一致（索引按文本查找，顺序不影响播放） */
  words.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
  return words;
}

function deriveSentences() {
  const seen = new Set();
  const out = [];
  for (const name of CONTENT_FILES) {
    const fp = path.join(DATA, 'content', name);
    if (!fs.existsSync(fp)) { warn('跳过不存在的听力文件：data/content/' + name); continue; }
    let j;
    try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch (e) { warn('跳过无法解析的 ' + name + '：' + e.message); continue; }
    for (const p of (j.passages || [])) {
      for (const line of (p.script || [])) {
        const t = normText(line && line.en);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

function readExistingIndex() {
  const fp = path.join(opt.out, 'index.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch (e) { warn('现有 index.json 无法解析，将按数据源重建：' + e.message); return null; }
}

function collectTexts() {
  const idx = readExistingIndex();
  if (idx && idx.entries) {
    const words = [], sentences = [];
    for (const [k, e] of Object.entries(idx.entries)) {
      if (!e || !e.text) continue;
      if (k.startsWith('words:')) words.push(e.text);
      else if (k.startsWith('sentences:')) sentences.push(e.text);
    }
    if (words.length && sentences.length) {
      log('使用现有 index.json 的文本（不重新推导）：单词 ' + words.length + ' / 句子 ' + sentences.length);
      return { words, sentences };
    }
  }
  const words = deriveWords();
  const sentences = deriveSentences();
  log('从 data/ 推导文本：单词 ' + words.length + ' / 句子 ' + sentences.length);
  return { words, sentences };
}

/* ---------- 索引 ---------- */
function makeEntries(words, sentences) {
  const entries = {};
  const hashSeen = new Map();
  for (const text of words) {
    const h = hash16(text);
    const prev = hashSeen.get(h);
    if (prev && prev !== text) throw new Error('sha1 前缀碰撞：' + prev + ' / ' + text);
    hashSeen.set(h, text);
    entries['words:' + h] = { text, female: 'audio/words/f/' + h + '.mp3' };
  }
  for (const text of sentences) {
    const h = hash16(text);
    const prev = hashSeen.get(h);
    if (prev && prev !== text) throw new Error('sha1 前缀碰撞：' + prev + ' / ' + text);
    hashSeen.set(h, text);
    entries['sentences:' + h] = {
      text,
      female: 'audio/sentences/f/' + h + '.mp3',
      male: 'audio/sentences/m/' + h + '.mp3',
    };
  }
  return entries;
}

function filePathFor(rel) { return path.join(opt.out, rel.replace(/^audio\//, '')); }
function fileOk(abs) { try { return fs.existsSync(abs) && fs.statSync(abs).size > 512; } catch { return false; } }

function buildTasks(entries) {
  const tasks = [];
  for (const [key, e] of Object.entries(entries)) {
    const isWord = key.startsWith('words:');
    if (opt.only === 'words' && !isWord) continue;
    if (opt.only === 'sentences' && isWord) continue;
    for (const gender of ['female', 'male']) {
      const rel = e[gender];
      if (!rel) continue;
      const abs = filePathFor(rel);
      if (!opt.force && fileOk(abs)) continue;
      tasks.push({ key, text: e.text, gender, voice: VOICES[gender], rel, abs });
    }
  }
  return tasks;
}

function allPresent(entries) {
  for (const e of Object.values(entries)) {
    for (const g of ['female', 'male']) {
      if (!e[g]) continue;
      if (!fileOk(filePathFor(e[g]))) return false;
    }
  }
  return true;
}

function writeIndex(entries, words, sentences) {
  const idx = {
    version: 3,
    voices: { female: VOICES.female, male: VOICES.male },
    generatedAt: new Date().toISOString(),
    generator: 'tools/gen-audio-pack.cjs',
    counts: { words: words.length, sentences: sentences.length },
    entries,
  };
  fs.mkdirSync(opt.out, { recursive: true });
  const target = path.join(opt.out, 'index.json');
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 1));
  fs.renameSync(tmp, target);
  return target;
}

/* ---------- 依赖探测 ---------- */
function tryCmd(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: opts.timeout || 15000,
      ...opts,
    });
    return r.status === 0 ? { ok: true, out: (r.stdout || '').trim() } : { ok: false, out: (r.stderr || r.stdout || '').trim() };
  } catch (e) {
    return { ok: false, out: String(e.message || e) };
  }
}

function findPython() {
  const candidates = [opt.python, process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  for (const c of candidates) {
    const r = tryCmd(c, ['-c', 'import sys; print(sys.version.split()[0])']);
    if (r.ok) return { cmd: c, version: r.out };
  }
  return null;
}

function findEdgeTts(python) {
  const r = tryCmd(python, ['-m', 'edge_tts', '--help']);
  return r.ok;
}

function findFfmpeg() {
  const candidates = [opt.ffmpeg, process.env.FFMPEG, 'ffmpeg', 'ffmpeg.exe'].filter(Boolean);
  for (const c of candidates) {
    const r = tryCmd(c, ['-version']);
    if (r.ok) return { cmd: c, version: r.out.split('\n')[0] };
  }
  return null;
}

function printDeps(py, edgeOk, ff) {
  log('  依赖：Python ' + (py ? py.version + ' (' + py.cmd + ')' : '未找到') +
    ' | edge-tts ' + (edgeOk ? '可用' : '未安装') +
    ' | ffmpeg ' + (ff ? ff.version : '未找到'));
  if (!py || !edgeOk || !ff) {
    warn('  安装方法：');
    if (!py) warn('    - 安装 Python 3：https://www.python.org/downloads/ （勾选 Add to PATH）');
    if (!edgeOk) warn('    - ' + (py ? py.cmd : 'python') + ' -m pip install --upgrade edge-tts');
    if (!ff) warn('    - Windows: winget install Gyan.FFmpeg  或  choco install ffmpeg');
    if (!ff) warn('    - macOS: brew install ffmpeg');
    if (!ff) warn('    - Linux: sudo apt install ffmpeg');
  }
}

/* ---------- 合成 ---------- */
function run(cmd, args, timeout = 90000) {
  return new Promise((resolve) => {
    let stderr = '', stdout = '';
    let settled = false;
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (!settled) { try { p.kill('SIGKILL'); } catch {} }
    }, timeout);
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: -1, stderr: String(e.message || e), stdout }); } });
    p.on('close', code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, stderr, stdout }); } });
  });
}

async function mockOne(task) {
  fs.mkdirSync(path.dirname(task.abs), { recursive: true });
  fs.writeFileSync(task.abs, Buffer.alloc(2048, 0));
}

async function synthOne(py, ff, task) {
  fs.mkdirSync(path.dirname(task.abs), { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const tmp = path.join(TMP, crypto.randomBytes(8).toString('hex') + '.mp3');
  const edgeArgs = ['-m', 'edge_tts', '--voice', task.voice, '--text', task.text, '--write-media', tmp];
  if (opt.rate) edgeArgs.push('--rate', opt.rate);
  if (opt.pitch) edgeArgs.push('--pitch', opt.pitch);
  try {
    const r = await run(py, edgeArgs, 90000);
    if (r.code !== 0) throw new Error('edge-tts exit ' + r.code + ': ' + (r.stderr || r.stdout).slice(0, 300));
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 500) throw new Error('edge-tts 未产出有效 MP3');
    const f = await run(ff, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp,
      '-ac', '1', '-ar', '24000', '-b:a', '24k',
      '-af', TRIM_FILTER, '-codec:a', 'libmp3lame', task.abs,
    ], 60000);
    if (f.code !== 0) throw new Error('ffmpeg exit ' + f.code + ': ' + (f.stderr || '').slice(0, 300));
    if (!fileOk(task.abs)) throw new Error('ffmpeg 输出文件过小或缺失');
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

async function runPool(tasks, jobs, worker) {
  let next = 0, done = 0;
  const total = tasks.length;
  const failed = [];
  const started = Date.now();
  const runners = Array.from({ length: Math.min(jobs, total) }, async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const t = tasks[i];
      let lastErr = null;
      for (let attempt = 0; attempt <= opt.retry; attempt++) {
        try { await worker(t); lastErr = null; break; }
        catch (e) {
          lastErr = e;
          if (attempt < opt.retry) await sleep(800 * (attempt + 1));
        }
      }
      if (lastErr) failed.push({ key: t.key, text: t.text, gender: t.gender, error: lastErr.message });
      done++;
      if (!opt.quiet && (done % 25 === 0 || done === total)) {
        const pct = (done / total * 100).toFixed(1);
        const rate = done / Math.max(1, (Date.now() - started) / 1000);
        const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
        console.log('[' + String(done).padStart(5) + '/' + total + '] ' + pct + '%  ' +
          rate.toFixed(1) + ' 条/s  剩余约 ' + Math.ceil(eta / 60) + ' 分钟');
      }
    }
  });
  await Promise.all(runners);
  return failed;
}

function validate(entries, words, sentences) {
  const errors = [];
  if (words.length !== EXPECT.words) errors.push('单词数 ' + words.length + '，期望 ' + EXPECT.words);
  if (sentences.length !== EXPECT.sentences) errors.push('句子数 ' + sentences.length + '，期望 ' + EXPECT.sentences);
  let missing = 0, bytes = 0;
  for (const [key, e] of Object.entries(entries)) {
    for (const g of ['female', 'male']) {
      if (!e[g]) continue;
      const abs = filePathFor(e[g]);
      if (!fileOk(abs)) { missing++; if (missing <= 5) errors.push('缺文件：' + e[g]); }
      else bytes += fs.statSync(abs).size;
    }
  }
  if (missing) errors.push('缺失文件 ' + missing + ' 个');
  return { errors, bytes, missing };
}

/* ---------- 主流程 ---------- */
(async () => {
  if (opt.only !== 'all' && opt.only !== 'words' && opt.only !== 'sentences') {
    fail('--only 只支持 words / sentences / all');
  }
  if (opt.mock && opt.out === DEFAULT_OUT && !opt.dry) {
    fail('--mock 必须配合 --out <目录> 使用，避免把占位文件写进 assets/audio');
  }
  const { words, sentences } = collectTexts();
  const entries = makeEntries(words, sentences);
  let tasks = buildTasks(entries);
  if (opt.limit > 0) tasks = tasks.slice(0, opt.limit);
  const totalFiles = Object.values(entries).reduce((n, e) => n + (e.female ? 1 : 0) + (e.male ? 1 : 0), 0);
  log('音频包：单词 ' + words.length + ' + 句子 ' + sentences.length + ' = ' + (words.length + sentences.length) + ' 条文本，' + totalFiles + ' 个文件');
  log('输出目录：' + opt.out);
  log('待生成：' + tasks.length + ' 个文件' + (opt.force ? '（--force 覆盖已有）' : '（已存在的大于 1KB 会跳过）'));

  if (opt.check) {
    if (!fs.existsSync(path.join(opt.out, 'index.json'))) fail('没有 index.json，无法校验；请先生成', 1);
    const v = validate(entries, words, sentences);
    if (v.errors.length) { v.errors.forEach(e => console.error('  - ' + e)); process.exitCode = 1; }
    else console.log('OK：索引与文件完整，共 ' + mb(v.bytes) + '（' + totalFiles + ' 个文件）');
    return;
  }

  if (opt.dry) {
    let py = null, edgeOk = false, ff = null;
    if (!opt.mock) {
      py = findPython(); edgeOk = py ? findEdgeTts(py.cmd) : false; ff = findFfmpeg();
      printDeps(py, edgeOk, ff);
    } else {
      log('MOCK 模式：跳过依赖检查');
    }
    const existing = totalFiles - tasks.length;
    log('已有文件：' + existing + '，待生成：' + tasks.length);
    const estMin = Math.ceil(tasks.length / (opt.jobs * 6)); // 约 6 条/并发/分钟（保守）
    log('预计耗时：约 ' + estMin + ' 分钟（--jobs ' + opt.jobs + '，实际取决于网络）');
    if (!opt.mock && (!py || !edgeOk || !ff)) {
      warn('依赖不全，先按上面的命令安装；--dry 不生成文件。');
    }
    return;
  }

  let py = null, ff = null;
  if (!opt.mock) {
    py = findPython();
    if (!py) fail('未找到 Python 3；先安装 Python 并勾选 Add to PATH，或 --python 指定路径');
    if (!findEdgeTts(py.cmd)) fail('edge-tts 未安装：' + py.cmd + ' -m pip install --upgrade edge-tts');
    ff = findFfmpeg();
    if (!ff) fail('未找到 ffmpeg：Windows 可 winget install Gyan.FFmpeg');
    printDeps(py, true, ff);
  } else {
    log('MOCK 模式：不联网，写 2KB 占位文件（仅用于测试管线）');
  }

  if (!tasks.length) {
    log('没有需要生成的文件。');
    if (allPresent(entries)) {
      const target = writeIndex(entries, words, sentences);
      console.log('索引已写入：' + target);
    }
    return;
  }

  const started = Date.now();
  const failed = await runPool(tasks, opt.jobs, (t) => opt.mock ? mockOne(t) : synthOne(py.cmd, ff.cmd, t));
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  if (failed.length) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify({
      at: new Date().toISOString(), total: tasks.length, failedCount: failed.length, failed,
    }, null, 1));
    console.error('完成 ' + (tasks.length - failed.length) + '/' + tasks.length + '，失败 ' + failed.length + ' 个（' + secs + 's）');
    failed.slice(0, 5).forEach(f => console.error('  - ' + f.key + ' [' + f.gender + '] ' + f.error));
    console.error('失败清单：' + REPORT + '（重跑会自动跳过已成功的文件）');
    process.exitCode = 1;
    return;
  }

  if (!allPresent(entries)) {
    warn('仍有文件缺失（可能是 --limit/--only 只生成了一部分），暂不写 index.json；完成后重跑即可。');
    return;
  }
  const v = validate(entries, words, sentences);
  if (v.errors.length) {
    v.errors.forEach(e => console.error('  - ' + e));
    process.exitCode = 1;
    return;
  }
  const target = writeIndex(entries, words, sentences);
  console.log('完成：' + totalFiles + ' 个文件，' + mb(v.bytes) + '，耗时 ' + secs + 's');
  console.log('索引：' + target);
  console.log('提示：生成文件不要提交到 git / 不要上传公开 Release；官方 Release 应为 lite（不含音频）。');
})().catch(e => {
  console.error('FAILED: ' + (e && e.stack || e));
  process.exit(1);
});
