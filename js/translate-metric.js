/* ============ translate-metric.js : 翻译对齐度量 + 本地兜底评分 ============
 *
 * 【为什么需要这个文件】
 * 1. 有参考译文的题目（单句练习、带参考答案的自定义题）此前只把参考译文交给 AI
 *    "仅供参考"，评分完全依赖模型；模型给虚高/虚低分时，没有任何独立的量可以对照。
 * 2. 未配置 AI 时翻译模块整块不可用（AI.gradeTranslation 直接返回失败），
 *    写作侧却有 LocalAI 兜底。翻译的兜底需要一个"不依赖模型"的客观量。
 * 3. 考研英语一要求翻译 5 个编号句子，"只译一句"在旧逻辑里没有任何完整性门槛
 *    （写作侧有 capIncompleteEssayScore，翻译侧只有字段合法性校验）。
 *
 * 【chrF 的来源与授权】
 * 本文件的 chrF / chrF++ 计算逻辑移植自开源项目 sacrebleu（Apache-2.0）：
 *   https://github.com/mjpost/sacrebleu
 *   commit c596d9d2072a8f84200574a7a5c56c618e8d37e8（2026-08-20）
 *   上游文件：sacrebleu/metrics/chrf.py、sacrebleu/metrics/helpers.py
 *   上游副本与许可证：vendor/sacrebleu/（含 LICENSE.txt）
 * 移植时的逐条差异（避免"看起来一样其实不一样"）：
 *   - Python str 按码点切分；JS 字符串是 UTF-16 码元，直接切片在 emoji 等
 *     代理对上会与上游不一致。这里统一用 Array.from 转码点数组后再取 n-gram。
 *   - Python ''.join(line.split()) 去空白 → JS replace(/\s+/gu,'')，两者都覆盖全角空格。
 *   - 默认参数与上游 CHRF 类一致：char_order=6、word_order=0（chrF++ 取 2）、
 *     beta=2、lowercase=false、whitespace=false、eps_smoothing=false
 *     （即 sacreBLEU ≥ 2.0 的 effective-order 平滑）。
 *   - 多参考时取 F 值最高的那条，与上游 _compute_segment_statistics 一致。
 *
 * 【本文件里哪些不是上游逻辑】
 * 下方 LIMITS 段与 coverage()/localGrade()/align()/scaleScore() 全部是本项目
 * 为"学习打分"场景自行定义的启发式规则，与 sacrebleu 无关，阈值逐条注明依据。
 */
