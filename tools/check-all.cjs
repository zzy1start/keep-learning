/* ============ check-all.cjs : 全系统自检调度器 ============
 * 依次运行 tools/ 下所有 check-*.cjs，汇总通过/失败与耗时。
 * 用途：每次改动后的一键回归，以及生成检验报告时的证据来源。
 * 用法：node tools/check-all.cjs            # 只跑 JS 自检
 *       node tools/check-all.cjs --with-python   # 附带 sacrebleu 上游交叉校验
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const suites = fs.readdirSync(HERE)
  .filter(f => /^check-.*\.cjs$/.test(f) && f !== 'check-all.cjs')
  .sort();

const results = [];
const t0 = Date.now();
/* 受限环境（例如 DSH 沙箱）禁止用管道捕获子进程输出（EPERM），
 * 也可能出现 spawn 本身失败（EBUSY：cmd.exe 被占用；EACCES/ENOTSUP 同理）。
 * 这时退回 stdio:inherit：仍然完整跑完每个自检，只是无法逐套统计 PASS 行。
 * 注意 r.status 为 null + 有 error 就是 spawn 失败，不能当成"子进程退出码 0"判通过。 */
let inheritMode = false;
for (const f of suites) {
  const start = Date.now();
  let r = spawnSync(process.execPath, [path.join(HERE, f)], { encoding: 'utf8', cwd: ROOT });
  let captured = true;
  if (r.error && /EPERM|EACCES|ENOTSUP|EBUSY/i.test(String(r.error.code || r.error.message || ''))) {
    captured = false;
    inheritMode = true;
    console.log('\n--- ' + f + ' ---');
    r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit', cwd: ROOT });
  }
  const out = captured ? ((r.stdout || '') + (r.stderr || '')) : '';
  const pass = captured ? (out.match(/^PASS /gm) || []).length : 0;
  const fail = captured ? (out.match(/^FAIL /gm) || []).length : 0;
  const summary = captured
    ? (out.trim().split('\n').filter(l => /通过|passed|MATCH|一致/.test(l)).pop() || '').trim()
    : '（受限环境：输出已直接打印）';
  results.push({ file: f, code: r.status, pass, fail, ms: Date.now() - start, summary, captured });
}
if (inheritMode) console.log('\n（本环境禁止管道捕获，已改用直接输出模式：逐套耗时与数量不可用，退出码仍然有效）\n');

if (process.argv.includes('--with-python')) {
  /* python 可能在 PATH 里找不到（本机就是这种情况），依次尝试：
   * DSH_PYTHON 环境变量 → python → py。都不可用时跳过而不是判失败。 */
  const candidates = [process.env.DSH_PYTHON, 'python', 'py'].filter(Boolean);
  let py = null, used = '';
  for (const candidate of candidates) {
    const attempt = spawnSync(candidate, [path.join(HERE, 'sacrebleu-crosscheck', 'run-upstream.py')], { encoding: 'utf8', cwd: ROOT });
    if (!attempt.error) { py = attempt; used = candidate; break; }
  }
  if (!py) {
    console.log('  - sacrebleu-crosscheck 已跳过（未找到 python，可设 DSH_PYTHON 指定路径）');
  } else {
    const cmp = spawnSync(process.execPath, [path.join(HERE, 'sacrebleu-crosscheck', 'compare.cjs')], { encoding: 'utf8', cwd: ROOT });
    const out = (py.stdout || '') + (cmp.stdout || '') + (cmp.stderr || '');
    results.push({
      file: 'sacrebleu-crosscheck (' + used + ')', code: (py.status || cmp.status),
      pass: (out.match(/^MATCH /gm) || []).length, fail: (out.match(/^DIFF /gm) || []).length,
      ms: 0, summary: out.trim().split('\n').pop().trim(),
    });
  }
}

console.log('全系统自检（' + suites.length + ' 套 JS 自检' + (process.argv.includes('--with-python') ? ' + 上游交叉校验' : '') + '）');
console.log('');
let bad = 0;
for (const r of results) {
  const ok = r.code === 0 && r.fail === 0;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + r.file.padEnd(34)
    + ' 通过 ' + String(r.pass).padStart(3) + (r.fail ? ' / 失败 ' + r.fail : '')
    + '  ' + String(r.ms).padStart(5) + 'ms   ' + r.summary.slice(0, 46));
}
const totalPass = results.reduce((s, r) => s + r.pass, 0);
const totalFail = results.reduce((s, r) => s + r.fail, 0);
console.log('');
console.log('合计：' + results.length + ' 套 / 通过 ' + totalPass + ' 项' + (totalFail ? ' / 失败 ' + totalFail + ' 项' : '')
  + '，总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
console.log(bad ? '有 ' + bad + ' 套未通过' : '全部通过');
process.exitCode = bad ? 1 : 0;