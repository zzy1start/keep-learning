/* ============ garden.js : 种树养成系统 ============
 *
 * 核心规则（与遗忘曲线严格绑定，不可通过改代码绕过）：
 *
 *  1. 一次培育一棵树苗，成熟后在下一次学习时种新树
 *  2. 树的成长度 = 该词条当前的「记忆保持率 R」，由 SRS 的 E-Factor 驱动
 *  3. 状态判定（严格按 R 阈值，参照 SM-2 的遗忘模型）：
 *       R ≥ 0.85        → 健康成树（long）        可提供"收获"计数
 *       0.55 ≤ R < 0.85  → 暂时枯萎（withered）  继续学习会恢复
 *       R < 0.55         → 永久枯萎并砍成木桩（stump）永不恢复
 *  4. 恢复规则：树苗/枯萎树在再次复习成功（grade ≥ 2）后 R 回升，
 *     超过 0.55 即脱离枯萎；一旦成为木桩则永久保留，不可逆。
 *
 *  R 的计算（对每个已学词条）：
 *     R(t) = exp(-t / S)   其中 S = 稳定度 = ef * gap（天）
 *     t = 距上次复习的天数
 *  这与 SM-2 的间隔重复模型一致：间隔越长，遗忘越快。
 *  当 t == gap 时 R = e^-1 ≈ 0.368 < 0.55 → 判定枯萎，
 *  即"到期未复习"必然开始枯萎，符合艾宾浩斯遗忘规律。
 *
 * 树种：默认使用辽宁地区常见乡土树种（参考《沈阳市绿地树种名录》
 * 与辽宁数字植物标本馆）。用户可填写本校校树作为专属树种。
 */
