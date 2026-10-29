/* ============ listening-autofill.js : 听力原文 / 题干自动补全 ============
 * 用户需求（2026-10-26 第二轮）：
 *   ① 导入 PDF 后自动识别试卷；② 没有对应英语短文（Tapescript/听力原文）时，
 *   自动上网搜索、核验并导入；③ 同一月份不同套其实是同一套听力时，
 *   自动为未印题干的套卷补全题干，而不是只提示“导入 PDF 上没印”。
 *
 * 【为什么单开一个模块】
 * 四六级官方卷面只印选项、不印题干（题干只在录音里播报），所以“缺题干”是常态，
 * 不是导入失败。补全需要「同套共享 + 联网搜索 + AI 抽取 + 逐字核验」四件事，
 * 放进 views/listening.js 会让这个已经 2000 行的页面更难维护；
 * 这里的纯函数不依赖 DOM/Store/AI，可以在 Node 里直接单测。
 *
 * 【防编造是硬约束】
 * 任何写回页面的原文/题干都必须能追溯：
 *   - 题干来自原文时，必须在原文里**逐字**出现（verifyStemInScript）；
 *   - 题干来自联网页时，AI 必须同时给出该题 4 个选项，且与本卷选项至少 3/4 一致
 *     （applyStemJson），否则整题丢弃；
 *   - 原文来自联网页时，AI 必须给出逐字英文证据句，且切分出的句子大多能在候选正文里找到。
 * 宁可不补，也不许把别的套的题干/编造的句子写进卷子。
 *
 * 运行环境：
 *   - 浏览器/APK：window.ListeningAutoFill（index.html 在 views/listening.js 之前加载）
 *   - Node 自检：module.exports（纯函数 + run/afterImport 注入 stub 即可测）
 * 本文件顶层不得访问 DOM/Store/AI/WebSearch；deps 在调用时解析。
 */
