/* ============ check-dict-audio.cjs : 真人词典音频层（③）============
 * 分两部分：
 *   A. 客户端层（js/speech.js 的 Speech.dict）：开关、优先级、800ms 回落、缓存、停止结算；
 *   B. 服务端代理（serve.js 的 /__dict-audio）：真实起服务 + 本地假上游，
 *      验证同源代理、磁盘缓存、参数校验、超时与错误码——全部不依赖外网。
 * 【不能测什么】真人录音的听感、以及有道线上接口的长期可用性。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}
const tick = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- A. 客户端层 ---------------- */
function makeClient(settings, fetchImpl) {
  const audio = [];
  const gens = [];
  const events = [];
  const fetchCalls = [];
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
  const realFetch = fetchImpl || (async () => ({ ok: true, blob: async () => ({ size: 4321 }) }));
  const ctx = vm.createContext({
    window: { speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    Store: { d: { settings: Object.assign({ speechEngine: 'neural', dictAudio: false }, settings || {}) } },
    App: { toast(m, t) { toasts.push([m, t]); }, modal() {} },
    document: { addEventListener() {} },
    console, setTimeout, clearTimeout, Date, Promise, Math, AbortController,
    Audio: AudioMock,
    URL: { createObjectURL: () => 'blob:dict', revokeObjectURL() {} },
    navigator: { gpu: null },
    fetch: (url, init) => { fetchCalls.push(String(url)); return realFetch(String(url), init); },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx);
  const S = vm.runInContext('Speech', ctx);
  S.neural.state = 'ready';
  S.neural.tts = { generate: async t => { gens.push(t); return { toBlob: () => ({}) }; } };
  return { S, audio, gens, events, fetchCalls, toasts };
}

/* ---------------- B. 服务端代理 ---------------- */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}
function freePort() { return 8400 + Math.floor(Math.random() * 1500); }

/** 起一个本地假上游：/dictvoice?audio=&type= 按 mode 返回不同结果 */
async function startFake({ mode = 'ok' } = {}) {
  const state = { hits: 0, urls: [] };
  const srv = http.createServer((req, res) => {
    state.hits++;
    state.urls.push(req.url);
    if (mode === 'timeout') return;                       // 永不响应
    if (mode === 'notaudio') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>nope</html>');
    }
    if (mode === '500') { res.writeHead(500); return res.end('boom'); }
    const body = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);   // 3KB 假 mp3
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': body.length });
    res.end(body);
  });
  const port = freePort();
  await listen(srv, port);
  return { srv, port, state };
}

