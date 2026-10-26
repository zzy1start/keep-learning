/* 静态审计：data-act 无处理器、重复入口、调试/遗留标记（只读，不改代码） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'js'));
const src = {};
for (const f of files) src[path.relative(ROOT, f)] = fs.readFileSync(f, 'utf8');

const acts = new Map();
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/data-act="([^"]+)"/g)) {
    if (!acts.has(m[1])) acts.set(m[1], []);
    acts.get(m[1]).push(f);
  }
}
const handled = new Set();
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/a === '([^']+)'/g)) handled.add(m[1]);
  for (const m of s.matchAll(/case '([^']+)'/g)) handled.add(m[1]);
}
const unhandled = [];
for (const [a, where] of acts) if (!handled.has(a)) unhandled.push({ act: a, where });

const dupKeys = [
  ['导出学习报告 PDF', /导出学习报告|学习报告 PDF|data-act="report"|exportReport/],
  ['导出/备份数据', /导出备份|备份数据|导出学习进度|progressBackup|Store\.backup/],
  ['导出 PDF / 生词本导出', /导出 PDF|data-act="export"|openNotebookExport/],
  ['批改/评分入口', /提交并评分|开始批改|data-act="grade"/],
  ['发音测试/诊断', /测试在线发音|试听句子并计时|试听单词并计时|本地 TTS 试验|合成并播放测试句|发音延迟诊断|对比音色延迟|重新启用云端音色/],
  ['导入入口', /导入真题|导入整份真题|导入听力|导入阅读|data-act="import"/],
  ['词汇量测试入口', /词汇量测试|做词汇量测试/],
  ['AI 生成/出题', /AI 生成新文章|AI 练习题|_genTask|genWritingTask/],
];
const dupReport = dupKeys.map(([name, re]) => {
  const hits = [];
  for (const [f, s] of Object.entries(src)) {
    s.split('\n').forEach((line, i) => { if (re.test(line)) hits.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 100)); });
  }
  return { name, count: hits.length, sample: hits.slice(0, 7) };
});

const marks = [];
for (const [f, s] of Object.entries(src)) {
  s.split('\n').forEach((line, i) => {
    if (/TODO|FIXME|未使用|不再使用|已废弃|legacy|仅桌面|serve\.js|__shutdown|关闭服务器/i.test(line)) {
      marks.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 120));
    }
  });
}
console.log(JSON.stringify({ unhandled, dupReport, marks: marks.slice(0, 50) }, null, 1));
