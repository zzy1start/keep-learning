/* ============ check-speech-load-source.cjs : 人声引擎的加载源与回落 ============
 * 【为什么需要这一套】本机实测（2026-10-13）：
 *   cdn.jsdelivr.net → ECONNRESET；huggingface.co → 连接超时（黑洞）；
 *   fastly.jsdelivr.net / gcore.jsdelivr.net / hf-mirror.com → 均可通。
 * 而 transformers 内部有**两处写死的默认地址**（remoteHost、onnx wasm 的 wasmPaths），
 * 只换 CDN 入口的话，模型或 wasm 照样拿不到 —— 现象就是"点了加载，无声无息地回落系统语音"。
 * 这里用假的 import/fetch 接缝验证：候选顺序、env 覆盖、失败原因是否可读、
 * 以及云端音色（Edge Online Natural）的起音预算与重试是否保留音色。
 * 【不能测什么】真实的 88MB 下载与浏览器内的实际合成效果。
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

/** 造一个假的 transformers 模块 + 假的 kokoro 模块，记录 env 覆盖情况 */
function makeLoader(opts = {}) {
  const imported = [];
  const env = { allowRemoteModels: false, remoteHost: 'https://huggingface.co/', backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/' } } } };
  const fromPretrained = [];
  const spoken = [];
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Date, Promise, Math, fetch: async () => { throw new Error('不应发起真实请求'); },
    window: { speechSynthesis: { speaking: false, pending: false, getVoices: () => [], speak() {}, cancel() {} } },
    speechSynthesis: { speaking: false, pending: false, getVoices: () => [], speak() {}, cancel() {} },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    Store: { d: { settings: Object.assign({ speechEngine: 'system', allowOnlineVoices: false }, opts.settings || {}) } },
    App: { toast() {}, modal() {} }, document: { addEventListener() {} },
    Audio: class { constructor() { this.paused = true; } play() { return Promise.resolve(); } pause() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    navigator: { gpu: null }, AbortController,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
  const S = vm.runInContext('Speech', ctx);
  const N = S.neural;
  // 接缝 1：动态 import —— 按 opts.failImport 里的基址失败
  N._import = async url => {
    imported.push(url);
    if ((opts.failImport || []).some(b => url.startsWith(b))) {
      const e = new Error('Failed to fetch dynamically imported module: ' + url);
      e.cause = { code: 'ECONNRESET' };
      throw e;
    }
    if (url.includes('/@huggingface/transformers@')) return { env };
    return { KokoroTTS: { from_pretrained: async (model, cfg) => { fromPretrained.push({ model, cfg }); return { generate: async t => { spoken.push(t); return { toBlob: () => ({}) }; } }; } } };
  };
  // 接缝 2：可达性探测
  N._head = async url => {
    if ((opts.failHead || []).some(h => url.startsWith(h))) {
      const e = new Error('fetch failed');
      e.cause = { code: opts.headCode || 'UND_ERR_CONNECT_TIMEOUT' };
      throw e;
    }
    return true;
  };
  return { S, N, env, imported, fromPretrained, spoken };
}

(async () => {
  await check('模型源按顺序探测：镜像排第一且可达就直接用（不去碰被墙的 HF，省掉 10 秒白等）', async () => {
    const m = makeLoader({});
    const tried = [];
    const host = await m.N._pickHost(tried);
    assert.equal(host, 'https://hf-mirror.com', '应选中可达的镜像，实际 ' + host);
    assert.deepEqual(tried, [], '第一项就通时不该再去探测其它源，实际 ' + JSON.stringify(tried));

    // 镜像也不通时，才轮到 HF，并且要留下可读原因（含底层错误码）
    const m2 = makeLoader({ failHead: ['https://hf-mirror.com'] });
    const tried2 = [];
    const host2 = await m2.N._pickHost(tried2);
    assert.equal(host2, 'https://huggingface.co', '镜像不通时应回落到 HF，实际 ' + host2);
    assert.ok(tried2.some(t => /hf-mirror\.com/.test(t) && /UND_ERR_CONNECT_TIMEOUT/.test(t)),
      '不通的源要留下可读原因（含底层错误码），实际 ' + JSON.stringify(tried2));
  });

  await check('env 两处写死的默认地址都被覆盖，且与所选 CDN 同源同版本', async () => {
    const m = makeLoader({ failHead: ['https://huggingface.co'] });
    const ok = await m.N.load();
    assert.equal(ok, true, '加载应成功：' + m.N.error);
    assert.equal(m.env.remoteHost, 'https://hf-mirror.com/', 'remoteHost 必须指向可达镜像（带结尾斜杠）');
    assert.equal(m.env.allowRemoteModels, true);
    assert.ok(m.env.backends.onnx.wasm.wasmPaths.startsWith('https://fastly.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/'),
      'wasmPaths 必须指向可达 CDN，否则 wasm 会从被墙的 jsDelivr 取：' + m.env.backends.onnx.wasm.wasmPaths);
    assert.equal(m.N._src.cdn, 'https://fastly.jsdelivr.net');
    assert.equal(m.N._src.host, 'https://hf-mirror.com');
    // 依赖版本必须与 kokoro 的 +esm 内部 import 的版本一致，否则 env 覆盖不到同一个模块实例
    assert.ok(m.imported.some(u => u.endsWith('/npm/@huggingface/transformers@3.5.1/+esm')), '要先 import 同版本的 transformers');
    assert.ok(m.imported.some(u => u.endsWith('/npm/kokoro-js@1.2.1/+esm')), '再从同一 CDN import kokoro-js');
  });

  await check('首选 CDN 不可用 → 自动换下一个（失败原因逐条记录）', async () => {
    const m = makeLoader({ failHead: ['https://huggingface.co'], failImport: ['https://fastly.jsdelivr.net'] });
    const ok = await m.N.load();
    assert.equal(ok, true, '第二个 CDN 应能顶上：' + m.N.error);
    assert.equal(m.N._src.cdn, 'https://gcore.jsdelivr.net', '应换到 gcore，实际 ' + m.N._src.cdn);
    assert.equal(m.env.backends.onnx.wasm.wasmPaths.startsWith('https://gcore.jsdelivr.net/'), true,
      'wasmPaths 必须跟着换到同一个 CDN（否则模型能取、wasm 取不到）');
    assert.equal(m.N.state, 'ready');
  });

  await check('所有 CDN 都不通 → 失败原因点名每一个源，不吞掉错误', async () => {
    const m = makeLoader({ failImport: ['https://fastly.jsdelivr.net', 'https://gcore.jsdelivr.net', 'https://cdn.jsdelivr.net'] });
    const ok = await m.N.load(true);
    assert.equal(ok, false, '全不通时必须返回失败（好让上层回落系统语音）');
    assert.equal(m.N.state, 'failed');
    for (const base of ['fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'cdn.jsdelivr.net']) {
      assert.ok(m.N.error.includes(base), '错误信息里应点名 ' + base + '，实际：' + m.N.error);
    }
    assert.ok(/ECONNRESET/.test(m.N.error), '应带上底层原因，实际：' + m.N.error);
  });

  await check('下载源探测：逐条给出 ✓/✗ 与结论（在等 90MB 之前就能判断）', async () => {
    const m = makeLoader({ failHead: ['https://fastly.jsdelivr.net', 'https://hf-mirror.com'] });
    const report = await m.N.probe();
    assert.ok(/✗ 语音包源 https:\/\/fastly\.jsdelivr\.net/.test(report), '应报告首选 CDN 不通：\n' + report);
    assert.ok(/✓ 语音包源 https:\/\/gcore\.jsdelivr\.net/.test(report), '应报告备选 CDN 可通：\n' + report);
    assert.ok(/✗ 模型源 https:\/\/hf-mirror\.com/.test(report), '应报告镜像不通：\n' + report);
    assert.ok(/✓ 模型源 https:\/\/huggingface\.co/.test(report), '应报告回落到 HF 可通：\n' + report);
    assert.ok(/可以加载/.test(report), '两项都通时结论应为可以加载：\n' + report);
    assert.equal(m.N._src.cdn, 'https://gcore.jsdelivr.net');
    assert.equal(m.N._src.host, 'https://huggingface.co');
  });

  await check('下载源探测：全不通时结论明确说不可加载', async () => {
    const m = makeLoader({
      failHead: ['https://fastly.jsdelivr.net', 'https://gcore.jsdelivr.net', 'https://cdn.jsdelivr.net',
        'https://hf-mirror.com', 'https://huggingface.co'],
    });
    const report = await m.N.probe();
    assert.ok(/无法加载/.test(report), '应给出不可加载的结论：\n' + report);
    assert.ok(!/✓/.test(report), '不应出现任何 ✓：\n' + report);
  });

  await check('云端音色：起音预算放宽，且重试不再把音色置空（否则悄悄退回机器声）', async () => {
    const cloud = {
      name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US',
      localService: false, voiceURI: 'Microsoft Aria Online (Natural) - English (United States)',
    };
    const spokenUtts = [];
    const ctx = vm.createContext({
      console, setTimeout, clearTimeout, Date, Promise, Math,
      window: { speechSynthesis: null }, speechSynthesis: null,
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; this.voice = null; } },
      Store: { d: { settings: { speechEngine: 'system', allowOnlineVoices: true } } },
      App: { toast() {}, modal() {} }, document: { addEventListener() {} },
      Audio: class {}, URL: { createObjectURL: () => 'b', revokeObjectURL() {} }, navigator: {},
    });
    const synth = {
      speaking: false, pending: false,
      getVoices: () => [cloud],
      /* 永不给 onstart：模拟云端音色起不来。
       * 首次朗读前的"静音预热"（文本只有空格，见 Speech._warmUpOnce）不计入，
       * 否则"重试次数"会被它多算一次。*/
      speak(u) {
        if (String(u.text == null ? '' : u.text).trim()) spokenUtts.push(u);
        synth.speaking = true;
      },
      cancel() { synth.speaking = false; },
    };
    ctx.window.speechSynthesis = synth;
    ctx.speechSynthesis = synth;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
    const S = vm.runInContext('Speech', ctx);
    S.init();
    assert.equal(S.list().length, 1, '打开开关后云端音色应在候选里');
    assert.equal(S.CLOUD_START_TIMEOUT_MS > S.START_TIMEOUT_MS, true, '云端音色的起音预算必须比本地宽');
    S.START_TIMEOUT_MS = 30;
    S.CLOUD_START_TIMEOUT_MS = 120;      // 测试里缩短
    S.SETTLE_MS = 10;
    const t0 = Date.now();
    await S.speakWord('hello');
    const elapsed = Date.now() - t0;
    assert.equal(spokenUtts.length, 2, '应重试一次，实际 ' + spokenUtts.length + ' 次');
    assert.ok(elapsed >= 120, '应等满云端预算（' + S.CLOUD_START_TIMEOUT_MS + 'ms）再重试，实际 ' + elapsed + 'ms');
    assert.equal(spokenUtts[1].voice, cloud, '重试必须保留云端音色（置空会掉回本地机器声）');
    assert.equal(S.diag[0].why, 'no-start');
    assert.equal(S.diag[0].retries, 1);
  });

  await check('本地音色不受影响：起音预算仍是 2.5 秒，重试照旧交给默认音色', async () => {
    const local = { name: 'Microsoft Hazel Desktop - English (Great Britain)', lang: 'en-GB', localService: true, voiceURI: 'Hazel' };
    const utts = [];
    const synth = { speaking: false, pending: false, getVoices: () => [local],
      /* 静音预热（文本只有空格）不计入，否则"重试次数"会多算一次 */
      speak(u) { if (String(u.text == null ? '' : u.text).trim()) utts.push(u); }, cancel() {} };
    const ctx = vm.createContext({
      console, setTimeout, clearTimeout, Date, Promise, Math,
      window: { speechSynthesis: synth }, speechSynthesis: synth,
      SpeechSynthesisUtterance: class { constructor(t) { this.text = t; this.voice = null; } },
      Store: { d: { settings: { speechEngine: 'system' } } },
      App: { toast() {}, modal() {} }, document: { addEventListener() {} },
      Audio: class {}, URL: { createObjectURL: () => 'b', revokeObjectURL() {} }, navigator: {},
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
    const S = vm.runInContext('Speech', ctx);
    S.init();
    const t0 = Date.now();
    S.START_TIMEOUT_MS = 30;
    S.CLOUD_START_TIMEOUT_MS = 5000;   // 故意设大：本地音色不该用到它
    S.SETTLE_MS = 10;
    await S.speakWord('hello');
    const elapsed = Date.now() - t0;
    assert.equal(utts.length, 2, '本地音色仍应重试一次');
    assert.ok(elapsed < 1000, '本地音色不该等云端预算，实际 ' + elapsed + 'ms');
    assert.equal(utts[1].voice, null, '本地音色的重试仍交给浏览器默认音色（原行为不变）');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项加载源检查通过');
})();
