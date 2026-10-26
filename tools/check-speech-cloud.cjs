/* ============ check-speech-cloud.cjs : 云端神经音色的自愈与"真出声"判定 ============
 * 【要解决的问题】"听力有时还是人机声"。有三条互相独立的成因，本套逐条锁住：
 *   ① 自愈太狠：云端音色连续两次没起音就把 cloudOff 打开，而它原来是**整会话不再恢复**，
 *      用户既看不到原因也没有入口改回来 → 现在改成"带冷却的软关闭 + 一键重新启用"；
 *   ② 只认一种失败：旧代码只把 no-start 记账。云端音色在 Edge 里更常见的失败形态是
 *      **来了 onstart、紧接着 onend，或者干脆没有 onend**（听感=没声音），
 *      这两种原来都算"成功"，于是永远不自愈、也永远不提示；
 *   ③ 看不出用的哪个音色：诊断表只有毫秒数，判断不了这一句到底是云端还是本地机器声。
 *
 * 【能测什么 / 不能测什么】本环境没有扬声器，也进不了用户的 Edge（沙箱禁止启动浏览器），
 * 所以这里用**模拟引擎**精确构造上述事件序列来验证判定与记账逻辑；
 * 真实听感仍需人工验收（设置页 → 🩺 发音环境诊断 → 音色清单；听力页 → 🔍 发音诊断）。
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

const CLOUD_F = { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US',
  localService: false, voiceURI: 'Microsoft Aria Online (Natural) - English (United States)' };
const CLOUD_M = { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US',
  localService: false, voiceURI: 'Microsoft Guy Online (Natural) - English (United States)' };
const LOCAL_F = { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true, voiceURI: 'Zira' };

const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 造一个可控引擎：behavior(u, synth) 决定怎么回事件 */
function makeEnv(voices, behavior) {
  const env = { spoken: [], toasts: [], ua: EDGE_UA };
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    speak(u) {
      env.spoken.push({ text: u.text, voice: u.voice && u.voice.name, at: Date.now() });
      synth.speaking = true;
      behavior(u, synth);
    },
    cancel() { synth.speaking = false; synth.pending = false; },
  };
  env.synth = synth;
  class Utt { constructor(t) { this.text = t; this.volume = 1; this.rate = 1; this.pitch = 1; } }
  env.Utt = Utt;
  return env;
}

