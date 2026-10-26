/* ============ check-speech-options.cjs : 发音参数与防吞音自检 ============
 * 【能测什么 / 不能测什么】
 * 这个环境没有扬声器，也听不到合成音频，所以本脚本验证的是**可客观测量的部分**：
 *   - 单词发音走的是哪条参数（语速 1.0、跳过句子语调、前导空格）
 *   - cancel 之后是否等待引擎安静（吞首音节就是在这里发生的）
 *   - 页面初始化不会在用户操作前偷偷提交静音语音、是否记录了实测耗时（lastMs）
 * 真实听感请用「设置 → 单词发音 → 试听单词并计时」看毫秒数，并人工确认首音节完整。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let failed = 0, passed = 0;
/* 必须 await：这些用例里多数断言发生在 await 之后，
 * 不 await 会把失败变成"未捕获的 Promise 异常"，测试反而显示通过。 */
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

function makeSpeech() {
  const spoken = [];
  const toasts = [];
  const audio = [];
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [{ name: 'Microsoft Aria Neural', lang: 'en-US' }],
    speak(u) {
      /* 首次朗读前的"静音预热"（文本是一个空格）不计入 spoken：它没有内容，
       * 也不该被当成"读了这个词"的证据；事件照常回调，否则预热会卡住。*/
      if (!String(u.text == null ? '' : u.text).trim()) { setTimeout(() => { if (u.onend) u.onend({}); }, 5); return; }
      spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, volume: u.volume, voice: u.voice, at: Date.now() });
      synth.speaking = true;
      // 真实引擎是先 onstart（开口）再 onend（读完），这里按同样的顺序模拟
      setTimeout(() => { if (u.onstart) u.onstart({}); }, 10);
      setTimeout(() => { synth.speaking = false; if (u.onend) u.onend({}); }, 25);
    },
    cancel() { synth.speaking = false; synth.pending = false; },
  };
  class Utt { constructor(text) { this.text = text; this.volume = 1; this.rate = 1; this.pitch = 1; } }
  class AudioMock {
    constructor(url) { this.url = url; this.paused = true; audio.push(this); }
    play() {
      this.paused = false;
      setTimeout(() => { if (this.onplaying) this.onplaying(); }, 1);
      setTimeout(() => { if (this.onended) this.onended(); }, 25);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  return { spoken, toasts, synth, Utt, audio, AudioMock };
}

function loadSpeech(env, settings) {
  const ctx = vm.createContext({
    window: { speechSynthesis: env.synth },
    speechSynthesis: env.synth,
    SpeechSynthesisUtterance: env.Utt,
    Store: { d: { settings: Object.assign({ speechRate: 1, speechVoice: '' }, settings || {}) } },
    App: { toast(msg, type) { env.toasts.push([msg, type]); }, modal() {} },
    document: { addEventListener() {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Math,
    Audio: env.AudioMock,
    URL: { createObjectURL: () => 'blob:mock-audio', revokeObjectURL() {} },
    navigator: { gpu: null, userAgent: (env && env.ua) || '' },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
  return vm.runInContext('Speech', ctx);
}

(async () => {
  const env = makeSpeech();
  const Speech = loadSpeech(env);

  await check('单词发音：语速 1.0、带前导空格、不做句子语调', async () => {
    env.spoken.length = 0;
    await Speech.speakWord('deserve');
    assert.equal(env.spoken.length, 1);
    const u = env.spoken[0];
    assert.equal(u.rate, 1.0, '单词默认语速应为 1.0，实际 ' + u.rate);
    assert.equal(u.pitch, 1, '单词不做音高起伏，实际 ' + u.pitch);
    assert.ok(u.text.startsWith(' '), '应带前导空格防吞音，实际 ' + JSON.stringify(u.text));
    assert.ok(u.text.includes('deserve'));
  });

  await check('疑问词当单词读时也不会被套上疑问语调（what/why）', async () => {
    env.spoken.length = 0;
    await Speech.speakWord('why');
    const u = env.spoken[0];
    assert.equal(u.rate, 1.0, '不应因疑问词降速：' + u.rate);
    assert.equal(u.pitch, 1, '不应因疑问词升调：' + u.pitch);
  });

  await check('句子朗读：可变速、pitch 固定基准 1.0（不再手动升调）', async () => {
    env.spoken.length = 0;
    await Speech.speak('Why did he leave so early?', { rate: 1.2 });
    const u = env.spoken[0];
    assert.ok(Math.abs(u.rate - 1.2) < 0.05, '句子速率应接近 1.2，实际 ' + u.rate);
        assert.equal(u.pitch, 1, '固定基准 pitch=1：不再手动做疑问句升调，句末 ? 交给引擎生成自然语调');
    assert.ok(!u.text.startsWith(' '), '句子不加前导空格');
  });

  await check('cancel 之后要等引擎安静再起音（吞首音节的根因）', async () => {
    env.spoken.length = 0;
    Speech.stop();                       // 模拟背单词切卡时的“先停再读”
    const t0 = Date.now();
    await Speech.speakWord('interdisciplinary');
    assert.equal(env.spoken.length, 1);
    const delay = env.spoken[0].at - t0;
    assert.ok(delay >= 150, '停读后应等待 ≥150ms 再起音，实际 ' + delay + 'ms');
    assert.ok(delay <= 600, '等待不应过长（否则每次发音都拖沓），实际 ' + delay + 'ms');
  });

  await check('记录实测耗时 lastMs（供设置页计时显示）', async () => {
    await Speech.speakWord('deserve');
    assert.ok(Speech.lastMs > 0, 'lastMs 应为正数，实际 ' + Speech.lastMs);
  });

  await check('初始化不提交静音语音（浏览器需要用户操作后才启动发声）', () => {
    const env2 = makeSpeech();
    const S2 = loadSpeech(env2);
    S2.init();
    assert.equal(env2.spoken.length, 0, '页面加载时不应向语音引擎提交静音请求');
    S2.init();
    assert.equal(env2.spoken.length, 0, '重复初始化仍不应自动发声');
  });

  await check('stop() 清空待播队列，切卡不会连播上一张的词', async () => {
    env.spoken.length = 0;
    Speech.speakWord('first');
    Speech.speakWord('second');
    Speech.stop();
    await new Promise(r => setTimeout(r, 400));
    // stop 前已入队的两条最多执行第一条；stop 后队列被清空，不会再读到第二张卡
    assert.ok(env.spoken.length <= 1, 'stop 后不应继续播放队列，实际播了 ' + env.spoken.length + ' 条');
    assert.equal(Speech.lastMs >= 0, true);
  });

  await check('计时拆成「起音 + 朗读」，便于定位 2 秒到底花在哪', async () => {
    const env4 = makeSpeech();
    const S4 = loadSpeech(env4);
    await S4.speakWord('interdisciplinary');
    assert.ok(S4.lastStartMs > 0, 'lastStartMs 应记录起音延迟，实际 ' + S4.lastStartMs);
    assert.ok(S4.lastSpeakMs > 0, 'lastSpeakMs 应记录朗读时长，实际 ' + S4.lastSpeakMs);
    assert.ok(S4.lastMs >= S4.lastStartMs + S4.lastSpeakMs - 5, '合计应约等于两段之和');
  });

  await check('没有在播时不做多余等待（不再无脑 cancel，省掉 200ms）', async () => {
    const env5 = makeSpeech();
    const S5 = loadSpeech(env5);
    S5._warmedUp = true; S5._spokeAny = true;   // 测的是"没被打断就不等待"，首次冷启动策略不在此列
    const t0 = Date.now();
    await S5.speakWord('deserve');
    const delay = env5.spoken[0].at - t0;
    assert.ok(delay <= 120, '未打断任何朗读时应在 ~30ms 内起音，实际 ' + delay + 'ms');
  });
  await check('stopIfBusy：空闲时不 cancel，在播时才 cancel', () => {
    const env6 = makeSpeech();
    const S6 = loadSpeech(env6);
    let cancels = 0;
    const orig = env6.synth.cancel.bind(env6.synth);
    env6.synth.cancel = () => { cancels++; orig(); };
    assert.equal(S6.stopIfBusy(), false, '空闲时应返回 false');
    assert.equal(cancels, 0, '空闲时不该 cancel（否则每次播放先白等 200ms）');
    env6.synth.speaking = true;
    assert.equal(S6.stopIfBusy(), true);
    assert.equal(cancels, 1, '在播时应该 cancel');
  });

  await check('听力缓冲是听力独有的可配置项（默认 2 秒），背单词没有缓冲', () => {
    const listen = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(!/leadIn:\s*2000/.test(listen), '不该把 2000 写死在播放调用里');
    assert.ok(/leadIn: listenLeadInMs\(\)/.test(listen), '应通过 listenLeadInMs() 取值（可在设置页调整）');
    assert.ok(/s\.listenLeadIn == null \? 2/.test(listen), '默认应为 2 秒（这是听力明确的产品要求）');
    assert.ok(!/Speech\.speakWord\s*\(/.test(listen), '背单词的快速路径不该出现在听力的调用里');
    const vocab = fs.readFileSync(path.join(ROOT, 'js/views/vocab.js'), 'utf8');
    assert.ok(vocab.includes('Speech.speakWord'), '背单词应走 speakWord（点了立刻读）');
    assert.ok(!/leadIn/.test(vocab), '背单词不该出现任何缓冲参数');
  });

  await check('两套读音参数互相独立（听力 / 背单词各自的语速与音色）', () => {
    const env7 = makeSpeech();
    const S7 = loadSpeech(env7, { speechRate: 0.9, speechVoice: 'ListeningVoice', wordRate: 1.25, wordVoice: 'WordVoice' });
    const listen = S7.profile(false);
    const word = S7.profile(true);
    assert.equal(listen.rate, 0.9, '听力用自己的语速');
    assert.equal(listen.voice, 'ListeningVoice');
    assert.equal(listen.prosody, false, '听力不再做手动语调（整句交给引擎，避免逗号处被强制降调）');
    assert.equal(listen.pitch, 1, '基准 pitch = 1.0');
    assert.equal(word.rate, 1.25, '背单词用自己的语速');
    assert.equal(word.voice, 'WordVoice');
    assert.equal(word.prosody, false, '背单词不做句子语调');
    assert.equal(word.frontSpace, true, '背单词保留防吞音的前导空格');
  });

  await check('人声引擎就绪时走开源人声；失败自动回落系统语音且只提示一次', async () => {
    const env8 = makeSpeech();
    const S8 = loadSpeech(env8, { speechEngine: 'neural' });
    const called = [];
    S8.neural.state = 'ready';
    S8.neural.say = t => { called.push(t); return Promise.resolve(); };
    await S8.speakWord('deserve');
    assert.equal(called.length, 1, '应调用人声引擎');
    assert.equal(env8.spoken.length, 0, '就绪时不该再走系统语音');

    const env9 = makeSpeech();
    const S9 = loadSpeech(env9, { speechEngine: 'neural' });
    S9.neural.state = 'ready';
    S9.neural.say = () => Promise.reject(new Error('boom'));
    await S9.speakWord('deserve');
    await S9.speakWord('abandon');
    assert.equal(env9.spoken.length, 2, '失败后应回落系统语音');
    const warned = env9.toasts.filter(t => /人声引擎/.test(t[0]));
    assert.equal(warned.length, 1, '回落提示只应出现一次，实际 ' + warned.length);
  });
  await check('开源人声转发听力开始/结束回调，且无系统英语音色时仍可发声', async () => {
    const env = makeSpeech();
    env.synth.getVoices = () => [];
    const S = loadSpeech(env, { speechEngine: 'neural' });
    S.neural.state = 'ready';
    S.neural.tts = { generate: async () => ({ toBlob: () => ({}) }) };
    const events = [];
    await S.speak('A complete listening sentence.', {
      onstart: () => events.push('start'),
      onend: () => events.push('end'),
    });
    assert.deepEqual(events, ['start', 'end'], '应在音频实际开始和结束时通知调用方');
    assert.equal(env.spoken.length, 0, '开源引擎不依赖系统英文语音包');
  });
  await check('停止会取消 Kokoro 音频并清空待播队列', async () => {
    const env = makeSpeech();
    const S = loadSpeech(env, { speechEngine: 'neural' });
    S.neural.state = 'ready';
    S.neural.tts = { generate: async () => ({ toBlob: () => ({}) }) };
    env.AudioMock.prototype.play = function () {
      this.paused = false;
      setTimeout(() => { if (this.onplaying) this.onplaying(); }, 1);
      return Promise.resolve();
    };
    const events = [];
    const playing = S.speakWord('natural', { onerror: e => events.push(e.error) });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(S.neural.busy, true, '播放中应被识别为 busy');
    S.stop();
    await playing;
    assert.equal(env.audio[0].paused, true, '停止后音频元素应暂停');
    assert.deepEqual(events, ['canceled'], '停止应沿用语音引擎的取消语义');
  });
  await check('看门狗：引擎不回 onend 时强制收尾，队列不会被堵住（越读越慢的根因）', async () => {
    const env10 = makeSpeech();
    const S10 = loadSpeech(env10, {});
    /* 本用例验证的是**看门狗与队列**，不是"首次朗读的冷启动策略"（静音预热 + 首次额外等待，
     * 那条由 check-speech-cloud 覆盖）。先把首次标记置位，免得把 300ms 预热算进看门狗窗口。*/
    S10._warmedUp = true; S10._spokeAny = true;
    S10.START_TIMEOUT_MS = 80;                       // 测试里缩短看门狗
    S10.SETTLE_MS = 20;                              // 重试间隔也缩短
    let silent = true;
    env10.synth.speak = function (u) {
      env10.spoken.push({ text: u.text, rate: u.rate, pitch: u.pitch, volume: u.volume, at: Date.now() });
      env10.synth.speaking = true;
      if (silent) return;                            // 第一次：既不 onstart 也不 onend（模拟回调丢失）
      setTimeout(() => { if (u.onstart) u.onstart({}); }, 5);
      setTimeout(() => { env10.synth.speaking = false; if (u.onend) u.onend({}); }, 15);
    };
    const first = S10.speakWord('deserve');
    await new Promise(r => setTimeout(r, 260));
    assert.equal(S10._busy, false, '看门狗必须释放 _busy，否则后续全部排队');
    assert.ok(S10.diag[0] && (S10.diag[0].why === 'no-start' || S10.diag[0].why === 'no-end'),
      '诊断应记录回调丢失，实际 ' + JSON.stringify(S10.diag[0] && S10.diag[0].why));
    silent = false;
    await first;
    await S10.speakWord('abandon');                  // 卡死之后仍要能正常读下一个
    assert.equal(env10.spoken.length, 3, '首次失败会重试一次，随后仍应能朗读下一个词');
  });

  await check('背单词最新优先：排队的旧词请求被丢弃并 resolve（不再积压）', async () => {
    const env11 = makeSpeech();
    const S11 = loadSpeech(env11, {});
    env11.synth.speak = function (u) { env11.spoken.push({ text: u.text, at: Date.now() }); env11.synth.speaking = true; };
    const p1 = S11.speakWord('one');    // 占用引擎（永不结束，模拟慢）
    const p2 = S11.speakWord('two');    // 排队
    const p3 = S11.speakWord('three');  // 应把 two 挤掉
    await new Promise(r => setTimeout(r, 120));
    assert.equal(S11._q.length, 1, '队列里只应剩下最新的一个，实际 ' + S11._q.length);
    assert.equal(S11._q[0].text, 'three');
    assert.equal(await p2, null, '被丢弃的请求要 resolve，避免悬挂 Promise');
    S11.stop();
    await Promise.all([p1.catch(() => null), p3.catch(() => null)]);
  });

  await check('诊断环记录「排队等待 / 起音 / 朗读 / 合计」', async () => {
    const env12 = makeSpeech();
    const S12 = loadSpeech(env12, {});
    await S12.speakWord('deserve');
    const row = S12.diag[0];
    assert.ok(row, '应有诊断记录');
    assert.equal(row.text.startsWith(' ') ? row.text.trim() : row.text, 'deserve');
    assert.ok(row.waitMs >= 0 && row.startMs >= 0 && row.speechMs >= 0, '三段都应非负：' + JSON.stringify(row));
    assert.ok(row.totalMs >= row.startMs, '合计不应小于起音');
    assert.equal(row.len, 7, '应记录真实字数（供设置页算"字/秒"），实际 ' + row.len);
    assert.equal(S12.diag.length <= 12, true, '诊断环最多保留 12 条');
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(/字\/秒/.test(sv), '诊断表应显示朗读速度（否则"朗读 4 秒"无法判断是句子长还是读得慢）');
  });
  await check('引擎残影（pending）会先清掉再开口，避免延迟逐次变长', async () => {
    const env13 = makeSpeech();
    const S13 = loadSpeech(env13, {});
    env13.synth.pending = true;                 // 模拟 cancel 后的残影
    const t0 = Date.now();
    await S13.speakWord('deserve');
    assert.equal(env13.synth.pending, false, '残影应被清掉');
    const delay = env13.spoken[0].at - t0;
    assert.ok(delay >= 150, '清残影后要按防吞音间隔再开口，实际 ' + delay + 'ms');
    // 没有残影时不应有额外等待
    const env14 = makeSpeech();
    const S14 = loadSpeech(env14, {});
    S14._warmedUp = true; S14._spokeAny = true;      // 同上：测的是"没有残影就不等待"
    const t1 = Date.now();
    await S14.speakWord('deserve');
    assert.ok(env14.spoken[0].at - t1 <= 120, '没有残影时应立刻开口');
  });
  await check('④ 云端音色：Edge 自动放行并优先使用；非 Edge 默认排除；显式指定始终优先', () => {
    const cloud = [
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US',
        localService: false, voiceURI: 'Microsoft Aria Online (Natural) - English (United States)' },
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US',
        localService: true, voiceURI: 'Microsoft Zira - English (United States)' },
    ];
    const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    // 非 Edge、开关关闭：只保留本地音色（Chrome/Safari 下云端音色"有事件无声音"）
    const envA = makeSpeech();
    envA.synth.getVoices = () => cloud;
    const A = loadSpeech(envA);
    A.init();
    const namesA = A.list().map(v => v.name);
    assert.deepEqual(namesA.map(n => /Online/.test(n)), [false],
      '非 Edge 且未打开开关时只应保留本地音色，实际 ' + JSON.stringify(namesA));
    assert.ok(!/Online/.test(A.pickVoice('', 'female').name), '非 Edge 默认不该选到云端音色');

    // Edge：自动放行，并且自动选择就落到神经音色上（本机系统英语音色只有老式合成）
    const envB = makeSpeech();
    envB.ua = EDGE_UA;
    envB.synth.getVoices = () => cloud;
    const B = loadSpeech(envB);
    B.init();
    assert.equal(B.isEdge, true, '应识别出 Edge');
    assert.equal(B.list().length, 2, 'Edge 里云端音色应自动放行，实际 ' + B.list().length);
    assert.ok(/Online/.test(B.pickVoice('', 'female').name),
      'Edge 里自动选择应优先用神经音色，实际 ' + B.pickVoice('', 'female').name);
    assert.equal(B.pickVoice(cloud[1].name, 'female').name, cloud[1].name, '显式按名字指定本地音色仍须生效');

    // 非 Edge + 用户显式打开开关：同样优先云端音色
    const envE = makeSpeech();
    envE.synth.getVoices = () => cloud;
    const E = loadSpeech(envE, { allowOnlineVoices: true });
    E.init();
    assert.equal(E.list().length, 2, '打开开关后应纳入云端音色');
    assert.ok(/Online/.test(E.pickVoice('', 'female').name), '打开开关后应优先使用云端音色');

    // 极端情况：本机只有云端英语音色时也要能发声
    const onlyCloud = [cloud[0]];
    const envC = makeSpeech();
    envC.synth.getVoices = () => onlyCloud;
    const C = loadSpeech(envC, { allowOnlineVoices: true });
    C.init();
    assert.equal(C.list().length, 1, '只有云端音色时也应可用，实际 ' + C.list().length);
    assert.equal(C.pickVoice('', 'female').name, onlyCloud[0].name, '此时应兜底选到云端音色');

    const st = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
    assert.ok(/allowOnlineVoices: false/.test(st), '开关默认值应保留（非 Edge 仍需手动放行）');
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(/id="onlineVoiceChk"/.test(sv), '设置页应提供该开关');
    assert.ok(/id="dictAudioChk"/.test(sv), '设置页应提供真人词典发音开关');
    assert.ok(/dictAudio: false/.test(st), '词典音频层默认必须是关闭（打开会把所背单词发往第三方）');
  });

  await check('云端音色自愈：连续两次起音失败后自动停用，退回本地音色', async () => {
    const cloud = { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US',
      localService: false, voiceURI: 'Microsoft Aria Online (Natural) - English (United States)' };
    const local = { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' };
    const env = makeSpeech();
    env.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    env.synth.getVoices = () => [cloud, local];
    env.synth.speak = u => { env.spoken.push({ text: u.text, voice: u.voice && u.voice.name, at: Date.now() }); };  // 永不 onstart
    const S = loadSpeech(env);
    S.init();
    assert.ok(/Online/.test(S.pickVoice('', 'female').name), '初始应选云端音色');
    S.START_TIMEOUT_MS = 20;
    S.CLOUD_START_TIMEOUT_MS = 40;
    S.SETTLE_MS = 5;
    await S.speakWord('one');
    assert.equal(S.cloudOff, false, '只失败一次不该停用（可能只是这一次网络抖动）');
    await S.speakWord('two');
    assert.equal(S.cloudOff, true, '连续两次失败后应自动停用云端音色');
    assert.ok(!/Online/.test(S.pickVoice('', 'female').name),
      '停用后自动选择应退回本地音色，实际 ' + S.pickVoice('', 'female').name);
    assert.equal(env.toasts.some(t => /云端神经音色连续起音失败/.test(t[0])), true,
      '应告知用户已切回本地音色，实际 ' + JSON.stringify(env.toasts.map(t => t[0])));
  });

  await check('发音环境诊断：列出全部英语音色（含被排除的云端音色）与自动选择结果', () => {
    const env = makeSpeech();
    env.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    env.synth.getVoices = () => [
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false, voiceURI: 'Aria Online' },
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
    ];
    const S = loadSpeech(env);
    S.init();
    const r = S.voiceReport();
    assert.ok(/Edge/.test(r), '应写明浏览器类型：\n' + r);
    assert.ok(/云端（Natural\/Online）1 个/.test(r), '应统计云端音色数量：\n' + r);
    assert.ok(/Microsoft Aria Online \(Natural\)/.test(r), '应列出云端音色：\n' + r);
    assert.ok(/自动选中：Microsoft Aria Online/.test(r), '应给出现在会自动选哪个：\n' + r);
  });

  await check('★ 只有女生没有男生：名字夹 Multilingual 的云端音色也必须判出性别', () => {
    // 名字照抄本机 Edge 实测（截图），注意 William 那条夹了 Multilingual
    const voices = [
      { name: 'Microsoft William Multilingual Online (Natural) - English (Australia)', lang: 'en-AU', localService: false, voiceURI: 'Microsoft William Multilingual Online (Natural) - English (Australia)' },
      { name: 'Microsoft Natasha Online (Natural) - English (Australia)', lang: 'en-AU', localService: false, voiceURI: 'Natasha Online' },
      { name: 'Microsoft Emily Online (Natural) - English (Ireland)', lang: 'en-IE', localService: false, voiceURI: 'Emily Online' },
      { name: 'Microsoft Connor Online (Natural) - English (Ireland)', lang: 'en-IE', localService: false, voiceURI: 'Connor Online' },
      { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Sonia Online' },
      { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Ryan Online' },
      { name: 'Microsoft Thomas Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Thomas Online' },
    ];
    const env = makeSpeech();
    env.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    env.synth.getVoices = () => voices;
    const S = loadSpeech(env);
    S.init();
    for (const v of voices) {
      const gender = S._isFemale(v) ? 'female' : (S._isMale(v) ? 'male' : '未知');
      assert.notEqual(gender, '未知', '应判出性别：' + v.name);
    }
    assert.equal(S._isMale(voices[0]), true, 'William（夹 Multilingual）必须判为男声：' + voices[0].name);
    assert.equal(S._isMale(voices[3]), true, 'Connor 必须判为男声');
    assert.equal(S._isFemale(voices[2]), true, 'Emily 必须判为女声（漏判会让男声落到它上面）');
    const m = S.pickVoice('', 'male');
    const f = S.pickVoice('', 'female');
    assert.equal(S._isMale(m), true, '男声必须选到男声音色，实际 ' + m.name);
    assert.equal(S._isFemale(f), true, '女声必须选到女声音色，实际 ' + f.name);
    assert.notEqual(m.name, f.name, '男女不能是同一个');
    assert.equal(m.lang, 'en-GB', '男声应优先英式，实际 ' + m.name);
  });

  await check('★ 云端音色优先英式变体：getVoices() 把澳音排在前面时也不能选中澳音', () => {
    // 顺序照抄本机 Edge 实测（截图）：en-AU 在前，en-GB 在后
    const env = makeSpeech();
    env.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    env.synth.getVoices = () => [
      { name: 'Microsoft William Multilingual Online (Natural) - English (Australia)', lang: 'en-AU', localService: false, voiceURI: 'William Online' },
      { name: 'Microsoft Natasha Online (Natural) - English (Australia)', lang: 'en-AU', localService: false, voiceURI: 'Natasha Online' },
      { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Sonia Online' },
      { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Ryan Online' },
      { name: 'Microsoft Thomas Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Thomas Online' },
    ];
    const S = loadSpeech(env);
    S.init();
    const f = S.pickVoice('', 'female');
    const m = S.pickVoice('', 'male');
    assert.equal(m.lang, 'en-GB', '男声应优先英式变体（四六级音源），实际 ' + m.name);
    assert.equal(f.lang, 'en-GB', '女声应优先英式变体，实际 ' + f.name);
    assert.notEqual(f.name, m.name, '男女仍须是两个不同音色');
    assert.ok(S._isMale(m) && S._isFemale(f), '性别判定仍要正确：男=' + m.name + ' 女=' + f.name);
  });

  await check('系统语音补加载路径：多音色排序不再抛错，且与 init() 同一过滤口径', async () => {
    const env = makeSpeech();
    env.synth.getVoices = () => [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false, voiceURI: 'Aria Online' },
    ];
    const S = loadSpeech(env);            // 故意不调用 init()：走 _speakSystem 的补加载分支
    await S.speakWord('deserve');         // 旧代码在此抛 ReferenceError（voiceScore 的 TDZ）
    assert.equal(env.spoken.length, 1, '补加载后应正常朗读，实际 ' + env.spoken.length);
    const names = S.list().map(v => v.name);
    assert.equal(names.length, 2, '补加载同样要排除云端音色，实际 ' + JSON.stringify(names));
    assert.ok(/Zira/.test(names[0]), '自然度高的 Zira 应排在机械的 David 前面，实际 ' + JSON.stringify(names));
  });

  await check('已停用开源 Kokoro：旧存档迁移回系统语音，设置页不再提供入口', () => {
    const st = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
    assert.ok(/speechEngine === 'neural'\) this\.d\.settings\.speechEngine = 'system'/.test(st),
      'store 应把旧的 neural 设置迁移回 system（否则仍会去下 90MB 模型再回落）');
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    for (const id of ['engineSel', 'loadTts', 'ttsVoiceSel', 'ttsVoiceMaleSel', 'probeTts', 'ttsStatus']) {
      assert.ok(!new RegExp('id="' + id + '"').test(sv), '设置页不应再有 Kokoro 入口：' + id);
    }
    assert.ok(/id="voiceDiag"/.test(sv), '应提供发音环境诊断入口');
    assert.ok(!/Kokoro/.test(sv), '总览文案不该再出现 Kokoro');
  });

  await check('★ 听力男女对读：男女说话人必须拿到不同音色（含 Edge 云端神经音色）', async () => {
    const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    const edgeVoices = [
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false, voiceURI: 'Aria Online' },
      { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US', localService: false, voiceURI: 'Guy Online' },
      { name: 'Microsoft Libby Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Libby Online' },
      { name: 'Microsoft Thomas Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false, voiceURI: 'Thomas Online' },
    ];
    const env = makeSpeech();
    env.ua = EDGE_UA;
    env.synth.getVoices = () => edgeVoices;
    const S = loadSpeech(env);
    S.init();
    const f = S.pickVoice('', 'female');
    const m = S.pickVoice('', 'male');
    assert.ok(f && m, '男女都应选到音色，实际 f=' + (f && f.name) + ' m=' + (m && m.name));
    assert.notEqual(f.name, m.name, '男女说话人必须用不同音色，实际都用了 ' + f.name);
    assert.ok(S._isFemale(f), '女声应选到女声音色，实际 ' + f.name);
    assert.ok(S._isMale(m), '男声应选到男声音色，实际 ' + m.name);

    // 名字里完全看不出性别时，也不能让两个人共用一个音色
    const opaque = [
      { name: 'Voice A', lang: 'en-US', localService: false, voiceURI: 'Voice A' },
      { name: 'Voice B', lang: 'en-US', localService: false, voiceURI: 'Voice B' },
    ];
    const env2 = makeSpeech();
    env2.ua = EDGE_UA;
    env2.synth.getVoices = () => opaque;
    const S2 = loadSpeech(env2);
    S2.init();
    const f2 = S2.pickVoice('', 'female');
    const m2 = S2.pickVoice('', 'male');
    assert.notEqual(f2.name, m2.name, '判不出性别时也必须一男一女两个不同音色，实际都用了 ' + f2.name);
  });

  await check('听力可按性别指定音色：女声/男声各自生效，且不覆盖调用方显式指定', async () => {
    const env = makeSpeech();
    env.synth.getVoices = () => [
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
    ];
    const S = loadSpeech(env, { speechVoiceFemale: 'Microsoft Zira - English (United States)', speechVoiceMale: 'Microsoft David - English (United States)' });
    await S.speak('First line.', { gender: 'female' });
    await S.speak('Second line.', { gender: 'male' });
    assert.equal(env.spoken.length, 2);
    assert.equal(env.spoken[0].voice.name, 'Microsoft Zira - English (United States)', '女说话人应用 speechVoiceFemale，实际 ' + env.spoken[0].voice.name);
    assert.equal(env.spoken[1].voice.name, 'Microsoft David - English (United States)', '男说话人应用 speechVoiceMale，实际 ' + env.spoken[1].voice.name);
    // 背单词不带性别概念：仍走统一音色，不被男女设置串到
    const env2 = makeSpeech();
    env2.synth.getVoices = () => [
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
    ];
    const S2 = loadSpeech(env2, { speechVoice: '', speechVoiceFemale: 'Microsoft Zira - English (United States)', speechVoiceMale: 'Microsoft David - English (United States)' });
    await S2.speakWord('deserve');
    assert.equal(env2.spoken.length, 1, '背单词应照常发声');
    const st = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
    assert.ok(/speechVoiceFemale: ''/.test(st) && /speechVoiceMale: ''/.test(st), '设置里应有按性别区分的听力音色默认值');
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(/id="voiceSelF"/.test(sv), '设置页应有女声音色下拉');
    assert.ok(/id="voiceSelM"/.test(sv), '设置页应有男声音色下拉');
    assert.ok(/男女说话人分别用上面两个音色/.test(sv), '应说明男女对读的来源，避免用户误在"统一音色"里选具体项');
  });

  await check('★ 听力只有女生：统一音色不得盖掉已知性别；女声/男声按钮必须能强制覆盖', async () => {
    const env = makeSpeech();
    env.synth.getVoices = () => [
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
    ];
    // 用户把「统一音色」选成了女声——过去它会盖掉两个人的音色 → 只有女生
    const S = loadSpeech(env, { speechVoice: 'Microsoft Zira - English (United States)' });
    await S.speak('Female line.', { gender: 'female' });
    await S.speak('Male line.', { gender: 'male' });
    assert.equal(env.spoken[1].voice.name, 'Microsoft David - English (United States)',
      '有说话人标注时，男行必须用男声，不能被"统一音色"盖成 ' + env.spoken[1].voice.name);
    assert.equal(env.spoken[0].voice.name, 'Microsoft Zira - English (United States)', '女行仍用女声');

    // 材料没有标注（gender 未知）时，统一音色仍然生效
    const env2 = makeSpeech();
    env2.synth.getVoices = () => [
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
    ];
    const S2 = loadSpeech(env2, { speechVoice: 'Microsoft David - English (United States)' });
    await S2.speak('No label line.');
    assert.equal(env2.spoken[0].voice.name, 'Microsoft David - English (United States)',
      '没有说话人标注时，统一音色仍应生效，实际 ' + env2.spoken[0].voice.name);

    // 女声/男声按钮：强制覆盖行内标注
    const env3 = makeSpeech();
    env3.synth.getVoices = () => [
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' },
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true, voiceURI: 'David' },
    ];
    const S3 = loadSpeech(env3);
    S3._forceGender = 'male';
    await S3.speak('Female line.', { gender: 'female' });
    assert.equal(env3.spoken[0].voice.name, 'Microsoft David - English (United States)',
      '强制男声必须覆盖行内标注，实际 ' + env3.spoken[0].voice.name);
    const lv = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/_forceGender/.test(lv), '听力页女声/男声按钮必须走强制覆盖（只调 setGender 会被行内 gender 盖掉）');
    assert.ok(/全篇都用这个音色/.test(lv), '应告知用户这是"全篇强制"，而不是分角色');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项发音检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
