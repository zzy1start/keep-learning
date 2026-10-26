/*构建最终词库 JSON
 * 数据来源:
 *   - tb_vocabulary.json / tb_voc_examples.json  (zhenghaoyang24/english-vocabulary) 音标/词频/例句
 *   - cet4_full.json / cet6_full.json / sat_full.json (zahi-ko/english-vocabulary) 词组搭配
 *   - tb_voc_book.json+tb_book.json (zhenghaoyang24) 考研/托福词书分组
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');

const vocab = JSON.parse(fs.readFileSync(path.join(D, 'tb_vocabulary.json'), 'utf8'));
const exAll = JSON.parse(fs.readFileSync(path.join(D, 'tb_voc_examples.json'), 'utf8'));
const bookMap = JSON.parse(fs.readFileSync(path.join(D, 'tb_book.json'), 'utf8'));
const vocbk = JSON.parse(fs.readFileSync(path.join(D, 'tb_voc_book.json'), 'utf8'));

// wordid -> {spelling, UK, US, paraphrase, frequency}
const byId = new Map();
for (const v of vocab) {
  byId.set(v.wordid, {
    w: v.spelling,
    uk: v.UKphonetic || '',
    us: v.USphonetic || '',
    m: v.paraphrase || '',
    f: typeof v.frequency === 'number' ? v.frequency : 0,
  });
}
// spelling -> best record（取词频最高的一条）
const best = new Map();
for (const r of byId.values()) {
  if (!r.w) continue;
  const cur = best.get(r.w);
  if (!cur || r.f > cur.f) best.set(r.w, r);
}
// wordid -> examples (最多2条, 优先 heat 高的)
const exById = new Map();
for (const e of exAll) {
  let arr = exById.get(e.wordid);
  if (!arr) { arr = []; exById.set(e.wordid, arr); }
  if (arr.length < 2) arr.push({ en: e.en, cn: e.cn, heat: e.heat || 0 });
}
for (const arr of exById.values()) arr.sort((a, b) => b.heat - a.heat);

function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function splitTrans(m) {
  // "vt.& vi. 放弃" -> [{t:'vt.& vi.', d:'放弃'}]
  if (!m) return [];
  const mm = m.match(/^([a-zA-Z.&/\s]{1,22}?)\s*(.*)$/);
  if (mm && mm[1].trim()) return [{ t: norm(mm[1]), d: norm(mm[2]) }];
  return [{ t: '', d: norm(m) }];
}

// ---- 构建指定词书的词条 ----
function buildEntry(spelling, src, exId) {
  const rec = best.get(spelling);
  let translations = [];
  let phrases = [];
  if (src) {
    translations = (src.translations || []).map(t => ({ t: norm(t.type), d: norm(t.translation) }));
    phrases = (src.phrases || []).slice(0, 6).map(p => ({ p: norm(p.phrase), d: norm(p.translation) }));
  }
  if (!translations.length && rec) translations = splitTrans(rec.m);
  const ex = [];
  if (exId && exById.has(exId)) {
    for (const e of exById.get(exId).slice(0, 2)) ex.push({ en: norm(e.en), cn: norm(e.cn) });
  } else if (rec) {
    for (const [, r] of byId) { /* noop */ break; }
  }
  const uk = rec ? rec.uk : '';
  const us = rec ? rec.us : '';
  return {
    w: spelling,
    ph: '/ ' + (uk || us) + ' /'.replace(/\s+/g, ' '),
    tr: translations.filter(t => t.d),
    phr: phrases.filter(p => p.p),
    ex,
    freq: rec ? Math.round(rec.f * 1000) / 1000 : 0,
  };
}

// =====1) CET4 / CET6 / SAT（来自 zahi-ko json，带词组）=====
function fromFullJson(file, label) {
  const arr = JSON.parse(fs.readFileSync(path.join(D, file), 'utf8'));
  const idOf = new Map();
  for (const [s, r] of best) idOf.set(s, r.w ? r : null);
  // spelling -> wordid
  const spellingToId = new Map();
  for (const [id, r] of byId) if (!spellingToId.has(r.w)) spellingToId.set(r.w, id);
  const out = [];
  for (const item of arr) {
    const w = norm(item.word);
    if (!w || !/^[a-zA-Z][a-zA-Z' -]*$/.test(w)) continue;
    const e = buildEntry(w, item, spellingToId.get(w));
    if (e.tr.length || e.phr.length) out.push(e);
  }
  return { id: label, name: file.replace(/\.json$/, ''), words: out };
}

const cet4 = fromFullJson('cet4_full.json', 'cet4');
const cet6 = fromFullJson('cet6_full.json', 'cet6');
const sat = fromFullJson('sat_full.json', 'sat');
console.log('cet4', cet4.words.length, 'cet6', cet6.words.length, 'sat', sat.words.length);

  // ===== 2) 考研 / 托福（来自 vocbk 分组，用主词库的音标释义例句）=====
const wordsById = new Map(); // wordid -> spelling
for (const [id, r] of byId) wordsById.set(id, r.w);
function fromBook(bookName, label) {
  const bk = bookMap.find(b => b.bookname === bookName);
  if (!bk) return null;
  const rows = vocbk.filter(v => v.bookid === bk.bookid);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const w = wordsById.get(row.wordid);
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const e = buildEntry(w, null, row.wordid);
    if (e.tr.length || e.phr.length) out.push(e);
  }
  return { id: label, name: bk.bookname, words: out };
}
const kaoyan = fromBook('考研词汇便携版', 'kaoyan');
const toefl = fromBook('托福高频词汇精讲', 'toefl');
  console.log('kaoyan', kaoyan && kaoyan.words.length, 'toefl', toefl && toefl.words.length);

// ===== 3) 分片写出 (便于浏览器按需加载) =====
const OUT = path.join(D, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });
const CHUNK = 1000;
function writeBook(book, idx) {
  const dir = path.join(OUT, book.id);
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.ceil(book.words.length / CHUNK);
  for (let i = 0; i < n; i++) {
    const slice = book.words.slice(i * CHUNK, (i + 1) * CHUNK);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}.json`), JSON.stringify(slice));
  }
  fs.writeFileSync(path.join(dir, 'index.json'),
    JSON.stringify({ id: book.id, name: book.name, total: book.words.length, chunks: n }));
  console.log(`  -> ${book.id}: ${book.words.length} words / ${n} chunks`);
}
for (const b of [cet4, cet6, kaoyan, toefl, sat]) if (b) writeBook(b);

// ===== 4) 全局词典（阅读划线查词用，取全部有音标的词，做成紧凑索引）=====
// 只存 word -> [uk, us, 释义]，例句在阅读场景交给 AI / 生词库时再取
const dict = {};
for (const [sp, rec] of best) {
  if (!rec.uk && !rec.us) continue;
  const key = sp.toLowerCase();
  if (dict[key]) continue;
  dict[key] = [(rec.uk || rec.us), norm(rec.m).slice(0, 90)];
}
fs.writeFileSync(path.join(OUT, 'dictionary.min.json'), JSON.stringify(dict));
console.log('dictionary entries:', Object.keys(dict).length,
  'size(MB):', (fs.statSync(path.join(OUT, 'dictionary.min.json')).size / 1048576).toFixed(1));