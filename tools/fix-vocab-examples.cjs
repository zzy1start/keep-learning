/* 词库数据清洗（2026-10-17）
 * 处理两类明确的数据问题：
 *   A. 释义生僻：词书 tr 只有一条"（…限定）"的具体/生僻义，且与内置词典首义无共同汉字、
 *      例句里也找不到该义（典型：ear → "（稻麦等的）穗"，词典首义"耳朵"）。
 *      修复：用内置词典的常见义（每个词性前 3 条）重建 tr。
 *   B. 例句顺序错位：释义与例句有"唯一、可解释"的对应关系，但 ex 顺序与 tr 顺序不一致。
 *      B1 词义匹配（每条释义唯一最佳例句、分数≥2 且严格优于原位置、整体双射）；
 *      B2 adj/n 词性匹配（仅对人工核对过的词白名单启用：grave）。
 *      修复：重排 ex（内容不变）。
 *
 * 重要：应用前先按 "词典加载去重"（wordRichness 最大者胜）找出真正会被 App 使用的那条词条，
 * 并把改动同步到同词的其他重复条目，避免"改了半天另一条重复项才是最终生效的"。
 *
 * 用法：node tools/fix-vocab-examples.cjs --dry   # 只审计，打印候选（不改文件）
 *       node tools/fix-vocab-examples.cjs         # 写回（先备份到 work/data-backup-<ts>/）
 */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');
const BOOKS = ['cet4', 'cet6', 'kaoyan', 'sat', 'toefl'];
const POS_KEYS = { n: 'n', noun: 'n', v: 'v', verb: 'v', vt: 'v', vi: 'v', aux: 'v', adj: 'adj', adjective: 'adj', a: 'adj', adv: 'adv', ad: 'adv', prep: 'prep', pron: 'pron', conj: 'conj', num: 'num', int: 'int', art: 'art', abbr: 'abbr' };
const B2_ALLOW = new Set(['grave']);

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

