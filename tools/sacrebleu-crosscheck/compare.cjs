/* 把 JS 移植（js/translate-metric.js）与上游 sacrebleu 的 chrF 逐用例比对。
 * 先跑： python tools/sacrebleu-crosscheck/run-upstream.py
 * 再跑： node   tools/sacrebleu-crosscheck/compare.cjs
 * 该脚本不参与应用运行，仅用于验证移植是否与上游一致。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require(path.join(__dirname, '../../js/translate-metric.js'));

const HERE = __dirname;
const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
const upstreamPath = path.join(HERE, 'upstream.json');
if (!fs.existsSync(upstreamPath)) {
  console.error('缺少 ' + upstreamPath + '：请先运行 python tools/sacrebleu-crosscheck/run-upstream.py');
  process.exit(2);
}
const upstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));

let mismatch = 0;
for (const [name, hyp, ref, opts] of cases) {
  if (!(name in upstream)) { console.error('DIFF  ' + name + '：上游结果缺失'); mismatch++; continue; }
  const js = M.chrf(hyp, ref, opts);
  const up = upstream[name];
  const delta = Math.abs(js - up);
  if (delta < 1e-9) console.log('MATCH ' + name.padEnd(22) + js);
  else { mismatch++; console.error('DIFF  ' + name.padEnd(22) + 'js=' + js + ' upstream=' + up + ' delta=' + delta); }
}
assert.equal(mismatch, 0, mismatch + ' 个用例与上游不一致');
console.log('与上游 sacrebleu 一致：' + cases.length + '/' + cases.length + '（误差 < 1e-9）');