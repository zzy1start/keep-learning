/* ============ check-text-repair.cjs : 导入文本修复自检 ============ */
/* 夹具全部是**真实脏数据**：前两条来自 data/content 里已经入库的导入条目
 * （四级翻译原文 / 阅读 typeEvidence），用来保证修好之后还能复现当初的损坏形态。
 * 页脚夹具来自 2023-06 六级阅读：PDF 把 "2023 年 3 月英语六级真题第 1 套第 5 页，
 * 共 8 页" 抽成一行粘进句子中间（"…but … also deprives…"）。 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const T = require(path.join(__dirname, '../js/text-repair.js'));
global.tokenizer = require(path.join(__dirname, '../vendor/sbd/dist/sbd.js'));

// 真实样本 1：四级翻译原文（外文单词被拆散 + 汉字之间空格 + 括号内侧空格 + 版面换行）
const RAW_TRANSLATION = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也 (  e tiq u e tte )  。赠送礼物不\n'
  + '仅是物质的馈赠，更是情感的表达，是维系人际关系的重要纽带。一份精心挑选、符合接受者喜好的\n'
  + '礼物，往往能加深彼此的感情。中 国 人 遵 循 “ 礼尚往来”  ( mutually exchanging courtesies )  的传统，\n'
  + '接受礼物时会表达谢意，并适时回赠礼物，以增进彼此的融洽关系。';
const FIXED_TRANSLATION = '在中国传统文化中，亲朋好友之间互赠礼物是人际交往的一种重要礼也(etiquette)。'
  + '赠送礼物不仅是物质的馈赠，更是情感的表达，是维系人际关系的重要纽带。'
  + '一份精心挑选、符合接受者喜好的礼物，往往能加深彼此的感情。'
  + '中国人遵循“礼尚往来” (mutually exchanging courtesies)的传统，'
  + '接受礼物时会表达谢意，并适时回赠礼物，以增进彼此的融洽关系。';

let failed = 0;
let total = 0;
function check(name, run) {
  total++;
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

check('真实损坏样本被完整修复（拆散的单词、汉字空格、括号空格、版面换行）', () => {
  assert.equal(T.fix(RAW_TRANSLATION), FIXED_TRANSLATION);
});

check('修复结果里不再有被拆散的单词或汉字间隙', () => {
  const after = T.fix(RAW_TRANSLATION);
  const report = T.analyze(RAW_TRANSLATION, after);
  assert.equal(report.spacedWordsAfter, 0);
  assert.equal(report.cjkGapsAfter, 0);
  assert.equal(report.punctGapsAfter, 0);
  assert.ok(report.spacedWordsBefore > 0 && report.cjkGapsBefore > 0, '夹具本身应带有损坏');
  assert.ok(after.includes('etiquette'), '外文单词必须拼回完整形式');
});

check('汉字被空格隔开的其它形态（真 题 / 烦 躁）', () => {
  assert.equal(T.fix('文档标题为“大学英语四级考试 2026 年 6 月 真 题 ( 第 三 套 )”'),
    '文档标题为“大学英语四级考试 2026 年 6 月真题(第三套)”');
  assert.equal(T.fix('___ that people may experience irritability (烦 躁 ) or headaches'),
    '___ that people may experience irritability (烦躁) or headaches');
});

check('正常英文不被改动（单字母 / 缩写 / 括号 / 连字符）', () => {
  for (const s of ['I am a boy. He is a student.', 'Mr. Smith went home. It cost $3.50.',
    'This is well-known.', 'word (parenthetical) test.', 'A B C three options']) {
    assert.equal(T.fix(s), s, '不该改动：' + s);
  }
});

check('中英混排只压空白，不动文字', () => {
  assert.equal(T.fix('英语 learning 方法'), '英语 learning 方法');
  assert.equal(T.fix('礼物 etiquette 表达'), '礼物 etiquette 表达');
});

check('版面换行被接回，但标题/题号/段落边界保留', () => {
  const joined = T.fix('第一行没有句号结尾的正文\n第二行继续这句话的内容。');
  assert.equal(joined, '第一行没有句号结尾的正文第二行继续这句话的内容。');
  const kept = T.fix('Questions 1 to 5 are based on the following passage.\n46. He went home.');
  assert.ok(kept.includes('\n'), '题号行不能和正文粘在一起：' + JSON.stringify(kept));
  const paragraphs = T.fix('第一段结尾。\n\n第二段开头。');
  assert.ok(paragraphs.includes('\n\n'), '空行分隔的段落必须保留');
});

check('只动空白：去掉全部空白后字符序列不变（证明没有替换/删改任何字）', () => {
  const strip = s => String(s).replace(/\s+/g, '');
  assert.equal(strip(T.fix(RAW_TRANSLATION)), strip(RAW_TRANSLATION));
});

check('断句优先使用 vendored sbd（正确处理 Mr. / e.g.）', () => {
  const en = 'In traditional Chinese culture, exchanging gifts is a courtesy. Mr. Smith agrees, e.g. he does it every year.';
  const withSbd = T.sentences(en, 'en');
  assert.equal(withSbd.length, 2, 'sbd 应切成 2 句，实际：' + JSON.stringify(withSbd));
  assert.ok(withSbd[1].startsWith('Mr. Smith'), '缩写不应被误切：' + withSbd[1]);
});

check('对照：没有 sbd 时同一段文本会被正则误切（说明引入 sbd 的价值）', () => {
  const en = 'In traditional Chinese culture, exchanging gifts is a courtesy. Mr. Smith agrees, e.g. he does it every year.';
  const savedWindow = global.window;
  const savedTokenizer = global.tokenizer;
  delete global.tokenizer;
  global.window = {};
  try {
    const fallback = T.sentences(en, 'en');
    assert.ok(fallback.length > 2, '正则兜底会把 Mr. / e.g. 切开：' + JSON.stringify(fallback));
    assert.ok(fallback.some(s => s === 'Mr.'), '应当能看到被误切的 Mr. 片段');
  } finally {
    global.window = savedWindow;
    global.tokenizer = savedTokenizer;
  }
});

check('中文按全角句末标点断句', () => {
  assert.deepEqual(T.sentences('第一句。第二句！第三句？', 'zh'), ['第一句', '第二句', '第三句']);
});

check('听力逐行断句：说话人角色行不被合并', () => {
  const script = 'W: I want to buy a ticket. It is cheap.\nM: But the train leaves at nine.';
  const out = T.sentences(script, 'en', { keepLines: true });
  assert.ok(out.length >= 3, '应保留角色行并继续句内切分，实际：' + JSON.stringify(out));
  assert.ok(out[0].includes('W: I want to buy a ticket.'), '角色前缀要保留：' + out[0]);
});

check('vendored 的 sbd 文件确实存在且可加载', () => {
  const p = path.join(__dirname, '../vendor/sbd/dist/sbd.js');
  assert.ok(fs.existsSync(p), '缺少 ' + p);
  assert.equal(typeof require(p).sentences, 'function');
});

check('英文里引号后的空格不被吞掉，中文里的“ 礼尚往来”会修好', () => {
  assert.equal(T.fix('on time,“ says Sophie Cikovsky, who handles hiring'),
    'on time,“ says Sophie Cikovsky, who handles hiring');
  assert.equal(T.fix('中国人遵 循 “ 礼尚往来”  的传统'), '中国人遵循“礼尚往来”的传统');
});

check('词表可用时也不会吞并正常英文短语', () => {
  const words = new Set(['answers', 'or', 'do', 'they', 'take', 'up', 'to', 'at', 'a', 'time', 're', 'fine', 'kept', 'for', 'week']);
  T.setWordChecker(w => words.has(w));
  try {
    for (const s of ['or do they', 'take up to four at a time', 'you are fine', 'kept for a week']) {
      assert.equal(T.fix(s), s, '不该拼接：' + s);
    }
    assert.equal(T.fix('an sw ers'), 'answers');
  } finally { T.setWordChecker(null); }
});
check('词表开启时，真实损坏样本仍被完整修复（词表不能抢掉单字母证据）', () => {
  const words = new Set(['etiquette', 'answers']);
  T.setWordChecker(w => words.has(w));
  try {
    assert.equal(T.fix(RAW_TRANSLATION), FIXED_TRANSLATION);
  } finally { T.setWordChecker(null); }
});
check('缩写尾巴不会被拼接（There\'s an / student\'s own / that\'s not）', () => {
  const words = new Set(['answers', 'san', 'sown', 'snot', 'an', 'own', 'not', 's']);
  T.setWordChecker(w => words.has(w));
  try {
    for (const s of ["There's an intensive course", "the student's own time", "that's not what it means"]) {
      assert.equal(T.fix(s), s, '不该拼接：' + s);
    }
    assert.equal(T.fix('an sw ers'), 'answers');
  } finally { T.setWordChecker(null); }
});
check('不会把后面的正常单词一起吞进来', () => {
  assert.equal(T.fix('礼也 (  e tiq u e tte ) is a word'), '礼也(etiquette) is a word');
  assert.equal(T.fix('the e tiq u e tte is here'), 'the etiquette is here');
});
check('可选词表校验：an sw ers → answers；词表说不是词就保持原样', () => {
  const raw = 'clear and concise an sw ers to give';
  assert.equal(T.fix(raw), raw, '没有词表钩子时不该猜');
  T.setWordChecker(w => w === 'answers');
  try {
    assert.equal(T.fix(raw), 'clear and concise answers to give');
    assert.equal(T.fix('the cat sat on the mat'), 'the cat sat on the mat', 'thecatsat 不是词，不能拼');
  } finally { T.setWordChecker(null); }
  assert.equal(T.fix(raw), raw, '解除钩子后恢复保守行为');
});
check('浏览器加载路径：sbd 挂到 window.tokenizer，TextRepair 能取到它', () => {
  const vm = require('node:vm');
  const sbdSrc = fs.readFileSync(path.join(__dirname, '../vendor/sbd/dist/sbd.js'), 'utf8');
  const sandbox = { window: {}, self: undefined, console };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(sbdSrc, sandbox);
  assert.equal(typeof sandbox.window.tokenizer, 'object', 'sbd 浏览器构建应挂在 window.tokenizer');
  assert.equal(typeof sandbox.window.tokenizer.sentences, 'function');
  // 用浏览器语义复现 TextRepair 的查找逻辑
  const found = vm.runInContext('typeof window.tokenizer.sentences === "function"', sandbox);
  assert.equal(found, true);
  // 断言用实测行为：sbd 对 "Mr. Smith left. It was late." 切 2 句且不切碎 Mr.
  const two = sandbox.window.tokenizer.sentences('Mr. Smith left. It was late.');
  assert.equal(two.length, 2);
  assert.ok(two[0].startsWith('Mr. Smith'), '不应把 Mr. 切成独立句：' + two[0]);
});
/* ---------- ④ 页眉/页脚：真实脏数据 + 误删反例 ---------- */
// 真实用户样本：2023-06 六级阅读段落 I，页脚被 PDF 抽成一行、粘进句子中间
const REAL_FOOTER_GLUED = 'At the same time, when a system no longer provides opportunities for the majority to participate in wealth building, it not only robs those who are excluded from opportunities, but 2023 年 3 月英语六级真题第 1 套第 5 页，共 8 页 also deprives them of their dignity.';
const REAL_FOOTER_FIXED = 'At the same time, when a system no longer provides opportunities for the majority to participate in wealth building, it not only robs those who are excluded from opportunities, but also deprives them of their dignity.';