(function () {
  'use strict';

  const PLACEHOLDER_RE = /^(?:question\s*)?\d{1,3}\s*[.、:：)）]?$/i;
  const DIRECTIONS_RE = /^(?:questions?\s*\d+\s*(?:to|[-–—~]|and)\s*\d+\s*(?:are|is)\s+based\s+on|directions?\b|section\s+[abc]\b|part\s+[ivx]+\b)/i;
  const CN_PLACEHOLDER_RE = /(?:卷面未印题干|只在录音中播报|本题题干未印|无题干|题干暂缺)/;
  /* 说话人前缀：兼容联网原文的「轮次号 + 说话人」写法（1M: / 2W： / 1. Woman: / W3:）。
   * 【2026-10-29】再兼容网页把说话人做成徽标的写法「*M*: / [W]: / (M):」：
   * 这类标记剥不掉时会被当成英文单词（"M"），让整行对话混过「≥3 个英文词」的题干门槛，
   * 用户报的假题干「*M*:Thatsoundsamazing.Doyouhavetorelocate?」就是这么来的。
   * 只用于**剥离标记**，不改写原文；行首数字后面没有说话人标记的（如 "1.5 million"）不会匹配。 */
  const SPEAKER_PREFIX_RE = /^\s*(?:\d{1,3}\s*[.、)）\]】:：\-–—]?\s*)?[*\[(（【]?\s*(?:[MWNOQ]|narrator|speaker\s*\d{1,2}|man|woman|male|female)\s*(?:\d{1,2})?\s*[*\])）】]?\s*[:：]\s*/i;
  /* 题干绝不长这样：行首是说话人/轮次标记（原文里的对白行），或整行是多句对话。 */
  const LEAKED_SPEAKER_RE = /^\s*[*\[(（【]?\s*(?:\d{1,3}\s*)?[MWNOQ]\s*[*\])）】]?\s*[:：]/;
  /* 口播题干一定是个问句，且以疑问词/介词短语开头；这只是"顺序兜底"和"裸题号"分支的门槛，
   * 带 "Question 5" 明确标签的不受此限。 */
  const STEM_LEAD_RE = /^(?:what|why|how|where|when|who|whom|whose|which|according\s+to|in\s+what\s+way|for\s+what|to\s+what|on\s+what)\b/i;
  const MIN_ARTICLE = 600;
  const MAX_STEM_LEN = 400;

  /* ---------------- 文本归一化 ---------------- */

  /** 展示无关的归一化：弯引号/破折号/空白统一，用于比对，不用于显示。 */
  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\ufeff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** 比对键：只留字母/数字/中文/撇号，标点全部变空格（逐字核验用）。 */
  function matchKey(value) {
    return normalizeText(value)
      .replace(/[^a-z0-9'\u4e00-\u9fa5]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function wordCount(text) {
    const m = String(text == null ? '' : text).match(/[A-Za-z][A-Za-z'’-]*/g);
    return m ? m.length : 0;
  }

  /** 一整段对白/多句文本：句末标点后还跟着大写开头的句子。
   *  真题干是一句问句（"Why did John leave the sport at just 25?"），
   *  不会出现 "That sounds amazing. Do you have to relocate?" 这种整行对白。 */
  function looksLikeDialogue(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return false;
    if (/\?[^?]*\?/.test(s)) return true;                 // 一行里两个问句
    return /[.!?]["'”’]?\s+["'“‘]?[A-Z]/.test(s);
  }

  function stripSpeaker(label) {
    return String(label == null ? '' : label).replace(SPEAKER_PREFIX_RE, '').trim();
  }

  function lineTextOf(line) {
    if (line == null) return '';
    if (typeof line === 'string') return line;
    return String(line.en != null ? line.en : (line.text != null ? line.text : ''));
  }

  /* ---------------- 篇目结构 ---------------- */

  function questionsOf(paper) {
    return (paper && Array.isArray(paper.qs)) ? paper.qs : [];
  }

  function scriptLinesOf(paper) {
    const arr = (paper && Array.isArray(paper.script)) ? paper.script : [];
    return arr.map(lineTextOf).map(s => String(s || '').trim()).filter(Boolean);
  }

  /** 严格判断“这题没有真实题干”：空、题号、"Question 5"、Directions、中文占位都算缺。 */
  function stemIsPlaceholder(q) {
    const raw = String((q && q.q) || '').trim();
    if (!raw) return true;
    if (PLACEHOLDER_RE.test(raw)) return true;
    if (DIRECTIONS_RE.test(raw)) return true;
    if (CN_PLACEHOLDER_RE.test(raw)) return true;
    if (!/[A-Za-z]{2}/.test(raw)) return true;   // 没有英文单词：题号/中文/空
    return false;
  }

  function stemsComplete(paper) {
    const qs = questionsOf(paper);
    if (!qs.length) return false;
    for (let i = 0; i < qs.length; i++) if (stemIsPlaceholder(qs[i])) return false;
    return true;
  }

  function missingStemIndexes(paper) {
    const qs = questionsOf(paper);
    const out = [];
    for (let i = 0; i < qs.length; i++) if (stemIsPlaceholder(qs[i])) out.push(i);
    return out;
  }

  /** 题干“看起来像真题干”：一句英文问句、至少 3 个英文词、不是 Directions/题号/中文。
   *  【2026-10-29】新增两条拦截（用户报的假题干就卡在这里）：
   *   ① 行首说话人/轮次标记（*M*: / M: / 1M:）——那是原文对白，不是卷面题干；
   *   ② 多句文本——提取时抓到的是整行对白，不是一句题。
   *  宁可少补一题（页面会如实显示仍缺），也不能把对白当题干写进卷子。*/
  function stemLooksReal(text) {
    const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > MAX_STEM_LEN) return false;
    if (LEAKED_SPEAKER_RE.test(raw)) return false;
    if (PLACEHOLDER_RE.test(raw) || DIRECTIONS_RE.test(raw) || CN_PLACEHOLDER_RE.test(raw)) return false;
    if (/^to\s+\d{1,2}\b/i.test(raw) || /\bbased\s+on\b/i.test(raw) && wordCount(raw) < 6) return false;
    if (looksLikeDialogue(raw)) return false;
    return wordCount(raw) >= 3;
  }

  /** 题号推断：题干本身带号 → 用号；标题有 "Questions 5 to 8" → 起始号 + 下标。 */
  function questionNumbers(paper) {
    const qs = questionsOf(paper);
    const title = String((paper && paper.title) || '');
    const rng = title.match(/questions?\s*(\d{1,3})\s*(?:to|[-–—~])\s*(\d{1,3})/i);
    return qs.map((q, i) => {
      const raw = String((q && q.q) || '').trim();
      const m = raw.match(/^(?:question\s*)?(\d{1,3})\s*[.、:：)）]\s*/i);
      if (m) return Number(m[1]);
      if (rng) {
        const start = Number(rng[1]);
        const end = Number(rng[2]);
        if (start + i <= end) return start + i;
      }
      return NaN;
    });
  }

  /* ---------------- 同套听力识别 ---------------- */

  function optionKey(opts) {
    if (!Array.isArray(opts)) return '';
    return opts.map(o => matchKey(o)).join(' ~ ');
  }

  /**
   * 一套听力的指纹：题型 + 题目数 + 每题四个选项（归一化）。
   * 同一套听力被不同套卷/不同来源 PDF 印出来时，选项文本一致 → 指纹相等；
   * 不同听力几乎不可能四套 16 个选项全同。
   */
  function paperAudioKey(paper) {
    if (!paper) return '';
    const qs = questionsOf(paper);
    if (!qs.length) return '';
    const type = normalizeText(paper.type || '');
    return type + '|' + qs.length + '|' + qs.map(q => optionKey(q && q.opts)).join(' || ');
  }

  /** 试卷身份（给 WebSearch 生成搜索词）：type/year/session/setNo/title。 */
  function metaOf(paper) {
    const p = paper || {};
    return {
      type: p.type || '',
      year: p.year || '',
      session: p.session || '',
      setNo: p.setNo || '',
      title: p.title || '',
    };
  }

  function sessionMonth(session) {
    const s = String(session == null ? '' : session).trim();
    return /^\d{1,2}$/.test(s) ? Number(s) : 0;
  }

  /**
   * 找“同一套听力、题干完整”的其它篇目。
   * 只有【指纹相同 + 逐题选项归一化相等】才算同套，避免把相似选项的别套题套上来。
   */
  function findStemDonors(paper, pool) {
    const out = [];
    if (!paper || !Array.isArray(pool)) return out;
    const myKey = paperAudioKey(paper);
    const myQs = questionsOf(paper);
    if (!myKey || !myQs.length) return out;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      if (!cand || cand === paper) continue;
      if (String(cand.id || '') === String(paper.id || '') && paper.id) continue;
      const qs = questionsOf(cand);
      if (qs.length !== myQs.length) continue;
      if (paperAudioKey(cand) !== myKey) continue;
      if (!stemsComplete(cand)) continue;
      /* 逐题再核一次选项：指纹已经保证，这里防未来指纹算法变动引入误配 */
      let same = true;
      for (let k = 0; k < qs.length; k++) {
        if (optionKey(qs[k].opts) !== optionKey(myQs[k].opts)) { same = false; break; }
      }
      if (!same) continue;
      out.push({ paper: cand, setNo: Number(cand.setNo) || 0, stemIdx: missingStemIndexes(paper) });
    }
    out.sort((a, b) => (a.setNo || 99) - (b.setNo || 99));
    return out;
  }

  /**
   * 把 donor 的题干复制到 paper 缺的题上。
   * 只改 q.q，不动选项、不动答案（答案属于本卷答题记录）。
   */
  function copyStemsFromDonor(paper, donor) {
    const qs = questionsOf(paper);
    const dqs = questionsOf(donor);
    let filled = 0;
    for (let i = 0; i < qs.length; i++) {
      if (!stemIsPlaceholder(qs[i])) continue;
      const text = String((dqs[i] && dqs[i].q) || '').trim();
      if (!stemLooksReal(text)) continue;
      qs[i].q = text;
      delete qs[i].stemMissing;
      filled++;
    }
    if (filled) {
      paper.stemSource = 'set';
      paper.stemFromSet = Number(donor && donor.setNo) || null;
      paper.stemFilledAt = new Date().toISOString();
    }
    return { filled: filled, fromSet: Number(donor && donor.setNo) || null };
  }

  /* ---------------- 题干抽取 ---------------- */

  function mappingFor(paper) {
    const qs = questionsOf(paper);
    const nums = questionNumbers(paper);
    const byNo = new Map();
    nums.forEach((n, i) => { if (Number.isFinite(n)) byNo.set(n, i); });
    const firstNum = nums.find(n => Number.isFinite(n));
    const offset = Number.isFinite(firstNum) && firstNum > 1 ? firstNum - 1 : 0;
    return { qs: qs, byNo: byNo, offset: offset, expectedCount: qs.length };
  }

  /**
   * 从原文里抽“口播题干”。
   * 真实 Tapescript 里题干是朗读出来的，常见形式：
   *   Question 5. Why did the man quit his job?
   *   5. Why did the man quit his job?
   *   Q5: Why did the man quit his job?
   * 只接受看起来像题干的文本；Directions / “Questions 5 to 8 are based on” 一律不算。
   */
  function extractStemsFromScript(paper, scriptLines) {
    const map = mappingFor(paper);
    if (!map.expectedCount) return { stems: {}, found: 0 };
    const lines = (Array.isArray(scriptLines) ? scriptLines : []).map(lineTextOf);
    const stems = {};
    const used = new Set();
    /* 【2026-10-29】同一句原文只能当一道题的题干：
     * 候选正文里同一行对白可能出现两遍（正文 + 解析引用），旧实现会把它分别塞给 Q1、Q2，
     * 页面上两题题干一模一样（用户截图就是这么来的）。这里按归一化文本去重，
     * 并且不和卷面上已有的题干重复。*/
    const seen = new Set();
    const existing = new Set();
    map.qs.forEach(function (q) {
      if (!stemIsPlaceholder(q)) existing.add(matchKey(q.q));
    });

    function assign(number, text) {
      let idx = -1;
      if (Number.isFinite(number) && map.byNo.has(number)) idx = map.byNo.get(number);
      else if (Number.isFinite(number) && map.offset && number + map.offset <= map.expectedCount && number >= 1) {
        idx = number + map.offset - 1;                     // 卷内相对题号（1-4 → 5-8）
      } else if (Number.isFinite(number) && number >= 1 && number <= map.expectedCount && !map.byNo.size) {
        idx = number - 1;
      }
      if (idx < 0 || idx >= map.expectedCount || used.has(idx)) return false;
      /* 口播原文里的题干常带「3M:/2W: / *M*:」说话人标记：只用于分角色，不能写进题干（否则会被朗读）。*/
      const clean = stripSpeaker(String(text == null ? '' : text)).replace(/\s+/g, ' ').trim();
      if (!stemLooksReal(clean)) return false;
      const key = matchKey(clean);
      if (!key || seen.has(key) || existing.has(key)) return false;
      stems[idx] = clean;
      seen.add(key);
      used.add(idx);
      return true;
    }

    let sequential = 0;   // 没有题号的行按出现顺序补
    const CJK_RE = /[\u4e00-\u9fa5]/;
    for (let i = 0; i < lines.length; i++) {
      let rawLine = String(lines[i] || '').replace(/\s+/g, ' ').trim();
      if (!rawLine) continue;
      /* 【实站格式】懒笔记/新东方一类页面把题号单独排一行：
       *   5.
       *   Why did the speaker retire so early?
       *   A) …
       * 题号行本身不带题干，必须往下读 1-4 行直到选项/中文/下一题。*/
      const bare = /^(?:question\s*)?(\d{1,3})\s*[.、:：)）]?$/i.exec(rawLine);
      if (bare) {
        const parts = [];
        let consumed = 0;
        for (let j = i + 1; j < lines.length && parts.length < 4; j++) {
          const next = String(lines[j] || '').replace(/\s+/g, ' ').trim();
          if (!next) { if (parts.length) break; consumed++; continue; }
          if (/^[A-Da-d][).、:：]\s*/.test(next)) break;           // 选项开始
          if (/^(?:question\s*)?\d{1,3}\s*[.、:：)）]?$/.test(next)) break;  // 下一题题号
          if (CJK_RE.test(next)) break;                              // 中文翻译/解析
          parts.push(next);
          consumed = j - i;
          if (parts.join(' ').length > 160) break;
        }
        /* 裸题号（只有 "5."）本身不证明下一行是题干：原文页里题号后面也可能跟对白。
         * 只有以疑问词/According to 开头、且是单句时才认。 */
        if (parts.length && STEM_LEAD_RE.test(stripSpeaker(parts[0]))) {
          if (assign(Number(bare[1]), parts.join(' '))) i += Math.max(1, consumed);
        }
        continue;
      }
      let line = rawLine;
      line = stripSpeaker(line);
      if (!line) continue;
      /* 1) "Question 5 ..." / "Q5 ..." —— 有明确标签，文本只要像题干即可 */
      let m = /^(?:question|q)\s*(\d{1,3})\s*[.、:：)）\-—]?\s*(.+)$/i.exec(line);
      const labeled = !!m;
      if (!m) {
        /* 2) "5. ..." / "5) ..." —— 裸题号不可信，必须是一个真正的问句开头 */
        m = /^(\d{1,3})\s*[.、:：)）]\s*(.+)$/.exec(line);
      }
      if (m) {
        const text = String(m[2] || '').trim();
        if (!/^(?:to\s+\d|are based on|is based on)\b/i.test(text)) {
          if (labeled || STEM_LEAD_RE.test(text)) assign(Number(m[1]), text);
        }
        continue;
      }
      /* 3) 单独一行问句且没有题号：按出现顺序补给还没题的。
       * 【2026-10-29】这里最容易把原文对白当题干（"Do you have to relocate?"），
       * 所以只认疑问词/According to 开头的单句。 */
      if (/\?\s*$/.test(line) && STEM_LEAD_RE.test(line) && wordCount(line) >= 3 && !DIRECTIONS_RE.test(line)) {
        while (sequential < map.expectedCount && used.has(sequential)) sequential++;
        if (sequential < map.expectedCount && !stemIsPlaceholder(map.qs[sequential])) {
          sequential++;
          continue;
        }
        if (sequential < map.expectedCount && assign(sequential + 1, line)) sequential++;
      }
    }
    return { stems: stems, found: Object.keys(stems).length };
  }

  /** 逐字核验：标准化（忽略标点/大小写/空白）后 stem 必须是 script 的子串。 */
  function verifyStemInScript(stem, scriptText) {
    const needle = matchKey(stem);
    if (!needle || needle.length < 8) return false;
    const hay = matchKey(scriptText);
    return !!hay && hay.indexOf(needle) >= 0;
  }

  function applyStems(paper, stems, source, extra) {
    const qs = questionsOf(paper);
    let filled = 0;
    Object.keys(stems || {}).forEach(function (k) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= qs.length) return;
      if (!stemIsPlaceholder(qs[i])) return;
      const text = String(stems[k] || '').trim();
      if (!stemLooksReal(text)) return;
      qs[i].q = text;
      delete qs[i].stemMissing;
      filled++;
    });
    if (filled) {
      paper.stemSource = source || 'ai';
      if (extra && extra.fromSet) paper.stemFromSet = extra.fromSet;
      paper.stemFilledAt = new Date().toISOString();
    }
    return filled;
  }

  /**
   * 从多页候选正文里挑“最像该篇”的一页喂给 AI。
   * 打分：该卷题号出现个数 > 说话人标记 > Questions X to Y 标记；分数相同取更长的一页。
   * 不这么做的话，合并后的正文按字符截断，很可能把真正的原文页截掉一半
   *（实测：新东方页 5k + 懒笔记页 100k，合并后 24000 字符只剩开头）。
   */
  function pickBestBlock(blocks, paper) {
    const list = Array.isArray(blocks) ? blocks.filter(b => b && String(b.text || '').trim()) : [];
    if (!list.length) return null;
    const nums = questionNumbers(paper).filter(n => Number.isFinite(n));
    let best = null;
    let bestScore = -1;
    list.forEach(function (block) {
      const text = String(block.text || '');
      let score = 0;
      nums.forEach(function (n) {
        if (new RegExp('(?:^|\\n)\\s*(?:question\\s*)?' + n + '\\s*[.、:：)）]', 'i').test(text)) score += 2;
      });
      score += Math.min(5, (text.match(/(?:^|\n)\s*(?:[WMN])\s*[:：]/gm) || []).length);
      if (/questions?\s*\d+\s*(?:to|[-–—~])\s*\d+/i.test(text)) score += 3;
      if (score > bestScore || (score === bestScore && best && text.length > String(best.text || '').length)) {
        best = block;
        bestScore = score;
      }
    });
    return best;
  }

  /**
   * 从整页正文里截出“该篇”的局部窗口。
   * 真题原文页往往包含整套 25 题（10 万字符），把整页丢给 AI 既超长又会截掉目标篇；
   * 这里从 "Questions 5 to 8" / 第一个题号出现的位置前后取窗口。
   */
  function excerptForQuestions(text, paper, maxLen) {
    const full = String(text == null ? '' : text);
    const limit = Math.max(2000, Math.floor(Number(maxLen) || 18000));
    if (!full) return '';
    if (full.length <= limit) return full;
    const nums = questionNumbers(paper).filter(n => Number.isFinite(n));
    const anchors = [];
    const range = String((paper && paper.title) || '').match(/questions?\s*(\d{1,3})\s*(?:to|[-–—~])\s*(\d{1,3})/i);
    if (range) anchors.push('Questions ' + range[1]);
    nums.forEach(n => anchors.push(String(n) + '.'));
    let at = -1;
    for (let i = 0; i < anchors.length && at < 0; i++) {
      const idx = full.search(new RegExp('(?:^|\\s)' + anchors[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s', 'i'));
      if (idx >= 0) at = idx;
    }
    if (at < 0) return full.slice(0, limit);
    const start = Math.max(0, at - 1500);
    return full.slice(start, start + limit);
  }

  /* ---------------- 联网搜索词 ---------------- */

  const LEVEL_LABEL = { cet6: '六级', cet4: '四级', kaoyan: '考研英语' };
  const LEVEL_EN = { cet6: 'CET6', cet4: 'CET4', kaoyan: 'Postgraduate English Exam' };

  function periodText(meta) {
    const year = Number(meta && meta.year) > 0 ? Number(meta.year) : 0;
    const month = sessionMonth(meta && meta.session);
    return (year ? year + '年' : '') + (month ? month + '月' : '');
  }

  function buildTranscriptQueries(meta) {
    const m = meta || {};
    const web = (typeof window !== 'undefined' && window.WebSearch) || null;
    if (web && typeof web.buildQueries === 'function') {
      try {
        const out = web.buildQueries(m);
        if (Array.isArray(out) && out.length) return out.slice(0, 4);
      } catch (e) { /* 回退到自己的实现 */ }
    }
    const level = LEVEL_LABEL[m.type] || '英语';
    const period = periodText(m);
    const set = Number(m.setNo) > 0 ? '第' + Number(m.setNo) + '套' : '';
    const out = [
      [period, level, '听力原文 Tapescript', set].filter(Boolean).join(' '),
      [period, level, '听力 真题原文', set].filter(Boolean).join(' '),
      [LEVEL_EN[m.type] || '', m.year || '', m.session || '', 'listening transcript'].filter(Boolean).join(' '),
    ];
    return out.filter((q, i, all) => q && all.indexOf(q) === i).slice(0, 3);
  }

  function buildStemQueries(paper) {
    const m = metaOf(paper);
    const level = LEVEL_LABEL[m.type] || '英语';
    const period = periodText(m);
    const nums = questionNumbers(paper).filter(n => Number.isFinite(n));
    const range = nums.length ? (nums[0] + '-' + nums[nums.length - 1]) : '';
    const first = nums.length ? nums[0] : '';
    const out = [
      [period, level, '听力', first ? '第' + first + '题' : '', '题干'].filter(Boolean).join(' '),
      [period, level, '听力原文 题干', range ? '第' + range + '题' : ''].filter(Boolean).join(' '),
      [m.year, sessionMonth(m.session) || '', LEVEL_EN[m.type] || '', 'listening questions', range].filter(Boolean).join(' '),
    ];
    return out.filter((q, i, all) => q && all.indexOf(q) === i).slice(0, 3);
  }

  /* ---------------- 候选原文的结构化门槛 ---------------- */

  function verifyTranscriptMatch(paper, text) {
    const raw = String(text == null ? '' : text);
    const norm = normalizeText(raw);
    const hits = [];
    let score = 0;
    if (norm.length >= MIN_ARTICLE) { score++; hits.push('len'); }
    if (/(?:tapescript|transcript|听力原文|录音原文|听力材料)/i.test(raw)) { score++; hits.push('label'); }
    const qMarks = (raw.match(/\bquestions?\s*\d{1,3}\b/gi) || []).length;
    if (qMarks >= 1) { score++; hits.push('questions:' + qMarks); }
    /* 说话人标记也认「1M: / 2W:」这种带轮次号的写法（lazynote 等来源就是段号 + M/W） */
    const speakerMarks = (raw.match(/(?:^|\n)\s*(?:\d{1,3}\s*)?(?:[WMN]|narrator|speaker\s*\d+)\s*[:：]/gim) || []).length;
    if (speakerMarks >= 2) { score++; hits.push('speakers:' + speakerMarks); }
    if (/(?:conversation|dialogue|passage|lecture|speech|report|news|interview)/i.test(raw)) { score++; hits.push('genre'); }
    const nums = questionNumbers(paper).filter(n => Number.isFinite(n));
    if (nums.length) {
      const allPresent = nums.every(n => new RegExp('(?:question|q)?\\s*' + n + '\\s*[.、:：)）]', 'i').test(raw));
      if (allPresent) { score++; hits.push('all-question-numbers'); }
    }
    return { ok: norm.length >= MIN_ARTICLE && score >= 3, score: score, hits: hits };
  }

  /* ---------------- AI 结果校验 ---------------- */

  function scriptMatchesSource(scriptLines, sourceText) {
    const hay = matchKey(sourceText);
    const all = (Array.isArray(scriptLines) ? scriptLines : []).map(stripSpeaker).map(matchKey).filter(Boolean);
    /* 太短的句子（"Yes." / "OK."）既无法核验也无意义，不计入分母，
     * 否则正常切分会因为几句短应答被判成“对不上”。*/
    const lines = all.filter(line => line.length >= 10);
    if (!hay || !lines.length) return { ok: false, matched: 0, total: 0, ratio: 0 };
    let matched = 0;
    lines.forEach(needle => { if (hay.indexOf(needle) >= 0) matched++; });
    const ratio = matched / lines.length;
    return { ok: lines.length >= 2 && ratio >= 0.6, matched: matched, total: lines.length, ratio: ratio };
  }

  function scriptLinesFromAi(out) {
    const list = Array.isArray(out) ? out : (out && (out.script || out.lines || out.items)) || [];
    if (!Array.isArray(list)) return [];
    return list.map(x => {
      if (typeof x === 'string') return x.trim();
      return String((x && (x.en || x.text || x.line)) || '').trim();
    }).filter(Boolean);
  }

  /**
   * 校验「联网题干」的 AI 输出。
   * 每题必须同时给出与本卷一致的 4 个选项（至少 3/4 归一化相等或高度重叠），
   * 否则说明这段题干属于别的套/别的题，整题拒绝。
   */
  function applyStemJson(out, paper, opts) {
    const options = opts || {};
    const qs = questionsOf(paper);
    const list = Array.isArray(out) ? out : (out && (out.items || out.stems || out.questions)) || [];
    const stems = {};
    let accepted = 0;
    let rejected = 0;
    if (!Array.isArray(list) || !qs.length) return { stems: stems, accepted: 0, rejected: 0 };
    const nums = list.map(x => Number(x && (x.i != null ? x.i : x.index)));
    const oneBased = nums.length > 0 && nums.every(n => Number.isInteger(n)) && nums.indexOf(0) < 0
      && nums.every(n => n >= 1 && n <= qs.length);
    list.forEach(function (item) {
      let i = Number(item && (item.i != null ? item.i : item.index));
      if (!Number.isInteger(i)) { rejected++; return; }
      if (oneBased) i -= 1;
      if (i < 0 || i >= qs.length) { rejected++; return; }
      if (!stemIsPlaceholder(qs[i])) { rejected++; return; }
      /* 同样剥掉「1M:/3W:」这类说话人标记，避免题干被朗读时念出轮次号 */
      const text = stripSpeaker(String((item && (item.stem || item.q || item.text)) || '')).replace(/\s+/g, ' ').trim();
      if (!stemLooksReal(text)) { rejected++; return; }
      if (options.requireOptions !== false) {
        const given = Array.isArray(item && (item.options || item.opts)) ? (item.options || item.opts) : [];
        if (given.length !== 4) { rejected++; return; }
        let same = 0;
        for (let k = 0; k < 4; k++) {
          const a = matchKey(given[k]);
          const b = matchKey((qs[i].opts || [])[k]);
          if (a && b && (a === b || overlapRatio(a, b) >= 0.8)) same++;
        }
        if (same < 3) { rejected++; return; }
      }
      stems[i] = text;
      accepted++;
    });
    return { stems: stems, accepted: accepted, rejected: rejected };
  }

  function overlapRatio(a, b) {
    const A = String(a || '').split(' ').filter(Boolean);
    const B = String(b || '').split(' ').filter(Boolean);
    if (!A.length || !B.length) return 0;
    const setB = new Set(B);
    let hit = 0;
    A.forEach(w => { if (setB.has(w)) hit++; });
    return hit / Math.max(A.length, B.length);
  }

  /* ---------------- 补丁（持久化） ---------------- */

  function readPatches(store) {
    try {
      const d = store && store.d;
      return (d && d.lsnPatch && typeof d.lsnPatch === 'object') ? d.lsnPatch : {};
    } catch (e) { return {}; }
  }

  /** 合并写入：已有 script 不被空值覆盖；stems 逐题合并；返回是否写入。 */
  function writePatch(store, paperId, patch) {
    if (!store || !paperId || !patch) return false;
    try {
      store.d = store.d || {};
      store.d.lsnPatch = store.d.lsnPatch || {};
      const prev = store.d.lsnPatch[paperId] || {};
      const next = Object.assign({}, prev, patch);
      next.stems = Object.assign({}, prev.stems || {}, patch.stems || {});
      if (!patch.script || !patch.script.length) next.script = prev.script;
      next.at = patch.at || new Date().toISOString();
      store.d.lsnPatch[paperId] = next;
      return true;
    } catch (e) { return false; }
  }

  /** 补丁键：导入篇 id；共享副本 id 形如 xxx-shared-2，回退到原 id 的补丁。 */
  function patchFor(patches, id) {
    if (!patches || !id) return null;
    if (patches[id]) return patches[id];
    const base = String(id).replace(/-shared-\d+$/, '');
    return patches[base] || null;
  }

  /**
   * 把补丁应用到篇目数组（原地）。
   * 只在“本来就缺”的地方补：已有原文/题干的绝不覆盖。
   */
  function applyPatches(papers, patches) {
    if (!Array.isArray(papers) || !patches) return 0;
    let changed = 0;
    papers.forEach(function (paper) {
      if (!paper) return;
      const patch = patchFor(patches, String(paper.id || ''));
      if (!patch) return;
      let touched = false;
      if (patch.script && patch.script.length && !scriptLinesOf(paper).length) {
        paper.script = patch.script.map((l, i) => ({ s: i, en: lineTextOf(l) })).filter(l => l.en);
        if (paper.script.length) { paper.scriptSource = patch.scriptSource || 'web'; touched = true; }
      }
      const stems = patch.stems || {};
      Object.keys(stems).forEach(function (k) {
        const i = Number(k);
        const qs = questionsOf(paper);
        if (!Number.isInteger(i) || i < 0 || i >= qs.length) return;
        if (!stemIsPlaceholder(qs[i])) return;
        const text = String(stems[k] || '').trim();
        if (!stemLooksReal(text)) return;
        qs[i].q = text;
        delete qs[i].stemMissing;
        touched = true;
      });
      if (touched) {
        if (patch.stemSource) paper.stemSource = patch.stemSource;
        if (patch.stemFromSet) paper.stemFromSet = patch.stemFromSet;
        paper.autoFilledAt = patch.at || paper.autoFilledAt;
        changed++;
      }
    });
    return changed;
  }

  /* ---------------- 旧数据清洗 ---------------- */

  /** 明显是"原文对白被当成题干"的泄漏文本：行首说话人标记，或一行里两个问句。 */
  function isLeakedStem(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return false;
    if (LEAKED_SPEAKER_RE.test(s)) return true;
    return /\?[^?]*\?/.test(s);
  }

  /**
   * 清理 2026-10-29 之前版本写坏的题干（旧版拿未核验的联网正文抽题干）。
   * 只清「行首 *M*:/M:/1M: 说话人标记」或「一行两个问句」的泄漏；
   * 真实卷面题干（What/Why/How... 单句）不会被误伤（内置 41 道真题干扫描 0 误伤）。
   * - 清 q.q → 页面按"缺题干"显示，并重新触发自动补全（补全逻辑已修复）；
   * - 同时清掉 patch 里的同名条目，避免下次启动又被写回来；
   * - 删掉 stemSource/stemFromSet，避免状态条继续声称"来源：原文口播"。
   * @returns {number} 清掉的题干条数
   */
  function sanitizeStems(papers, patches) {
    let cleared = 0;
    const patchObj = (patches && typeof patches === 'object') ? patches : null;
    (Array.isArray(papers) ? papers : []).forEach(function (paper) {
      if (!paper) return;
      let touched = false;
      questionsOf(paper).forEach(function (q) {
        const raw = String((q && q.q) || '').trim();
        if (!raw || !isLeakedStem(raw)) return;
        q.q = '';
        delete q.stemMissing;
        touched = true;
        cleared++;
      });
      if (!touched) return;
      delete paper.stemSource;
      delete paper.stemFromSet;
      if (patchObj) {
        const id = String(paper.id || '');
        const keys = [id, id.replace(/-shared-\d+$/, '')];
        keys.forEach(function (key) {
          const p = key && patchObj[key];
          if (!p || !p.stems || typeof p.stems !== 'object') return;
          Object.keys(p.stems).forEach(function (k) {
            if (isLeakedStem(p.stems[k])) delete p.stems[k];
          });
          if (!Object.keys(p.stems).length) {
            /* 题干全被清掉：来源标记也必须一起清，否则下次 applyPatches 只补原文时
             * 会把旧的 "stemSource:transcript" 又写回篇目，页面继续声称“来源：原文口播”。*/
            delete p.stems;
            delete p.stemSource;
            delete p.stemFromSet;
          }
        });
      }
    });
    return cleared;
  }

  /* ---------------- deps ---------------- */

  function globalScope() {
    if (typeof window !== 'undefined' && window) return window;
    if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
    return {};
  }

  function resolveDeps(opts) {
    const o = opts || {};
    const g = globalScope();
    const has = k => Object.prototype.hasOwnProperty.call(o, k);
    return {
      webSearch: has('webSearch') ? o.webSearch : (g.WebSearch || null),
      ai: has('ai') ? o.ai : (g.AI || null),
      store: has('store') ? o.store : (g.Store || null),
      onProgress: typeof o.onProgress === 'function' ? o.onProgress : null,
      onPatch: typeof o.onPatch === 'function' ? o.onPatch : null,
      allowNetwork: o.allowNetwork !== false,
      allowAi: o.allowAi !== false,
      timeoutMs: positiveInt(o.timeoutMs, 12000, 3000, 60000),
      aiTimeoutMs: positiveInt(o.aiTimeoutMs, 120000, 10000, 300000),
      pool: Array.isArray(o.pool) ? o.pool : null,
    };
  }

  function positiveInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  function aiReady(ai) {
    return !!ai && ai.ready !== false && typeof ai.jsonRetry === 'function';
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error(message || 'timeout')); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { if (timer) clearTimeout(timer); });
  }

  async function askJson(ai, system, user, opts) {
    const out = await withTimeout(ai.jsonRetry([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], Object.assign({ max: 8000, temp: 0.1, timeout: (opts && opts.aiTimeoutMs) || 120000 }, (opts && opts.aiOpts) || {})),
    (opts && opts.aiTimeoutMs) || 130000, 'AI 请求超时');
    return out;
  }

  /* ---------------- 编排 ---------------- */

  const running = new Set();
  let importTask = null;

  function emptyReport(paper) {
    return {
      paperId: String((paper && paper.id) || ''),
      stemsFilled: 0,
      stemsFrom: '',
      donorSetNo: null,
      scriptAdded: false,
      scriptUrl: '',
      scriptVerdict: '',
      status: 'skipped',
      errors: [],
    };
  }

  function poolOf(deps) {
    if (deps.pool) return deps.pool;
    const g = globalScope();
    try {
      if (g.Dict && g.Dict.content && g.Dict.content.listening) return g.Dict.content.listening.passages || [];
    } catch (e) { /* ignore */ }
    return [];
  }

  function splitTranscriptPrompt(paper, candidateText) {
    const m = metaOf(paper);
    const nums = questionNumbers(paper).filter(n => Number.isFinite(n));
    const clues = questionsOf(paper).map((q, i) => ({
      no: Number.isFinite(nums[i]) ? nums[i] : i + 1,
      options: (q.opts || []).map((o, k) => 'ABCD'[k] + ') ' + String(o || '')),
    }));
    return [
      '你是四六级听力 Tapescript 校对员。下面是从网页检索到的候选文本，以及一份听力试卷信息。',
      '任务：判断候选文本里是否包含这份试卷的听力原文（Tapescript）。',
      '硬性要求：',
      '1) 只有候选文本确实包含该套听力时 match 才为 true；不确定就 false；',
      '2) evidence 必须是候选文本里**逐字出现**的一段英文（≥8 个单词），能证明这段就是该套听力；不得改写、翻译、拼接；',
      '3) 这份试卷可能只包含整套听力中的一部分（例如只有 Question 5-8）：只切出与给定题目对应的那段录音，不要把整份试卷都返回；',
      '4) 若 match=true，把对应段落的听力原文切分成 script 数组，每句/每个说话人一行，去掉 Directions、题号说明、中文注释、页眉页脚；',
      '5) script 每行必须来自候选文本，不得改写句意（可修 OCR 缺空格）；找不到就返回空数组。',
      '只输出 JSON：{"match":true/false,"evidence":"…","script":["…"]}',
      '', '试卷信息：' + JSON.stringify({ type: m.type, year: m.year, session: m.session, setNo: m.setNo, title: m.title, questions: clues }),
      '', '候选文本：', String(candidateText || '').slice(0, 20000),
    ].join('\n');
  }

  function stemFromScriptPrompt(paper, scriptText) {
    const nums = questionNumbers(paper);
    const items = questionsOf(paper).map((q, i) => ({
      i: i,
      no: Number.isFinite(nums[i]) ? nums[i] : i + 1,
      options: (q.opts || []).map((o, k) => 'ABCD'[k] + ') ' + String(o || '')),
    }));
    return [
      '你是四六级听力校对员。四六级听力题干只在录音中播报，很多卷面不印题干。',
      '下面给出听力原文与每题的选项。请找出原文中**朗读出来的题干**（通常是 Question 5. …? 这样的问句）。',
      '硬性要求：',
      '1) stem 必须是原文里**逐字出现**的完整问句（只去掉开头的 Question N / 题号），不得改写、翻译、概括；',
      '2) 原文里确实没有该题题干的，不要输出该题（宁缺勿造）；',
      '3) 只输出 JSON：{"items":[{"i":0,"stem":"…"}]}，i 是题目下标（从 0 开始）。',
      '', '题目：' + JSON.stringify(items),
      '', '听力原文：', String(scriptText || '').slice(0, 16000),
    ].join('\n');
  }

  function stemWebPrompt(paper, numbers, candidateText) {
    const items = questionsOf(paper).map((q, i) => ({
      i: i,
      no: Number.isFinite(numbers[i]) ? numbers[i] : i + 1,
      options: (q.opts || []).map((o, k) => 'ABCD'[k] + ') ' + String(o || '')),
    }));
    return [
      '你是四六级真题校对员。下面是从网页检索到的文本，以及一份听力试卷的题目与选项。',
      '请从候选文本中找出每道题**印刷出来的完整题干**。',
      '硬性要求：',
      '1) stem 必须来自候选文本，不要改写；找不到就整题不输出；',
      '2) 每题必须同时返回该题的 4 个选项（按候选文本里的原文），用于核对是不是同一套题；',
      '3) 选项与给出的选项对不上（错套/错题号）时不要输出该题；',
      '4) 只输出 JSON：{"items":[{"i":0,"stem":"…","options":["…","…","…","…"]}]}，i 是题目下标（从 0 开始）。',
      '', '题目：' + JSON.stringify(items),
      '', '候选文本：', String(candidateText || '').slice(0, 20000),
    ].join('\n');
  }

  /**
   * 单篇自动补全：同套共享 → 联网原文 → 原文章节抽题干 → 联网抽题干。
   * 不抛异常；任何一步失败都记录 errors 并继续。
   */
  async function run(paper, opts) {
    const report = emptyReport(paper);
    if (!paper || !questionsOf(paper).length) { report.status = 'skipped'; report.errors.push('没有题目，无法补全'); return report; }
    const deps = resolveDeps(opts);
    if (running.has(String(paper.id))) return Object.assign(report, { status: 'partial', errors: ['已有补全任务在执行'] });
    running.add(String(paper.id));
    const started = Date.now();
    const progress = msg => { try { if (deps.onProgress) deps.onProgress(msg, paper); } catch (e) { /* ignore */ } };
    const patch = {};
    let changed = false;
    let aiSourceText = '';   // 本次检索到的最像该篇的正文窗口（供 AI 与逐字核验共用）
    let verifiedSource = ''; // 只有「结构化门槛 + AI 逐字证据 + 切分校验」全过的正文才能当原文/题干来源
    try {
      const hadScript = scriptLinesOf(paper).length > 0;
      /* 1) 同套共享：不花钱、立即生效，优先做 */
      if (!stemsComplete(paper)) {
        const donors = findStemDonors(paper, poolOf(deps));
        if (donors.length) {
          progress('发现同套听力（第 ' + (donors[0].setNo || '?') + ' 套），正在复用题干…');
          const copied = copyStemsFromDonor(paper, donors[0].paper);
          if (copied.filled) {
            report.stemsFilled += copied.filled;
            report.stemsFrom = 'set';
            report.donorSetNo = copied.fromSet;
            report.status = 'partial';
            const qs = questionsOf(paper);
            const stems = {};
            missingStemIndexes(paper).forEach(function () { /* 已无缺 */ });
            qs.forEach(function (q, i) { if (!stemIsPlaceholder(q)) stems[i] = q.q; });
            patch.stems = stems;
            patch.stemSource = 'set';
            if (copied.fromSet) patch.stemFromSet = copied.fromSet;
            changed = true;
          }
        }
      }

      /* 2) 联网补原文 */
      if (!scriptLinesOf(paper).length && deps.allowNetwork && deps.webSearch && aiReady(deps.ai)) {
        progress('正在联网检索听力原文…');
        const meta = metaOf(paper);
        let collected = null;
        try {
          /* 2a) 先直连已知原文站（按 年-月-套号 拼 URL，2026-10-29）。
           * 实网：懒笔记的 2025-06 第 1 套原文页仍在，但四个搜索引擎当期分别被
           * 广告页/无关 docx/登录墙占位，纯搜索召回不到 → 原文补不进来。
           * 直连页同样必须过 verifyTranscriptMatch 门槛，过不了再回退搜索。*/
          if (typeof deps.webSearch.collectDirectTranscript === 'function') {
            try {
              progress('正在直连原文站…');
              const direct = await withTimeout(deps.webSearch.collectDirectTranscript(meta, {
                timeoutMs: deps.timeoutMs, maxUrls: 4,
                requireMatch: /(?:听力|六级|四级|CET|tapescript|transcript|listening|questions?\s*\d)/i,
              }), 45000, '直连原文站超时');
              if (direct && String(direct.text || '').trim()) {
                const directVerdict = verifyTranscriptMatch(paper, direct.text);
                if (directVerdict.ok) {
                  collected = direct;
                } else {
                  report.errors.push('verify: 直连原文页不像该套 Tapescript（' + directVerdict.hits.join(',') + '）');
                }
              }
            } catch (e) {
              report.errors.push('web: 直连原文站失败（' + shortError(e) + '）');
            }
          }
          /* 2b) 直连没拿到可用正文 → 走搜索引擎多引擎回退 */
          if (!collected) {
          /* 中文环境 Bing 对长尾真题词召回差，按 百度 → 搜狗 → 360 → Bing 回退；
           * WebSearch 默认只跑 Bing，这里显式给多引擎列表（单引擎失败才换下一个）。*/
          /* 实网结论（2026-10-26）：宽搜索词下 Bing 反而最准（懒笔记/新东方整页原文），
           * 百度前几条多是文库 403 预览，搜狗/360 要跟一层脚本跳转。Bing 打头、其余兜底。*/
          const engines = ['bing', 'baidu', 'sogou', 'so360'];
          const search = typeof deps.webSearch.collectTranscriptText === 'function'
            ? deps.webSearch.collectTranscriptText(meta, {
              /* 实网（2026-10-26）：百度前 3 条常是文库 403/带水印预览，
               * 完整 Tapescript 往往在第 4-6 条（新东方/可可英语），所以多抓几页。*/
              maxQueries: 2, maxPages: 6, maxTries: 12, engines: engines, timeoutMs: deps.timeoutMs,
              requireMatch: /(?:听力|六级|四级|CET|tapescript|transcript|listening|questions?\s*\d)/i,
            })
            : null;
          if (search) {
            collected = await withTimeout(search, 90000, '联网检索超时');
          } else if (typeof deps.webSearch.searchWeb === 'function') {
            const found = await withTimeout(deps.webSearch.searchWeb(buildTranscriptQueries(meta), {
              maxQueries: 2, maxPages: 4, timeoutMs: deps.timeoutMs,
            }), 90000, '联网检索超时');
            const list = (found && found.results) || [];
            collected = {
              text: list.map(r => String(r && r.text || '')).filter(Boolean).join('\n\n'),
              sources: list.map(r => ({ url: r && r.url, len: String(r && r.text || '').length })),
              errors: (found && found.errors) || [],
            };
          }
          }
          if (!collected || !String(collected.text || '').trim()) {
            report.errors.push('web: 没有检索到可用网页');
          } else {
            const blocks = (collected && Array.isArray(collected.blocks)) ? collected.blocks : [];
            const best = pickBestBlock(blocks, paper);
            const pageText = (best && best.text) ? String(best.text) : String(collected.text || '');
            aiSourceText = excerptForQuestions(pageText, paper, 18000) || pageText;
            const verdict = verifyTranscriptMatch(paper, collected.text || pageText);
            if (!verdict.ok) {
              report.errors.push('verify: 检索到的文本不像该套 Tapescript（' + verdict.hits.join(',') + '）');
            } else {
              progress('正在核验原文（AI 逐字证据）…');
              const out = await askJson(deps.ai,
                '你只输出合法 JSON，不要 markdown。宁可判 false，也不要把别的套材料当成本套。',
                splitTranscriptPrompt(paper, aiSourceText || pageText), deps);
              const evidence = String((out && out.evidence) || '').trim();
              const script = scriptLinesFromAi(out);
              const evidenceOk = !!evidence && verifyStemInScript(evidence, aiSourceText || pageText);
              const scriptOk = scriptMatchesSource(script, aiSourceText || pageText);
              if (out && out.match && evidenceOk && scriptOk.ok) {
                paper.script = script.map((en, i) => ({ s: i, en: en }));
                const sources = (collected.sources || []).filter(s => s && s.url);
                paper.scriptSource = 'web';
                paper.scriptUrl = sources.length ? String(sources[0].url) : '';
                paper.scriptVerdict = 'ai-verified';
                patch.script = paper.script.map(l => ({ s: l.s, en: l.en }));
                patch.scriptSource = 'web';
                patch.scriptUrl = paper.scriptUrl;
                patch.scriptVerdict = 'ai-verified';
                report.scriptAdded = true;
                report.scriptUrl = paper.scriptUrl;
                report.scriptVerdict = 'ai-verified';
                report.status = 'partial';
                changed = true;
                /* 这份正文已核验为本篇 Tapescript，是后面抽题干的唯一联网依据 */
                verifiedSource = aiSourceText || pageText;
                progress('已补入听力原文（' + script.length + ' 句，来源 ' + (paper.scriptUrl || '网页') + '）');
              } else if (out && out.match && !scriptOk.ok) {
                report.errors.push('verify: AI 切分出的原文与候选正文对不上（' + scriptOk.matched + '/' + scriptOk.total + '）');
              } else if (out && out.match && !evidenceOk) {
                report.errors.push('verify: AI 证据句未能在候选正文中逐字找到');
              } else {
                report.errors.push('ai: 核验判定候选文本不是该套听力原文');
              }
            }
          }
        } catch (e) {
          report.errors.push('web: ' + shortError(e));
        }
      } else if (!scriptLinesOf(paper).length) {
        report.errors.push(deps.allowNetwork ? 'ai: AI 未配置，无法核验联网原文' : 'web: 已关闭联网补全');
      }

      /* 3) 题干：先原文口播（确定性），再 AI 逐字抽取 */
      if (!stemsComplete(paper)) {
        const scriptText = scriptLinesOf(paper).join('\n');
        /* 题干优先从“检索到的整页正文”里找：AI 切分 script 时按设计去掉了题号说明与题干，
         * 只拿 script 会永远找不到口播题干。没有联网正文时才退回 script。
         * 【2026-10-29 关键修复】只能用**已核验**的联网正文（verifiedSource）：
         * 原文核验失败时 aiSourceText 仍然拿着一份未核验的候选页，旧实现拿它抽题干，
         * 于是把原文对白 "*M*:Thatsoundsamazing.Doyouhavetorelocate?" 写成"原文口播题干"，
         * 页面还显示"题干已齐全（来源：原文口播）"——同一份内容却既没原文又成了题干。
         * 未核验的正文一律不参与题干抽取（宁缺勿造）。*/
        const stemSource = verifiedSource || scriptText;
        if (stemSource) {
          progress('正在从原文提取题干…');
          const local = extractStemsFromScript(paper, stemSource.split('\n'));
          if (local.found) {
            const filled = applyStems(paper, local.stems, 'transcript');
            if (filled) {
              report.stemsFilled += filled;
              report.stemsFrom = report.stemsFrom || 'transcript';
              patch.stems = Object.assign({}, patch.stems || {}, pickStems(paper));
              patch.stemSource = 'transcript';
              changed = true;
              report.status = 'partial';
            }
          }
          if (!stemsComplete(paper) && deps.allowAi && aiReady(deps.ai)) {
            try {
              const out = await askJson(deps.ai,
                '你只输出合法 JSON。题干必须逐字来自原文，禁止编造；找不到就不输出。',
                stemFromScriptPrompt(paper, stemSource), deps);
              const list = (out && (out.items || out.stems || out.questions)) || [];
              const stems = {};
              const indexList = (Array.isArray(list) ? list : []).map(function (item) {
                return Number(item && (item.i != null ? item.i : item.index));
              });
              /* AI 偶尔按 1..n 编号：全部落在 1..n 且没有 0 时统一减 1 */
              const oneBased = indexList.length > 0
                && indexList.every(n => Number.isInteger(n))
                && indexList.indexOf(0) < 0
                && indexList.every(n => n >= 1 && n <= questionsOf(paper).length);
              (Array.isArray(list) ? list : []).forEach(function (item) {
                let i = Number(item && (item.i != null ? item.i : item.index));
                if (!Number.isInteger(i)) return;
                if (oneBased) i -= 1;
                const text = String((item && (item.stem || item.q || item.text)) || '').trim();
                if (!stemLooksReal(text)) return;
                if (!verifyStemInScript(text, stemSource)) return;   // 防编造
                stems[i] = text;
              });
              const filled = applyStems(paper, stems, 'ai');
              if (filled) {
                report.stemsFilled += filled;
                report.stemsFrom = report.stemsFrom || 'ai';
                patch.stems = Object.assign({}, patch.stems || {}, pickStems(paper));
                patch.stemSource = 'ai';
                changed = true;
                report.status = 'partial';
              }
            } catch (e) {
              report.errors.push('ai: 原文抽题干失败（' + shortError(e) + '）');
            }
          }
        }
      }

      /* 4) 仍然缺题干 → 联网搜题干（必须过选项一致性校验） */
      if (!stemsComplete(paper) && deps.allowNetwork && deps.webSearch && aiReady(deps.ai)) {
        progress('正在联网检索题干…');
        try {
          const queries = buildStemQueries(paper);
          const keywords = [];
          questionsOf(paper).forEach(q => (q.opts || []).forEach(o => {
            String(o || '').split(/\s+/).forEach(w => { if (w.length >= 5) keywords.push(w); });
          }));
          const found = await withTimeout(deps.webSearch.searchWeb(queries, {
            maxQueries: 2, maxPages: 4, maxTries: 10, timeoutMs: deps.timeoutMs,
            keywords: keywords.slice(0, 40),
            engines: ['bing', 'baidu', 'sogou', 'so360'],
          }), 90000, '联网检索超时');
          const list = (found && found.results) || [];
          const text = list.map(r => String(r && r.text || '')).filter(Boolean).join('\n\n');
          if (!text) {
            report.errors.push('web: 没搜到题干候选页');
          } else {
            const out = await askJson(deps.ai,
              '你只输出合法 JSON。题干必须来自候选文本；选项对不上就不要输出该题。',
              stemWebPrompt(paper, questionNumbers(paper), text), deps);
            let judged = applyStemJson(out, paper, {});
            /* 额外逐字校验：题干必须在候选正文里出现 */
            const verified = {};
            Object.keys(judged.stems).forEach(function (k) {
              if (verifyStemInScript(judged.stems[k], text)) verified[k] = judged.stems[k];
              else judged.rejected += 1;
            });
            const filled = applyStems(paper, verified, 'web');
            if (filled) {
              report.stemsFilled += filled;
              report.stemsFrom = report.stemsFrom || 'web';
              patch.stems = Object.assign({}, patch.stems || {}, pickStems(paper));
              patch.stemSource = 'web';
              changed = true;
              report.status = 'partial';
            } else if (!judged.accepted) {
              report.errors.push('verify: 联网题干与本题选项不一致，已拒绝');
            }
          }
        } catch (e) {
          report.errors.push('web: 联网抽题干失败（' + shortError(e) + '）');
        }
      }

      /* 4.5) 已经补到完整 → done */
      if (stemsComplete(paper) && scriptLinesOf(paper).length) report.status = 'done';
      else if (report.stemsFilled || report.scriptAdded) report.status = 'partial';

      /* 5) 持久化 */
      if (changed) {
        patch.at = new Date().toISOString();
        if (deps.store) writePatch(deps.store, String(paper.id || ''), patch);
        if (deps.onPatch) {
          try { deps.onPatch(paper, patch); } catch (e) { report.errors.push('save: ' + shortError(e)); }
        }
      }
    } catch (e) {
      report.status = 'failed';
      report.errors.push('fatal: ' + shortError(e));
    } finally {
      running.delete(String(paper.id));
      report.elapsedMs = Date.now() - started;
    }
    return report;
  }

  function pickStems(paper) {
    const out = {};
    questionsOf(paper).forEach(function (q, i) { if (!stemIsPlaceholder(q)) out[i] = q.q; });
    return out;
  }

  function shortError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    if (error.name === 'AbortError') return 'timeout';
    return String(error.message || error).slice(0, 160);
  }

  /**
   * 导入后批量补全：串行（避免同时打爆网络/AI），不抛异常。
   * opts.onProgress(msg, paper) / opts.onResult(report, paper)。
   */
  function afterImport(papers, opts) {
    const list = (Array.isArray(papers) ? papers : []).filter(function (p) {
      if (!p || !questionsOf(p).length) return false;
      if (p.type !== 'cet4' && p.type !== 'cet6') return false;
      return !scriptLinesOf(p).length || !stemsComplete(p);
    });
    if (!list.length) return Promise.resolve({ busy: false, papers: 0, scriptAdded: 0, stemsFilled: 0, failed: 0, reports: [] });
    if (importTask) return Promise.resolve({ busy: true, papers: 0, scriptAdded: 0, stemsFilled: 0, failed: 0, reports: [] });
    const options = opts || {};
    importTask = (async function () {
      const summary = { busy: false, papers: 0, scriptAdded: 0, stemsFilled: 0, failed: 0, reports: [] };
      for (let i = 0; i < list.length; i++) {
        const paper = list[i];
        summary.papers++;
        let report;
        try {
          report = await run(paper, options);
        } catch (e) {
          report = Object.assign(emptyReport(paper), { status: 'failed', errors: [shortError(e)] });
        }
        summary.reports.push(report);
        if (report.scriptAdded) summary.scriptAdded++;
        summary.stemsFilled += report.stemsFilled || 0;
        if (report.status === 'failed') summary.failed++;
        if (typeof options.onResult === 'function') {
          try { options.onResult(report, paper); } catch (e) { /* ignore */ }
        }
      }
      return summary;
    })().finally(function () { importTask = null; });
    return importTask;
  }

  /* ---------------- 导出 ---------------- */

  const ListeningAutoFill = {
    // 纯函数
    normalizeText: normalizeText,
    matchKey: matchKey,
    stemIsPlaceholder: stemIsPlaceholder,
    stemLooksReal: stemLooksReal,
    stemsComplete: stemsComplete,
    missingStemIndexes: missingStemIndexes,
    questionNumbers: questionNumbers,
    paperAudioKey: paperAudioKey,
    metaOf: metaOf,
    findStemDonors: findStemDonors,
    copyStemsFromDonor: copyStemsFromDonor,
    extractStemsFromScript: extractStemsFromScript,
    verifyStemInScript: verifyStemInScript,
    buildTranscriptQueries: buildTranscriptQueries,
    buildStemQueries: buildStemQueries,
    verifyTranscriptMatch: verifyTranscriptMatch,
    scriptMatchesSource: scriptMatchesSource,
    pickBestBlock: pickBestBlock,
    excerptForQuestions: excerptForQuestions,
    applyStemJson: applyStemJson,
    readPatches: readPatches,
    writePatch: writePatch,
    applyPatches: applyPatches,
    sanitizeStems: sanitizeStems,
    isLeakedStem: isLeakedStem,
    // 编排
    run: run,
    afterImport: afterImport,
  };

  if (typeof window !== 'undefined' && window) window.ListeningAutoFill = ListeningAutoFill;
  if (typeof module !== 'undefined' && module.exports) module.exports = ListeningAutoFill;
})();
