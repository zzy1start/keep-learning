/* ============ check-import-persist.cjs : 覆盖重导的落盘（2026-11-11）============
 * 覆盖重导会沿用旧篇目 id（_putImported）。如果 _persist 还按"id 已存在就跳过"，
 * 磁盘上仍是旧分段/旧答案，重启后修复白做。本套验证：同 id 原地替换写回、新 id 追加、
 * contentBackup 分支同样替换。
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
const TextRepair = require(path.join(ROOT, 'js/text-repair.js'));

function load(opts) {
  const o = opts || {};
  const disk = o.disk || { passages: [] };
  let posted = null;
  const ctx = vm.createContext({
    window: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Promise, Set, Map,
    document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'http://127.0.0.1:8777/' },
    App: { modal() {}, toast() {}, closeModal() {}, go() {} },
    Store: { d: { settings: { ai: {} }, srs: {}, stats: { daily: {} }, importedPapers: [], mineIds: {} }, flush() {} },
    AI: { ready: false },
    Dict: { content: { listening: { passages: [] }, reading: { passages: [] }, writing: { tasks: [] } }, get() { return null; } },
    TextRepair, $: () => null, esc: v => String(v == null ? '' : v),
    fetch: async (url, init) => {
      const u = String(url);
      if (u.indexOf('data/content/reading.json') >= 0) {
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(disk)) };
      }
      if (u === '/__save-content') {
        if (o.saveFails) return { ok: false, status: 503 };
        posted = JSON.parse(init.body);
        return { ok: true, status: 200 };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/import-pipeline.js'), 'utf8'), ctx);
  ctx.ImportPipeline = ctx.window.ImportPipeline;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8'), ctx);
  return { ctx, I: ctx.window.Importer, posted: () => posted, disk };
}

(async () => {
  await check('落盘：覆盖重导沿用旧 id 时，磁盘条目被新内容替换（不是跳过）', async () => {
    const disk = { passages: [{ id: 'old-b', title: 'San Francisco', paragraphs: [{ label: 'H', text: 'old broken split' }] }] };
    const { I, posted } = load({ disk });
    await I._persist('reading', [{ id: 'old-b', title: 'San Francisco', paragraphs: [{ label: 'H', text: 'new merged paragraph' }] }]);
    const body = posted();
    assert.ok(body, '应发起保存请求');
    assert.equal(body.passages.length, 1, '同 id 不应追加成两条，实际 ' + body.passages.length);
    assert.equal(body.passages[0].paragraphs[0].text, 'new merged paragraph', '磁盘上必须是新内容');
  });

  await check('落盘：新 id 仍然追加，不会覆盖别的篇目', async () => {
    const disk = { passages: [{ id: 'keep', title: 'Passage One' }] };
    const { I, posted } = load({ disk });
    await I._persist('reading', [{ id: 'new-b', title: 'San Francisco' }]);
    const body = posted();
    assert.equal(body.passages.map(x => x.id).join(','), 'keep,new-b');
  });

  await check('落盘：同 id 与新增混合时，替换 + 追加同时生效', async () => {
    const disk = { passages: [{ id: 'old-b', text: 'old' }, { id: 'keep', text: 'stay' }] };
    const { I, posted } = load({ disk });
    await I._persist('reading', [{ id: 'old-b', text: 'new' }, { id: 'new-b', text: 'add' }]);
    const body = posted();
    assert.equal(body.passages.map(x => x.id).join(','), 'old-b,keep,new-b');
    assert.equal(body.passages[0].text, 'new');
  });

  await check('落盘失败走 contentBackup：同 id 也算"有内容要写"，且备份里是新内容', async () => {
    const disk = { passages: [{ id: 'old-b', text: 'old' }] };
    const { ctx, I } = load({ disk, saveFails: true });
    await I._persist('reading', [{ id: 'old-b', text: 'new fixed' }]);
    const backup = ctx.Store.d.contentBackup && ctx.Store.d.contentBackup.reading;
    assert.ok(Array.isArray(backup), '应写入 contentBackup');
    const hit = backup.filter(x => x.id === 'old-b');
    assert.equal(hit.length, 1, '同 id 不应重复');
    assert.equal(hit[0].text, 'new fixed');
  });

  await check('重复保存同一批（同 id 同内容）不会在磁盘上堆出重复条目', async () => {
    const disk = { passages: [] };
    const { I, posted } = load({ disk });
    const items = [{ id: 'a', text: '1' }];
    await I._persist('reading', items);
    const first = posted();
    await I._persist('reading', items);
    const second = posted();
    assert.equal(first.passages.length, 1);
    assert.equal(second.passages.length, 1, '应保持 1 条，实际 ' + second.passages.length);
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项落盘检查通过');
})();
