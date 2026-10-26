/* 计算 Tatoeba 英文句子对各词书的覆盖率上限
 * 用法: node tools/coverage-tatoeba.cjs <eng_sentences.tsv>
 * 说明: 只看"英文句子是否包含该词（含常见词形变化）"，
 *       这是覆盖率的上限；实际可用的中英对照还会更低。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');

// 1) 收集本项目全部唯一词条
const seen = new Map();
for (const b of ['cet4', 'cet6', 'kaoyan', 'toefl', 'sat']) {
  const dir = path.join(ROOT, 'data', b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'index.json')) {
    for (const w of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (w.w) seen.set(w.w.toLowerCase(), w);
    }
  }
}
const words = [...seen.keys()];
console.error('唯一词条: ' + words.length);

// 2) 建立词的匹配形态（原形 + 常见屈折）
function formsOf(w) {
  const f = new Set([w]);
  const last = w.slice(-1), stem = w.slice(0, -1);
  if (last === 'e') { f.add(w + 'd'); f.add(stem + 'ing'); f.add(stem + 'ed'); }
  if (last === 'y') { f.add(stem + 'ies'); f.add(stem + 'ied'); }
  if (/[^aeiou]$/.test(w)) { f.add(w + w.slice(-1) + 'ing'); f.add(w + w.slice(-1) + 'ed'); }
  f.add(w + 's'); f.add(w + 'es'); f.add(w + 'ed'); f.add(w + 'ing');
  return [...f];
}
const formMap = new Map();  // form -> Set(words)
for (const w of words) {
  for (const f of formsOf(w)) {
    if (!formMap.has(f)) formMap.set(f, new Set());
    formMap.get(f).add(w);
  }
}
console.error('匹配形态数: ' + formMap.size);

// 3) 边读边匹配（不整文件载入内存）
const hit = new Set();        // 命中的词
const hitSent = new Map();    // word -> 命中句子数
const rl = readline.createInterface({
  input: fs.createReadStream(process.argv[2], { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
let total = 0;
rl.on('line', line => {
  const tab = line.indexOf('\t');
  if (tab < 0) return;
  const text = line.slice(tab + 1).trim();
  if (!text) return;
  total++;
  const tokens = text.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const local = new Set();
  for (const t of tokens) {
    const ws = formMap.get(t);
    if (!ws) continue;
    for (const w of ws) if (!local.has(w)) local.add(w);
  }
  for (const w of local) {
    hitSent.set(w, (hitSent.get(w) || 0) + 1);
    hit.add(w);
  }
});
rl.on('close', () => {
  const withExNow = [...seen.values()].filter(w => (w.ex || []).length).length;
  const hit2 = [...hitSent.values()].filter(v => v >= 2).length;
  console.log('');
  console.log('=== Tatoeba 英文覆盖上限 ===');
  console.log('扫描英文句子总数: ' + total);
  console.log('项目唯一词条: ' + words.length);
  console.log('至少 1 句命中: ' + hit.size + ' (' + (hit.size / words.length * 100).toFixed(1) + '%)');
  console.log('至少 2 句命中: ' + hit2 + ' (' + (hit2 / words.length * 100).toFixed(1) + '%)');
  console.log('');
  console.log('对照 —— 现有内置例句:');
  console.log('  有例句词条: ' + withExNow + ' (' + (withExNow / words.length * 100).toFixed(1) + '%)');
  console.log('');
  const gap = withExNow - hit2;
  console.log('若换用 Tatoeba 且要求每词 2 句，净减少: ' + gap + ' 词 (' + (gap / withExNow * 100).toFixed(1) + '% 的现有覆盖)');
});
