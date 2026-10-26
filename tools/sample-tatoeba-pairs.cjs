/* Tatoeba 中英对照可用率抽样实测
 * 从本项目有例句的词中随机抽 N 个，逐个查 Tatoeba API，
 * 统计：有中英对照的比例、例句长度、众包特征（含人名/极短句）。
 * 用法: node tools/sample-tatoeba-pairs.cjs [N]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const N = parseInt(process.argv[2] || '30', 10);

// 收集有例句的词
const words = [];
for (const b of ['cet4', 'cet6', 'kaoyan', 'toefl', 'sat']) {
  const dir = path.join(ROOT, 'data', b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'index.json')) {
    for (const w of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      if (w.w && (w.ex || []).length) words.push(w.w);
    }
  }
}
const uniq = [...new Set(words.map(w => w.toLowerCase()))];

// 固定随机种子，保证可复现
let seed = 20261022;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const picked = [];
const pool = [...uniq];
for (let i = 0; i < N && pool.length; i++) {
  picked.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; keeplearning-research/1.0)' },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let hasPair = 0, noPair = 0, failed = 0;
  const lens = [];
  let nameHits = 0, shortHits = 0, totalSent = 0;
  const rows = [];

  for (const w of picked) {
    const url = 'https://tatoeba.org/en/api_v0/search?from=eng&to=cmn&query='
      + encodeURIComponent(w);
    let json;
    try {
      json = JSON.parse(await get(url));
    } catch (e) {
      failed++;
      rows.push({ w, status: 'ERR ' + e.message });
      await sleep(700);
      continue;
    }
    const results = (json.results || []);
    // 找第一条真正带中文译文的
    let picked2 = null;
    for (const r of results) {
      const groups = r.translations || [];
      for (const g of groups) {
        for (const t of (Array.isArray(g) ? g : [])) {
          const txt = String((t && t.text) || '').trim();
          if (txt && /[\u4e00-\u9fff]/.test(txt)) { picked2 = { en: String(r.text || '').trim(), cn: txt, user: t.user || '' }; break; }
        }
        if (picked2) break;
      }
      if (picked2) break;
    }
    if (picked2) {
      hasPair++;
      const enWords = picked2.en.split(/\s+/).filter(Boolean).length;
      lens.push(enWords);
      totalSent++;
      if (/\b(Tom|Mary|John|Bob|Boston|Japan)\b/.test(picked2.en)) nameHits++;
      if (enWords < 8) shortHits++;
      rows.push({ w, status: 'PAIR', enWords, en: picked2.en, cn: picked2.cn });
    } else {
      noPair++;
      rows.push({ w, status: 'no-pair', n: results.length });
    }
    await sleep(700);
  }

  console.log('');
  console.log('=== Tatoeba 中英对照抽样实测（N=' + picked.length + '）===');
  console.log('有中英对照: ' + hasPair + ' (' + (hasPair / picked.length * 100).toFixed(1) + '%)');
  console.log('无中英对照: ' + noPair);
  console.log('请求失败:   ' + failed);
  if (lens.length) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sorted = [...lens].sort((a, b) => a - b);
    console.log('');
    console.log('--- 例句特征（仅统计有对照的）---');
    console.log('平均词数: ' + avg.toFixed(1));
    console.log('中位词数: ' + sorted[Math.floor(sorted.length / 2)]);
    console.log('少于 8 词: ' + shortHits + '/' + totalSent + ' (' + (shortHits / totalSent * 100).toFixed(1) + '%)');
    console.log('含常见人名(Tom/Mary等): ' + nameHits + '/' + totalSent + ' (' + (nameHits / totalSent * 100).toFixed(1) + '%)');
  }
  console.log('');
  console.log('--- 明细 ---');
  for (const r of rows) {
    if (r.status === 'PAIR') {
      console.log('[' + r.w + '] ' + r.enWords + '词');
      console.log('   EN: ' + r.en);
      console.log('   CN: ' + r.cn);
    } else {
      console.log('[' + r.w + '] ' + r.status);
    }
  }
})();