const Garden = {
  /* ---------------- 树种库（辽宁常见 + 通用）---------------- */
  /* matureDays = 成熟所需天数（按树种生长速度设定：松柏慢、杨柳快）
   注意：这是"标尺"，不是硬性卡点——进度由保持率×时长共同决定 */
  SPECIES: [
    // 常绿针叶（东北主要造林/绿化树种）— 生长慢
    { id: 'yousong', name: '油松', latin: 'Pinus tabuliformis', kind: 'conifer', note: '辽宁省主要造林树种', local: true, matureDays: 90 },
    { id: 'zhangzisong', name: '樟子松', latin: 'Pinus sylvestris var. mongolica', kind: 'conifer', note: '辽西沙地主要树种，耐寒耐旱', local: true, matureDays: 90 },
    { id: 'larch', name: '落叶松', latin: 'Larix gmelini', kind: 'conifer', note: '兴安落叶松，东北乡土', local: true, matureDays: 75 },
    { id: 'picea', name: '红皮云杉', latin: 'Picea koraiensis', kind: 'conifer', note: '东北园林大量应用', local: true, matureDays: 80 },
    { id: 'cedar', name: '樟子桧', latin: 'Juniperus', kind: 'conifer', note: '耐寒常绿', local: true, matureDays: 100 },
    // 落叶阔叶 — 生长适中或较快
    { id: 'silverbirch', name: '白桦', latin: 'Betula platyphylla', kind: 'birch', note: '东北林区代表性树种', local: true, matureDays: 45 },
    { id: 'mongolianoak', name: '蒙古栎', latin: 'Quercus mongolica', kind: 'oak', note: '辽宁乡土，柞树，生态价值高', local: true, matureDays: 70 },
    { id: 'liaodongoak', name: '辽东栎', latin: 'Quercus liaodongensis', kind: 'oak', note: '辽宁东部乡土树种', local: true, matureDays: 70 },
    { id: 'ginkgo', name: '银杏', latin: 'Ginkgo biloba', kind: 'ginkgo', note: '沈阳常见绿化树种', local: true, matureDays: 80 },
    { id: 'scholar', name: '刺槐', latin: 'Robinia pseudoacacia', kind: 'legume', note: '辽宁主要造林树种，耐旱', local: true, matureDays: 40 },
    { id: 'poplar', name: '小青杨', latin: 'Populus pseudo-simonii', kind: 'poplar', note: '辽宁乡土树种，分布广', local: true, matureDays: 25 },
    { id: 'willow', name: '垂柳', latin: 'Salix babylonica', kind: 'willow', note: '北方常见绿化', local: true, matureDays: 22 },
    { id: 'ash', name: '水曲柳', latin: 'Fraxinus mandshurica', kind: 'ash', note: '东北珍贵阔叶树种', local: true, matureDays: 60 },
    { id: 'maple', name: '元宝槭', latin: 'Acer truncatum', kind: 'maple', note: '北方常见观赏树', local: true, matureDays: 50 },
    { id: 'pagoda', name: '国槐', latin: 'Sophora japonica', kind: 'locust', note: '北方庭院常见', local: true, matureDays: 65 },
    { id: 'elm', name: '榆', latin: 'Ulmus pumila', kind: 'elm', note: '乡土乔木，耐瘠薄', matureDays: 55 },
    { id: 'liquidambar', name: '枫杨', latin: 'Ptatycarya', kind: 'maple', note: '沈阳名录推荐树种', matureDays: 55 },
    { id: 'photinia', name: '紫叶李', latin: 'Prunus cerasifera', kind: 'ornamental', note: '校园常见观赏灌木', matureDays: 30 },
    // 通用/其他地区备选
    { id: 'camphor', name: '香樟', latin: 'Cinnamomum camphora', kind: 'evergreen', note: '南方常见', matureDays: 85 },
    { id: 'bamboo', name: '毛竹', latin: 'Phyllostachys edulis', kind: 'bamboo', note: '江南常见', matureDays: 20 },
    { id: 'pear', name: '梨树', latin: 'Pyrus', kind: 'pear', note: '春季开花', matureDays: 35 },
    { id: 'cherry', name: '樱花', latin: 'Cerasus', kind: 'blossom', note: '校园观赏', matureDays: 28 },
  ],

  /** 校树（用户填写） */
  SCHOOL_TREE: null,

  /* ---------------- 阈值：与遗忘曲线绑定 ---------------- */
  TH: {
    HEALTHY: 0.85,   // R ≥ 0.85 健康成树
    WITHER: 0.55,    // 0.55 ≤ R < 0.85 暂时枯萎
    // R < 0.55 → 永久枯萎，砍成木桩
  },

  /* ---------------- 记忆保持率计算 ---------------- */
  /**
   * 记忆保持率 R（指数遗忘曲线，与 SM-2 的间隔重复一致）
   *   R(t) = e^(−t / S)，S = ef × gap（稳定度，天）
   *
   * 说明：刚复习完 R=1；t=gap（到期）时 R=e⁻¹≈37%。
   * 掌握度高（ef大→间隔长）的词即使过了很久，R 仍可能 >55%，不会枯萎——
   * 这符合实际：牢固的记忆确实更耐久。
   */
  retention(rec) {
    if (!rec || !rec.last || !rec.gap) return 1;
    const S = Math.max(0.15, (rec.ef || 2.5) * rec.gap);
    const t = Math.max(0, (Date.now() - rec.last) / 864e5);
    return Math.exp(-t / S);
  },

  /** 是否已到期未复习（超过下次复习时间） */
  isOverdue(rec) {
    return !!(rec && rec.next && rec.next <= Date.now());
  },

  /**
   * 计算全书的加权平均保持率（用于园子整体状态）
   */
  bookRetention(bookId) {
    const recs = Store.d.srs[bookId] || {};
    const vals = Object.keys(recs)
      .filter(k => !recs[k].skipped)          // 跳过的不算
      .map(k => this.retention(recs[k]));
    if (!vals.length) return 1;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },

  /* ---------------- 每日学习质量评估 ---------------- */
  /**
   * 评估某一天的学习「质量」，返回0~1 的成长系数。
   * 四项加权：单词、听力、阅读、写作 + 时长 + 正确率。
   *
   * 设计意图：不只看"学了多少词"，还看"学得对不对、花了多久"。
   * 只刷数量不刷质量 → 成长系数低，树长得慢（防止刷时长作弊）。
   */
  dailyQuality(dateKey) {
    const day = (Store.d.stats.daily || {})[dateKey];
    if (!day) return { q: 0.6, parts: {}, empty: true };

    const parts = {};
    // 1) 各模块练习量（每项 0~1，20 词/2 次听力/1 篇阅读/1 篇写作 记满）
    const caps = { words: 20, listen: 2, read: 1, write: 1 };
    for (const k of ['words', 'listen', 'read', 'write']) {
      parts[k] = Math.min(1, (day[k] || 0) / caps[k]);
    }
    // 2) 时长（10~45 分钟为最佳区间，太短没投入、过长是低效）
    const min = (day.seconds || 0) / 60;
    parts.time = min < 5 ? min / 5 * 0.5
      : min <= 45 ? 1
        : min <= 90 ? 0.85
          : 0.6;
    // 3) 正确率（无数据时按 0.7 计，不惩罚只练不看分的情况）
    const acc = day.acc && day.acc.t > 0 ? day.acc.c / day.acc.t : 0.7;
    parts.acc = Math.max(0, Math.min(1, acc));

    // 加权求和：练习量 45% + 时长 20% + 正确率 35%
    const q = parts.words * 0.14 + parts.listen * 0.10 + parts.read * 0.11
      + parts.write * 0.10 + parts.time * 0.20 + parts.acc * 0.35;

    return {
      q: Math.max(0.05, Math.min(1, q)),
      parts, minutes: min, acc,
      count: ['words', 'listen', 'read', 'write'].map(k => `${kMap(k)} ${day[k] || 0}`).join(' · '),
    };
  },

  /* ================= 铁树开花（铁树：连续学习的表彰） =================
 *
 * 出自成语「铁树开花」——比喻极难实现的事终于实现。
 * 这里用作学习表彰：
 *   1. 连续学习满 TH.GROW 天 → 园中长出一棵铁树（始终不长大的那种树）
 *   2. 铁树在满足额外条件时开花，条件越苛刻花越珍贵
 *
 * 开花条件（全部满足才开）：
 *   - 连续学习天数 ≥ 30（铁树本身就象征长期坚持）
 *   - 累计学习天数 ≥ 60
 *   - 平均记忆保持率 ≥ 80%（真的记住了，不是天天打卡）
 *   - 平均学习质量 ≥ 70%（练得认真，不是敷衍）
 *   - 掌握词汇量 ≥ 500
 *
 * 开过花的铁树会保留开花记录，可再次开花（达成更高连续天数时）。
 */
  IRON: {
    GROW_DAYS: 30,      // 连续学习多少天"园中出现它"
    BLOOM: {            // 开花条件（全部满足）
      streak: 30,      // 连续天数
      totalDays: 60,   // 累计天数
      avgR: 0.80,      // 平均记忆保持率
      avgQ: 0.70,      // 平均学习质量
      // 掌握词数已按用户要求移除
    },
  },

  /** 计算铁树状态 */
  ironState() {
    const g = this._g();
    const st = Store.d.stats;
    const streak = st.streak || 0;
    const totalDays = (st.days || []).length;

    // 平均记忆保持率：所有非跳过词条的 R 均值
    let R = 1, n = 0, words = 0;
    for (const bid in Store.d.srs) {
      const recs = Store.d.srs[bid];
      for (const w in recs) {
        const r = recs[w];
        if (r.skipped) continue;
        if (r.reps > 0) words++;
        R += this.retention(r); n++;
      }
    }
    if (n) R = (R - 1) / n;

    // 平均学习质量：所有有记录日的质量均值
    let Q = 0, qn = 0;
    for (const d in (st.daily || {})) {
      const q = this.dailyQuality(d);
      if (!q.empty) { Q += q.q; qn++; }
    }
    if (qn) Q /= qn;

    const cond = [
      { k: '连续学习', need: this.IRON.BLOOM.streak, cur: streak, u: '天' },
      { k: '累计学习', need: this.IRON.BLOOM.totalDays, cur: totalDays, u: '天' },
      { k: '记忆保持', need: Math.round(this.IRON.BLOOM.avgR * 100), cur: Math.round(R * 100), u: '%' },
      { k: '学习质量', need: Math.round(this.IRON.BLOOM.avgQ * 100), cur: Math.round(Q * 100), u: '%' },
    ];
    const met = cond.filter(c => c.cur >= c.need).length;
    const allOk = met === cond.length;

    // 是否已长出（连续 ≥ GROW_DAYS）
    const grown = streak >= this.IRON.GROW_DAYS || (g.iron && g.iron.plantedAt);

    // 开花次数
    const blooms = (g.iron && g.iron.blooms) || [];

    return {
      grown, allOk, met, total: cond.length, cond,
      R, Q, words, streak, totalDays, blooms,
      nextBloomAt: allOk
        ? null
        : Math.max(...cond.filter(c => c.cur < c.need).map(c => c.need)) ,
      // 进度 0~1：已满足条件数占比 + 最接近达成项的进度
      progress: met / cond.length,
      // 最近一次开花距今天数
      lastBloom: blooms.length ? blooms[blooms.length - 1].date : null,
      daysToBloom: allOk ? 0 : Math.min(...cond.filter(c => c.cur < c.need).map(c => c.need - c.cur)),
    };
  },

  /** 尝试开花（达成条件时调用） */
  tryBloom() {
    const s = this.ironState();
    if (!s.allOk) return null;
    const g = this._g();
    g.iron = g.iron || { blooms: [] };
    const today = App.today();
    // 同一天只开一次
    if (g.iron.blooms.some(b => b.date === today)) return null;
    const rec = {
      date: today,
      at: Date.now(),
      streak: s.streak,
      totalDays: s.totalDays,
      R: Math.round(s.R * 100),
      Q: Math.round(s.Q * 100),
      words: s.words,
    };
    g.iron.blooms.push(rec);
    g.iron.plantedAt = g.iron.plantedAt || Date.now();
    this._save(g);
    return rec;
  },

    /**
   * 计算树苗的「成长进度」0~1
   *
   * 依据 = 该树关联词条的平均记忆保持率，
   * 并以树种自身的「成熟所需时长」作为成长速度标尺：
   *   慢成树种（如银杏 60天）需要更长的累计投入才能长成；
   *   快成树种（如杨树 20 天）短时间即可成熟。
   *
   * 这样"累计英语学习时长 + 质量"真正决定了树的成长，
   * 而不是所有人同一天种下、同一天长成。
   */
  growthOf(tree) {
    if (tree.trackingVersion === 2) {
      const span = Math.max(1, this.infoOf(tree.species).matureDays || 30);
      return Math.min(1, (tree.investedMin || 0) / (span * 20));
    }
    const recs = tree.words
      .map(w => (Store.d.srs[w.book] || {})[w.word])
      .filter(Boolean);
    if (!recs.length) return tree.growth || 0;
    const R = recs.reduce((a, r) => a + this.retention(r), 0) / recs.length;
    const info = this.infoOf(tree.species);
    const span = Math.max(1, info.matureDays || 30);   // 成熟所需时长（天）
    // 累计投入时长（该树从种下到今天的学习分钟数）
    const invested = this.investedMinutes(tree);
    // 进度 = 记忆保持率 × 时长达成率（两者都达标才算成熟）
    const timeRatio = Math.min(1, invested / (span * 20));   // 每天约20分钟为满投入
    /* 质量上限：质量低时即使记得牢也长不满。
     * 但质量与时长都达标时应能满进度（cap → 1.0），
     * 否则卡片永远停在 98% 这样的数字上，看不出"成树"。*/
    const q = tree.quality || 0.6;
    const cap = 0.55 + 0.45 * q;
    const raw = R * 0.6 + timeRatio * 0.4;
    // 双重达标（保持率高 + 时长足）时允许满进度
    const full = R >= 0.85 && timeRatio >= 1;
    return Math.max(0, Math.min(full ? 1 : cap, raw));
  },

  /** 某棵树累计投入的学习分钟数 */
  investedMinutes(tree) {
    if (tree.trackingVersion === 2) return tree.investedMin || 0;
    // 统计该树种下当天到今天的学习时长
    let mins = 0;
    const start = this._ts(tree.date);
    for (const d in (Store.d.stats.daily || {})) {
      if (this._ts(d) < start) continue;
      const day = Store.d.stats.daily[d];
      mins += (day.seconds || 0) / 60;
    }
    return Math.round(mins);
  },

  /* ---------------- 树的状态 ---------------- */
  /**
   * 状态判定（阈值固定，不可通过改代码绕过）
   *
   * 依据艾宾浩斯遗忘曲线 + SM-2 间隔重复：
   *   R ≥ 0.85                  → 健康成树 long
   *   0.55 ≤ R < 0.85且已逾期   → 暂时枯萎 withered（可恢复）
   *   0.55 ≤ R < 0.85 但未逾期   → 仍算成长中 young（还没到复习点，不算忘）
   *   R < 0.55且已逾期           → 永久枯萎 dead → 砍成木桩 stump
   *   R < 0.55 但未逾期          → 暂时枯萎 withered（临界，先给一次机会）
   *
   * 「已逾期」= next 时间已过。到期当天复习 R=e⁻¹≈37%，必然进入枯萎区，
   * 这正是设计意图：不复习就会看到树枯萎。
   */
  stateOf(R, overdue) {
    const od = !!overdue;
    if (R >= this.TH.HEALTHY) return 'long';
    if (R >= this.TH.WITHER) return od ? 'withered' : 'young';
    return od ? 'dead' : 'withered';
  },

  /* ---------------- 种树 / 养护 ---------------- */
  /**
   * 记录一天的学习 → 种一棵苗
   * 学习时调用；未成熟树继续培育，成熟后再种新树
   */
  plantDay(dateKey) {
    const g = this._g();
    const active = [...g.trees].reverse().find(t => t.state !== 'stump' && t.growth < 1);
    if (active) return active;
    const idx = g.trees.length;
    const tree = {
      id: 'tree' + Date.now() + '_' + idx,
      date: dateKey,
      species: this._pickSpecies(),
      growth: 0,            // 0~1 成长度
      R: 1,                 // 记忆保持率
      state: 'sapling',     // sapling | young | long | withered | stump
      words: [],            // 当天学的词（关联遗忘曲线）
      quality: 0.6,         // 当日学习质量系数（0~1）
      qualityParts: null,   // 质量明细（四项+时长+正确率）
      history: [{ t: Date.now(), R: 1, state: 'sapling' }],
      stumpAt: null,
      plantedAt: this._ts(dateKey),
      investedMin: 0,
      trackingVersion: 2,
    };
    g.trees.push(tree);
    this._save(g);
    return tree;
  },

  /** 记录今天学的单词（关联到今天的树） */
  noteWord(word, bookId) {
    const g = this._g();
    const today = App.today();
    let tree = [...g.trees].reverse().find(t => t.state !== 'stump' && t.growth < 1);
    if (!tree) { tree = this.plantDay(today); if (!tree) return; }
    if (!tree.words.some(w => w.word === word)) {
      tree.words.push({ word, book: bookId });
      this._save(g);
    }
  },

  /** 将本次有效学习时长只记给当前树，旧树的时长不再增加。 */
  recordActivity(seconds) {
    const tree = this.plantDay(App.today());
    if (!tree || tree.trackingVersion !== 2) return;
    tree.investedMin = (tree.investedMin || 0) + seconds / 60;
    tree.growth = this.growthOf(tree);
    this._save(this._g());
  },

  /**
   * 刷新所有树的状态（每次打开页面时调用）
   * 规则：R = 其关联词条的平均保持率；复习成功会提升对应词的 ef
   */
  refresh() {
    const g = this._g();
    const now = Date.now();
    let changed = 0;

    for (const t of g.trees) {
      // 更新当日学习质量（四模块+时长+正确率）
      const dq = this.dailyQuality(t.date);
      t.quality = dq.q;
      t.qualityParts = dq.parts;

      if (t.state === 'stump') continue;         // 木桩不可逆，跳过
      const recs = t.words
        .map(w => (Store.d.srs[w.book] || {})[w.word])
        .filter(Boolean);

      // 没有关联词条时，用"距今天数"做兜底衰减（保证未学习时树会慢慢长）
      let R, overdue;
      if (recs.length) {
        R = recs.reduce((a, r) => a + this.retention(r), 0) / recs.length;
        overdue = recs.some(r => this.isOverdue(r));   // 任一到期即算逾期
      } else {
        // 兜底：以 30 天为稳定度衰减
        const days = (now - (t.plantedAt || (t.plantedAt = this._ts(t.date)))) / 864e5;
        R = Math.exp(-days / 30);
        // 超过 30 天（一个稳定度周期）视为逾期
        overdue = days >= 30;
      }

      const st = this.stateOf(R, overdue);
      const prev = t.state;
      /* 成长度 = f(记忆保持率, 累计投入时长, 学习质量, 树种成熟期)
       * 见 growthOf()。这样「时长 × 质量」才真正决定树的成长，
       * 而且不同树种有各自的成熟节奏（松柏慢、杨柳快）。
       */
      t.R = R;
      t.growth = t.trackingVersion === 2
        ? Math.max(t.growth || 0, this.growthOf(t)) : this.growthOf(t);
      t.investedMin = this.investedMinutes(t);
      t.state = st;
      t.overdue = overdue;

      if (st !== prev) {
        t.history.push({ t: now, R: +R.toFixed(3), state: st });
        t.history = t.history.slice(-30);
        if (st === 'dead' && prev !== 'stump') {
          t.state = 'stump';
          t.stumpAt = now;
        }
        changed++;
      }
    }
    if (changed) this._save(g);
    return g;
  },

  /** 统计 */
  stats() {
    const g = this.refresh();
    const c = { sapling: 0, young: 0, long: 0, withered: 0, stump: 0 };
    g.trees.forEach(t => { c[t.state] = (c[t.state] || 0) + 1; });
    return {
      counts: c,
      total: g.trees.length,
      alive: c.sapling + c.young + c.long,
      avgR: g.trees.length
        ? g.trees.reduce((a, t) => a + (t.state === 'stump' ? 0 : t.R || 0), 0)
        / Math.max(1, g.trees.filter(t => t.state !== 'stump').length) : 1,
      speciesUsed: [...new Set(g.trees.map(t => t.species))].length,
    };
  },

  /* ---------------- 校树设置 ---------------- */
  setSchoolTree(name, note) {
    const g = this._g();
    g.schoolTree = { name, note: note || '', at: new Date().toISOString() };
    this._save(g);
  },
  clearSchoolTree() {
    const g = this._g(); delete g.schoolTree; this._save(g);
  },

  /* ---------------- 存储 ---------------- */
  _g() {
    Store.d.garden = Store.d.garden || { trees: [], schoolTree: null, version: 1 };
    return Store.d.garden;
  },
  _save(g) {
    // 只存必要字段，避免 localStorage 膨胀
    Store.d.garden = g;
    Store.flush();
  },
  _ts(dateStr) {
    const d = new Date(dateStr + 'T08:00:00');
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
  },

  /* ---------------- 树种选择 ---------------- */
  _pickSpecies() {
    const g = this._g();
    // 校树占比高：40% 概率种校树（若已设置）
    if (g.schoolTree && Math.random() < 0.4) return g.schoolTree.name;
    // 本地树种优先 70%
    const locals = this.SPECIES.filter(s => s.local);
    const pool = Math.random() < 0.7 && locals.length ? locals : this.SPECIES;
    return pool[Math.floor(Math.random() * pool.length)].name;
  },
  /** 树种信息（可能是校树） */
  infoOf(name) {
    return this.SPECIES.find(s => s.name === name)
      || (this._g().schoolTree && this._g().schoolTree.name === name
        ? {
          id: 'school', name, latin: '', kind: 'school', note: '本校校树',
          matureDays: 120,       // 校树作为象征，设定较慢的成熟节奏
        } : null)
      || { id: 'unknown', name, latin: '', kind: 'unknown', note: '', matureDays: 30 };
  },
};
window.Garden = Garden;

function kMap(k) {
  return { words: '单词', listen: '听力', read: '阅读', write: '写作' }[k] || k;
}