function loadSpeech(env, settings) {
  const ctx = vm.createContext({
    window: { speechSynthesis: env.synth },
    speechSynthesis: env.synth,
    SpeechSynthesisUtterance: env.Utt,
    Store: { d: { settings: Object.assign({ speechRate: 1, speechVoice: '', speechVoiceFemale: '', speechVoiceMale: '' }, settings || {}) } },
    App: { toast(msg, type) { env.toasts.push([String(msg), type]); }, modal() {} },
    document: { addEventListener() {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Math, JSON,
    Audio: function () { return { play: () => Promise.resolve(), pause() {} }; },
    navigator: { userAgent: env.ua },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
  const S = vm.runInContext('Speech', ctx);
  S.init();
  S.SETTLE_MS = 5;
  S.MIN_PREROLL_MS = 1;
  return S;
}

/** 引擎行为：起音 5ms，然后"读完"得极快（远端只给事件不出声的形态） */
const silentFast = u => {
  setTimeout(() => u.onstart && u.onstart({}), 5);
  setTimeout(() => u.onend && u.onend({}), 12);
};
/** 引擎行为：起音后**永不回调** onend */
const startThenSilence = u => { setTimeout(() => u.onstart && u.onstart({}), 5); };
/** 引擎行为：正常读完。时长按真实语音的量级给（≈60ms/字符），
 * 否则模拟引擎"49 个字符 260ms 读完"会被 no-audio 判定正确地拦下来。 */
const normal = u => {
  setTimeout(() => u.onstart && u.onstart({}), 5);
  setTimeout(() => u.onend && u.onend({}), Math.max(200, String(u.text || '').length * 60));
};
const neverStart = () => {};

(async () => {
  await check('云端音色"起了个头就没声"：记为 no-audio 并计入失败（旧代码算成功）', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], silentFast);
    const S = loadSpeech(env);
    assert.ok(/Online/.test(S.pickVoice('', 'female').name), '初始应选云端音色');
    await S.speak('A sentence that is long enough to need real audio.');
    const d = S.diag[0];
    assert.equal(d.why, 'no-audio', '起音后立刻结束应记为 no-audio，实际 ' + d.why);
    assert.equal(d.voiceCloud, 1, '诊断里必须标出这句用的是云端音色');
    assert.equal(S._cloudFails, 1, '这次失败必须记账，否则永远不提示也不自愈');
    assert.ok(env.toasts.some(t => /未能正常发声/.test(t[0])), '应提示用户：实际 ' + JSON.stringify(env.toasts.map(t => t[0])));
  });

  await check('连续两次没声后进入冷却：退回本地音色，且提示里给出恢复办法', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], silentFast);
    const S = loadSpeech(env);
    await S.speak('First long sentence that should have produced audio.');
    await S.speak('Second long sentence that should have produced audio.');
    assert.equal(S.cloudOff, true, '连续两次应进入自愈冷却');
    assert.ok(!/Online/.test(S.pickVoice('', 'female').name), '冷却期内自动选择应退回本地音色');
    const toast = env.toasts.map(t => t[0]).join(' | ');
    assert.ok(/自动再试|重新启用/.test(toast), '提示必须告诉用户这是暂时的、怎么立刻恢复：' + toast);
  });

  await check('冷却到期后自动再试云端（不再"一次失败 = 整会话人机声"）', () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], silentFast);
    const S = loadSpeech(env);
    /* 直接把时钟推过冷却期：不依赖等 60 秒 */
    S.cloudOff = true; S._cloudOffAt = Date.now() - S.CLOUD_RETRY_MS - 1;
    assert.equal(S._cloudDisabled(), false, '冷却结束后不应再拦着云端音色');
    assert.ok(/Online/.test(S.pickVoice('', 'female').name), '冷却结束后应自动再用云端音色，实际 ' + S.pickVoice('', 'female').name);
  });

  await check('云端成功一次即解除冷却并清零失败计数', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], normal);
    const S = loadSpeech(env);
    S.cloudOff = true; S._cloudOffAt = Date.now() - S.CLOUD_RETRY_MS - 1; S._cloudFails = 2;
    await S.speak('A sentence read normally by the cloud voice.');
    assert.equal(S.cloudOff, false, '云端正常读完应解除自愈冷却');
    assert.equal(S._cloudFails, 0, '成功一次后失败计数应清零');
    assert.equal(S.diag[0].why, 'end');
  });

  await check('起音后没有 onend：也算云端失败（旧代码只认 no-start）', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], startThenSilence);
    const S = loadSpeech(env);
    S.CLOUD_START_TIMEOUT_MS = 50;    // 云端起音预算（这里会很快起音，看不出来即可）
    await S.speak('Short.');
    const d = S.diag[0];
    assert.equal(d.why, 'no-end', '起音后没有回调应记为 no-end，实际 ' + d.why);
    assert.equal(S._cloudFails, 1, 'no-end 对云端同样意味着"这句没出声"，必须记账');
  });

  await check('本地音色不受这套记账影响：短促结束仍是 end，不会触发冷却', async () => {
    const env = makeEnv([LOCAL_F], silentFast);
    const S = loadSpeech(env);
    assert.equal(S.allowOnline, true, '（Edge 下放行云端，但本机只有本地音色）');
    await S.speak('One short local read.');
    assert.equal(S.diag[0].why, 'end', '本地音色读得短是正常的，不能判成 no-audio');
    assert.ok(!S.cloudOff, '本地音色绝不能触发云端自愈');
    assert.equal(S._cloudFails || 0, 0);
  });

  await check('no-start（引擎没开口）仍然计数并自愈（原行为不能丢）', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], neverStart);
    const S = loadSpeech(env);
    S.CLOUD_START_TIMEOUT_MS = 20; S.START_TIMEOUT_MS = 20;
    await S.speak('nope');
    await S.speak('nope2');
    assert.equal(S.cloudOff, true, '连续两次起音失败仍应自愈');
    assert.ok(env.toasts.some(t => /云端神经音色连续起音失败/.test(t[0])), '原有提示文案要保留：' + JSON.stringify(env.toasts.map(t => t[0])));
  });

  await check('resetCloud()：一键立刻恢复云端（设置页按钮走它）', () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], silentFast);
    const S = loadSpeech(env);
    S.cloudOff = true; S._cloudOffAt = Date.now(); S._cloudFails = 2;
    assert.equal(S.resetCloud(false), true, '应报告"之前确实处于关闭状态"');
    assert.equal(S.cloudOff, false);
    assert.equal(S._cloudFails, 0);
    assert.ok(/Online/.test(S.pickVoice('', 'female').name), '恢复后应立刻用回云端音色');
    assert.ok(env.toasts.some(t => /已重新启用云端神经音色/.test(t[0])), '应给出可见反馈');
    S.cloudOff = true; env.toasts.length = 0;
    S.resetCloud(true);
    assert.equal(env.toasts.length, 0, 'silent=true 时不应提示（自动恢复用）');
  });

  await check('发音环境诊断：写明云端状态与"听力将使用"的三个音色', () => {
    const env = makeEnv([CLOUD_F, CLOUD_M, LOCAL_F], normal);
    const S = loadSpeech(env);
    const r = S.voiceReport();
    assert.ok(/云端音色状态：/.test(r), '必须有一行说明云端音色当前是否在用');
    assert.ok(/听力将使用：/.test(r), '必须列出女声/男声/统一音色各自会用哪个');
  });

  await check('★ 显式选了本地音色 → 诊断必须点明这就是"有时人机声"的原因', () => {
    const env = makeEnv([CLOUD_F, CLOUD_M, LOCAL_F], normal);
    const S = loadSpeech(env, { speechVoiceFemale: LOCAL_F.name });
    const r = S.voiceReport();
    assert.ok(/⚠/.test(r), '显式选了本地音色必须给出警告：\n' + r);
    assert.ok(/本地·机器声/.test(r), '要写明它是本地机器声');
    assert.ok(/改回「自动」/.test(r), '要告诉用户怎么改回去');
  });

  await check('诊断表带音色信息：能分辨"这一句用的是云端还是本地"', async () => {
    const env = makeEnv([CLOUD_F, LOCAL_F], normal);
    const S = loadSpeech(env);
    await S.speak('A cloud sentence.');
    const d = S.diag[0];
    assert.ok(d.voiceName && /Online/.test(d.voiceName), '诊断必须记录音色名，实际 ' + d.voiceName);
    assert.equal(d.voiceCloud, 1);
  });

  await check('设置页有「重新启用云端音色」并已接线；听力诊断表有音色列', () => {
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(/id="cloudRetry"/.test(sv), '设置页需要该按钮');
    assert.ok(/#cloudRetry'\)/.test(sv) && /resetCloud/.test(sv), '按钮必须接到 Speech.resetCloud()');
    const lv = fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8');
    assert.ok(/voiceName/.test(lv) && /voiceCloud/.test(lv), '听力页诊断表要显示音色与云端/本地');
  });

await check('诊断顺序：结论在前、音色清单在后（截图给人看时关键行不会被挤出屏幕）', () => {
    const env = makeEnv([CLOUD_F, CLOUD_M, LOCAL_F], normal);
    const S = loadSpeech(env);
    const r = S.voiceReport();
    const iListen = r.indexOf('听力将使用：');
    const iCount = r.indexOf('英语音色共');
    assert.ok(iListen > 0 && iCount > 0, '两行都要在：\n' + r);
    assert.ok(iListen < iCount, '"听力将使用"必须排在 20 行音色清单之前');
    assert.ok(r.indexOf('云端音色状态：') < iCount, '"云端音色状态"也要在前面');
  });

  await check('背单语音色被钉成本地音色时，诊断同样要点名（截图里 Hazel 就是这样）', () => {
    const env = makeEnv([CLOUD_F, CLOUD_M, LOCAL_F], normal);
    const S = loadSpeech(env, { wordVoice: LOCAL_F.name });
    const w = S.voicePickWarning();
    assert.ok(/背单语音色/.test(w), '必须点名背单语音色：' + w);
    assert.ok(/Microsoft Zira/.test(w), '要写出具体音色名');
    assert.ok(/⚠/.test(S.voiceReport()), '诊断里要出现警告');
    assert.ok(/背单词将使用：/.test(S.voiceReport()), '要有一行写明背单词会用哪个音色');
  });

  await check('resetVoicePicks()：一键把听力三项+背单词改回自动，返回实际改掉的项', () => {
    const env = makeEnv([CLOUD_F, CLOUD_M, LOCAL_F], normal);
    const S = loadSpeech(env, {
      speechVoiceFemale: LOCAL_F.name, speechVoiceMale: '', speechVoice: 'Microsoft George', wordVoice: LOCAL_F.name,
    });
    const cleared = S.resetVoicePicks(true);
    /* 注意：返回值来自 vm 上下文，跨 realm 的数组原型不同，deepStrictEqual 会误判，
     * 所以按 JSON 比较内容而不是用 deepEqual。*/
    assert.equal(JSON.stringify(Array.from(cleared)), JSON.stringify(['听力女声', '听力统一音色', '背单语音色']),
      '实际 ' + JSON.stringify(cleared));
    const st = S.localVoicePicks();
    assert.equal(st.length, 0, '清完之后不应再有点名的项');
    assert.equal(S.voicePickWarning(), '', '警告应消失');
    /* includeWord=false 时不许动背单词的选择 */
    S.resetVoicePicks(false);
    assert.ok(/自动/.test(S.voiceReport()), '改回自动后诊断应显示为自动');
  });

  await check('设置页：页面内可见警告 + 「音色改回自动」按钮已接线', () => {
    const sv = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    assert.ok(/id="autoVoices"/.test(sv), '设置页需要该按钮');
    assert.ok(/#autoVoices'\)/.test(sv) && /resetVoicePicks/.test(sv), '按钮必须接到 Speech.resetVoicePicks()');
    assert.ok(/voicePickWarning/.test(sv), '页面内（不只诊断里）要显示这条警告');
  });

await check('previewVoice()：界面写出的音色与真实取音色口径一致（人机声要能当场定位）', () => {
    const all = loadSpeech(makeEnv([CLOUD_F, LOCAL_F], normal));
    const v1 = all.previewVoice({});
    assert.equal(v1.cloud, true, '全自动时应选云端：' + JSON.stringify(v1));
    assert.ok(/自动/.test(v1.source), '来源应写"自动"：' + v1.source);

    /* 单句听力没有说话人标注 → 走"听力女声"设置；它被钉成本地音色时，
     * 卡片上必须如实写明"本地·机器声 + 来源=听力女声设置"，否则用户无从判断。*/
    const pinned = loadSpeech(makeEnv([CLOUD_F, LOCAL_F], normal), { speechVoiceFemale: LOCAL_F.name });
    const v2 = pinned.previewVoice({});
    assert.equal(v2.name, LOCAL_F.name);
    assert.equal(v2.cloud, false);
    assert.equal(v2.source, '听力女声设置', '来源：' + v2.source);

    const word = loadSpeech(makeEnv([CLOUD_F, LOCAL_F], normal), { wordVoice: LOCAL_F.name });
    const v3 = word.previewVoice({ word: true });
    assert.equal(v3.name, LOCAL_F.name);
    assert.equal(v3.source, '背单词音色设置', '来源：' + v3.source);
  });

await check('_voicesReady()：Edge 放行云端时，必须等到云端音色出现才算"列表齐了"', () => {
    const S1 = loadSpeech(makeEnv([LOCAL_F], normal)); S1.init();
    assert.equal(S1._voicesReady(), false, '只有本地音色 = 还没齐（云端音色尚未发布）');
    const S2 = loadSpeech(makeEnv([LOCAL_F, CLOUD_F], normal)); S2.init();
    assert.equal(S2._voicesReady(), true);
    /* 非 Edge 用 Chrome UA：init() 会按 UA 重算 isEdge/allowOnline，手工赋值会被覆盖 */
    const chromeEnv = makeEnv([LOCAL_F], normal);
    chromeEnv.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
    const S3 = loadSpeech(chromeEnv);
    assert.equal(S3._voicesReady(), true, '非 Edge / 未放行云端时，有英文音色就算齐');
  });

  await check('init() 持续刷新直到云端音色出现（原来第一次拿到非空列表就停止刷新）', async () => {
    const list = [LOCAL_F];                     // Edge 最先只发布本地音色
    const env = makeEnv(list, normal);
    const S = loadSpeech(env);
    S.init();
    assert.equal(S.voices.length, 1, '初始只有 1 个本地音色');
    setTimeout(() => list.push(CLOUD_F), 120);  // 云端音色稍后才发布
    await sleep(400);
    assert.ok(S.voices.some(v => S._isCloud(v)),
      '轮询应把后到的云端音色补进列表，实际 ' + JSON.stringify(S.voices.map(v => v.name)));
  });

  await check('★ 刷新后第一次播放：等音色列表齐全，直接就用云端音色（用户实测"首次是人机声"）', async () => {
    const list = [LOCAL_F];
    const env = makeEnv(list, normal);
    const S = loadSpeech(env);
    S.init();
    const p = S.speak('A sentence that must not be read by the local machine voice.');
    setTimeout(() => list.push(CLOUD_F), 150);
    await p;
    const first = env.spoken.find(x => String(x.text || '').trim());
    assert.ok(first, '应当真的朗读了内容');
    assert.ok(/Online/.test(String(first.voice || '')),
      '第一次真正朗读就必须用云端音色，实际 ' + (first.voice && first.voice.name));
  });

  await check('★ 首次朗读前先做一次静音预热（吞音的代价不落在真实内容上），且只做一次', async () => {
    const env = makeEnv([CLOUD_F], normal);
    const S = loadSpeech(env);
    await S.speak('First real sentence for the warm-up check.');
    assert.ok(env.spoken.length >= 2, '第一次应有"预热 + 真实朗读"两次 speak：' + JSON.stringify(env.spoken.map(x => x.text)));
    assert.equal(String(env.spoken[0].text).trim(), '', '预热必须是静音（文本只有空白）');
    assert.equal(env.spoken[0].voice, CLOUD_F.name, '预热要用同一个音色，才能把该音色叫醒');
    const before = env.spoken.length;
    await S.speak('Second real sentence.');
    assert.equal(env.spoken.length, before + 1, '预热只做一次，第二次朗读不再预热');
  });

  await check('首次朗读多等一点（引擎冷启动），第二次立刻开口', async () => {
    const env = makeEnv([CLOUD_F], normal);
    const S = loadSpeech(env);
    const t0 = Date.now();
    const p1 = S.speak('First sentence for the cold start check.');
    while (!env.spoken.some(x => String(x.text || '').trim()) && Date.now() - t0 < 3000) await sleep(10);
    const firstStart = Date.now() - t0;
    await p1;
    assert.ok(firstStart >= 150, '首次朗读应先给引擎一点准备时间，实测 ' + firstStart + 'ms');
    const t1 = Date.now();
    const p2 = S.speak('Second sentence.');
    while (env.spoken.filter(x => String(x.text || '').trim()).length < 2 && Date.now() - t1 < 3000) await sleep(10);
    const secondStart = Date.now() - t1;
    await p2;
    assert.ok(secondStart <= 120, '第二次朗读不该再等，实测 ' + secondStart + 'ms');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项云端音色检查通过');
})();