check('页脚①：正文中间粘着的页脚被删除，两侧单词不粘连（真实用户样本）', () => {
  assert.equal(T.stripPageFurniture(REAL_FOOTER_GLUED), REAL_FOOTER_FIXED);
  assert.equal(T.fix(REAL_FOOTER_GLUED), REAL_FOOTER_FIXED);
  assert.ok(!/页|真题/.test(T.fix(REAL_FOOTER_GLUED)), '页脚文字必须全部删掉');
  assert.ok(T.fix(REAL_FOOTER_GLUED).includes('but also deprives'), '删除处要补一个空格，不能粘成 butalso');
});

check('页脚②：真题卷头（独立行 / 行内 / 带年份月份）被删除', () => {
  assert.equal(T.fix('Directions: Read the passage carefully.\n2023年6月大学英语六级考试真题（第1套）\nPassage One'),
    'Directions: Read the passage carefully.\nPassage One');
  assert.equal(T.fix('Passage One 2023 年 3 月英语六级真题'), 'Passage One');
  assert.equal(T.fix('2023 年 6 月大学英语六级考试真题（第 1 套） Passage One'), 'Passage One');
  assert.equal(T.stripPageFurniture('大学英语六级考试真题（第1套）'), '');
  assert.equal(T.stripPageFurniture('2023年6月大学英语六级考试真题（第1套）'), '');
});

