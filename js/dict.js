/* ============ dict.js : 词库加载 ============ */
const BOOKS = [
  { id: 'cet4', name: '大学英语四级词汇', sub: 'CET-4', color: '#3b82f6' },
  { id: 'cet6', name: '大学英语六级词汇', sub: 'CET-6', color: '#12b76a' },
  { id: 'kaoyan', name: '考研词汇', sub: 'POSTGRAD', color: '#7c5cff' },
  { id: 'toefl', name: '托福词汇', sub: 'TOEFL', color: '#ec4899' },
  { id: 'sat', name: 'SAT 词汇', sub: 'SAT', color: '#0ea5e9' },
];

const Dict = {
  books: {},
  loaded: {},
  global: null,
  forms: null,       // 变形 -> 原形（"challenges challenge" 逐行）
  formsIdx: null,    // 变形 -> 原形 的Map
  content: null,
  CHUNK: 1000,

  async boot() {
    await Promise.all([this.loadContent(), this.loadGlobal(), this.loadForms()]);
    this.mergeImportedContent();
  },

  /** 合并"导入后暂存在本机"的篇目（静态托管没有 /__save-content 时使用）。
   * 每篇按 id 去重，避免多次合并产生重复。*/
  mergeImportedContent() {
    if (typeof Store === 'undefined' || !Store.d) return 0;
    const bk = Store.d.contentBackup;
    if (!bk || typeof bk !== 'object') return 0;
    const map = { listening: 'passages', reading: 'passages', writing: 'tasks' };
    let added = 0;
    for (const target of Object.keys(map)) {
      const listKey = map[target];
      const saved = bk[target];
      if (!saved) continue;
      const arr = Array.isArray(saved) ? saved
        : (saved && Array.isArray(saved[listKey]) ? saved[listKey] : []);
      if (!arr.length) continue;
      const box = this.content && this.content[target];
      if (!box) continue;
      const pool = box[listKey] || (box[listKey] = []);
      const ids = new Set(pool.map(x => x && x.id).filter(Boolean));
      for (const item of arr) {
        if (!item || !item.id || ids.has(item.id)) continue;
        pool.push(item);
        ids.add(item.id);
        added++;
      }
    }
    return added;
  },

  async loadContent() {
    const [l, r, w, l4, rk, wk, r4ab] = await Promise.all([
      fetch('data/content/listening.json').then(r => r.json()),
      fetch('data/content/reading.json').then(r => r.json()),
      fetch('data/content/writing.json').then(r => r.json()),
      // 四级听力单独一个文件，失败不影响其它模块
      fetch('data/content/listening-cet4.json').then(r => r.ok ? r.json() : null).catch(() => null),
      // 考研阅读 / 写作（可选文件，缺失时静默跳过）
      fetch('data/content/reading-kaoyan.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/content/writing-kaoyan.json').then(r => r.ok ? r.json() : null).catch(() => null),
      // 四级 Section A 选词填空 / Section B 段落匹配示例题
      fetch('data/content/reading-cet4-section-ab.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    // 合并四级听力：数据已转成与六级完全同构的 passages 格式，直接 concat
    const L = l;
    if (l4 && l4.passages) {
      L.passages = (L.passages || []).concat(l4.passages);
      L.cet4Count = l4.passages.length;
    }
    // 合并考研阅读
    const R = r;
    if (rk && rk.passages) {
      R.passages = (R.passages || []).concat(rk.passages);
      R.kaoyanCount = rk.passages.length;
    }
    if (r4ab && r4ab.passages) {
      R.passages = (R.passages || []).concat(r4ab.passages);
      R.cet4SectionABCount = r4ab.passages.length;
    }
    // 合并考研写作（小作文 / 大作文 / 单句练习）
    const W = w;
    if (wk) {
      W.tasks = (W.tasks || []).concat(wk.tasks || []);
      if (wk.sentenceTasks) W.sentenceTasks = (W.sentenceTasks || []).concat(wk.sentenceTasks);
      W.kaoyanCount = (wk.tasks || []).length;
    }
    this.content = { listening: L, reading: R, writing: W };
  },

  async loadGlobal() {
    try {
      this.global = await fetch('data/dictionary.min.json').then(r => r.json());
    } catch (e) { console.warn('global dict load fail', e); this.global = {}; }
  },

  /** 加载屈折变形索引（challenges → challenge） */
  async loadForms() {
    try {
      const txt = await fetch('data/dictionary.forms.txt').then(r => r.text());
      this.forms = txt;
      this.formsIdx = new Map();
      for (const line of txt.split('\n')) {
        const i = line.indexOf(' ');
        if (i > 0) this.formsIdx.set(line.slice(0, i), line.slice(i + 1));
      }
    } catch (e) { console.warn('forms load fail', e); this.formsIdx = new Map(); }
  },

  /** 加载某词书（分片懒加载） */
  async load(bookId) {
    if (this.loaded[bookId]) return this.books[bookId];
    const idx = await fetch(`data/${bookId}/index.json`).then(r => r.json());
    const words = [];
    const tasks = [];
    for (let i = 0; i < idx.chunks; i++) {
      tasks.push(fetch(`data/${bookId}/${String(i).padStart(2, '0')}.json`)
        .then(r => r.json()).then(a => words.push(...a)));
    }
    await Promise.all(tasks);
    /* 【去重：修"同一个词连着背两遍"】
     * 词书由多个分组文件拼成，同一拼写会在多个文件里各出现一次
     * （实测 cet4：7508 条里只有 4544 个唯一拼写，2354 组重复；cet6 1423 组）。
     * 不去重有两个后果：
     *   1) 学习队列里同一个词出现两次 → 用户看到"连着背同一个词"；
     *   2) 词书容量虚高：按 7508 算进度，实际只有 4544 个词可学。
     * 处理：按拼写（小写）合并，保留**信息量更大**的那条（释义/词组/例句更多），
     * 再按词频排序，保证"高频词在前"的既有约定不变。*/
    const best = new Map();
    for (const w of words) {
      const key = String((w && w.w) || '').toLowerCase();
      if (!key) continue;
      const prev = best.get(key);
      if (!prev || wordRichness(w) > wordRichness(prev)) best.set(key, w);
    }
    const unique = [...best.values()].sort((a, b) => b.freq - a.freq);
    const map = {};
    unique.forEach((w, i) => { w.idx = i; map[w.w.toLowerCase()] = w; });
    // total 用去重后的真实数量，避免"词书容量 7508 / 实际 4544"的名不副实
    const bk = Object.assign({}, idx, { words: unique, map, total: unique.length, rawTotal: idx.total });
    this.books[bookId] = bk;
    this.loaded[bookId] = true;
    // 缓存给Store，供「按词汇量测试跳过简单词」功能使用
    if (typeof Store !== 'undefined') {
      Store.d._bookCache = Store.d._bookCache || {};
      Store.d._bookCache[bookId] = bk;
    }
    return bk;
  },

  /**
   * 全局词典查词（含屈折还原与常见不规则变化）
   * 返回 [音标, 释义, 查到的形态]
   */
  get(word) {
    if (!this.global) return null;
    const w = String(word || '').toLowerCase().trim();
    const hit = k => (this.global[k] ? [this.global[k][0], this.global[k][1], k] : null);
    // 1) 原形直接命中
    const direct = hit(w);
    if (direct) return direct;
    // 2) 变形索引还原
    if (this.formsIdx) {
      const base = this.formsIdx.get(w);
      if (base) { const r = hit(base); if (r) return r; }
    }
    // 3) 规则变化兜底
    for (const f of [simpleStem, verbForm, adjForm, unSuffix, deSuffix]) {
      const k = f(w);
      if (k && k !== w) {
        const r = hit(k);
        if (r) return r;
        if (this.formsIdx) {
          const b2 = this.formsIdx.get(k);
          if (b2) { const r2 = hit(b2); if (r2) return r2; }
        }
      }
    }
    // 4) 逐段裁后缀组合（如 emphasi-zed）
    for (const suf of ['ations', 'ation', 'ized', 'izes', 'izing', 'ings', 'ies', 'es', 'ed', 'ing', 'ly', 's', 'er', 'est', 'al']) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) {
        const stem = w.slice(0, -suf.length);
        const cand = ['e', '', 'y'].map(end => (suf === 'es' || suf === 'ies' ? stem.replace(/i$/, 'y') + (end || '') : stem + end));
        for (const c of cand) {
          const r = hit(c);
          if (r) return r;
          if (this.formsIdx) {
            const b = this.formsIdx.get(c);
            if (b) { const r2 = hit(b); if (r2) return r2; }
          }
        }
      }
    }
    return null;
  },

  /** 在某词书内查（含音标、词组、例句） */
  inBook(bookId, word) {
    const bk = this.books[bookId];
    if (!bk) return null;
    const w = String(word || '').toLowerCase().trim();
    return bk.map[w] || bk.map[simpleStem(w)] || null;
  },

  /** 合并词书与全局词典的常见词性释义，供词条详情复用。 */
  meaningRows(word) { return choiceMeaningRows(word); },
};

/**
 * 词条信息量：释义(×3) + 词组(×2) + 例句 的条数，同条数时比释义文字长度。
 * 去重时保留数值更大的那条；不依赖遍历顺序（Promise.all 的完成顺序是随机的，
 * 只按"严格更大才替换"会让结果随运行波动，所以这里给一个全序比较值）。
 */
function wordRichness(w) {
  if (!w) return -1;
  const n = a => (Array.isArray(a) ? a.length : 0);
  const chars = (a, field) => (Array.isArray(a)
    ? a.reduce((s, x) => s + String((x && x[field]) || '').length, 0) : 0);
  const counts = n(w.tr) * 3 + n(w.phr) * 2 + n(w.ex);
  const text = chars(w.tr, 'd') + chars(w.phr, 'd') + chars(w.ex, 'en');
  return counts * 100000 + Math.min(99999, text);
}

function simpleStem(w) {
  return w.replace(/(ing|ed|es|s|ly)$/i, '');
}
function verbForm(w) {
  return w.replace(/ing$/, '').replace(/ed$/, '');
}
function adjForm(w) {
  return w.replace(/ous$/, '').replace(/ful$/, '').replace(/ive$/, '').replace(/able$/, '').replace(/ible$/, '');
}
function unSuffix(w) {   // disorganized -> organize
  return w.replace(/^(un|in|im|dis|non)[a-z]/, c => c.slice(1));
}
function deSuffix(w) {   // modernized -> modern（进一步交给 formsIdx）
  return w.replace(/(ized|ises|izing|ised|ising)$/, '');
}

const CHOICE_POS = {
  n: '名词', v: '动词', adj: '形容词', adv: '副词', prep: '介词', pron: '代词',
  conj: '连词', num: '数词', int: '感叹词', art: '冠词', abbr: '缩写', other: '释义',
};
const CHOICE_POS_ORDER = ['n', 'v', 'adj', 'adv', 'prep', 'pron', 'conj', 'num', 'int', 'art', 'abbr', 'other'];

function choicePosKey(pos) {
  const tags = String(pos || '').toLowerCase().match(/[a-z]+/g) || [];
  if (tags.some(x => ['n', 'noun'].includes(x))) return 'n';
  if (tags.some(x => ['v', 'verb', 'vt', 'vi', 'vti', 'aux'].includes(x))) return 'v';
  if (tags.some(x => ['adj', 'a'].includes(x))) return 'adj';
  if (tags.some(x => ['adv', 'ad'].includes(x))) return 'adv';
  if (tags.some(x => ['prep', 'preposition', 'p'].includes(x))) return 'prep';
  if (tags.some(x => ['pron', 'pronoun'].includes(x))) return 'pron';
  if (tags.some(x => ['conj', 'conjunction'].includes(x))) return 'conj';
  if (tags.some(x => ['num', 'numeral'].includes(x))) return 'num';
  if (tags.some(x => ['int', 'interj'].includes(x))) return 'int';
  if (tags.some(x => ['art', 'article'].includes(x))) return 'art';
  if (tags.includes('abbr')) return 'abbr';
  return 'other';
}

function choiceAddGloss(groups, pos, text) {
  const key = choicePosKey(pos);
  const parts = String(text || '').split(/[，,；;、]/)
    .map(x => x.replace(/^\s*(?:n|vt|vi|v|adj|adv|a|ad|prep|pron|conj|num|int|art|abbr)\.\s*/i, '')
      .replace(/^[\s&]+|[\s&]+$/g, '')      /* "vt.& vi." 解析出的 "&" 碎片 / 以 & 开头 */
      .trim())
    /* 只剩 & / 标点的碎片不是释义（旧版 attack 会出现 "&；攻击" 这种选项文本） */
    .filter(x => x && /[A-Za-z\u4e00-\u9fa5]/.test(x));
  if (!parts.length) return;
  (groups[key] ||= []);
  for (const part of parts) {
    if (!groups[key].some(x => x.toLowerCase() === part.toLowerCase())) groups[key].push(part);
  }
}

/** 从原始词典释义中读取 n./vt./adj. 等分组，兼容带标注和分行词书。 */
function choiceParseTagged(text, groups) {
  const re = /(^|[\s,;，；])((?:abbr|pron|prep|conj|adj|adv|aux|art|vt|vi|v|n|a|ad|num|int)\.)/gi;
  const marks = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    marks.push({ start: m.index + m[1].length, gloss: re.lastIndex, pos: m[2].slice(0, -1) });
  }
  if (!marks.length) return false;
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : String(text).length;
    choiceAddGloss(groups, mark.pos, String(text).slice(mark.gloss, end));
  });
  return true;
}

