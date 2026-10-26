/* ============ srs.js : 遗忘曲线调度（SM-2 简化版）============ */const SRS = {
  STAGES: ['新词', '学习中', '短期', '中期', '长期'],
  /** grade: 0=忘了 1=模糊 2=会 3=很熟 */
  intervals: [
    [0, 1, 2, 4],       // stage 0
    [1, 1, 2, 3],       // stage 1
    [2, 3, 6, 10],      // stage 2
    [6, 9, 15, 25],     // stage 3
    [14, 22, 35, 60],   // stage 4+
  ],
  DAY: 864e5,

  /** 计算下一次复习 */
  schedule(rec, grade) {
    const stage = rec.stage || 0;
    const row = this.intervals[Math.min(stage, this.intervals.length - 1)];
    let gap = row[grade];
    // E-Factor 调整
    let ef = rec.ef ?? 2.5;
    ef = ef + (0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
    ef = Math.max(1.3, Math.min(2.8, ef));

    let newStage, reps = (rec.reps || 0) + 1, lapses = rec.lapses || 0;
    if (grade === 0) {
      newStage = 0; lapses++;
      gap = 0.007; // 10 分钟后重来
    } else if (grade === 1) {
      newStage = Math.max(0, Math.min(stage, 1));
    } else if (grade === 2) {
      newStage = stage + 1;
    } else {
      newStage = stage + 2;
    }
    return {
      word: rec.word, ef, reps, lapses,
      stage: Math.min(newStage, this.STAGES.length - 1),
      gap,
      last: Date.now(),
      next: Date.now() + gap * this.DAY,
      history: (rec.history || []).concat([{ t: Date.now(), g: grade }]).slice(-20),
    };
  },

  /** 描述下次复习间隔 */
  describe(rec) {
    if (!rec || !rec.next) return '未学习';
    const ms = rec.next - Date.now();
    if (ms <= 0) return '待复习';
    const h = ms / 36e5;
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分钟后';
    if (h < 24) return Math.round(h) + ' 小时后';
    return Math.round(h / 24) + ' 天后';
  },

  stageName(s) { return this.STAGES[Math.min(s || 0, this.STAGES.length - 1)]; },
};
window.SRS = SRS;