/* ============ check-import-replay.cjs : 录制 AI 输出的重放度量（2026-10-17）============
 * 用 tools/import-replay/*.json 里录制好的 AI 输出（按批次固定保存）重放进流水线，统计：
 *   · 完整率（期望题号 vs 最终入库题号）
 *   · 重复/多出题号、错分（题号是否落在 expected 金标模块里）
 *   · 重试批次数、AI 调用次数、本地回填/批内二分
 *   · 录制耗时：串行总和 + 并发 1/2/3/4 的估算墙钟
 *   · 二次导入缓存命中
 * 不发真实网络请求。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'tools/import-replay');
const fixtureFiles = fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json')).sort();
const fixtures = fixtureFiles.map(f => {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8').replace(/^\uFEFF/, ''));
  data.file = f;
  return data;
});

const pctx = vm.createContext({ window: {}, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8'), pctx);
const IP = pctx.window.ImportPipeline;
const importerSrc = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}
async function checkAsync(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

/** 用录制 fixture 作为 AI 假实现；按 prompt 里的"第 N 批"取对应录制 */
function loadImporter(recordings, storeRef = {}) {
  const calls = [];
  const perBatch = new Map();
  const mockAI = {
    ready: true,
    calls,
    async jsonRetry(messages) {
      const sys = String(messages[0].content || '');
      const m = sys.match(/第 (\d+) 批/);
      const idx = m ? Number(m[1]) - 1 : 0;
      const rec = recordings[idx];
      if (!rec) throw new Error('没有第 ' + (idx + 1) + ' 批的录制');
      const n = (perBatch.get(idx) || 0) + 1;
      perBatch.set(idx, n);
      const useRetry = n > 1 && rec.retry;
      calls.push({
        idx, n, module: rec.output && rec.output.module,
        latencyMs: useRetry ? rec.retry.latencyMs : rec.latencyMs,
        retry: !!useRetry,
      });
      return JSON.parse(JSON.stringify(useRetry ? rec.retry.output : rec.output));
    },
  };
  const localStorageShim = {
    getItem: k => (Object.prototype.hasOwnProperty.call(storeRef, k) ? storeRef[k] : null),
    setItem: (k, v) => { storeRef[k] = String(v); },
    removeItem: k => { delete storeRef[k]; },
  };
  const ctx2 = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: localStorageShim, location: { href: 'http://127.0.0.1:8777/' },
    App: { modal() {}, toast() {}, closeModal() {}, go() {} },
    Store: { d: { settings: { ai: {} }, srs: {}, stats: { daily: {} } }, flush() {} },
    AI: mockAI,
    Dict: { content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } } },
    ImportPipeline: IP,
    $: () => null, esc: v => String(v == null ? '' : v),
  });
  vm.runInContext(importerSrc, ctx2);
  return { Importer: ctx2.window.Importer, calls };
}

/** 最终结果的 题号 → 模块 映射 */
function placementMap(modules) {
  const map = new Map();
  for (const item of modules.reading || []) for (const q of item.questions || []) {
    const n = Number(q && q.number);
    if (Number.isFinite(n)) map.set(n, 'reading');
  }
  for (const item of modules.listening || []) for (const q of item.qs || []) {
    const n = Number(q && q.number);
    if (Number.isFinite(n)) map.set(n, 'listening');
  }
  return map;
}

/** 批次总耗时（录制）按批次顺序分组，估算不同并发的墙钟 */
function wallEstimates(calls) {
  const byBatch = new Map();
  calls.forEach(c => byBatch.set(c.idx, (byBatch.get(c.idx) || 0) + c.latencyMs));
  const order = [...byBatch.keys()].sort((a, b) => a - b);
  const out = {};
  for (const conc of [1, 2, 3, 4]) {
    let ms = 0;
    for (let i = 0; i < order.length; i += conc) {
      ms += Math.max(...order.slice(i, i + conc).map(k => byBatch.get(k)));
    }
    out[conc] = ms;
  }
  return out;
}

