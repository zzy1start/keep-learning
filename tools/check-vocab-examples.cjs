/* ============ check-vocab-examples.cjs : 词库数据一致性（2026-10-17 数据清洗回归）============
 * 背景：词书数据曾有两类明确问题——
 *   A. 释义生僻：ear 只有"（稻麦等的）穗"，词典首义是"耳朵"，例句也全是"耳朵"；
 *   B. 例句顺序错位：grave 的 ex[0] 讲坟墓、tr[0] 却是"严重的"。
 * 修复见 tools/fix-vocab-examples.cjs（A 用词典常见义重建 tr；B 按唯一映射重排 ex）。
 * 本套用 **App 的去重口径（wordRichness 最大者生效）** 复查数据，防回退。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BOOKS = ['cet4', 'cet6', 'kaoyan', 'sat', 'toefl'];
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message)); }
}

function loadDict() {
  const src = fs.readFileSync(path.join(ROOT, 'js/dict.js'), 'utf8');
  const fetchStub = async url => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')),
    text: async () => fs.readFileSync(path.join(ROOT, url), 'utf8'),
  });
  const ctx = vm.createContext({ fetch: fetchStub, console, Store: { d: {} } });
  vm.runInContext(src, ctx);
  return vm.runInContext('Dict', ctx);
}

/* ---------- 与 fix-vocab-examples.cjs 相同的工具（保持判据一致） ---------- */
function splitGlosses(text) {
  const s = String(text || '');
  const out = []; let buf = ''; let depth = 0;
  for (const ch of s) {
    if ('（(['.includes(ch)) depth++;
    if ('）)]'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[；;，,、]/.test(ch)) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function normGloss(g) {
  return String(g || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\[[^\]]*\]/g, '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
}
function parseTagged(text) {
  const s = String(text || '');
  const re = /(^|[\s,;，；])((?:abbr|pron|prep|conj|adj|adv|aux|art|vt|vi|v|n|a|ad|num|int)\.)/gi;
  const marks = []; let m;
  while ((m = re.exec(s))) marks.push({ start: m.index + m[1].length, body: re.lastIndex, pos: m[2].slice(0, -1).toLowerCase() });
  if (!marks.length) return [{ pos: 'other', glosses: splitGlosses(s) }];
  const out = [];
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : s.length;
    out.push({ pos: mark.pos, glosses: splitGlosses(s.slice(mark.body, end)) });
  });
  return out;
}
function lcsLen(a, b) {
  const A = Array.from(a || ''); const B = Array.from(b || '');
  let best = 0; let prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    }
    prev = cur;
  }
  return best;
}
function matchScore(gloss, cn) {
  let best = 0;
  for (const g of splitGlosses(gloss)) {
    const ng = normGloss(g);
    if (!ng) continue;
    for (const c of String(cn || '').split(/[，。！？；、：,.\s]+/).filter(Boolean)) best = Math.max(best, Math.min(4, lcsLen(ng, c)));
  }
  return best;
}
function wordRichness(w) {
  if (!w) return -1;
  const n = a => (Array.isArray(a) ? a.length : 0);
  const chars = (a, f) => (Array.isArray(a) ? a.reduce((s, x) => s + String((x && x[f]) || '').length, 0) : 0);
  const counts = n(w.tr) * 3 + n(w.phr) * 2 + n(w.ex);
  return counts * 100000 + Math.min(99999, chars(w.tr, 'd') + chars(w.phr, 'd') + chars(w.ex, 'en'));
}
/** 按 App 的去重规则（Dict.load）取生效词条 */
function winnersOf(bookId) {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', bookId, 'index.json'), 'utf8'));
  const best = new Map();
  for (let i = 0; i < idx.chunks; i++) {
    const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', bookId, String(i).padStart(2, '0') + '.json'), 'utf8'));
    for (const w of words) {
      const key = String((w && w.w) || '').toLowerCase();
      if (!key) continue;
      const prev = best.get(key);
      if (!prev || wordRichness(w) > wordRichness(prev)) best.set(key, w);
    }
  }
  return { words: [...best.values()], total: idx.total };
}

