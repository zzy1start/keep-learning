/* ============ check-audio-pack.cjs : 离线音频包结构与“缩小”回归 ============
 * 2026-10-22 用户要求缩小语音包：单词男声在正常链路里不会被请求，已删除（保留女声）；
 * 内置听力 62 句保留男女声（对话需要）；Piper 本地 TTS 模型 258MB 只服务一个试验按钮，
 * 已移出 assets（不随 APK 打包）。
 *
 * 本回归锁住：
 *   1) index.json 结构：11,187 个单词条目（仅 female）+ 62 句（female+male），文件都真实存在；
 *   2) 没有孤立文件（assets/audio 下每个 mp3 都被索引引用），也没有 words/m 残留；
 *   3) 音频包总体积上限（防止以后误加回来）；
 *   4) AudioPack 缺声道回退：请求 male 但只有 female 时播 female，不能静音；
 *   5) assets/models/piper 不再随包（Piper 模型在仓库根 local-tts-models/）。
 *
 * lite 构建/开源仓库默认不含 assets/audio（音频由 tools/gen-audio-pack.cjs 本地生成）：
 * 找不到 index.json 时本套件打印 SKIP 并以 0 退出，不阻塞 check-all。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}
const INDEX = path.join(ROOT, 'assets', 'audio', 'index.json');
if (!fs.existsSync(INDEX)) {
  console.log('SKIP 离线音频包检查：assets/audio/index.json 不存在（lite 构建 / 仓库不含音频）');
  console.log('     需要完整检查时先运行：node tools/gen-audio-pack.cjs');
  process.exit(0);
}
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const entries = index.entries || {};
const wordKeys = Object.keys(entries).filter(k => k.startsWith('words:'));
const sentKeys = Object.keys(entries).filter(k => k.startsWith('sentences:'));
const exists = rel => fs.existsSync(path.join(ROOT, 'assets', rel));

check('索引结构：单词 ' + wordKeys.length + ' 条（仅女声）+ 句子 ' + sentKeys.length + ' 条（男女声）', () => {
  assert.equal(index.version, 3, 'version 应为 3');
  assert.equal(wordKeys.length, 11187, '单词条目数应为 11,187');
  assert.equal(sentKeys.length, 62, '句子条目数应为 62');
  for (const k of wordKeys) {
    const e = entries[k];
    assert.ok(e.female && exists(e.female), k + ' 缺女声文件：' + e.female);
    assert.ok(!e.male, k + ' 不应再有 male 字段（已裁剪）');
  }
  for (const k of sentKeys) {
    const e = entries[k];
    assert.ok(e.female && exists(e.female), k + ' 缺女声文件');
    assert.ok(e.male && exists(e.male), k + ' 缺男声文件（对话需要）');
  }
});

check('没有孤立音频文件，也没有 words/m 残留', () => {
  const referenced = new Set();
  for (const k of Object.keys(entries)) {
    const e = entries[k];
    if (e.female) referenced.add(e.female);
    if (e.male) referenced.add(e.male);
  }
  const audioDir = path.join(ROOT, 'assets', 'audio');
  const orphans = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name === 'index.json') continue;
      const rel = path.relative(path.join(ROOT, 'assets'), p).split(path.sep).join('/');
      if (!referenced.has(rel)) orphans.push(rel);
    }
  };
  walk(audioDir);
  assert.deepEqual(orphans.slice(0, 5), [], '存在未被索引引用的文件：' + orphans.slice(0, 5).join(', '));
  assert.ok(!fs.existsSync(path.join(audioDir, 'words', 'm')), 'assets/audio/words/m 应已删除');
});

check('音频包体积 ≤ 55MB（当前 ' + (fs.statSync(INDEX).size / 1048576).toFixed(1) + 'MB 仅索引；目录上限防回涨）', () => {
  let total = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
    }
  };
  walk(path.join(ROOT, 'assets', 'audio'));
  assert.ok(total <= 55 * 1048576, '音频包 ' + (total / 1048576).toFixed(1) + 'MB 超过 55MB 上限');
});

const PIPER = path.join(ROOT, 'assets', 'models', 'piper');
if (!fs.existsSync(PIPER)) {
  console.log('SKIP Piper 模型检查：assets/models/piper 不存在（仓库不含模型，按需下载）');
} else check('Piper 离线语音库随包：4 个音色（jenny/ryan/amy/joe，alan 已移除）+ espeak-ng-data 齐全', () => {
  const base = PIPER;
  for (const v of ['jenny', 'ryan', 'amy', 'joe']) {
    const model = path.join(base, v, 'model.onnx');
    const tokens = path.join(base, v, 'tokens.txt');
    assert.ok(fs.existsSync(model) && fs.statSync(model).size > 30 * 1048576, v + ' 的 model.onnx 缺失或过小');
    assert.ok(fs.existsSync(tokens), v + ' 的 tokens.txt 缺失');
  }
  assert.ok(fs.existsSync(path.join(base, 'espeak-ng-data', 'phontab')), 'espeak-ng-data 缺失');
  assert.ok(!fs.existsSync(path.join(ROOT, 'local-tts-models', 'piper')), 'local-tts-models 里不应再有副本');
});

/* 注意：这一项是异步的，必须 await —— 写成 sync check(async () => ...) 会把
 * 断言失败变成 unhandledRejection，还先记一次 PASS（自查发现的测试假绿）。*/