check('页脚③：页码形态（第X页共Y页 / 连字符 / Page X of Y）整行删除', () => {
  for (const s of ['第 5 页 共 8 页', '第5页，共8页', '第 5 页，共 8 页', '- 5 -', '— 5 —',
    'Page 5 of 8', 'Page 5/8', '第 5 页', '共 8 页', 'Page 5']) {
    assert.equal(T.stripPageFurniture(s), '', '应整行删除：' + s);
  }
  assert.equal(T.fix('the passage ends here. Page 5 of 8'), 'the passage ends here.');
  assert.equal(T.fix('第一段结束。\n- 5 -\n第二段开始。'), '第一段结束。\n第二段开始。');
  assert.equal(T.fix('第一段结束。\n第 5 页\n\n第二段开始。'), '第一段结束。\n\n第二段开始。');
});

check('页脚④：页脚把一句话切成两行（PDF 分页）时接回同一句', () => {
  const stored = 'At the same time, when a system no longer provides opportunities for the majority to participate in wealth building, it not only robs those who are excluded from opportunities, but\n\n2023 年 3 月英语六级真题第 1 套第 5 页，共 8 页 also deprives them of their dignity.';
  assert.equal(T.stripPageFurniture(stored), REAL_FOOTER_FIXED);
  assert.equal(T.fix(stored), REAL_FOOTER_FIXED);
  assert.ok(!T.fix(stored).includes('\n'), '页脚两侧的同一句不能被拆成两段');
  // 行内页脚（不贴行首）同样只留一个空格
  assert.equal(T.fix('evidence matches 2023 年 3 月英语六级真题第 1 套第 8 页，共 8 页 the conclusions of the study.'),
    'evidence matches the conclusions of the study.');
});