(async () => {
  const table = [];
  for (const fixture of fixtures) {
    const sharedStore = {};
    const { Importer, calls } = loadImporter(fixture.recordings, sharedStore);
    const out = await Importer._aiSplitBatched(fixture.paper, fixture.meta);
    const rep = out.importBatchReport;
    const placed = placementMap(out.modules);
    const expected = Object.entries(fixture.expected || {}).flatMap(([mod, nums]) => nums.map(n => ({ n, mod })));
    const expectedNumbers = expected.map(x => x.n);
    const missing = expectedNumbers.filter(n => !placed.has(n));
    const misplaced = expected.filter(x => placed.has(x.n) && placed.get(x.n) !== x.mod);
    const gotNumbers = [...placed.keys()];
    const extra = gotNumbers.filter(n => !expectedNumbers.includes(n));
    const duplicates = gotNumbers.filter((n, i) => gotNumbers.indexOf(n) !== i);
    const retryBatches = [...new Set(calls.filter(c => c.n > 1).map(c => c.idx))];
    const expectedRetries = fixture.recordings.filter(r => r.retry).length;
    const serialMs = calls.reduce((s, c) => s + c.latencyMs, 0);
    const walls = wallEstimates(calls);
    const metrics = {
      sample: fixture.file.replace('-recorded.json', ''),
      batches: rep.batches,
      aiCalls: calls.length,
      retryBatches: retryBatches.length,
      expectedRetries,
      failures: rep.failures.length,
      localRepairs: rep.repairs || 0,
      splitBatches: rep.splitBatches || 0,
      expectedQuestions: expectedNumbers.length,
      completenessPct: expectedNumbers.length ? +(((expectedNumbers.length - missing.length) / expectedNumbers.length) * 100).toFixed(1) : 100,
      missing, misplaced: misplaced.map(x => x.n + '→' + placed.get(x.n) + '(期望' + x.mod + ')'),
      duplicates, extra,
      recordedSerialMs: serialMs,
      wallMs: walls,
    };
    table.push(metrics);
    console.log('--- ' + metrics.sample + ' ---');
    console.log(JSON.stringify(metrics));

    check(metrics.sample + '：完整率 100%、无缺题/重复/多出/错分', () => {
      assert.deepEqual(missing, [], '缺题：' + missing.join(','));
      assert.deepEqual(duplicates, [], '重复：' + duplicates.join(','));
      assert.deepEqual(extra, [], '多出：' + extra.join(','));
      assert.deepEqual(misplaced, [], '错分：' + JSON.stringify(misplaced));
      assert.equal(metrics.completenessPct, 100);
    });
    check(metrics.sample + '：重试批次数与录制一致、没有失败批', () => {
      assert.equal(rep.failures.length, 0, '失败批：' + JSON.stringify(rep.failures));
      assert.equal(retryBatches.length, expectedRetries, '重试批应 ' + expectedRetries + '，实际 ' + retryBatches.length);
    });
    check(metrics.sample + '：并发 3 比串行/并发 2 更快（墙钟估算）', () => {
      assert.equal(walls[1], serialMs);
      assert.ok(walls[3] <= walls[2] && walls[2] <= walls[1], '墙钟应随并发下降：' + JSON.stringify(walls));
      assert.ok(walls[3] > 0);
    });
  }

  /* 二次导入缓存：用 cet6 录制验证（同一 localStorage） */
  await checkAsync('录制重放：二次导入全部命中缓存、不再请求 AI', async () => {
    const fixture = fixtures.find(f => f.file === 'cet6-recorded.json');
    const sharedStore = {};
    const first = loadImporter(fixture.recordings, sharedStore);
    await first.Importer._aiSplitBatched(fixture.paper, fixture.meta);
    const second = loadImporter(fixture.recordings, sharedStore);
    const again = await second.Importer._aiSplitBatched(fixture.paper, fixture.meta);
    assert.equal(second.calls.length, 0, '缓存命中后不应再调用 AI');
    assert.equal(again.importBatchReport.cacheHits, again.importBatchReport.batches);
  });

  console.log('\n=== 录制重放汇总 ===');
  console.table(table.map(m => ({
    sample: m.sample,
    batches: m.batches,
    calls: m.aiCalls,
    retries: m.retryBatches,
    completeness: m.completenessPct + '%',
    misplaced: m.misplaced.length,
    wall1: m.recordedSerialMs,
    wall3: m.wallMs[3],
  })));

  if (failed) process.exitCode = 1;
  else console.log('\n全部 ' + passed + ' 项录制重放检查通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