(async () => {
  const Dict = loadDict();
  await Dict.loadGlobal();
  try { await Dict.loadForms(); } catch (e) {}

  const data = {};
  for (const id of BOOKS) data[id] = winnersOf(id);

  /* A 残留：单条"（…限定）"释义 + 词典首义无共同汉字 + 例句也不含释义字符 */
  for (const id of BOOKS) {
    let residual = 0;
    const bad = [];
    for (const raw of data[id].words) {
      const trs = (raw.tr || []).filter(t => t && t.d);
      if (trs.length !== 1) continue;
      const def = String(trs[0].d || '').trim();
      if (!/^[（(][^）)]{2,}[）)]/.test(def)) continue;
      const g = Dict.get(raw.w);
      if (!g || !g[1]) continue;
      const global = parseTagged(g[1]).filter(x => x.glosses.length);
      const defNorm = normGloss(def);
      const firstNg = normGloss(global[0] && global[0].glosses[0] || '');
      if (!defNorm || !firstNg) continue;
      if ([...defNorm].some(ch => firstNg.includes(ch))) continue;
      const exText = (raw.ex || []).map(e => e.cn || '').join('');
      if ([...defNorm].some(ch => exText.includes(ch))) continue;
      residual++;
      if (bad.length < 5) bad.push(raw.w);
    }
    check('词书 ' + id + '：无"释义生僻而对不上例句"的残留（' + residual + '）', () => {
      assert.equal(residual, 0, '仍有：' + bad.join(', '));
    });
  }

  /* B 残留：B1 判据下仍存在"唯一映射但与顺序不一致"的例句 */
  for (const id of BOOKS) {
    let residual = 0;
    const bad = [];
    for (const raw of data[id].words) {
      const trs = (raw.tr || []).filter(t => t && t.d);
      const exs = raw.ex || [];
      if (trs.length < 2 || exs.length !== trs.length) continue;
      const score = trs.map(t => exs.map(e => matchScore(t.d, e.cn)));
      const assign = []; let ok = true;
      for (let i = 0; i < trs.length; i++) {
        const row = score[i];
        const maxS = Math.max(...row);
        const best = row.map((s, j) => ({ s, j })).filter(x => x.s === maxS);
        if (maxS < 2 || best.length !== 1) { ok = false; break; }
        const j = best[0].j;
        if (j !== i && !(score[i][j] > score[i][i])) { ok = false; break; }
        assign.push(j);
      }
      if (!ok || new Set(assign).size !== assign.length) continue;
      if (assign.some((j, i) => j !== i)) { residual++; if (bad.length < 5) bad.push(raw.w); }
    }
    check('词书 ' + id + '：无"例句顺序与释义顺序错位"的残留（' + residual + '）', () => {
      assert.equal(residual, 0, '仍有：' + bad.join(', '));
    });
  }

  /* 用户反馈词的专项回归 */
  const cet6 = data.cet6.words;
  check('ear（六级）出题释义已改为常见义"耳朵"，不再是"（稻麦等的）穗"', () => {
    const ear = cet6.find(w => w.w === 'ear');
    assert.ok(ear, '数据里找不到 ear');
    const defs = (ear.tr || []).map(t => t.d).join('；');
    assert.ok(defs.includes('耳朵'), '释义应含"耳朵"：' + defs);
    assert.ok(!/^[（(]/.test(String((ear.tr || [])[0] && ear.tr[0].d || '')), '不应以（…限定）生僻义开头：' + defs);
  });

  for (const id of ['cet4', 'cet6']) {
    check('grave（' + id + '）例句顺序与释义顺序一致：ex[0] 是形容词例句（grave problems）', () => {
      const grave = data[id].words.find(w => w.w === 'grave');
      assert.ok(grave, '数据里找不到 grave');
      assert.ok(grave.ex && grave.ex[0] && /problems/.test(String(grave.ex[0].en || '')),
        'ex[0] 应为形容词例句，实际：' + JSON.stringify(grave.ex && grave.ex[0] && grave.ex[0].en));
    });
  }

  /* 数据规模未变（防止清洗误删词条） */
  const EXPECT = { cet4: 4544, cet6: 3991, kaoyan: 6357, sat: 4462, toefl: 2760 };
  for (const id of BOOKS) {
    check('词书 ' + id + '：去重后词数未变（' + data[id].words.length + '）', () => {
      assert.equal(data[id].words.length, EXPECT[id], '词数应从 ' + EXPECT[id] + ' 变为 ' + data[id].words.length);
    });
  }

  if (failed) process.exitCode = 1;
  else console.log('全部 ' + passed + ' 项词库例句/释义一致性检查通过');
})().catch(e => { console.error(e); process.exitCode = 1; });
