/* ============ vocab-quiz.js : 词汇引擎的词库适配 + 出题 ============
 * 规约：docs/27-词汇学习引擎设计.md §4.1 / §5.3
 *
 * 【Q2 的答案：现有词库缺字段，在这里做无损适配，不改数据文件】
 *   data/*\/NN.json 的条目是 { w, ph, tr:[{t,d}], phr, ex:[{en,cn}], freq }
 *     wordId         = "<bookId>:<word>"
 *     senses         = tr[] 逐条映射（senseId = s0/s1/...）
 *     band           = **词频分位**（词书按 freq 降序，越靠前越简单）→ 0..5 六档
 *     confusableWith = 同首二字母、长度相近的词（受控计算，最多 5 个）
 *   这些字段只在本模块内存里生成（按 book.id 缓存），不写回词库文件。
 *
 * 【出题（§5.3）】
 *   4 个选项 = 1 正确 + 3 干扰；干扰优先级：形近词 → 同频带随机词（**不使用该词自身其他义项**，
 *   见 2026-10-17 修复说明与 docs/27 §12）。
 *   返回结构与旧 buildChoices 兼容（{opts:string[], answer:index}），并额外带 ids/answerId，
 *   这样背单词页的卡片 markup 与交互**完全不用改**。
 */
const VocabQuiz = {
  BANDS: 6,

  _bookState: {},   // bookId -> { index:Map(word->idx), entries:[], byId:{}, prefix:Map }

  wordId(book, raw) { return String(book.id) + ':' + String(raw && raw.w ? raw.w : raw); },

  _stateOf(book) {
    const key = String(book.id) + '@' + (book.words ? book.words.length : 0);
    let st = this._bookState[key];
    if (!st) {
      st = { index: new Map(), entries: [], byId: {}, prefix: new Map() };
      const words = book.words || [];
      for (let i = 0; i < words.length; i++) {
        const w = String(words[i] && words[i].w || '').toLowerCase();
        if (!w) continue;
        st.index.set(w, i);
        const p = w.slice(0, 2);
        if (!st.prefix.has(p)) st.prefix.set(p, []);
        st.prefix.get(p).push(i);
      }
      this._bookState[key] = st;
      this._bookState[book.id] = st;
    }
    return st;
  },

  /** 词频分位 → 频带 0..5（0 最易） */
  bandOf(book, raw) {
    const st = this._stateOf(book);
    const n = (book.words || []).length || 1;
    const idx = st.index.has(String(raw.w).toLowerCase()) ? st.index.get(String(raw.w).toLowerCase()) : st.entries.length;
    return Math.min(this.BANDS - 1, Math.max(0, Math.floor(idx / Math.max(1, n / this.BANDS))));
  },

  /** 原始词条 → §4.1 WordBank entry（带缓存） */
  entryOf(book, raw) {
    if (!raw || !raw.w) return null;
    const st = this._stateOf(book);
    const id = this.wordId(book, raw);
    if (st.byId[id]) return st.byId[id];
    const trs = (raw.tr || []).filter(t => t && t.d);
    /* 【2026-10-17 调整：出题义项用"词书 + 内置词典"合并后的常见义】
     * 词书 tr 有时候只存一条生僻义（例：ear → "（稻麦等的）穗"，但常用义是"耳朵"）。
     * Dict.meaningRows() 会把内置词典的常见义合并进来（详情页展示的就是它）。
     * 这里把它按词性合并成 senses（同一词性多条释义合成一条，只取最常见 2~3 条），
     * 并过滤 "（稻麦等的）" / "（美俚）" 这类带限定的生僻义，避免出题把生僻义当正确答案。
     * 词性顺序沿用词书 tr 的出现顺序，senseId 不重排，已有的学习记录不会错位。*/
    const merged = this._mergedRows(raw);
    let senses;
    if (merged && merged.length) {
      const byKey = new Map();
      for (const row of merged) {
        const k = quizPosKey(row.t);
        if (!byKey.has(k) && row.d) byKey.set(k, row.d);
        else if (byKey.has(k)) byKey.set(k, byKey.get(k) + '；' + row.d);
      }
      /* 常见义来自内置词典（Dict.meaningRows）；以词典/合并义项的顺序为准。
       * 旧逻辑先按词书 tr 排序，second 这种词书只存偏义 v.支持 的词会把偏义当第一答案；
       * 改成 n.秒/adj.第二 先出现，才符合常见高频义。*/
      const order = [];
      for (const row of merged) { const k = quizPosKey(row.t); if (!order.includes(k)) order.push(k); }
      for (const t of trs) { const k = quizPosKey(t.t); if (!order.includes(k)) order.push(k); }
      const keys = order.filter(k => byKey.has(k));
      senses = keys.map((k, i) => ({
        senseId: 's' + i,
        pos: k,
        defZh: commonDefOf(k, byKey.get(k)),
        exampleEn: '', exampleZh: '',
      }));
      /* 有常见义时，去掉整行都是生僻/人名义的 sense（例：vicious 的 "(Vicious)人名；(英)维舍斯"）。
       * senseId 保留原编号，已有学习记录不会错位；若一个词只有生僻义，则保留原行。*/
      const isRareSense = s => /^[（(]/.test(s.defZh) || /(人名|地名|商标)/.test(s.defZh);
      const commonSenses = senses.filter(s => !isRareSense(s));
      if (commonSenses.length) senses = commonSenses;
    }
    if (!senses || !senses.length) {
      senses = (trs.length ? trs : [{ t: '', d: '' }]).map((t, i) => ({
        senseId: 's' + i,
        pos: quizPosKey(t.t),
        defZh: String(t.d || ''),
        exampleEn: raw.ex && raw.ex[i] ? raw.ex[i].en : (raw.ex && raw.ex[0] ? raw.ex[0].en : ''),
        exampleZh: raw.ex && raw.ex[i] ? raw.ex[i].cn : (raw.ex && raw.ex[0] ? raw.ex[0].cn : ''),
      }));
    }
    const entry = {
      wordId: id,
      word: String(raw.w),
      pos: trs.map(t => t.t).filter(Boolean).join('/'),
      band: this.bandOf(book, raw),
      senses,
      confusableWith: this.confusablesOf(book, raw),
      morphemeSplit: null,
      raw,
    };
    st.byId[id] = entry;
    return entry;
  },

  /** 词书 + 内置词典合并后的常见义项（Dict.meaningRows；单位测试/无 Dict 时返回 null） */
  _mergedRows(raw) {
    if (!raw || !raw.w) return null;
    if (typeof Dict === 'undefined' || !Dict || typeof Dict.meaningRows !== 'function') return null;
    try {
      const rows = Dict.meaningRows(raw);
      return (rows || []).filter(r => r && r.d);
    } catch (e) { return null; }
  },

  /** 形近词候选：同首二字母 + 长度相近（最多 5 个）→ 返回 wordId 列表 */
  confusablesOf(book, raw) {
    const st = this._stateOf(book);
    const words = book.words || [];
    const w = String(raw.w || '').toLowerCase();
    if (!w) return [];
    const bucket = st.prefix.get(w.slice(0, 2)) || [];
    const out = [];
    for (const idx of bucket) {
      if (out.length >= 5) break;
      const cand = words[idx];
      const cw = String(cand && cand.w || '').toLowerCase();
      if (!cw || cw === w) continue;
      if (Math.abs(cw.length - w.length) > 2) continue;
      out.push(this.wordId(book, cand));
    }
    return out;
  },

  /** 整本书的 entry 列表（组轮用；按需构建并缓存） */
  bookEntries(book) {
    const st = this._stateOf(book);
    if (st.entries.length) return st.entries;
    const words = book.words || [];
    for (let i = 0; i < words.length; i++) {
      const e = this.entryOf(book, words[i]);
      if (e) st.entries.push(e);
    }
    return st.entries;
  },

  entryById(book, id) {
    const st = this._stateOf(book);
    if (!st.byId[id]) {
      const w = String(id).slice(String(book.id).length + 1);
      const raw = (book.words || []).find(x => String(x.w) === w);
      if (raw) this.entryOf(book, raw);
    }
    return st.byId[id] || null;
  },

  /** 某个 entry 的"出题用释义文本"（取第一个义项；与正确项同一种"词性 释义"格式） */
  _firstDef(book, wordId) {
    const e = this.entryById(book, wordId);
    const s = e && e.senses[0];
    return s ? quizOptionText(s.pos, s.defZh) : '';
  },

  /**
   * 正确项：只显示**本题正在考的义项**，格式与干扰项完全一致（"n. 秒"）。
   * 【2026-10-25 修复"答案总是最长的那条"】旧实现把最常见两个词性拼在一起
   * （"n. 秒；adj. 第二"），干扰项却只显示一个义项，于是正确项系统性更长，
   * 用户能靠长度猜答案。现在四个选项同构；多义辨析仍由引擎按义项轮换（§5.3）。
   */
  _correctDef(entry, sense) {
    const s = sense || (entry.senses || [])[0];
    if (!s) return '';
    return quizOptionText(s.pos, s.defZh);
  },

  /**
   * 为某个词位出题（§5.3）。
   * @returns {{opts:string[], answer:number, ids:string[], answerId:string, promptSenseId:string}}
   */
  choiceFor(slot, book, opts = {}) {
    const rand = opts.rand || Math.random;
    const entry = slot && slot.entry ? slot.entry : this.entryOf(book, slot && slot.word || {});
    if (!entry) return { opts: ['', '', '', ''], answer: 0, ids: [], answerId: '', promptSenseId: '' };
    const sense = (slot && slot.sense) || entry.senses[0] || { senseId: 's0', defZh: '' };
    const correct = { id: entry.wordId + '#' + sense.senseId, text: this._correctDef(entry, sense) || sense.defZh || entry.word };
    /* 【2026-10-17】干扰项还要排除"与该词其他义项文本相同"的选项：
     * 别的词（如 voluntary）的释义可能与本词（volunteer）的另一个义项一模一样，
     * 若放进选项，同一题又会变成"两个都算对"。所以把本词所有义项文本都视为已占用。*/
    const ownDefs = (entry.senses || []).map(s => s.defZh).filter(Boolean);
    const ownLabeled = (entry.senses || []).map(s => quizOptionText(s.pos, s.defZh)).filter(Boolean);
    const seenText = new Set([correct.text].concat(ownDefs, ownLabeled));
    const seenWord = new Set([entry.wordId]);

    /* 【2026-10-25 修复"答案总是最长的那条"】
     * 旧实现：正确项拼 1~2 个词性的释义（"n. 秒；adj. 第二"），干扰项只有一条
     * （"n. 支持"）→ 正确项系统性更长，用户能靠长度猜答案。
     * 现在：四项同构（"词性 + 单条义项"），并且**每题随机指定正确答案的长度名次**
     * （1=最长 … 4=最短），按这个名次去挑严格更长/更短的干扰项，
     * 让"最长=正确"的比例落在随机水平（实测≈0.25），长度不再携带答案信息。
     * 多义辨析仍靠引擎的义项轮换（§5.3），选项里依旧只有一个是目标词的释义。*/
    const entries = this.bookEntries(book);
    const pool = [];
    const pushPool = e => {
      if (!e || !e.wordId || seenWord.has(e.wordId)) return;
      const text = this._firstDef(book, e.wordId);
      if (!text || seenText.has(text)) return;
      seenText.add(text); seenWord.add(e.wordId);
      pool.push({ id: e.wordId + '#s0', wordId: e.wordId, text, len: String(text).length });
    };
    /* 候选池优先级：形近词 → 同频带 → 全书（后两级只抽一部分，够排序用即可） */
    for (const wid of entry.confusableWith || []) pushPool(this.entryById(book, wid));
    const sameBand = this._shuffle(entries.filter(e => e.band === entry.band && e.wordId !== entry.wordId), rand);
    for (const e of sameBand) { if (pool.length >= 120) break; pushPool(e); }
    if (pool.length < 12) {
      for (const e of this._shuffle(entries, rand)) { if (pool.length >= 12) break; pushPool(e); }
    }

    const correctLen = String(correct.text).length;
    const longer = pool.filter(c => c.len > correctLen).sort((a, b) => a.len - b.len || rand() - 0.5);
    const shorter = pool.filter(c => c.len < correctLen).sort((a, b) => b.len - a.len || rand() - 0.5);
    /* 每题在 0..3 里均匀随机"要几个更长的干扰项"；若某一侧凑不够，
     * 剩下的位置从池子里补（补出来的项长度往往与正确项接近，不构成"唯一最长/最短"）。 */
    const wantRank = Math.floor(rand() * 4);
    const picked = [correct];
    const takeFrom = (arr, n) => {
      let k = 0;
      while (k < n && arr.length) {
        /* 只在最近的 8 个候选里随机，避免每道题都固定抽同一批词 */
        const c = arr.splice(Math.floor(rand() * Math.min(8, arr.length)), 1)[0];
        picked.push({ id: c.id, text: c.text });
        k++;
      }
    };
    takeFrom(longer, wantRank);
    takeFrom(shorter, 3 - wantRank);
    /* 一侧候选不够（正确项极长/极短）：从剩下的候选里补，保证 4 个选项 */
    if (picked.length < 4) {
      for (const c of pool) {
        if (picked.length >= 4) break;
        if (picked.some(x => x.text === c.text)) continue;
        picked.push({ id: c.id, text: c.text });
      }
    }

    const arr = this._shuffle(picked, rand);
    const answerId = correct.id;
    return {
      opts: arr.map(x => x.text),
      answer: arr.findIndex(x => x.id === answerId),
      ids: arr.map(x => x.id),
      answerId,
      promptSenseId: sense.senseId,
    };
  },

  _shuffle(a, rand) {
    const arr = (a || []).slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor((rand || Math.random)() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },
};
/* ---------- 出题义项：词性归一 + 常见义过滤（2026-10-17） ----------
 * 词书 tr 有时只存生僻义（ear → "（稻麦等的）穗"），出题要用"词书+内置词典"合并后的常见义。
 * 这里把词性归一成一类（n/v/adj/…），同一词性的多条释义合成一条，只保留最常见的 2~3 条，
 * 并过滤 "（稻麦等的）""（美俚）" 这类带限定标记的生僻义（避免生僻义成为正确选项）。*/
const QUIZ_POS_ALIAS = {
  n: ['n', 'noun', '名词', '名'],
  v: ['v', 'verb', 'vt', 'vi', 'vti', 'aux', '动词', '动'],
  adj: ['adj', 'adjective', 'a', '形容词', '形'],
  adv: ['adv', 'ad', 'adverb', '副词', '副'],
  prep: ['prep', 'preposition', '介词', '介'],
  pron: ['pron', 'pronoun', '代词', '代'],
  conj: ['conj', 'conjunction', '连词', '连'],
  num: ['num', 'numeral', '数词', '数'],
  int: ['int', 'interj', 'interjection', '感叹词', '叹'],
  art: ['art', 'article', '冠词', '冠'],
};
const QUIZ_POS_LIMIT = { n: 2, v: 2, adj: 2, adv: 2, prep: 2, pron: 2, conj: 2, num: 2, int: 2, art: 2, other: 2 };

function quizPosLabel(key) {
  return ({ n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', pron: 'pron.', conj: 'conj.', num: 'num.', int: 'int.', art: 'art.', abbr: 'abbr.' })[key] || '';
}

/** 选项文本统一格式："n. 秒"；词性未知时只给释义。正确项与干扰项都走这里，保证同构。 */
function quizOptionText(pos, defZh) {
  const def = String(defZh || '').trim();
  const label = quizPosLabel(pos);
  return (label ? label + ' ' : '') + def;
}

function quizPosKey(t) {
  const raw = String(t || '').trim().toLowerCase();
  if (!raw) return 'other';
  const parts = raw.split(/[.．,，;；\/\s]+/).filter(Boolean);
  for (const key of Object.keys(QUIZ_POS_ALIAS)) {
    const aliases = QUIZ_POS_ALIAS[key];
    if (aliases.some(x => raw === x || parts.includes(x))) return key;
  }
  return 'other';
}

/** 同一词性的释义串 → 常见释义串（去限定生僻义，最多取 N 条） */
function commonDefOf(posKey, text) {
  /* 2026-10-25：过滤 "&" 这类解析碎片（"vt.& vi." 会产生 "&；攻击"，旧版选项里可见） */
  const all = String(text || '').split(/[；;]/).map(s => s.trim().replace(/^&+|&+$/g, '').trim())
    .filter(g => g && /[A-Za-z\u4e00-\u9fa5]/.test(g));
  const isRare = g => /^[（(]/.test(g) || /(俚|古|废|罕|讹|人名|地名|商标)/.test(g);
  const common = all.filter(g => !isRare(g));
  const list = common.length ? common : all;
  return list.slice(0, QUIZ_POS_LIMIT[posKey] || 2).join('；') || String(text || '');
}

window.VocabQuiz = VocabQuiz;
if (typeof module !== 'undefined' && module.exports) module.exports = VocabQuiz;
