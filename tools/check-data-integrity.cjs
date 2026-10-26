/* ============ check-data-integrity.cjs : 存档缺字段不能把页面弄挂 ============
 * 【为什么需要】Store.load() 早先只补**顶层**字段。存档里 stats 存在但缺 daily/days 时
 *（旧版本写的、导入的、或部分损坏的存档），统计页第一行 `st.daily[k]` 就抛
 * TypeError: Cannot read properties of undefined —— 现象是"统计点不开"。
 * 这里用真实存档载荷跑一遍 load() 再渲染统计页，锁住这个坑。
 * 【不能测什么】真实浏览器里的其它页面；本套只覆盖"存档缺字段"这一类。 */
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

/** 用给定的 localStorage 载荷启动 store.js + stats.js，返回 Store 与 ViewStats */
function boot(stored) {
  const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Promise, RegExp,
    localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el },
    window: {}, BOOKS: [{ id: 'cet6', name: 'CET-6', sub: '', size: 4000, color: '#4a7dff' }],
    on: () => {},
    $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    App: {
      freshView: () => el, freshNode: () => el,
      today: () => '2026-10-14',
      fmtDate: d => new Date(d == null ? Date.now() : d).toISOString().slice(0, 10),
      debounce: f => f, go() {}, toast() {}, modal() {}, closeModal() {},
      bars: () => '', ring: () => '', download() {},
    },
    Speech: { list: () => [], profile: () => ({ rate: 1 }) },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'), ctx);
  const Store = vm.runInContext('Store', ctx);
  Store.load();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/stats.js'), 'utf8'), ctx);
  const V = vm.runInContext('ViewStats', ctx);
  return { Store, V };
}

(async () => {
  await check('存档缺 stats.daily（旧/损坏存档）→ 统计页仍能打开', () => {
    const { Store, V } = boot(JSON.stringify({ stats: { days: [], streak: 3, lastStudy: '' }, srs: {} }));
    assert.doesNotThrow(() => V.render(null), '缺 daily 时统计页不应抛错（这正是"统计点不开"的原因）');
    assert.equal(Object.keys(Store.d.stats.daily).length, 0, 'daily 应被补成空对象');
    assert.equal(Store.d.stats.streak, 3, '已有的字段不能被覆盖');
  });

  await check('存档完全没有 stats / srs / writeLog → 统计页仍能打开', () => {
    const { Store, V } = boot(JSON.stringify({ activeBook: 'cet6' }));
    assert.doesNotThrow(() => V.render(null));
    assert.ok(Array.isArray(Store.d.stats.days), 'days 应为数组');
    assert.ok(Store.d.stats.daily && typeof Store.d.stats.daily === 'object', 'daily 应为对象');
    assert.ok(Array.isArray(Store.d.writeLog), 'writeLog 应为数组');
    assert.ok(Array.isArray(Store.d.notebook), 'notebook 应为数组');
  });

  await check('存档字段类型错乱（stats 是字符串、srs 是数组）→ 不抛错且被归一', () => {
    const { Store, V } = boot(JSON.stringify({ stats: 'oops', srs: [1, 2], writeLog: 'nope', translation: null }));
    assert.doesNotThrow(() => V.render(null));
    assert.equal(typeof Store.d.stats, 'object', 'stats 应被归一为对象');
    assert.ok(Array.isArray(Store.d.stats.days));
    assert.ok(!Array.isArray(Store.d.srs), 'srs 应是对象（数组会让 d.srs[b] 取到数字）');
    assert.ok(Array.isArray(Store.d.writeLog));
  });

  await check('存档 JSON 损坏 → 回落到默认值，页面仍能打开', () => {
    const { Store, V } = boot('{ this is not json');
    assert.doesNotThrow(() => V.render(null));
    assert.ok(Store.d.stats && Store.d.stats.daily, '应回落到默认结构');
  });

  await check('正常存档：既有数据不被清掉', () => {
    const payload = {
      stats: { days: ['2026-10-13'], streak: 5, lastStudy: '2026-10-13', daily: { '2026-10-13': { words: 20 } } },
      srs: { cet6: { deserve: { reps: 2, ease: 2.5, due: '2026-10-20' } } },
      writeLog: [{ score: 8, task: 'My essay about online learning', at: '2026-10-13T10:00:00' }, { score: 5 }],
    };
    const { Store, V } = boot(JSON.stringify(payload));
    assert.doesNotThrow(() => V.render(null),
      '写作记录里缺 task/at 的旧条目也不能让统计页崩（同类脆弱点）');
    assert.equal(Store.d.stats.streak, 5);
    assert.equal(Store.d.stats.days.length, 1, 'days 应原样保留');
    assert.equal(Store.d.stats.days[0], '2026-10-13');
    assert.equal(Store.d.stats.daily['2026-10-13'].words, 20);
    assert.equal(Store.d.srs.cet6.deserve.reps, 2);
    assert.equal(Store.d.writeLog.length, 2, '两条写作记录都应保留');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项存档健壮性检查通过');
})();
