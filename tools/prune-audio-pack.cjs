/* ============ prune-audio-pack.cjs : 缩小离线音频包 ============
 * 背景（2026-10-22 用户要求）：单词语音要能离线和在线听；导入听力走在线 TTS。
 * 现有 assets/audio 里 11,187 词 × 男女声 = 22,374 个单词 mp3（女 44.2MB / 男 57.6MB），
 * 但正常背单词链路只用**女声**（audio-pack.js 默认 female；男声只有听力页
 * _forceGender 泄漏或诊断按钮才会触发）。内置听力 62 句的男女声要保留（对话需要）。
 *
 * 本脚本：删掉「单词」的男声文件与索引字段，保留女声单词 + 全部句子音频。
 * 索引降为 version 3；单词条目只留 female（audio-pack.js 已做缺字段回退）。
 *
 * 用法：
 *   node tools/prune-audio-pack.cjs --dry     # 只统计，不动文件
 *   node tools/prune-audio-pack.cjs --apply   # 真正删除并重写 index.json
 *
 * 可逆性：完整源文件在 audio-raw/words/male/<hash>.mp3（11,187 个），需要时可按索引复原。
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const AUDIO = path.join(ROOT, 'assets', 'audio');
const INDEX = path.join(AUDIO, 'index.json');
const APPLY = process.argv.includes('--apply');

const MB = n => (n / 1048576).toFixed(1) + 'MB';
const beforeBytes = sizeAll(AUDIO);
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const entries = index.entries || {};
let removedFiles = 0, removedBytes = 0, words = 0, keptSentences = 0, missing = 0;

for (const key of Object.keys(entries)) {
  const e = entries[key];
  if (!e) continue;
  if (key.startsWith('words:')) {
    words++;
    const maleRel = e.male;
    if (maleRel) {
      const abs = path.join(ROOT, 'assets', maleRel);
      if (fs.existsSync(abs)) {
        const size = fs.statSync(abs).size;
        removedBytes += size; removedFiles++;
        if (APPLY) fs.unlinkSync(abs);
      } else {
        missing++;
      }
      delete e.male;                    // 单词只保留女声
    }
  } else {
    keptSentences++;                    // 句子男女声都保留（听力对话需要）
  }
}

// 删掉空的 words/m 目录（如果还有残留文件则不删，打印提示）
const maleDir = path.join(AUDIO, 'words', 'm');
let leftover = 0;
if (fs.existsSync(maleDir)) leftover = fs.readdirSync(maleDir).length;
if (APPLY && leftover === 0) fs.rmdirSync(maleDir);

function sizeAll(dir) {
  let total = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

if (APPLY) {
  index.version = 3;
  index.pruned = {
    at: new Date().toISOString(),
    removedMaleWordFiles: removedFiles,
    removedMaleWordBytes: removedBytes,
    keptWordEntries: words,
    keptSentenceEntries: keptSentences,
    note: '单词仅保留女声（en-GB-Sonia）；句子保留男女声（对话）。源文件见 audio-raw/。',
  };
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 1));
}

const afterBytes = sizeAll(AUDIO);
console.log((APPLY ? '[APPLY] ' : '[DRY] ') + '单词条目 ' + words + ' / 句子条目 ' + keptSentences);
console.log('删除单词男声文件 ' + removedFiles + ' 个，' + MB(removedBytes) + (missing ? '（索引里有但文件缺失 ' + missing + ' 个）' : ''));
console.log('剩余 words/m 目录文件数: ' + leftover);
console.log('assets/audio 体积: ' + MB(beforeBytes) + ' → ' + MB(afterBytes) + '（索引 ' + fs.statSync(INDEX).size + ' 字节）');
if (!APPLY) console.log('加上 --apply 才会真正删除并重写 index.json');
