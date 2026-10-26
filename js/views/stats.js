/* ============ views/stats.js : 统计 ============ */
const ViewStats = {
  /** 近 14 天明细：统计页表格与「学习报告 PDF」共用，只有一处口径 */
  _recent14() {
    const daily = (Store.d.stats && Store.d.stats.daily && typeof Store.d.stats.daily === 'object')
      ? Store.d.stats.daily : {};
    const recent = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 864e5);
      const k = App.fmtDate(dt);
      /* 保存过的存档里 daily[k] 可能是 null（旧版本/手工改过/导入了一半），
       * 所以先兜成 {}，不能直接读属性——一抛错的表现就是"点了没反应"。*/
      const s = (daily[k] && typeof daily[k] === 'object') ? daily[k] : {};
      recent.push({
        date: k.slice(5),
        words: s.words || 0, listen: s.listen || 0, read: s.read || 0,
        write: s.write || 0, min: s.min || 0,
      });
    }
    return recent;
  },

  /**
   * 学习报告的数据快照。
   * 【为什么抽成一个方法】两个入口（统计页顶部按钮 / 设置页「数据管理 → 学习报告 PDF」）
   * 必须导出完全一样的东西。旧实现是"跳到统计页 → 等 300ms → 点统计页的按钮"，
   * 依赖另一个页面渲染成功，且失败时**没有任何提示**（用户只看到点了没反应）。
   * 现在设置页直接调用 exportReport()，不再有这条接力链。
   * 【脏存档防线】存档里的数组可能混着 null / 字符串条目，直接读属性会抛错，
   * 而这个错误过去是静默的（报告导不出来，也没报错），所以这里逐项过滤。
   */
  reportData() {
    const d = Store.d || {};
    const st = (d.stats && typeof d.stats === 'object') ? d.stats : {};
    const days = Array.isArray(st.days) ? st.days : [];
    const daily = (st.daily && typeof st.daily === 'object' && !Array.isArray(st.daily)) ? st.daily : {};

    const objs = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object');
    const notebook = objs(d.notebook);
    const writeLog = objs(d.writeLog);
    const readLogs = objs(Object.values((d.readLog && typeof d.readLog === 'object') ? d.readLog : {}));
    const srs = (d.srs && typeof d.srs === 'object' && !Array.isArray(d.srs)) ? d.srs : {};

    const wordTotal = Object.keys(srs).reduce((n, b) => {
      const per = (srs[b] && typeof srs[b] === 'object' && !Array.isArray(srs[b])) ? srs[b] : {};
      return n + Object.keys(per).filter(k => per[k] && per[k].reps > 0).length;
    }, 0);
    const writeScores = writeLog.filter(x => x.score != null);
    const avgWrite = writeScores.length
      ? (writeScores.reduce((n, x) => n + (Number(x.score) || 0), 0) / writeScores.length).toFixed(1) : '—';
    const readRate = readLogs.length
      ? Math.round(readLogs.reduce((n, r) => n + (Number(r.score) || 0) / (Number(r.total) || 1), 0) / readLogs.length * 100) : 0;

    const bookProg = {}, bookTotal = {};
    (typeof BOOKS !== 'undefined' ? BOOKS : []).forEach(b => {
      let p = null;
      try { p = Store.bookProgress(b.id); } catch (e) { p = null; }   // 词书进度坏了也不能挡住报告
      if (p && p.total) { bookProg[b.id] = p; bookTotal[b.id] = p.total; }
    });

    return {
      streak: st.streak || 0, totalDays: days.length,
      firstDay: d.createdAt,
      words: wordTotal, nb: notebook.length, nbMastered: notebook.filter(x => x.mastered).length,
      listen: Object.values(daily).reduce((n, s) => n + ((s && s.listen) || 0), 0),
      read: readLogs.length, readRate,
      write: writeLog.length, writeScore: avgWrite,
      bookProg, bookTotal, recent: this._recent14(),
    };
  },

  /** 生成学习报告 PDF。失败必须说话：失败静默正是"点了没反应"的来源。 */
  exportReport() {
    try {
      PDF.report(this.reportData());
      return true;
    } catch (e) {
      App.toast('学习报告导出失败：' + ((e && e.message) || e), 'err');
      console.error(e);
      return false;
    }
  },

  render(root) {
    root = App.freshView();
    const d = Store.d;
    const st = d.stats;
    const days = st.days;
    const today = App.today();

    /* 近 14 天明细：与「学习报告 PDF」共用同一份计算（_recent14），两处口径不会漂移 */
    const recent = this._recent14();
    const wk = recent.slice(-7), pwk = recent.slice(0, 7);
    const sum = (a, k) => a.reduce((n, x) => n + x[k], 0);
    const weekTotal = ['words', 'listen', 'read', 'write'].reduce((n, k) => n + sum(wk, k), 0);
    const prevTotal = ['words', 'listen', 'read', 'write'].reduce((n, k) => n + sum(pwk, k), 0);

    const wordTotal = Object.keys(d.srs).reduce((n, b) =>
      n + Object.keys(d.srs[b]).filter(k => d.srs[b][k].reps > 0).length, 0);
    const writeScores = d.writeLog.filter(x => x.score != null);
    const avgWrite = writeScores.length
      ? (writeScores.reduce((n, x) => n + x.score, 0) / writeScores.length).toFixed(1) : '—';
    const readLogs = Object.values(d.readLog);
    const readRate = readLogs.length
      ? Math.round(readLogs.reduce((n, r) => n + r.score / r.total, 0) / readLogs.length * 100) : 0;

    const bookProg = {}, bookTotal = {};
    BOOKS.forEach(b => {
      const p = Store.bookProgress(b.id);
      if (p.total) { bookProg[b.id] = p; bookTotal[b.id] = p.total; }
    });
    /* 「已掌握」统一按词书口径（L4 且作答过，srs interval>=21）算，
     * 与完成页、首页、各词书进度一致；生词本里手动标的掌握是另一件事，
     * 在生词本页叫「手动标记」，避免同一个词两个数（走查发现）。*/
    const masteredTotal = Object.values(bookProg).reduce((n, p) => n + (p.mastered || 0), 0);

    const byDay = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 864e5);
      const k = App.fmtDate(dt);
      const s = st.daily[k] || {};
      const total = (s.words || 0) + (s.listen || 0) + (s.read || 0) + (s.write || 0);
      byDay.push({ k: ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()], v: total });
    }

    root.innerHTML = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-nav="home">← 返回</button>
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></div>
      <div>
        <h1>学习统计</h1>
        <div class="sub">数据仅保存在你的浏览器本地</div>
      </div>
    </div>

    <div class="grid g4">
      ${[
      ['连续学习', st.streak || 0, '天', 'var(--pri)'],
      ['累计学习', days.length, '天', 'var(--purple)'],
      ['本周学习量', weekTotal, '次', 'var(--ok)'],
      ['已学单词', wordTotal, '词', 'var(--warn)'],
    ].map(([k, v, u, c]) => `<div class="stat"><div class="k">${k}</div>
        <div class="v" style="color:${c}">${v}<small>${u}</small></div></div>`).join('')}
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <div class="card-h">近 7 天学习量<span class="r"><span class="tag ${weekTotal >= prevTotal ? 'tag-ok' : 'tag-warn'}">
          较上周 ${weekTotal >= prevTotal ? '+' : ''}${prevTotal ? Math.round((weekTotal - prevTotal) / prevTotal * 100) : 0}%</span></span></div>
        <div class="card-b">${App.bars(byDay, 100)}</div>
      </div>
      <div class="card">
        <div class="card-h">学习进度</div>
        <div class="card-b stat-big">
          <div class="ring-box">
            ${App.ring(Math.min(1, wordTotal / 3000), 110)}
            <div class="txt"><b>${Math.min(100, Math.round(wordTotal / 3000 * 100))}%</b><span>3000词目标</span></div>
          </div>
          <div style="flex:1">
            ${[['生词本', d.notebook.length, '词', '#7c5cff'], ['已掌握', masteredTotal, '词', '#12b76a'],
      ['阅读篇数', readLogs.length, '篇', '#2f6bff'], ['阅读均分率', readRate, '%', '#f79009'],
      ['写作篇数', d.writeLog.length, '篇', '#ec4899'], ['写作均分', avgWrite, '分', '#0ea5e9']]
          .map(([k, v, u, c]) => `<div class="dim-row"><span class="n">${k}</span>
            <span class="bar ${v ? '' : 'warn'}"><i style="width:${Math.min(100, v)}%;background:${c}"></i></span>
            <span class="s">${v}${u}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <div class="card-h">各词书进度</div>
        <div class="card-b">
          ${Object.keys(bookProg).length ? Object.keys(bookProg).map(id => {
      const b = BOOKS.find(x => x.id === id), p = bookProg[id], tot = bookTotal[id];
      const pct = Math.min(100, Math.round(p.learned / tot * 100));
      return `<div style="margin-bottom:13px">
              <div class="row" style="margin-bottom:5px;font-size:13px">
                <b>${b.name}</b><span class="tag">${b.sub}</span><span class="sp"></span>
                <span style="color:var(--tx3)">${p.learned}/${tot} · 掌握 ${p.mastered}</span></div>
              <div class="bar ok"><i style="width:${pct}%"></i></div></div>`;
    }).join('') : '<div class="empty"><p>还没有学习记录</p></div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-h">近 14 天明细</div>
        <div class="card-b" style="overflow-x:auto">
          <table style="width:100%;font-size:12.5px;border-collapse:collapse">
            <tr style="color:var(--tx3);font-size:11.5px">
              <th style="text-align:left;padding:5px">日期</th><th>单词</th><th>听力</th><th>阅读</th><th>写作</th><th>分钟</th></tr>
            ${recent.slice().reverse().map(r => `<tr style="border-top:1px solid var(--line)">
              <td style="padding:5px">${r.date}</td>
              <td style="text-align:center">${r.words || '-'}</td><td style="text-align:center">${r.listen || '-'}</td>
              <td style="text-align:center">${r.read || '-'}</td><td style="text-align:center">${r.write || '-'}</td>
              <td style="text-align:center">${r.min || '-'}</td></tr>`).join('')}
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-h">写作记录（最近 ${Math.min(10, d.writeLog.length)} 篇）</div>
      <div class="card-b">
        ${d.writeLog.length ? d.writeLog.slice(0, 10).map((w, wi) => {
          /* 旧版记录没有 task/words 字段（只有 text/score）：以前会渲染出空标题和
           * 「undefined 词」。这里统一兜底，缺失就退回正文首句 / 不显示词数标签。*/
          const title = String(w.task || w.title || (w.text || '')).trim().slice(0, 46) || '未命名作文';
          const wn = Number(w.words);
          return `
          <div class="nb-item" data-wid="${w.id != null ? w.id : 'i' + wi}">
            <span class="w" style="font-size:13px;min-width:auto;flex:1;font-family:inherit;font-weight:500">${esc(title)}${title.length > 46 ? '…' : ''}</span>
            ${w.level ? `<span class="tag">${esc(w.level)}</span>` : ''}
            ${Number.isFinite(wn) && wn > 0 ? `<span class="tag">${wn} 词</span>` : ''}
            ${w.score != null ? `<span class="tag ${w.score >= 24 ? 'tag-ok' : 'tag-warn'}">${w.score} 分</span>` : '<span class="tag">未评分</span>'}
            <button class="btn btn-xs btn-gh" data-wact="open">查看</button>
          </div>`; }).join('') : '<div class="empty"><p>还没有写作记录</p></div>'}
      </div>
    </div>`;

    on(root, 'click', '[data-nav]', (e, t) => App.go(t.dataset.nav));
    on(root, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'report') {
        this.exportReport();
      } else if (a === 'backup') {
        App.download(new Blob([Store.backup()], { type: 'application/json' }),
          `keeplrn_backup_${App.fmtDate()}.json`);
        App.toast('已导出备份文件', 'ok');
      }
    });
    on(root, 'click', '[data-wact]', (e, t) => {
      /* 旧版写作记录没有 id（只有 at/text/score）：原来 +undefined → NaN，
       * find 拿不到 → 点「查看」直接抛错。这里用行号兜底。*/
      const raw = t.closest('[data-wid]').dataset.wid || '';
      const w = /^i\d+$/.test(raw) ? d.writeLog[Number(raw.slice(1))]
        : d.writeLog.find(x => String(x.id) === raw);
      if (!w) { App.toast('这条写作记录缺少内容，无法打开', 'err'); return; }
      App.modal('写作记录', `
        <div class="hint" style="margin-bottom:10px">${esc(String(w.task || w.title || '').trim() || '未命名作文')}</div>
        <div class="row" style="gap:7px;margin-bottom:12px">
          ${w.level ? `<span class="tag">${esc(w.level)}</span>` : ''}${Number(w.words) > 0 ? `<span class="tag">${Number(w.words)} 词</span>` : ''}
          ${w.score != null ? `<span class="tag tag-pri">${w.score} 分</span>` : ''}
          <span class="tag">${esc(String(w.at || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div class="ex-item" style="line-height:1.9">${esc(w.text)}</div>`, bb => {
        on(bb, 'click', '[data-cp]', (e2, tt) => {
          navigator.clipboard.writeText(w.text).then(() => App.toast('已复制', 'ok'));
        });
      });
    });
  },
};
window.ViewStats = ViewStats;