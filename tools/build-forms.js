/* 补丁4：词典形态还原
 * dictionary.min.json 只有原形，导致 challenges / emphasized / perspectives
 * 这类屈折变化词查不到。构建时为每条记录补一个「变形索引」：
 *   dictionary.min.json  —— word -> [phonetic, cn]（不变，供精确查）
 *   dictionary.forms.json —— 每条记录一行 "形变|原形"，运行时反查
 * 体积换查得准，这是阅读划词场景的硬需求。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'data');

console.log('读取源词库...');
const vocab = JSON.parse(fs.readFileSync(path.join(D, 'tb_vocabulary.json'), 'utf8'));

// wordid -> 最优记录（词频最高）
const byId = new Map();
for (const v of vocab) {
  const prev = byId.get(v.wordid);
  const f = typeof v.frequency === 'number' ? v.frequency : 0;
  if (!prev || f > prev.frequency) {
    byId.set(v.wordid, { w: v.spelling, uk: v.UKphonetic || '', us: v.USphonetic || '', m: v.paraphrase || '', frequency: f });
  }
}

// 变形规则
const VOWELS = 'aeiou';
function plural(w) {
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (/(f|fe)$/.test(w)) return w.replace(/fe?$/, 'ves');
  if (/[^f]fe$/.test(w)) return w.slice(0, -2) + 'ves';
  return w + 's';
}
function third(w) { // 第三人称单数
  if (/(s|x|z|ch|sh|o)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}
function past(w) {
  if (/e$/.test(w)) return w + 'd';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
  if (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(w)) return w + w[w.length - 1] + 'ed'; // stop->stopped
  return w + 'ed';
}
function pp(w) {
  if (/e$/.test(w)) return w + 'd';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
  return w + 'ed';
}
function ing(w) {
  if (/ie$/.test(w)) return w.slice(0, -2) + 'ying';
  if (/[^aeiou]e$/.test(w)) return w.slice(0, -1) + 'ing';
  if (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(w)) return w + w[w.length - 1] + 'ing';
  return w + 'ing';
}
function compar(w) { // 比较级
  if (w.length <= 3) return null;
  if (/e$/.test(w)) return [w + 'r', w + 'st'];
  if (/[^aeiou]y$/.test(w)) return [w.slice(0, -1) + 'ier', w.slice(0, -1) + 'iest'];
  if (/^[^aeiou]*[aeiou][aeiou][^wxy]$/.test(w)) return [w + w[w.length - 1] + 'er', w + w[w.length - 1] + 'est'];
  if (/[^aeiou][aeiou][^aeiouwy]$/.test(w)) return [w + 'er', w + 'est'];
  return null;
}
function adverb(w) {
  if (/ic$/.test(w)) return w.slice(0, -2) + 'ically';
  if (/le$/.test(w) && !/[aeiou]le$/.test(w)) return w.slice(0, -1) + 'y';
  if (/ll$/.test(w)) return w + 'y';
  if (/y$/.test(w)) return w.slice(0, -1) + 'ily';
  return w + 'ly';
}
function agentNoun(w) {
  if (/e$/.test(w)) return w.slice(0, -1) + 'er';   // teach->teacher
  if (/y$/.test(w)) return w.slice(0, -1) + 'ier';
  return w + 'er';
}
const uncomp = ['un', 'in', 'im', 'dis', 'non'];

const dict = {};   // 原形索引（保持原样）
const forms = {};  // 变形 -> 原形
const formFreq = {}; // 变形 -> 基准词频，用于碰撞时择优
const baseFreq = {};  // 原形 -> 词频

function addForm(f, base) {
  if (!f || f === base || f.length < 2) return;
  if (!/^[a-zA-Z-]+$/.test(f)) return;
  const bf = baseFreq[base] || 0;
  // 碰撞处理：同一变形对应多个原形时（如 solutions -> solution / dissolution），
  // 取词频更高者；词频相同取更短原形，避免派生出错误搭配。
  const cur = forms[f];
  if (!cur) { forms[f] = base; formFreq[f] = bf; return; }
  if (bf > formFreq[f] || (bf === formFreq[f] && base.length < cur.length)) {
    forms[f] = base; formFreq[f] = bf;
  }
}

let n = 0;
for (const r of byId.values()) {
  const w = r.w;
  if (!w || !/^[a-zA-Z][a-zA-Z'-]*$/.test(w)) continue;
  const key = w.toLowerCase();
  const rec = [r.uk || r.us, String(r.m || '').replace(/\s+/g, ' ').trim().slice(0, 90)];
  if (!dict[key]) { dict[key] = rec; n++; }
  if ((baseFreq[key] || -1) < r.frequency) baseFreq[key] = r.frequency;

  const lower = w.toLowerCase();
  addForm(plural(lower), key);
  addForm(third(lower), key);
  addForm(past(lower), key);
  addForm(pp(lower), key);
  addForm(ing(lower), key);
  const cmp = compar(lower);
  if (cmp) { addForm(cmp[0], key); addForm(cmp[1], key); }
  addForm(adverb(lower), key);
  addForm(agentNoun(lower), key);
  // 去前缀派生（un-/in-/dis-）
  for (const pfx of uncomp) {
    if (lower.startsWith(pfx) && lower.length > pfx.length + 3) {
      const root = lower.slice(pfx.length);
      addForm(plural(root), key); addForm(past(root), key); addForm(ing(root), key); addForm(third(root), key);
    }
  }
  // 双写末尾辅音还原（stop -> stopped/ing）
  if (lower.length > 2 && !VOWELS.includes(lower[lower.length - 1]) &&
      !'wxy'.includes(lower[lower.length - 1]) && VOWELS.includes(lower[lower.length - 2])) {
    const r2 = lower.slice(0, -1);
    addForm(past(r2), key); addForm(ing(r2), key);
  }
}

// 只保留「形态上像英文词」且长度合理的变形
const lines = [];
for (const f in forms) {
  if (f.length >= 3 && f.length <= 22) lines.push(f + ' ' + forms[f]);
}
lines.sort();// 便于二分查找
const formsTxt = lines.join('\n');

fs.writeFileSync(path.join(OUT, 'dictionary.min.json'), JSON.stringify(dict));
fs.writeFileSync(path.join(OUT, 'dictionary.forms.txt'), formsTxt);
const s1 = fs.statSync(path.join(OUT, 'dictionary.min.json')).size;
const s2 = fs.statSync(path.join(OUT, 'dictionary.forms.txt')).size;
console.log(`原形词条: ${n}  (${(s1 / 1048576).toFixed(1)} MB)`);
console.log(`变形索引: ${lines.length}  (${(s2 / 1048576).toFixed(1)} MB)`);
['challenges', 'emphasized', 'perspectives', 'developed', 'difficulties', 'solutions', 'studies', 'better'].forEach(t => {
  const i = lines.findIndex(l => l.startsWith(t + ' '));
  const b = i >= 0 ? lines[i].split(' ')[1] : '';
  console.log(`  ${t} -> ${b || '(无)'} ${b && dict[b] ? '✓' : ''}`);
});