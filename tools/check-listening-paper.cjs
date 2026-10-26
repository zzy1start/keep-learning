/* ============ check-listening-paper.cjs : 听力篇目的题型与"缺原文" ============
 * 【背景·2024-12 六级那卷】data/content/listening.json 里那 6 篇 imp-listening-… 记录
 * 来自"只有题干与选项"的真题文件：**script 是空的**，于是原文区一片空白、点播放没有声音、
 * 答案也无从判断。这里做两件事：
 *   ① 用真实数据文件把"这篇到底缺什么"钉死（结构合法性 + 缺原文的口径）；
 *   ② 让界面把缺失说清楚（缺原文横幅）、并按题号/Section 推导出「题型」标签
 *      —— 原来卡片上只有 level（CET-6）与"AI 核验类型"，看不出是长对话还是短文。
 * 【不能测什么】真实浏览器里的渲染观感；原文本身无法凭空补出来（需要重新导入含 Tapescripts 的文件）。
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

function loadView() {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Date, Math, JSON,
    window: {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    App: { toast() {}, freshNode: () => null },
    $: () => null, $$: () => [], esc: v => String(v == null ? '' : v),
    Store: { d: { settings: { speechRate: 1, listenLeadIn: 2 } } },
    AI: { ready: false },
    Speech: { voices: [], stop() {}, speak() {}, prefetch() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/views/listening.js'), 'utf8'), ctx);
  const v = ctx.window.ViewListen;
  v.mode = 'read';
  v._wSpan = t => ctx.esc(t);
  return v;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content/listening.json'), 'utf8'));
  const dec24 = (data.passages || []).filter(p => p && p.year === 2024 && String(p.session) === '12');
  const view = loadView();

  if (dec24.length) {
    await check('data/ 里 2024-12 那卷：6 篇记录结构合法（题干与选项齐全）', () => {
      assert.equal(dec24.length, 6, '2024-12 应有 6 篇（Section A + 5 篇材料），实际 ' + dec24.length);
      let qs = 0;
      for (const p of dec24) {
        assert.ok(p.id && p.title, '记录要有 id/title');
        assert.ok(Array.isArray(p.script), 'script 必须是数组（哪怕是空数组），实际 ' + typeof p.script);
        assert.ok(Array.isArray(p.qs) && p.qs.length, p.id + ' 应带题目');
        for (const q of p.qs) {
          assert.ok(Array.isArray(q.opts) && q.opts.length >= 2, p.id + ' 的题目应有选项');
        }
        qs += p.qs.length;
      }
      assert.equal(qs, 25, '这卷共 25 题（1-25），实际 ' + qs);
    });

    await check('data/ 现状如实记录：这 6 篇的 script 都是空的（= 缺听力原文）', () => {
      const empty = dec24.filter(p => !(p.script || []).length).length;
      assert.equal(empty, dec24.length,
        '当前数据里 2024-12 这卷仍有 ' + (dec24.length - empty) + ' 篇带原文；若确实补录了原文，请同步更新本断言');
      console.log('  · 诊断：2024-12 共 ' + dec24.length + ' 篇 / 25 题，原文 0 篇（源文件无 Tapescripts）');
    });
  } else {
    console.log('  SKIP 2024-12 数据检查：开源仓库不含个人导入的该卷记录（tools/strip-personal.cjs 已清理）');
  }

  await check('题型推导：六级 Section A → 长对话；Questions 9-11 → 听力篇章；16-18 → 讲座/讲话', () => {
    const k = p => view._paperKind(p);
    assert.equal(k({ type: 'cet6', title: 'Section A Listening Comprehension' }), '长对话');
    assert.equal(k({ type: 'cet6', title: 'Questions 9 to 11' }), '听力篇章');
    assert.equal(k({ type: 'cet6', title: 'Questions 12 to 15' }), '听力篇章');
    assert.equal(k({ type: 'cet6', title: 'Questions 16 to 18' }), '讲座/讲话');
    assert.equal(k({ type: 'cet6', title: 'Questions 22 to 25' }), '讲座/讲话');
  });

  await check('题型推导：四级 Section A 是短篇新闻（与六级不同），已有字段优先', () => {
    const k = p => view._paperKind(p);
    assert.equal(k({ type: 'cet4', title: 'Section A News Report' }), '短篇新闻');
    assert.equal(k({ type: 'cet4', title: 'Questions 8 to 11' }), '长对话');
    assert.equal(k({ type: 'cet6', title: 'Whatever', genre: '城市环境' }), '城市环境', '记录里已有题型时原样使用');
    assert.equal(k({ type: 'cet6', title: '无题号的标题' }), '', '推不出来就不硬套标签');
  });

  await check('缺原文时原文区给出"为什么/怎么办"，而不是一片空白', () => {
    const card = { innerHTML: '' };
    view._script(card, [], 'Questions 9 to 11', { missing: true });
    assert.ok(/没有听力原文/.test(card.innerHTML), '必须写明缺原文，实际：' + card.innerHTML.slice(0, 120));
    assert.ok(/无法播放/.test(card.innerHTML) && /无法判分/.test(card.innerHTML), '要说明后果');
    assert.ok(/导入/.test(card.innerHTML), '要给出补救办法（重新导入含原文的文件）');
  });

  await check('有原文时正常渲染，不出现"缺原文"横幅', () => {
    const card = { innerHTML: '' };
    view._script(card, [{ en: 'Modern technology has an undeniable capacity.' }], 'The Problem with Speed', { missing: true });
    assert.ok(/原文与复现/.test(card.innerHTML));
    assert.ok(!/没有听力原文/.test(card.innerHTML));
  });

  await check('导入器：只有题干没有原文时必须当场提示（源码级）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/importer.js'), 'utf8');
    assert.ok(/let noScript = 0/.test(src), '要统计"无原文"篇数');
    assert.ok(/noScript\+\+/.test(src), '空 script 的记录要计数');
    assert.ok(/noScript && typeof App/.test(src) && /只有题干、没有原文/.test(src),
      '导入结束时要告知用户：这些篇目无法播放/判分，并说明怎么补');
  });

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项听力篇目检查通过');
})();
