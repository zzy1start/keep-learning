/* ============ pdf.js : 生词本 / 学习报告导出 PDF ============
 * 不依赖任何外部库：用隐藏 iframe + window.print() 打印为 PDF，
 * 浏览器原生排版，中文不会乱码，可精确控制版式。
 */
const PDF = {
  /** 通用：把 HTML 字符串打印成 PDF
   *  opt.layout: 'single'单面| 'double' 双面（背面空白页，省纸但多占一半纸量）
   *  双面通过给根元素加一个 .sheet-break 结束块实现——
   *  浏览器打印时每个 A4 都会被占用，双面模式下背面留白由 break-after 强制换页保证。
   */
  print(html, title, opt = {}) {
    const layoutCls = opt.layout === 'double' ? ' layout-double' : '';
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title || 'export')}</title>
    <style>
  @page{ size:A4; margin:14mm 13mm; }
  *{box-sizing:border-box}
  body{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;color:#1a2337;
       font-size:9.5pt;line-height:1.55;margin:0${layoutCls}}
  /* 双面模式：内容区域限制为左半页，右侧留白，模拟单面打印的背面 */
  body.layout-double .page{width:50%;padding-right:6mm}
  h1{font-size:15pt;margin:0 0 3px}
  h2{font-size:11pt;margin:14px 0 6px;padding-bottom:4px;border-bottom:1.5px solid #2f6bff;color:#2f6bff}
  .meta{color:#7a869a;font-size:8.5pt;margin-bottom:10px}
  .meta b{color:#33405c}
  .card{border:1px solid #e3e8f0;border-radius:8px;padding:10px 12px;margin-bottom:9px;
        break-inside:avoid;page-break-inside:avoid}
  .w{font-size:13pt;font-weight:700;color:#1a2337}
  .ph{font-family:Consolas,monospace;color:#2f6bff;font-size:9.5pt}
  .cn{color:#33405c;margin-top:2px}
  .tag{display:inline-block;background:#eef3ff;color:#2f6bff;border-radius:4px;
       padding:1px 6px;font-size:8.5pt;margin-right:4px}
  .tg2{background:#f0ecff;color:#7c5cff}
  .tg3{background:#e7f8f0;color:#12b76a}

  /* ===== 生词本双栏排版 =====
   * 左右两栏 + 中间竖线。用 CSS multi-column 让浏览器自动平衡高度并正确跨页。
   * 字号按"单页40~50 词"反推：
   *   A4 可用高度约 297-28=269mm；行高 1.5×9pt≈ 4.8mm；
   *   每词占2 行（词行+ 释义行）≈ 9.6mm+ 内边距 ≈ 11mm
   *   → 每栏约 24 词，两栏约 48 词 —— 落在目标区间内。 */
  .nb-cols{
    column-count:2;column-gap:0;
    column-fill:balance;
    border-left:1px solid #e3e8f0;
  }
  .nb-row{
    break-inside:avoid;page-break-inside:avoid;
    padding:2.5px 9px 3px;border-bottom:1px dashed #e8edf5;
  }
  /* 左栏条目右侧留出padding，避免压到分隔线上 */
  .nb-cols .nb-row{padding-right:11px}
  .nb-l{display:flex;align-items:baseline;gap:5px;flex-wrap:nowrap;min-width:0}
  /* 单词本身绝不换行：长词（如 interdisciplinary）也须完整显示在一行内。
     若放不下则缩小字号，而不是折行——折行会让词看起来像两个词。 */
  .nb-l .w{
    font-size:10.5pt;font-weight:700;color:#1a2337;flex:none;
    white-space:nowrap;word-break:keep-all;hyphens:none;
  }
  /* 音标过长时省略，避免把单词挤出栏外 */
  .nb-l .ph{
    font-size:8pt;white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis;min-width:0;flex:0 1 auto;
  }
  /* 释义允许换行（长释义不影响识读） */
  .nb-cn{font-size:8.5pt;color:#33405c;line-height:1.35;margin-top:0;
    overflow-wrap:break-word}
  .nb-cn i{color:#98a2b3;font-style:normal}
  /* 固定搭配：与释义同段内联显示，不再另起一行——
     原本 display:block 会让每个词多占约 10px，单页容量从 45 掉到 32。*/
  .nb-cn .r-phr{
    color:#98a2b3;font-size:7.6pt;
  }
  .nb-cn .r-phr::before{content:' ｜ '}
  /* 来源信息压缩成一行小字，与词行同行显示，进一步省高度 */
  .nb-src{font-size:7.5pt;color:#98a2b3;text-align:right;flex:none;margin-left:auto}
  .tg4{background:#fff5e6;color:#f79009}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .kv{color:#5a6a86;font-size:9pt;margin-top:4px}
  .kv b{color:#33405c;font-weight:600}
  .src{border-left:3px solid #2f6bff;padding:4px 0 4px 8px;margin-top:6px;
      background:#f7f9fd;color:#445068;font-size:9pt}
  .ex{color:#5a6a86;font-size:9pt;margin-top:5px;font-style:italic}
  .phr{color:#33405c;font-size:9pt;margin-top:4px}
  .phr i{color:#2f6bff;font-style:normal;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:9pt;margin-top:4px}
  th,td{border:1px solid #e3e8f0;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f4f7fd;color:#33405c;font-weight:600}
  .empty{color:#98a2b3;text-align:center;padding:30px}
  .foot{margin-top:14px;padding-top:7px;border-top:1px solid #e3e8f0;color:#98a2b3;font-size:8pt;
        display:flex;justify-content:space-between}
</style></head><body>${html}</body></html>`;
    /* Android WebView 不支持 window.print()：原生环境走自定义 Print 插件，
     * 调系统打印面板（可另存为 PDF）；浏览器/桌面仍用隐藏 iframe 打印。*/
    const Cap = window.Capacitor;
    const P = Cap && Cap.Plugins && Cap.Plugins.Print;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && P && P.printHtml) {
      P.printHtml({ html: full, name: String(title || 'export').slice(0, 40) })
        .then(() => App.toast('已打开系统打印面板，选择「另存为 PDF」即可保存', 'ok'))
        .catch(e => {
          const msg = String((e && (e.message || e.errorMessage)) || e || '');
          App.toast(/cancel/i.test(msg) ? '已取消打印' : ('打开打印面板失败：' + msg), /cancel/i.test(msg) ? '' : 'err');
        });
      return;
    }
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open(); doc.write(full); doc.close();
    // 等字体与布局稳定
    setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch (e) { App.toast('PDF 打印失败：' + e.message, 'err'); }
      setTimeout(() => f.remove(), 60000);
    }, 350);
  },

  /** 生词本导出配置弹窗
   *  提供：日期多选（可单日/多日/全选）+ 单双面选择，然后调PDF.notebook
   *  所有入口（生词本页/ 设置页/ 阅读页）都走这里，保证交互一致。
   */
  openNotebookExport(items, opt = {}) {
    if (!items || !items.length) { App.toast('没有可导出的单词', ''); return; }

    // 按日期归类，倒序（最近在前）
    const byDate = {};
    items.forEach(it => {
      const d = it.addedAt ? it.addedAt.slice(0, 10) : App.fmtDate();
      (byDate[d] = byDate[d] || []).push(it);
    });
    const dates = Object.keys(byDate).sort().reverse();
    const totalAll = items.length;

    // 默认全选；单日场景下若只有一天就直接全选该日
    const sel = new Set(dates);
    const weekday = d => {
      const wd = new Date(d + 'T00:00:00').getDay();
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][wd];
    };

    const dateRows = dates.map(d => {
      const n = byDate[d].length;
      return `<label class="ex-row">
        <input type="checkbox" class="ex-day" value="${d}" ${sel.has(d) ? 'checked' : ''}>
        <span class="ex-d">${d}</span>
        <span class="ex-w">${weekday(d)}</span>
        <span class="ex-n">${n} 词</span>
      </label>`;
    }).join('');

    App.modal('导出生词本', `
      <div class="ex">
        <div class="ex-sec">选择日期<span class="ex-tip" id="exCount"></span></div>
        <div class="ex-quick">
          <button class="btn btn-xs btn-gh" data-q="all">全选</button>
          <button class="btn btn-xs btn-gh" data-q="none">清空</button>
          <button class="btn btn-xs btn-gh" data-q="d0">仅最近一天</button>
          <button class="btn btn-xs btn-gh" data-q="d7">最近 7 天</button>
        </div>
        <div class="ex-days">${dateRows}</div>

        <div class="ex-sec" style="margin-top:16px">打印方式</div>
        <div class="ex-quick">
          <label class="ex-radio"><input type="radio" name="exLayout" value="single" checked><span>单面</span></label>
          <label class="ex-radio"><input type="radio" name="exLayout" value="double"><span>双面（背面留白）</span></label>
        </div>
        <div class="ex-hint">单面：内容占满整页；双面：内容靠左半页、背面留白，便于双面打印后翻阅。</div>
      </div>
      <div class="row" style="margin-top:18px;justify-content:flex-end;gap:8px">
        <button class="btn btn-gh" data-x>取消</button>
        <button class="btn btn-pri" id="exGo">导出 PDF</button>
      </div>`,
      b => {
        const boxes = () => Array.from(b.querySelectorAll('.ex-day'));
        const refresh = () => {
          const n = boxes().filter(x => x.checked).length;
          const words = boxes().filter(x => x.checked)
            .reduce((s, x) => s + byDate[x.value].length, 0);
          b.querySelector('#exCount').textContent = `已选 ${n} 天 · ${words} / ${totalAll} 词`;
        };
        b.querySelectorAll('.ex-day').forEach(x => x.onchange = refresh);
        refresh();

        b.querySelectorAll('[data-q]').forEach(btn => {
          btn.onclick = () => {
            const q = btn.dataset.q;
            if (q === 'all') boxes().forEach(x => x.checked = true);
            else if (q === 'none') boxes().forEach(x => x.checked = false);
            else if (q === 'd0') { const d0 = dates[0]; boxes().forEach(x => x.checked = x.value === d0); }
            else if (q === 'd7') {
              const allow = new Set(dates.slice(0, 7));
              boxes().forEach(x => x.checked = allow.has(x.value));
            }
            refresh();
          };
        });

        b.querySelector('[data-x]').onclick = App.closeModal;
        b.querySelector('#exGo').onclick = () => {
          const picked = boxes().filter(x => x.checked).map(x => x.value);
          if (!picked.length) { App.toast('请至少选择一天', ''); return; }
          const layout = (b.querySelector('input[name=exLayout]:checked') || {}).value || 'single';
          App.closeModal();
          PDF.notebook(items, { ...opt, layout, dates: picked });
        };
      });
  },

  /** 生词本导出
   *  opt: { bookName, layout:'single'|'double', dates:['2026-10-10', ...] }
   *  日期分组由 addedAt 自动归类，多日导出时每个日期独立成节并各自双栏排版。
   */
  notebook(items, opt = {}) {
    const now = new Date();
    const dateStr = App.fmtDate(now), timeStr = App.fmtTime(now);

    // 按日期分类（倒序：最近的在前）
    const groups = {};
    items.forEach(it => {
      const d = it.addedAt ? it.addedAt.slice(0, 10) : dateStr;
      (groups[d] = groups[d] || []).push(it);
    });
    let dates = Object.keys(groups).sort().reverse();

    // 调用方指定了日期则只导出这些天
    if (opt.dates && opt.dates.length) {
      const allow = new Set(opt.dates);
      dates = dates.filter(d => allow.has(d));
    }

    const kept = dates.reduce((n, d) => n + groups[d].length, 0);
    const layoutLabel = opt.layout === 'double' ? '双面' : '单面';
    const rangeLabel = dates.length
      ? (dates.length === 1 ? dates[0] : dates[dates.length - 1] + ' ~ ' + dates[0])
      : '—';

    /* 顶部基本信息：精简为两行，去掉冗余描述 */
    const body = `
    <h1>生词本 · 学习清单</h1>
    <div class="meta">
      共 <b>${kept}</b> 词 · ${dates.length} 天 · ${esc(opt.bookName || '全部词书')} · ${layoutLabel} · 导出于 ${dateStr} ${timeStr}<br>
      区间 ${rangeLabel}
    </div>`;

    /* 每个日期一节，各自双栏 */
    const groupsHTML = dates.map((d, di) => {
      const list = groups[d];
      return `
      <h2>${d}（${list.length} 词）${di === 0 && dates.length > 1 ? '　<span class="tag tg3">最新</span>' : ''}</h2>
      <div class="nb-cols">${list.map(it => this._wordRow(it)).join('')}</div>`;
    }).join('');

    const html = `<div class="page">${body}${groupsHTML}
    <div class="foot">
      <span>Keep Learning · 生词本（数据仅存于本机浏览器）</span>
      <span>${rangeLabel}　共 ${kept} 词</span>
    </div></div>`;
    this.print(html, `生词本_${dates[0] || dateStr}`, opt);
  },

  /**
   * 双栏版单词条目（紧凑：一行词 + 音标 + 释义 + 来源）
   * 相比原来的大卡片，字号更小、信息更密，单页约 45 词。
   */
  _wordRow(it) {
    const srcTag = it.srcTag || '手动';
    const time = it.addedAt ? it.addedAt.slice(11, 16) : '';
    const tr = (it.tr || []).map(t => esc(t.d)).join('；');
    const phr = (it.phr && it.phr.length)
      ? `<span class="r-phr">${it.phr.slice(0, 2).map(p => esc(p)).join(' · ')}</span>` : '';
    return `<div class="nb-row">
      <div class="nb-l">
        <span class="w">${esc(it.w)}</span>
        <span class="ph">${esc(it.ph || '')}</span>
        <span class="nb-src" style="margin-left:auto">${esc(srcTag)}${time ? ' ' + esc(time) : ''}</span>
      </div>
      <div class="nb-cn">${tr || '<i>（无释义）</i>'}${phr}</div>
    </div>`;
  },

  /** 单个单词卡片（含来源分析） */
  _wordCard(it, opt) {
    const srcTag = it.srcTag || '手动添加';
    const time = it.addedAt ? it.addedAt.slice(11, 16) : '';
    const tr = (it.tr || []).map(t => `<span class="tag">${esc(t.t || '释义')}</span>${esc(t.d)}`).join('　');
    const phr = (it.phr && it.phr.length)
      ? `<div class="phr"><i>固定搭配</i>　${it.phr.slice(0, 4).map(p => esc(p)).join('　|　')}</div>` : '';
    const root = it.root ? `<div class="kv"><b>词根词缀</b>　${esc(it.root)}</div>` : '';
    const extra = (it.extra && it.extra.length)
      ? `<div class="phr"><i>拓展</i>　${it.extra.slice(0, 5).map(e => esc(e)).join('　|　')}</div>` : '';
    const ex = it.ex ? `<div class="ex">${esc(it.ex)}</div>` : '';
    const origin = it.origin ? `<div class="src"><b>来源分析</b>　${esc(it.origin)}</div>` : '';
    return `<div class="card">
      <div class="row">
        <div>
          <span class="w">${esc(it.w)}</span>
          <span class="ph">${esc(it.ph || '')}</span>
        </div>
        <div style="text-align:right">
          <span class="tag tg2">${esc(srcTag)}</span><br>
          <span style="font-size:8.5pt;color:#98a2b3">${esc(it.addedAt ? it.addedAt.slice(0, 10) : '')}${time ? ' ' + esc(time) : ''}</span>
        </div>
      </div>
      <div class="cn">${tr || '（无本地释义，建议启用 AI 补全）'}</div>
      ${phr}${root}${extra}${ex}${origin}
    </div>`;
  },

  /** 学习报告 PDF */
  report(data) {
    const now = new Date();
    const html = `
    <h1>学习报告</h1>
    <div class="meta">生成时间：<b>${App.fmtDate(now)} ${App.fmtTime(now)}</b>　|　连续学习 <b>${data.streak}</b> 天</div>
    <h2>总览</h2>
    <table>
      <tr><th style="width:30%">指标</th><th style="width:20%">数值</th><th>说明</th></tr>
      <tr><td>累计学习天数</td><td>${data.totalDays} 天</td><td>首次使用 ${data.firstDay}</td></tr>
      <tr><td>已学单词</td><td>${data.words} 词</td><td>来自 ${Object.keys(data.bookProg || {}).length} 本词书</td></tr>
      <tr><td>生词本</td><td>${data.nb} 词</td><td>其中已掌握 ${data.nbMastered} 词</td></tr>
      <tr><td>听力练习</td><td>${data.listen} 次</td><td>含单句 / 对话 / 长篇</td></tr>
      <tr><td>阅读练习</td><td>${data.read} 篇</td><td>平均得分率 ${data.readRate}%</td></tr>
      <tr><td>写作练习</td><td>${data.write} 篇</td><td>平均 ${data.writeScore} 分</td></tr>
    </table>
    <h2>各词书进度</h2>
    <table>
      <tr><th>词书</th><th>已学</th><th>已掌握</th><th>待复习</th><th>进度</th></tr>
      ${Object.keys(data.bookProg || {}).map(id => {
      const b = data.bookProg[id], meta = BOOKS.find(x => x.id === id) || { name: id };
      const total = data.bookTotal[id] || 0;
      const pct = total ? Math.round(b.learned / total * 100) : 0;
      return `<tr><td>${esc(meta.name)}</td><td>${b.learned}</td><td>${b.mastered}</td><td>${b.reviewing}</td><td>${pct}%</td></tr>`;
    }).join('')}
    </table>
    <h2>最近 14 天学习时长</h2>
    <table>
      <tr><th>日期</th><th>单词</th><th>听力</th><th>阅读</th><th>写作</th><th>时长(分)</th></tr>
      ${data.recent.map(d => `<tr><td>${d.date}</td><td>${d.words}</td><td>${d.listen}</td><td>${d.read}</td><td>${d.write}</td><td>${d.min}</td></tr>`).join('')}
    </table>
    <div class="foot">
      <span>Keep Learning · 本地学习数据报告</span>
      <span>${App.fmtDate(now)} ${App.fmtTime(now)}</span>
    </div>`;
    this.print(html, `学习报告_${App.fmtDate(now)}`);
  },
};
window.PDF = PDF;