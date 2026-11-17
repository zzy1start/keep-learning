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
  /* 生词本顶部只留两件事：左=词汇来源，右=词数/导出时间。
     来源带一根蓝色竖线，和正文的日标题同一套蓝色语言（用户选的 B 版）。 */
  .nb-head{display:flex;justify-content:space-between;align-items:baseline;gap:4px 14px;flex-wrap:wrap}
  .nb-head .hsrc{border-left:3px solid #2f6bff;padding-left:8px}
  .nb-head .hcnt{white-space:nowrap}
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
    const dateStr = App.fmtDate(now);

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
    const keptItems = dates.reduce((list, d) => list.concat(groups[d]), []);
    const rangeLabel = dates.length
      ? (dates.length === 1 ? dates[0] : dates[dates.length - 1] + ' ~ ' + dates[0])
      : '—';
    /* 正文索引按数组引用缓存；每次导出先作废，避免覆盖重导后用旧正文回溯卷面 */
    this._nbPoolCache = null;
    const src = this._nbSource(keptItems);

    /* 顶部只留两件事：这份清单的词汇来源 + 词数/导出时间。
     * 原来的「1 天 / 词书名 等 / 单面 / 区间」要么互相重复、要么和内容无关，全部删掉；
     * 多日导出时用日期区间取代「N 天」+「区间」两行。 */
    const countLabel = dates.length > 1
      ? `共 <b>${kept}</b> 词 · ${this._nbShortDate(dates[dates.length - 1])} ~ ${this._nbShortDate(dates[0])}（${dates.length} 天）`
      : `共 <b>${kept}</b> 词 · 导出于 ${dateStr}`;
    const body = `
    <h1>生词本 · 学习清单</h1>
    <div class="meta nb-head">
      <span class="hsrc">来源 <b>${esc(src.text)}</b></span>
      <span class="hcnt">${countLabel}</span>
    </div>`;

    /* 每个日期一节，各自双栏；来源与时间只在日标题汇总一次，逐词不再重复。
     * 整份导出只有一种来源时，日标题不再重复顶部已写明的标签（hideTag）。 */
    const hideTag = src.tags.length === 1;
    const groupsHTML = dates.map((d, di) => {
      const list = groups[d];
      const meta = this._nbDayMeta(list, hideTag);
      return `
      <h2>${d}（${list.length} 词）${meta}${di === 0 && dates.length > 1 ? '　<span class="tag tg3">最新</span>' : ''}</h2>
      <div class="nb-cols">${list.map(it => this._wordRow(it)).join('')}</div>`;
    }).join('');

    const html = `<div class="page">${body}${groupsHTML}
    <div class="foot">
      <span>Keep Learning · 生词本（数据仅存于本机浏览器）</span>
      <span>${rangeLabel}　共 ${kept} 词</span>
    </div></div>`;
    this.print(html, `生词本_${dates[0] || dateStr}`, opt);
  },

  /** 来源标签归一（与 App.nbTag 同口径；vm 自检里没有 core.js 时用这里的兜底）*/
  _nbTag(tag) {
    if (typeof App !== 'undefined' && App && typeof App.nbTag === 'function') return App.nbTag(tag);
    const s = String(tag == null ? '' : tag).trim();
    if (!s) return '手动';
    if (s === '阅读' || s === '阅读划线' || s === '阅读划词') return '阅读划词';
    return s;
  },

  /** 生词本日期标题后缀：只保留来源列表（用户要求删掉「02:48–04:40」这类具体时间）。
   *  hideTag：整份导出只有一种来源时，顶部「来源」已经写明，日标题不再重复。*/
  _nbDayMeta(list, hideTag) {
    const srcs = [];
    (list || []).forEach(it => {
      if (!it) return;
      const tag = this._nbTag(it.srcTag);
      if (srcs.indexOf(tag) < 0) srcs.push(tag);
    });
    if (!srcs.length) return '';
    if (hideTag && srcs.length === 1) return '';
    const srcText = srcs.map(s => esc(s)).join(' / ');
    return srcText ? '· ' + srcText : '';
  },

  /* ===== 顶部「词汇来源」：从哪一套题的哪个入口划的 =====
   * 用户口径示例：「2023 年 3 月 · 六级 · 第一套 · 阅读划词」。
   * 新数据靠加词时写进 item.paper 的卷面快照；老数据靠 origin 回填（原句 → 标题 → 词只出现在哪一套），
   * 三步都对不上就不写卷面，绝不按"看起来像"编年份。*/

  /** '2026-11-11' → '11-11'（多日导出时顶部区间用，省宽度） */
  _nbShortDate(d) {
    const s = String(d == null ? '' : d).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s;
  },

  /** 场次 → 中文月份：'03' → '3 月'；考研的英语一/二 原样；不分卷不显示 */
  _nbMonthLabel(session) {
    const s = String(session == null ? '' : session).trim();
    if (!s || s === 'other') return '';
    if (s === 'english-1' || s === 'english1') return '英语一';
    if (s === 'english-2' || s === 'english2') return '英语二';
    if (/^\d{1,2}$/.test(s)) {
      const n = Number(s);
      return n >= 1 && n <= 12 ? n + ' 月' : '';
    }
    return s;
  },

  /** 级别 → 中文：CET-6 → 六级；认不出就留空（不硬写） */
  _nbLevelLabel(level) {
    const s = String(level == null ? '' : level).trim();
    if (!s) return '';
    if (/CET-?\s*6/i.test(s) || /六级/.test(s)) return '六级';
    if (/CET-?\s*4/i.test(s) || /四级/.test(s)) return '四级';
    if (/考研|kaoyan/i.test(s)) return '考研';
    return '';
  },

  /** 套别：1 → 第一套；未标注（0/null）返回空 */
  _nbSetLabel(setNo) {
    const n = Number(setNo);
    if (!n || n < 1 || n > 9 || Math.floor(n) !== n) return '';
    return ['第一套', '第二套', '第三套', '第四套', '第五套', '第六套', '第七套', '第八套', '第九套'][n - 1];
  },

  /** 阅读篇目 → 卷面元信息（导出只用这五项） */
  _nbPaperMeta(p) {
    if (!p) return null;
    return {
      id: p.id || '', year: p.year || '', session: p.session || '',
      setNo: p.setNo == null ? '' : p.setNo, level: p.level || '', mine: !!p.mine,
    };
  },

  /** 卷面去重键：同年/场/套/级别算同一套 */
  _nbPaperKey(p) {
    if (!p) return '';
    return [p.year || '', p.session || '', p.setNo || 0, p.level || ''].join('|');
  },

  /** 卷面 → 文字：'2023 年 3 月 · 六级 · 第一套'；多套前缀用空格分隔（sep） */
  _nbPaperLabel(meta, sep) {
    if (!meta) return '';
    const s = sep == null ? ' · ' : sep;
    const parts = [];
    const y = /^\d+$/.test(String(meta.year == null ? '' : meta.year)) ? String(meta.year) + ' 年' : '';
    const ym = [y, this._nbMonthLabel(meta.session)].filter(Boolean).join(' ');
    if (ym) parts.push(ym);
    const lv = this._nbLevelLabel(meta.level);
    if (lv) parts.push(lv);
    const st = this._nbSetLabel(meta.setNo);
    if (st) parts.push(st);
    return parts.join(s);
  },

  /** 阅读篇目正文（小写）——只用于「原句/这个词出现在哪一篇」的回填。
   *  段落有两种真实形态：字符串（阅读/选词填空）和 { label, text }（段落匹配 A–M）。*/
  _nbTextOf(p) {
    const ps = p && Array.isArray(p.paragraphs) ? p.paragraphs : [];
    return ps.map(x => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') return String(x.text || x.t || x.en || '');
      return '';
    }).join('\n').toLowerCase();
  },

  /** 阅读篇目索引：pools + 每篇正文缓存（同一次导出只建一次，避免逐词重复拼正文） */
  _nbPoolIndex() {
    let raw = null;
    try {
      if (typeof Dict !== 'undefined' && Dict && Dict.content && Dict.content.reading) {
        raw = Dict.content.reading.passages || null;
      }
    } catch (e) { raw = null; }
    if (!Array.isArray(raw) || !raw.length) return { pools: [], texts: new Map() };
    if (this._nbPoolCache && this._nbPoolCache.raw === raw) return this._nbPoolCache;
    const pools = raw.filter(x => x && (x.year || x.level || x.session));
    const texts = new Map();
    pools.forEach(p => texts.set(p, this._nbTextOf(p)));
    this._nbPoolCache = { raw, pools, texts };
    return this._nbPoolCache;
  },

  /** origin 里的篇目标题：'来自阅读文章「X」…' / '来自阅读文章《X》…' */
  _nbOriginTitle(origin) {
    const m = String(origin == null ? '' : origin).match(/来自阅读文章[「《]([^》」]+)[》」]/);
    return m && m[1] ? m[1].trim() : '';
  },

  /** 某条生词的卷面：新数据直接读 paper 快照；老数据依次按 原句 → 标题 → 词只出现在哪一套 回填。
   *  三步都对不上返回 null（宁可不写，也不编年份）。*/
  _nbPaperOf(it) {
    if (!it) return null;
    const snap = it.paper;
    if (snap && (snap.year || snap.session || snap.level || snap.setNo)) {
      return {
        id: snap.id || '', year: snap.year || '', session: snap.session || '',
        setNo: snap.setNo == null ? '' : snap.setNo, level: snap.level || '', mine: !!snap.mine,
      };
    }
    const idx = this._nbPoolIndex();
    const pools = idx.pools;
    if (!pools.length) return null;
    if (it.paperId) {
      const hit = pools.find(x => x && x.id === it.paperId);
      if (hit) return this._nbPaperMeta(hit);
    }
    const origin = String(it.origin == null ? '' : it.origin);
    if (origin) {
      /* ① 原句：这句话只在一篇里出现过，那篇就是来源（最硬的证据） */
      const m = origin.match(/原句：(.+)$/);
      if (m) {
        let needle = String(m[1]).replace(/\s+/g, ' ').trim();
        needle = needle.replace(/^[…\s"'‘“]+/, '').replace(/[…\s"'’”]+$/, '').toLowerCase();
        if (needle.length >= 12) {
          needle = needle.slice(0, 40);
          const hits = pools.filter(x => String(idx.texts.get(x) || '').replace(/\s+/g, ' ').indexOf(needle) >= 0);
          if (hits.length === 1) return this._nbPaperMeta(hits[0]);
        }
      }
      /* ② 文章标题：全库只有一套卷子用这个标题才认 */
      const title = this._nbOriginTitle(origin).toLowerCase();
      if (title) {
        const hits = pools.filter(x => String(x.title || '').trim().toLowerCase() === title);
        const keys = [];
        hits.forEach(x => {
          const k = this._nbPaperKey(this._nbPaperMeta(x));
          if (keys.indexOf(k) < 0) keys.push(k);
        });
        if (keys.length === 1 && hits.length) return this._nbPaperMeta(hits[0]);
      }
    }
    /* ③ 兜底：这个词只出现在一套「自己导入的卷子」里，才归到那一套；
     *    内置教材篇目不参与，避免把自有卷子的词算到教材头上。*/
    const word = String(it.w == null ? '' : it.w).toLowerCase().trim();
    if (/^[a-z][a-z'-]*$/.test(word)) {
      const re = new RegExp('(^|[^a-z])' + word + '(?![a-z])');
      const keys = [];
      let first = null;
      pools.forEach(x => {
        const meta = this._nbPaperMeta(x);
        if (!meta || !meta.mine) return;
        if (!re.test(String(idx.texts.get(x) || ''))) return;
        const k = this._nbPaperKey(meta);
        if (keys.indexOf(k) < 0) { keys.push(k); first = first || meta; }
      });
      if (keys.length === 1) return first;
    }
    return null;
  },

  /** 顶部「来源」：卷面 + 来源标签，返回 { text, tags, papers }。
   *  一套题：'2023 年 3 月 · 六级 · 第一套 · 阅读划词'
   *  多套题：'2023 年 3 月 六级 第一套 等 2 套试题 · 阅读划词'
   *  认不出卷面：'阅读划词'（不编年份） */
  _nbSource(items) {
    const tags = [], papers = [], seen = {};
    (items || []).forEach(it => {
      if (!it) return;
      const tag = this._nbTag(it.srcTag);
      const label = tag === '手动' ? '手动添加' : tag;
      if (tags.indexOf(label) < 0) tags.push(label);
      const meta = this._nbPaperOf(it);
      if (!meta) return;
      const k = this._nbPaperKey(meta);
      if (seen[k]) return;
      seen[k] = 1;
      papers.push(meta);
    });
    const paperText = papers.length === 1
      ? this._nbPaperLabel(papers[0], ' · ')
      : (papers.length > 1
        ? this._nbPaperLabel(papers[0], ' ') + ' 等 ' + papers.length + ' 套试题'
        : '');
    const text = [paperText, tags.join(' / ')].filter(Boolean).join(' · ');
    return { text, tags, papers };
  },

  /** 原型还原：Dict.get() 返回 [音标, 释义, 命中的词典键]，第 3 项本身就是 lemma
   *  （implemented → implement、distortions → distortion），查不到就原样返回。
   *  只影响导出渲染，不改 Store 数据。 */
  _nbBase(word) {
    const w = String(word == null ? '' : word).toLowerCase().trim();
    if (!w) return '';
    let g = null;
    try {
      if (typeof Dict !== 'undefined' && Dict && typeof Dict.get === 'function') g = Dict.get(w);
    } catch (e) { g = null; }
    const base = g && g[2] ? String(g[2]).toLowerCase().trim() : '';
    if (base && base !== w) return base;
    /* 真实词典里部分屈折形自己也有条目（如 boiling），直接命中时第 3 项仍是原词；
     * 此时再用词形索引（boiling → boil）兜底一次，且目标词必须在词典里有条目。*/
    if (!base || base === w) {
      try {
        const hitForm = /^[a-z][a-z'-]*(ed|ing|s|es|ies)[.]?$/.test(w);
        const f = hitForm && Dict && Dict.formsIdx && typeof Dict.formsIdx.get === 'function'
          ? Dict.formsIdx.get(w) : '';
        if (f && f !== w) {
          const g2 = typeof Dict.get === 'function' ? Dict.get(f) : null;
          /* 词形索引里混有缩写残条（spring → spr，音标为空、释义以 abbr. 开头），
           * 这种目标不是真正的 lemma，宁可保留原词也不改坏词头。*/
          const meaning = String(g2 && g2[1] != null ? g2[1] : '').trim();
          if (g2 && g2[2] && g2[0] && !/^abbr[.]/i.test(meaning)) return String(g2[2]).toLowerCase().trim();
        }
      } catch (e) { /* 词形索引不可用就按原词导出 */ }
    }
    return base || w;
  },

  /** 全局词典查词（Dict 未就绪 / 抛错时返回 null） */
  _nbGlobalLookup(word) {
    try {
      if (typeof Dict === 'undefined' || !Dict || typeof Dict.get !== 'function') return null;
      return Dict.get(word) || null;
    } catch (e) { return null; }
  },

  /** 当前词书查词（Dict / Store 未就绪时返回 null） */
  _nbBookLookup(word) {
    try {
      if (typeof Dict === 'undefined' || !Dict || typeof Dict.inBook !== 'function') return null;
      if (typeof Store === 'undefined' || !Store || !Store.d) return null;
      const id = Store.d.activeBook;
      return id ? (Dict.inBook(id, word) || null) : null;
    } catch (e) { return null; }
  },

  /** 音标去边：去掉首尾 / [ ] 与空白，折叠多余空格（只统一格式，不补内容）。 */
  _nbPhTrim(raw) {
    let s = String(raw == null ? '' : raw).trim();
    while (s && '/[ '.indexOf(s[0]) >= 0) s = s.slice(1);
    while (s && '/] '.indexOf(s[s.length - 1]) >= 0) s = s.slice(0, -1);
    return s.split(/ +/).join(' ').trim();
  },

  /** 音标清洗：先剥掉混入的英文词（整词边界、大小写不敏感），再统一 /…/。
   *  stripWords 为空时只做格式统一（用于词典补来的音标）。 */
  _nbPhClean(raw, stripWords) {
    let s = String(raw == null ? '' : raw);
    (stripWords || []).forEach(word => {
      const w = String(word == null ? '' : word).trim();
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(w)) return;
      s = s.replace(new RegExp('(^|[^A-Za-z])' + w + '(?![A-Za-z])', 'gi'), '$1');
    });
    return this._nbPhTrim(s);
  },

  /** 音标：优先用词条自带音标（剥掉混入的英文词），没有就查全局词典、再查词书；
   *  最终统一成 /…/。确实没有就返回空串，不伪造。 */
  _nbPh(item, base) {
    const b = String(base || (item && item.w) || '').toLowerCase().trim();
    const orig = item && item.w != null ? String(item.w).toLowerCase().trim() : '';
    let ph = this._nbPhClean(item && item.ph, [b, orig]);
    if (!ph) {
      const g = this._nbGlobalLookup(b);
      if (g && g[0]) ph = this._nbPhClean(g[0], []);
    }
    if (!ph) {
      const bk = this._nbBookLookup(b);
      if (bk && bk.ph) ph = this._nbPhClean(bk.ph, []);
    }
    return ph ? '/' + ph + '/' : '';
  },

  /** 词性缩写归一：n/v/vt/vi/a/ad… 与「名词/动词」等中文标签 → 带点简写。 */
  _nbPosLabel(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    while (s && '[(（【'.indexOf(s[0]) >= 0) s = s.slice(1).trim();
    while (s && '])）】'.indexOf(s[s.length - 1]) >= 0) s = s.slice(0, -1).trim();
    while (s && '.．、:：'.indexOf(s[s.length - 1]) >= 0) s = s.slice(0, -1).trim();
    if (!s) return '';
    const ZH = {
      '名词': 'n.', '动词': 'v.', '及物动词': 'vt.', '不及物动词': 'vi.', '形容词': 'adj.',
      '副词': 'adv.', '介词': 'prep.', '连词': 'conj.', '代词': 'pron.', '数词': 'num.',
      '冠词': 'art.', '感叹词': 'int.', '助动词': 'aux.', '限定词': 'det.', '缩写': 'abbr.',
    };
    if (ZH[s]) return ZH[s];
    const EN = {
      n: 'n.', noun: 'n.', v: 'v.', verb: 'v.', vt: 'vt.', vi: 'vi.', aux: 'aux.',
      det: 'det.', adj: 'adj.', a: 'adj.', adjective: 'adj.', adv: 'adv.', ad: 'adv.',
      adverb: 'adv.', prep: 'prep.', preposition: 'prep.', pron: 'pron.', pronoun: 'pron.',
      conj: 'conj.', conjunction: 'conj.', num: 'num.', number: 'num.', art: 'art.',
      article: 'art.', int: 'int.', interj: 'int.', interjection: 'int.', abbr: 'abbr.',
    };
    const low = s.toLowerCase();
    if (EN[low]) return EN[low];
    const m = low.match(/^([a-z]{1,4})(?![a-z])/);
    return m && EN[m[1]] ? EN[m[1]] : '';
  },

  /** 释义文本归一：去空格/标点，仅用于「按释义反查词性」的比对 */
  _nbNormText(text) {
    return String(text == null ? '' : text).toLowerCase()
      .split(/[ 　]+/).join('').replace(/[，,。;；、:：!！?？]/g, '');
  },

  /** 释义比对：整段包含，或任一分句（逗号/分号分隔）互相包含 */
  _nbTextMatch(a, b) {
    const na = this._nbNormText(a), nb = this._nbNormText(b);
    if (!na || !nb) return false;
    if (na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return true;
    const split = x => String(x == null ? '' : x).split(/[，,;；、]/)
      .map(g => this._nbNormText(g)).filter(g => g.length >= 2);
    return split(a).some(g => nb.indexOf(g) >= 0) || split(b).some(g => na.indexOf(g) >= 0);
  },

  /** 从当前词书的 tr[] 按释义文本反查词性 */
  _nbPosFromBook(book, d) {
    const nd = this._nbNormText(d);
    if (!nd) return '';
    const rows = (book && Array.isArray(book.tr)) ? book.tr : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.d) continue;
      if (this._nbTextMatch(row.d, d)) return this._nbPosLabel(row.t);
    }
    return '';
  },

  /** 把 "vt.实施… n.工具…" 拆成 [{pos, text}]（生词本 t 为空时用） */
  _nbGlobalParts(text) {
    const s = String(text == null ? '' : text);
    const re = /(^|[ ,;，；、])((?:abbr|pron|prep|conj|adj|adv|aux|art|vi|vt|v|n|a|ad|num|int|det)[.])/gi;
    const marks = [];
    let m;
    while ((m = re.exec(s))) marks.push({ posStart: m.index + m[1].length, textStart: re.lastIndex, pos: m[2] });
    return marks.map((mk, i) => ({
      pos: mk.pos,
      text: s.slice(mk.textStart, i + 1 < marks.length ? marks[i + 1].posStart : s.length),
    }));
  },

  /** 从 Dict.get() 的释义里按文本匹配补词性；只有全文单一词性时才敢整条补 */
  _nbPosFromGlobal(global, d) {
    const parts = this._nbGlobalParts(global && global[1]);
    if (!parts.length) return '';
    for (let i = 0; i < parts.length; i++) {
      const label = this._nbPosLabel(parts[i].pos);
      if (label && this._nbTextMatch(parts[i].text, d)) return label;
    }
    const labels = parts.map(p => this._nbPosLabel(p.pos)).filter(Boolean);
    return labels.length && labels.every(x => x === labels[0]) ? labels[0] : '';
  },

  /** 释义 + 词性：t 已有词性就归一；t 为空依次查词书、全局词典。
   *  同一词性合并、不重复标签；查不到词性就保留原释义，不编造。 */
  _nbPos(item, base) {
    const trs = (item && Array.isArray(item.tr)) ? item.tr : [];
    const b = String(base || (item && item.w) || '').toLowerCase().trim();
    const book = this._nbBookLookup(b);
    const global = this._nbGlobalLookup(b);
    const order = [], groups = new Map();
    trs.forEach(row => {
      if (!row) return;
      const d = String(row.d == null ? '' : row.d).trim();
      if (!d) return;
      const label = this._nbPosLabel(row.t)
        || this._nbPosFromBook(book, d)
        || this._nbPosFromGlobal(global, d);
      if (!groups.has(label)) { groups.set(label, []); order.push(label); }
      groups.get(label).push(d);
    });
    return order.map(k => (k ? k + ' ' : '') + groups.get(k).join('，')).join('；');
  },

  /** 双栏版单词条目（紧凑：一行词 + 音标 + 释义 + 固定搭配）
   *  词头用词典原型、音标统一 /…/、释义补词性；来源与时间只在日标题出现一次。 */
  _wordRow(it) {
    const base = this._nbBase(it && it.w);
    const ph = this._nbPh(it, base);
    const tr = this._nbPos(it, base);
    const phr = (it && it.phr && it.phr.length)
      ? `<span class="r-phr">${it.phr.slice(0, 2).map(p => esc(p)).join(' · ')}</span>` : '';
    return `<div class="nb-row">
      <div class="nb-l">
        <span class="w">${esc(base)}</span>
        <span class="ph">${esc(ph)}</span>
      </div>
      <div class="nb-cn">${esc(tr) || '<i>（无释义）</i>'}${phr}</div>
    </div>`;
  },

  /** 单个单词卡片（含来源分析）；词头 / 音标 / 释义与批量导出口径一致。 */
  _wordCard(it, opt) {
    const srcTag = this._nbTag(it.srcTag) || '手动添加';
    const base = this._nbBase(it && it.w);
    const ph = this._nbPh(it, base);
    const tr = this._nbPos(it, base);
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
          <span class="w">${esc(base)}</span>
          <span class="ph">${esc(ph)}</span>
        </div>
        <div style="text-align:right">
          <span class="tag tg2">${esc(srcTag)}</span><br>
          <span style="font-size:8.5pt;color:#98a2b3">${esc(it.addedAt ? it.addedAt.slice(0, 10) : '')}</span>
        </div>
      </div>
      <div class="cn">${esc(tr) || '（无本地释义，建议启用 AI 补全）'}</div>
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