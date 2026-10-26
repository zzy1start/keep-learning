/* ============ views/listening-sent.js : 单句听力练习闭环 ============
 *
 * 单句听力只有**一个题型**（用户明确要求："右侧可以选择该句的英文原句；其他的不要"）：
 *   听英文原句 → 从 4 个**英文句子**里选出你听到的那一句（干扰项取自其他句子）
 * 另外保留：
 *   · 跟读复现：点原文里的任意句子可单独重听
 *   · 即时反馈：答对/答错 + 正确答案 + 原文与译文对照
 *
 * 【为什么删掉了"关键词听写"】用户明确要求删去。单句听力的目标是"整句听懂 / 说得出"，
 * 写关键词既打断节奏，效果上也与"听音选义"重复（都在考有没有听清），
 * 还要求用户额外输入一次。删掉后一张卡就是"听一句 → 选一个答案 → 看反馈"。
 *
 * 题目在首次进入时由 buildQuiz() 依据 sentences 生成并缓存到 Store.d.lsnQuiz，
 * 免刷新后题目与选项顺序变化（那样没法复习）。缓存带**版本号**：
 * 题库结构变了（例如本次新增"中→英"方向）就自动重建，避免旧缓存缺字段把练习卡住。
 */
(function () {
  const QUIZ_KEY = 'lsnQuiz';
  const CACHE_V = 3;          // 3：只保留"选出听到的英文句子"；删去关键词听写与中→英选项

  /** 稳定随机：同一 seed 永远得到同一顺序（避免刷新后题目打乱） */
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 组一道 4 选 1：正确答案 + 至多 3 个干扰项，顺序由种子决定（刷新不变） */
  function makePick(correct, others, seed) {
    if (!correct) return { opts: [], a: 0 };
    const distract = seededShuffle((others || []).filter(x => x && x !== correct), seed).slice(0, 3);
    const opts = seededShuffle([correct, ...distract], seed + 7);
    return { opts, a: Math.max(0, opts.indexOf(correct)) };
  }

  /** 为单句听力生成题目：**只有一个题型** —— 选出你听到的那句英文
   *  @returns {Object} { [index]: { pick: {opts:string[], a:number} } }
   *    四个选项都是英文句子；正确答案是本句，干扰项取自其他句子。 */
  function buildQuiz(sentences) {
    const quiz = {};
    sentences.forEach((s, i) => {
      // 干扰项取自**其他句子**，保证同一题里不会出现两个相同答案
      const enOthers = sentences.filter((x, k) => k !== i && x.en).map(x => x.en);
      quiz[i] = { pick: makePick(s.en, enOthers, i * 15485863 + 5) };
    });
    return quiz;
  }

  /** 取题目（优先用缓存，没有或版本不符则重建并落盘） */
  function getQuiz(sentences) {
    Store.d[QUIZ_KEY] = Store.d[QUIZ_KEY] || {};
    const cache = Store.d[QUIZ_KEY];
    if (cache.__n !== sentences.length || cache.__v !== CACHE_V) {
      const built = buildQuiz(sentences);
      Store.d[QUIZ_KEY] = Object.assign({ __n: sentences.length, __v: CACHE_V }, built);
      Store.flush();
    }
    return Store.d[QUIZ_KEY];
  }

  /* 挂到 window 上即可。
   * 注意：本文件在 listening.js **之前**加载，
   * 所以不能引用 ViewListen（那时还没定义），只导出独立的 API。*/
  window.SentQuiz = { getQuiz, buildQuiz, CACHE_V };
})();
