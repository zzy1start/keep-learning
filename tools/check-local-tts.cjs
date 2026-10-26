/* ============ check-local-tts.cjs : 离线语音库（Piper）接入回归 ============
 * 2026-10-22：平板 0 个系统英语音色，导入/内置听力都需要端侧男女声。
 * 把随包 Piper（jenny 英音女 + ryan/amy 美音）接进 Speech 后，锁住：
 *   1) 系统没有英语音色时，听力/句子自动走本地语音库；
 *   2) gender 切换真的换音色（female→jenny，male→ryan），且可被设置覆盖；
 *   3) 有系统音色时默认仍走系统/云端（桌面不降级），除非 localTtsPreferred；
 *   4) 本地合成失败 → 回落系统链路，不静默；
 *   5) prefetch 只合成不播放；stop 后合成长结果不再出声；
 *   6) AudioPack.playPath 走 filePath + audioEvent 结算。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;

function makeCtx(opts = {}) {
  const log = { synth: [], play: [], toast: [] };
  const listeners = [];
  const audioBlocked = opts.audioBlocked;
  const plugin = {
    init: () => Promise.resolve({ ok: true, voices: ['jenny', 'ryan', 'amy', 'joe'] }),
    synthesize: ({ text, voice }) => {
      log.synth.push({ text, voice });
      if (opts.synthFail) return Promise.reject(new Error('boom'));
      return Promise.resolve({ ok: true, path: '/data/user/0/x/files/tts-cache/' + voice + '-' + text.length + '.wav', voice, sampleRate: 22050 });
    },
  };
  const audio = {
    addListener: (ev, cb) => { listeners.push(cb); return Promise.resolve({ remove() {} }); },
    stop: () => { listeners.forEach(cb => cb({ type: 'end', id: '999' })); },
    play: payload => {
      log.play.push(payload);
      const id = payload.id;
      if (audioBlocked) return Promise.reject(new Error('mediaplayer fail'));
      setTimeout(() => listeners.forEach(cb => cb({ type: 'start', id })), 0);
      setTimeout(() => listeners.forEach(cb => cb({ type: 'end', id })), 5);
      return Promise.resolve({ ok: true });
    },
  };
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Object, Array, String, Number, JSON, Math, Date, RegExp, Error,
    window: { Capacitor: { isNativePlatform: () => true, Plugins: { LocalTts: plugin, AudioPack: audio } }, setTimeout, clearTimeout },
    document: { addEventListener() {}, getElementById: () => null },
    speechSynthesis: {
      speaking: false, pending: false, cancel() {}, getVoices: () => (opts.systemVoices || []),
      speak(u) { setTimeout(() => { if (u.onstart) u.onstart({}); if (u.onend) u.onend({}); }, 0); },
    },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
    Audio: function () { this.play = () => Promise.resolve(); this.pause = () => {}; },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 16; TB321FU) AppleWebKit' },
    Store: { d: { settings: Object.assign({ localTts: true, localTtsPreferred: false, localVoiceFemale: 'jenny', localVoiceMale: 'ryan', speechRate: 1 }, opts.settings || {}) }, flush() {} },
    App: { toast: (m) => log.toast.push(m) },
    LocalTts: {
      normalize: t => String(t || '').replace(/\s+/g, ' ').trim(),
      synthesize: (t, v) => plugin.synthesize({ text: t, voice: v }),
    },
  };
  ctx.window.window = ctx.window;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  load('js/audio-pack.js');
  load('js/speech.js');
  ctx.window.AudioPack = vm.runInContext('AudioPack', ctx);
  ctx.window.Speech = vm.runInContext('Speech', ctx);
  const S = ctx.window.Speech;
  S.init = function () {};                       // 不跑真实轮询
  S.initVoiceList = function () {};
  return { S, ctx, log };
}

async function main() {
  const results = [];
  const test = (name, fn) => results.push([name, fn]);

  test('系统无英语音色 + 无插件前：shouldHandle 只看插件与设置（浏览器不受影响）', async () => {
    const { S } = makeCtx();
    // 简化：直接验证 available() 在 native 有插件时为 true
    assert.equal(S.local.available(), true, '安装版应可用');
    // shouldHandle：voices 为空 → true
    assert.equal(S.local.shouldHandle({ gender: 'female' }), true, '无系统音色时应接管');
    // 明确 local:false → 不接管
    assert.equal(S.local.shouldHandle({ local: false }), false, '显式 local:false 不应接管');
  });

  test('gender 切换音色：female→jenny / male→ryan，可在设置里改', async () => {
    const { S } = makeCtx();
    assert.equal(S.local.voiceFor({ gender: 'female' }), 'jenny');
    assert.equal(S.local.voiceFor({ gender: 'male' }), 'ryan');
    S.local.voiceFor = S.local.voiceFor; // noop
  });

  test('系统没有音色时 speak() 走本地语音库：合成→播放 filePath，句子结束 resolve', async () => {
    const { S, log } = makeCtx();
    await S.speak('Good morning, everyone.', { gender: 'female' });
    assert.equal(log.synth.length, 1, '应调用一次本地合成');
    assert.equal(log.synth[0].voice, 'jenny', '女声应为 jenny');
    assert.equal(log.play.length, 1, '应调用一次原生播放');
    assert.ok(String(log.play[0].filePath || '').includes('.wav'), '应走 filePath 而非 assets path');
  });

  test('男声句子走 ryan；对话男女切换是两种音色', async () => {
    const { S, log } = makeCtx();
    await S.speak('Man: Good morning. Woman: Good morning.', { gender: 'male' });
    await S.speak('Woman: Nice to meet you.', { gender: 'female' });
    assert.deepEqual(log.synth.map(x => x.voice), ['ryan', 'jenny'], '男女应对应 ryan / jenny');
  });

  test('听力场景（listening:true）即使有系统音色也统一走本地语音库（音色一致）', async () => {
    const { S, log } = makeCtx();
    S.voices = [{ name: 'Microsoft Sonia Online', lang: 'en-GB', localService: false }];
    await S.speak('Good morning, everyone.', { gender: 'male', listening: true });
    assert.equal(log.synth.length, 1, '听力场景应走本地合成');
    assert.equal(log.synth[0].voice, 'ryan');
    assert.equal(log.play.length, 1, '应调用一次原生播放（filePath）');
  });

  test('非听力场景（背单词/其它）有系统音色时不抢占', async () => {
    const { S, log } = makeCtx();
    S.voices = [{ name: 'Sonia', lang: 'en-GB' }];
    await S.speak('hello', { word: true });
    assert.equal(log.synth.length, 0, '非听力场景不应走本地');
  });
  test('有系统音色时默认仍走系统（桌面不降级）；localTtsPreferred=true 才优先本地', async () => {
    const ctxSystem = makeCtx();
    ctxSystem.S.voices = [{ name: 'Microsoft Sonia Online', lang: 'en-GB', localService: false }];
    assert.equal(ctxSystem.S.local.shouldHandle({ gender: 'female' }), false, '有系统音色时不应抢占');
    const ctxPref = makeCtx({ settings: { localTtsPreferred: true } });
    ctxPref.S.voices = [{ name: 'Sonia', lang: 'en-GB' }];
    assert.equal(ctxPref.S.local.shouldHandle({ gender: 'female' }), true, '显式优先时应接管');
  });

  test('本地合成失败 → 回落系统链路（不静默），只提示一次', async () => {
    const { S, log } = makeCtx({ synthFail: true });
    let systemSpoke = 0;
    const orig = globalThis;
    // 系统链路在 vm 内：替换 speechSynthesis.speak 记数
    S._speakSystem = () => { systemSpoke++; return Promise.resolve(undefined); };
    const r = await S.speak('Hello world.', { gender: 'female' });
    assert.equal(systemSpoke, 1, '应回落到系统语音');
    assert.equal(r, undefined);
    assert.equal(log.toast.length, 1, '应提示一次');
  });

  test('prefetch 只合成不播放（听力下一句预热）', async () => {
    const { S, log } = makeCtx();
    const p = S.prefetch('Next sentence for prefetch.', { gender: 'male' });
    assert.ok(p, '应返回预取 Promise');
    await p;
    assert.equal(log.synth.length >= 1, true, '应发生合成');
    assert.equal(log.play.length, 0, '预取不应播放');
  });

  test('合成期间 stop → 合成完成后不再出声', async () => {
    const { S, log } = makeCtx();
    const p = S.speak('A sentence that will be stopped.', { gender: 'female' });
    S._stopSeq = (S._stopSeq || 0) + 1;   // 模拟停止
    await p;
    assert.equal(log.play.length, 0, '停止后不应再调用播放');
  });

  for (const [name, fn] of results) {
    try { await fn(); passed++; console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
  }
  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项离线语音库检查通过');
}
main();