/** 过滤带地区/语域/生僻标记的释义；整组都生僻时保留原样，避免完全无释义。 */
function choiceRareGloss(g) {
  const s = String(g || '').trim();
  return /^[（(]/.test(s)
    || /^(英|美|澳|新西兰|苏格兰|爱尔兰|加拿大|南非|印度|澳新)[〉\s、]/.test(s)
    || /(俚|古|废|罕|讹|人名|地名|商标|方言|非正式|旧时|尤指|婉辞)/.test(s);
}
function choiceCommonGlosses(list) {
  const all = (list || []).map(x => String(x || '').trim()).filter(Boolean);
  const common = all.filter(g => !choiceRareGloss(g));
  return common.length ? common : all;
}

/** 合并本词书释义和全局词典常见释义，避免 CET6 等词书只存一条偏义。 */
function choiceMeanings(word) {
  const groups = {};
  /* 先读内置词典：它的词性顺序更接近常见用法（hard: adj/adv/n；second: n/adj/adv/vt）。*/
  const global = typeof Dict !== 'undefined' ? Dict.get(word.w) : null;
  if (global && global[1]) choiceParseTagged(global[1], groups);
  (word.tr || []).forEach(row => {
    const parsed = choiceParseTagged(row.d, groups);
    if (!parsed && row.d) choiceAddGloss(groups, row.t || 'other', row.d);
  });
  return groups;
}

function choiceMeaningRows(word) {
  const groups = choiceMeanings(word);
  const rows = [];
  for (const key of Object.keys(groups)) {
    const common = choiceCommonGlosses(groups[key]);
    if (!common.length) continue;
    /* 第二个词性只有 >=2 条常见释义时才带上；避免 settle 的 n.高背长靠椅、
     * ear 的 v.抽穗这种单条冷门义混进答案。*/
    if (rows.length === 1 && common.length < 2) continue;
    rows.push({ t: CHOICE_POS[key], d: common.slice(0, 2).join('；') });
    if (rows.length >= 2) break;   // 卡片/出题只保留最常见两个词性
  }
  return rows;
}

function choiceText(word, compact = false, preferredPos = '') {
  const groups = choiceMeanings(word);
  let keys = Object.keys(groups).filter(key => groups[key] && groups[key].length);
  if (preferredPos && groups[preferredPos]) keys = [preferredPos];
  if (compact) {
    const key = keys[0];
    const common = key ? choiceCommonGlosses(groups[key]) : [];
    return key && common.length ? `${CHOICE_POS[key]}：${common[0]}` : '';
  }
  const text = keys.slice(0, 2).map(key => {
    const common = choiceCommonGlosses(groups[key]);
    return common.length ? `${CHOICE_POS[key]}：${common.slice(0, 2).join('；')}` : '';
  }).filter(Boolean).join('　');
  return text || ((word.tr || []).find(x => x.d) || {}).d || '';
}
/* 生成 4 选 1 选项：四项同构（"词性：单条常见释义"），干扰项取同词性随机词。
 * 【2026-10-25 修复"答案总是最长的那条"】旧实现正确项拼 1~2 个词性
 * （"名词：秒　形容词：第二"），干扰项只显示一条（"名词：支持"），
 * 正确项系统性更长，用户能靠长度猜答案。现在正确项也只给一条常见义，
 * 与干扰项同构（真实词库实测：正确项"严格最长"比例 0.20，随机期望 0.25）。 */
function buildChoices(target, book) {
  const targetGroups = choiceMeanings(target);
  const preferredPos = CHOICE_POS_ORDER.find(key => targetGroups[key] && targetGroups[key].length) || '';
  const correct = choiceText(target, true, preferredPos) || choiceText(target, true);
  if (!correct) return { opts: [target.w, '', '', ''], answer: 0, words: [target.w, '', '', ''] };
  /* 候选池：先同词性的单义释义（更像释义辨析，而不是词性猜测），不够再放宽词性。
   * 同时记录字数：正确项的"长度名次"随机指定，再按名次挑严格更长/更短的干扰项。 */
  const words = book.words || [];
  const pool = [];
  const seen = new Set([correct]);
  const addCand = (cand, relaxed) => {
    if (!cand || cand.w === target.w) return;
    const text = relaxed ? choiceText(cand, true) : choiceText(cand, true, preferredPos);
    if (!text || seen.has(text)) return;
    seen.add(text);
    pool.push({ text, word: cand.w, len: text.length });
  };
  for (let i = 0; i < 160 && words.length; i++) addCand(words[Math.floor(Math.random() * words.length)], false);
  if (pool.length < 12) for (let i = 0; i < 160 && words.length; i++) addCand(words[Math.floor(Math.random() * words.length)], true);

  const correctLen = correct.length;
  const longer = pool.filter(c => c.len > correctLen).sort((a, b) => a.len - b.len);
  const shorter = pool.filter(c => c.len < correctLen).sort((a, b) => b.len - a.len);
  /* 每题在 0..3 里均匀随机"要几个更长的干扰项"；某一侧不够时由池子补位 */
  const wantRank = Math.floor(Math.random() * 4);
  const others = [];
  const takeFrom = (arr, n) => {
    let k = 0;
    while (k < n && arr.length) {
      others.push(arr.splice(Math.floor(Math.random() * Math.min(8, arr.length)), 1)[0]);
      k++;
    }
  };
  takeFrom(longer, wantRank);
  takeFrom(shorter, 3 - wantRank);
  if (others.length < 3) {
    for (const c of pool) { if (others.length >= 3) break; if (!others.includes(c)) others.push(c); }
  }
  const picked = App.shuffle([{ text: correct, word: target.w }, ...others.slice(0, 3).map(c => ({ text: c.text, word: c.word }))]);
  return {
    opts: picked.map(x => x.text),
    answer: picked.findIndex(x => x.text === correct),
    words: picked.map(x => x.word),
  };
}

/** 词汇量测试题：按词频排序分层抽题 */
function buildVocabTest(book, n = 40) {
  const words = book.words.slice().sort((a, b) => b.freq - a.freq);
  // 按词频 8 档分层，每档抽 n/8
  const buckets = 8, per = Math.ceil(n / buckets), out = [];
  for (let b = 0; b < buckets && out.length < n; b++) {
    const lo = Math.floor(b * words.length / buckets), hi = Math.floor((b + 1) * words.length / buckets);
    const seg = words.slice(lo, hi);
    out.push(...App.pick(seg, per));
  }
  return out.slice(0, n).map(w => {
    const c = buildChoices(w, book);
    return { w: w.w, opts: c.opts, a: c.answer };
  });
}
/** 词汇量估算：答对率→估算词汇量（粗略映射） */
function estimateVocab(correct, total, bookSize) {
  const r = correct / Math.max(1, total);
  // 高分段≈中高阶，低分段≈基础，映射到 bookSize 的 30%~100%
  const k = Math.pow(r, 1.35);
  return Math.round(bookSize * (0.28 + 0.72 * k));
}