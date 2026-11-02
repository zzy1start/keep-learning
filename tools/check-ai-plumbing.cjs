// AI 请求管线自检：超时预算、视觉模型路由、JSON 模式、分数归一化。
// 全部用本地假 fetch，不联网、不消耗真实 Key。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let requests = [];
let script = [];
let modelList = [
  { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', input_modalities: ['text', 'image'], max_output_tokens: 393216 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', input_modalities: ['text'], max_output_tokens: 393216 },
];
let hangChat = false;

function reply(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
async function fakeFetch(url, init = {}) {
  const u = String(url);
  requests.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
  if (/\/models$/.test(u)) return reply({ object: 'list', data: modelList });
  if (hangChat) return new Promise(() => {});
  const next = script.shift();
  if (!next) return reply({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
  if (next.throw) throw new Error(next.throw);
  if (next.status && next.status >= 400) return reply({ error: { message: next.error || 'bad request' } }, next.status);
  return reply({ choices: [{ message: { content: next.content || '{}' }, finish_reason: 'stop' }] });
}

const context = vm.createContext({
  window: {},
  fetch: fakeFetch,
  AbortController,
  setTimeout,
  clearTimeout,
  console: { warn() {}, log() {} },
  Store: { d: { settings: { ai: { baseUrl: 'https://api.example.com/v1', key: 'fixture-key', model: 'deepseek-v4-pro', enabled: true } } } },
  App: { toast() {}, modal() {} },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8'), context);
const ai = context.window.AI;

let passed = 0;
async function check(name, fn) {
  requests = [];
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { console.log('FAIL ' + name + '：' + (e && e.message)); process.exitCode = 1; }
}

(async () => {
  await check('默认请求预算：max_tokens 8000、单次超时 180s，并带 response_format', async () => {
    script = [{ content: '{"ok":true}' }];
    const out = await ai.json([{ role: 'user', content: 'x' }]);
    assert.equal(out.ok, true);
    const body = requests.find(r => /chat\/completions$/.test(r.url)).body;
    assert.equal(body.max_tokens, 8000);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.model, 'deepseek-v4-pro');
  });

  await check('图片请求自动切到支持图片的模型（deepseek-flash），文本请求仍用原模型', async () => {
    requests = [];
    script = [{ content: '{"ok":true}' }];
    await ai.chat([{ role: 'user', content: [
      { type: 'text', text: '识别图片' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ] }], { max: 500 });
    const body = requests.find(r => /chat\/completions$/.test(r.url)).body;
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(ai._lastModelSwitch && ai._lastModelSwitch.from, 'deepseek-v4-pro');
    assert.equal(ai._lastModelSwitch && ai._lastModelSwitch.to, 'deepseek-flash');

    requests = [];
    script = [{ content: '{"ok":true}' }];
    await ai.chat([{ role: 'user', content: 'x' }], { max: 500 });
    const textBody = requests.find(r => /chat\/completions$/.test(r.url)).body;
    assert.equal(textBody.model, 'deepseek-v4-pro');
  });

  await check('jsonRetry 把原生桥的 timeout 当作可重试错误', async () => {
    script = [{ throw: 'timeout' }, { content: '{"ok":true}' }];
    const out = await ai.jsonRetry([{ role: 'user', content: 'x' }], { tries: 2, max: 8000 });
    assert.equal(out.ok, true);
  });

  await check('JS 侧超时能真正结束请求（原生桥不认 AbortSignal 的兜底）', async () => {
    hangChat = true;
    try {
      await assert.rejects(
        ai.chat([{ role: 'user', content: 'x' }], { timeout: 1000, max: 100 }),
        /请求超时/,
      );
    } finally { hangChat = false; }
  });

  await check('翻译分数自动归一化：四维和≠总分、自报满分≠本题满分都能修', async () => {
    const a = { score: { TR: 3.5, CC: 3.5, LR: 3.5, GRA: 3.5, total: 10, max: 15 } };
    assert.equal(ai.normalizeTranslationScore(a, 15), '');
    const sum = ['TR', 'CC', 'LR', 'GRA'].reduce((n, k) => n + a.score[k], 0);
    assert.ok(Math.abs(sum - 10) < 0.01, '四维和应为 10，实际 ' + sum);

    const b = { score: { TR: 7, CC: 7, LR: 7, GRA: 7, total: 28, max: 30 } };
    assert.equal(ai.normalizeTranslationScore(b, 15), '');
    assert.equal(b.score.max, 15);
    assert.ok(Math.abs(b.score.total - 14) < 0.01, '总分应缩放到 14，实际 ' + b.score.total);

    const c = { score: { TR: 4, CC: 4, LR: 4, GRA: 4, total: 18, max: 15 } };
    assert.match(ai.normalizeTranslationScore(c, 15), /范围/);
    assert.match(ai.normalizeTranslationScore({ score: {} }, 15), /缺失/);
  });

  await check('JSON 截断修复：字符串内换行会转义、尾逗号会去掉', async () => {
    const raw = '{"a":"line1\nline2",}';
    const parsed = JSON.parse(ai._repairJSON(raw));
    assert.equal(parsed.a, 'line1\nline2');
  });

  await check('原生 HTTP 超时已放宽到 5 分钟（不再 60s 掐断长批改）', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/native-http.js'), 'utf8');
    assert.match(src, /readTimeout:\s*300000/);
    assert.match(src, /connectTimeout:\s*30000/);
  });

  await check('长批改预算接线：翻译/写作 12000，阅读核验 12000，默认 8000', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8');
    assert.ok((src.match(/max: 12000/g) || []).length >= 4, '翻译/写作/图片/阅读应有 4 处 12000');
    assert.match(src, /AI_DEFAULT_MAX_TOKENS = 8000/);
    assert.match(src, /timeout\|timed out\|返回格式异常/);
  });

  console.log('');
  console.log('全部 ' + passed + ' 项 AI 管线检查通过（本地假 fetch，无真实调用）');
  if (process.exitCode) process.exit(process.exitCode);
})();
