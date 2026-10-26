/* ============ text-repair.js : 导入文本修复 ============
 *
 * 【要解决的问题】
 * PDF 的文本层是按"字符/字块"排布的，提取出来的中文试卷经常长这样（真实样本，
 * 来自用户导入的四级翻译题，见 tools/check-text-repair.cjs 的夹具）：
 *   "在中国传统文化中，…一种重要礼也 (  e tiq u e tte )  。赠送礼物不
 *    仅是物质的馈赠，…中 国 人 遵 循 “ 礼尚往来”  ( mutually exchanging
 *    courtesies )  的传统，…"
 * 三类损坏：
 *   ① 外文单词被空格拆散：e tiq u e tte → etiquette
 *   ② 汉字之间被插入空格：中 国 人 遵 循 → 中国人遵循；真 题 → 真题
 *   ③ 标点/括号周围多余空格：“ 礼尚往来” / ( x ) / 。 前面有空隙
 * 还有一类是"版面换行"：PDF 的行末断行不是段落边界，直接入库会让一句中文
 * 被拆成多行，AI 切分时也更容易把句子切错。
 *
 * 【为什么自己写而不是直接用某个库】
 * 这类修复是"针对提取损坏的规则"，没有通用库；但**断句**有成熟开源实现：
 * 英文句子边界用 vendored 的 sbd（MIT，见 vendor/sbd/README.md），
 * 中文按全角句末标点切分。TextRepair.sentences() 统一这两个来源。
 *
 * 【安全原则】
 * 只做"由提取错误导致的形态修复"，不做改写：
 *   - 不替换任何汉字（例如把"礼也"猜成"礼仪"——那是模型才该做的事，见 ai.js 的核验提示）
 *   - 不合并英文连字符断行（well-\nknown 可能是真连字符）
 *   - 动过的只有空白与换行；每个规则的触发条件都写明了，避免误伤正常文本
 */
