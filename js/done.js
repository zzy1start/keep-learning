/* ============ done.js : 「已做过」状态（只读汇总） ============
 * 听力 / 阅读：提交作答时已写入 Store.d.listenLog / readLog（key = 篇目 id）。
 * 写作 / 翻译：评分成功写入 Store.d.writeLog（新记录带 taskId，旧记录按题目文本保守匹配）。
 * 本文件不新增持久化字段、不改判分与统计口径，只把"做过没有 / 上次多少分"读出来，
 * 供 Picker 下拉、篇目快捷标签与页头徽章统一使用。
 */
const DoneBook = {
  /** 归一成 { at, score, total }；score/total 保留原始数值，显示时再格式化。 */
  _rec(score, total, at) {
    return { at: Number(at) || 0, score: Number(score) || 0, total: Number(total) || 0 };
  },

  _ofListenRead(kind, item) {
    const id = item && item.id != null ? String(item.id) : '';
    if (!id) return null;
    const log = kind === 'listening' ? Store.d.listenLog : Store.d.readLog;
    if (!log || typeof log !== 'object') return null;
    let rec = log[id];
    /* 共用听力的"第 N 套"是同一套录音的副本，id 形如 xxx-shared-2。
     * 用户在第 1 套做过之后，第 2 套（共用）也应显示已做，否则整卷进度会少算。*/
    if (!rec && /-shared-\d+$/.test(id)) rec = log[id.replace(/-shared-\d+$/, '')];
    if (!rec || typeof rec !== 'object') return null;
    return this._rec(rec.score, rec.total, rec.at);
  },

  _ofWrite(kind, item) {
    if (!item) return null;
    const log = Array.isArray(Store.d.writeLog) ? Store.d.writeLog : [];
    if (!log.length) return null;
    const id = item.id != null ? String(item.id) : '';
    const title = String(item.title || item.en || '').trim();
    const prompt = String(item.prompt || '').trim();
    const text = String(item.translationText || item.cn || '').trim();
    for (const rec of log) {
      if (!rec || typeof rec !== 'object') continue;
      const isTr = rec.kind === 'translation';
      if (kind === 'translation' ? !isTr : isTr) continue;
      /* 只"保存草稿"的记录没有分数（score/max 都为空），不算做过；
       * 否则用户刚点保存就被标成已做，反而误导。*/
      if (!isTr && rec.score == null && rec.max == null) continue;
      if (id && rec.taskId != null && String(rec.taskId) === id) {
        return this._rec(rec.score, rec.max, rec.at);
      }
      const t = String(rec.task || rec.title || '').trim();
      if (!t) continue;
      /* 旧记录没有 taskId：只做完全相等 / 前缀相等，不做 includes。
       * 同一题材的作文题很多，宽松匹配会把"没写过"误标成"已做"。*/
      if (title && (t === title || (title.length >= 8 && t.startsWith(title)))) {
        return this._rec(rec.score, rec.max, rec.at);
      }
      if (prompt && t === prompt) return this._rec(rec.score, rec.max, rec.at);
      if (text && (t === text || (text.length >= 12 && t.startsWith(text.slice(0, 24))))) {
        return this._rec(rec.score, rec.max, rec.at);
      }
    }
    return null;
  },

  /** 某道题 / 某篇的完成记录；没做过返回 null。 */
  of(kind, item) {
    if (!item || !Store.d) return null;
    if (kind === 'listening' || kind === 'reading') return this._ofListenRead(kind, item);
    if (kind === 'writing' || kind === 'translation') return this._ofWrite(kind, item);
    return null;
  },

  _n(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
  },

  /** 得分率（0-100 整数）；没有满分信息时返回 0。 */
  percent(rec) {
    if (!rec || !(rec.total > 0)) return 0;
    return Math.max(0, Math.min(100, Math.round(rec.score / rec.total * 100)));
  },

  /** 下拉选项 / 快捷标签用的短标记：'✓已做 85%'；没做过返回空串。 */
  label(kind, item) {
    const rec = this.of(kind, item);
    if (!rec) return '';
    const p = this.percent(rec);
    return p ? '✓已做 ' + p + '%' : '✓已做';
  },

  /** 页头 / 详情用的长标记：'上次 8.5 / 10 分（85%）'。 */
  detail(kind, item) {
    const rec = this.of(kind, item);
    if (!rec) return '';
    const p = this.percent(rec);
    if (!(rec.total > 0)) return '已提交过';
    return '上次 ' + this._n(rec.score) + ' / ' + this._n(rec.total) + ' 分' + (p ? '（' + p + '%）' : '');
  },
};
window.DoneBook = DoneBook;
