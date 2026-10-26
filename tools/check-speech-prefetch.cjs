/* ============ check-speech-prefetch.cjs : lookahead 预推理缓冲（②）============
 * 【能测什么 / 不能测什么】
 * 这里验证的是**可客观测量**的部分：预取有没有真的发起合成、有没有复用、会不会出声、
 * 缓存有没有上限、失败会不会影响正常播放。听感（句间静默是否变小）需要真人确认。
 * 听力侧的接线（何时预取谁）在 check-listening-exam.cjs 里做行为级断言。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

/** 建一个 Kokoro 引擎的模拟环境：tts.generate 计数、Audio 记录播放 */
function makeNeural(opts = {}) {
  const audio = [];
  const gens = [];
  const toasts = [];
  class AudioMock {
    constructor(url) { this.url = url; this.paused = true; audio.push(this); }
    play() {
      this.paused = false;
      setTimeout(() => { if (this.onplaying) this.onplaying(); }, 1);
      setTimeout(() => { this.paused = true; if (this.onended) this.onended(); }, 5);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  const synth = {
    speaking: false, pending: false,
    getVoices: () => [{ name: 'Microsoft Aria Neural', lang: 'en-US' }],
    speak() {}, cancel() {},
  };
  const ctx = vm.createContext({
    window: { speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    Store: { d: { settings: Object.assign({ speechEngine: 'neural', speechRate: 1 }, opts.settings || {}) } },
    App: { toast(m) { toasts.push(m); }, modal() {} },
    document: { addEventListener() {} },
    console, setTimeout, clearTimeout, Date, Promise, Math,
    Audio: AudioMock,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
    navigator: { gpu: null },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
  const S = vm.runInContext('Speech', ctx);
  S.neural.state = 'ready';
  let failNext = 0;
  S.neural.tts = {
    generate: async (text, cfg) => {
      gens.push({ text, cfg });
      if (failNext > 0) { failNext--; throw new Error('合成失败'); }
      return { toBlob: () => ({}) };
    },
  };
  S.neural.__failNext = () => { failNext++; };
  return { S, audio, gens, toasts, synth };
}

const tick = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await check('预取只合成不播放（绝不创建 Audio 元素 → 停止/切段后不会突然出声）', async () => {
    const m = makeNeural();
    const p = m.S.prefetch('A complete sentence.', { rate: 1 });
    assert.ok(p, '就绪的 Kokoro 引擎应接受预取');
    await p;
    await tick(20);
    assert.equal(m.gens.length, 1, '预取应发起一次合成，实际 ' + m.gens.length);
    assert.equal(m.audio.length, 0, '预取绝不能创建 Audio 元素，实际 ' + m.audio.length + ' 个');
    assert.equal(m.S.neural.playing, false, '预取期间不算"在播"');
  });

  await check('轮到它时直接复用预取结果：不再合成第二次', async () => {
    const m = makeNeural();
    await m.S.prefetch('Second sentence here.', { rate: 1 });
    assert.equal(m.gens.length, 1);
    await m.S.speakWord('Second sentence here.', { rate: 1 });
    assert.equal(m.gens.length, 1, '播放时应复用预取结果，不该再合成，实际 ' + m.gens.length + ' 次');
    assert.equal(m.audio.length, 1, '应该真的播出来');
  });

  await check('同一句连读两次只合成一次（缓存命中）；语速不同则重新合成', async () => {
    const m = makeNeural();
    await m.S.speakWord('deserve');
    await m.S.speakWord('deserve');
    assert.equal(m.gens.length, 1, '同文本同参数应命中缓存，实际合成 ' + m.gens.length + ' 次');
    await m.S.speakWord('deserve', { rate: 1.3 });
    assert.equal(m.gens.length, 2, '语速变了必须重新合成（缓存键含语速），实际 ' + m.gens.length);
    assert.equal(m.gens[1].cfg.speed, 1.3, '重新合成应使用新语速，实际 ' + m.gens[1].cfg.speed);
  });

  await check('预取失败静默丢弃：随后真正播放仍能正常合成并出声', async () => {
    const m = makeNeural();
    m.S.neural.__failNext();
    const p = m.S.prefetch('Tricky sentence.', { rate: 1 });
    assert.equal(await p, null, '预取失败应返回 null，不抛给调用方');
    assert.equal(m.S.neural.playing, false, '预取失败不能把通道留在"在播"状态');
    await m.S.speakWord('Tricky sentence.', { rate: 1 });
    assert.equal(m.gens.length, 2, '播放时应重新合成一次，实际 ' + m.gens.length);
    assert.equal(m.audio.length, 1, '仍然要正常出声');
  });

  await check('缓存有上限（长材料不会把内存吃满）', async () => {
    const m = makeNeural();
    for (let i = 0; i < 20; i++) await m.S.prefetch('sentence number ' + i, { rate: 1 });
    const size = m.S.neural._cache ? m.S.neural._cache.size : 0;
    assert.ok(size > 0, '应已缓存');
    assert.ok(size <= m.S.neural.PREFETCH_MAX,
      '缓存条数不得超过 ' + m.S.neural.PREFETCH_MAX + '，实际 ' + size);
    // 被挤掉的旧条目要能重新合成，而不是报错
    await m.S.speakWord('sentence number 0', { rate: 1 });
    assert.equal(m.audio.length, 1, '旧条目被淘汰后仍应能正常播放');
  });

  await check('换模型/重载后丢弃预取（clearPrefetch）', async () => {
    const m = makeNeural();
    await m.S.prefetch('Cached sentence.', { rate: 1 });
    assert.ok(m.S.neural._cache.size > 0);
    m.S.neural.clearPrefetch();
    assert.equal(m.S.neural._cache.size, 0, 'clearPrefetch 后缓存应为空');
    await m.S.speakWord('Cached sentence.', { rate: 1 });
    assert.equal(m.gens.length, 2, '缓存被清后应重新合成，实际 ' + m.gens.length);
  });

  await check('系统语音引擎下预取是零成本空操作（不会去偷偷加载 Kokoro）', () => {
    const m = makeNeural({ settings: { speechEngine: 'system' } });
    m.S.neural.state = 'idle';
    assert.equal(m.S.prefetch('any sentence', { rate: 1 }), null, '系统引擎下不该预取');
    assert.equal(m.gens.length, 0, '不该发起任何合成');
    assert.equal(m.S.neural.state, 'idle', '不该因为预取而开始加载模型');
  });

  await check('模型未就绪时预取不加载、不报错（等真正播放时再走正常流程）', () => {
    const m = makeNeural();
    m.S.neural.state = 'idle';
    assert.equal(m.S.prefetch('any sentence', { rate: 1 }), null);
    assert.equal(m.gens.length, 0);
  });

  await check('stop() 之后预取的结果不会自己播出来', async () => {
    const m = makeNeural();
    const p = m.S.prefetch('Never played sentence.', { rate: 1 });
    m.S.stop();
    await p;
    await tick(20);
    assert.equal(m.audio.length, 0, 'stop() 之后绝不允许出现播放');
    assert.equal(m.S.neural.playing, false, 'stop() 后通道必须空闲');
  });

  await check('合成期间 stop()：调用方立刻结算，不必等合成跑完（合成无法中断，await 不能悬挂）', async () => {
    const m = makeNeural();
    const events = [];
    let release = null;
    m.S.neural.tts.generate = () => new Promise(res => { release = () => res({ toBlob: () => ({}) }); });
    const p = m.S.speakWord('slow sentence', { onerror: e => events.push(e.error) });
    await tick(10);
    assert.equal(m.S.neural.playing, true, '合成期间应算"在播"');
    m.S.stop();
    const r = await Promise.race([p.then(() => 'settled'), tick(200).then(() => 'HUNG')]);
    assert.equal(r, 'settled', 'stop() 之后调用方不允许悬挂等待合成结束');
    assert.deepEqual(events, ['canceled'], '停止应沿用 canceled 语义，实际 ' + JSON.stringify(events));
    release();
    await tick(30);
    assert.equal(m.audio.length, 0, '合成迟到的结果也绝不允许出声');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项预推理检查通过');
})();