const TextRepair = (() => {
  const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
  const CJK_CLASS = '[' + CJK + ']';
  const CJK_RE = new RegExp(CJK_CLASS);
  const hasCjk = value => CJK_RE.test(String(value || ''));

  /* ---------- ① 外文单词被空格拆散 ---------- */
  /**
   * 把 "e tiq u e tte" 这类碎片拼回 "etiquette"。
   * 触发条件（同时满足，避免误伤正常英文）：
   *   - 至少 2 个碎片是"单字母"（a / A / I 除外，它们是合法单词）
   *   - 碎片中至少有一个长度 ≥ 3（把 "J K" 这种姓名缩写挡在外面）
   *   - 若所有碎片都 ≤ 2 字母，则要求所在行含中文（把 "I am a boy" 这类英文句子挡在外面）
   */
  /* 可选词表校验钩子：由调用方注入（浏览器里可用已加载的词典，
   * 数据修补脚本里用 data/dictionary.min.json）。返回 true 才允许拼接。 */
  let wordChecker = null;
  function setWordChecker(fn) { wordChecker = typeof fn === 'function' ? fn : null; }

  /** 用应用已加载的词典当词表（词典支持屈折还原，答案/answers 这类变形也能命中） */
  function useLoadedDict() {
    try {
      if (typeof Dict !== 'undefined' && Dict && typeof Dict.get === 'function') {
        setWordChecker(word => {
          try { return !!Dict.get(String(word).toLowerCase()); } catch (e) { return null; }
        });
        return true;
      }
    } catch (e) { /* 词典不可用则退回只用单字母证据 */ }
    return false;
  }

  /**
   * 把 "e tiq u e tte" 拼回 "etiquette"。
   *
   * 【为什么不是"整段一起拼"】
   * 匹配到的是"连续短词"，会一路吞到后面的正常单词：
   *   "(e tiq u e tte) is a word" 的片段串是 e|tiq|u|e|tte|is|a|word，
   * 整段拼会得到 "etiquetteisaword"。所以只在**有证据的窗口**内拼接：
   *   ① 有词表（浏览器词典 / 修补脚本的词典）：从左到右找"最长的、拼接后确实是词"的连续子段，
   *      可处理没有孤立单字母的损坏，如 an sw ers → answers；
   *   ② 没有词表：只用"孤立单字母"作证据（正常英文里除了 a/A/I 不会出现孤立字母），
   *      窗口 = 第一个孤立单字母 … 最后一个孤立单字母 + 紧跟其后的一个片段
   *      （"tte" 这类尾巴要带上，否则会拼成 etique）。
   */
  function joinSpacedLatin(line) {
    const text = String(line == null ? '' : line);
    // \b 不能省：否则 "A B C three" 会把 three 截成 thre 一起拼进去
    return text.replace(/\b[A-Za-z]{1,4}\b(?:[ \t]\b[A-Za-z]{1,4}\b)+/g, (run, offset) => {
      const parts = run.split(/[ \t]/);
      if (parts.length < 2) return run;
      // 全是单个大写字母 = 姓名/选项缩写（"A B C"），不是被拆散的单词
      if (parts.every(p => p.length === 1 && /[A-Z]/.test(p))) return run;

      /* 片段紧跟撇号说明它是缩写尾巴（There's 的 s、student's 的 s），
       * 绝不能当拼接起点，否则 "s an" → san、"s own" → sown、"s not" → snot。 */
      const prevChar = offset > 0 ? text.charAt(offset - 1) : '';
      const startsOnContraction = /['’]/.test(prevChar);

      /* 证据一：孤立单字母。正常英文里除 a/A/I 不会出现孤立字母，
       * 窗口 = 第一个孤立单字母 … 最后一个孤立单字母 + 紧跟其后的一个片段
       * （"tte" 这类尾巴要带上，否则会拼成 etique）。*/
      const singletonIdx = [];
      parts.forEach((p, idx) => { if (p.length === 1 && !/^[aAI]$/.test(p)) singletonIdx.push(idx); });
      const singleFrom = singletonIdx.length >= 2 ? singletonIdx[0] : -1;
      const singleTo = singletonIdx.length >= 2
        ? Math.min(parts.length - 1, singletonIdx[singletonIdx.length - 1] + 1) : -1;

      const out = [];
      let i = 0;
      if (startsOnContraction) { out.push(parts[0]); i = 1; }
      while (i < parts.length) {
        let take = 0;
        /* ① 单字母证据优先：不需要词表，也**不能**被词表逻辑抢掉
         *（否则真实损坏样本在启用词表后反而修不好：e tiq u e tte 不再被拼回）。*/
        if (singleFrom >= 0 && i >= singleFrom && singleTo > i) take = singleTo - i + 1;

        /* ② 词表证据：处理没有孤立单字母的损坏（an sw ers → answers）。
         * 只要求"拼起来是词"会把正常英文吃掉（or do → ordo、take up → takeup、
         * re fine → refine），所以还要求窗口里**超过一半**碎片本身不是词。*/
        if (!take && wordChecker) {
          for (let len = Math.min(4, parts.length - i); len >= 2; len--) {
            const window = parts.slice(i, i + len);
            const broken = window.filter(p => wordChecker(p) !== true).length;
            if (broken * 2 <= window.length) continue;
            const candidate = window.join('');
            if (candidate.length >= 3 && wordChecker(candidate) === true) { take = len; break; }
          }
        }

        if (take) { out.push(parts.slice(i, i + take).join('')); i += take; }
        else { out.push(parts[i]); i++; }
      }
      return out.join(' ');
    });
  }

  /* ---------- ② 标点/括号周围的空白 ---------- */
  function tidySpaces(text) {
    let out = String(text == null ? '' : text);
    // 括号内侧：不能有空格（只处理内侧，避免 "word (" 被粘成 "word("）
    // 括号/引号/书名号内侧的空格：括号一律去掉；引号只在后接汉字时去掉
    //（英文里 “ says 这种引号后空格是原文排版，不在修复范围内）
    out = out.replace(/([（(《【[[])[ \t]+/g, '$1').replace(/[ \t]+([）)》】\]])/g, '$1');
    out = out.replace(new RegExp('([“‘])[ \\t]+(?=' + CJK_CLASS + ')', 'g'), '$1');
    out = out.replace(/[ \t]+([”’])/g, '$1');
    // 中文标点前不能有空格；中文标点后接中文时也不能有空格
    out = out.replace(/[ \t]+([，。！？；：、）】》”’…])/g, '$1');
    out = out.replace(new RegExp('([，。！？；：、])[ \\t]+(?=' + CJK_CLASS + ')', 'g'), '$1');
    // 中文与"开括号/引号"之间不留空格（英文语境不受影响：要求前一个字符是汉字）
    out = out.replace(new RegExp('(' + CJK_CLASS + ')[ \\t]+(?=[“《‘【（(])', 'g'), '$1');
    // 闭括号/引号与中文之间不留空格
    out = out.replace(new RegExp('([”’》】）)])[ \\t]+(?=' + CJK_CLASS + ')', 'g'), '$1');
    // 汉字之间的空格：可能是一串（真 题 第 三 套），循环到稳定
    const betweenCjk = new RegExp('(' + CJK_CLASS + ')[ \\t]+(?=' + CJK_CLASS + ')', 'g');
    let prev;
    do { prev = out; out = out.replace(betweenCjk, '$1'); } while (out !== prev);
    // 折叠行内多余空格、去掉行尾空格
    out = out.replace(/[ \t\u00a0]{2,}/g, ' ');
    out = out.replace(/[ \t]+$/gm, '');
    return out;
  }

  /* ---------- ③ 版面换行拼接 ---------- */
  /** 真正的句末标点：只有这些才允许保留换行（，、；：是句中断开，应当接回去） */
  const SENTENCE_END = /[。！？…!?.][”’》】）)"']?[ \t]*$/;
  /** 这些开头的行是标题/题号/新结构，绝不能和上一行拼接 */
  const STRUCTURE_START = /^\s*(?:\d{1,3}\s*[.、)）]|[（(]\s*\d+\s*[)）]|[A-D][.)]|Passage\b|Section\b|Part\b|Directions?\b|Questions?\b|Answer\b|News\b|Conversation\b|W:|M:|答案|参考|写作|翻译|阅读|听力|作文|书面表达|第\s*\d)/i;

  function reflowLines(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const out = [];
    for (const line of lines) {
      if (!line.trim()) { out.push(line); continue; }
      const prev = out.length ? out[out.length - 1] : null;
      const canJoin = prev != null && prev.trim()
        && prev.trim().length >= 8
        && !SENTENCE_END.test(prev)
        && !STRUCTURE_START.test(line);
      if (!canJoin) { out.push(line); continue; }
      const lastChar = prev.trim().slice(-1);
      const firstChar = line.trim().charAt(0);
      // 中文接中文直接拼；其他情况补一个空格，避免把英文单词粘在一起
      const glue = (hasCjk(lastChar) && hasCjk(firstChar)) ? '' : ' ';
      out[out.length - 1] = prev.replace(/[ \t]+$/, '') + glue + line.trim();
    }
    return out.join('\n');
  }

  /* ---------- 对外 API ---------- */
  /** 修复导入文本；只动空白与换行，不替换任何字符 */
  function fix(text) {
    if (text == null) return '';
    let out = String(text).replace(/\r\n?/g, '\n');
    out = tidySpaces(out);
    out = out.split('\n').map(joinSpacedLatin).join('\n');
    out = tidySpaces(out);
    out = reflowLines(out);
    out = tidySpaces(out);
    return out;
  }

  /** 修复前后差异统计：用于导入提示、自检脚本与数据修补 */
  function analyze(before, after) {
    const b = String(before == null ? '' : before);
    const a = String(after == null ? '' : after);
    const count = (s, re) => (s.match(re) || []).length;
    const cjkGap = new RegExp(CJK_CLASS + '[ \\t]+(?=' + CJK_CLASS + ')', 'g');
    const spacedWord = /\b[A-Za-z]{1,4}\b(?:[ \t]\b[A-Za-z]{1,4}\b){1,}/g;
    const punctGap = /[ \t]+[，。！？；：、）】》”’…]|[（(][ \t]+|[ \t]+[）)]/g;
    return {
      changed: a !== b,
      cjkGapsBefore: count(b, cjkGap),
      cjkGapsAfter: count(a, cjkGap),
      spacedWordsBefore: count(b, spacedWord),
      spacedWordsAfter: count(a, spacedWord),
      punctGapsBefore: count(b, punctGap),
      punctGapsAfter: count(a, punctGap),
      linesBefore: b ? b.split('\n').length : 0,
      linesAfter: a ? a.split('\n').length : 0,
    };
  }

  /** sbd（vendored，MIT）：浏览器里挂在 window.tokenizer；Node 测试可挂 global.tokenizer */
  function sbd() {
    if (typeof window !== 'undefined' && window.tokenizer
      && typeof window.tokenizer.sentences === 'function') return window.tokenizer;
    if (typeof tokenizer !== 'undefined' && tokenizer
      && typeof tokenizer.sentences === 'function') return tokenizer;
    return null;
  }

  const fallbackSplit = (text, keepLines) => String(text || '')
    .split(keepLines ? /(?<=[.!?])\s+|\n/ : /(?<=[.!?;])\s+|\n+/)
    .map(s => s.trim()).filter(Boolean);

  /**
   * 断句。英文优先用 sbd（能正确处理 Mr. / e.g. / 引号内句点等缩写），
   * 拿不到 sbd 时退回正则；中文按全角句末标点切分。
   * keepLines=true 时逐行断句（听力对话的角色行不能被合并）。
   */
  function sentences(text, lang, options) {
    const opts = options || {};
    const source = String(text == null ? '' : text).trim();
    if (!source) return [];
    if (lang === 'zh') {
      return source.split(/[。！？；]+/).map(s => s.trim()).filter(Boolean);
    }
    const engine = sbd();
    if (opts.keepLines) {
      const out = [];
      for (const line of source.split('\n')) {
        out.push.apply(out, sentences(line, 'en'));
      }
      return out;
    }
    if (engine) {
      try {
        const result = engine.sentences(source);
        if (Array.isArray(result)) {
          const cleaned = result.map(s => String(s).trim()).filter(Boolean);
          if (cleaned.length) return cleaned;
        }
      } catch (e) { /* 交给正则兜底 */ }
    }
    return fallbackSplit(source, false);
  }

  return {
    VERSION: '1.1',
    fix, analyze, sentences, setWordChecker, useLoadedDict,
    hasCjk,
    _internal: { joinSpacedLatin, tidySpaces, reflowLines },
  };
})();

if (typeof window !== 'undefined') window.TextRepair = TextRepair;
if (typeof module !== 'undefined' && module.exports) module.exports = TextRepair;