(async () => {
  /* ---------- A ---------- */
  await check('默认关闭：开关未打开时不碰词典层，直接走原引擎', async () => {
    const c = makeClient({ dictAudio: false });
    assert.equal(c.S.dict.enabled(), false, '默认必须是关的（打开会把所背单词发往第三方）');
    await c.S.speakWord('deserve');
    assert.equal(c.fetchCalls.length, 0, '关闭时不该发任何请求，实际 ' + c.fetchCalls.length);
    assert.equal(c.gens.length, 1, '应照常走 Kokoro');
  });

  await check('打开后优先用真人录音：命中真人音频就不启动 Kokoro', async () => {
    const c = makeClient({ dictAudio: true });
    await c.S.speakWord('deserve');
    assert.equal(c.fetchCalls.length, 1, '应请求一次词典音频');
    assert.equal(c.audio.length, 1, '应该播放真人音频');
    assert.equal(c.gens.length, 0, '真人音频可用时不该再合成 Kokoro，实际 ' + c.gens.length);
    assert.equal(c.S.dict.state, 'ok');
  });

  await check('请求地址走同源代理，口音映射为 type=1/2，单词做 URL 编码', () => {
    const c = makeClient({ dictAudio: true, dictAccent: '1' });
    /* 撇号是 URI 里合法字符，encodeURIComponent 本就不转义它（服务端照样能解出来）；
     * 真正必须转义的是会截断查询串的 & 和 #。*/
    assert.equal(c.S.dict.urlFor("don't", '1'), "/__dict-audio?w=don't&type=1");
    assert.equal(c.S.dict.urlFor('a&b#c', '2'), '/__dict-audio?w=a%26b%23c&type=2',
      '& 与 # 必须转义，否则查询串会被截断');
    assert.equal(c.S.dict.urlFor('deserve', '2'), '/__dict-audio?w=deserve&type=2');
    assert.equal(c.S.dict.urlFor('deserve', '9'), '/__dict-audio?w=deserve&type=2', '非法口音应归一为美音');
    assert.ok(!/^(https?:)?\/\//.test(c.S.dict.urlFor('deserve', '2')), '必须是同源相对地址（跨域读不到字节）');
  });

  await check('800ms 拿不到就回落 Kokoro（预算来自 TIMEOUT_MS 常量）', async () => {
    const c = makeClient({ dictAudio: true }, (url, init) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, blob: async () => ({ size: 10 }) }), 5000);
      if (init && init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    }));
    assert.equal(c.S.dict.TIMEOUT_MS, 800, '取音频预算应为 800ms');
    c.S.dict.TIMEOUT_MS = 60;                     // 测试里缩短，避免等 0.8 秒
    await c.S.speakWord('deserve');
    assert.equal(c.gens.length, 1, '超时后必须回落到 Kokoro，实际 ' + c.gens.length);
    assert.equal(c.audio.length, 1, '回落后仍然要出声');
    assert.equal(c.S.dict.state, 'idle', '超时是暂时性的，不能标记为永久不可用');
  });

  await check('没有代理（404）→ 本会话标记不可用并回落，之后不再重复请求', async () => {
    const c = makeClient({ dictAudio: true }, async () => ({ ok: false, status: 404, blob: async () => ({ size: 0 }) }));
    await c.S.speakWord('first');
    assert.equal(c.gens.length, 1, '第一次失败后应回落 Kokoro');
    assert.equal(c.S.dict.state, 'unavailable', '404 说明没有代理（如 file:// 打开），应标记不可用');
    await c.S.speakWord('second');
    assert.equal(c.fetchCalls.length, 1, '标记不可用后不该再发请求，实际 ' + c.fetchCalls.length);
    assert.equal(c.gens.length, 2, '后续单词照常走 Kokoro');
  });

  await check('5xx 只当次失败：不标记永久不可用（服务端可能只是这次取慢了）', async () => {
    const c = makeClient({ dictAudio: true }, async () => ({ ok: false, status: 504, blob: async () => ({ size: 0 }) }));
    await c.S.speakWord('first');
    assert.equal(c.S.dict.state, 'idle', '504 不能标记为永久不可用');
    await c.S.speakWord('second');
    assert.equal(c.fetchCalls.length, 2, '下次仍应尝试，实际 ' + c.fetchCalls.length);
  });

  await check('取音频期间 stop()：立刻结算、不回落、不再出声', async () => {
    const c = makeClient({ dictAudio: true }, (url, init) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, blob: async () => ({ size: 10 }) }), 5000);
      if (init && init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
    }));
    const p = c.S.speakWord('deserve', { onerror: e => c.events.push(e.error) });
    await tick(5);
    assert.equal(c.S.dict.playing, true, '取音频期间应算"在播"（否则 stop 会被绕过）');
    assert.equal(c.S.stopIfBusy(), true, 'stopIfBusy 必须能识别正在取音频');
    const settled = await Promise.race([p.then(() => 'settled'), tick(300).then(() => 'HUNG')]);
    assert.equal(settled, 'settled', 'stop() 必须结算调用方的 Promise（不允许悬挂）');
    assert.deepEqual(c.events, ['canceled'], '停止沿用 canceled 语义，实际 ' + JSON.stringify(c.events));
    assert.equal(c.gens.length, 0, '停止之后不允许再回落起 Kokoro 出声');
    assert.equal(c.audio.length, 0, '停止之后不允许出现播放');
  });

  await check('同一单词第二次不再取字节（内存缓存）', async () => {
    const c = makeClient({ dictAudio: true });
    await c.S.speakWord('deserve');
    await c.S.speakWord('deserve');
    assert.equal(c.fetchCalls.length, 1, '内存缓存命中后不该再请求，实际 ' + c.fetchCalls.length);
    assert.equal(c.audio.length, 2, '两次都要正常播放');
  });

  /* ---------- B ---------- */
  const cacheDir = path.join(ROOT, 'work', 'tmp-dict-cache-' + process.pid);
  const fake = await startFake();
  const port = freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(port)], {
    cwd: ROOT, stdio: 'ignore',                                  // 沙箱禁止管道捕获子进程输出
    env: Object.assign({}, process.env, {
      DICT_AUDIO_ORIGIN: 'http://127.0.0.1:' + fake.port,
      DICT_AUDIO_CACHE: cacheDir,
      DICT_AUDIO_TIMEOUT_MS: '250',
    }),
  });
  const base = 'http://127.0.0.1:' + port;
  // 等服务起来
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/index.html'); break; } catch (e) { await tick(100); }
  }

  try {
    await check('代理首次请求：miss，返回 audio/mpeg，并向上游取一次', async () => {
      fake.state.hits = 0;
      const res = await fetch(base + '/__dict-audio?w=deserve&type=2');
      assert.equal(res.status, 200, '状态码应为 200，实际 ' + res.status);
      assert.equal(res.headers.get('content-type'), 'audio/mpeg');
      assert.equal(res.headers.get('x-dict-cache'), 'miss', '首次应为 miss');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 200, '应返回真实音频字节，实际 ' + buf.length);
      assert.equal(fake.state.hits, 1, '应向上游请求一次，实际 ' + fake.state.hits);
      assert.ok(/audio=deserve/.test(fake.state.urls[0]) && /type=2/.test(fake.state.urls[0]),
        '上游参数应正确转发：' + fake.state.urls[0]);
    });

    await check('代理二次请求：hit，走本机磁盘缓存，不再打扰上游', async () => {
      const res = await fetch(base + '/__dict-audio?w=deserve&type=2');
      assert.equal(res.headers.get('x-dict-cache'), 'hit', '同一单词第二次应为 hit');
      assert.ok(res.headers.get('cache-control').includes('immutable'), '应允许浏览器长期缓存');
      await res.arrayBuffer();
      assert.equal(fake.state.hits, 1, '命中磁盘缓存时不该再请求上游，实际 ' + fake.state.hits);
      const files = fs.existsSync(cacheDir)
        ? fs.readdirSync(path.join(cacheDir, '2')) : [];
      assert.equal(files.length, 1, '磁盘缓存目录里应恰好有一个文件，实际 ' + JSON.stringify(files));
    });

    await check('英音/美音分开缓存（type=1 与 type=2 互不覆盖）', async () => {
      const before = fake.state.hits;
      const r1 = await fetch(base + '/__dict-audio?w=deserve&type=1');
      assert.equal(r1.headers.get('x-dict-cache'), 'miss', '英音是另一份音频，首次应为 miss');
      await r1.arrayBuffer();
      assert.equal(fake.state.hits, before + 1, '英音应单独向上游取一次');
      const r2 = await fetch(base + '/__dict-audio?w=deserve&type=1');
      assert.equal(r2.headers.get('x-dict-cache'), 'hit');
      await r2.arrayBuffer();
      assert.ok(fs.existsSync(path.join(cacheDir, '1')), '英音应有自己的缓存子目录');
    });

    await check('参数校验：非法单词 / 穿越尝试一律 400，且不请求上游', async () => {
      const before = fake.state.hits;
      const bad = ['../../etc/passwd', '..%2f..%2fetc', '1abc', '', 'a'.repeat(60), 'word;rm -rf', 'word/../x'];
      for (const w of bad) {
        const res = await fetch(base + '/__dict-audio?w=' + encodeURIComponent(w) + '&type=2');
        assert.equal(res.status, 400, JSON.stringify(w) + ' 应被拒绝，实际 ' + res.status);
        await res.arrayBuffer();
      }
      assert.equal(fake.state.hits, before, '被拒绝的请求绝不能打到上游，实际多了 ' + (fake.state.hits - before));
    });

    await check('上游超时 → 504，且不落盘坏文件', async () => {
      const slow = await startFake({ mode: 'timeout' });
      const port2 = freePort();
      const child2 = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(port2)], {
        cwd: ROOT, stdio: 'ignore',
        env: Object.assign({}, process.env, {
          DICT_AUDIO_ORIGIN: 'http://127.0.0.1:' + slow.port,
          DICT_AUDIO_CACHE: path.join(cacheDir, 'slow'),
          DICT_AUDIO_TIMEOUT_MS: '200',
        }),
      });
      const base2 = 'http://127.0.0.1:' + port2;
      for (let i = 0; i < 60; i++) {
        try { await fetch(base2 + '/index.html'); break; } catch (e) { await tick(100); }
      }
      try {
        const res = await fetch(base2 + '/__dict-audio?w=deserve&type=2');
        assert.equal(res.status, 504, '上游超时应返回 504，实际 ' + res.status);
        await res.arrayBuffer();
        const dir = path.join(cacheDir, 'slow', '2');
        const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        assert.equal(left.length, 0, '超时不能留下缓存文件，实际 ' + JSON.stringify(left));
      } finally { child2.kill(); slow.srv.close(); }
    });

    await check('上游返回非音频 / 5xx → 502，不把错误页当音频存下来', async () => {
      for (const mode of ['notaudio', '500']) {
        const bad = await startFake({ mode });
        const port3 = freePort();
        const child3 = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(port3)], {
          cwd: ROOT, stdio: 'ignore',
          env: Object.assign({}, process.env, {
            DICT_AUDIO_ORIGIN: 'http://127.0.0.1:' + bad.port,
            DICT_AUDIO_CACHE: path.join(cacheDir, 'bad-' + mode),
            DICT_AUDIO_TIMEOUT_MS: '1000',
          }),
        });
        const base3 = 'http://127.0.0.1:' + port3;
        for (let i = 0; i < 60; i++) {
          try { await fetch(base3 + '/index.html'); break; } catch (e) { await tick(100); }
        }
        try {
          const res = await fetch(base3 + '/__dict-audio?w=deserve&type=2');
          assert.equal(res.status, 502, mode + ' 应返回 502，实际 ' + res.status);
          await res.arrayBuffer();
          const dir = path.join(cacheDir, 'bad-' + mode, '2');
          const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
          assert.equal(left.length, 0, mode + ' 不该留下缓存文件，实际 ' + JSON.stringify(left));
        } finally { child3.kill(); bad.srv.close(); }
      }
    });
  } finally {
    child.kill();
    fake.srv.close();
    await tick(150);
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
  }

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项词典音频检查通过');
})();