check('页脚反例：正文里的普通数字/套别/日期/页码引用不删', () => {
  const keep = [
    '这套题是第 1 套题',
    '第 1 套题',
    '2023 年',
    '2023 年 6 月',
    '2023 年 6 月英语六级考试',
    '英语六级考试',
    '他翻到第 5 页',
    '请翻到第 5 页。',
    'Questions 1 to 5 are based on the following passage.',
    'The number 2023 appears twice in the text.',
    'Passage One 第 1 套',
  ];
  for (const s of keep) assert.equal(T.fix(s), s, '不该改动：' + s);
  assert.equal(T.fix('第 5 页'), '', '但独立成行的"第 5 页"是页码，必须删');
});

check('页脚反例：缺强证据时"第 N 套 / 年月"不猜，强证据在旁边才一起删', () => {
  assert.equal(T.stripPageFurniture('第 1 套'), '第 1 套');
  assert.equal(T.stripPageFurniture('2023 年 3 月'), '2023 年 3 月');
  assert.equal(T.stripPageFurniture('这本真题第 1 套题很难'), '这本真题第 1 套题很难');
  assert.equal(T.stripPageFurniture('2023 年 3 月英语六级真题 第 1 套 第 5 页，共 8 页'), '');
  assert.equal(T.stripPageFurniture('2023 年 6 月大学英语六级考试真题（第1套）'), '');
});

check('页脚：stripPageFurniture 已导出、可重复调用（幂等）', () => {
  assert.equal(typeof T.stripPageFurniture, 'function');
  const once = T.fix(REAL_FOOTER_GLUED);
  assert.equal(T.stripPageFurniture(once), once);
  assert.equal(T.stripPageFurniture(null), '');
});

if (failed) process.exitCode = 1;
else console.log('全部 ' + total + ' 项文本修复检查通过');