/* ============ views/reading.js : 阅读模块 ============ */
const ViewRead = {
  mode: 'exam',       // exam（做题模式） | edit（修改模式）
  pi: 0,
  answers: {},
  submitted: false,
  marks: {},          // { [wordIndexOrSentKey]: type }
  selected: null,     // 当前分析对象 {type:'word'|'sent', text}
  nbOpts: { onlyMarked: true, ext: 8, root: false, phrase: false, hard: false },
  timer: null,
  left: 0,
  drawColor: '#fde047',

  async render(root, params) {
    Dict.load(Store.d.activeBook || 'cet6').catch(() => { });
    if (!Dict.content) { root.innerHTML = '<div class="empty"><p>加载中…</p></div>'; return; }
    this._shell(root);
  },

  /** 本模块停留秒数（累计多次进出） */
  _pageSeconds() {
    this._accSeconds = (this._accSeconds || 0) + App.pageSeconds();
    App.resetPageTimer();
    return this._accSeconds;
  },

  _readType(p) {
    const raw = String(p && (p.readingType || p.readingKind || '') || '').toLowerCase();
    if (/^cloze$|完形填空|完型填空/.test(raw) || /完形填空|完型填空/.test(String(p && p.genre || ''))) return 'cloze';
    if (/section[-_ ]?a|word[-_ ]?bank|选词填空/.test(raw) || /选词填空/.test(String(p && p.genre || ''))) return 'section-a';
    if (/section[-_ ]?b|paragraph[-_ ]?match|段落匹配/.test(raw)) return 'section-b';
    return 'traditional';
  },

  /** 保留前三级考试范围，同时让第四级篇目下拉只列当前题型。 */
  _pickerParts(items) {
    const type = this.readType || 'traditional';
    return (items || []).filter(p => this._readType(p) === type);
  },

  _typeLabel(type) {
    return ({ traditional: '阅读理解', 'section-a': '选词填空', 'section-b': '段落匹配', cloze: '完形填空' })[type] || '阅读理解';
  },

  _typeTabs(items) {
    const types = ['traditional', 'section-a', 'section-b', 'cloze'];
    return `<div class="read-type-tabs" role="tablist" aria-label="阅读题型">
      ${types.map(type => {
        const count = items.filter(p => this._readType(p) === type).length;
        return `<button class="read-type-tab ${this.readType === type ? 'on' : ''}" role="tab"
          aria-selected="${this.readType === type}" data-read-type="${type}">
          ${this._typeLabel(type)} <span>${count}</span></button>`;
      }).join('')}
    </div>`;
  },

  _pickerMeta() {
    return {
      levelFilter: true,
      partById: true,
      filterTitle: '按考试类型、年份、月份 / 英语一或英语二、篇目选择',
      hint: '依次选择考试类型、年份、月份或英语一 / 英语二，最后选择篇目；篇目仅显示当前题型内的文章，考研不按月份筛选。',
    };
  },

  _bindEmptyType(root, all) {
    Picker.bind(root, all, this.sel || {}, s => {
      this.sel = s; this.pi = 0; this._shell($('#view'));
    }, { partItems: this._pickerParts(all), partById: true });
    on(root, 'click', '[data-read-type]', (e, t) => {
      if (this.readType !== t.dataset.readType) {
        /* 切题型只需把“篇目”归零；筛选的其它维度要补默认值，
         * 否则 Picker.filter 收到只有一个 no 键的 sel 会筛空（真实 bug）。*/
        this.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all', ...(this.sel || {}), no: 'all' };
      }
      this.readType = t.dataset.readType;
      this.pi = 0; this.answers = {}; this.submitted = false;
      this.rState = 'idle'; this.timeLimit = null;
      this._shell($('#view'));
    });
    on(root, 'click', '[data-act="import"]', () => Importer.open('reading'));
    on(root, 'click', '[data-act="resetReadFilter"]', () => {
      /* 只清筛选，不动任何题库数据；用户常把“筛选为空”误认为文档被删。*/
      this.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
      this._lastSelKey = null;
      this.pi = 0;
      this._shell($('#view'));
      App.toast('已清除筛选条件，已导入内容仍在', 'ok');
    });
    on(root, 'click', '[data-nav="home"]', () => App.go('home'));
  },

  _emptyTypeShell(root, all, items, pickerHint) {
    clearInterval(this.timer);
    Speech.stop();
    this.cur = null;
    this.list = [];
    this.left = 0;
    this.rState = 'idle';
    const pickerMeta = this._pickerMeta();
    root.innerHTML = `
      <div class="phead">
        <button class="btn btn-gh btn-s" data-nav="home">← 返回</button>
        <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg></div>
        <div><h1>阅读练习</h1><div class="sub">${this._typeLabel(this.readType)}</div></div>
        <div class="phead-r"><button class="btn btn-gh btn-s" data-act="import">📄 导入真题</button></div>
      </div>
      <div id="rdPicker">${Picker.html({ items: all, partItems: this._pickerParts(all), sel: this.sel || {}, unitWord: '篇', levelFilter: true,
        ...pickerMeta, aiTip: pickerHint || '' })}</div>
      ${this._typeTabs(all)}
      <div class="card read-empty-type"><div class="card-b">
        <div class="read-empty-icon">📚</div>
        <h2>${this._typeLabel(this.readType)}</h2>
        <p>当前筛选条件下还没有这类题目。切换题型只改变显示范围，<b>不会删除已导入的文档和题目</b>；其它题型或“全部年份/场次”下仍可查看。</p>
        <div class="hint" style="margin-bottom:10px">当前筛选：${esc((this.sel && this.sel.level && this.sel.level !== 'all') ? Picker.familyLabel(this.sel.level) : '全部考试类型')} · ${esc(this.sel && this.sel.year && this.sel.year !== 'all' ? this.sel.year + ' 年' : '全部年份')} · ${esc(this.sel && this.sel.session && this.sel.session !== 'all' ? sessionLabel(this.sel.session) : '全部场次')}</div>
        <button class="btn btn-pri" data-act="resetReadFilter" style="margin-right:8px">清除筛选，查看全部</button>
        <button class="btn btn-gh" data-act="import">导入整份真题</button>
      </div></div>`;
    this.allPass = all;
    this._bindEmptyType(root, all);
  },

  _shell(root) {
    root = App.freshView();
    const all = Dict.content.reading.passages;
    if (!this.readType) this.readType = 'traditional';
    const filt = Picker.filter(all, this.sel || { year: 'all', session: 'all', no: 'all' });
    const pool = filt;
    /* 用户常把“筛选为空”误认为题库被删：只要全库有内容、而当前筛选 0 篇，
     * 自动清掉筛选再渲染一次；绝不改 Dict.content。*/
    const filterRestrictive = !!(this.sel && (
      (this.sel.level && this.sel.level !== 'all')
      || (this.sel.year && this.sel.year !== 'all' && this.sel.year !== null)
      || (this.sel.session && this.sel.session !== 'all')
      || (this.sel.set && this.sel.set !== 'all')
    ));
    if (!filt.length && all.length > 0 && filterRestrictive) {
      this.sel = { level: 'all', year: 'all', session: 'all', set: 'all', no: 'all' };
      this._lastSelKey = null;
      App.toast('当前筛选没有匹配篇目，已自动切回全部题库', '');
      return this._shell(root);
    }
    const list = pool.filter(p => this._readType(p) === this.readType);
    this.allPass = all;
    /*只在「筛选条件真的变了」时才归零并重置限时。
     * 早期写法是 if (filt.length) 每次都重置 —— 结果用户改完时间后触发重渲染，
     * pi 和 timeLimit 都被冲回默认值，表现为"下拉框选了却没反应"。
     */
    const selKey = JSON.stringify({ sel: this.sel || {}, type: this.readType });
    if (selKey !== this._lastSelKey) {
      this._lastSelKey = selKey;
      this.pi = 0;
      this.timeLimit = null;// 用文章自带的
      this.answers = {}; this.submitted = false; this.marks = {}; this.selected = null; this.hist = [];
      this._paraCn = {}; this._paraOpen = new Set();   // 切篇清空段落翻译
    }
    if (!list.length) {
      this._emptyTypeShell(root, all, pool, filt.length ? '' : '当前考试范围没有匹配题目，请调整筛选条件或导入试卷。');
      return;
    }
    if (this.pi >= list.length) this.pi = 0;
    if (!this.rState) this.rState = 'idle';
    /* 划线颜色需在渲染前定好，否则工具栏会一个都不选中
     *（drawType 原先只在 _markWord 里才初始化）。*/
    if (!this.drawType) this.drawType = 'hl-y';
    const p = list[this.pi];
    const isTraditional = this._readType(p) === 'traditional';
    const isSectionA = this._readType(p) === 'section-a';
    const isSectionB = this._readType(p) === 'section-b';
    const isCloze = this._readType(p) === 'cloze';
    const traditionalQuiz = isTraditional && this.mode === 'exam';
    const specialQuiz = !isTraditional && this.mode === 'exam';
    const showAnalysis = this.mode === 'edit';
    const layoutClass = isSectionB && specialQuiz ? 'read-layout-matching-exam'
      : isSectionA ? 'read-layout-section-a'
      : isCloze && specialQuiz ? 'read-layout-cloze-exam'
      : traditionalQuiz || specialQuiz ? 'read-layout-quiz'
      : showAnalysis ? 'read-layout-cloze' : 'read-layout-special';
    const modeHelp = isTraditional
      ? (this.mode === 'exam' ? '做题模式：仅可查看标题和标注，不可查看单词意思' : '修改模式：可作答并查看解析')
      : isSectionA && this.mode === 'edit' ? '修改模式：可作答、查词并分析长难句'
        : (this.mode === 'exam' ? '做题模式：提交后显示答案与解析' : '修改模式：可作答并查看解析');
    this.cur = p;
    this.list = list;
    // 用this.timeLimit（用户可能改过），没有才用文章自带的
    this.left = (this.timeLimit || p.timeLimit) * 60;
    const pickerMeta = this._pickerMeta();
    root.innerHTML = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-nav="home">← 返回</button>
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg></div>
      <div>
        <h1>阅读练习</h1>
        <div class="sub">${esc(p.title)} · ${esc(p.level || '待核验')}
          ${p.typeVerification === 'ai-verified'
            ? `<span class="tag tag-ok" title="${esc((p.typeEvidence || []).join('；'))}">AI 核验类型</span>`
            : p.typeVerification ? '<span class="tag tag-warn">类型待核验</span>' : ''}
        </div>
      </div>
      <div class="phead-r">
        <div class="seg">
          <button class="${this.mode === 'exam' ? 'on' : ''}" data-mode="exam">做题模式</button>
          <button class="${this.mode === 'edit' ? 'on' : ''}" data-mode="edit">修改模式</button>
        </div>
        <button class="btn btn-gh btn-s" data-act="import">📄 导入真题</button>
        <button class="btn btn-pri btn-s" data-act="export">导出阅读生词 PDF</button>
      </div>
    </div>

      <div id="rdPicker">${Picker.html({
      items: all, partItems: this._pickerParts(all), sel: this.sel || {}, unitWord: '篇', levelFilter: true,
      ...pickerMeta,
      aiTip: '',
    })}</div>

    ${this._typeTabs(all)}

    <div class="row" style="margin-bottom:12px">
      <span class="tag tag-warn">${p.source === 'generated-unverified' ? '生成内容（来源未核验）' : p.mine ? '我导入的题目（来源未核验）' : p.source === 'user-provided-pdf' ? '用户提供 PDF（来源未核验）' : '内置仿真题（非真题原文）'}</span>
      ${p.year !== null && p.year !== undefined ? `<span class="tag">${fullLabel(p.year, p.session)} · ${esc(p.pickerLabel || `第 ${p.no} 篇`)}</span>` : ''}
      ${p.genre && p.genre !== p.pickerLabel && p.genre !== p.examPart ? `<span class="tag">${esc(p.genre)}</span>` : ''}
      <span class="sp"></span>
      <button class="btn btn-gh btn-s" data-act="genPassage">✨ AI 生成新文章</button>
      ${p.mine ? `<button class="btn btn-gh btn-s" data-act="delPassage">删除本篇</button>` : ''}
    </div>

    <!-- 顶部工具条：计时 + 本篇总分（置顶，方便随时掌握时间与满分） -->
    <div class="rd-topbar">
      <div class="timer-box ${this.rState === 'paused' ? 'paused' : ''} ${this.rState === 'idle' ? 'idle' : ''} ${this.rState === 'finished' ? 'done' : ''}" id="timerBox">
        <span style="color:var(--pri)"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
        <div>
          <div style="font-size:11px;color:var(--tx3)" id="tLabel">${this._rLabel()}</div>
          <div class="t" id="tDisp">${App.mmss(this.left)}</div>
        </div>

        ${this.rState === 'running' || this.rState === 'paused' ? `
          <button class="btn btn-xs ${this.rState === 'paused' ? 'btn-ok' : 'btn-warn'}" id="btnPause"
            title="${this.rState === 'paused' ? '继续计时' : '暂停计时'}">
            ${this.rState === 'paused'
        ? '<svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>继续'
        : '<svg viewBox="0 0 24 24" class="ic ic-sm">❚❚</svg>暂停'}
          </button>
          <button class="btn btn-xs btn-gh" id="btnRStop" title="结束计时并锁定时长">■ 结束</button>`
        : this.rState === 'finished' ? `
          <button class="btn btn-xs btn-warn" id="btnRReset" title="归零后才能重新选择时长">↺ 归零</button>` : ''}

        ${this.rState === 'idle' || !this.rState ? `
        <select class="inp" id="timeSel" style="width:auto;padding:5px 9px;font-size:12px" title="设置本题限时">
          ${[10, 15, 20, 25, 30, 40, 60].map(t => `<option value="${t}"${t === (this.timeLimit || p.timeLimit) ? ' selected' : ''}>${t} 分钟</option>`).join('')}
        </select>
        <button class="btn btn-xs btn-ok" id="btnRStart">▶ 开始计时</button>` : ''}
      </div>

      <div class="rd-total">
        <span class="hint" style="font-size:12px;margin:0">本篇总分</span>
        <input class="inp" id="pTotal" type="number" min="1" step="1" style="width:72px;text-align:center"
          placeholder="AI估算" value="${p.totalScore || ''}" title="留空则由 AI 根据题目来源自动估算">
        <button class="btn btn-xs btn-gh" id="btnAiTotal" title="让 AI 根据题目来源估算总分">✨ AI估算</button>
        ${this._totalEstimated ? `<span class="hint" style="font-size:11px;margin:0">AI 依据：${esc(this._totalReason || '题目来源')}</span>` : ''}
      </div>
    </div>

    ${isSectionA ? `<div class="read-section-a-bank-wrap">${this._renderWordBank(p, true)}</div>` : ''}

    <div class="rd-layout ${layoutClass}">
      <div class="${isSectionB && specialQuiz ? 'read-match-source-side' : ''}">
        <div class="card ${isSectionB && specialQuiz ? 'read-match-source-card' : traditionalQuiz ? 'read-quiz-source-card' : ''}">
          <div class="card-h">
            ${esc(p.title)} <span class="tag tag-pri">${p.level}</span>
            <span class="r">
              ${isTraditional && this.mode === 'exam'
        ? `<span class="tag tag-warn">⛔ 作答中不可查词</span>`
                : showAnalysis ? `<span class="tag tag-ok">✔ 可查词 · 可划线标注</span>` : ''}
            </span></div>
          <div class="card-b" style="padding-bottom:8px">
            <div class="rd-tool" id="rdTool" style="display:${showAnalysis && this.mode === 'edit' ? 'flex' : 'none'}">
              <button class="tool w1 ${this.drawType==='hl-y'?'on':''}" data-draw="hl-y" title="黄色高亮">▬</button>
              <button class="tool w2 ${this.drawType==='hl-b'?'on':''}" data-draw="hl-b" title="蓝色高亮">▬</button>
              <button class="tool w3 ${this.drawType==='hl-g'?'on':''}" data-draw="hl-g" title="绿色高亮">▬</button>
              <button class="tool w4 ${this.drawType==='hl-p'?'on':''}" data-draw="hl-p" title="粉色高亮">▬</button>
              <button class="tool w5 ${this.drawType==='hl-u'?'on':''}" data-draw="hl-u" title="下划线">U</button>
              <span style="width:1px;height:20px;background:var(--line2);margin:0 4px"></span>
              <button class="tool" data-act="clearMarks" title="清除标注">🧹</button>
              <button class="tool" data-act="clearOne" title="删除当前划线">✕</button>
              <span style="width:1px;height:20px;background:var(--line2);margin:0 4px"></span>
              <span class="hint" style="margin:0">先选颜色，再点词或拖选；换色会更新当前高亮</span>
            </div>
            ${this.mode === 'exam' ? `<div class="read-note-bar" id="readNoteBar">
              <button type="button" class="tool" data-note="pen" title="手写笔记">✎</button>
              <button type="button" class="tool" data-note="eraser" title="橡皮擦">⌫</button>
              <button type="button" class="tool" data-note="clear" title="清除笔记">🧹</button>
              <span class="hint" style="margin:0">做题笔记：点 ✎ 后在原文上写画</span>
            </div>` : ''}
            <div class="read-note-host" id="readNoteHost">
              ${this._readingContentHTML(p)}
              ${this.mode === 'exam' ? '<canvas class="read-note-canvas" id="readNoteCanvas"></canvas>' : ''}
            </div>
          </div>
        </div>

        ${!traditionalQuiz && !specialQuiz && !isSectionB && !isCloze ? `<div class="card" style="margin-top:14px">
          <div class="card-h">${isSectionA ? '选词填空作答' : isCloze ? '完形填空作答' : '阅读题目'}（${modeHelp}）</div>
          <div class="card-b">
            ${this._renderQuestions(p)}
            ${this._answerActionsHTML(p)}
          </div>
        </div>` : ''}
      </div>

      ${traditionalQuiz || specialQuiz ? `<div class="read-question-side ${isSectionB ? 'read-match-question-side' : ''}">
        <div class="card ${isSectionB && specialQuiz ? 'read-match-question-card' : traditionalQuiz ? 'read-quiz-question-card' : ''}">
          <div class="card-h">${isSectionA ? '选词填空作答' : isSectionB ? '段落匹配题目与选项' : isCloze ? '完形填空题目与选项' : '阅读理解题目'}（${this.mode === 'exam' ? '做题模式：在题目区作答' : '修改模式：答案与解析'}）</div>
          <div class="card-b">
            ${isSectionA ? this._renderSectionAQuestions(p)
              : isSectionB ? `${this._renderMatchingOptions(p)}${this._renderQuestions(p)}`
                : isCloze ? this._renderClozeIndex(p) : this._renderQuestions(p)}
            ${this._answerActionsHTML(p)}
          </div>
        </div>
      </div>` : showAnalysis ? `<div class="an-panel">
        <div class="card">
          <div class="card-h">划线分析
            <span class="r" style="gap:5px">
              <button class="mini-tab on" data-atab="word">词性翻译</button>
              <button class="mini-tab" data-atab="sent">长难句分析</button>
              <button class="mini-tab" data-atab="ai">AI解析</button>
            </span></div>
          <div class="card-b" id="anBox">${this._anPanel()}</div>
        </div>
      </div>` : ''}
    </div>

    ${this.mode === 'exam' ? `<div class="card" style="margin-top:14px;border-color:var(--warn)">
      <div class="card-b" style="display:flex;align-items:center;gap:12px">
        <span style="font-size:20px">🔒</span>
        <div style="flex:1">
          <b>做题模式限制</b>
          <div class="hint">${isTraditional ? '当前禁止点击单词查看释义，且倒计时结束会自动提交。切到「修改模式」后可查词、划线并查看解析。' : '当前处于做题模式；提交后会显示正确答案与解析，倒计时结束会自动提交。'}</div>
        </div>
        <button class="btn btn-gh btn-s" data-mode="edit">切到修改模式</button>
      </div></div>` : ''}`;

    this._bind(root);
    this._initReadNotes();
    this._startTimer();
  },

  _questions(p) { return Array.isArray(p.questions) ? p.questions : []; },






  _requestEditMode() {
    const questions = this._questions(this.cur);
    const missing = questions.map((q, i) => ({ q, i }))
      .filter(({ i }) => this.answers[i] == null || this.answers[i] === '');
    const enterEdit = () => {
      this.mode = 'edit';
      this._shell($('#view'));
    };
    const modalActions = (body, complete) => {
      body.querySelector('#rdStayExam').onclick = App.closeModal;
      const edit = body.querySelector('#rdEnterEdit');
      if (edit) edit.onclick = () => { App.closeModal(); enterEdit(); };
      const submit = body.querySelector('#rdSubmitEdit');
      if (submit) submit.onclick = async () => {
        App.closeModal();
        if (complete) await this._submitAndRender(false);
        enterEdit();
      };
    };

    if (!questions.length) {
      App.modal('本篇没有可批改题目', `
        <p style="line-height:1.8">本篇未识别到题目，无法判断是否完成或自动批改。可以进入修改模式查看原文。</p>
        <div class="row" style="margin-top:18px;justify-content:flex-end">
          <button class="btn btn-gh" id="rdStayExam">留在做题模式</button>
          <button class="btn btn-pri" id="rdEnterEdit">进入修改模式</button>
        </div>`, body => modalActions(body, false));
      return;
    }

    if (missing.length) {
      const numbers = missing.map(({ q, i }) => this._questionNumber(q, i));
      const numberText = numbers.map(n => `第 ${esc(n)} 题`).join('、');
      App.modal('本篇还没有做完', `
        <p style="line-height:1.8">还有 <b>${missing.length}</b> 题未作答：${numberText}。</p>
        <p class="hint" style="margin-top:8px">可以继续答题补完；若现在进入修改模式，会保留已有答案，但暂不批改。</p>
        <div class="row" style="margin-top:18px;justify-content:flex-end">
          <button class="btn btn-gh" id="rdStayExam">继续答题</button>
          <button class="btn btn-pri" id="rdEnterEdit">仍进入修改模式</button>
        </div>`, body => modalActions(body, false));
      return;
    }

    App.modal('确认完成并批改', `
      <p style="line-height:1.8">本篇 <b>${questions.length}</b> 题均已作答。提交后会立即批改并显示答案与解析，然后进入修改模式。</p>
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn btn-gh" id="rdStayExam">继续检查</button>
        <button class="btn btn-pri" id="rdSubmitEdit">提交并批改</button>
      </div>`, body => modalActions(body, true));
  },

  async _verifyCurrentReading(force = false) {
    const p = this.cur;
    if (!p || this._readType(p) !== 'traditional') return;
    if (!force && p._answerVerification) return;
    if (this._verifyBusy) return;
    this._verifyBusy = true;
    if (AI.ready) App.toast('正在核对答案和原文依据…', '');
    try {
      const review = await AI.verifyReading(p, this._questions(p));
      if (this.cur !== p) return;
      this._questions(p).forEach(q => { q._aiVerified = false; });
      for (const item of review.items || []) {
        const q = p.questions[item.index];
        if (!q) continue;
        q.a = +item.answer;
        q.evidence = item.evidence.trim();
        q.explain = item.explain.trim();
        q._aiVerified = true;
      }
      p._answerVerification = { status: review.status, checkedAt: Date.now(), error: review.error || '' };
    } catch (error) {
      p._answerVerification = { status: 'failed', checkedAt: Date.now(), error: String(error && error.message || error) };
    } finally { this._verifyBusy = false; }
  },

  async _submitAndRender(render = true) {
    if (!this.cur || this.submitted || this._submitBusy) return;
    this._submitBusy = true;
    const p = this.cur;
    try { await this._verifyCurrentReading(); }
    finally { this._submitBusy = false; }
    if (this.cur !== p || this.submitted) return;
    this.submitted = true;
    Store.addStat('read', 1);
    const sc = this._score();
    Store.d.readLog = Store.d.readLog || {};
    Store.d.readLog[this.cur.id] = { at: Date.now(), score: sc, total: this.cur.totalScore,
      answerVerification: p._answerVerification ? p._answerVerification.status : 'not-applicable' };
    Store.flush();
    Store.logActivity({
      kind: 'read', seconds: this._pageSeconds(),
      correct: sc, total: this.cur.totalScore,
    });
    if (render) this._shell($('#view'));
  },

  _sourceParagraphs(p) {
    if (Array.isArray(p && p.paragraphs) && p.paragraphs.length) {
      return p.paragraphs.map(para => typeof para === 'string' ? para : String(para.text || para.content || ''));
    }
    return String(p && (p.clozeText || p.text) || '').replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/).filter(text => text.trim());
  },

  _questionNumber(q, i) {
    const found = String(q.number ?? q.q ?? '').match(/\d{1,3}/);
    return found ? found[0] : String(i + 1);
  },

  _questionPrompt(q, i) {
    const number = this._questionNumber(q, i);
    return String(q && (q.q || q.question || '') || '')
      .replace(new RegExp(`^\\s*${number}[.)、]\\s*`), '');
  },

  _wordBank(p) {
    return (Array.isArray(p.wordBank) ? p.wordBank : []).map((item, i) => {
      if (typeof item === 'string') {
        const m = item.match(/^\s*([A-O])\s*[).、:]?\s*(.*)$/i);
        return { letter: m ? m[1].toUpperCase() : String.fromCharCode(65 + i), word: m ? m[2] : item };
      }
      return { letter: String(item.letter || item.label || String.fromCharCode(65 + i)).toUpperCase(),
        word: String(item.word || item.text || item.value || '') };
    }).filter(x => x.letter && x.word);
  },

  _answerOptions(p) {
    if (this._readType(p) === 'section-a') {
      // 词库已在原文上方完整展示，内联下拉只显示选项字母，避免长词挤乱句子。
      return this._wordBank(p).map(x => ({ value: x.letter, label: x.letter }));
    }
    const paragraphs = Array.isArray(p.paragraphs) ? p.paragraphs : [];
    return paragraphs.map((para, i) => {
      const label = typeof para === 'object' ? (para.label || para.letter || String.fromCharCode(65 + i))
        : ((String(para).match(/^\s*([A-I])\s*[).、]/i) || [])[1] || String.fromCharCode(65 + i));
      return { value: String(label).toUpperCase(), label: String(label).toUpperCase() };
    });
  },

  _answerValue(value) {
    if (value == null) return '';
    if (typeof value === 'number') {
      if (this._readType(this.cur) === 'section-a') return (this._wordBank(this.cur)[value] || {}).letter || '';
      if (this._readType(this.cur) === 'section-b') return (this._answerOptions(this.cur)[value] || {}).value || '';
      return String(value);
    }
    const text = String(value).trim().replace(/[).、]$/, '');
    if (this._readType(this.cur) === 'section-a' && !/^[A-O]$/i.test(text)) {
      const word = this._wordBank(this.cur).find(x => x.word.toLowerCase() === text.toLowerCase());
      if (word) return word.letter;
    }
    return text.toUpperCase();
  },

  _clozeAnswerIndex(q) {
    const value = q && q.a;
    if (Number.isInteger(value)) return value;
    const text = String(value == null ? '' : value).trim();
    if (/^[A-D]$/i.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
    if (/^[0-3]$/.test(text)) return +text;
    return (q && Array.isArray(q.opts)) ? q.opts.findIndex(option =>
      String(option).trim().toLowerCase() === text.toLowerCase()) : -1;
  },

  _renderAnswerSelect(index, options) {
    const q = this._questions(this.cur)[index] || {};
    const selected = this.answers[index] == null ? '' : this._answerValue(this.answers[index]);
    const answer = this._answerValue(q.a);
    const good = this.submitted && answer && selected === answer;
    const bad = this.submitted && selected && answer && selected !== answer;
    const used = new Set(this._readType(this.cur) === 'section-a'
      ? Object.entries(this.answers).filter(([i, v]) => +i !== index && v != null).map(([, v]) => this._answerValue(v))
      : []);
    const isCloze = this._readType(this.cur) === 'section-a';
    const selectedWord = isCloze ? (this._wordBank(this.cur).find(x => x.letter === selected) || {}).word || '' : '';
    return `<span class="read-answer-wrap ${isCloze ? 'section-a' : ''} ${selectedWord ? 'is-selected' : ''} ${good ? 'right' : ''} ${bad ? 'wrong' : ''}">
      <select class="read-answer-select ${isCloze ? 'section-a' : ''} ${good ? 'right' : ''} ${bad ? 'wrong' : ''}" data-special-answer="${index}"
        aria-label="第 ${esc(this._questionNumber(q, index))} 题答案${selectedWord ? `，已选 ${selected} ${esc(selectedWord)}，点击更换` : ''}"
        title="${isCloze ? (selectedWord ? '点击更换选词' : '请选择词汇') : '请选择对应段落'}" ${this.submitted ? 'disabled' : ''}>
        <option value="">${isCloze ? '选词' : '段落'}</option>
        ${options.map(o => `<option value="${esc(o.value)}" ${selected === o.value ? 'selected' : ''}
          ${used.has(o.value) && selected !== o.value ? 'disabled' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      ${isCloze && selectedWord ? `<span class="read-answer-word" title="点击更换选词"><b>${esc(selected)}</b><em>${esc(selectedWord)}</em></span>` : ''}
      ${this.submitted && answer && !isCloze ? `<small>${selected === answer ? '✓ 正确' : `答案：${esc(answer)}`}</small>` : ''}
    </span>`;
  },

  _syncSectionAChoiceUI(root, index) {
    const select = $(`[data-special-answer="${index}"]`, root);
    const wrap = select && select.closest('.read-answer-wrap');
    if (!select || !wrap) return;
    const selected = this._answerValue(select.value);
    const item = this._wordBank(this.cur).find(x => x.letter === selected);
    let chip = wrap.querySelector('.read-answer-word');
    if (!item) {
      wrap.classList.remove('is-selected');
      if (chip) chip.remove();
      select.setAttribute('aria-label', `第 ${this._questionNumber(this._questions(this.cur)[index] || {}, index)} 题答案`);
      select.title = '请选择词汇';
      const sentence = select.closest('[data-senttemplate]');
      if (sentence) sentence.dataset.senttext = this._clozeSentenceText(sentence.dataset.senttemplate, this.cur);
      return;
    }
    wrap.classList.add('is-selected');
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'read-answer-word';
      wrap.appendChild(chip);
    }
    chip.title = '点击更换选词';
    chip.innerHTML = `<b>${esc(item.letter)}</b><em>${esc(item.word)}</em>`;
    const q = this._questions(this.cur)[index] || {};
    select.setAttribute('aria-label', `第 ${this._questionNumber(q, index)} 题答案，已选 ${item.letter} ${item.word}，点击更换`);
    select.title = '点击更换选词';
    const sentence = select.closest('[data-senttemplate]');
    if (sentence) sentence.dataset.senttext = this._clozeSentenceText(sentence.dataset.senttemplate, this.cur);
  },

  _answerActionsHTML(p) {
    const verification = this._readType(p) === 'traditional' && this.submitted ? p._answerVerification : null;
    const verificationText = verification ? ({ verified: 'AI 已核验全部答案与原文依据', partial: '部分题目未通过原文核验',
      unavailable: '未配置 AI，答案尚未核验', failed: 'AI 核验失败，答案尚未核验' })[verification.status] || '答案尚未核验' : '';
    return `<div class="row" style="margin-top:14px">
      <button class="btn btn-gh" data-act="resetRead">重做</button>
      ${this.submitted
        ? `<button class="btn btn-gh" data-act="showAns">显示全部答案</button>`
        : `<button class="btn btn-pri" data-act="submitRead">✓ 提交并查看解析</button>`}
      ${verification && verification.status !== 'verified' ? '<button class="btn btn-gh" data-act="verifyAnswers">AI 重新核验</button>' : ''}
      <span class="sp"></span>
      ${this.submitted
        ? `<b style="color:var(--pri);font-size:15px">得分 ${this._score()} / ${p.totalScore}</b>`
        : `<span class="ans-count" id="ansCount">${this._answered()} / ${this._questions(p).length} 题</span>`}
      ${verification ? `<small class="read-verification ${verification.status === 'verified' ? 'verified' : 'pending'}">${esc(verificationText)}</small>` : ''}
    </div>`;
  },

  _renderCloze(p, inlineAnswers) {
    if (inlineAnswers == null) inlineAnswers = this.mode === 'edit';
    const raw = String(p.clozeText || p.text || this._sourceParagraphs(p).join('\n\n')).replace(/\r\n?/g, '\n');
    const questions = this._questions(p);
    const options = this._answerOptions(p);
    const blankRe = /_{2,}\s*(\d{1,3})\s*_{2,}|\[(\d{1,3})\]|\{\{(\d{1,3})\}\}/g;
    const placed = new Set();
    const paragraphs = raw.split(/\n\s*\n/).filter(text => text.trim());
    const rendered = paragraphs.map((paragraph, pi) => {
      const paragraphQuestions = new Set();
      const sentenceList = paragraph.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || [paragraph];
      const sentenceHtml = sentenceList.map((sentence, si) => {
        let html = '', last = 0, match;
        blankRe.lastIndex = 0;
        while ((match = blankRe.exec(sentence))) {
          html += this._wording(sentence.slice(last, match.index));
          const number = match[1] || match[2] || match[3];
          const qi = questions.findIndex((q, i) => this._questionNumber(q, i) === number);
          if (qi < 0) html += esc(match[0]);
          else {
            html += inlineAnswers ? this._renderAnswerSelect(qi, options)
              : `<span class="read-blank-marker">${esc(number)}</span>`;
            placed.add(qi);
            paragraphQuestions.add(qi);
          }
          last = match.index + match[0].length;
        }
        html += this._wording(sentence.slice(last));
        const plainSentence = this._clozeSentenceText(sentence, p);
        const key = `a_${pi}_${si}`;
        const marked = this.marks[key];
        const hl = marked ? (marked.type === 'sent' ? 'hl-u' : 'hl-' + marked.type) : '';
        return `<span class="sent ${hl}" data-sent="${key}" data-senttemplate="${esc(sentence.trim())}"
          data-senttext="${esc(plainSentence)}">${html}</span> `;
      }).join('');
      const explanations = this.submitted
        ? [...paragraphQuestions].map(i => this._clozeExplanationHTML(i)).join('') : '';
      return `<div class="para-wrap section-a-para"><p>${sentenceHtml}</p>
        ${this._paraTransHTML(p, paragraph, pi)}${explanations}</div>`;
    }).join('');
    const missing = inlineAnswers ? questions.map((q, i) => i).filter(i => !placed.has(i)) : [];
    const missingHtml = missing.length ? `<div class="read-blank-list">${missing.map(i => `<label class="read-blank-item">
      <b>${esc(this._questionNumber(questions[i], i))}</b>${this._renderAnswerSelect(i, options)}</label>`).join('')}</div>
      ${this.submitted ? missing.map(i => this._clozeExplanationHTML(i)).join('') : ''}` : '';
    return `<div class="passage ${this.mode === 'exam' ? 'locked' : 'edit'} cloze-passage" id="passage">${rendered}${missingHtml}</div>`;
  },

  _renderWordBank(p, centered = false) {
    const bank = this._wordBank(p);
    return `<div class="read-word-bank ${centered ? 'read-section-a-bank' : ''}"><b>词库</b>${bank.map(x => `<span><strong>${esc(x.letter)}</strong><em>${esc(x.word)}</em></span>`).join('')}</div>`;
  },

  _renderSectionAQuestions(p) {
    const options = this._answerOptions(p);
    const questions = this._questions(p);
    return `<div class="read-special-questions section-a-answers">
      ${questions.map((q, i) => `<div class="read-special-question">
        <b>${esc(this._questionNumber(q, i))}.</b><span>选择此空对应的词</span>${this._renderAnswerSelect(i, options)}
      </div>`).join('')}
    </div>`;
  },

  _renderClozeIndex(p) {
    return `<div class="read-cloze-index"><p>在左侧原文的空位直接选择 A—D。</p>
      <div>${this._questions(p).map((q, i) => {
        const picked = this.answers[i] == null ? '' : +this.answers[i];
        return `<button class="read-cloze-jump" type="button" data-cloze-jump="${i}">
          <b>${esc(this._questionNumber(q, i))}</b><span>${Number.isInteger(picked) && picked >= 0 && picked < 4 ? 'ABCD'[picked] : '未选'}</span></button>`;
      }).join('')}</div></div>`;
  },

  _renderClozeInline(p) {
    const questions = this._questions(p);
    const blankRe = /\((\d{1,3})\)\s*_{2,}|_{2,}\s*(\d{1,3})\s*_{2,}|\[(\d{1,3})\]|\{\{(\d{1,3})\}\}/g;
    const seen = new Set();
    const paragraphs = this._sourceParagraphs(p);
    const html = paragraphs.map((para, pi) => {
      let body = '', last = 0, match;
      blankRe.lastIndex = 0;
      const related = [];
      while ((match = blankRe.exec(para))) {
        body += this._wording(para.slice(last, match.index));
        const num = match[1] || match[2] || match[3] || match[4];
        const qi = questions.findIndex((q, i) => this._questionNumber(q, i) === num);
        if (qi < 0) body += esc(match[0]);
        else {
          seen.add(qi); related.push(qi);
          body += this._clozeInlineSelect(qi);
        }
        last = match.index + match[0].length;
      }
      body += this._wording(para.slice(last));
      return `<div class="para-wrap read-cloze-paragraph"><p><span class="sent" data-sent="cloze_${pi}" data-senttext="${esc(para)}">${body}</span></p>${this._paraTransHTML(p, para, pi)}
        ${this.submitted ? related.map(i => this._clozeQuestionReview(i)).join('') : ''}</div>`;
    }).join('');
    const missing = questions.map((q, i) => i).filter(i => !seen.has(i));
    return `<div class="passage ${this.mode === 'exam' ? 'locked' : 'edit'} read-cloze-text" id="passage">${html}
      ${missing.length ? `<div class="read-cloze-unplaced"><b>原文中未找到的空位</b>${missing.map(i =>
        `<span>${esc(this._questionNumber(questions[i], i))}. ${this._clozeInlineSelect(i)}</span>`).join('')}</div>` : ''}
    </div>`;
  },

  _clozeInlineSelect(index) {
    const q = this._questions(this.cur)[index] || {};
    const picked = this.answers[index] == null ? '' : String(this.answers[index]);
    const correct = String(this._clozeAnswerIndex(q));
    return `<select class="read-cloze-select ${this.submitted ? (picked === correct ? 'right' : 'wrong') : ''}"
      data-special-answer="${index}" aria-label="第 ${esc(this._questionNumber(q, index))} 空选择答案"
      ${this.submitted ? 'disabled' : ''}><option value="">${esc(this._questionNumber(q, index))} 选词</option>
      ${(q.opts || []).map((opt, k) => `<option value="${k}" ${picked === String(k) ? 'selected' : ''}>${'ABCD'[k]}. ${esc(opt)}</option>`).join('')}
    </select>`;
  },

  _clozeQuestionReview(index) {
    const q = this._questions(this.cur)[index] || {};
    const picked = this.answers[index] == null ? null : +this.answers[index];
    const correct = this._clozeAnswerIndex(q);
    return `<div class="section-a-explain ${picked === correct ? 'right' : 'wrong'}">
      <b>${esc(this._questionNumber(q, index))} 题</b>　你的答案：${picked == null ? '未作答' : esc('ABCD'[picked] || '')}　正确答案：${esc('ABCD'[correct] || '待核验')}
      ${q.explain ? `<p>${esc(q.explain)}</p>` : ''}${q.evidence ? `<small>原文依据：${esc(q.evidence)}</small>` : ''}
    </div>`;
  },

  _renderMatchingOptions(p) {
    const options = this._answerOptions(p);
    return `<div class="read-matching-options"><b>段落选项</b>
      ${options.map(option => `<span><strong>${esc(option.label)}</strong></span>`).join('')}
      <small>每题选择对应段落；标准答案可能重复使用同一段。</small>
    </div>`;
  },

  _clozeSentenceText(sentence, p) {
    const questions = this._questions(p);
    return String(sentence || '').replace(/_{2,}\s*(\d{1,3})\s*_{2,}|\[(\d{1,3})\]|\{\{(\d{1,3})\}\}/g,
      (full, a, b, c) => {
        const number = a || b || c;
        const qi = questions.findIndex((q, i) => this._questionNumber(q, i) === number);
        const chosen = qi >= 0 ? this._wordBank(p).find(x => x.letter === this._answerValue(this.answers[qi])) : null;
        return chosen ? chosen.word : `[${number}]`;
      }).replace(/\s+/g, ' ').trim();
  },

  _clozeExplanationHTML(index) {
    const q = this._questions(this.cur)[index] || {};
    const selected = this._answerValue(this.answers[index]);
    const correct = this._answerValue(q.a);
    const chosenWord = this._wordBank(this.cur).find(x => x.letter === selected);
    const correctWord = this._wordBank(this.cur).find(x => x.letter === correct);
    const isRight = !!correct && selected === correct;
    const yourAnswer = chosenWord ? `${chosenWord.letter}) ${chosenWord.word}` : '未作答';
    const rightAnswer = correctWord ? `${correctWord.letter}) ${correctWord.word}` : correct;
    return `<div class="section-a-explain ${isRight ? 'right' : 'wrong'}">
      <div class="section-a-explain-head"><b>${esc(this._questionNumber(q, index))} 题</b><span>${isRight ? '✓ 正确' : '正确答案'}</span></div>
      ${!isRight ? `<div class="section-a-explain-answer">你的答案：${esc(yourAnswer)}</div>` : ''}
      <div class="section-a-explain-answer">正确答案：<strong>${esc(rightAnswer)}</strong></div>
      ${q.explain ? `<p>${esc(q.explain)}</p>` : ''}
      ${q.evidence ? `<small>原文依据：${esc(q.evidence)}</small>` : ''}
    </div>`;
  },

  _readingContentHTML(p) {
    const type = this._readType(p);
    if (type === 'cloze') {
      return `<div class="read-directions">阅读短文，根据上下文和选项，为每个编号空选择最合适的词。</div>
        ${this._renderClozeInline(p)}
        ${this.mode === 'edit' ? this._answerActionsHTML(p) : ''}`;
    }
    if (type === 'section-a') {
      return `<div class="read-directions">每个空选择一个词；每个词最多使用一次。${this.mode === 'exam' ? '在题目区作答。' : '点击原文中的答案可更换。'}</div>
        ${this._renderCloze(p, this.mode === 'edit')}
        `;
    }
    if (type === 'section-b') {
      return `<div class="read-directions">阅读段落后，为每条陈述选择对应段落；同一段可对应多条陈述。</div>
        ${this._renderMatchingParagraphs(p)}
        ${this.mode === 'edit' ? this._answerActionsHTML(p) : ''}`;
    }
    return `<div class="passage ${this.mode === 'exam' ? 'locked' : 'edit'}" id="passage">
      ${(p.paragraphs || []).map((para, pi) => `<div class="para-wrap">
        <p style="margin-bottom:6px">${this._renderPara(para, pi)}</p>
        ${this._paraTransHTML(p, para, pi)}
      </div>`).join('')}
    </div>`;
  },

  _renderMatchingParagraphs(p) {
    const paragraphs = Array.isArray(p.paragraphs) ? p.paragraphs : [];
    return `<div class="passage ${this.mode === 'exam' ? 'locked' : 'edit'} read-matching-paragraphs" id="passage">
      ${paragraphs.map((para, i) => {
        const label = typeof para === 'object' ? (para.label || para.letter || String.fromCharCode(65 + i))
          : ((String(para).match(/^\s*([A-I])\s*[).、]\s*/i) || [])[1] || String.fromCharCode(65 + i));
        const text = this._sourceParagraphs({ paragraphs: [para] })[0] || '';
        const displayText = typeof para === 'string' ? text.replace(/^\s*[A-I]\s*[).、]\s*/i, '') : text;
        const related = this.mode === 'edit' ? this._questions(p).map((q, qi) => ({ q, qi }))
          .filter(({ q, qi }) => this._answerValue(this.submitted ? q.a : this.answers[qi]) === String(label).toUpperCase()) : [];
        return `<div class="read-match-paragraph"><b>${esc(label)}</b><div>
          <p>${this._renderPara(displayText, i)}</p>${this._paraTransHTML(p, displayText, i)}
          ${related.map(({ q, qi }) => this._matchingReviewCard(q, qi)).join('')}
        </div></div>`;
      }).join('')}
      ${this.mode === 'edit' ? (() => {
        const labels = new Set(this._answerOptions(p).map(option => option.value));
        const unassigned = this._questions(p).map((q, qi) => ({ q, qi })).filter(({ q, qi }) =>
          !labels.has(this._answerValue(this.submitted ? q.a : this.answers[qi])));
        return unassigned.length ? `<div class="read-match-unassigned"><b>未归入段落的句子</b>${unassigned.map(({ q, qi }) =>
          this._matchingReviewCard(q, qi)).join('')}</div>` : '';
      })() : ''}
    </div>`;
  },

  _matchingReviewCard(q, index) {
    const chosen = this._answerValue(this.answers[index]);
    const correct = this._answerValue(q.a);
    return `<div class="read-match-review">
      <div><b>${esc(this._questionNumber(q, index))}.</b> ${esc(q.statement || q.q || q.text || '')}</div>
      <small>你的答案：${esc(chosen || '未作答')}${this.submitted ? `　·　正确段落：${esc(correct || '待核验')}${chosen === correct ? '　✓' : ''}` : ''}</small>
      ${!this.submitted ? this._renderAnswerSelect(index, this._answerOptions(this.cur)) : ''}
      ${this.submitted && q.explain ? `<div class="tipbox"><b>解析</b>　${esc(q.explain)}${q.evidence ? `<br>原文依据：${esc(q.evidence)}` : ''}</div>` : ''}
    </div>`;
  },

  _renderQuestions(p) {
    const type = this._readType(p), questions = this._questions(p);
    if (type === 'section-a') {
      return `<div class="read-special-questions section-a-note">
        <p>本篇共 ${questions.length} 个空。提交后，每个空的解析会显示在对应段落下方。</p>
      </div>`;
    }
    if (type === 'section-b') {
      const options = this._answerOptions(p);
      return `<div class="read-special-questions ${type}">
        ${questions.map((q, i) => `<div class="read-special-question">
          <b>${esc(this._questionNumber(q, i))}.</b>
          <span>${esc(q.statement || q.q || q.text || '')}</span>
          ${type === 'section-b' ? this._renderAnswerSelect(i, options) : ''}
          ${this.submitted && q.explain ? `<div class="tipbox"><b>解析</b>　${esc(q.explain)}${q.evidence ? `<br><span style="color:var(--tx3)">原文依据：${esc(q.evidence)}</span>` : ''}</div>` : ''}
        </div>`).join('')}
      </div>`;
    }
    return `<div class="two-col" id="qWrap">
      ${questions.map((q, i) => `
        <div class="q-item">
          <div class="qt">${esc(this._questionNumber(q, i))}. ${this._wording(this._questionPrompt(q, i))}</div>
          ${(q.opts || []).map((o, k) => `<div class="q-opt ${this.submitted ? (k === q.a ? 'right' : (this.answers[i] === k ? 'wrong' : '')) : (this.answers[i] === k ? 'sel' : '')}"
            data-q="${i}" data-o="${k}"><span class="k">${'ABCD'[k]}</span><span>${this._wording(o)}</span></div>`).join('')}
          ${this.submitted ? `<div class="tipbox"><b>解析${type === 'traditional' ? (q._aiVerified ? ' · AI 已核验' : ' · 待核验') : ''}</b>　${esc(q.explain || '')}<br>
            <span style="color:var(--tx3)">原文依据：${esc(q.evidence || '')}</span></div>` : ''}
        </div>`).join('')}
    </div>`;
  },

  /* ---------- 段落渲染 ----------
   * 注意：必须先把段落切成 token（单词 / 标点 / 空白），
   * 再分别转义。若先esc() 成HTML 再切词，会把 "<span" 当成单词，划词功能直接失效。
   * 每个句子额外挂 data-sent，供「点句取句」用。
   */
  /**
   * 段落翻译的折叠块（修改模式可见）
   * 默认收起；点按钮展开 → 调 AI 翻译该段 → 结果缓存，
   * 再次点收起，展开时直接读缓存不重复请求。
   */
  _paraTransHTML(p, para, pi) {
    if (this.mode === 'exam') return '';
    const cache = (this._paraCn = this._paraCn || {});
    const openSet = (this._paraOpen = this._paraOpen || new Set());
    const key = `${p.id}_${pi}`;
    const open = openSet.has(key);
    const cn = cache[key];
    return `<div class="para-tr">
      <button class="btn btn-xs btn-gh para-tr-btn" data-act="togglePara" data-pi="${pi}"
        title="${open ? '收起本段翻译' : '展开本段中文翻译'}">
        ${open ? '收起翻译 ▴' : '📘 本段翻译 ▾'}
      </button>
      <div class="para-tr-cn" ${open ? '' : 'hidden'}>${cn ? esc(cn) : ''}</div>
    </div>`;
  },

  /** 展开 / 收起某段翻译；首次展开调 AI 翻译 */
  async _togglePara(pi) {
    const p = this.cur;
    if (!p) return;
    const para = this._sourceParagraphs(p)[pi];
    if (!para) return;
    this._paraOpen = this._paraOpen || new Set();
    this._paraCn = this._paraCn || {};
    const key = `${p.id}_${pi}`;

    // 已展开 → 收起。翻译中也允许收起，否则用户点不动。
    if (this._paraOpen.has(key)) {
      this._paraOpen.delete(key);
      this._reRenderPassage();
      return;
    }
    // 本段正在翻译 → 忽略重复点击（展开其他段不受影响）
    if (this._paraBusy === key) {
      App.toast('本段正在翻译，请稍候…', '');
      return;
    }
    // 已有翻译 → 直接展开，不重复请求
    if (this._paraCn[key] && !/^（(?:翻译失败|未启用 AI)/.test(this._paraCn[key])) {
      this._paraOpen.add(key);
      this._reRenderPassage();
      return;
    }
    // 首次展开：显示占位，边翻译边更新
    this._paraBusy = key;
    this._paraOpen.add(key);
    this._paraCn[key] = '（翻译中…）';
    this._reRenderPassage();
    try {
      const cn = await AI.translate(para);
      if (!cn || /^（(?:翻译失败|未启用 AI)/.test(cn)) {
        delete this._paraCn[key];
        if (this.cur === p) {
          this._paraOpen.delete(key);
          this._reRenderPassage();
          App.toast(cn || '翻译失败，请重试。', 'warn');
        }
        return;
      }
      // 若翻译期间用户已收起，就不再把面板弹开
      if (this.cur === p && this._paraOpen.has(key)) {
        this._paraCn[key] = cn || '（翻译失败，可在设置页启用 AI 后重试）';
        this._reRenderPassage();
      } else if (this.cur === p) {
        this._paraCn[key] = cn || '（翻译失败，可在设置页启用 AI 后重试）';
      }
    } finally {
      if (this._paraBusy === key) this._paraBusy = null;
    }
  },

  _renderPara(text, pi) {
    const sents = text.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || [text];
    return sents.map((s, si) => {
      const key = `${pi}_${si}`;
      const marked = this.marks[key];
      const hl = marked ? (marked.type === 'sent' ? 'hl-u' : 'hl-' + marked.type) : '';
      const tokens = s.split(/([A-Za-z][A-Za-z'’-]*)/);
      const inner = tokens.map(tok => {
        if (!tok) return '';
        if (!/^[A-Za-z]/.test(tok)) return esc(tok);
        const lower = tok.toLowerCase();
        const m = this.marks['w_' + lower];
        if (this.mode !== 'edit') return esc(tok);
        return m
          ? `<span class="hl hl-${m}" data-w="${esc(lower)}" data-wraw="${esc(tok)}">${esc(tok)}</span>`
          : `<span data-w="${esc(lower)}" data-wraw="${esc(tok)}">${esc(tok)}</span>`;
      }).join('');
      return `<span class="sent ${hl}" data-sent="${key}" data-senttext="${esc(s.trim())}">${inner}</span> `;
    }).join('');
  },

  /** 把一段文本拆成可划线的单词 span。
 *  用于「题目题干」与「选项」——它们也要能用划线工具做词性翻译/长难句分析。
 *  仅「修改模式」下可划；做题模式保持纯文本，避免误触影响作答。
 */
  _wording(s) {
    const text = String(s || '');
    if (this.mode !== 'edit') return esc(text);
    const tokens = text.split(/([A-Za-z][A-Za-z'’-]*)/);
    return tokens.map(tok => {
      if (!tok) return '';
      if (!/^[A-Za-z]/.test(tok)) return esc(tok);
      const lower = tok.toLowerCase();
      const m = this.marks['w_' + lower];
      return m
        ? `<span class="hl hl-${m}" data-w="${esc(lower)}" data-wraw="${esc(tok)}">${esc(tok)}</span>`
        : `<span data-w="${esc(lower)}" data-wraw="${esc(tok)}">${esc(tok)}</span>`;
    }).join('');
  },

  /* ---------- 分析面板 ---------- */
  _anPanel() {
    const sel = this.selected;
    if (!sel) {
      /* 未选中内容时，按当前 tab 给出对应的操作引导，
       * 否则用户点了「长难句分析」却只看到一个空面板，会以为按钮坏了。*/
      const hint = (this.anTab === 'sent')
        ? '在左侧文章中<mark style="background:var(--warn-l)">拖选划出</mark>一句（4 词以上），这里会显示句子结构分析。'
        : (this.anTab === 'ai')
          ? '先在上方选择单词或句子，再点「AI 深度解析」查看词根、搭配与常见用法。'
          : '在左侧文章中<mark style="background:var(--warn-l)">点击</mark>一个单词，这里会显示词性翻译。';
      return `<div class="empty"><p>${this.mode === 'edit' ? hint
        : '切到「修改模式」后即可划线、查词并分析长难句。'}</p></div>`;
    }
    /* tab 完全由用户点击决定（_setTab），这里**不做任何强制对齐**。
     * 原来按 selected.type 强制改 tab，会把用户刚点的「长难句分析」
     * 立刻顶回「词性翻译」——表现为"点了没反应"。
     * 选中时的对齐已移到 _onSelect() 里做（只在那一次切换）。*/
    const a = this.anTab || (sel.type === 'sent' ? 'sent' : 'word');

    /* AI 内联块：点「AI 深度解析」后，结果插到当前 tab 内容顶部。
     * 支持折叠：默认展开显示结论，折叠后只留一行标题（词/句的本地释义），
     * 点击可再次展开。选择新词/新句时自动复位为折叠态。
     */
    const aiBlock = (this.aiInline && this.aiData && a !== 'ai')
      ? `<div class="ai-inline ${this.aiFolded ? 'folded' : ''}">
          ${this.aiFolded
        ? `<div class="ai-fold-bar" data-act="aiUnfold">
                 <span class="aif-t">AI 深度解析</span>
                 <span class="aif-s">${esc((this.aiHeadline || '').slice(0, 40))}${((this.aiHeadline || '').length > 40) ? '…' : ''}</span>
                 <span class="aif-c">点击展开 ▾</span>
               </div>`
        : `<div class="ai-in-card">${this._aiInlineHTML(this.aiData)}</div>
               <div class="ai-fold-bar" data-act="aiFold"><span class="aif-c">收起 ▴</span></div>`}
        </div>` : '';

    /* 历史折叠条：只显示更早选过的词/句（词性 + 释义），
     * 当前项由下方主内容完整展示，避免面板越堆越长。*/
    const histBlock = this._histHTML();

    if (a === 'word') {
      const info = this._wordInfo(sel.text);
      if (!info.book && !info.global) return histBlock + aiBlock + `<div class="tipbox">本地词库未收录 <b>${esc(sel.text)}</b>。点击「AI解析」获取在线释义。</div>`;
      const inBk = info.book;
      const defs = info.parts.length
        ? info.parts.map(x => `<div class="pos-line"><span class="t">${esc(this._posLabel(x) || '词义')}</span><span>${esc(x.meaning)}</span></div>`).join('')
        : `<div>${esc(info.meaning)}</div>`;
      return histBlock + aiBlock + `<div class="an-word">${esc(sel.text)}</div>
        ${sel.text ? `<button class="btn btn-xs btn-gh an-say" data-say="${esc(sel.text)}"
          title="朗读当前划线词"><svg viewBox="0 0 24 24" class="ic ic-sm">
          <path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7"/></svg>读</button>` : ''}
        <div style="font-size:13.5px;margin:8px 0 4px;line-height:1.7">${defs}</div>
        ${inBk && inBk.phr && inBk.phr.length ? `<div class="sec-t">固定搭配</div>
          <div>${inBk.phr.map(p => `<span class="chip" data-say="${esc(p.p)}">${esc(p.p)}</span>`).join('')}</div>` : ''}
        ${inBk && inBk.ex && inBk.ex.length ? `<div class="sec-t">例句</div>
          ${inBk.ex.map(e => `<div class="ex-item">${esc(e.en)}<div class="cn">${esc(e.cn)}</div></div>`).join('')}` : ''}
        <div class="row" style="margin-top:12px;gap:6px">
          <button class="btn btn-xs btn-gh" data-say="${esc(sel.text)}">🔊 发音</button>
          <button class="btn btn-xs btn-pri" data-act="nbAddWord">+ 生词本</button>
          <button class="btn btn-xs btn-gh" data-act="nbAddTomorrow">加入明日待背</button>
        </div>
        <button class="btn btn-xs btn-gh btn-blk" data-act="aiLookup" style="margin-top:8px">✨ AI 深度解析（搭配/词根/近反义）</button>`;
    }
    if (a === 'sent') {
      const d = this.sentAn;
      return histBlock + aiBlock + `<div class="an-word" style="font-size:17px;line-height:1.6">${esc(sel.text)}</div>
        ${d ? `<div style="font-size:13.5px;margin-top:10px">
          <div class="sec-t">句型结构</div>
          <div style="background:var(--pri-l);padding:9px 12px;border-radius:10px;font-weight:600">${esc(d.pattern)}</div>
          <div style="margin-top:6px;line-height:1.75">${esc(d.structure)}</div>
          <div class="sec-t">句子成分</div>
          ${(d.components || []).map(c => `<div class="pos-line"><span class="t">${esc(c.role)}</span><span>${esc(c.text)}</span></div>`).join('')}
          ${d.points && d.points.length ? `<div class="sec-t">语法要点</div>
            ${d.points.map(p => `<div style="font-size:13px;margin-bottom:5px">· ${esc(p)}</div>`).join('')}` : ''}
          <div class="sec-t">参考翻译</div>
          <div style="font-size:13.5px;line-height:1.75">${esc(d.cn || '（AI 未返回翻译）')}</div>
          <div class="ai-source-note">来源核验：${d.degraded ? '当前为本地规则或未完成的 AI 结果，未做外部语法资源核验。' : '分析由 AI 根据所选原句生成，当前未连接外部语法资源进行独立核验。'}</div>
          ${d.degraded || d.errMsg ? `<div class="ai-warn" style="margin-top:10px">
            <b>${AI.ready ? 'AI 分析失败或返回不完整' : '当前未配置 AI'}</b>
            <div class="ai-warn-msg">${esc(d.errMsg || (AI.ready ? 'AI 返回内容不完整。' : '请在设置页填写 Base URL、API Key 和模型名称。'))}</div>
            <button class="btn btn-xs btn-gh" data-act="anSent" style="margin-top:6px">重新分析</button>
          </div>` : ''}
          ${d.easy ? `<div class="tipbox" style="margin-top:10px"><b>为什么这么长</b><br>${esc(d.easy)}</div>` : ''}
        </div>` : `<button class="btn btn-pri btn-blk" data-act="anSent">开始分析长难句</button>
          <div class="hint" style="margin-top:8px">分析将给出句型、主谓宾结构、语法要点与整句翻译。${AI.ready ? '' : '（未启用 AI，将使用本地规则，精度有限）'}</div>`}`;
    }
    // AI
    const d = this.aiData;
    return d ? aiDetailHTML(d)
      : `<div class="hint" style="margin-bottom:10px">对选中的「${esc(sel.text)}」调用 AI 获取：词性释义、固定搭配、词根词缀、近反义词与常见用法。</div>
         <button class="btn btn-pri btn-blk" data-act="aiRun">✨ AI 解析</button>
         ${AI.ready ? '' : '<div class="tipbox" style="margin-top:10px">当前未启用 AI，将使用本地词典基础释义。可在设置页填入 API Key。</div>'}`;
  },

  /* ---------- 事件 ---------- */
  _bind(root) {
    Speech.stop();
    clearInterval(this.timer);

    on(root, 'click', '[data-read-type]', (e, t) => {
      if (this.readType === t.dataset.readType) return;
      this.sel = { ...(this.sel || {}), no: 'all' };
      this.readType = t.dataset.readType;
      this.pi = 0; this.timeLimit = null;
      this.answers = {}; this.submitted = false; this.marks = {}; this.selected = null; this.hist = [];
      this.rState = 'idle';
      this._paraCn = {}; this._paraOpen = new Set();
      this._shell($('#view'));
    });

    // 年份 / 场次 / 篇章筛选
    Picker.bind(root, this.allPass, this.sel || {}, s => {
      this.sel = s; this.pi = 0;
      this.answers = {}; this.submitted = false; this.marks = {}; this.selected = null; this.hist = [];
      this._paraCn = {}; this._paraOpen = new Set();   // 切篇清空段落翻译
      this._shell($('#view'));
    }, { partItems: this._pickerParts(this.allPass), partById: true });

    on(root, 'click', '[data-mode]', (e, t) => {
      const nextMode = t.dataset.mode;
      if (nextMode === this.mode) return;
      if (nextMode === 'edit' && this.mode === 'exam' && !this.submitted) {
        this._requestEditMode();
        return;
      }
      this.mode = nextMode; this._shell($('#view'));
    });
    on(root, 'change', '[data-special-answer]', (e, t) => {
      if (this.submitted) return;
      const qi = +t.dataset.specialAnswer;
      if (this._readType(this.cur) === 'section-a' && t.value &&
        Object.entries(this.answers).some(([i, value]) => +i !== qi && this._answerValue(value) === t.value)) {
        t.value = this._answerValue(this.answers[qi]);
        App.toast('该选项已用于另一题，请先更改那道题的答案。', 'warn');
        return;
      }
      if (t.value) this.answers[qi] = t.value;
      else delete this.answers[qi];
      this._syncSpecialSelects(root);
      if (this._readType(this.cur) === 'section-a') this._syncSectionAChoiceUI(root, qi);
      if (this._readType(this.cur) === 'section-b' && this.mode === 'edit') this._reRenderPassage();
      if (this._readType(this.cur) === 'cloze') {
        const status = $(`[data-cloze-jump="${qi}"] span`, root);
        if (status) status.textContent = t.value ? ('ABCD'[+t.value] || '已选') : '未选';
      }
      this._updateAnswerCount();
    });
    on(root, 'click', '[data-cloze-jump]', (e, t) => {
      const select = $(`[data-special-answer="${t.dataset.clozeJump}"]`, root);
      if (select) { select.scrollIntoView({ behavior: 'smooth', block: 'center' }); select.focus(); }
    });
    on(root, 'click', '[data-draw]', (e, t) => {
      this.drawType = t.dataset.draw;
      $$('#rdTool .tool').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      this._recolorTransientPick();
    });
    on(root, 'click', '[data-atab]', (e, t) => {
      this.anTab = t.dataset.atab;
      $$('[data-atab]').forEach(x => x.classList.toggle('on', x === t));
      this._refreshPanel();
    });
    /* 发音按钮：先 stop 再播，否则连续点击会叠加成噪音 */
    on(root, 'click', '[data-say]', (e, t) => { Speech.stop(); Speech.speak(t.dataset.say, { rate: .85 }); });

    // 选项
    on(root, 'click', '.q-opt', (e, t) => {
      if (this.submitted) return;
      /* 修改模式下，选项里的单词也要能划线/查词。
       * 若点的是单词 span，不当作选择答案（让 [data-w] 的处理器接手）。
       */
      if (this.mode === 'edit' && e.target.closest('[data-w]')) return;
      const qi = +t.dataset.q, oi = +t.dataset.o;
      // 同一题重复点= 取消选择（允许反悔）
      if (this.answers[qi] === oi) delete this.answers[qi];
      else this.answers[qi] = oi;
      /* 局部更新，不调 this._shell()：
       * _shell 里会把 this.left 重置为限时 → 每选一个选项倒计时就归零。
       */
      /* 只更新「当前这一题」的选项高亮。
       * 原写法对所有 .q-opt 执行 toggle('sel', same && ...)，
       * same 为 false 时会把**其他题已选中的** sel 一并移除——
       * 表现为"选第 2 题后，第 1 题的选中反馈消失"。*/
      $$(`.q-opt[data-q="${qi}"]`).forEach(x => {
        x.classList.toggle('sel', this.answers[qi] === +x.dataset.o);
      });
      this._updateAnswerCount();
    });

    // 选词 / 选句
    // 注意：委托必须绑在 root(#view) 上而非 #passage，
    // 因为 _reRenderPassage 会替换 #passage 节点，绑在其上的监听器会丢失。
    if (this.mode === 'edit') {
      this._selBound = false;
      // 点词查词：委托绑root（#passage 会被 _reRenderPassage 替换）
      on(root, 'click', '[data-w]', (e, t) => {
        // 刚做过整句划选则忽略，避免划线后误触
        if (this._justSelected) return;
        const raw = (t.dataset.wraw || t.dataset.w || '').trim();
        if (!raw || raw.includes('<')) return;
        this._setSelected({ type: 'word', text: raw });
        this._setTransientWord(t);
        this.anTab = 'word';
        $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === 'word'));
        /* 换词时清掉上一个的 AI 解析。
         * 划句路径（_onSelect）里清了，点词路径原本漏了，
         * 导致上一个词的 AI 块一直挂着——看起来像"没切换"。*/
        this.aiInline = false; this.aiData = null; this.aiFolded = false;
        this._refreshPanel();
      });
      // 划词 / 划句：直接绑在 #passage 上（此处不做节点替换）
      this._bindPassageSelect(document.getElementById('passage'));
      /* 题目与选项区也支持划句分析（用户要求）。
       * #qWrap 在重渲染时会被替换，因此每次 _bind 都重新绑定。
       */
      const qWrap = document.getElementById('qWrap');
      if (qWrap) this._bindPassageSelect(qWrap, true);
    }

    on(root, 'click', '[data-act]', async (e, t) => {
      // #anBox 自己有委托监听；在这里再处理会让 AI 请求发两次。
      if (t.closest('#anBox')) return;
      const a = t.dataset.act;
      if (a === 'submitRead') {
        await this._submitAndRender();
      } else if (a === 'resetRead') { this.answers = {}; this.submitted = false; this._shell($('#view')); }
      else if (a === 'showAns') {
        await this._verifyCurrentReading();
        this._questions(this.cur).forEach((q, i) => {
          if (q.a != null) this.answers[i] = this._readType(this.cur) === 'cloze' ? this._clozeAnswerIndex(q) : q.a;
        });
        this.submitted = true; this._shell($('#view'));
      } else if (a === 'verifyAnswers') {
        await this._verifyCurrentReading(true);
        if (Store.d.readLog && Store.d.readLog[this.cur.id]) {
          Store.d.readLog[this.cur.id].score = this._score();
          Store.d.readLog[this.cur.id].answerVerification = this.cur._answerVerification.status;
          Store.flush();
        }
        this._shell($('#view'));
      } else if (a === 'nb') { ViewNotebook.open(); }
      else if (a === 'export') { this._export(); }
      else if (a === 'import') { Importer.open('reading'); }
      else if (a === 'clearMarks') { this.marks = {}; this._shell($('#view')); }
      else if (a === 'clearOne') { this._clearOne(); }
      else if (a === 'togglePara') { await this._togglePara(+t.dataset.pi); }
      else if (a === 'genPassage') { await this._genPassage(); }
      else if (a === 'delPassage') { this._delPassage(); }
      else if (a === 'nbAddWord') { this._nbWord(false); }
      else if (a === 'nbAddTomorrow') { this._nbWord(true); }
      else if (a === 'aiLookup' || a === 'aiRun') { await this._aiLookup(); }
      else if (a === 'anSent') { await this._anSent(); }
    });

    const ts = $('#timeSel', root);
    if (ts) ts.onchange = () => {
      const v = +ts.value;
      const wasRunning = this.rState === 'running' || this.rState === 'paused';
      this.timeLimit = v;
      if (wasRunning) {
        this.left = v * 60;   // 计时中改时长 → 立即按新时长重置
        App.toast(`计时中改时长为 ${v} 分钟，已重新开始`, 'ok');
      } else {
        App.toast(`已选择 ${v} 分钟，点「▶ 开始计时」后开始`, '');
      }
      this._shell($('#view'));
    };

    // 计时暂停 / 继续
    const pb = $('#btnPause', root);
    if (pb) pb.onclick = () => this._togglePause();
    const rStart = $('#btnRStart', root);
    if (rStart) rStart.onclick = () => this._rStart();
    const rStop = $('#btnRStop', root);
    if (rStop) rStop.onclick = () => this._rStop();
    const rReset = $('#btnRReset', root);
    if (rReset) rReset.onclick = () => this._rReset();

    // 本篇总分：人工填写优先；留空则由 AI 依据题目来源估算
    const pt = $('#pTotal', root);
    if (pt) pt.onchange = () => {
      const v = +pt.value;
      this.totalScore = v > 0 ? v : null;
      if (this.cur && v > 0) { this.cur.totalScore = v; Store.flush(); }
      App.toast(v > 0 ? `本篇总分已设为 ${v}` : '已留空，将由 AI 估算', 'ok');
    };
    const bt = $('#btnAiTotal', root);
    if (bt) bt.onclick = () => this._aiTotal();

    // 键盘快捷：空格暂停（做题模式且未提交时）
    if (this._spaceBound !== true) {
      this._spaceBound = true;
      document.addEventListener('keydown', e => {
        if (e.code !== 'Space') return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        if (App.cur !== 'reading' || !ViewRead.paused && ViewRead.mode !== 'exam') { /* 仍允许 */ }
        if (ViewRead.mode !== 'exam' || ViewRead.submitted) return;
        e.preventDefault();
        ViewRead._togglePause();
      });
    }
  },

  _panelLoading(text) {
    this._refreshPanel('<div class="row" style="justify-content:center;padding:24px"><span class="spin"></span> <span class="dots">' + esc(text) + '</span></div>');
  },

  /**
   * 统一刷新右侧分析面板。
   * 必须先换节点再填内容：若先填内容再换节点，cloneNode(false) 不带子节点，内容会丢。
   */
  _refreshPanel(html) {
    const old = document.querySelector('#anBox');
    if (!old) return;
    const n = old.cloneNode(false);
    old.replaceWith(n);              // 先替换（带走旧监听器）
    n.innerHTML = html !== undefined ? html : this._anPanel();
    this._bindPanel(n);              // 直接对新节点绑定，不再二次替换
  },

  _bindPanel(box) {
    box = box || document.querySelector('#anBox');
    if (!box) return;
    /* 发音按钮：先 stop 再播，避免叠加 */
    on(box, 'click', '[data-say]', (e, t) => { Speech.stop(); Speech.speak(t.dataset.say, { rate: .85 }); });
    // 点击历史条：切回该词/句
    on(box, 'click', '[data-hist]', (e, t) => {
      const txt = t.dataset.hist;
      const isWord = App.words(txt).length < 4;
      this._clearTransientPick();
      ViewRead._setSelected({ type: isWord ? 'word' : 'sent', text: txt });
      const passage = document.getElementById('passage');
      const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (passage && isWord) {
        const word = $$('[data-w]', passage)
          .find(node => norm(node.dataset.wraw || node.dataset.w) === norm(txt));
        if (word) ViewRead._setTransientWord(word);
      } else if (passage) {
        const sent = $$('[data-senttext]', passage)
          .find(node => norm(node.dataset.senttext) === norm(txt));
        if (sent) ViewRead._setTransientSentence(sent);
      }
      ViewRead.aiInline = false; ViewRead.aiData = null; ViewRead.aiFolded = false;
      ViewRead._refreshPanel();
    });
    on(box, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'nbAddWord') this._nbWord(false);
      else if (a === 'nbAddTomorrow') this._nbWord(true);
      else if (a === 'aiLookup' || a === 'aiRun') await this._aiLookup();
      else if (a === 'aiHide') { this.aiInline = false; this.aiData = null; this._refreshPanel(); }
      else if (a === 'aiFold') { this.aiFolded = true; this._refreshPanel(); }
      else if (a === 'aiSay') {
        // 朗读当前划线词（音标旁的播放按钮）——先 stop，防多次点击叠加
        Speech.stop();
        Speech.speak(t.dataset.w || '', { rate: 0.9 });
      } else if (a === 'aiTest') {
        App.toast('正在测试…', '');
        const r = await AI.test();
        App.toast(r.msg, r.ok ? 'ok' : 'err');
        if (r.ok) { this._aiLookup(); }     // 连通后自动重试解析
      }
      else if (a === 'aiUnfold') { this.aiFolded = false; this._refreshPanel(); }
      else if (a === 'anSent') await this._anSent();
    });
  },

  /* ---------- 选中处理 ---------- */
  _setSelected(sel) {
    const prev = this.selected;
    if (!prev || prev.type !== sel.type || prev.text !== sel.text) {
      // 让已发出的旧请求失效，避免切换句子后旧结果覆盖新句子的分析。
      this._sentRequestId = (this._sentRequestId || 0) + 1;
      this.sentAn = null;
    }
    this.selected = sel;
  },

  _clearTransientPick() {
    const pickClasses = ['pick-y', 'pick-b', 'pick-g', 'pick-p', 'pick-u', 'pick-w'];
    $$('.picked').forEach(node => {
      node.classList.remove('picked', ...pickClasses);
    });
    this._activePick = null;
    this._hideWordPop();
  },

  _paintTransientPick(node) {
    if (!node) return;
    const pickClasses = ['pick-y', 'pick-b', 'pick-g', 'pick-p', 'pick-u', 'pick-w'];
    const pickClass = ({
      'hl-y': 'pick-y', 'hl-b': 'pick-b', 'hl-g': 'pick-g',
      'hl-p': 'pick-p', 'hl-u': 'pick-u', 'hl-w': 'pick-w',
    })[this.drawType] || 'pick-y';
    node.classList.add('picked');
    node.classList.remove(...pickClasses);
    node.classList.add(pickClass);
  },

  _setTransientWord(node) {
    this._clearTransientPick();
    if (!node) return;
    this._paintTransientPick(node);
    this._activePick = { type: 'word', text: node.dataset.wraw || node.dataset.w || '' };
  },

  _setTransientSentence(node) {
    this._clearTransientPick();
    if (!node) return;
    /* 点整句要真的高亮整句：只给 .sent 元素加 .picked 时，
     * 有的排版下背景只落在第一个词上，用户会以为只选中了一个词（走查 bug）。
     * 这里给句内每个 [data-w] 上色，提示语与视觉保持一致。*/
    const words = node.matches && node.matches('[data-w]')
      ? [node] : [...node.querySelectorAll('[data-w]')];
    if (words.length) words.forEach(w => this._paintTransientPick(w));
    else this._paintTransientPick(node);
    this._activePick = { type: 'sent', text: node.dataset.senttext || node.textContent || '' };
  },

  _recolorTransientPick() {
    $$('.picked').forEach(node => this._paintTransientPick(node));
  },

  /* 选中处理：记录历史，供面板折叠成历史条 */
  _onSelect(cached, forceType, wordNode) {
    const txt = cached || this._pendingSel;
    this._pendingSel = null;
    if (!txt) return;
    const inPass = document.getElementById('passage');
    if (!inPass) return;
    this._selText = txt;
    this._justSelected = true;
    // 换了词/句就清掉上一个的 AI 结果，避免张冠李戴（词与句互不串扰）
    this.aiInline = false; this.aiData = null; this.aiFolded = false;
    setTimeout(() => { this._justSelected = false; }, 400);
    const wc = App.words(txt).length;
    /* 关键：选中类型由当前分析模式决定，不再"多词就自动变长句"。
     * 词性翻译模式下只选当前词；长难句模式下才选整句。*/
    const type = forceType || (this.anTab === 'word' ? 'word' : (wc >= 4 ? 'sent' : 'word'));
    let text = txt;
    let node = wordNode || null;
    if (type === 'word') {
      const first = App.words(txt)[0];
      text = (this._activePick && this._activePick.type === 'word' && this._activePick.text)
        || first || txt;
      node = node || (this._activePick && this._activePick.node) || null;
    }
    this._setSelected({ type, text });
    this._pushHistory(this.selected);
    this._refreshPanel();
    if (type === 'word' && this.anTab === 'word') this._showWordPop(node, text);
    else this._hideWordPop();
    /* 长难句模式划句后自动分析。*/
    if (type === 'sent' && this.anTab === 'sent') {
      this._anSent();
    }
  },

  /** 词性翻译模式：在选中词旁边浮出简释（可加生词本），不挡住下方深度解析。*/
  _showWordPop(node, text) {
    this._hideWordPop();
    if (!this.anTab || this.anTab !== 'word' || !text) return;
    const info = this._wordInfo(text);
    const tr = info.parts && info.parts.length ? info.parts : [{ t: '', d: info.meaning || '词典未收录' }];
    const meaning = tr.map(x => (this._posLabel(x) ? this._posLabel(x) + ' ' : '') + x.meaning).join('；');
    const phText = this._phoneticText(info.phonetic);
    const pop = document.createElement('div');
    pop.id = 'readWordPop';
    pop.className = 'read-word-pop';
    pop.innerHTML = `
      <div class="rw-head"><b>${esc(text)}</b></div>
      <div class="rw-mean">${esc(meaning || '词典未收录')}</div>
      <div class="rw-actions">
        <button type="button" data-nb>＋ 生词本</button>
        <button type="button" data-close>关闭</button>
      </div>`;
    document.body.appendChild(pop);
    const r = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r ? r.left + r.width / 2 - pw / 2 : 16;
    let top = r ? (r.top - ph - 10) : 80;
    if (top < 8) top = r ? r.bottom + 10 : 80;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - ph - 8, top));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.querySelector('[data-close]').onclick = () => this._hideWordPop();
    pop.querySelector('[data-nb]').onclick = () => {
      const ok = Store.nbAdd({
        w: text,
        ph: info.phonetic || '',
        tr: tr.map(x => ({ t: x.label || x.pos || '', d: x.meaning })),
        srcTag: '阅读划词',
        origin: '来自阅读文章《' + (this.cur.title || '') + '》',
      });
      App.toast(ok ? '已加入生词本' : '生词本里已有这个词', ok ? 'ok' : '');
      this._hideWordPop();
    };
    this._wordPopAt = Date.now();
    /* 下一次“其他操作”自动关闭：点页面别处、滚动、切词都收起。
     * 用 setTimeout 避免创建浮层的那一次 pointerdown 立刻把它关掉。*/
    const closeOnOutside = e => {
      if (!pop.isConnected) return;
      if (e && e.target && pop.contains(e.target)) return;
      this._hideWordPop();
    };
    this._wordPopClose = closeOnOutside;
    setTimeout(() => {
      document.addEventListener('pointerdown', closeOnOutside, true);
      window.addEventListener('scroll', closeOnOutside, true);
    }, 0);
  },

  _hideWordPop() {
    if (this._wordPopClose) {
      document.removeEventListener('pointerdown', this._wordPopClose, true);
      window.removeEventListener('scroll', this._wordPopClose, true);
      this._wordPopClose = null;
    }
    const p = document.getElementById('readWordPop');
    if (p) p.remove();
  },

  /** 统一切换分析面板 tab */
  _setTab(which) {
    this.anTab = which;
    this._hideWordPop();
    $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === which));
  },

  /**
   * 推入历史（最多保留 6 条），用于面板顶部的历史折叠条。
   * 只记「词性 + 释义摘要」，不存完整数据，避免占内存。
   */
  _pushHistory(sel) {
    const h = this.hist || (this.hist = []);
    const isWord = sel.type === 'word';
    let pos = '', mean = '';
    if (isWord) {
      const info = this._wordInfo(sel.text);
      pos = info.parts.map(x => x.label).filter(Boolean).join('/');
      mean = info.meaning.slice(0, 60);
    } else {
      pos = '长难句';
      mean = sel.text.length > 42 ? sel.text.slice(0, 42) + '…' : sel.text;
    }
    const i = h.findIndex(x => x.text === sel.text);
    if (i >= 0) h.splice(i, 1);
    h.unshift({ text: sel.text, type: sel.type, pos, mean });
    if (h.length > 6) h.length = 6;
  },

  /** 当前词书优先；全局词典作为回退，并通过其词形还原结果补查词书。 */
  _wordInfo(text) {
    const word = String(text || '').trim().toLowerCase();
    const global = Dict.get(word);
    const bookId = Store.d.activeBook || 'cet6';
    const book = Dict.inBook(bookId, word)
      || (global && global[2] ? Dict.inBook(bookId, global[2]) : null);
    const posNames = {
      n: '名词', noun: '名词', v: '动词', verb: '动词', vt: '及物动词', vi: '不及物动词',
      adj: '形容词', a: '形容词', adjective: '形容词', adv: '副词', ad: '副词', adverb: '副词',
      prep: '介词', preposition: '介词', conj: '连词', conjunction: '连词', pron: '代词', pronoun: '代词',
      num: '数词', number: '数词', art: '冠词', article: '冠词', int: '感叹词', interjection: '感叹词',
      aux: '助动词', det: '限定词', abbr: '缩写',
    };
    const part = (pos, meaning) => {
      const key = String(pos || '').trim().toLowerCase().replace(/[.．、]$/, '');
      return { pos: key, label: posNames[key] || key, meaning: String(meaning || '').trim() };
    };
    const bookParts = (book && Array.isArray(book.tr) ? book.tr : [])
      .filter(x => x && x.d)
      .map(x => part(x.t, x.d));
    const globalText = String(global && global[1] || '').trim();
    const globalParts = globalText
      ? globalText.split(/[;；]/).map(s => {
        const m = s.trim().match(/^([a-z]{1,4})\s*[.．、]\s*(.*)$/i);
        return part(m ? m[1] : '', m ? m[2] : s);
      }).filter(x => x.meaning)
      : [];
    const parts = bookParts.length ? bookParts : globalParts;
    const meaning = parts.length ? parts.map(x => x.meaning).join('；') : globalText;
    return {
      book,
      global,
      parts,
      meaning,
      phonetic: (book && book.ph) || (global && global[0]) || '',
    };
  },

  /** 词性显示统一成 v. / n. / adj. 简写 */
  _posLabel(x) {
    const POS_ABBR = {
      '名词': 'n.', '动词': 'v.', '形容词': 'adj.', '副词': 'adv.', '介词': 'prep.',
      '连词': 'conj.', '代词': 'pron.', '数词': 'num.', '冠词': 'art.', '感叹词': 'int.',
      '及物动词': 'vt.', '不及物动词': 'vi.', '助动词': 'aux.', '限定词': 'det.', '缩写': 'abbr.',
    };
    let raw = String((x && (x.pos || x.label)) || '').trim().replace(/[.．、]/g, '');
    if (!raw) return '';
    if (POS_ABBR[raw]) return POS_ABBR[raw];
    const low = raw.toLowerCase();
    if (['n','v','adj','adv','prep','conj','pron','num','art','int','vt','vi','aux','det','abbr'].includes(low)) return low + '.';
    return raw.length <= 4 ? raw + '.' : raw;
  },

  /** 音标统一成 /.../，顺手修常见 ASCII 音标字符 */
  _phoneticText(text) {
    let ph = String(text || '').trim().replace(/^[\[\/]+|[\]\/]+$/g, '').trim();
    if (!ph) return '';
    ph = ph.replace(/:/g, 'ː').replace(/'/g, 'ˈ');
    return '/' + ph + '/';
  },

  /** 历史折叠条 HTML（最新的一条不显示，只显示更早的） */
  _histHTML() {
    const h = this.hist || [];
    if (h.length < 2) return '';
    const rest = h.slice(1);          // h[0] 是当前项，由主内容显示
    const POS = {
      n: '名词', noun: '名词', v: '动词', vt: '动词', vi: '动词', verb: '动词',
      adj: '形容词', a: '形容词', adjective: '形容词',
      adv: '副词', adverb: '副词', ad: '副词',
      prep: '介词', preposition: '介词', conj: '连词', conjunction: '连词',
      pron: '代词', pronoun: '代词', num: '数词', number: '数词',
      art: '冠词', article: '冠词', int: '感叹词', interjection: '感叹词',
    };
    const label = x => {
      if (x.type === 'sent') return '长难句';
      let raw = String(x.pos || '').trim();
      // pos 里可能塞了整段释义（形如 "n.透镜，望远镜…"），只取开头的词性缩写
      const m = raw.match(/^\s*([a-z]{1,4})\s*[.．、]/i);
      if (m) raw = m[1];
      if (!raw || raw.startsWith('/') || raw.startsWith('[')) return '词';
      const first = raw.split(/[\/&,，\s]/)[0].trim().replace(/\.$/, '').toLowerCase();
      if (POS[first]) return POS[first];
      for (const k of Object.keys(POS)) if (first.startsWith(k)) return POS[k];
      return first || '词';
    };
    return `<div class="hist-bar">
      <span class="hist-t">此前选中</span>
      ${rest.map(x => `<button class="hist-item" data-hist="${esc(x.text)}" title="${esc(x.mean || '')}">
        <b>${esc(label(x))}</b><span>${esc(x.mean || x.text)}</span>
      </button>`).join('')}
    </div>`;
  },

  _markWord(w) {
    if (!this.drawType) this.drawType = 'hl-y';
    this.marks[`w_${w}`] = this.drawType.replace('hl-', '');
    this._reRenderPassage();
  },
  _clearOne() {
    if (!this.selected) return;
    if (this.selected.type === 'word') delete this.marks['w_' + (this.selected.text || '').toLowerCase()];
    this._clearTransientPick();
    this._reRenderPassage();
    this._refreshPanel();
  },
  _reRenderPassage() {
    const p = this.cur;
    const ps = App.freshNode('#passage');
    if (!ps) return;
    if (this._readType(p) === 'cloze') {
      ps.outerHTML = this._renderClozeInline(p);
      const nextPassage = document.getElementById('passage');
      if (nextPassage) this._bindPassageSelect(nextPassage);
      return;
    }
    if (this._readType(p) === 'section-a') {
      ps.outerHTML = this._renderCloze(p, this.mode === 'edit');
      const nextPassage = document.getElementById('passage');
      if (nextPassage) this._bindPassageSelect(nextPassage);
      return;
    }
    if (this._readType(p) === 'section-b') {
      ps.outerHTML = this._renderMatchingParagraphs(p);
      const nextPassage = document.getElementById('passage');
      if (nextPassage) this._bindPassageSelect(nextPassage);
      return;
    }
    /* 与初始渲染**用同一个函数**，否则这里会把段落翻译块冲掉
     * （之前这里写的是旧模板，只有 <p> 没有 .para-wrap）。*/
    ps.innerHTML = this._sourceParagraphs(p).map((para, pi) => `<div class="para-wrap">
      <p style="margin-bottom:6px">${this._renderPara(para, pi)}</p>
      ${this._paraTransHTML(p, para, pi)}
    </div>`).join('');
    ps.__selBound = false;             // 节点已换，需重新绑定划词
    this._bindPassageSelect(ps);
  },

  /**
   * 划词/划句：自绘选区方案。
   * 不用浏览器原生选区，因为：① 段落设了 user-select:none，原生选区在部分环境下
   * 取不到文本；② 原生选区无法跨句、样式不可控。
   * 改为：mousedown 记录起点词，mousemove 记录终点词，mouseup 时取两词之间全部文本，
   * 并用.range 临时给这段文字加 .picked 样式（selectstart 阻止原生行为）。
   */
  /* ---------- 做题模式手写/笔记 ---------- */
  _initReadNotes() {
    const canvas = document.getElementById('readNoteCanvas');
    const host = document.getElementById('readNoteHost');
    const bar = document.getElementById('readNoteBar');
    if (!canvas || !host || !bar || this.mode !== 'exam' || !this.cur) return;
    const pid = this.cur.id || 'reading';
    this._noteStrokes = (Store.d.readNotes && Store.d.readNotes[pid]) ? Store.d.readNotes[pid].slice() : [];
    this._noteMode = false;
    this._noteErase = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      this._noteCtx = canvas.getContext('2d');
      this._noteCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._noteW = w; this._noteH = h;
      this._drawNotes();
    };
    this._drawNotes = () => {
      const ctx = this._noteCtx; if (!ctx) return;
      ctx.clearRect(0, 0, this._noteW || 0, this._noteH || 0);
      (this._noteStrokes || []).forEach(s => {
        if (!s.points || s.points.length < 2) return;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = s.color || '#ef4444';
        ctx.lineWidth = s.width || 2.2;
        ctx.beginPath();
        s.points.forEach((pt, i) => {
          const x = pt[0] * (this._noteW || 0), y = pt[1] * (this._noteH || 0);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke(); ctx.restore();
      });
    };
    const setMode = (on, erase) => {
      this._noteMode = on; this._noteErase = !!erase;
      canvas.classList.toggle('on', on);
      bar.querySelectorAll('[data-note]').forEach(b => {
        b.classList.toggle('on', (b.dataset.note === 'pen' && on && !erase) || (b.dataset.note === 'eraser' && on && erase));
      });
      // 用户点开笔记时再按当前布局定一次尺寸（首帧时 host 可能尚未完成布局）
      resize();
      setTimeout(resize, 50);
    };
    bar.querySelectorAll('[data-note]').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.note;
        if (k === 'clear') {
          this._noteStrokes = [];
          Store.d.readNotes = Store.d.readNotes || {};
          Store.d.readNotes[pid] = [];
          Store.flush(); this._drawNotes();
          App.toast('已清除本篇文章的笔记', '');
          return;
        }
        if (k === 'pen') setMode(!(this._noteMode && !this._noteErase), false);
        else setMode(!(this._noteMode && this._noteErase), true);
      };
    });
    let drawing = null, last = null;
    const point = e => {
      const r = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
    };
    canvas.addEventListener('pointerdown', e => {
      if (!this._noteMode) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件/不支持捕获时忽略 */ }
      drawing = { color: '#ef4444', width: 2.2, erase: this._noteErase, points: [] };
      last = point(e); drawing.points.push(last);
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      e.preventDefault();
      const p = point(e);
      if (last && Math.hypot((p[0] - last[0]) * (this._noteW || 1), (p[1] - last[1]) * (this._noteH || 1)) < 1.2) return;
      drawing.points.push(p); last = p;
      this._drawNotes();
      const ctx = this._noteCtx; if (!ctx) return;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = drawing.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = drawing.color; ctx.lineWidth = drawing.width;
      ctx.beginPath();
      drawing.points.forEach((pt, i) => {
        const x = pt[0] * (this._noteW || 0), y = pt[1] * (this._noteH || 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke(); ctx.restore();
    });
    const end = () => {
      if (!drawing) return;
      if (drawing.points.length > 1) this._noteStrokes.push(drawing);
      drawing = null; last = null;
      Store.d.readNotes = Store.d.readNotes || {};
      Store.d.readNotes[pid] = this._noteStrokes;
      Store.flush(); this._drawNotes();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    /* 每次进页面/切篇目都会新建 canvas：先解绑上一次的 resize，
     * 否则闭包越攒越多（审查 P2-7）。*/
    if (this._notesResize) window.removeEventListener('resize', this._notesResize);
    this._notesResize = resize;
    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);
    setTimeout(resize, 60);
    setTimeout(resize, 300);
  },

  _bindPassageSelect(ps) {
    if (!ps || this.mode !== 'edit') return;
    /*按元素标记，而不是用全局 this._selBound：
     * 段落与题目区是两个容器，共用一个标志会导致第二个绑不上。
     */
    if (ps.__selBound) return;
    ps.__selBound = true;
    ps.addEventListener('selectstart', e => e.preventDefault());

    const wordEl = e => (e.target.closest ? e.target.closest('[data-w]') : null);
    /* firstW/lastW 挂在容器上而非 this 上：
     * 段落与题目区是两个独立划选区域，状态不能互相污染。
     */
    const clear = () => {
      /* 清**所有容器**的划选高亮，不只是当前 ps。
       * 因为划下一句时可能换到另一个段落（另一个容器），
       * 只清ps 的话，上一句的高亮会一直留着。*/
      this._clearTransientPick();
      ps._firstW = ps._lastW = null;
    };
    const paint = () => {
      ps.querySelectorAll('.picked').forEach(x => {
        x.classList.remove('picked', 'pick-y', 'pick-b', 'pick-g', 'pick-p', 'pick-u', 'pick-w');
      });
      const a = ps._firstW, b = ps._lastW;
      if (!a || !b) return;
      const ws = [...ps.querySelectorAll('[data-w]')];
      const i = ws.indexOf(a), j = ws.indexOf(b);
      if (i < 0 || j < 0) return;
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) this._paintTransientPick(ws[k]);
    };

    ps.addEventListener('mousedown', e => {
      const w = wordEl(e);
      if (!w) return;
      // 开始新的划选 → 先取消上一个（可能是另一个段落里的）
      this._clearTransientPick();
      ps._firstW = ps._lastW = w;
      this._dragging = true;
      paint();
    });
    ps.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const w = wordEl(e);
      if (w && w !== ps._lastW) { ps._lastW = w; paint(); }
    });
    const finish = e => {
      if (interactiveTarget(e.target)) { this._dragging = false; return; }
      if (!this._dragging) return;
      this._dragging = false;
      const txt = this._pickedText(ps);
      if (txt && App.words(txt).length >= 2) {
        /* 词性翻译模式：拖选多个词也只取起点词，绝不做整句高亮/整句分析。*/
        if (this.anTab === 'word') {
          const selectedWord = ps._firstW;
          clear();
          this._setTransientWord(selectedWord);
          this._onSelect(selectedWord.dataset.wraw || selectedWord.dataset.w || txt, 'word', selectedWord);
          return;
        }
        /* 长难句模式：划句保持高亮，自动分析。*/
        this._picked = txt;
        paint();
        this._activePick = { type: 'sent', text: txt };
        this._justSelected = true;
        setTimeout(() => { this._justSelected = false; }, 350);
        this._onSelect(txt, 'sent', ps._firstW);
        this._pickedEls = $$('.picked', ps);
      } else if (App.words(txt).length === 1) {
        const selectedWord = ps._firstW;
        if (this.anTab === 'sent') {
          /* 长难句模式点单词：理解为点它所在的那句 */
          const sent = selectedWord && selectedWord.closest('.sent');
          if (sent) {
            this._setTransientSentence(sent);
            this._onSelect(sent.dataset.senttext || sent.textContent || '', 'sent', sent);
            return;
          }
        }
        clear();
        this._setTransientWord(selectedWord);
        this._justSelected = true;
        setTimeout(() => { this._justSelected = false; }, 250);
        this._onSelect(txt, 'word', selectedWord);
      } else clear();
    };
    ps.addEventListener('mouseup', finish);
    ps.addEventListener('mouseleave', () => { if (this._dragging) { this._dragging = false; } });

    /* 交互控件（Section A 空位下拉、答案 select、按钮等）上的点击不能当成
     * “点句取整句”，否则选一个空位会同时触发长难句 AI 分析并整句高亮。*/
    const interactiveTarget = t => !!(t && t.closest
      && t.closest('select, option, input, textarea, button, a, [data-special-answer]'));
    // 触屏：长按拖选退化为「点句取整句」
    let touchX = 0;
    ps.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    ps.addEventListener('touchend', e => {
      if (interactiveTarget(e.target)) return;
      const dx = Math.abs((e.changedTouches[0] || {}).clientX - touchX);
      if (dx < 12) {
        const w = e.target.closest && e.target.closest('[data-w]');
        const s = e.target.closest && e.target.closest('.sent');
        if (this.anTab === 'word') {
          if (w) {
            this._setTransientWord(w);
            this._onSelect(w.dataset.wraw || w.dataset.w || '', 'word', w);
            App.toast('已选单词：查看简释或加入生词本', '');
          }
          return;
        }
        if (s) {
          this._setTransientSentence(s);
          this._onSelect(s.dataset.senttext, 'sent', s);
          App.toast('已选中整句，正在做长难句分析', '');
        }
      }
    });
  },

  /** 取当前高亮范围对应的文本 */
  _pickedText(ps) {
    /* 划选状态挂在**容器 ps** 上（段落与题目区是两个独立划选区域，
     * 挂在视图对象上会互相污染）。
     * 注意：这里必须读容器的 _firstW / _lastW，
     * 早前误读视图对象的属性导致划句永远取不到范围 → 划了没反应。*/
    const a = ps._firstW, b = ps._lastW;
    if (!a || !b) return '';
    const ws = [...ps.querySelectorAll('[data-w]')];
    const i = ws.indexOf(a), j = ws.indexOf(b);
    if (i < 0 || j < 0) return '';
    const seg = ws.slice(Math.min(i, j), Math.max(i, j) + 1);
    // 借助 Range 还原原始空格与标点
    if (seg.length) {
      const r = document.createRange();
      r.setStartBefore(seg[0]);
      r.setEndAfter(seg[seg.length - 1]);
      if (this._readType(this.cur) === 'section-a') {
        const fragment = r.cloneContents();
        fragment.querySelectorAll('.read-answer-wrap').forEach(wrap => {
          const select = wrap.querySelector('[data-special-answer]');
          const index = select ? +select.dataset.specialAnswer : -1;
          const chosen = index >= 0
            ? this._wordBank(this.cur).find(x => x.letter === this._answerValue(this.answers[index])) : null;
          wrap.replaceWith(document.createTextNode(chosen ? ` ${chosen.word} ` : ' [空] '));
        });
        const t = fragment.textContent.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      const t = r.toString().replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return seg.map(x => x.dataset.wraw || x.dataset.w).join(' ');
  },

  /* ---------- 计时 ---------- */
  /* ---------- 计时状态机（与写作一致）----------
   * idle（选时长）→点开始→ running（倒计时）
   *   →暂停 paused / 继续 running →点结束→ finished（锁定）
   *   →点归零→ idle（才能重新选时长）
   */
  _rLabel() {
    if (this.mode !== 'exam') return '限时（不计时）';
    return {
      idle: '未开始', running: '倒计时',
      paused: '已暂停', finished: '已结束',
    }[this.rState || 'idle'];
  },

  /** 开始计时（仅 idle 可点） */
  _rStart() {
    if (this.rState && this.rState !== 'idle') return;
    const sel = $('#timeSel');
    const v = sel ? +sel.value : (this.timeLimit || this.cur.timeLimit || 30);
    this.timeLimit = v;
    this.left = v * 60;
    this.rState = 'running';
    this._usedSec = 0;
    this._startTimer();
    this._shell($('#view'));
    App.toast(`开始计时：${v} 分钟`, 'ok');
  },

  _startTimer() {
    clearInterval(this.timer);
    const disp = $('#tDisp');
    if (!disp) return;
    // interval 常驻但仅在 running 时递减，"继续"能瞬时恢复
    this.timer = setInterval(() => {
      if (this.mode !== 'exam' || this.submitted) return;
      if (this.rState !== 'running') return;
      this.left--;
      disp.textContent = App.mmss(this.left);
      const box = $('#timerBox');
      if (box) {
        box.classList.toggle('warn', this.left <= 300 && this.left > 60);
        box.classList.toggle('dan', this.left <= 60);
      }
      if (this.left <= 0) {
        clearInterval(this.timer);
        this.rState = 'finished';
        App.toast('时间到，已自动提交', 'err');
        this._submitAndRender();
      }
    }, 1000);
  },

  /** 暂停 / 继续 */
  _togglePause() {
    if (this.rState !== 'running' && this.rState !== 'paused') {
      App.toast(this.rState === 'finished'
        ? '计时已结束，如需重来请先点「归零」'
        : '请先点「▶ 开始计时」', '');
      return;
    }
    this.rState = this.rState === 'running' ? 'paused' : 'running';
    const d = $('#tDisp'), label = $('#tLabel'), box = $('#timerBox');
    if (d) d.textContent = App.mmss(this.left);
    if (label) label.textContent = this._rLabel();
    if (box) {
      box.classList.toggle('paused', this.rState === 'paused');
      box.classList.remove('idle', 'done');
    }
    const btn = $('#btnPause');
    if (btn) {
      btn.className = 'btn btn-xs ' + (this.rState === 'paused' ? 'btn-ok' : 'btn-warn');
      btn.innerHTML = this.rState === 'paused'
        ? '<svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>继续'
        : '<svg viewBox="0 0 24 24" class="ic ic-sm">❚❚</svg>暂停';
    }
    App.toast(this.rState === 'paused' ? '计时已暂停' : '继续计时', this.rState === 'paused' ? '' : 'ok');
  },

  /** 结束计时：锁定时长，必须归零才能改 */
  _rStop() {
    if (this.rState !== 'running' && this.rState !== 'paused') return;
    clearInterval(this.timer);
    this._usedSec = (this.timeLimit * 60) - this.left;
    this.rState = 'finished';
    this._shell($('#view'));
    App.toast(`计时结束，实际用时 ${App.mmss(this._usedSec)}。要重新计时请点「归零」。`, 'ok');
  },

  /** 归零：回到可选时长 */
  _rReset() {
    clearInterval(this.timer);
    this.rState = 'idle';
    this.left = (this.timeLimit || this.cur.timeLimit || 30) * 60;
    this._usedSec = 0;
    this._shell($('#view'));
    App.toast('已归零，可以重新选择时长', '');
  },

    /** AI 估算本篇总分（依据题目来源：考试类型/年份/篇目等） */
  async _aiTotal() {
    const btn = $('#btnAiTotal');
    const p = this.cur;
    if (!p) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    const est = await AI.estimateTotalScore({
      level: p.level, genre: p.genre, title: p.title,
    });
    this.totalScore = est;
    this._totalEstimated = true;
    this._totalReason = `${p.level || '大学英语'} · ${p.title || '本篇'}`;
    p.totalScore = est;
    Store.d.readTotal = Store.d.readTotal || {};
    Store.d.readTotal[p.id] = est;
    Store.flush();
    this._shell($('#view'));
    App.toast(`AI 估算本篇满分为 ${est} 分`, 'ok');
  },

  /* ---------- 答题进度 ---------- */
  _answered() {
    if (!this.cur || !this.cur.questions) return 0;
    return this.cur.questions.filter((q, i) => this.answers[i] != null).length;
  },
  /** 局部更新已答题数（不重绘整页，避免倒计时被重置） */
  _updateAnswerCount() {
    const el = $('#ansCount');
    if (!el || !this.cur) return;
    const n = this._answered(), total = this.cur.questions.length;
    el.textContent = `${n} / ${total} 题`;
    el.classList.toggle('all', n === total);
  },

  _syncSpecialSelects(root) {
    if (this._readType(this.cur) !== 'section-a') return;
    const selects = $$('[data-special-answer]', root);
    selects.forEach(select => {
      const currentIndex = +select.dataset.specialAnswer;
      const used = new Set(Object.entries(this.answers)
        .filter(([i, value]) => +i !== currentIndex && value != null)
        .map(([, value]) => this._answerValue(value)));
      Array.from(select.options).forEach(option => {
        option.disabled = !!option.value && used.has(option.value) && option.value !== select.value;
      });
    });
  },

  _score() {
    const questions = this._questions(this.cur);
    const type = this._readType(this.cur);
    const specialized = type !== 'traditional';
    const correct = questions.reduce((n, q, i) => {
      if (!specialized) return n + (this.answers[i] === q.a ? 1 : 0);
      if (type === 'cloze') return n + (this.answers[i] != null && +this.answers[i] === this._clozeAnswerIndex(q) ? 1 : 0);
      const expected = this._answerValue(q.a);
      const actual = this._answerValue(this.answers[i]);
      return n + (expected && actual === expected ? 1 : 0);
    }, 0);
    return Math.round((correct * (this.cur.totalScore / Math.max(1, questions.length))) * 100) / 100;
  },

  /* ---------- 生词本 ---------- */
  _nbWord(tomorrow) {
    const sel = this.selected;
    if (!sel) return;
    const w = sel.text.toLowerCase();
    const info = this._wordInfo(w);
    const inBk = info.book;
    Store.nbAdd({
      w, ph: info.phonetic ? '/' + info.phonetic + '/' : '',
      tr: info.parts.map(x => ({ t: x.pos, d: x.meaning })),
      phr: inBk ? inBk.phr.map(p => `${p.p} — ${p.d}`) : [],
      extra: [], root: '',
      ex: inBk && inBk.ex && inBk.ex[0] ? `${inBk.ex[0].en}  ${inBk.ex[0].cn}` : '',
      srcTag: tomorrow ? '阅读·明日待背' : '阅读划线',
      tomorrow: !!tomorrow,
      origin: `来自阅读文章「${this.cur.title}」（${this.cur.level}）第${this._paraOf(sel.text)}段划线，原句：${sel.type === 'sent' ? sel.text : this._ctxOf(sel.text)}`,
    });
    App.toast(tomorrow ? '已加入生词本（标记为明日待背）' : '已加入生词本', 'ok');
  },
  _paraOf(txt) {
    const p = this._sourceParagraphs(this.cur).findIndex(p => p.includes(txt.slice(0, 20)));
    return p + 1;
  },
  _ctxOf(w) {
    for (const para of this._sourceParagraphs(this.cur)) {
      const i = para.toLowerCase().indexOf(w.toLowerCase());
      if (i >= 0) return '…' + para.slice(Math.max(0, i - 50), Math.min(para.length, i + w.length + 50)) + '…';
    }
    return '';
  },

  /** AI 解析结果的紧凑 HTML（用于内联在当前 tab 顶部） */
  /**
   * AI 深度解析的固定维度渲染
   *
   * 【设计要点】用户要求「每次都必须包含搭配、词根、近义词、近年常考等拓展」，
   * 所以这里**固定列出全部 8 个维度**，某项没数据时显式标注「暂缺」，
   * 而不是像原来那样"有才渲染、没就整行消失"——那会让用户
   * 误以为解析不完整。每次看到固定的完整结构，才知道该看哪几项。
   */
  _aiInlineHTML(d) {
    if (!d) return '';
    const chip = (arr, ph) => {
      const a = (arr || []).filter(Boolean);
      return a.length
        ? a.map(x => `<span class="chip">${esc(x)}</span>`).join('')
        : `<span class="ai-none">${esc(ph || '本次未返回')}</span>`;
    };
    const row = (label, inner) => `<div class="ai-in-row"><b>${label}</b><span>${inner}</span></div>`;
    const txt = (v, ph) => (v && String(v).trim())
      ? esc(v) : `<span class="ai-none">${esc(ph || '本次未返回')}</span>`;

    return `<div class="ai-in-card">
      <div class="ai-in-h">
        <span class="ai-in-badge">AI 深度解析</span>
        <button class="btn btn-xs btn-gh" data-act="aiHide" title="隐藏 AI 解析">✕</button>
      </div>
      <div class="ai-in-word">
        <span class="w">${esc(d.word || ViewRead.selected && ViewRead.selected.text || '')}</span>
        ${d.phonetic ? `<span class="ph">${esc(d.phonetic)}</span>` : ''}
        ${(() => {
        const w = d.word || (ViewRead.selected && ViewRead.selected.text) || '';
        return w ? `<button class="btn btn-xs btn-gh ai-say" data-act="aiSay" data-w="${esc(w)}"
            title="朗读当前划线词"><svg viewBox="0 0 24 24" class="ic ic-sm">
            <path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7"/></svg>读</button>` : '';
      })()}
      </div>
      ${row('音标', txt(d.phonetic ? d.phonetic : (/^[a-z:ˈˌ]+$/i.test(d.pos || '') ? d.pos : ''), '—'))}
      ${row('语境释义', (d.pos && d.pos.length)
        ? d.pos.map(p => `<div class="ai-pos"><i>${esc(p.t || '')}</i>${esc(p.d || '')}</div>`).join('')
        : '<span class="ai-none">本次未返回</span>')}
      ${row('常用搭配', chip(d.collocation, '本次未返回'))}
      ${row('词根词缀', txt(d.root, '无明显词根'))}
      ${row('近义词', chip(d.synonym, '本次未返回'))}
      ${row('反义词', chip(d.antonym, '无常见反义词'))}
      ${row('常见用法', (d.recent && d.recent.length)
        ? d.recent.map(x => `<div class="ai-recent">· ${esc(x)}</div>`).join('')
        : '<span class="ai-none">本次未返回</span>')}
      ${row('语法说明', txt(d.grammar, '本次未返回'))}
      ${d.example && d.example.en
        ? row('例句', `${esc(d.example.en)}${d.example.cn ? `<div class="cn">${esc(d.example.cn)}</div>` : ''}`)
        : row('例句', '<span class="ai-none">本次未返回</span>')}
      ${d.origin ? row('你的语境', `<span style="color:var(--tx3)">${esc(d.origin)}</span>`) : ''}
      ${d.degraded ? `<div class="ai-warn">
        <b>${!AI.ready ? '未启用 AI' : d.reason === 'failed' ? 'AI 调用失败' : 'AI 返回内容不完整'}</b>
        <div class="ai-warn-msg">${esc(d.errMsg || (AI.ready ? '请求未能完成。可到设置页点「测试连接」查看详情。' : '当前为本地词典释义。'))}</div>
        <button class="btn btn-xs btn-gh" data-act="aiTest" style="margin-top:6px">测试 AI 连接</button>
      </div>` : ''}
      ${d.easy ? `<div class="ai-easy"><b>一句话记忆</b>${esc(d.easy)}</div>` : ''}
      <div class="ai-source-note">来源核验：${d.degraded ? '当前为本地词典或降级结果，未核验外部资源。' : '以上为 AI 生成的语言分析；本应用未联网检索，具体真题年份、出处和外部资源尚未核验。请以可追溯的原卷或官方发布为准。'}</div>
    </div>`;
  },

  async _aiLookup() {
    /* 不清空面板、不切换 tab：
     * 用户点「AI 深度解析」时的预期是"在当前词性翻译页面里看到 AI 的解释"，
     * 而不是被跳到另一个 tab。AI 结果就地插到当前 tab 内容的最上方。
     */
    if (!AI.ready) {
      App.toast('未启用 AI，请到设置页填写 Base URL、Key 与模型名称', 'err');
      return;
    }
    const keepTab = this.anTab;                // 记住当前 tab，别抢走用户的视线
    const box = document.querySelector('#anBox');
    if (box && !box.querySelector('#aiProg')) {
      const bar = document.createElement('div');
      bar.id = 'aiProg';
      bar.innerHTML = '<div class="ai-progress"><i></i></div>'
        + '<div class="ai-progress-tip"><span class="spin"></span> AI 解析中，通常 1-3 秒…</div>';
      box.insertBefore(bar, box.firstChild);
    }
    const ctx = this._ctxOf(this.selected.text);
    let d;
    try {
      d = await AI.lookup(this.selected.text, ctx);
    } catch (e) {
      const pr = document.querySelector('#aiProg');
      if (pr) pr.remove();
      App.toast('AI 解析失败：' + (e.message || e).slice(0, 60), 'err');
      return;
    }
    this.aiData = d;
    this.aiInline = true;                     // 标记：AI 结果内联显示
    this.aiFolded = false;                    // 刚解析出来默认展开
    // 折叠态显示的摘要：优先语境释义，其次本地释义
    this.aiHeadline = (d.pos && d.pos[0] && d.pos[0].d) || (d.origin || '');
    this.anTab = keepTab;                     // 保持在原 tab
    $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === keepTab));
    this._refreshPanel();
    App.toast(d.degraded ? 'AI 分析不完整，请查看面板中的原因并重试' : 'AI 解析完成，已在当前面板顶部显示',
      d.degraded ? 'err' : 'ok');
  },

  async _anSent() {
    const sel = this.selected;
    if (!sel || sel.type !== 'sent') {
      App.toast('先在原文中选中一个句子，再开始分析', '');
      return;
    }
    if (this._activePick
      && (this._activePick.type !== 'sent' || this._activePick.text !== sel.text)) {
      this._clearTransientPick();
    }
    const reqId = this._sentRequestId = (this._sentRequestId || 0) + 1;
    const text = sel.text;
    this._panelLoading('分析中');
    let d;
    try {
      d = await AI.analyzeSentence(text);
    } catch (e) {
      d = {
        pattern: '分析未完成', structure: '', components: [], points: [],
        cn: '（AI 分析失败）', degraded: true,
        errMsg: (e && e.message ? String(e.message) : '未知错误').slice(0, 240),
      };
    }
    if (reqId !== this._sentRequestId || !this.selected
      || this.selected.type !== 'sent' || this.selected.text !== text) return;
    this.sentAn = d;
    this._refreshPanel();
  },

  /* ---------- 导出 PDF ---------- */
  _export() {
    const p = this.cur;
    const items = [];
    const markedWords = Object.keys(this.marks).filter(k => k.startsWith('w_')).map(k => k.slice(2));
    const nbWords = Store.d.notebook.filter(x => x.srcTag && x.srcTag.indexOf('阅读') === 0).map(x => x.w);
    const all = [...new Set([...markedWords, ...nbWords])];
    all.forEach(w => {
      const d = Dict.get(w), inBk = Dict.inBook(Store.d.activeBook, w);
      items.push({
        w, ph: (d && d[0]) ? '/' + d[0] + '/' : '',
        tr: d ? [{ t: '', d: d[1] }] : (inBk ? inBk.tr : []),
        phr: inBk ? inBk.phr.map(x => `${x.p} — ${x.d}`) : [],
        root: '', extra: [], ex: '',
        srcTag: '阅读划线', addedAt: new Date().toISOString(),
        origin: `来自阅读文章《${p.title}》（${p.level}）· ${p.genre}话题，${this._paraOf(w)}段`,
      });
    });
    if (!items.length) { App.toast('还没有可导出的生词，先划线或加入生词本', ''); return; }
    PDF.openNotebookExport(items, { bookName: p.title });
  },

  async _genPassage() {
    App.modal('AI 生成阅读材料', `<div class="row" style="justify-content:center;padding:30px"><span class="spin"></span> <span class="dots">正在生成文章与题目</span></div>`);
    const lv = this.cur.level;
    const d = await AI.genReading(lv);
    App.closeModal();
    const p = {
      id: 'gen' + Date.now(), title: d.title || 'AI 生成文章',
      source: 'generated-unverified',
      level: d.level || lv, genre: d.genre || 'AI生成', timeLimit: d.timeLimit || 25,
      totalScore: d.totalScore || 20, paragraphs: d.paragraphs || [], questions: d.questions || [],
      year: (this.sel && this.sel.year && this.sel.year !== 'all' && this.sel.year !== 'null') ? this.sel.year : null,
      session: (this.sel && this.sel.session && this.sel.session !== 'all') ? this.sel.session : 'gen',
      no: (this.list ? this.list.length + 1 : 99),
      mine: true,
    };
    if (!p.paragraphs.length) { App.toast('生成失败，请检查 AI 配置', 'err'); return; }
    Dict.content.reading.passages.push(p);
    Importer.markMine('reading', p.id);
    /* 切到新生成的这篇。
     * 【修 bug】原来是 this.pi = 全量数组下标，而渲染用的是**筛选后**列表的下标：
     * 一旦用户带着筛选条件（例如只看 2023 年卷），两者对不上就会跳到别的篇目，
     * 甚至因为下标越界被 _shell 归零成第 1 篇。
     * 现在把筛选条件指向新文章本身（放开类型/年份/场次），它一定出现在结果里。*/
    this.sel = { level: 'all', year: 'all', session: 'all', no: 'id:' + p.id };
    this.pi = 0;
    this.answers = {}; this.submitted = false; this.marks = {}; this.selected = null; this.hist = [];
      this._paraCn = {}; this._paraOpen = new Set();   // 切篇清空段落翻译
    this._shell($('#view'));
    App.toast('已生成新文章', 'ok');
  },

  /** 删除自己导入的文章（内置题不可删） */
  _delPassage() {
    const p = this.cur;
    if (!p.mine) { App.toast('内置仿真题不可删除', ''); return; }
    App.confirm(`删除「${p.title}」？此操作不可撤销。`, () => {
      const arr = Dict.content.reading.passages;
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
      Importer.unmarkMine('reading', p.id);
      this.pi = 0; this.answers = {}; this.submitted = false; this.marks = {};
      this._shell($('#view'));
      App.toast('已删除', 'ok');
    });
  },
};
window.ViewRead = ViewRead;
