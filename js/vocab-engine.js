/* ============ vocab-engine.js : 词汇学习引擎（Vocabulary Engine Spec v1.0）============
 * 规约：docs/27-词汇学习引擎设计.md（本文只实现规约，不含任何 DOM/UI 代码）
 *
 * 结构：
 *   1. CONFIG —— §3 的全部数值，集中在这里，算法与 UI 都从这里读（不允许散落）
 *   2. 状态与持久化 —— §4.2 / §4.3；状态存在 Store.d.vocabEngine（复用现有存档/导出备份），
 *      CONFIG.STORAGE_KEYS 保留为规约要求的键名（导出/外部工具用）
 *   3. placement —— §5.1 冷启动定级
 *   4. composeRound —— §5.2 组轮（quiz → review → new）
 *   5. grade / transition —— §5.3 / §5.4 判定与状态迁移
 *   6. scheduling / difficulty —— §5.5 / §5.7
 *   7. anxiety guard —— §5.6（恢复题插入、错误率截断）
 *   8. report —— §5.8（正向框架，禁止"错了 N 个"式呈现）
 *
 * 【与规约的数据差异（§10-Q2）】现有词库是 {w, ph, tr:[{t,d}], phr, ex, freq}，
 * 没有 senses/band/confusableWith。适配层在 js/vocab-quiz.js（VocabBank）：
 *   senses = tr[]（每个释义一个义项），band = 词频分位（freq 越高越简单），
 *   confusableWith = 同首字母前缀、长度相近的词（受控计算）。
 *
 * 测试：tools/check-vocab-engine.cjs（含 §8 的 golden test A/B/C/D）
 */