const TranslateMetric = (() => {
  /* ================= 一、chrF 移植（sacrebleu, Apache-2.0） ================= */
  const PUNCTS = new Set(Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_\`{|}~'));
  const EPS = 1e-16;

  /** 统一按 Unicode 码点切分，等价于 Python 的 str 索引 */
  const toCodePoints = value => Array.from(String(value == null ? '' : value));
  /** 去空白：等价于 Python ''.join(line.split()) */
  const stripWhitespace = value => String(value == null ? '' : value).replace(/\s+/gu, '');

  function counterFrom(list) {
    const map = new Map();
    for (const gram of list) map.set(gram, (map.get(gram) || 0) + 1);
    return map;
  }

  /** 等价 extract_all_char_ngrams：返回 1..maxOrder 每个阶数的计数表 */
  function extractAllCharNgrams(line, maxOrder, includeWhitespace) {
    const raw = String(line == null ? '' : line);
    const cps = toCodePoints(includeWhitespace ? raw : stripWhitespace(raw));
    const counters = [];
    for (let n = 1; n <= maxOrder; n++) {
      const grams = [];
      for (let i = 0; i + n <= cps.length; i++) grams.push(cps.slice(i, i + n).join(''));
      counters.push(counterFrom(grams));
    }
    return counters;
  }

  /** 等价 extract_word_ngrams */
  function extractWordNgrams(tokens, n) {
    const grams = [];
    for (let i = 0; i + n <= tokens.length; i++) grams.push(tokens.slice(i, i + n).join(' '));
    return counterFrom(grams);
  }

  const splitWords = line => {
    const s = String(line == null ? '' : line).trim();
    return s ? s.split(/\s+/u) : [];
  };

  /** 等价 CHRF._remove_punctuation：把词首/词尾标点拆成独立 token */
  function removePunctuation(sent) {
    const out = [];
    for (const word of splitWords(sent)) {
      const cps = toCodePoints(word);
      if (cps.length === 1) { out.push(word); continue; }
      const last = cps[cps.length - 1];
      if (PUNCTS.has(last)) out.push(cps.slice(0, -1).join(''), last);
      else if (PUNCTS.has(cps[0])) out.push(cps[0], cps.slice(1).join(''));
      else out.push(word);
    }
    return out;
  }

  /** 等价 _get_match_statistics：[hyp 计数, ref 计数, 命中计数] */
  function matchStatistics(hypNgrams, refNgrams) {
    let match = 0, hypCount = 0, refCount = 0;
    for (const [gram, count] of hypNgrams) {
      hypCount += count;
      const inRef = refNgrams.get(gram);
      if (inRef !== undefined) match += Math.min(count, inRef);
    }
    for (const count of refNgrams.values()) refCount += count;
    // 上游：参考侧该阶没有 n-gram 时不把命中算作正确（hyp_count if ref_ngrams else 0）
    return [refNgrams.size ? hypCount : 0, refCount, match];
  }

  /** 等价 _compute_f_score：返回 0–100 */
  function fScore(statistics, order, beta, epsSmoothing) {
    const factor = beta * beta;
    let score = 0, effectiveOrder = 0, avgPrec = 0, avgRec = 0;
    for (let i = 0; i < order; i++) {
      const nHyp = statistics[3 * i], nRef = statistics[3 * i + 1], nMatch = statistics[3 * i + 2];
      const prec = nHyp > 0 ? nMatch / nHyp : EPS;
      const rec = nRef > 0 ? nMatch / nRef : EPS;
      const denom = factor * prec + rec;
      score += denom > 0 ? ((1 + factor) * prec * rec / denom) : EPS;
      if (nHyp > 0 && nRef > 0) { avgPrec += prec; avgRec += rec; effectiveOrder++; }
    }
    if (!order) return 0;
    if (epsSmoothing) return 100 * score / order;
    if (effectiveOrder === 0) { avgPrec = avgRec = 0; }
    else { avgPrec /= effectiveOrder; avgRec /= effectiveOrder; }
    if (avgPrec + avgRec) return 100 * ((1 + factor) * avgPrec * avgRec) / ((factor * avgPrec) + avgRec);
    return 0;
  }

  function normalizeOpts(opts) {
    const o = opts || {};
    return {
      charOrder: o.charOrder == null ? 6 : Number(o.charOrder),
      wordOrder: o.wordOrder == null ? 0 : Number(o.wordOrder),
      beta: o.beta == null ? 2 : Number(o.beta),
      lowercase: !!o.lowercase,
      whitespace: !!o.whitespace,
      epsSmoothing: !!o.epsSmoothing,
    };
  }

  /** chrF(++) 主入口：hyp 与 ref 的相似度，0–100 */
  function chrf(hypothesis, reference, opts) {
    const o = normalizeOpts(opts);
    const order = o.charOrder + o.wordOrder;
    if (order <= 0) return 0;
    const prep = s => {
      const text = String(s == null ? '' : s);
      return o.lowercase ? text.toLowerCase() : text;
    };
    const hyp = prep(hypothesis), ref = prep(reference);
    const hypNgrams = extractAllCharNgrams(hyp, o.charOrder, o.whitespace);
    const refNgrams = extractAllCharNgrams(ref, o.charOrder, o.whitespace);
    if (o.wordOrder > 0) {
      const hypWords = removePunctuation(hyp), refWords = removePunctuation(ref);
      for (let n = 1; n <= o.wordOrder; n++) {
        hypNgrams.push(extractWordNgrams(hypWords, n));
        refNgrams.push(extractWordNgrams(refWords, n));
      }
    }
    const stats = [];
    for (let i = 0; i < order; i++) stats.push(...matchStatistics(hypNgrams[i], refNgrams[i]));
    return fScore(stats, order, o.beta, o.epsSmoothing);
  }

  /** 多参考：取最高分（等价上游 best over references） */
  function chrfMulti(hypothesis, references, opts) {
    const list = (references || []).filter(r => String(r == null ? '' : r).trim());
    if (!list.length) return 0;
    return Math.max(...list.map(ref => chrf(hypothesis, ref, opts)));
  }

  /* ================= 二、完整性检查（本项目启发式） ================= */
  /* 阈值依据：考研英语一翻译为 5 个编号句（每句 2 分，共 10 分），
   * 英语二为一段（15 分）。"只译一句却拿到大半分"是旧逻辑最明显的问题，
   * 因此这里把"句数覆盖"和"长度地板"作为两个独立信号，且都取保守阈值——
   * 只在**明显**不完整时触发，正常意译（句子切分不同、语序调整）不受影响。*/
  const LIMITS = {
    // 长度地板：answer 去空白长度 / source 去空白长度，低于该值视为未完成
    lenFloor: { en2cn: 0.35, cn2en: 0.35 },
    // chrF → 得分率线性映射：ratio = bias + slope × chrF，再乘完整性系数
    bias: 0.15, slope: 0.0085,
    // 对齐校正：相似度极低而 AI 给分很高时才压制（避免误伤合理意译）
    lowChrf: 25, highScoreRatio: 0.6, lowChrfCapRatio: 0.5,
    // 参考译文短于该字符数时 chrF 波动过大，不做对齐校正
    minReferenceLength: 6,
  };

  const clamp01 = value => Math.max(0, Math.min(1, value));

  /* ---------------- 翻译题字段解析（必须与界面一致） ---------------- */
  /**
   * 取翻译题的"原文"。
   * 优先级：translationText（原文正文）→ prompt → title → en/cn。
   *
   * 【踩过的坑，别再改回去】这里曾经是 prompt 优先，而导入的整篇题里
   * prompt 存的是**考试说明**（"Part IV Translation (30 minutes) Directions: ..."），
   * 于是模型收到的是说明而不是原文，给出的评语正是：
   *   "本次材料中的'中文原句'仅呈现考试说明，未包含待翻译的中文段落……四维均暂记 0 分"。
   * 界面一直按 translationText 优先显示，两边口径不一致就是那次 0 分的根因。
   */
  function sourceOf(task) {
    const t = task || {};
    return t.translationText || t.prompt || t.title || t.en || t.cn || '';
  }

  /* ---------------- 语种与翻译方向判定（本项目自定义） ---------------- */
  /**
   * 判断文本主体是中文还是英文：比"汉字数"与"拉丁字母数"。
   * 中文一个字的信息量约等于英文好几个字母，所以按字符数直接比就够用；
   * 数字/符号为主的材料返回 'unknown'，由调用方决定默认值。
   */
  function script(text) {
    const s = String(text == null ? '' : text);
    const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    if (!cjk && !latin) return 'unknown';
    return cjk >= latin ? 'zh' : 'en';
  }

  /**
   * 由**源文语种**判断翻译方向：源文是英文 → 英译汉(en2cn)；源文是中文 → 汉译英(cn2en)。
   * 【为什么必须有这个】真题翻译里既有英译汉（考研英语）也有汉译英（四级中译英），
   * 旧逻辑一律按英译汉打分，于是中文原卷的题会被要求给出中文参考译文——
   * 模型按题目实际方向给出英文参考译文，反而被语言校验判为不合格，
   * 用户看到的现象就是"我输入了，AI 不能评价"。
   */
  function directionOf(source) {
    const s = script(source);
    if (s === 'zh') return 'cn2en';
    if (s === 'en') return 'en2cn';
    return null;
  }

  /** 中/英分句：只用于"数句子"，不追求语言学精确 */
  function splitSentences(text, lang) {
    const clean = String(text == null ? '' : text).replace(/\r/g, '').trim();
    if (!clean) return [];
    if (lang !== 'zh' && typeof TextRepair !== 'undefined' && TextRepair
      && typeof TextRepair.sentences === 'function') {
      /* 英文断句交给带缩写规则的实现（vendored sbd）：正则会把 "Mr." 当成句末，
       * 导致完整性检查里的"原文句数"被算多、覆盖率被低估。 */
      const out = TextRepair.sentences(clean, 'en');
      if (out.length) return out;
    }
    const parts = lang === 'zh'
      ? clean.split(/[。！？；]+/u)
      : clean.split(/[.!?;]+(?=\s|$|\n)/u);
    return parts.map(s => s.trim()).filter(Boolean);
  }

  /** 统计题号/编号标记：①… 或 (46) 或 行首 "1." —— 取最强的一种信号 */
  function countItemMarkers(text) {
    const s = String(text == null ? '' : text);
    const circled = (s.match(/[①②③④⑤⑥⑦⑧⑨⑩]/gu) || []).length;
    const bracketed = (s.match(/[（(]\s*\d{1,2}\s*[)）]/gu) || []).length;
    const lineNumbered = (s.match(/^[ \t]*\d{1,2}\s*[).、]/gmu) || []).length;
    return Math.max(circled, bracketed, lineNumbered);
  }

  /**
   * 完整性估计：返回覆盖系数（0–1）与可读的原因说明。
   * 只做保守判断：triggers 为空时 ratio 恒为 1。
   */
  function coverage(source, answer, opts) {
    const o = opts || {};
    const direction = o.direction === 'cn2en' ? 'cn2en' : 'en2cn';
    const srcLang = direction === 'en2cn' ? 'en' : 'zh';
    const hypLang = direction === 'en2cn' ? 'zh' : 'en';
    const src = String(source == null ? '' : source);
    const hyp = String(answer == null ? '' : answer);

    const markers = countItemMarkers(src);
    const srcSentences = splitSentences(src, srcLang).length;
    const srcUnits = Math.max(markers, srcSentences, 1);
    const hypUnits = splitSentences(hyp, hypLang).length;

    const srcLen = stripWhitespace(src).length;
    const hypLen = stripWhitespace(hyp).length;
    const lenRatio = srcLen ? hypLen / srcLen : 0;

    const triggers = [];
    let ratio = 1;

    if (!hyp.trim()) {
      ratio = 0;
      triggers.push('译文为空');
    } else {
      if (srcUnits >= 3 && hypUnits <= 1) {
        ratio = Math.min(ratio, 0.2);
        triggers.push('原文共 ' + srcUnits + ' 句/题号，译文只有 1 句，明显漏译');
      } else if (hypUnits < srcUnits * 0.6) {
        ratio = Math.min(ratio, 0.5);
        triggers.push('原文 ' + srcUnits + ' 句/题号，译文只有 ' + hypUnits + ' 句，疑似漏译');
      }
      /* 源文为空（没拿到原文）时不做长度门槛：
       * 没有可比对象却判"译文过短"，会把正常作答误伤成低分。 */
      const floor = LIMITS.lenFloor[direction];
      if (srcLen && lenRatio < floor * 0.5) {
        ratio = Math.min(ratio, 0.35);
        triggers.push('译文长度不到原文的 ' + Math.round(floor * 50) + '%，明显未译完');
      } else if (srcLen && lenRatio < floor) {
        ratio = Math.min(ratio, 0.65);
        triggers.push('译文长度短于原文的 ' + Math.round(floor * 100) + '%');
      }
    }

    return {
      direction, srcUnits, hypUnits,
      lengthRatio: lenRatio,
      ratio,
      triggers,
      note: triggers.join('；'),
    };
  }

  /* ================= 三、无 AI 时的本地兜底评分 ================= */

  /** 把 chrF 相似度与完整性系数折算成满分内的得分（0.5 分步长） */
  function localRatio(chrfScore, coverageRatio) {
    const surface = clamp01(LIMITS.bias + LIMITS.slope * Number(chrfScore || 0));
    return clamp01(surface * clamp01(coverageRatio == null ? 1 : coverageRatio));
  }

  /** 四维等分：本地规则区分不出语义/通顺，如实等分而不是编造差异 */
  function evenDimensions(total, max) {
    const per = max / 4;
    const value = Math.round((total / 4) * 10) / 10;
    const dims = { TR: value, CC: value, LR: value, GRA: value };
    // 修正四舍五入漂移：差值补到 TR，且不超过每维满分
    const sum = dims.TR + dims.CC + dims.LR + dims.GRA;
    const drift = Math.round((total - sum) * 10) / 10;
    if (drift) dims.TR = Math.round(Math.min(per, Math.max(0, dims.TR + drift)) * 10) / 10;
    return dims;
  }

  /**
   * 本地评分：只依赖"参考译文 + 完整性"，不调用模型。
   * 无参考译文时如实承认无法评分（不猜分、不给假分）。
   */
  function localGrade(task, answer, opts) {
    const o = opts || {};
    const direction = o.direction === 'cn2en' ? 'cn2en' : 'en2cn';
    const reverse = direction === 'cn2en';
    const max = Math.max(1, Number(o.max) || 20);
    const t = task || {};
    /* 原文来源与界面口径一致（sourceOf），单句练习仍在 en/cn 上兜底 */
    const source = sourceOf(t) || (reverse ? t.cn : t.en) || '';
    const reference = t.referenceTranslation || (reverse ? t.en : t.cn) || '';
    const hyp = String(answer == null ? '' : answer).trim();
    const reason = o.reason === 'failed' ? 'failed' : 'not-configured';

    /* 失败结果不带 score：与 AI 侧的 unavailable() 保持同一形状。
     * 带一个 0 分 score 会让"接口失败"看起来像"考了 0 分"，
     * 也会让调用方（translation.js）误把失败记进练习统计。 */
    const failure = message => ({
      gradingFailed: true, degraded: true, errMsg: message,
      comment: '', suggestions: { structure: [], language: [], vocab: [], grammar: [] },
      polished: '', translation: true, translationDirection: direction, reason,
    });

    if (!hyp) return failure('请先输入译文，或在下方上传手写译文照片。');
    if (!String(reference || '').trim()) {
      return failure('本题没有参考译文，本地规则无法判断译文是否准确。可先在设置页配置 AI，'
        + '或为自定义题目补充参考译文后再评。');
    }

    const chrfScore = chrf(hyp, reference);
    const cov = coverage(source, hyp, { direction });
    const ratio = localRatio(chrfScore, cov.ratio);
    const total = Math.round(max * ratio * 2) / 2;
    const dims = evenDimensions(total, max);

    const comment = '本地规则评分：与参考译文的 chrF 相似度 ' + chrfScore.toFixed(1)
      + '（字符 n-gram 重合度，0–100），完整性系数 ' + cov.ratio.toFixed(2)
      + '，折算 ' + total + '/' + max + ' 分。'
      + (cov.note ? '完整性检查：' + cov.note + '。' : '')
      + '该分数只反映表面重合度：合理意译会被低估，个别错译也可能被高估；'
      + '配置 AI 后可获得四维点评、漏译清单与修改建议。';

    const structure = cov.triggers.slice();
    if (!structure.length) structure.push('未检出明显漏译（按句数/长度判断）。');

    return {
      score: Object.assign({ total, max }, dims),
      comment,
      suggestions: {
        structure,
        language: ['未启用 AI：本次不提供逐句语言表达建议。'],
        vocab: [],
        grammar: [],
      },
      polished: String(reference),
      translation: true,
      translationDirection: direction,
      degraded: true,
      reason,
      localChecks: { chrf: chrfScore, coverage: cov },
    };
  }

  /* ================= 四、AI 结果与参考译文的对齐校正 ================= */
  /**
   * 把 AI 总分与"参考译文相似度"对照，只产出**事实与建议上限**，不在这里改分。
   * 分档（全部是保守规则）：
   *   mismatch-high-score 相似度 < 25 却给了 ≥60% 的分 → 建议压到满分 50%（可疑虚高）
   *   low-aligned         相似度 < 25 且本来就是低分 → 一致，不动
   *   mismatch-low-score  相似度 ≥ 85 却给 ≤40% 的分 → 只提示人工复核，**不自动加分**
   *   aligned             其余情况
   * 不自动加分的理由：chrF 只看表面重合度，看不到语义错误；往上抬分风险更大。
   */
  function align(total, max, chrfScore, opts) {
    const o = opts || {};
    const out = {
      checked: false, chrf: Number(chrfScore) || 0, relation: 'unknown',
      suggestCap: null, scoreRatio: 0, referenceLength: Number(o.referenceLength) || 0,
    };
    if (!String(o.reference || '').trim()) return out;
    if (out.referenceLength < LIMITS.minReferenceLength) return out;
    if (!Number.isFinite(Number(chrfScore))) return out;
    out.checked = true;

    const score = Math.max(0, Number(total) || 0);
    out.scoreRatio = max > 0 ? score / Number(max) : 0;

    if (out.chrf < LIMITS.lowChrf) {
      if (out.scoreRatio >= LIMITS.highScoreRatio) {
        out.relation = 'mismatch-high-score';
        out.suggestCap = Math.round(Number(max) * LIMITS.lowChrfCapRatio * 2) / 2;
      } else {
        out.relation = 'low-aligned';
      }
    } else if (out.chrf >= 85 && out.scoreRatio <= 0.4) {
      out.relation = 'mismatch-low-score';
    } else {
      out.relation = 'aligned';
    }
    return out;
  }

  /** 把 align() 的事实翻译成给用户看的中文说明（措辞集中在这里，避免多处不一致） */
  function alignNote(alignment, total, effectiveCap) {
    const a = alignment;
    if (!a || !a.checked) return '';
    const similarity = a.chrf.toFixed(1);
    if (a.relation === 'mismatch-high-score') {
      const capped = Number.isFinite(Number(effectiveCap)) && Number(effectiveCap) < Number(total) - 0.001;
      return '独立对齐检查：译文与参考译文的 chrF 相似度仅 ' + similarity
        + '（低于 ' + LIMITS.lowChrf + '），与给出的高分不一致'
        + (capped ? '，总分已从 ' + total + ' 限制为 ' + effectiveCap + ' 分'
          : '，已按完整性上限压制总分')
        + '，建议人工复核。';
    }
    if (a.relation === 'mismatch-low-score') {
      return '独立对齐检查：chrF 相似度 ' + similarity
        + '，与参考译文高度接近，但 AI 给分偏低，建议人工复核是否误判（未自动加分）。';
    }
    if (a.relation === 'low-aligned') {
      return '独立对齐检查：chrF 相似度 ' + similarity + '，与当前低分一致。';
    }
    return '独立对齐检查：chrF 相似度 ' + similarity + '，与 AI 总分方向一致。';
  }

  /** 按新总分等比缩放四维，并保证每维 ≤ max/4、四维之和 = 新总分 */
  function scaleScore(score, newTotal) {
    const s = score || {};
    const max = Math.max(0, Number(s.max) || 0);
    const perMax = max / 4;
    const keys = ['TR', 'CC', 'LR', 'GRA'];
    const raw = keys.map(k => Math.max(0, Number(s[k]) || 0));
    const sum = raw.reduce((a, b) => a + b, 0);
    const target = Math.max(0, Math.min(max, Number(newTotal) || 0));
    const scaled = raw.map(v => {
      const value = sum > 0 ? (v / sum) * target : target / 4;
      return Math.round(Math.min(perMax, value) * 10) / 10;
    });
    // 舍入漂移补到当前最高维，同时不越过每维上限
    let drift = Math.round((target - scaled.reduce((a, b) => a + b, 0)) * 10) / 10;
    let guard = 0;
    while (Math.abs(drift) > 0.001 && guard++ < 8) {
      let index = 0;
      scaled.forEach((v, i) => { if (v > scaled[index]) index = i; });
      const candidate = Math.round((scaled[index] + drift) * 10) / 10;
      const bounded = Math.round(Math.min(perMax, Math.max(0, candidate)) * 10) / 10;
      if (bounded === scaled[index]) break;
      drift = Math.round((drift - (bounded - scaled[index])) * 10) / 10;
      scaled[index] = bounded;
    }
    const out = { max, total: Math.round(target * 10) / 10 };
    keys.forEach((k, i) => { out[k] = scaled[i]; });
    return out;
  }

  return {
    VERSION: 'chrf/1.0 (sacrebleu c596d9d2, Apache-2.0)',
    LIMITS,
    chrf, chrfMulti,
    coverage, countItemMarkers, splitSentences,
    script, directionOf, sourceOf,
    localGrade, localRatio, evenDimensions,
    align, alignNote, scaleScore,
    _internal: { extractAllCharNgrams, extractWordNgrams, removePunctuation, matchStatistics, fScore, stripWhitespace, toCodePoints },
  };
})();

if (typeof window !== 'undefined') window.TranslateMetric = TranslateMetric;
if (typeof module !== 'undefined' && module.exports) module.exports = TranslateMetric;