async function runAsyncChecks() {
  try {
    await checkAudioPackFallback();
    passed++; console.log('PASS AudioPack 缺声道回退：请求男声但单词只有女声 → 播女声（不能静音）');
  } catch (e) {
    failed++; console.error('FAIL AudioPack 缺声道回退：' + (e && e.message));
  }
}

async function checkAudioPackFallback() {
  const played = [];
  const listeners = [];
  const plugin = {
    addListener: (ev, cb) => { listeners.push(cb); return Promise.resolve({ remove() {} }); },
    stop() {},
    play(args) {
      played.push(args);
      /* 模拟原生 audioEvent：start→end，避免 say() 等满 30s 看门狗把套件拖慢 */
      setTimeout(() => {
        listeners.forEach(cb => cb({ type: 'start', id: args.id }));
        listeners.forEach(cb => cb({ type: 'end', id: args.id }));
      }, 0);
      return Promise.resolve({ ok: true });
    },
  };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Promise, Object, Array, String, Number, JSON, Math, Date,
    fetch: async () => ({ ok: true, json: async () => index }),
    window: { Capacitor: { isNativePlatform: () => true, Plugins: { AudioPack: plugin } } },
    Speech: { _forceGender: '' },
  });
  ctx.window.window = ctx.window;
  ctx.window.setTimeout = setTimeout;
  const code = fs.readFileSync(path.join(ROOT, 'js', 'audio-pack.js'), 'utf8');
  vm.runInContext(code, ctx);
  const AP = vm.runInContext('AudioPack', ctx);
  await AP.load();
  assert.ok(AP.ready, 'AudioPack 应加载成功');
  const word = entries[wordKeys[0]];
  // 单词：索引里只有 female；用 male 请求也必须能播（回退 female）
  assert.ok(AP.canPlay(word.text, { word: true, gender: 'male' }), '单词 male 请求应可播（回退女声）');
  await AP.say(word.text, { word: true, gender: 'male' });
  assert.ok(played.length === 1, '应调用一次原生播放');
  assert.equal(played[0].path, word.female, '应回退到女声文件');
  // 句子：仍应播对应性别的文件
  const sent = entries[sentKeys[0]];
  await AP.say(sent.text, { gender: 'male' });
  assert.equal(played[1].path, sent.male, '句子男声应播 male 文件');
  /* mock 播放器不会发 end 事件，say() 里 30s 兜底定时器会挂着把套件拖慢 60s；
   * 断言完主动 stop() 清掉它。*/
  AP.stop();
}

(async () => {
  await runAsyncChecks();
  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项离线音频包检查通过');
})();
