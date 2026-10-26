/* ============ views/translation.js : 翻译练习（独立模块）============
 *
 * 【为什么独立成一个模块，而不是继续放在写作页的 tab 里】
 * 1. 翻译与写作的训练目标不同：写作练"输出组织"，翻译练"准确转换"，
 *    评分维度也不同（翻译看 TR/CC/LR/GRA 四维，写作看 TR15/CC15/LR15/GRA15）。
 *    混在一个页面里，标签越堆越多，反而找不到入口。
 * 2. 翻译是高频独立动作，值得占一个侧栏位置。
 *
 * 【复用而非重写】
 * - 题目来源：Dict.content.writing 里的翻译题（导入真题时由 AI 识别入库）
 * - 评分：AI.gradeTranslation()（考研阅卷口径，四维评分 + 本地对齐校正）
 * - 结果渲染：写作页的 gradeHTML() 同款结构（保持视觉一致）
 * - 独立度量：js/translate-metric.js 的 chrF（sacrebleu 口径）+ 完整性检查
 *
 * 【排版与写作页对齐（本轮改动）】
 * 此前翻译页只在"大体布局"上像写作页，细节各自为政：头部是自定义的 ph-l/返回箭头、
 * 右栏没有 an-panel 包裹（不吸顶）、AI 评分卡没有状态标签、空状态是一行纯文字、
 * 输入区没有工具栏、参考译文卡没有复制按钮、卡片间距靠 CSS 默认值。
 * 现在逐项对齐写作页：phead（返回按钮 + 图标 + 中英标题 + 右侧满分与评分按钮）、
 * an-panel 右栏、editor-tool 工具栏、_emptyGrade() 空状态、参考译文复制按钮、
 * 卡片 margin-top:14px 间隔。
 *
 * 【不依赖模型的判分逻辑（本轮改动）】
 * - 满分不再写死 30：按题目 expectScore → 考研英语一 10 / 英语二 15 → 单句 20 推导，
 *   并在头部提供可手填的"本题满分"（存 Store.d.translation.totalScore）。
 * - 校验结果摊开展示：逐句核对（模型返回的 coverage）、chrF 对齐值、漏译提醒，
 *   这些数此前只存在于返回对象里，用户看不到，也就无法判断分数是否可信。
 */
