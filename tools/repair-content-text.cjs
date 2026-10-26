/* ============ repair-content-text.cjs : 修复已入库内容里的提取损坏 ============
 * 用途：把 PDF 导入时产生的「空格损坏」（e tiq u e tte / 真 题 / ( 烦 躁 )）
 * 在 data/content/*.json 里就地修掉——新导入的数据由 importer 在导入时修复，
 * 这个脚本针对的是**修复上线之前**已经写进内容文件的条目。
 *
 * 安全保证：
 *   1. 只调用 js/text-repair.js（只动空白，不替换字符）
 *   2. 每条改动都做「去掉全部空白后必须完全一致」的断言，不一致就跳过并报错
 *   3. 默认 dry-run，只有显式 --write 才写回；写回时保持每个文件原有的缩进风格
 *
 * 用法：
 *   node tools/repair-content-text.cjs              # 预览（不写盘）
 *   node tools/repair-content-text.cjs --write      # 实际写入
 *   node tools/repair-content-text.cjs --only=writing.json
 */
const fs = require('node:fs');
const path = require('node:path');
const T = require(path.join(__dirname, '../js/text-repair.js'));

const DIR = path.join(__dirname, '..', 'data', 'content');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const onlyArg = argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
const strip = s => String(s).replace(/\s+/g, '');

/* 可选词表校验：没有孤立单字母的损坏（an sw ers → answers）只能靠"拼出来是不是真的词"判断。
 * 词表就用应用自己的词典，避免引入第二个数据源。 */
if (!argv.includes('--no-dict')) {
  const dictFile = path.join(__dirname, '..', 'data', 'dictionary.min.json');
  const formsFile = path.join(__dirname, '..', 'data', 'dictionary.forms.txt');
  try {
    const words = new Set(Object.keys(JSON.parse(fs.readFileSync(dictFile, 'utf8'))));
    /* 词形表（form base）也要收进来：answers / worked 这类变形不在词典键里，
     * 只查词典会漏掉 an sw ers → answers 这种损坏。 */
    let formCount = 0;
    try {
      for (const line of fs.readFileSync(formsFile, 'utf8').split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 2) { words.add(parts[0]); formCount++; }
      }
    } catch (e) { console.warn('词形表不可用：' + e.message); }
    T.setWordChecker(w => words.has(w) || words.has(String(w).toLowerCase()));
    console.log('词表校验已启用：' + words.size + ' 个词条（词典 + ' + formCount + ' 条词形）');
  } catch (e) {
    console.warn('词表不可用，跳过词表校验：' + e.message);
  }
}

const changes = [];
const skipped = [];

function walk(node, pathParts, file) {
  if (typeof node === 'string') {
    const fixed = T.fix(node);
    if (fixed !== node) {
      if (strip(fixed) !== strip(node)) {
        skipped.push({ file, path: pathParts.join('.'), reason: '非空白字符发生变化，已跳过' });
        return node;
      }
      changes.push({ file, path: pathParts.join('.'), before: node, after: fixed });
      return fixed;
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((item, i) => walk(item, pathParts.concat('[' + i + ']'), file));
  if (node && typeof node === 'object') {
    const out = {};
    for (const key of Object.keys(node)) out[key] = walk(node[key], pathParts.concat(key), file);
    return out;
  }
  return node;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .filter(f => !ONLY || ONLY.includes(f));

for (const file of files) {
  const full = path.join(DIR, file);
  const raw = fs.readFileSync(full, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { console.error('SKIP ' + file + '：JSON 解析失败 ' + e.message); continue; }
  const pretty = raw.includes('\n');
  const repaired = walk(parsed, [], file);
  const count = changes.filter(c => c.file === file).length;
  if (!count) { console.log('OK   ' + file + '：无需修复'); continue; }
  const out = pretty ? JSON.stringify(repaired, null, 2) + (raw.endsWith('\n') ? '\n' : '') : JSON.stringify(repaired);
  /* 写回前验一次：把输出重新解析，必须与修复后的对象完全一致
   *（注意：不能拿"原始文件文本"和"输出文本"比非空白字符——文件里的 \n 是转义字符，
   * 而修复正是把换行拼掉，两者的"非空白"字节天然不同）。 */
  let back = null;
  try { back = JSON.parse(out); } catch (e) { console.error('FAIL ' + file + '：写回结果无法解析 ' + e.message); process.exitCode = 1; continue; }
  if (JSON.stringify(back) !== JSON.stringify(repaired)) { console.error('FAIL ' + file + '：写回内容与修复结果不一致，拒绝写入'); process.exitCode = 1; continue; }
  console.log((WRITE ? 'FIX  ' : 'DRY  ') + file + '：修复 ' + count + ' 处字符串' + (pretty ? '（保留缩进）' : '（保持单行）'));
  if (WRITE) fs.writeFileSync(full, out);
}

/* 只打印"首个差异点"附近的内容：整段打印又长又难核对 */
function firstDiff(before, after) {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  let j = 0;
  while (j < before.length - i && j < after.length - i
    && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  const from = Math.max(0, i - 30);
  const b = before.slice(from, before.length - j + 30);
  const a = after.slice(from, after.length - j + 30);
  return { at: i, before: b, after: a };
}
console.log('\n--- 修复明细（最多 14 条，只显示首个差异点）---');
changes.slice(0, 14).forEach((c, i) => {
  const d = firstDiff(c.before, c.after);
  console.log((i + 1) + ') ' + c.file + ' :: ' + c.path + '  @' + d.at);
  console.log('   before: ' + JSON.stringify(d.before));
  console.log('   after : ' + JSON.stringify(d.after));
});
if (skipped.length) {
  console.log('\n--- 被跳过的改动（会改到非空白字符，需人工确认）---');
  skipped.forEach(s => console.log('  ' + s.file + ' :: ' + s.path + ' — ' + s.reason));
}
console.log('\n合计：' + changes.length + ' 处字符串' + (WRITE ? '（已写入）' : '（dry-run，未写入，加 --write 生效）'));