const VocabEngine = {
  /* ================= §3 常量表 ================= */
  CONFIG: {
    // ---- 计时与评分 ----
    ANSWER_TIME_LIMIT_MS: { 0: 15000, 1: 12000, 2: 10000, 3: 5000 }, // L4 抽检按 L3 的限时
    SCORE: { fast: 1.0, hesitant: 0.5, wrong: 0 },

    // ---- 升级门槛 ----
    UPGRADE_THRESHOLD: { '0>1': 1.0, '1>2': 1.0, '2>3': 1.5 },
    L3_TO_L4_REQUIRES_FAST: true,

    // ---- 轮内规则 ----
    MAX_ATTEMPTS_PER_WORD_PER_ROUND: 2,
    MIN_GAP_SAME_WORD: 3,
    SAME_WORD_ERRORS_BREAK: 2,
    CONSECUTIVE_WRONG_LIMIT: 2,
    ROUND_ERROR_RATE_STOP: 0.40,
    /* ⚠️ 实现细节（规约未给）：动态错误率要先有足够样本才判，否则第 2 题错 1 个
     * 就是 50% > 40%，会把正常的一轮误截断（§8 golden 场景 B 要求跑完 8 题）。*/
    TRUNCATE_MIN_ATTEMPTS: 4,

    // ---- 轮构成 ----
    QUIZ: { rate: 0.10, min: 2, max: 3 },
    QUIZ_CALIBRATION: { rate: 0.25, min: 2, max: 4 },
    REVIEW_PER_ROUND: { min: 12, max: 15 },
    NEW_PER_ROUND: { min: 8, max: 10 },
    /* 【2026-10-23】每日新词目标由 UI 传进 startRound（dailyNewTarget）后真正生效：
     * 每轮新词数 = min(NEW_PER_ROUND.max, 本词书剩余 L0, 今日目标剩余额度)；
     * 未传目标时保持旧行为（每轮 8~10 个、可继续加学的软目标）。见 docs/27 §12。*/
    ROUND_MIN_WORDS: 15,
    ROUND_TARGET_MINUTES: [15, 20],

    // ---- 间隔队列（L4）----
    INTERVAL_LADDER_DAYS: [7, 15, 30],
    DUE_MISTAKE_RESET: true,

    // ---- 冷启动定级 ----
    PLACEMENT: { BANDS: 6, PER_BAND: 12, SKIP_RATE: 0.80, START_RATE: 0.50, CALIBRATION_ROUNDS: 2 },

    // ---- 难度（⚠️ 建议起点）----
    STATIC_PRIOR_WEIGHTS: { band: 0.6, sense: 0.2, confusable: 0.2 },
    DIFFICULTY_WEIGHTS: { errorRate: 1.0, hesitation: 1.0, stuck: 1.0 },
    HARD_WORD_PRIORITY_BOOST: 2.0,

    // ---- 持久化 ----
    STORAGE_KEYS: { user: 've.user.v1', words: 've.words.v1', events: 've.events.v1', rounds: 've.rounds.v1' },
    EVENT_LOG_CAP: 500,
    ROUND_HISTORY_CAP: 50,
  },

  /* 层级名（§1 术语表）：UI 的"阶段"标签直接用它 */
  LEVEL_NAMES: ['生词', '眼熟', '模糊', '认识', '巩固'],
  DAY: 864e5,

  /** 可注入的时钟/随机源（golden test 用固定值，生产用默认值） */
  _now: () => Date.now(),
  _rand: () => Math.random(),
  _today(ts) {
    const d = new Date(ts == null ? this._now() : ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },
  _dayIndex(iso) { if (!iso) return null; const t = new Date(iso + 'T00:00:00').getTime(); return Math.floor(t / this.DAY); },
  _dateFromIndex(idx) { return new Date(idx * this.DAY).toISOString().slice(0, 10); },

  /* ================= §4 状态与持久化 ================= */

  /** 空状态 */
  _blank() {
    return {
      user: {
        vocabEstimate: null, vocabLowConfidence: false, bandPlacement: null,
        skipBands: [], calibrationRoundsLeft: 0,
        dailyNewCount: 0, dailyNewDate: null,
        consecutiveWrong: 0, roundSeq: 0,
      },
      words: {},            // "wordId#senseId" -> SenseState
      events: [],           // GradeEvent（上限 EVENT_LOG_CAP，丢最旧）
      rounds: [],           // RoundState（上限 ROUND_HISTORY_CAP）
      round: null,          // 当前进行中的轮
    };
  },

  /** 单个词×义项状态。惰性创建：只有真正被选进轮次/作答后才落盘（见 ensurePlacementLevel 注释）。 */
  _newState() {
    return {
      level: 0, streak: 0, levelAttempts: 0, attempts: 0, errors: 0,
      errorTypes: { polysemy: 0, confusable: 0, forgotten: 0, timeout: 0 },
      hesitationMsSum: 0, hesitantCount: 0, stuckRounds: 0,
      nextDueAt: null, inQuizPool: false, quizAudited: false, hardWord: false,
      polysemyRisk: false, confusableRisk: false, lastGradedAt: null, intervalIdx: 0,
    };
  },

  /** 读存档。优先 Store.d.vocabEngine（跟着备份走），其次规约的 localStorage 键（外部工具/旧版） */
  load(store) {
    if (store && store.d) this._store = store;      // 记住存档对象：后续 save() 都写回它
    if (this._s) return this._s;
    let raw = null;
    try {
      if (store && store.d && store.d.vocabEngine) raw = store.d.vocabEngine;
      else if (typeof localStorage !== 'undefined' && localStorage) {
        const k = this.CONFIG.STORAGE_KEYS;
        if (localStorage.getItem(k.words)) raw = {
          user: JSON.parse(localStorage.getItem(k.user) || 'null') || this._blank().user,
          words: JSON.parse(localStorage.getItem(k.words) || '{}'),
          events: JSON.parse(localStorage.getItem(k.events) || '[]'),
          rounds: JSON.parse(localStorage.getItem(k.rounds) || '[]'),
        };
      }
    } catch (e) { raw = null; }
    this._s = this._normalize(raw);
    return this._s;
  },

  _normalize(raw) {
    const s = this._blank();
    if (!raw || typeof raw !== 'object') return s;
    Object.assign(s.user, raw.user && typeof raw.user === 'object' ? raw.user : {});
    if (raw.words && typeof raw.words === 'object') s.words = raw.words;
    if (Array.isArray(raw.events)) s.events = raw.events.slice(-this.CONFIG.EVENT_LOG_CAP);
    if (Array.isArray(raw.rounds)) s.rounds = raw.rounds.slice(-this.CONFIG.ROUND_HISTORY_CAP);
    if (raw.round && typeof raw.round === 'object' && Array.isArray(raw.round.slots)) s.round = raw.round;
    if (!Array.isArray(s.user.skipBands)) s.user.skipBands = [];
    return s;
  },

  /** 写存档（Store.d 存在则由它落盘，否则写规约键名） */
  save(store) {
    const s = this._s;
    if (!s) return false;
    const target = (store && store.d) ? store : this._store;
    try {
      if (target && target.d) {
        target.d.vocabEngine = s;
        if (typeof target.flush === 'function') target.flush();
        return true;
      }
      if (typeof localStorage !== 'undefined' && localStorage) {
        const k = this.CONFIG.STORAGE_KEYS;
        localStorage.setItem(k.user, JSON.stringify(s.user));
        localStorage.setItem(k.words, JSON.stringify(s.words));
        localStorage.setItem(k.events, JSON.stringify(s.events.slice(-this.CONFIG.EVENT_LOG_CAP)));
        localStorage.setItem(k.rounds, JSON.stringify(s.rounds.slice(-this.CONFIG.ROUND_HISTORY_CAP)));
        return true;
      }
    } catch (e) { /* 配额不足等：不阻塞学习，UI 只少一次落盘 */ }
    return false;
  },

  reset() { this._s = null; this._store = null; },

  /** 词×义项 状态（不存在则创建） */
  stateOf(wordId, senseId, create) {
    const s = this.load();
    const key = wordId + '#' + senseId;
    if (!s.words[key] && create) s.words[key] = this._newState();
    return s.words[key] || null;
  },

  /** §6-#12 旧 srs.js 数据迁移：stage 0~4 近似映射 L0~L4，inQuizPool=false */
  migrateFromSrs(words, wordIdOf) {
    const s = this.load();
    if (!words || typeof words !== 'object') return 0;
    let n = 0;
    for (const k in words) {
      const rec = words[k];
      if (!rec || typeof rec !== 'object') continue;
      const stage = Math.max(0, Math.min(4, Number(rec.stage) || 0));
      if (!Number(rec.reps) && !stage) continue;
      const wordId = wordIdOf ? wordIdOf(k) : 'w:' + k;
      const key = wordId + '#s0';
      if (s.words[key]) continue;                      // 已有引擎状态：不覆盖
      const st = this.stateOf(wordId, 's0', true);
      st.level = stage;
      st.nextDueAt = rec.next ? this._today(rec.next) : null;
      st.hardWord = stage >= 3 ? false : ((rec.lapses || 0) > 1);
      n++;
    }
    if (n) this.save();
    return n;
  },

  /**
   * 清理历史版本「组轮即给整本书建状态」留下的空记录（P0 存量数据修复）。
   * 只删「从未作答、没有任何层级/队列/时间记录」的默认状态；
   * 定级起点（level>0）、抽检池、有作答/到期时间的记录全部保留。
   * @returns {number} 删除条数
   */
  pruneEmptyStates(opts = {}) {
    const s = this.load(opts.store);
    let removed = 0;
    for (const key of Object.keys(s.words || {})) {
      const st = s.words[key];
      if (!st || typeof st !== 'object') { delete s.words[key]; removed++; continue; }
      /* 「空」的判据是**没有任何学习证据**，而不是 level=0：
       * 旧版 bug 会给整本书每个词写 placement 起点（level 1/3、inQuizPool），
       * 这些状态里 attempts/levelAttempts/nextDueAt/lastGradedAt 全为 0，属于可重算的起点，
       * 删掉后 ensurePlacementLevel() 会按 user.skipBands/bandAccuracy 重新算出同一层级。
       * 保留任何有作答、到期、hard/audit 记录的词。*/
      const hasEvidence = (st.attempts > 0) || (st.levelAttempts > 0) || (st.streak > 0)
        || (st.errors > 0) || (st.hesitationMsSum > 0) || st.lastGradedAt || st.nextDueAt
        || st.hardWord || st.quizAudited;
      if (!hasEvidence) { delete s.words[key]; removed++; }
    }
    if (removed) this.save(opts.store);
    return removed;
  },

  /* ================= §5.1 冷启动定级 ================= */

  /**
   * @param {Array} bandResults [{ band, sampled, correct }]
   * @param {number[]} bandSizes 每个带的词数（用于 vocabEstimate）
   * @returns {{accuracy:number[], skipBands:number[], bandPlacement:number|null,
   *            vocabEstimate:number, calibrationRoundsLeft:number, vocabLowConfidence:boolean}}
   */
  placement(bandResults, bandSizes, opts = {}) {
    const P = this.CONFIG.PLACEMENT;
    const rows = (bandResults || []).slice().sort((a, b) => a.band - b.band);
    const accuracy = rows.map(r => (r.sampled ? r.correct / r.sampled : 0));
    const skipBands = [];
    let bandPlacement = null;
    rows.forEach((r, i) => {
      const a = accuracy[i];
      if (a >= P.SKIP_RATE) skipBands.push(r.band);
      else if (a < P.START_RATE && bandPlacement == null) bandPlacement = r.band;
    });
    let est = 0;
    rows.forEach((r, i) => {
      const size = (bandSizes && bandSizes[r.band] != null) ? Number(bandSizes[r.band]) : 0;
      if (r.sampled) est += (r.correct * size) / r.sampled;
    });
    const out = {
      accuracy,
      bandResults: rows,          // placeWord 要按带查正确率（§5.1 步 3）
      skipBands,
      bandPlacement,
      vocabEstimate: Math.round(est),
      calibrationRoundsLeft: P.CALIBRATION_ROUNDS,
      vocabLowConfidence: !!(opts.lowConfidence),
    };
    return out;
  },

  /** 把 placement 结果写进 user 状态（并可选按带给每个词定级，见 §5.1 步 3） */
  applyPlacement(result, correctWordIds) {
    const s = this.load();
    if (correctWordIds && correctWordIds.length) s.user.placementCorrect = correctWordIds.slice(0, 500);
    s.user.bandAccuracy = {};
    for (let i = 0; i < (result.accuracy || []).length; i++) {
      const row = (result.bandResults || [])[i];
      const band = row ? row.band : i;
      s.user.bandAccuracy[band] = result.accuracy[i];
    }
    s.user.vocabEstimate = result.vocabEstimate;
    s.user.vocabLowConfidence = !!result.vocabLowConfidence;
    s.user.bandPlacement = result.bandPlacement;
    s.user.skipBands = (result.skipBands || []).slice();
    s.user.calibrationRoundsLeft = result.calibrationRoundsLeft != null
      ? result.calibrationRoundsLeft : this.CONFIG.PLACEMENT.CALIBRATION_ROUNDS;
    this.save();
    return s.user;
  },

  /** §5.1 步 3：按带 + 抽样对错给单个词定级（entries 需带 band；correctWordIds 是抽样答对的 wordId） */
  placeWord(entry, placementResult, correctWordIds) {
    const P = this.CONFIG.PLACEMENT;
    const st = this.stateOf(entry.wordId, 's0', true);
    const correct = !!(correctWordIds && correctWordIds.has(entry.wordId));
    const acc = placementResult && placementResult.accuracy ? placementResult.accuracy : [];
    const bands = placementResult && placementResult.bandResults;
    const accOfBand = band => {
      if (!bands) return null;
      const row = bands.find(r => r.band === band);
      if (!row || !row.sampled) return null;
      return row.correct / row.sampled;
    };
    let level = 0;
    if (correct) level = 3;
    else if (accOfBand(entry.band) != null) {
      const a = accOfBand(entry.band);
      if ((placementResult.skipBands || []).includes(entry.band)) level = 3;
      else if (a >= P.START_RATE && a < P.SKIP_RATE) level = 1;
      else if (placementResult.bandPlacement != null && entry.band < placementResult.bandPlacement) level = 1;
      else level = 0;
    }
    st.level = level;
    st.inQuizPool = level >= 3;
    st.attempts = 1;                                   // 定级算一次"见过"，不再当从未出场
    return st;
  },

  /**
   * §5.1 步 3 的**惰性实现**：定级结果只记在 user 上（bandPlacement / skipBands / bandAccuracy），
   * 词第一次进入学习轮时才给它定起点，而不是把整本词书几千个词都写成状态
   * （否则 localStorage 会膨胀到几 MB、每次组轮都要遍历一遍）。
   * 规则同规约：跳过带 → L3+抽检池；边界带 → L1；起点带及以后 → L0；抽样答对的词已在定级时单独置 L3。
   */
  ensurePlacementLevel(entry) {
    const s = this.load();
    /* 【P0 修复 2026-10-29】原来第一行就 stateOf(..., true) 建持久状态，再判断定级——
     * 组轮会对整本词书每个词调用一次，于是"只学了 1 个词"也会写入 4500+ 条空状态，
     * 2~3 本词书后 localStorage 超 5MB 配额，之后的学习进度静默不落盘。
     * 现在：已有状态直接返回；没有定级信息返回 null；有定级信息返回**临时状态**，
     * 只用于本轮分池，真正被选进轮次时 _selectSlots 才落盘（见 push）。*/
    const existing = this.stateOf(entry.wordId, 's0', false);
    if (existing) return existing;                                   // 已有记录：不覆盖
    const u = s.user || {};
    const hasPlacement = u.bandPlacement != null || (u.skipBands && u.skipBands.length)
      || (u.bandAccuracy && Object.keys(u.bandAccuracy).length);
    if (!hasPlacement) return null;
    const st = this._newState();
    /* 规约 §5.1 步 3 末条：任何带中抽样答对的词 → L3 + 抽检池（覆盖其余规则） */
    if ((u.placementCorrect || []).includes(entry.wordId)) { st.level = 3; st.inQuizPool = true; return st; }
    const P = this.CONFIG.PLACEMENT;
    const band = Number(entry.band) || 0;
    const acc = u.bandAccuracy ? u.bandAccuracy[band] : null;
    if ((u.skipBands || []).includes(band)) { st.level = 3; st.inQuizPool = true; }
    else if (acc != null && acc >= P.START_RATE && acc < P.SKIP_RATE) { st.level = 1; }
    else if (u.bandPlacement != null && band >= u.bandPlacement) { st.level = 0; }
    else if (u.bandPlacement != null && band < u.bandPlacement) { st.level = 1; }
    if (st.level > 0) st.attempts = 0;      // 只是"起点"，不算已作答（新词统计仍准）
    st.__transient = true;                  // 未落盘，仅本轮分池用
    return st;
  },

  /* ================= §5.7 难度分 ================= */

  difficulty(entry, st) {
    const C = this.CONFIG;
    const bands = Math.max(1, (C.PLACEMENT.BANDS - 1));
    const bandNorm = Math.min(1, Math.max(0, (Number(entry.band) || 0) / bands));
    const senseNorm = Math.min(3, Math.max(0, (entry.senses ? entry.senses.length - 1 : 0))) / 3;
    const confNorm = Math.min(3, Math.max(0, (entry.confusableWith ? entry.confusableWith.length : 0))) / 3;
    const w = C.STATIC_PRIOR_WEIGHTS;
    const staticPrior = w.band * bandNorm + w.sense * senseNorm + w.confusable * confNorm;
    const s2 = st || {};
    const errorRate = (s2.errors || 0) / Math.max(1, s2.attempts || 0);
    const limit = this.timeLimit(s2.level || 0);
    const hesitation = (s2.hesitantCount ? (s2.hesitationMsSum || 0) / s2.hesitantCount : 0) / Math.max(1, limit);
    const stuckNorm = Math.min(5, s2.stuckRounds || 0) / 5;
    const dw = C.DIFFICULTY_WEIGHTS;
    return staticPrior + dw.errorRate * errorRate + dw.hesitation * hesitation + dw.stuck * stuckNorm;
  },

  /** 该层级的答题限时（L4 按 L3） */
  timeLimit(level) {
    const L = this.CONFIG.ANSWER_TIME_LIMIT_MS;
    return L[Math.min(3, Math.max(0, Number(level) || 0))];
  },

  levelName(level) { return this.LEVEL_NAMES[Math.min(4, Math.max(0, Number(level) || 0))]; },

  /* ================= §5.2 组轮 ================= */

  /**
   * 组一轮。
   * @param {object} o { entries, mode:'smart'|'review'|'new', today }
   * @returns {RoundState} round（含 slots / quizCount / truncated 等）
   */
  startRound(o = {}) {
    const s = this.load();
    const today = o.today || this._today();
    const mode = o.mode === 'review' || o.mode === 'new' ? o.mode : 'smart';
    const entries = o.entries || [];
    /* 【每日新词目标（2026-10-23 用户反馈"这个设定没有用"；同日追加"学完可以继续学新词"）】
     * 目标由 UI 传进来（引擎不直接读 Store.settings，保持纯逻辑）：
     * - 未达目标时，每轮按"今日剩余额度"出词（例：目标 30，剩 5 个就只出 5 个）；
     * - 达到目标后仍可继续出**新词**（加学，每轮 ≤ NEW_PER_ROUND.max），不强制改复习；
     * - 只有"词书已没有 L0 新词"时才回退复习轮（fallbackReason='no-new'）。
     * null/0 = 不限制（自检脚本/外部调用兼容）。*/
    const dailyTarget = Number(o.dailyNewTarget) > 0 ? Math.round(Number(o.dailyNewTarget)) : null;
    // 跨天重置今日新词计数
    if (s.user.dailyNewDate !== today) { s.user.dailyNewDate = today; s.user.dailyNewCount = 0; }
    /* 【换轮对账】上一轮没学完就被新轮取代时，把上一轮里"还没开始学的新词位"
     * 从今日计数里扣回——否则中途退出再进来会重复占用当日额度
     *（今日进度虚高，后面的轮次拿不到新词）。*/
    const prev = s.round;
    if (prev && !prev.finished) {
      const leftoverNew = (prev.slots || []).filter(x => x.role === 'new').length;
      if (leftoverNew) s.user.dailyNewCount = Math.max(0, (s.user.dailyNewCount || 0) - leftoverNew);
    }
    const selectOpts = { dailyNewTarget: dailyTarget };

    let sel = this._selectSlots(entries, mode, today, selectOpts);
    /* 【词书真的学完才回退复习】点"新词学习"但本轮组不出新词位 = 词书已没有可教的新词
     * （定级把生词并入复习 / 整本词书学过一遍）。日目标完成**不是**回退理由：
     * 用户明确要求"每日学习学完后可以继续学习新单词，复习有特定的内容"。*/
    let effectiveMode = mode;
    let fallbackFromNew = false;
    let fallbackReason = null;
    if (mode === 'new' && sel.slots.length === 0) {
      effectiveMode = 'smart';
      sel = this._selectSlots(entries, effectiveMode, today, selectOpts);
      fallbackFromNew = true;
      fallbackReason = 'no-new';
    }
    /* 本轮是否属于"已完成今日目标后的加学轮"（UI 用于提示文案） */
    const newSlotsThisRound = sel.slots.filter(x => x.role === 'new').length;
    const newBeforeThisRound = Math.max(0, (Number(s.user.dailyNewCount) || 0) - newSlotsThisRound);
    const newOverGoal = dailyTarget != null && newSlotsThisRound > 0 && newBeforeThisRound >= dailyTarget;
    const round = {
      roundId: 'r-' + today.replace(/-/g, '') + '-' + (++s.user.roundSeq),
      mode: effectiveMode,
      fallbackFromNew,
      fallbackReason,
      dailyNewTarget: dailyTarget,
      newOverGoal,
      today,
      startedAt: this._now(),
      slots: sel.slots,                 // 执行队列（含重考/恢复题插入）
      plan: sel.slots.map(x => ({ wordId: x.wordId, senseId: x.senseId, role: x.role })),
      results: [],
      consecutiveWrong: 0,
      consecutiveWrongPeak: 0,
      attempts: 0,
      errors: 0,
      truncated: false,
      quiz: { total: 0, passed: 0 },
      upgraded: [],
      hardWords: [],
      intervention: null,
      finished: false,
    };
    round.quiz.total = sel.slots.filter(x => x.role === 'quiz').length;
    s.round = round;
    this.save(o.store);
    return round;
  },

  /**
   * 抽检/复习/新词三类词位的挑选与排序（§5.2 步 2~6）
   * @param {object} [opts] { dailyNewTarget } 每日新词目标（null = 不限制，旧行为）
   */
  _selectSlots(entries, mode, today, opts = {}) {
    const C = this.CONFIG;
    const s = this.load();
    const rows = [];
    for (const entry of entries) {
      const nSenses = (entry.senses && entry.senses.length) || 1;
      for (let i = 0; i < nSenses; i++) {
        const sense = entry.senses[i];
        const st = this.stateOf(entry.wordId, sense.senseId, false);
        rows.push({ entry, sense, st });
      }
    }
    /* 【每轮每个词只占一个词位】多义词在 rows 里有多行（词×义项），若直接进池，
     * 同一个词会在一轮里以不同义项重复出现（违反 §6-#4 的"每轮每词最多 2 次作答"精神）。
     * 这里按词聚合：取层级最低（最需要练）的义项；同层同次数时按轮次轮换义项，
     * 避免同一个词永远只考第一个义项。*/
    const byWord = new Map();
    for (const r of rows) {
      const cur = byWord.get(r.entry.wordId);
      if (!cur) { byWord.set(r.entry.wordId, r); continue; }
      /* 偏好顺序：已经有学习记录的义项 → 层级低的 → 次数少的。
       * 【为什么优先"有记录"】一个词 s0 已在学、s1/s2 没学过时，如果按"层级最低"去挑，
       * 会把同一个词的新义项当成"新词"再教一遍（同一轮里同一个词出现两次）。*/
      const rank = x => {
        const st = x.st || {};
        const hasState = (st.attempts || 0) > 0 || (st.level || 0) > 0 ? 0 : 1;
        return hasState * 1e6 + (st.level || 0) * 1000 + (st.attempts || 0);
      };
      if (rank(r) < rank(cur)) { byWord.set(r.entry.wordId, r); continue; }
      if (rank(r) === rank(cur)) {
        const n = (r.entry.senses || []).length || 1;
        const want = (s.user.roundSeq || 0) % n;
        const dR = Math.abs(r.entry.senses.indexOf(r.sense) - want);
        const dC = Math.abs(cur.entry.senses.indexOf(cur.sense) - want);
        if (dR < dC) byWord.set(r.entry.wordId, r);
      }
    }
    const quizPool = [];
    const reviewPool = [];
    const newPool = [];
    const todayIdx = this._dayIndex(today);
    for (const r of byWord.values()) {
      /* 定级是"惰性"的：新词第一次进轮时才按定级结果给起点（§5.1 步 3） */
      if (!r.st || ((r.st.attempts || 0) === 0 && (r.st.level || 0) === 0)) {
        const placed = this.ensurePlacementLevel(r.entry);
        if (placed && placed !== r.st) {
          r.st = placed;
          if (placed.__transient) r.tempPlacement = true;   // 有起点但还没落盘
        }
      }
      const lv = r.st ? r.st.level : 0;
      if (lv === 3 || lv === 4) {
        const due = r.st.nextDueAt ? this._dayIndex(r.st.nextDueAt) : null;
        const overdue = due == null ? (lv === 4 ? 99 : -1) : (todayIdx - due);
        quizPool.push({ ...r, overdue, diff: this.difficulty(r.entry, r.st) });
      } else if (lv === 1 || lv === 2) {
        reviewPool.push({ ...r, diff: this.difficulty(r.entry, r.st) });
      } else {
        const untouched = !r.st || ((r.st.attempts || 0) === 0 && (r.st.levelAttempts || 0) === 0);
        if (untouched) newPool.push({ ...r, diff: 0 });
      }
    }

    const slots = [];
    const push = (r, role) => {
      /* 【P0 修复】定级临时状态只在这词真的被选进本轮词位时才落盘（一轮最多十几个词位），
       * 不再因为组轮就把整本书每个词都写成状态。 */
      if (r.tempPlacement && r.st && ((r.st.level || 0) > 0 || r.st.inQuizPool)) {
        const st = this.stateOf(r.entry.wordId, r.sense.senseId, true);
        if (!(st.attempts || 0) && !(st.level || 0)) {
          st.level = r.st.level || 0;
          st.inQuizPool = !!r.st.inQuizPool;
        }
        delete r.st.__transient;
        delete r.tempPlacement;
      }
      slots.push({
        wordId: r.entry.wordId, senseId: r.sense.senseId, role,
        word: r.entry.word, sense: r.sense, entry: r.entry,
      });
    };

    /* --- 抽检位 --- */
    if (mode !== 'new') {
      const calibration = (s.user.calibrationRoundsLeft || 0) > 0;
      const q = calibration ? C.QUIZ_CALIBRATION : C.QUIZ;
      const want = Math.max(q.min, Math.min(q.max, Math.round(q.rate * quizPool.length)));
      const pool = quizPool.slice();
      // 排序：overdue 优先 → 未审计的跳过词 → 难度高的先
      pool.sort((a, b) => {
        const ao = a.st && a.st.nextDueAt ? a.overdue : -1;
        const bo = b.st && b.st.nextDueAt ? b.overdue : -1;
        if (ao !== bo) return bo - ao;
        const aa = a.st && a.st.inQuizPool && !a.st.quizAudited ? 1 : 0;
        const ba = b.st && b.st.inQuizPool && !b.st.quizAudited ? 1 : 0;
        if (aa !== ba) return ba - aa;
        return b.diff - a.diff;
      });
      const take = pool.slice(0, Math.min(want, pool.length));
      for (const r of take) push(r, 'quiz');
      if (calibration && s.user.calibrationRoundsLeft > 0) s.user.calibrationRoundsLeft--;
    }

    /* --- 复习位 --- */
    if (mode !== 'new') {
      const want = Math.max(C.REVIEW_PER_ROUND.min,
        Math.min(C.REVIEW_PER_ROUND.max, reviewPool.length));
      const taken = Math.min(mode === 'review' ? reviewPool.length : want, reviewPool.length);
      reviewPool.sort((a, b) => {
        const ah = a.st && a.st.hardWord ? C.HARD_WORD_PRIORITY_BOOST : 1;
        const bh = b.st && b.st.hardWord ? C.HARD_WORD_PRIORITY_BOOST : 1;
        return (b.diff * bh) - (a.diff * ah);
      });
      const picked = this._spreadByDifficulty(reviewPool, taken);
      for (const r of picked) push(r, 'review');
    }

    /* --- 新词位 ---
     * 【2026-10-23·最终口径（用户两次反馈）】
     * 1) 未达今日目标：每轮新词数 = min(每轮上限 10, 本词书剩余 L0, 今日剩余额度)
     *    → 设定真正生效（目标 30 = 10+10+10；目标 5 = 一轮 5 个）；
     * 2) 已达到/超过今日目标：仍可**继续加学新词**（每轮 ≤10），不强制改复习——
     *    复习有专门入口与到期词，不应被"日目标完成"顶替；
     * 3) 只有词书没有 L0 新词时才没有新词位，由 startRound 回退复习轮。*/
    if (mode !== 'review') {
      const dailyTarget = Number(opts.dailyNewTarget) > 0 ? Math.round(Number(opts.dailyNewTarget)) : null;
      const used = Number(s.user.dailyNewCount) || 0;
      const quotaLeft = dailyTarget == null ? Infinity : Math.max(0, dailyTarget - used);
      const want = quotaLeft > 0
        ? Math.min(C.NEW_PER_ROUND.max, newPool.length, quotaLeft)   // 先补满今日目标
        : Math.min(C.NEW_PER_ROUND.max, newPool.length);             // 目标已完成：继续加学
      const picked = this._shuffle(newPool).slice(0, want);
      for (const r of picked) push(r, 'new');
      s.user.dailyNewCount = (s.user.dailyNewCount || 0) + picked.length;
    }

    /* --- 执行顺序：quiz → review → new（认知负荷由轻到重） --- */
    const order = { quiz: 0, review: 1, new: 2 };
    slots.sort((a, b) => order[a.role] - order[b.role]);
    return { slots, quizCount: slots.filter(x => x.role === 'quiz').length };
  },

  /** 复习位：难度高的优先，但不要连着同 band —— 按难度降序后做一次"高低交错" */
  _spreadByDifficulty(pool, n) {
    const list = pool.slice(0, Math.max(n, 1));
    if (list.length <= 2) return list;
    const head = list.slice(0, Math.ceil(list.length / 2));
    const tail = list.slice(Math.ceil(list.length / 2)).reverse();
    const out = [];
    for (let i = 0; i < head.length || i < tail.length; i++) {
      if (head[i]) out.push(head[i]);
      if (tail[i]) out.push(tail[i]);
    }
    return out;
  },

  _shuffle(arr) {
    const a = (arr || []).slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this._rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  },

  /* ================= §5.3 判定 + §5.4 迁移 ================= */

  /**
   * 判定并迁移一个词位。
   * @param {object} o { wordId, senseId, role, correct, responseMs, selectedOptionId, answerId,
   *                     errorType（可选，出题侧能精确判定时传）, entry }
   * @returns {{feedback:object, transition:object, intervene:object|null, nextSlot:object|null, endRound:boolean}}
   */
  grade(o) {
    const s = this.load();
    const round = s.round;
    const C = this.CONFIG;
    if (!round || round.finished) return { feedback: { correct: !!o.correct, score: 0 }, endRound: true };
    const slot = round.slots.find(x => x.wordId === o.wordId && x.senseId === o.senseId)
      || { wordId: o.wordId, senseId: o.senseId, role: o.role || 'review', entry: o.entry };
    const entry = o.entry || slot.entry || null;
    const role = o.role || slot.role || 'review';
    const st = this.stateOf(o.wordId, o.senseId, true);
    const levelBefore = st.level;
    const limit = (levelBefore === 4) ? this.timeLimit(3) : this.timeLimit(levelBefore);
    const responseMs = Math.max(0, Number(o.responseMs) || 0);
    const timedOut = responseMs >= limit;
    /* §5.3：correct 只看是否选对；score 才区分"限时内答对/超时后答对（犹豫）"。
     * 超时答对 = 半次（0.5），超时未答 = 错（0）——两者不能混为一谈。*/
    const correct = !!o.correct;
    const score = correct ? (timedOut ? C.SCORE.hesitant : C.SCORE.fast) : 0;
    const answered = o.answered !== false;
    const errorType = correct ? null : (o.errorType || (timedOut ? 'timeout' : this._inferErrorType(o, entry, st)));

    /* 事件先落盘再算状态（§4.3） */
    const ev = {
      roundId: round.roundId, ts: this._now(), wordId: o.wordId, senseId: o.senseId,
      role, levelBefore, responseMs, timeLimitMs: limit, correct, score, errorType,
      levelAfter: levelBefore,
    };

    /* 计数更新（§5.3 步 5） */
    st.attempts = (st.attempts || 0) + 1;
    st.levelAttempts = (st.levelAttempts || 0) + 1;
    st.streak = Number(st.streak || 0) + score;
    st.lastGradedAt = new Date(this._now()).toISOString();
    if (timedOut && !answered) { /* 超时未作答：按错误处理 */ }
    if (!correct) {
      st.errors = (st.errors || 0) + 1;
      st.errorTypes = st.errorTypes || { polysemy: 0, confusable: 0, forgotten: 0, timeout: 0 };
      st.errorTypes[errorType] = (st.errorTypes[errorType] || 0) + 1;
    }
    if (score === C.SCORE.hesitant) {
      st.hesitationMsSum = (st.hesitationMsSum || 0) + responseMs;
      st.hesitantCount = (st.hesitantCount || 0) + 1;
    }
    if (errorType === 'polysemy') st.polysemyRisk = true;
    if (errorType === 'confusable') st.confusableRisk = true;

    round.attempts = (round.attempts || 0) + 1;
    if (!correct) {
      round.errors = (round.errors || 0) + 1;
      round.consecutiveWrong = (round.consecutiveWrong || 0) + 1;
    } else {
      round.consecutiveWrong = 0;
    }
    round.consecutiveWrongPeak = Math.max(round.consecutiveWrongPeak || 0, round.consecutiveWrong);
    round.results.push(ev);

    /* 迁移（§5.4） */
    const tr = this._transition({ st, entry, role, correct, timedOut, score, errorType, levelBefore, round, senseId: o.senseId });
    ev.levelAfter = st.level;

    /* 轮内重考/熔断标记 */
    const attemptsThisRound = round.results.filter(x => x.wordId === o.wordId && x.senseId === o.senseId).length;
    const errorsThisRound = round.results.filter(x => x.wordId === o.wordId && x.senseId === o.senseId && !x.correct).length;
    const canRetry = !tr.break && st.level <= 2 && !tr.upgraded
      && attemptsThisRound < C.MAX_ATTEMPTS_PER_WORD_PER_ROUND;

    this._record(ev);
    /* 从执行队列里移除已完成的这一位 */
    const qi = round.slots.findIndex(x => x.wordId === o.wordId && x.senseId === o.senseId);
    if (qi >= 0) round.slots.splice(qi, 1);

    /* 心理干预（§5.6）：连续错 2 → 下一题插入恢复题 */
    let intervene = null;
    if (!correct && round.consecutiveWrong >= C.CONSECUTIVE_WRONG_LIMIT) {
      const recovery = this._recoverySlot(round, entriesOfRound(round));
      if (recovery) {
        round.slots.splice(Math.min(qi < 0 ? 0 : qi, round.slots.length), 0, recovery);
        intervene = { mode: 'recovery', slot: recovery };
      } else {
        intervene = { mode: 'reveal', wordId: o.wordId, senseId: o.senseId };
      }
      round.consecutiveWrong = 0;
      round.intervention = intervene.mode;
    }

    /* 安排同轮重考（满足 MIN_GAP_SAME_WORD 的最早位置） */
    let retry = null;
    if (canRetry && (errorType || score === C.SCORE.hesitant)) {
      retry = {
        wordId: o.wordId, senseId: o.senseId, role: 'retry',
        word: slot.word || (entry && entry.word), sense: slot.sense || (entry && entry.senses && entry.senses[0]),
        entry: entry, isRetry: true,
      };
      this._insertWithGap(round.slots, retry, o.wordId);
    }

    /* 错误率截断（§5.6 步 3）：只截断还没开始的新词位 */
    let truncated = false;
    const rate = round.attempts ? round.errors / round.attempts : 0;
    if (!round.truncated && round.attempts >= C.TRUNCATE_MIN_ATTEMPTS
      && rate > C.ROUND_ERROR_RATE_STOP && round.slots.some(x => x.role === 'new')) {
      /* §5.6 步 3：错误率过高 → 剩余新词顺延下一轮、本轮提前收尾。
       * 未开始的词位状态零变化（不惩罚、不清零）。*/
      round.truncated = true;
      round.slots = [];
      truncated = true;
    }

    /* 收尾判定 */
    const endRound = round.slots.length === 0;
    if (endRound) { round.finished = true; this._closeRound(round); }
    this.save();

    return {
      feedback: {
        correct, score, timedOut, errorType,
        levelBefore, levelAfter: st.level,
        upgraded: !!tr.upgraded, break: !!tr.break, demote: !!tr.demote,
        explanation: this._explain({ correct, timedOut, errorType, entry, sense: slot.sense }),
      },
      transition: tr,
      intervene,
      retry: !!retry,
      truncated,
      nextSlot: round.slots[0] || null,
      endRound,
      round,
    };
  },

  /** §5.3 步 4：错误类型推断 */
  _inferErrorType(o, entry, st) {
    if (!entry) return 'forgotten';
    const picked = o.selectedOptionId != null ? String(o.selectedOptionId) : '';
    if (picked) {
      const parts = picked.split('#');
      const pickedWord = parts[0];
      const pickedSense = parts[1];
      if (pickedWord === entry.wordId && pickedSense && pickedSense !== o.senseId) return 'polysemy';
      if ((entry.confusableWith || []).some(w => String(w) === pickedWord)) return 'confusable';
      // 形近词可能不在 confusableWith（数据缺失）：按词形再兜一层
      if (pickedWord && this._looksConfusable(pickedWord, entry.word)) return 'confusable';
    }
    return 'forgotten';
  },

  _looksConfusable(a, b) {
    const x = String(a || '').toLowerCase(), y = String(b || '').toLowerCase();
    if (!x || !y || x === y) return false;
    if (Math.abs(x.length - y.length) > 2) return false;
    let same = 0;
    for (let i = 0; i < Math.min(3, x.length, y.length); i++) if (x[i] === y[i]) same++;
    return same >= 2;
  },

  /** §5.4 状态迁移表 */
  _transition(c) {
    const C = this.CONFIG;
    const { st, role, correct, timedOut, score, errorType, round } = c;
    const out = { upgraded: false, break: false, demote: false, from: st.level, to: st.level };
    const sameWordErrors = round.results.filter(x => !x.correct
      && x.wordId === (c.entry && c.entry.wordId)).length;
    const isQuizLike = st.level === 3 || st.level === 4;

    if (st.level === 0) {
      if (correct && score >= C.UPGRADE_THRESHOLD['0>1']) { st.level = 1; this._resetLevel(st); out.upgraded = true; }
      else if (!correct && sameWordErrors >= C.SAME_WORD_ERRORS_BREAK) { st.hardWord = true; out.break = true; }
    } else if (st.level === 1) {
      if (correct && score >= C.UPGRADE_THRESHOLD['1>2']) { st.level = 2; this._resetLevel(st); out.upgraded = true; }
      else if (!correct && sameWordErrors >= C.SAME_WORD_ERRORS_BREAK) { st.hardWord = true; out.break = true; }
    } else if (st.level === 2) {
      if (st.streak >= C.UPGRADE_THRESHOLD['2>3'] && st.levelAttempts >= 2) { st.level = 3; this._resetLevel(st); out.upgraded = true; }
      else if (!correct && sameWordErrors >= C.SAME_WORD_ERRORS_BREAK) { st.level = 1; this._resetLevel(st); st.hardWord = true; out.demote = true; }
    } else if (st.level === 3) {
      if (correct && !timedOut) {
        st.level = 4;
        st.intervalIdx = 0;
        st.nextDueAt = this._dateFromIndex(this._dayIndex(this._today()) + C.INTERVAL_LADDER_DAYS[0]);
        this._resetLevel(st); out.upgraded = true;
      } else if (!correct && C.DUE_MISTAKE_RESET) {
        st.level = 2; st.nextDueAt = null; this._resetLevel(st); st.hardWord = true; out.demote = true;
      }
      st.quizAudited = true;
    } else if (st.level === 4) {
      if (correct && !timedOut) {
        st.intervalIdx = Math.min((st.intervalIdx || 0) + 1, C.INTERVAL_LADDER_DAYS.length - 1);
        st.nextDueAt = this._dateFromIndex(this._dayIndex(this._today()) + C.INTERVAL_LADDER_DAYS[st.intervalIdx]);
      } else if (!correct && C.DUE_MISTAKE_RESET) {
        st.level = 2; st.nextDueAt = null; this._resetLevel(st); st.hardWord = true; out.demote = true;
      }
      st.quizAudited = true;
    }
    out.to = st.level;
    if (out.upgraded && round) round.upgraded.push({ wordId: c.entry && c.entry.wordId, senseId: c.senseId || null, from: out.from, to: out.to });
    if ((out.break || out.demote) && round) round.hardWords.push({ wordId: c.entry && c.entry.wordId, senseId: c.senseId || null, action: out.break ? 'break' : 'demote' });
    return out;
  },

  _resetLevel(st) { st.streak = 0; st.levelAttempts = 0; },

  /** 写入事件环形日志（上限 EVENT_LOG_CAP） */
  _record(ev) {
    const s = this.load();
    s.events.push(ev);
    if (s.events.length > this.CONFIG.EVENT_LOG_CAP) s.events = s.events.slice(-this.CONFIG.EVENT_LOG_CAP);
  },

  /** 在"满足 MIN_GAP_SAME_WORD 的最早位置"插入重考；不够就排到队尾 */
  _insertWithGap(queue, slot, wordId) {
    const gap = this.CONFIG.MIN_GAP_SAME_WORD;
    for (let i = gap; i <= queue.length; i++) {
      const between = queue.slice(0, i).filter(x => x.wordId !== wordId).length;
      if (between >= gap) { queue.splice(i, 0, slot); return i; }
    }
    queue.push(slot);
    return queue.length - 1;
  },

  /** §5.6 恢复题：从 L4 池随机取一个（必然答对）；没有 L4 返回 null */
  _recoverySlot(round, entries) {
    const cands = [];
    for (const entry of entries || []) {
      for (const sense of entry.senses || []) {
        const st = this.stateOf(entry.wordId, sense.senseId, false);
        if (st && st.level === 4) cands.push({ entry, sense });
      }
    }
    if (!cands.length) return null;
    const pick = cands[Math.floor(this._rand() * cands.length)];
    return {
      wordId: pick.entry.wordId, senseId: pick.sense.senseId, role: 'recovery',
      word: pick.entry.word, sense: pick.sense, entry: pick.entry, isRecovery: true,
    };
  },

  _explain(o) {
    const meaning = o.sense && o.sense.defZh ? o.sense.defZh : '';
    if (o.correct) return o.timedOut ? '有点犹豫，但答对了（算半次）' : '答对了，很熟练';
    const map = {
      polysemy: '选成了这个词的另一个义项 —— 一词多义混淆',
      confusable: '选成了形近词的释义 —— 形近混淆',
      timeout: '超时未作答',
      forgotten: '没记住这个释义',
    };
    return (map[o.errorType] || '答错了') + (meaning ? '。正确释义：' + meaning : '');
  },

  /** 轮末收尾：算 stuckRounds、写历史、生成报告（§5.8） */
  _closeRound(round) {
    const s = this.load();
    const byWord = {};
    for (const ev of round.results) {
      const k = ev.wordId + '#' + ev.senseId;
      if (byWord[k]) continue;                       // 每轮每词只结算一次
      byWord[k] = true;
      const st = this.stateOf(ev.wordId, ev.senseId, false);
      if (!st) continue;
      const upgraded = round.upgraded.some(x => x.wordId === ev.wordId);
      st.stuckRounds = upgraded ? 0 : (st.stuckRounds || 0) + 1;
    }
    round.finishedAt = this._now();
    round.report = this.report(round);
    s.rounds.push({
      roundId: round.roundId, mode: round.mode, today: round.today,
      startedAt: round.startedAt, finishedAt: round.finishedAt,
      attempts: round.attempts, errors: round.errors, truncated: round.truncated,
      report: round.report,
    });
    if (s.rounds.length > this.CONFIG.ROUND_HISTORY_CAP) s.rounds = s.rounds.slice(-this.CONFIG.ROUND_HISTORY_CAP);
    return round.report;
  },

  /** §5.8 报告（文案侧只给结构，正向框架由 UI 组织） */
  report(round) {
    const r = round || (this.load().round) || null;
    if (!r) return null;
    const durationMs = (r.finishedAt || this._now()) - (r.startedAt || this._now());
    const nextRoundFocus = [];
    for (const h of r.hardWords) if (!nextRoundFocus.includes(h.wordId)) nextRoundFocus.push(h.wordId);
    return {
      roundId: r.roundId,
      startedAt: r.startedAt,
      durationMs,
      quizzed: {
        total: r.quiz ? r.quiz.total : 0,
        passed: (r.results || []).filter(x => x.role === 'quiz' && x.correct).length,
      },
      upgraded: (r.upgraded || []).slice(),
      hardWords: (r.hardWords || []).slice(),
      roundErrorRate: r.attempts ? r.errors / r.attempts : 0,
      truncated: !!r.truncated,
      nextRoundFocus,
      total: (r.results || []).length,
      correct: (r.results || []).filter(x => x.correct).length,
    };
  },

  /* ================= 自评 / 跳过 / 教学揭晓 ================= */

  /** §6-#2 用户自评"我认识"：只能置 L3 + 抽检池；抽检错会打回 L2 */
  selfRateKnown(wordId, senseId) {
    const st = this.stateOf(wordId, senseId, true);
    st.level = 3;
    st.inQuizPool = true;
    st.quizAudited = false;
    st.streak = 0; st.levelAttempts = 0;
    this.save();
    return st;
  },

  /** 跳过 = 不主动教学但要保留复现路径（进抽检池） */
  skipSlot(wordId, senseId) { return this.selfRateKnown(wordId, senseId); },

  /**
   * 从**当前轮的执行队列**里消费掉一个词位（"熟悉 / 跳过 / 只看词条详情"这类
   * 不判分的操作）。
   * 【修复循环背同一个词】原来这些操作只改状态、不消费队列，`ViewVocab._advance`
   * 又会把整条 round.slots 重建回来 → 同一个词在本轮无限重复（用户反馈
   * "点熟悉，就会一直循环背这个单词"）。
   * 优先按**对象身份**移除：同一个词的重考位（wordId/senseId 相同）不能被误删。
   */
  consumeSlot(wordId, senseId, slotObj) {
    const s = this.load();
    const round = s.round;
    if (!round || round.finished) return false;
    let at = -1;
    if (slotObj) at = round.slots.indexOf(slotObj);
    else at = round.slots.findIndex(x => x.wordId === wordId && x.senseId === senseId
      && x.role !== 'retry');
    if (at < 0) return false;
    round.slots.splice(at, 1);
    if (!round.slots.length) { round.finished = true; this._closeRound(round); }
    this.save();
    return true;
  },

  /** 教学卡揭晓（新词"不认识"）：记一次教学，不判分；**本轮给它安排一道题**（否则
   *  用户"不认识"之后就再没机会在本轮记住它）。 */
  teachingReveal(wordId, senseId) {
    const s = this.load();
    const st = this.stateOf(wordId, senseId, true);
    st.attempts = Math.max(1, (st.attempts || 0) + 1);   // 只算"见过"，不算错（不进 errorRate）
    const round = s.round;
    let inserted = false;
    if (round && !round.finished) {
      /* 这个切片本来是"教 + 考"合一的：教学卡看完了，就把原词位取出来（变成已消费），
       * 再按 MIN_GAP 插一个重考位——这样"不认识"之后本轮仍有一次作答机会。*/
      const at = round.slots.findIndex(x => x.wordId === wordId && x.senseId === senseId);
      const origin = at >= 0 ? round.slots.splice(at, 1)[0] : null;
      const slot = {
        wordId, senseId, role: 'retry', isRetry: true,
        word: origin && origin.word, sense: origin && origin.sense, entry: origin && origin.entry,
      };
      this._insertWithGap(round.slots, slot, wordId);
      inserted = true;
    }
    this.save();
    return { state: st, inserted };
  },

  /** 轮外评分：随机练习 / 拼写练习这类"不计入轮"的作答，仍然走同一套判定与迁移
   *  （保证只有一份状态与一条迁移规则；不影响 current round 的统计）。
   * @returns {{correct:boolean, score:number, transition:object, feedback:object}} */
  gradeFree(o = {}) {
    const s = this.load();
    const st = this.stateOf(o.wordId, o.senseId, true);
    const limit = this.timeLimit(st.level === 4 ? 3 : st.level);
    const timedOut = (Number(o.responseMs) || 0) >= limit;
    const correct = !!o.correct;
    const score = correct ? (timedOut ? this.CONFIG.SCORE.hesitant : this.CONFIG.SCORE.fast) : 0;
    const errorType = correct ? null : (o.errorType || (timedOut ? 'timeout' : 'forgotten'));
    st.attempts = (st.attempts || 0) + 1;
    st.levelAttempts = (st.levelAttempts || 0) + 1;
    st.streak = Number(st.streak || 0) + score;
    st.lastGradedAt = new Date(this._now()).toISOString();
    if (!correct) {
      st.errors = (st.errors || 0) + 1;
      st.errorTypes = st.errorTypes || { polysemy: 0, confusable: 0, forgotten: 0, timeout: 0 };
      st.errorTypes[errorType] = (st.errorTypes[errorType] || 0) + 1;
    }
    if (score === this.CONFIG.SCORE.hesitant) {
      st.hesitationMsSum = (st.hesitationMsSum || 0) + (Number(o.responseMs) || 0);
      st.hesitantCount = (st.hesitantCount || 0) + 1;
    }
    const fakeRound = { results: [{ wordId: o.wordId, senseId: o.senseId, correct }], upgraded: [], hardWords: [] };
    const tr = this._transition({ st, entry: o.entry || null, correct, timedOut, score, errorType, levelBefore: st.level, round: fakeRound, senseId: o.senseId });
    this.save();
    return {
      correct, score, transition: tr,
      feedback: { correct, score, timedOut, errorType, levelBefore: tr.from, levelAfter: tr.to, upgraded: !!tr.upgraded, break: !!tr.break, demote: !!tr.demote },
    };
  },

  /* ================= 查询 ================= */

  /** 到期待复习的义项（L4 按 nextDueAt；UI 的"待复习"沿用 srs 镜像也能算） */
  dueCount(today) {
    const t = today || this._today();
    const s = this.load();
    let n = 0;
    for (const k in s.words) {
      const st = s.words[k];
      if ((st.level === 4 && st.nextDueAt && st.nextDueAt <= t)
        || (st.level === 1 || st.level === 2)) n++;
    }
    return n;
  },

  stats() {
    const s = this.load();
    let learned = 0, mastered = 0, reviewing = 0, hard = 0;
    for (const k in s.words) {
      const st = s.words[k];
      /* 已学 = 真正作答过的词；已掌握 = 到 L4 且作答过。
       * 定级会把整本词书批量写成 L1/L2/L3（不是用户学过），不能算"已学"；
       * 同理没作答过就被标 L4 的词也不该显示成"已掌握"（真机出现过 已学126 < 已掌握160）。*/
      if ((st.attempts || 0) > 0) learned++;
      if ((st.level || 0) >= 4 && (st.attempts || 0) > 0) mastered++;
      if (st.level === 1 || st.level === 2) reviewing++;
      if (st.hardWord) hard++;
    }
    return { learned, mastered, reviewing, hard, rounds: s.rounds.length };
  },

  /**
   * 【恢复新词】把某本词书里「引擎从未真正考过」的词恢复成 L0 新词。
   *
   * 为什么需要：词汇量测试只用了 40 道题，定级却会按频带把整本词书惰性写成
   * L1/L3（ensurePlacementLevel），旧进度迁移也会把整本书写成 L1+。结果「新词池」
   * 永久为 0，词书页一直显示「新词已学完」，用户没法再学每日新词。
   * 这里提供一个显式恢复：只动 levelAttempts === 0 的词（引擎没真正判过分），
   * 已经作答过的词一律不动；定级数据（skipBands / bandAccuracy 等）一并清空，
   * 否则这些词第一次进轮时又会被定回 L1/L3，恢复立刻失效。
   *
   * @returns {{count:number, words:string[]}} 恢复的词名（不含词书前缀），供 srs 镜像清理
   */
  releaseUnlearned(store, bookId, opts = {}) {
    const s = this.load(store);
    const prefix = String(bookId) + ':';
    const words = [];
    const seen = new Set();
    for (const key in s.words) {
      if (!key.startsWith(prefix)) continue;
      const st = s.words[key];
      if ((st.levelAttempts || 0) > 0) continue;          // 真考过：保留
      if (opts.keepMastered && (st.level || 0) >= 4) continue;
      const word = key.slice(prefix.length, key.lastIndexOf('#'));
      if (!seen.has(word)) { seen.add(word); words.push(word); }
      st.level = 0; st.streak = 0; st.levelAttempts = 0; st.attempts = 0;
      st.errors = 0; st.hesitationMsSum = 0; st.hesitantCount = 0;
      st.inQuizPool = false; st.quizAudited = false; st.nextDueAt = null;
      st.intervalIdx = 0; st.stuckRounds = 0; st.hardWord = false;
    }
    if (!opts.keepPlacement) {
      const u = s.user || {};
      u.skipBands = [];
      u.bandPlacement = null;
      u.bandAccuracy = {};
      u.placementCorrect = [];
      u.calibrationRoundsLeft = 0;
    }
    this.save(store);
    return { count: words.length, words };
  },

  /** 写回旧 srs 镜像（过渡期双写：树园/统计/设置页的旧读数继续有效） */
  mirrorToSrs(store, bookId, wordOf) {
    if (!store || !store.d) return 0;
    const s = this.load();
    store.d.srs = store.d.srs || {};
    const book = store.d.srs[bookId] = store.d.srs[bookId] || {};
    let n = 0;
    for (const k in s.words) {
      const st = s.words[k];
      const sep = k.lastIndexOf('#');
      const wordId = k.slice(0, sep);
      const word = wordOf ? wordOf(wordId) : wordId;
      /* 有层级或有作答记录才镜像（自评"我认识"只改层级、没有 attempts） */
      if (!word || (!st.attempts && !st.level)) continue;
      const next = st.nextDueAt ? new Date(st.nextDueAt + 'T00:00:00').getTime()
        : (st.level >= 3 ? this._now() + 30 * this.DAY : this._now());
      book[word] = {
        word, stage: Math.min(4, st.level), reps: st.attempts, lapses: st.errors,
        ef: 2.5, last: this._now(), next,
        /* Store.bookProgress 用 interval(天)>=21 判"已掌握"；旧镜像没写 interval，
         * 导致首页"掌握 0"。按引擎层级补：L4→30 天、L3→7 天。*/
        /* 与 stats() 的"已掌握"口径一致：L4 且作答过才算掌握（30 天）；
         * 定级批量写入的 L4 没作答，不能算掌握，否则首页会显示 126 已学 / 161 掌握。*/
        interval: (st.level >= 4 && (st.attempts || 0) > 0) ? 30 : (st.level === 3 ? 7 : 0),
        history: [{ t: this._now(), g: st.level }],
      };
      n++;
    }
    if (typeof store.flush === 'function') store.flush();
    return n;
  },
};

/** 轮内条目索引（_recoverySlot 用）：从 round.plan 反查不到 entry 时退回空表 */
function entriesOfRound(round) {
  const map = {};
  for (const slot of (round && round.slots) || []) if (slot.entry) map[slot.wordId] = slot.entry;
  return Object.keys(map).map(k => map[k]);
}