const ViewTranslate = {
  mode: 'exam',
  dir: 'auto',          // auto | en2cn | cn2en：默认按源文语种自动判定
  tState: 'idle',       // 计时：idle | running | paused | finished
  tLeft: 0,
  tLimit: 0,
  timer: null,
  task: null,
  answer: '',
  result: null,
  sel: { level: 'all', year: 'all', session: 'all', no: 'all' },
  _imgs: [],
  /* 最近输入记忆（Store.d.translationHistory，最多 5 条）*/
  _memo: null,          // 本次编辑会话的记录（稳定 id）
  _memoPending: null,   // 防抖窗口内待落盘的快照
  _memoSess: 0,         // 换题/提交时递增，用来作废旧防抖定时器
  _memoListening: false,

  /* ---------- 题库 ---------- */
  /** 考研翻译题：AI 导入真题时识别入库的 translation 题型 */
  _examPool() {
    return (Dict.content.writing.tasks || []).filter(t =>
      t.writingType === 'translation'
      || /翻译|translation/i.test(`${t.examPart || ''} ${t.genre || ''}`));
  },

  /** 只选翻译单句；写作页的 sentenceTasks 还含有作文提示。 */
  _sentencePool() {
    return (Dict.content.writing.sentenceTasks || []).filter(t => t && t.en && t.cn
      && (t.writingType === 'translation' || t.translationType === 'sentence'
        || t.exam === 'kaoyan' || t.level === '考研'));
  },

  _customPool() {
    return Store.d.translationCustomTasks || [];
  },

  _pool(mode) {
    if (mode === 'sentence') return this._sentencePool();
    if (mode === 'custom') return this._customPool();
    return this._examPool();
  },

  /** 是否有任何可练的题——决定空状态显示哪种引导 */
  _hasAny() {
    return this._examPool().length > 0 || this._sentencePool().length > 0
      || this._customPool().length > 0;
  },

  /* ---------- 满分与字数 ---------- */
  /**
   * 本题满分。优先级：输入框现值 → 用户上次手填值 → 题目自带 → 按题型推导。
   * 旧代码写死 expectScore || 30：考研翻译英语一 10 分、英语二 15 分，
   * 拿作文的 30 分当默认值会让得分率显示完全失真。
   */
  _maxScore(task) {
    const t = task || this.task || {};
    const input = typeof document === 'undefined' ? null : $('#trTotal');
    const typed = input && input.value !== '' ? Number(input.value) : NaN;
    if (Number.isFinite(typed) && typed > 0) return Math.min(100, Math.round(typed));
    const stored = Number(Store.d && Store.d.translation && Store.d.translation.totalScore);
    if (Number.isFinite(stored) && stored > 0) return Math.min(100, Math.round(stored));
    const explicit = Number(t.expectScore);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(100, Math.round(explicit));
    if (this.mode === 'sentence') return 20;
    if (t.examPaper === 'english-2') return 15;   // 考研英语（二）翻译一段，15 分
    if (t.examPaper === 'english-1') return 10;   // 考研英语（一）翻译 5 句，10 分
    return 15;
  },

  /** 源文文本：整篇题在 translationText/prompt，单句题在 en/cn */
  _sourceText(task) {
    const t = task || this.task || {};
    if ((this.mode || 'exam') === 'sentence') return t.en || t.cn || '';
    /* 整篇题与 ai.js / 本地评分共用同一口径（translationText 优先于 prompt） */
    if (typeof TranslateMetric !== 'undefined' && TranslateMetric && TranslateMetric.sourceOf) {
      return TranslateMetric.sourceOf(t);
    }
    return t.translationText || t.prompt || t.title || t.en || t.cn || '';
  },

  /**
   * 解析翻译方向。
   * - 手动选了英译汉/汉译英 → 用选中的；
   * - 「自动」→ 按**源文语种**判定（中文源文=汉译英，英文源文=英译汉）。
   * 【为什么要有自动】真题翻译既有英译汉（考研英语）也有汉译英（四级中译英）：
   * 一律按英译汉打分时，中文原卷的题会被要求给出中文参考译文，
   * 模型按实际方向给的英文参考译文反被判为不合格 → 用户看到"AI 不能评价"。
   */
  _resolveDir(task) {
    if (this.dir === 'en2cn' || this.dir === 'cn2en') return this.dir;
    const t = task || this.task || {};
    if (typeof TranslateMetric !== 'undefined' && TranslateMetric
      && typeof TranslateMetric.directionOf === 'function') {
      const auto = TranslateMetric.directionOf(this._sourceText(t));
      if (auto) return auto;
    }
    /* 兜底：度量模块没加载时按"汉字数 vs 字母数"粗判，
     * 保证方向判定不依赖可选模块是否就绪。*/
    const s = this._sourceText(t);
    const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    if (cjk || latin) return cjk >= latin ? 'cn2en' : 'en2cn';
    if (t.cn && !t.en) return 'cn2en';
    return 'en2cn';
  },

  _dirAuto() { return this.dir !== 'en2cn' && this.dir !== 'cn2en'; },

  _isReverse() { return this._resolveDir() === 'cn2en'; },

  /** 目标语言的字/词数：汉译英数词，英译汉数字 */
  _count(text) {
    const value = String(text == null ? this.answer : text);
    return this._isReverse()
      ? (value.match(/[A-Za-z']+/g) || []).length
      : Array.from(value.replace(/\s+/gu, '')).length;
  },


  /* ---------- 最近输入记忆（最近 5 条，存 Store.d.translationHistory） ----------
   * 与写作页互相独立；编辑器 oninput 走 App.debounce(800ms) 自动落盘，
   * 提交 / 换题 / 切 tab / 离开页面前再 flush 一次，保证最后几个字不丢。
   */

  /** 本次编辑会话的稳定 id：同一题目连续输入只占 1 条；换题/提交后重置。 */
  _memoId() {
    if (!this._memo || !this._memo.id) {
      const t = this.task || {};
      this._memo = { id: 'tr::' + (t.id || 'none') + '::' + Date.now() + '::' + Math.random().toString(36).slice(2, 6) };
    }
    return this._memo.id;
  },

  /** 把当前题目/模式/方向/文本打包成一条历史记录 */
  _memoEntry(text) {
    const t = this.task || {};
    const value = String(text == null ? this.answer : text);
    const title = t.title || t.prompt || t.translationText || t.en || t.cn || '';
    return {
      id: this._memoId(),
      at: new Date().toISOString(),
      taskId: t.id == null ? '' : String(t.id),
      taskTitle: String(title).replace(/\s+/g, ' ').slice(0, 60),
      mode: this.mode || 'exam',
      dir: this._resolveDir(t),
      text: value,
      chars: Array.from(value.replace(/\s+/gu, '')).length,
    };
  },

  /** 输入后调用：App.debounce 800ms 自动落盘（持续输入时只保留最后一次） */
  _memoSoon(text) {
    this._memoPending = { sess: this._memoSess, entry: this._memoEntry(text) };
    if (!this._memoSaver) this._memoSaver = App.debounce(() => this._memoFlush(), 800);
    this._memoSaver();
  },

  /** 立即把待落盘的文本写进 Store（提交/换题/离开页面前调用；无待写内容时是空操作） */
  _memoFlush() {
    const pending = this._memoPending;
    if (!pending) return;
    this._memoPending = null;
    if (pending.sess !== this._memoSess) return;   // 已换题/提交，旧文本作废
    if (typeof Store === 'undefined' || !Store.rememberInput) return;
    Store.rememberInput('translation', pending.entry);
  },

  /** 结束本次编辑会话：换题/提交后调用，下一次输入会生成新的一条记录 */
  _resetMemo() {
    this._memoSess++;
    this._memo = null;
    this._memoPending = null;
  },

  /** 离开页面前落盘：应用内换页（hashchange）+ 关闭/切后台（beforeunload/pagehide） */
  _memoListen() {
    if (this._memoListening) return;
    this._memoListening = true;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const flush = () => {
      try { this._memoFlush(); }
      catch (e) { console.warn('翻译输入记忆落盘失败', e); }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('hashchange', flush);
  },

  /** 「🕘 最近记录」弹窗：最近 5 条，可恢复到编辑器（不自动提交） */
  _openMemo() {
    const self = this;
    const list = (typeof Store !== 'undefined' && Store.recentInputs) ? Store.recentInputs('translation') : [];
    const rows = list.map((e, i) => {
      const text = String(e.text || '');
      return `<div class="memo-item">
        <div class="mi-main">
          <div class="mi-meta">第 ${i + 1} 条 · ${esc(this._memoTime(e))} · ${esc(this._memoModeLabel(e.mode))} · ${esc(e.taskTitle || '未命名题目')}</div>
          <div class="mi-txt" title="${esc(text)}">${esc(text.slice(0, 30))}${text.length > 30 ? '…' : ''}</div>
        </div>
        <button class="btn btn-xs btn-gh" data-memo="${i}">恢复</button>
      </div>`;
    }).join('');
    const body = (rows || '<div class="hint" style="padding:14px 2px">还没有记录：在输入区写译文，会自动记住最近 5 条。</div>')
      + `<div class="row" style="margin-top:14px;justify-content:space-between;align-items:center">
        <span class="hint">只保留最近 5 条，保存在本机</span>
        <button class="btn btn-xs btn-warn" data-memo-clear="1"${list.length ? '' : ' disabled'}>清空记录</button>
      </div>`;
    App.modal('最近记录（翻译）', body, b => {
      b.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-memo]');
        if (btn) { self._restoreMemo(list[+btn.dataset.memo]); return; }
        if (ev.target.closest('[data-memo-clear]')) self._clearMemo();
      });
    });
  },

  _memoModeLabel(mode) {
    return ({ exam: '真题翻译', sentence: '单句练习', custom: '自定义题目' })[mode] || '翻译';
  },

  _memoTime(entry) {
    const d = new Date(entry && entry.at);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    const day = App.fmtDate(d);
    return (day === App.today() ? '今天 ' : day + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  /** 清空记录：先二次确认，避免误删 */
  _clearMemo() {
    App.confirm('清空翻译页的最近记录？只删这份列表，不影响已保存的译文和练习记录。', () => {
      Store.clearInputs('translation');
      App.closeModal();
      this._openMemo();
      App.toast('最近记录已清空', 'ok');
    });
  },

  /**
   * 恢复一条记录：文本回填编辑器，尽量切到对应题目/题型；不自动提交。
   * 题库里找不到该题时只回填文本并提示。
   */
  _restoreMemo(entry) {
    if (!entry || typeof entry.text !== 'string') return;
    const mode = ['exam', 'sentence', 'custom'].includes(entry.mode) ? entry.mode : (this.mode || 'exam');
    const pool = this._pool(mode);
    const task = entry.taskId ? pool.find(t => t && String(t.id) === String(entry.taskId)) : null;
    App.closeModal();
    /* 找得到题目才切题型/方向/题目；找不到就只回填文本，不动当前题目 */
    if (task) {
      this.mode = mode;
      if (entry.dir === 'en2cn' || entry.dir === 'cn2en') this.dir = entry.dir;
      this.task = task;
      // 旧筛选条件可能把目标题筛掉，恢复时回到「全部」保证切题成功
      this.sel = { level: 'all', year: 'all', session: 'all', no: 'all' };
    }
    this.answer = entry.text;
    this.result = null;
    this._imgs = [];
    this._resetTimer();
    /* 复用这条记录的 id：恢复后继续编辑仍算同一条，不会在历史里越堆越多 */
    this._memoSess++;
    this._memo = { id: entry.id };
    this._memoPending = null;
    this._shell(App.freshView());
    if (!task) App.toast('没找到对应题目，只把文本填回了编辑器', 'warn');
    else App.toast('已恢复到编辑器，改完可再提交评分', 'ok');
  },

  /* ---------- 渲染 ---------- */
  render(root) {
    // 【坑】freshView() 返回的是**新节点**，必须接收返回值再往上写。
    // 只写 App.freshView() 而不赋值，内容会渲染到游离节点上，
    // 页面看起来就是空的——且不报任何错。
    this._shell(App.freshView());
  },

  _shell(root) {
    const mode = this.mode || 'exam';
    const pool = this._pool(mode);
    const available = mode === 'exam' ? Picker.filter(pool, this.sel) : pool;
    const filterRestrictive = !!(this.sel && (
      (this.sel.level && this.sel.level !== 'all')
      || (this.sel.year && this.sel.year !== 'all' && this.sel.year !== null)
      || (this.sel.session && this.sel.session !== 'all')
    ));
    if (mode === 'exam' && !available.length && pool.length > 0 && filterRestrictive) {
      this.sel = { level: 'all', year: 'all', session: 'all', no: 'all' };
      App.toast('当前筛选没有匹配题目，已自动切回全部题库', '');
      return this._shell(root);
    }
    // 保持当前题在题池内（切换筛选后可能失效）
    if (!available.some(t => t && t.id === (this.task && this.task.id))) {
      this.task = available[0] || null;
    }
    const t = this.task;
    const isSentence = mode === 'sentence';
    const dir = this._resolveDir(t);
    const reverse = dir === 'cn2en';
    const dirLabel = reverse ? '汉译英' : '英译汉';
    const max = this._maxScore(t);
    const counts = { exam: this._examPool().length, sentence: this._sentencePool().length, custom: this._customPool().length };
    const verified = !!(t && t.translationVerification && t.translationVerification.status === 'ai-verified');

    root.innerHTML = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-nav="home">← 返回</button>
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic">${App.views.translation.ic}</svg></div>
      <div>
        <h1>翻译 <span style="font-size:12px;color:var(--tx3);letter-spacing:2px">TRANSLATION</span></h1>
        <div class="sub">英译汉 · 汉译英，按真题与句子两种方式练习</div>
      </div>
      <div class="phead-r">
        <span class="chip" title="已导入的整篇翻译题数量">共 ${counts.exam} 道真题</span>
        <span class="chip" title="内置的考研单句练习数量">${counts.sentence} 条单句</span>
        <span class="row" style="gap:5px">
          <span class="hint" style="font-size:12px">本题满分</span>
          <input class="inp" id="trTotal" type="number" min="1" step="1" style="width:70px;text-align:center"
            value="${max}" title="翻译满分按题型推导：考研英语一 10 分、英语二 15 分、单句 20 分；可手动修改">
        </span>
      </div>
    </div>

    ${mode === 'exam' && pool.length ? `<div id="trPicker">${Picker.html({
        /* 【为什么从 pool.length > 1 改成 pool.length】
         * 原来只要翻译题不足 2 道就**整个筛选器都不渲染**——导入一份试卷、只有 1 道翻译题时，
         * 页面上连"按类型/年份/题号筛选"的入口都看不到，和写作页的体验完全不一致。
         * 现在只要有题就渲染，选项多少由数据决定（题库变多后自然就能筛）。*/
        items: pool, partItems: pool, sel: this.sel || {}, unitWord: '题', levelFilter: true,
        families: ['cet4', 'cet6', 'kaoyan'],
        filterTitle: '按考试类型、年份、月份 / 英语一或英语二、题号选择',
        hint: '依次选择考试类型、年份、月份或英语一 / 英语二，最后选择题号；题号仅显示当前题型内的翻译题，考研不按月份筛选。',
      })}</div>` : ''}
    ${mode === 'custom' && pool.length > 1 ? `<div class="card"><div class="card-b">
      <label class="lab" for="trCustomPick">选择自定义题目</label>
      <select class="inp" id="trCustomPick">${pool.map(item => `<option value="${esc(item.id)}"${item.id === (t && t.id) ? ' selected' : ''}>${esc(item.title)}</option>`).join('')}</select>
    </div></div>` : ''}

    <div class="read-type-tabs" role="tablist" aria-label="翻译题型">
      ${[['exam', '真题翻译'], ['sentence', '单句练习'], ['custom', '自定义题目']]
        .map(([k, label]) => `<button class="read-type-tab ${mode === k ? 'on' : ''}" role="tab"
          aria-selected="${mode === k}" data-tab="${k}">${label} <span>${counts[k]}</span></button>`).join('')}
      <span class="sp"></span>
      ${mode === 'custom' ? '<button class="btn btn-s btn-gh" data-act="custom">✎ 新建题目</button>' : ''}
      <button class="btn btn-s btn-gh" data-act="import">📄 导入真题</button>
    </div>

    ${t ? this._timerHTML(t) : ''}

    ${!t ? this._empty(mode, pool.length) : `

      <div class="tr-layout">
        <div class="card">
          <div class="card-h">${isSentence ? '单句翻译练习' : '翻译原文'}
            ${t.level ? `<span class="tag tag-pri">${esc(t.level)}</span>` : ''}
            <span class="tag tag-ok" title="${this._dirAuto() ? '按原文语种自动判定（中文原文=汉译英，英文原文=英译汉）' : '手动指定'}">${dirLabel}${this._dirAuto() ? ' · 自动' : ''}</span>
            ${!isSentence && t.examPaper ? `<span class="tag">${t.examPaper === 'english-2' ? '英语二' : t.examPaper === 'english-1' ? '英语一' : esc(t.examPaper)}</span>` : ''}
            ${!isSentence && t.translationVerification ? (verified
              ? '<span class="tag tag-ok">AI 已核验原文</span>' : '<span class="tag tag-warn">原文待核验</span>') : ''}
            ${!isSentence && t.translationVerification && Array.isArray(t.translationVerification.textIssues)
              && t.translationVerification.textIssues.length
              ? `<span class="tag tag-warn" title="${esc(t.translationVerification.textIssues.join('；'))}">原文疑似错字 ${t.translationVerification.textIssues.length} 处</span>` : ''}
            <span class="r">
              <span class="seg" style="margin-right:6px" title="默认按原文语种自动判定方向，也可以手动指定">
                <button class="mini-tab ${this._dirAuto() ? 'on' : ''}" data-dir="auto">自动</button>
                <button class="mini-tab ${this.dir === 'en2cn' ? 'on' : ''}" data-dir="en2cn">英译汉</button>
                <button class="mini-tab ${this.dir === 'cn2en' ? 'on' : ''}" data-dir="cn2en">汉译英</button>
              </span>
              <button class="btn btn-xs btn-gh" data-act="next">🔄 换一题</button>
              ${mode === 'custom' ? '<button class="btn btn-xs btn-warn" data-act="deleteCustom">删除本题</button>' : ''}
            </span>
          </div>
          <div class="card-b">
            ${isSentence ? `
              <div class="tr-dir-tip">${reverse ? '把下面这句中文翻译成英文' : '把下面这句英文翻译成中文'}</div>
              <div style="font-size:17px;font-weight:600;line-height:1.8">${esc(reverse ? (t.cn || '') : (t.en || ''))}</div>
              ${!reverse && t.cn ? `<div class="tr-hidden" data-act="reveal">参考答案（点击显示）<span class="tr-cn">${esc(t.cn)}</span></div>` : ''}
              <div class="hint" style="margin-top:10px">${reverse
                ? '参考答案（英文）可在提交批改后对照；本地评分同样以它为基准。'
                : '先自己翻，再点上面展开参考答案；提交后会给出四维评分与漏译清单。'}</div>
            ` : `
              <div class="ex-item" id="trSrc" style="line-height:1.9;font-size:14px">${esc(t.translationText || t.prompt || t.title || '')}</div>
              <div class="hint" style="margin-top:10px">请按原卷要求翻译，保留原题号；在下方输入译文。
                ${t.examPaper ? `卷别：${esc(t.examPaper === 'english-1' ? '英语一' : t.examPaper === 'english-2' ? '英语二' : t.examPaper)}　` : ''}<span id="trRefHint">满分 ${max} 分</span>　要求：${t.limit ? '限' + esc(String(t.limit)) + ' 分钟' : '不限时'}</div>
            `}
          </div>
        </div>

        <div class="tr-bottom">
          <div class="card">
            <div class="card-h">你的译文
            <span class="r"><span class="hint" style="font-size:12px">${AI.ready ? '支持拍照上传手写译文' : '未配置 AI：拍照识别不可用'}</span></span>
          </div>
          <div class="card-b">
            <div class="editor-tool">
              <button class="btn btn-xs btn-gh" data-act="clear">🗑 清空</button>
              <button class="btn btn-xs btn-gh" data-act="memo" title="查看最近 5 条译文输入，可一键恢复到编辑器">🕘 最近记录</button>
              <button class="btn btn-xs btn-gh" data-act="pickImg" title="上传手写译文照片，由 AI 识别并评分">📷 拍照/上传</button>
              <span class="sp"></span>
              <span style="font-size:12px;color:var(--tx3)">${reverse ? '词数' : '字数'}：<b id="trCount" style="color:var(--tx)">${this._count()}</b></span>
            </div>
            <div id="trImgs" class="w-imgs"></div>
            <textarea class="editor" id="trAns"
              placeholder="${reverse ? '请输入英文译文…' : '请输入中文译文…'}">${esc(this.answer)}</textarea>
            <div class="row" style="margin-top:12px;justify-content:flex-end">
              <button class="btn btn-pri btn-lg" data-act="grade">🚀 提交并评分</button>
            </div>
          </div>
        </div>

        <div class="an-panel">
        <div class="card">
          <div class="card-h">AI 评分
            <span class="r"><span class="tag ${AI.ready ? 'tag-ok' : 'tag-warn'}">${AI.ready ? 'AI 已启用' : '本地规则模式'}</span></span>
          </div>
          <div class="card-b" id="gradeBox">${this.result ? this._resultHTML(this.result) : this._emptyGrade()}</div>
        </div>
        <div class="card" id="trReference" style="margin-top:14px;${this.result && this.result.polished ? '' : 'display:none'}">
          <div class="card-h">${isSentence && reverse ? '参考英文译文' : '参考译文'}
            <span class="r"><button class="btn btn-xs btn-gh" data-act="copy">📋 复制</button></span>
          </div>
          <div class="card-b"><div class="ex-item" id="trPolished" style="line-height:1.9;font-size:13.5px">${esc(this.result && this.result.polished || '')}</div></div>
        </div>
      </div>
      </div>`}`;

    this._bind(root, mode);
    this._renderImgs(root);
    this._resumeTimer();   // 重渲染后按当前状态续跑（只有 running 才真的跑）
  },

  _emptyGrade() {
    return `<div class="empty">
      <svg viewBox="0 0 24 24" class="ic"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      <p>提交后获得：四维得分 · 总体评价 · 修改建议 · 参考译文<br>
      有参考译文时还会做 chrF 对齐核查与漏译完整性检查</p>
    </div>`;
  },

  _empty(mode, count = 0) {
    const hasAny = this._hasAny();
    return `<div class="card read-empty-type"><div class="card-b">
      <h2>${mode === 'custom' ? '还没有自定义翻译题' : count ? '当前筛选下没有翻译题'
        : mode === 'sentence' ? '还没有单句练习题' : '还没有翻译题'}</h2>
      <p>${mode === 'custom' ? '录入一段英文原文后可以随时继续练习，题目会保存在本机浏览器中。'
        : count ? '请调整上方的考试类型、年份或卷别。' : hasAny
        ? '切换到另一个题型试试，或点右上角「导入真题」把含翻译题的试卷导进来。'
        : '导入含翻译题的真题 PDF（推荐），AI 会自动识别翻译部分、核验原文完整性并按年份卷别入库。<br>也可以点「自定义题目」手动录入一段原文练习。'}</p>
      <div class="row" style="gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        ${mode !== 'custom' ? '<button class="btn btn-pri" data-act="import">📄 导入真题</button>' : ''}
        ${mode !== 'custom' ? '<button class="btn btn-gh" data-act="resetTrFilter">清除筛选，查看全部</button>' : ''}
        <button class="btn btn-gh" data-act="custom">✎ 自定义题目</button>
      </div>
    </div></div>`;
  },

  /* ---------- 交互 ---------- */
  _bind(root, mode) {
    const self = this;
    this._memoListen();   // 离开页面前把防抖窗口里的最后一次输入落盘

    root.addEventListener('click', async e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { self._memoFlush(); App.go(nav.dataset.nav); return; }
      const reveal = e.target.closest('[data-act="reveal"]');
      if (reveal) { reveal.classList.toggle('open'); return; }
      const suggestion = e.target.closest('[data-sug]');
      if (suggestion && this.result && typeof window.sugHTML === 'function') {
        $$('[data-sug]', root).forEach(x => x.classList.toggle('on', x === suggestion));
        const box = $('#sugBox', root);
        if (box) box.innerHTML = window.sugHTML(this.result, suggestion.dataset.sug);
        return;
      }
      const say = e.target.closest('[data-say]');
      if (say) { Speech.speak(say.dataset.say, { rate: .85 }); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        self._memoFlush();
        self._resetMemo();
        self.mode = tab.dataset.tab;
        self.result = null; self.answer = ''; self._imgs = [];
        self._resetTimer();
        self._shell(App.freshView());
        return;
      }
      const dirEl = e.target.closest('[data-dir]');
      if (dirEl) {
        const before = self._isReverse();
        self.dir = dirEl.dataset.dir;
        /* 单句练习换方向 = 换了一篇源文，必须清空作答；
         * 整篇题的方向只是告诉 AI 该按哪种语言评，源文没变，别把用户输入清掉。 */
        if (mode === 'sentence' && before !== self._isReverse()) {
          self._memoFlush();
          self._resetMemo();
          self.answer = ''; self.result = null; self._imgs = [];
        }
        self._shell(App.freshView()); return;
      }

      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;

      if (act === 'import') { self._openImporter(); return; }
      if (act === 'resetTrFilter') {
        self.sel = { level: 'all', year: 'all', session: 'all', no: 'all' };
        self._shell(App.freshView());
        App.toast('已清除筛选条件，已导入内容仍在', 'ok');
        return;
      }
      if (act === 'custom') { self._custom(); return; }
      if (act === 'next') { self._next(mode, root); return; }
      if (act === 'deleteCustom') { self._deleteCustom(); return; }
      if (act === 'grade') { await self._grade(root); return; }
      if (act === 'memo') { self._openMemo(); return; }
      if (act === 'clear') { self._clear(root); return; }
      if (act === 'copy') { await self._copy(); return; }
      if (act === 'pickImg') { $('#trImgInput', root)?.click(); return; }
      if (act === 'delImg') { self._delImg(+a.dataset.i, root); return; }
      if (act === 'retry') { await self._grade(root); return; }
      if (act === 'aiTest') {
        App.toast('正在测试…', '');
        const status = await AI.test();
        App.toast(status.msg, status.ok ? 'ok' : 'err');
        return;
      }
      if (act === 'toSetting') { App.go('settings'); return; }
    });

    // 译文输入：字数实时更新
    const ta = $('#trAns', root);
    if (ta) {
      ta.oninput = () => {
        self.answer = ta.value;
        const c = $('#trCount', root);
        if (c) c.textContent = self._count(ta.value);
        self._memoSoon(ta.value);   // 800ms 防抖自动记忆，最多保留最近 5 条
      };
      // 粘贴/拍照上传
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.id = 'trImgInput'; inp.style.display = 'none';
      inp.onchange = async () => {
        for (const file of [...inp.files]) {
          try {
            self._imgs.push(await readWritingImage(file));
            self._renderImgs(root);
          } catch (error) { App.toast(error.message || '照片读取失败', 'err'); }
        }
        inp.value = '';
      };
      root.appendChild(inp);
    }

    // 本题满分：手填后作为所有题目的默认满分（与写作页同一个交互习惯）
    const total = $('#trTotal', root);
    if (total) {
      total.onchange = () => {
        const value = Math.min(100, Math.max(1, Math.round(Number(total.value) || 0)));
        if (!Number.isFinite(value) || value < 1) { total.value = self._maxScore(); return; }
        total.value = value;
        Store.d.translation = Object.assign({ totalScore: 0 }, Store.d.translation);
        Store.d.translation.totalScore = value;
        Store.flush();
        const hint = $('#trRefHint', root);
        if (hint) hint.textContent = '满分 ' + value + ' 分';
        App.toast('本题满分已设为 ' + value + ' 分', 'ok');
      };
    }

    // 题池选择（Picker.bind 签名：root, items, cur, onChange, opts）
    const pool = this._pool(mode);
    if ($('#trPicker', root)) {
      Picker.bind(root, pool, this.sel || {}, s => {
        this._memoFlush();
        this._resetMemo();
        this.sel = s;
        this.task = Picker.filter(pool, s)[0] || null;
        this.answer = ''; this.result = null; this._imgs = [];
        this._resetTimer();
        this._shell(App.freshView());
      }, { partItems: pool, partById: true, unitWord: '题' });
    }
    const customPick = $('#trCustomPick', root);
    if (customPick) customPick.onchange = () => {
      this._memoFlush();
      this._resetMemo();
      this.task = pool.find(t => t.id === customPick.value) || null;
      this.answer = ''; this.result = null; this._imgs = [];
      this._shell(App.freshView());
    };
    // 计时按钮（与阅读页同样的四个动作）
    const tStart = $('#trTStart', root);
    if (tStart) tStart.onclick = () => {
      const sel = $('#trLimit', root);
      self._tStart(sel ? +sel.value : 0);
    };
    const tPause = $('#trTPause', root);
    if (tPause) tPause.onclick = () => {
      self.tState = self.tState === 'paused' ? 'running' : 'paused';
      self._shell(App.freshView());
    };
    const tStop = $('#trTStop', root);
    if (tStop) tStop.onclick = () => {
      clearInterval(self.timer);
      self.tState = 'finished';
      self._shell(App.freshView());
      App.toast('计时已结束', '');
    };
    const tReset = $('#trTReset', root);
    if (tReset) tReset.onclick = () => {
      self._resetTimer();
      self._shell(App.freshView());
      App.toast('已归零，可以重新选择时长', '');
    };

    const firstSuggestion = $('[data-sug="all"]', root);
    if (firstSuggestion) firstSuggestion.classList.add('on');
  },

  _clear(root) {
    if (!this.answer && !this._imgs.length) { App.toast('译文已经是空的', ''); return; }
    this._memoFlush();    // 清空之前先记住这段已写的内容
    this._resetMemo();
    this.answer = ''; this._imgs = []; this.result = null;
    const ta = $('#trAns', root);
    if (ta) { ta.value = ''; ta.focus(); }
    const c = $('#trCount', root);
    if (c) c.textContent = '0';
    this._renderImgs(root);
    const box = $('#gradeBox', root);
    if (box) box.innerHTML = this._emptyGrade();
    const ref = $('#trReference', root);
    if (ref) ref.style.display = 'none';
  },

  async _copy() {
    const text = (this.result && this.result.polished) || '';
    if (!text) { App.toast('还没有参考译文', ''); return; }
    try { await navigator.clipboard.writeText(text); App.toast('已复制参考译文', 'ok'); }
    catch (e) { App.toast('复制失败，请手动选择文本', 'err'); }
  },

  _next(mode, root) {
    this._memoFlush();     // 换题前落盘，换题后开新的一条
    this._resetMemo();
    const all = this._pool(mode);
    const pool = mode === 'exam' ? Picker.filter(all, this.sel) : all;
    if (!pool.length) { App.toast('当前题型没有题目', ''); return; }
    const i = pool.findIndex(x => x && x.id === (this.task && this.task.id));
    this.task = pool[(i + 1) % pool.length];
    this.answer = ''; this.result = null; this._imgs = [];
    this._resetTimer();
    this._shell(App.freshView());
  },

  _openImporter() {
    Importer.open('writing', { defaults: { type: 'kaoyan' } });
  },

  /** 自定义题目：手动录入原文 */
  _custom() {
    this._memoFlush();
    this._resetMemo();
    App.modal('自定义翻译题', `
      <div class="fld"><label class="lab">原文（英文）</label>
        <textarea class="inp" id="ctEn" placeholder="粘贴要翻译的英文段落..."></textarea></div>
      <div class="fld"><label class="lab">参考译文（选填，但强烈建议填写）</label>
        <input class="inp" id="ctCn" placeholder="填了它，未配置 AI 时也能给出 chrF 本地评分"></div>
      <div class="row" style="gap:8px">
        <div class="fld sp"><label class="lab">满分</label><input class="inp" type="number" id="ctS" value="10"></div>
      </div>
      <button class="btn btn-pri btn-blk" id="ctOk">开始练习</button>`, b => {
      $('#ctOk', b).onclick = () => {
        const en = $('#ctEn', b).value.trim();
        if (!en) { App.toast('请输入原文', ''); return; }
        this.task = {
          id: 'tr-custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          level: '自定义', genre: '自定义', writingType: 'translation',
          title: en.slice(0, 40), prompt: en, translationText: en,
          cn: $('#ctCn', b).value.trim(),
          expectScore: Math.min(100, Math.max(1, +$('#ctS', b).value || 10)), mine: true,
        };
        Store.d.translationCustomTasks = [this.task, ...this._customPool()];
        Store.flush();
        this.mode = 'custom';
        this.answer = ''; this.result = null; this._imgs = [];
        App.closeModal();
        this._shell(App.freshView());
      };
    });
  },

  _deleteCustom() {
    if (this.mode !== 'custom' || !this.task) return;
    const id = this.task.id;
    App.confirm('删除这道自定义翻译题？', () => {
      this._memoFlush();
      this._resetMemo();
      Store.d.translationCustomTasks = this._customPool().filter(t => t.id !== id);
      Store.flush();
      this.task = null; this.answer = ''; this.result = null; this._imgs = [];
      this._shell(App.freshView());
    });
  },

  /* ---------- 图片 ---------- */
  _renderImgs(root) {
    const box = $('#trImgs', root);
    if (!box) return;
    if (!this._imgs.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="wi-h">已上传 ${this._imgs.length} 张 · 将连同译文一起交给 AI 识别评分</div>
      <div class="wi-row">
        ${this._imgs.map((im, i) => `<div class="wi-item">
          <img src="${im.data}" alt="译文图片 ${i + 1}">
          <button class="wi-del" data-act="delImg" data-i="${i}" title="移除">✕</button>
        </div>`).join('')}
      </div>`;
  },

  _delImg(i, root) {
    this._imgs.splice(i, 1);
    this._renderImgs(root);
  },

  /* ---------- 计时（与阅读页同一套位置与用法） ---------- */
  _tLabel() {
    return ({ idle: '未开始', running: '剩余时间', paused: '已暂停', finished: '时间到' })[this.tState] || '未开始';
  },

  /** 计时条：放在内容区顶部，按钮与阅读页一致（开始 / 暂停 / 结束 / 归零） */
  _timerHTML(t) {
    const limit = this.tLimit || +(t && t.limit) || 30;
    const busy = this.tState === 'running' || this.tState === 'paused';
    return `
    <div class="rd-topbar">
      <div class="timer-box ${this.tState === 'paused' ? 'paused' : ''} ${this.tState === 'idle' ? 'idle' : ''} ${this.tState === 'finished' ? 'done' : ''}" id="trTimerBox">
        <span style="color:var(--pri)"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
        <div>
          <div style="font-size:11px;color:var(--tx3)" id="trTLabel">${this._tLabel()}</div>
          <div class="t" id="trTDisp">${App.mmss(this.tLeft)}</div>
        </div>
        ${busy ? `
          <button class="btn btn-xs ${this.tState === 'paused' ? 'btn-ok' : 'btn-warn'}" id="trTPause">${this.tState === 'paused' ? '▶ 继续' : '❚❚ 暂停'}</button>
          <button class="btn btn-xs btn-gh" id="trTStop">■ 结束</button>` : ''}
        ${this.tState === 'finished' ? '<button class="btn btn-xs btn-warn" id="trTReset">↺ 归零</button>' : ''}
      </div>
      ${this.tState === 'idle' ? `
        <select class="inp" id="trLimit" style="width:auto;padding:7px 11px">
          ${[10, 15, 20, 30, 40, 60].map(m => `<option value="${m}"${m === limit ? ' selected' : ''}>${m} 分钟</option>`).join('')}
        </select>
        <button class="btn btn-ok btn-s" id="trTStart">▶ 开始计时</button>` : ''}
      <span class="sp"></span>
      <span class="hint">${this.tState === 'finished'
        ? '时间到：仍可修改译文，改完点「提交并评分」'
        : '限时练习：到点会自动提交并评分（用法与阅读页面一致）'}</span>
    </div>`;
  },

  /** 换页/换题时把计时归零，避免旧 interval 继续跑 */
  _resetTimer() {
    clearInterval(this.timer);
    this.tState = 'idle';
    this.tLeft = 0;
  },

  /** 重渲染后按当前状态续跑（只有 running 才真的跑） */
  _resumeTimer() {
    clearInterval(this.timer);
    if (this.tState !== 'running') return;
    const self = this;
    this.timer = setInterval(() => {
      if (self.tState !== 'running') return;
      self.tLeft = Math.max(0, self.tLeft - 1);
      const disp = document.getElementById('trTDisp');
      if (disp) disp.textContent = App.mmss(self.tLeft);
      if (self.tLeft <= 0) self._tTimeout();
    }, 1000);
  },

  _tStart(limit) {
    this.tLimit = Math.max(1, limit || this.tLimit || +(this.task && this.task.limit) || 30);
    this.tLeft = this.tLimit * 60;
    this.tState = 'running';
    this._shell(App.freshView());
    App.toast('计时开始：' + this.tLimit + ' 分钟', 'ok');
  },

  _tTimeout() {
    clearInterval(this.timer);
    this.tState = 'finished';
    this.tLeft = 0;
    this._shell(App.freshView());
    const hasWork = !!(this.answer || '').trim() || this._imgs.length;
    App.toast(hasWork ? '时间到，已自动提交评分' : '时间到：请填写译文后点「提交并评分」', hasWork ? 'warn' : '');
    if (hasWork) this._grade(document.getElementById('view'));
  },

  /* ---------- 评分 ---------- */
  async _grade(root) {
    this._memoFlush();    // 提交前把当前译文落盘
    this._resetMemo();    // 提交后继续输入算新的一条
    const t = this.task;
    if (!t) { App.toast('没有可评分的题目', ''); return; }
    const ans = this.answer.trim();
    if (!ans && !this._imgs.length) { App.toast('请先填写译文，或上传手写译文照片', ''); return; }
    const max = this._maxScore(t);

    const box = $('#gradeBox', root);
    if (box) {
      box.innerHTML = `<div class="row" style="justify-content:center;padding:30px">
        <span class="spin"></span> <span class="dots">${this._imgs.length
          ? 'AI 正在识别图片并评分' : AI.ready ? 'AI 正在批改译文' : '正在用本地规则评分（chrF 对齐 + 完整性检查）'}</span></div>`;
    }

    try {
      let r;
      const imgs = this._imgs;
      if (this.mode === 'sentence') {
        const dir = this._isReverse() ? 'cn2en' : 'en2cn';
        const source = dir === 'cn2en' ? t.cn : t.en;
        const reference = dir === 'cn2en' ? t.en : t.cn;
        r = await AI.gradeTranslation({ prompt: source, referenceTranslation: reference },
          ans, imgs, max, { direction: dir });
      } else {
        // 显式传方向：不要让它再默认英译汉（中文原卷的题会因此评不出来）
        r = await AI.gradeTranslation(t, ans, imgs, max, { direction: this._resolveDir(t) });
      }
      this.result = r;
    } catch (e) {
      this.result = {
        gradingFailed: true,
        errMsg: (e && e.message) || '评分失败，请重试',
      };
    }

    // 只有成功返回分数才记一次练习；接口失败不应记成零分。
    if (this.result && !this.result.gradingFailed && this.result.score) {
      try {
        Store.addStat('write', 1);
        const sc = this.result.score;
        Store.d.writeLog.unshift({
          at: Date.now(), kind: 'translation',
          title: (t.title || t.translationText || t.cn || '').slice(0, 40),
          score: +sc.total || 0,
          max: +(sc.max || max),
        });
        Store.d.writeLog = Store.d.writeLog.slice(0, 60);
        Store.flush();
      } catch (e) { /* 统计失败不影响评分展示 */ }
    }

    const gb = $('#gradeBox', root);
    if (gb) gb.innerHTML = this._resultHTML(this.result);
    const firstSuggestion = $('[data-sug="all"]', root);
    if (firstSuggestion) firstSuggestion.classList.add('on');
    const referenceBox = $('#trReference', root);
    if (referenceBox) referenceBox.style.display = this.result && this.result.polished ? '' : 'none';
    const polished = $('#trPolished', root);
    if (polished) polished.textContent = this.result && this.result.polished || '';
  },

  /** 评分结果渲染
   *  直接复用写作页的 gradeHTML()（已 window 导出）——
   *  翻译与写作的评分返回结构相同（score.{total,max,TR,CC,LR,GRA}），
   *  且 gradeHTML 会根据 r.translation 自动切换成翻译的四维名称。
   *  自己写一份只会造成两处渲染不一致。
   */
  _resultHTML(r) {
    let main = '';
    if (typeof window.gradeHTML === 'function') {
      try { main = window.gradeHTML(r); }
      catch (e) { console.warn('gradeHTML 渲染失败', e); }
    }
    if (!main) {
      // 兜底：gradeHTML 不可用时至少显示得分，避免用户看到空白
      const s = (r && r.score) || {};
      main = `<div class="ex-item">
        ${r && r.gradingFailed ? '暂未评分：' + esc(r.errMsg || '请重试')
          : `得分 <b>${esc(String(s.total || 0))}</b> / ${esc(String(s.max || 30))} 分`}
        ${r && r.comment ? `<div class="cn">${esc(r.comment)}</div>` : ''}
      </div>`;
    }
    return main + this._checksHTML(r);
  },

  /**
   * 把"不依赖模型"的检查结果摊开给用户看：
   * 逐句核对（模型返回的 coverage）、chrF 对齐值、漏译提醒。
   * 这些数此前只存在于返回对象里，用户看不到，也就无法判断分数是否可信。
   */
  _checksHTML(r) {
    if (!r || r.gradingFailed || r.ocrFailed) return '';
    const parts = [];
    /* 方向被纠正 / 参考译文语言不符：不再阻止看分数，但要讲清楚 */
    if (r.referenceIssue) {
      const c = r.directionCorrection;
      parts.push(`<div class="ai-warn"><b>${c ? '已按参考译文的语种纠正翻译方向' : '参考译文或评语不完整'}</b>
        <div class="ai-warn-msg">${esc(r.referenceIssue)}${c ? '　（原判定 ' + (c.from === 'cn2en' ? '汉译英' : '英译汉') + ' → 实际按 ' + (c.to === 'cn2en' ? '汉译英' : '英译汉') + ' 展示）' : ''}</div></div>`);
    }
    const checks = r.localChecks || {};
    const cov = checks.coverage;
    if (cov && Array.isArray(cov.triggers) && cov.triggers.length) {
      parts.push(`<div class="ai-warn"><b>完整性检查</b>
        <div class="ai-warn-msg">${esc(cov.triggers.join('；'))}。原文约 ${cov.srcUnits} 句/题号，译文约 ${cov.hypUnits} 句。</div></div>`);
    }
    const align = checks.alignment;
    if (align && align.checked) {
      parts.push(`<div class="hint" style="margin-top:10px">参考译文对齐：chrF <b>${align.chrf.toFixed(1)}</b> / 100
        （字符 n-gram 重合度，sacrebleu 口径；仅作独立核对，不单独决定得分）</div>`);
    }
    const coverage = Array.isArray(r.coverage) ? r.coverage.filter(x => x && (x.unit || x.issue)) : [];
    if (coverage.length) {
      parts.push('<div class="sec-t">逐句核对</div>' + coverage.slice(0, 12).map((x, i) => {
        const missed = x.translated === false;
        return `<div class="sug-item"><span class="n">${i + 1}</span>
          <span class="tag ${missed ? 'tag-warn' : 'tag-ok'}">${missed ? '漏译' : '已译'}</span>
          <span style="flex:1">${esc(String(x.unit || '').slice(0, 80))}${x.issue ? '　' + esc(String(x.issue).slice(0, 80)) : ''}</span></div>`;
      }).join(''));
    }
    return parts.length ? `<div style="margin-top:14px">${parts.join('')}</div>` : '';
  },
};

window.ViewTranslate = ViewTranslate;