/* ---------- 基础工具 ---------- */
/** 切释义：只在括号外的 ；;，,、 处分隔（避免把 "（意外地；突然地）出现" 切碎） */
function splitGlosses(text) {
  const s = String(text || '');
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '（' || ch === '(' || ch === '[' || ch === '【') depth++;
    if (ch === '）' || ch === ')' || ch === ']' || ch === '】') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[；;，,、]/.test(ch)) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function normGloss(g) {
  return String(g || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\[[^\]]*\]/g, '').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '');
}
/** 把带词性标注的释义解析成 [{pos, glosses:[...]}]（保持原顺序） */
function parseTagged(text) {
  const s = String(text || '');
  const re = /(^|[\s,;，；])((?:abbr|pron|prep|conj|adj|adv|aux|art|vt|vi|v|n|a|ad|num|int)\.)/gi;
  const marks = [];
  let m;
  while ((m = re.exec(s))) marks.push({ start: m.index + m[1].length, body: re.lastIndex, pos: m[2].slice(0, -1).toLowerCase() });
  if (!marks.length) return [{ pos: 'other', glosses: splitGlosses(s) }];
  const out = [];
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : s.length;
    out.push({ pos: POS_KEYS[mark.pos] || 'other', glosses: splitGlosses(s.slice(mark.body, end)) });
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
const POS_LABEL = { n: 'n', v: 'v', adj: 'adj', adv: 'adv', prep: 'prep', pron: 'pron', conj: 'conj', num: 'num', int: 'int', art: 'art', abbr: 'abbr' };
const POSN = t => {
  const s = String(t || '').toLowerCase();
  if (/^(adj|a)\.?$/.test(s)) return 'adj';
  if (/^(n|noun)\.?$/.test(s)) return 'n';
  if (/^(v|vt|vi|verb)\.?$/.test(s)) return 'v';
  if (/^(adv|ad)\.?$/.test(s)) return 'adv';
  return s;
};
const DET = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'his', 'her', 'its', 'their', 'our', 'my', 'your', 'of', 'by', 'with', 'in', 'on', 'at', 'from', 'and', 'or', 'to', 'for']);
function examplePosClass(en, word, Dict) {
  const tokens = String(en || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  const wi = tokens.indexOf(String(word || '').toLowerCase());
  if (wi < 0) return null;
  const next = tokens[wi + 1] || '';
  const prev = tokens[wi - 1] || '';
  if (next) {
    const g = Dict.get ? Dict.get(next) : null;
    if (g && /(^|[\s,])n\./i.test(' ' + String(g[1] || ''))) return 'adj';
  }
  if (!next || DET.has(prev)) return 'noun';
  return null;
}

(async () => {
  const Dict = loadDict();
  await Dict.loadGlobal();
  try { await Dict.loadForms(); } catch (e) {}

  const REPORT = { A: {}, B: {}, samplesA: [], samplesB: [] };
  const books = [];

  /* ---------- 载入所有 chunk，并按 App 的去重规则找出生效词条 ---------- */
  for (const id of BOOKS) {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', id, 'index.json'), 'utf8'));
    const chunks = [];
    for (let i = 0; i < idx.chunks; i++) {
      const file = path.join(ROOT, 'data', id, String(i).padStart(2, '0') + '.json');
      const words = JSON.parse(fs.readFileSync(file, 'utf8'));
      chunks.push({ file, words, dirty: false });
    }
    const best = new Map();
    for (const c of chunks) for (const w of c.words) {
      const key = String((w && w.w) || '').toLowerCase();
      if (!key) continue;
      const prev = best.get(key);
      if (!prev || wordRichness(w) > wordRichness(prev)) best.set(key, w);
    }
    books.push({ id, chunks, winners: [...best.values()] });
    REPORT.A[id] = 0; REPORT.B[id] = 0;
  }

  /* ---------- A. 释义生僻 → 常见义 ---------- */
  for (const bk of books) {
    for (const raw of bk.winners) {
      const trs = (raw.tr || []).filter(t => t && t.d);
      if (trs.length !== 1) continue;
      const def = String(trs[0].d || '').trim();
      if (!/^[（(][^）)]{2,}[）)]/.test(def)) continue;
      const g = Dict.get(raw.w);
      if (!g || !g[1]) continue;
      const global = parseTagged(g[1]).filter(x => x.glosses.length);
      if (!global.length) continue;
      const defNorm = normGloss(def);
      const firstNg = normGloss(global[0].glosses[0] || '');
      if (!defNorm || !firstNg) continue;
      if ([...defNorm].some(ch => firstNg.includes(ch))) continue;   // 与词典首义有共同汉字 → 措辞差异，跳过
      const exText = (raw.ex || []).map(e => e.cn || '').join('');
      if ([...defNorm].some(ch => exText.includes(ch))) continue;    // 例句里出现该释义字符 → 可能对得上
      const FUNC_WORDS = /^(i|me|he|him|her|she|we|us|they|them|it|a|an|the|and|or|but|of|to|in|on|at|by|for|with|as|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must)$/i;
      if (FUNC_WORDS.test(String(raw.w))) continue;
      const cleanGloss = x => String(x || '').trim().replace(/[（(][^）)]*$/, '').trim();
      const byPos = new Map();
      for (const sec of global) {
        if (sec.pos === 'other') continue;
        const glosses = sec.glosses.map(cleanGloss)
          .filter(x => x && x !== '&' && !/^[a-zA-Z&.]+$/.test(x) && !/人名|地名|商标/.test(x));
        if (!glosses.length) continue;
        if (!byPos.has(sec.pos)) byPos.set(sec.pos, []);
        for (const gl of glosses) {
          if (byPos.get(sec.pos).length >= 3) break;
          if (!byPos.get(sec.pos).includes(gl)) byPos.get(sec.pos).push(gl);
        }
      }
      const newTrs = [];
      for (const [pos, glosses] of byPos) {
        if (newTrs.length >= 3) break;
        if (glosses.length) newTrs.push({ t: POS_LABEL[pos] || pos, d: glosses.join('；') });
      }
      if (!newTrs.length) continue;
      if (newTrs.some(t => /&/.test(t.d) || /[（(][^）)]*$/.test(t.d) || !t.d.trim())) continue;
      REPORT.A[bk.id]++;
      if (REPORT.samplesA.length < 20) REPORT.samplesA.push({ book: bk.id, word: raw.w, oldTr: trs.map(t => t.d), newTr: newTrs.map(t => t.d) });
      /* 同词的所有重复条目同步改，避免去重后另一条旧数据生效 */
      for (const c of bk.chunks) for (const w of c.words) {
        if (String(w && w.w).toLowerCase() !== String(raw.w).toLowerCase()) continue;
        if (!Array.isArray(w.tr) || w.tr.length !== 1) continue;
        w.tr = newTrs.map(t => ({ ...t }));
        c.dirty = true;
      }
    }
  }

  /* ---------- B. 例句顺序错位 → 重排 ---------- */
  for (const bk of books) {
    for (const raw of bk.winners) {
      const trs = (raw.tr || []).filter(t => t && t.d);
      if (trs.length < 2 || !Array.isArray(raw.ex) || raw.ex.length < 2) continue;
      const exs = raw.ex;
      let reordered = null;

      /* B1：词义匹配 */
      if (exs.length === trs.length) {
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
        if (ok && new Set(assign).size === assign.length && assign.some((j, i) => j !== i)) reordered = assign.map(j => exs[j]);
      }
      /* B2：adj/n 词性匹配（仅白名单词，需人工核对） */
      if (!reordered && B2_ALLOW.has(String(raw.w).toLowerCase()) && exs.length === 2 && trs.length === 2) {
        const classes = exs.map(e => examplePosClass(e.en, raw.w, Dict));
        const want = trs.map(t => POSN(t.t));
        if (!classes.includes(null) && want[0] !== want[1] && new Set(want).size === 2
          && want.includes('adj') && want.includes('n') && classes.includes('adj') && classes.includes('noun')) {
          const map = want.map(pos => exs.findIndex((e, idx) => classes[idx] === (pos === 'n' ? 'noun' : pos)));
          if (map.every(j => j >= 0) && new Set(map).size === 2 && map.some((j, i) => j !== i)) reordered = map.map(j => exs[j]);
        }
      }
      if (!reordered) continue;
      REPORT.B[bk.id]++;
      if (REPORT.samplesB.length < 20) REPORT.samplesB.push({ book: bk.id, word: raw.w, tr: trs.map(t => t.d), oldEx: exs.map(e => e.cn), newEx: reordered.map(e => e.cn) });
      /* 同步所有重复条目：只对"例句集合完全相同（按英文句子比较）"的重复项套同一置换 */
      const oldEn = exs.map(e => String(e.en || ''));
      for (const c of bk.chunks) for (const w of c.words) {
        if (String(w && w.w).toLowerCase() !== String(raw.w).toLowerCase()) continue;
        if (!Array.isArray(w.ex) || w.ex.length !== oldEn.length) continue;
        const curEn = w.ex.map(e => String(e.en || ''));
        if (curEn.join('\u0001') !== oldEn.join('\u0001')) continue;
        w.ex = reordered.map(e => ({ ...e }));
        c.dirty = true;
      }
    }
  }

  console.log('=== 审计结果（生效词条口径） ===');
  console.log(JSON.stringify({ A: REPORT.A, B: REPORT.B }, null, 2));
  console.log('--- A 样例 ---');
  REPORT.samplesA.slice(0, 10).forEach(x => console.log(JSON.stringify(x)));
  console.log('--- B 样例 ---');
  REPORT.samplesB.slice(0, 10).forEach(x => console.log(JSON.stringify(x)));

  if (DRY) { console.log('\n[dry-run] 未写入任何文件'); return; }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(ROOT, 'work', 'data-backup-' + ts);
  let changed = 0;
  for (const bk of books) for (const c of bk.chunks) {
    if (!c.dirty) continue;
    const rel = path.relative(ROOT, c.file);
    const target = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(c.file, target);
    fs.writeFileSync(c.file, JSON.stringify(c.words), 'utf8');
    changed++;
  }
  console.log('\n备份目录：' + backupDir);
  console.log('写回文件数：' + changed);
})().catch(e => { console.error(e); process.exitCode = 1; });
