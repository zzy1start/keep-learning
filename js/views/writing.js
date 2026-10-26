/* ============ views/writing.js : 写作模块 ============ */
/** 读取并压缩作文图片，确保文件选择后形成可直接发送的 JPEG data URL。 */
function readWritingImage(file) {
  if (!file || !/^image\//i.test(file.type || '')) return Promise.reject(new Error('请选择图片文件'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`图片无法解码：${file.name}`));
      image.onload = () => {
        const maxSide = 1800;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error(`图片处理失败：${file.name}`));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        try {
          // 降低过大的照片请求体，同时保留手写笔画的清晰度。
          let data = canvas.toDataURL('image/jpeg', 0.86);
          if (data.length > 5 * 1024 * 1024) data = canvas.toDataURL('image/jpeg', 0.72);
          if (data.length > 7 * 1024 * 1024) return reject(new Error(`${file.name}压缩后仍过大，请裁剪后再上传`));
          resolve({ data, mime: 'image/jpeg', name: file.name, originalBytes: file.size });
        } catch (e) { reject(new Error(`图片处理失败：${file.name}`)); }
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 防止极短作文被模型或本地规则给出虚高分。
 * 只用于完整作文题；单句翻译练习由其自身评分标准处理。
 */
function capIncompleteEssayScore(result, essayText, minWords) {
  if (!result || !result.score) return '';
  const text = String(essayText || '').trim();
  const words = (text.match(/[a-zA-Z']+/g) || []).length;
  if (!words) return '';

  const sentenceCount = Math.max(1, text.split(/[.!?]+/).filter(s => s.trim()).length);
  const expected = Math.max(1, Number(minWords) || 150);
  let ratio = 1;
  let reason = '';
  if (sentenceCount <= 1) {
    ratio = 0.15;
    reason = '全文只有一句，缺少展开论证和段落结构';
  } else if (words < 40) {
    ratio = 0.20;
    reason = '篇幅不足 40 词，内容尚未充分展开';
  } else if (words < expected * 0.5) {
    ratio = 0.35;
    reason = '篇幅不足题目最低建议词数（' + expected + ' 词）的一半';
  } else if (words < expected) {
    ratio = 0.65;
    reason = '未达到题目最低建议词数（' + expected + ' 词）';
  }
  if (!reason) return '';

  const max = Math.max(1, Number(result.score.max) || 30);
  const cap = Math.round(max * ratio * 10) / 10;
  const current = Math.max(0, Number(result.score.total) || 0);
  if (current <= cap) return '';

  result.score.total = cap;
  const note = '完整度校正：识别到约 ' + words + ' 词、' + sentenceCount + ' 句；' + reason
    + '。总分已限制在 ' + cap + '/' + max + ' 分以内。';
  result.comment = [String(result.comment || '').trim(), note].filter(Boolean).join(' ');
  return note;
}

const ViewWrite = {
  tab: 'task',        // task | sentence | translation | ai （custom 已移出，改为操作按钮）
  essay: '',
  curTask: null,
  result: null,
  sugTab: 'all',
  inkMode: false,
  startAt: 0,
  left: 0,
  timer: null,
  /* 最近输入记忆（Store.d.writingHistory，最多 5 条；与翻译页互相独立）*/
  _memo: null,
  _memoPending: null,
  _memoSess: 0,
  _memoListening: false,

  _isSentenceTab() { return this.tab === 'sentence'; },

  /* ---------- 最近输入记忆（最近 5 条，存 Store.d.writingHistory） ----------
   * 写作页有多个 tab（真题写作/单句/考研翻译/AI 题），记录里存 tab 与题目 id；
   * 恢复时若对应 tab 存在就切过去，找不到题目则只回填文本。
   * 编辑器 oninput 走 App.debounce(800ms) 自动落盘，提交/保存草稿/换题/切 tab/离开页面前 flush。
   */

  _memoTask() { return this._isSentenceTab() ? this.sentTask : this.curTask; },

  _memoTaskTitle(task) {
    const t = task || {};
    return String(t.title || t.prompt || t.en || t.cn || '').replace(/\s+/g, ' ').slice(0, 60);
  },

  /** 本次编辑会话的稳定 id：同一题连续输入只占 1 条；切题/提交后重置。 */
  _memoId() {
    if (!this._memo || !this._memo.id) {
      const t = this._memoTask() || {};
      this._memo = { id: 'wr::' + (t.id || 'none') + '::' + Date.now() + '::' + Math.random().toString(36).slice(2, 6) };
    }
    return this._memo.id;
  },

  _memoEntry(text) {
    const t = this._memoTask() || {};
    const value = String(text == null ? this.essay : text);
    return {
      id: this._memoId(),
      at: new Date().toISOString(),
      taskId: t.id == null ? '' : String(t.id),
      taskTitle: this._memoTaskTitle(t),
      tab: this.tab,
      mode: this.tab,       // 与翻译页的 mode 对齐，弹窗统一读 mode || tab
      dir: this._isSentenceTab() ? (this.trDir || 'en2cn') : '',
      text: value,
      chars: Array.from(value.replace(/\s+/gu, '')).length,
    };
  },

  /** 输入后调用：App.debounce 800ms 自动落盘 */
  _memoSoon(text) {
    this._memoPending = { sess: this._memoSess, entry: this._memoEntry(text) };
    if (!this._memoSaver) this._memoSaver = App.debounce(() => this._memoFlush(), 800);
    this._memoSaver();
  },

  /** 立即落盘（无待写内容时是空操作） */
  _memoFlush() {
    const pending = this._memoPending;
    if (!pending) return;
    this._memoPending = null;
    if (pending.sess !== this._memoSess) return;
    if (typeof Store === 'undefined' || !Store.rememberInput) return;
    Store.rememberInput('writing', pending.entry);
  },

  /** 结束本次编辑会话：切题/提交后下一次输入生成新记录 */
  _resetMemo() {
    this._memoSess++;
    this._memo = null;
    this._memoPending = null;
  },

  /** 离开页面前落盘（应用内换页 + 关闭/切后台） */
  _memoListen() {
    if (this._memoListening) return;
    this._memoListening = true;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const flush = () => {
      try { this._memoFlush(); }
      catch (e) { console.warn('写作输入记忆落盘失败', e); }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    window.addEventListener('hashchange', flush);
  },

  _memoTabLabel(tab) {
    return ({ task: '真题写作', sentence: '单句练习', translation: '考研翻译', ai: 'AI 练习题' })[tab] || '写作';
  },

  _memoTime(entry) {
    const d = new Date(entry && entry.at);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    const day = App.fmtDate(d);
    return (day === App.today() ? '今天 ' : day + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  /** 「🕘 最近记录」弹窗：最近 5 条，可恢复到编辑器（不自动提交） */
  _openMemo() {
    const self = this;
    const list = (typeof Store !== 'undefined' && Store.recentInputs) ? Store.recentInputs('writing') : [];
    const rows = list.map((e, i) => {
      const text = String(e.text || '');
      return `<div class="memo-item">
        <div class="mi-main">
          <div class="mi-meta">第 ${i + 1} 条 · ${esc(this._memoTime(e))} · ${esc(this._memoTabLabel(e.tab || e.mode))} · ${esc(e.taskTitle || '未命名题目')}</div>
          <div class="mi-txt" title="${esc(text)}">${esc(text.slice(0, 30))}${text.length > 30 ? '…' : ''}</div>
        </div>
        <button class="btn btn-xs btn-gh" data-memo="${i}">恢复</button>
      </div>`;
    }).join('');
    const body = (rows || '<div class="hint" style="padding:14px 2px">还没有记录：在输入区写作文或译文，会自动记住最近 5 条。</div>')
      + `<div class="row" style="margin-top:14px;justify-content:space-between;align-items:center">
        <span class="hint">只保留最近 5 条，保存在本机</span>
        <button class="btn btn-xs btn-warn" data-memo-clear="1"${list.length ? '' : ' disabled'}>清空记录</button>
      </div>`;
    App.modal('最近记录（写作）', body, b => {
      b.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-memo]');
        if (btn) { self._restoreMemo(list[+btn.dataset.memo]); return; }
        if (ev.target.closest('[data-memo-clear]')) self._clearMemo();
      });
    });
  },

  _clearMemo() {
    App.confirm('清空写作页的最近记录？只删这份列表，不影响已保存的作文和练习记录。', () => {
      Store.clearInputs('writing');
      App.closeModal();
      this._openMemo();
      App.toast('最近记录已清空', 'ok');
    });
  },

  /** 在对应题型里按 id 找题目；找不到返回 null（恢复时只回填文本） */
  _findMemoTask(tab, taskId) {
    if (!taskId) return null;
    const id = String(taskId);
    const W = (typeof Dict !== 'undefined' && Dict.content && Dict.content.writing) ? Dict.content.writing : { tasks: [] };
    const pools = [];
    if (tab === 'sentence') pools.push(this._sentencePool());
    else if (tab === 'ai') pools.push([this.curTask].filter(Boolean));
    else if (tab === 'translation') {
      pools.push(this._taskPool('translation'), (W.tasks || []).filter(t => this._isTranslationTask(t)));
    } else pools.push(this._taskPool('task'), W.tasks || []);
    for (const pool of pools) {
      const found = (pool || []).find(x => x && String(x.id) === id);
      if (found) return found;
    }
    return null;
  },

  /** 恢复：切 tab（能切则切）→ 回填文本；不自动提交 */
  _restoreMemo(entry) {
    if (!entry || typeof entry.text !== 'string') return;
    const known = ['task', 'sentence', 'translation', 'ai'];
    const tab = known.includes(entry.tab) ? entry.tab
      : known.includes(entry.mode) ? entry.mode : (this.tab || 'task');
    const task = this._findMemoTask(tab, entry.taskId);
    App.closeModal();
    /* 找得到题目才切 tab/方向/题目；找不到就只回填文本，不动当前题目 */
    if (task) {
      this.tab = tab;
      if (tab === 'sentence' && (entry.dir === 'en2cn' || entry.dir === 'cn2en')) this.trDir = entry.dir;
      if (tab === 'sentence') this.sentTask = task;
      else {
        this.curTask = task;
        // 旧筛选可能把目标题筛掉，恢复时回到「全部」并锁定该题
        this.sel = { level: 'all', year: 'all', session: 'all', no: 'id:' + task.id };
      }
    }
    this.essay = entry.text;
    this.result = null;
    this._imgs = [];
    this._memoSess++;
    this._memo = { id: entry.id };
    this._memoPending = null;
    this._shell($('#view'));
    if (!task) App.toast('没找到对应题目，只把文本填回了编辑器', 'warn');
    else App.toast('已恢复到编辑器，改完可再提交评分', 'ok');
  },


  _isTranslationTask(task) {
    return !!task && (task.writingType === 'translation'
      || /翻译|translation/i.test(`${task.examPart || ''} ${task.genre || ''}`));
  },

  _taskPool(tab = this.tab) {
    return (Dict.content.writing.tasks || []).filter(task => tab === 'translation'
      ? this._isTranslationTask(task) && task.mine && Picker.familyOf(task.level) === 'kaoyan'
      : !this._isTranslationTask(task));
  },

  _pickerMeta() {
    return {
      levelFilter: true, partById: true,
      families: ['cet4', 'cet6', 'kaoyan'],
      filterTitle: '按考试类型、年份、月份 / 英语一或英语二、篇目选择',
      hint: '依次选择考试类型、年份、月份或英语一 / 英语二，最后选择篇目；篇目仅显示当前题型内的题目，考研不按月份筛选。',
    };
  },

  _resetTaskState() {
    this._memoFlush();     // 切题/切 tab 前先记住当前文本
    this._resetMemo();
    clearInterval(this.timer);
    this.result = null; this.essay = ''; this._imgs = [];
    this.startAt = 0; this.left = 0; this.wState = 'idle'; this._usedSec = 0;
  },

  _inputCount() {
    return this.tab === 'translation' ? this.essay.replace(/\s/g, '').length
      : (this.essay.match(/[a-zA-Z']+/g) || []).length;
  },

  _openImporter() {
    Importer.open('writing', this.tab === 'translation'
      ? { type: 'kaoyan', session: this.sel && this.sel.session } : {});
  },

  _sentencePool() {
    const all = Dict.content.writing.sentenceTasks || [];
    return all.filter(x => x.level !== '考研' && x.exam !== 'kaoyan');
  },

  render(root) {
    const W = Dict.content.writing;
    if (!this.curTask) this.curTask = W.tasks[0];
    this._shell(root);
  },

  _shell(root) {
    root = App.freshView();
    const W = Dict.content.writing;
    const all = W.tasks;
    const isSentence = this._isSentenceTab();
    const isTranslation = this.tab === 'translation';
    const hasPicker = this.tab === 'task' || isTranslation;
    const partItems = this._taskPool();
    const sentencePool = isSentence ? this._sentencePool() : [];
    /* 计时状态机初始化：undefined 会让所有状态判断落空，
     * 导致"开始计时"按钮和时长下拉框都不渲染。 */
    if (!this.wState) this.wState = 'idle';
    if (!this.trDir) this.trDir = 'en2cn';

    const selection = this.sel || { level: 'all', year: 'all', session: 'all', no: 'all' };
    /* 自定义题目只存在于本次会话（没有入库），不在 Dict.content 里，
     * 所以 Picker.filter 必然筛掉它。这里把它并入候选列表，
     * 并按 id 精确匹配选中——否则填完题目会"跳回第一道真题"。*/
    if (this.curTask && String(this.curTask.id || '').startsWith('custom')) {
      partItems.push(this.curTask);
    }
    const list = Picker.filter(partItems, selection);
    if (hasPicker && !list.includes(this.curTask)) {
      //自定义题被筛掉时（筛选条件与"全部"不符）也要保留它，
      // 否则用户刚输入的题目会凭空消失
      const isCustom = this.curTask && String(this.curTask.id || '').startsWith('custom');
      this.curTask = isCustom ? this.curTask : (list[0] || null);
    }

    if (!hasPicker && !isSentence && !this.curTask) this.curTask = this._taskPool('task')[0] || null;
    if (isSentence && !sentencePool.includes(this.sentTask)) this.sentTask = sentencePool[0] || null;
    const task = isSentence ? this.sentTask : this.curTask;
    this.taskList = list;
    const outlineVisible = !!(this.result && !this.result.ocrFailed && !this.result.gradingFailed);
    const limit = isSentence ? 15 : (task && task.limit || (isTranslation ? 30 : 40));
    const expect = isSentence ? 20 : (task && task.expectScore || (isTranslation ? '未标注' : 30));
    const words = this._inputCount();

    root.innerHTML = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-nav="home">← 返回</button>
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>
      <div>
        <h1>写作 <span style="font-size:12px;color:var(--tx3);letter-spacing:2px">WRITING</span></h1>
        <div class="sub">多多练，写出更好的自己！</div>
      </div>
      <div class="phead-r">
        <!-- 计时状态机：idle（可选时间） → running（倒计时） → paused → finished（需归零） -->
        <div class="timer-box ${this.wState === 'paused' ? 'paused' : ''} ${this.wState === 'idle' ? 'idle' : ''} ${this.wState === 'finished' ? 'done' : ''}" id="wTimerBox" style="padding:6px 13px">
          <span style="color:var(--pri)"><svg viewBox="0 0 24 24" class="ic ic-sm"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
          <div>
            <div style="font-size:10.5px;color:var(--tx3)" id="wTimeLabel">${this._wLabel()}</div>
            <div class="t" style="font-size:17px" id="wTime">${App.mmss(this.left)}</div>
          </div>
          ${this.wState === 'running' || this.wState === 'paused' ? `
            <button class="btn btn-xs ${this.wState === 'paused' ? 'btn-ok' : 'btn-warn'}" id="btnWPause">
              ${this.wState === 'paused' ? '<svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>继续' : '<svg viewBox="0 0 24 24" class="ic ic-sm">❚❚</svg>暂停'}
            </button>
            <button class="btn btn-xs btn-gh" id="btnWStop" title="结束计时并锁定时间">■ 结束</button>`
        : this.wState === 'finished' ? `
            <button class="btn btn-xs btn-warn" id="btnWReset" title="归零后才能重新选择时间">↺ 归零</button>` : ''}
        </div>

        ${this.wState === 'idle' ? `
        <select class="inp" id="wLimit" style="width:auto;padding:7px 11px">
          ${[10, 15, 20, 30, 40, 60].map(t => `<option value="${t}"${t === limit ? ' selected' : ''}>${t} 分钟</option>`).join('')}
        </select>
        <button class="btn btn-ok btn-s" id="btnWStart"${task ? '' : ' disabled'}>▶ 开始计时</button>`
        : ''}

        <!-- 总分（可人工填写，留空则由 AI 依据题目来源估算） -->
        <span class="row" style="gap:5px">
          <span class="hint" style="font-size:12px">本题总分</span>
          <input class="inp" id="wTotal" type="number" min="1" step="1" style="width:70px;text-align:center"
            placeholder="AI估算" value="${Store.d.writing && Store.d.writing.totalScore ? Store.d.writing.totalScore : ''}" title="留空则由 AI 根据题目来源自动估算">
        </span>
      </div>
    </div>

    <div id="wrPicker">${hasPicker ? Picker.html({
      items: all, partItems, sel: selection, unitWord: '题', ...this._pickerMeta(),
    }) : ''}</div>

    <div class="read-type-tabs" role="tablist" aria-label="写作题型">
      ${[['task', '真题写作'], ['sentence', '单句练习'], ['translation', '考研翻译'], ['ai', 'AI 练习题']]
      .map(([k, t]) => {
        const count = k === 'sentence' ? this._sentencePool().length
          : k === 'task' || k === 'translation' ? Picker.filter(this._taskPool(k), { ...selection, no: 'all' }).length : null;
        return `<button class="read-type-tab ${this.tab === k ? 'on' : ''}" role="tab" aria-selected="${this.tab === k}" data-tab="${k}">${t}${count === null ? '' : ` <span>${count}</span>`}</button>`;
      }).join('')}
      <span class="sp"></span>
      <button class="btn btn-s btn-gh" data-act="customTask">✎ 自定义题目</button>
      <button class="btn btn-s btn-gh" data-act="import">📄 导入真题</button>
    </div>

    ${!task ? `<div class="card read-empty-type"><div class="card-b">
      <div class="read-empty-icon">📄</div>
      <h2>${isTranslation ? '导入考研英语翻译题' : '当前筛选条件下没有题目'}</h2>
      <p>${isTranslation ? '导入考研英语 PDF 后，AI 会自动核验翻译要求、原文完整性和卷别。按年份、英语一或英语二选择题目，再输入中文译文。' : '请选择其他考试范围，或导入包含当前题型的试卷。'}</p>
      <button class="btn btn-pri" data-act="import">${isTranslation ? '导入考研英语 PDF' : '导入真题'}</button>
    </div></div>` : `<div class="wr-layout">
      <div>
        ${isSentence ? `
        <!-- 单句练习：自主选择翻译方向 -->
        <div class="card">
          <div class="card-h">${this.tab === 'translation' ? '考研英语翻译练习' : '单句练习题'}
            <span class="r">
              <span class="seg" style="margin-right:6px">
                <button class="mini-tab ${this.trDir !== 'cn2en' ? 'on' : ''}" data-trdir="en2cn">英译汉</button>
                <button class="mini-tab ${this.trDir === 'cn2en' ? 'on' : ''}" data-trdir="cn2en">汉译英</button>
              </span>
              <button class="btn btn-xs btn-gh" data-act="nextTask">🔄 换一题</button>
            </span>
          </div>
          <div class="card-b">
            ${this.trDir === 'cn2en' ? `
              <div class="tr-dir-tip">把下面这句中文翻译成英文</div>
              <div style="font-size:17px;font-weight:600;line-height:1.8">${esc(task.cn)}</div>
              ${task.hint ? `<div class="tipbox" style="margin-top:12px"><b>写作提示</b><br>${esc(task.hint)}</div>` : ''}
            ` : `
              <div class="tr-dir-tip">把下面这句英文翻译成中文</div>
              <div style="font-size:17px;font-weight:600;line-height:1.7">${esc(task.en)}</div>
              <div class="tr-hidden">参考答案（点击显示）<span class="tr-cn">${esc(task.cn)}</span></div>
              ${task.hint ? `<div class="tipbox" style="margin-top:12px"><b>写作提示</b><br>${esc(task.hint)}</div>` : ''}
            `}
            <div class="hint" style="margin-top:10px">
              ${this.trDir === 'cn2en' ? '参考答案可在提交批改后对照' : '先自己翻，再点上面展开参考答案'}
            </div>
            <div class="row" style="margin-top:10px">
              <span class="tag tag-warn">${task.mine ? '我导入的题目' : String(task.id || '').startsWith('ai') ? 'AI 生成题目' : this.tab === 'translation' ? '考研仿真翻译题' : '内置单句练习'}</span>
              ${task.mine ? `<button class="btn btn-xs btn-warn" data-act="delTask">删除本题</button>` : ''}
            </div>
          </div>
        </div>` : `
        <div class="card">
          <div class="card-h">${isTranslation ? '考研英语翻译原文' : '作文题目'}
            <span class="tag tag-pri">${esc(task.level || '')}</span>
            ${task.typeVerification === 'ai-verified'
              ? `<span class="tag tag-ok" title="${esc((task.typeEvidence || []).join('；'))}">AI 核验类型</span>`
              : task.typeVerification ? '<span class="tag tag-warn">类型待核验</span>' : ''}
            <span class="tag tag-warn">${esc(task.genre || '')}</span>
            ${isTranslation ? `<span class="tag ${task.translationVerification && task.translationVerification.status === 'ai-verified' ? 'tag-ok' : 'tag-warn'}">${task.translationVerification && task.translationVerification.status === 'ai-verified' ? 'AI 已核验翻译原文' : '翻译原文待 AI 核验'}</span>` : ''}
            <span class="r"><button class="btn btn-xs btn-gh" data-act="nextTask">🔄 换一题</button></span></div>
          <div class="card-b">
            <div style="font-size:16px;font-weight:600;line-height:1.7;white-space:pre-wrap">${esc(task.prompt || task.title)}</div>
            <div style="color:var(--tx3);margin-top:6px;line-height:1.75">${esc(task.cn || '')}</div>
            ${task.outline && task.outline.length ? `<div class="writing-outline">
              <div class="sec-t">写作思路（仅供参考）</div>
              <div class="writing-outline-body ${outlineVisible ? '' : 'is-blurred'}">
                ${task.outline.map((o, i) => `<div style="font-size:13px;margin-bottom:4px">${i + 1}. ${esc(o)}</div>`).join('')}
              </div>
              ${outlineVisible ? '' : '<div class="writing-outline-lock">🔒 提交作文并开始批改后查看写作思路</div>'}
            </div>` : ''}
            <div class="hint" style="margin-top:10px">${isTranslation ? '请按原卷要求翻译，保留原题号；在下方输入中文译文。' : `建议不少于 ${task.minWords || 150} 词`} · 满分 ${expect} 分</div>
            <div class="row" style="margin-top:10px">
              <span class="tag ${task.mine ? 'tag-ok' : (String(task.id || '').startsWith('ai') ? 'tag-pri' : 'tag-warn')}">${task.mine ? '我导入的题目' : (String(task.id || '').startsWith('ai') ? 'AI 生成题目' : '内置仿真题（非真题原文）')}</span>
              ${task.year ? `<span class="tag">${fullLabel(task.year, task.session)} · 第 ${task.no} 题</span>` : ''}
              ${task.mine ? `<button class="btn btn-xs btn-warn" data-act="delTask">删除本题</button>` : ''}
            </div>
          </div>
        </div>`}

        <div class="card" style="margin-top:14px">
          <div class="card-h">写作输入
            <span class="r">
              <label class="row" style="font-size:12px;gap:6px;cursor:pointer">
                <span class="switch ${this.inkMode ? 'on' : ''}" id="swInk"></span>手写输入（电子笔）
              </label>
              <button class="btn btn-xs btn-gh" id="aiAssist">🤖 AI 辅助说明</button>
            </span></div>
          <div class="card-b">
            <div class="editor-tool">
              <button class="btn btn-xs btn-gh" data-fmt="bold"><b>B</b></button>
              <button class="btn btn-xs btn-gh" data-fmt="italic"><i>I</i></button>
              <button class="btn btn-xs btn-gh" data-fmt="underline"><u>U</u></button>
              <span style="width:1px;height:16px;background:var(--line2)"></span>
              <button class="btn btn-xs btn-gh" data-act="clear">🗑 清空</button>
              <button class="btn btn-xs btn-gh" data-act="pickImg" title="上传作文照片（手写作文或打印稿），由 AI 识别并评分">📷 拍照/上传</button>
              <input type="file" id="wImg" accept="image/*" capture="environment" multiple style="display:none">
              <button class="btn btn-xs btn-gh" data-act="save">💾 保存草稿</button>
              <button class="btn btn-xs btn-gh" data-act="memo" title="查看最近 5 条输入，可一键恢复到编辑器">🕘 最近记录</button>
              <span class="sp"></span>
              <span style="font-size:12px;color:var(--tx3)">${isTranslation ? '字数' : '词数'}：<b id="wCount" style="color:var(--tx)">${words}</b></span>
            </div>
            ${this.inkMode ? `
              <canvas class="ink-canvas" id="inkCanvas"></canvas>
              <div class="row" style="margin-top:8px">
                <label style="font-size:12.5px">笔色
                  <input type="color" id="inkColor" value="#1a2337" style="width:34px;height:24px;border:none;background:none;vertical-align:middle"></label>
                <label style="font-size:12.5px">粗细
                  <input type="range" id="inkW" min="1" max="6" value="2" style="width:80px;vertical-align:middle"></label>
                <button class="btn btn-xs btn-gh" data-act="undo">↶ 撤销</button>
                <button class="btn btn-xs btn-gh" data-act="inkClear">清除书写</button>
                <span class="sp"></span>
                <button class="btn btn-xs btn-pri" data-act="inkToText">✓ 转文字并提交</button>
              </div>
              <div class="hint">用鼠标 / 触控笔 / 手机手指在方框内书写。手写内容识别后会自动与文字稿合并。</div>
              <textarea class="editor" id="editor" style="margin-top:12px" placeholder="键盘输入区（可与手写内容合并）">${esc(this.essay)}</textarea>`
        : `<textarea class="editor" id="editor" placeholder="${isTranslation ? '在这里输入中文译文，可按原题号分段作答...' : '在这里输入你的作文...'}&#10;&#10;支持：电脑键盘输入 · 手机软键盘输入 · 手写输入（切换上方开关）">${esc(this.essay)}</textarea>`}
      ${(this._imgs && this._imgs.length) ? `
        <div class="w-imgs">
          <div class="wi-h">已上传 ${this._imgs.length} 张 ·将连同作文一起交给 AI 识别评分</div>
          <div class="wi-row">
            ${this._imgs.map((im, i) => `<div class="wi-item">
              <img src="${im.data}" alt="作文图片 ${i + 1}">
              <button class="wi-del" data-act="delImg" data-i="${i}" title="移除">✕</button>
            </div>`).join('')}
          </div>
        </div>` : ''}
            <div class="row" style="margin-top:12px;justify-content:flex-end">
              <button class="btn btn-gh" data-act="save">保存草稿</button>
              <button class="btn btn-pri btn-lg" data-act="grade">🚀 提交并评分</button>
            </div>
          </div>
        </div>
      </div>

      <div class="an-panel">
        <div class="card">
          <div class="card-h">AI 评分 <span class="r"><span class="tag ${AI.ready ? 'tag-ok' : 'tag-warn'}">${AI.ready ? 'AI 已启用' : isTranslation ? '请配置 AI 接口' : '本地规则模式'}</span></span></div>
          <div class="card-b" id="gradeBox">${this.result ? gradeHTML(this.result) : this._emptyGrade()}</div>
        </div>
        ${this.result && !this.result.ocrFailed && !this.result.gradingFailed ? `
        <div class="card" style="margin-top:14px">
          <div class="card-h">${isTranslation ? '参考译文' : '润色后版本（参考）'}
            <span class="r"><button class="btn btn-xs btn-gh" id="copyPolished">📋 复制</button></span></div>
          <div class="card-b">
            <div class="ex-item" style="line-height:1.9;font-size:13.5px">${esc(this.result.polished || '（AI 未返回范文）')}</div>
          </div>
        </div>` : ''}
      </div>
    </div>`}`;

    this._bind(root, task, isSentence);
    // 仅在已有计时状态时续跑；默认 idle 由用户点「开始计时」启动
    if (this.wState === 'running' || this.wState === 'paused') this._startTimer(this.limit);
  },

  _emptyGrade() {
    return `<div class="empty">
      <svg viewBox="0 0 24 24" class="ic"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>
      <p>写完后点击「提交并评分」<br>将获得：多维得分 · 总体评语 · 修改建议 · 词汇升级 · 高分范文</p>
    </div>`;
  },

  /** 自定义题目：手动录入一道题并直接开写
   *
   *  【为什么从标签页挪出来】
   *  原先是第 5 个 tab「自定义题目」，但它并不是一种"题型"——
   *  它是一个**入口**（填表→生成临时题目），和「导入真题」性质相同。
   *  混在题型标签里既挤占位置，也让人误以为它是第五种练习类型。
   *  现在移到标签栏右侧，与「导入真题」并列成操作按钮。*/
  _customTask() {
    this._memoFlush();
    this._resetMemo();
    // 切回真题写作视图，自定义题目沿用写作区的评分与输入
    this.tab = 'task';
    this._resetTaskState();
    App.modal('自定义题目', `
      <div class="fld"><label class="lab">题目（英文）</label>
        <textarea class="inp" id="cuT" placeholder="输入英文题目..."></textarea></div>
      <div class="fld"><label class="lab">题目要求（中文）</label>
        <input class="inp" id="cuC" placeholder="选填"></div>
      <div class="row" style="gap:8px">
        <div class="fld sp"><label class="lab">限时（分钟）</label><input class="inp" type="number" id="cuL" value="40"></div>
        <div class="fld sp"><label class="lab">满分</label><input class="inp" type="number" id="cuS" value="30"></div>
      </div>
      <button class="btn btn-pri btn-blk" id="cuOk">开始写作</button>`, b => {
      $('#cuOk', b).onclick = () => {
        const title = $('#cuT', b).value.trim();
        if (!title) { App.toast('请输入题目', ''); return; }
        this.curTask = {
          id: 'custom' + Date.now(), title, cn: $('#cuC', b).value,
          level: '自定义', genre: '自定义', limit: +$('#cuL', b).value || 40,
          expectScore: +$('#cuS', b).value || 30, minWords: 100,
        };
        // 选中筛选器里的"全部"，避免被年份/场次过滤掉而看不到题目
        this.sel = { level: 'all', year: 'all', session: 'all', no: `id:${this.curTask.id}` };
        App.closeModal();
        this._shell($('#view'));
      };
    });
  },

  _bind(root, task, isSentence) {
    clearInterval(this.timer);
    this._memoListen();   // 离开页面前把防抖窗口里的最后一次输入落盘
    on(root, 'click', '[data-nav]', (e, t) => { this._memoFlush(); App.go(t.dataset.nav); });
    on(root, 'click', '[data-tab]', (e, t) => {
      this._memoFlush();
      this._resetMemo();
      this.tab = t.dataset.tab;
      /* 「AI 练习题」不是"换一个 tab 看旧题"：当前还没有 AI 题时点进来，
       * 直接请求一道，否则会显示内置真题、让人以为 AI 出题没生效（走查发现）。*/
      if (this.tab === 'ai' && !(this.curTask && String(this.curTask.id || '').startsWith('ai'))) {
        this.sel = { ...(this.sel || {}), no: 'all' };
        this._resetTaskState();
        this._genTask();
        return;
      }
      if (this.tab === 'sentence') this.sentTask = this._sentencePool()[0] || null;
      this.sel = { ...(this.sel || { year: 'all', session: 'all' }), no: 'all' };
      if (this.tab === 'translation') this.sel = { ...this.sel, level: 'kaoyan', session: /english-[12]/.test(this.sel.session) ? this.sel.session : 'all' };
      this._resetTaskState();
      this._shell($('#view'));
    });

    // 年份 / 场次 / 题号筛选
    if (this.tab === 'task' || this.tab === 'translation') {
      Picker.bind(root, Dict.content.writing.tasks, this.sel || {}, s => {
        this.sel = s; this._resetTaskState();
        this.curTask = Picker.filter(this._taskPool(), s)[0] || null;
        this._shell($('#view'));
      }, { partItems: this._taskPool(), partById: true, unitWord: '题' });
    }

    if (!task) {
      on(root, 'click', '[data-act="import"]', () => this._openImporter());
      return;
    }

    const wpb = $('#btnWPause');
    if (wpb) wpb.onclick = () => this._togglePause();
    const wStart = $('#btnWStart');
    if (wStart) wStart.onclick = () => this._wStart();
    on(root, 'click', '[data-trdir]', (e, t) => {
      this.trDir = t.dataset.trdir;
      this.result = null;                 // 换方向后清掉旧批改
      this._shell($('#view'));
    });
    on(root, 'click', '.tr-hidden', (e, t) => t.classList.add('open'));

    // 写作图片上传：转 dataURL 存内存，提交时随作文一起给 AI
    const wi = $('#wImg');
    if (wi) wi.onchange = async () => {
      const selected = [...wi.files];
      wi.value = ''; // 同一张图片可再次选择
      if (!selected.length) return;
      this._imgs = this._imgs || [];
      const room = Math.max(0, 4 - this._imgs.length);
      if (!room) { App.toast('最多上传 4 张图片，请先移除已有图片', ''); return; }
      const files = selected.slice(0, room);
      const loaded = await Promise.all(files.map(async f => {
        try { return await readWritingImage(f); }
        catch (e) { return { error: e.message }; }
      }));
      const ok = loaded.filter(x => x && x.data);
      const failed = loaded.filter(x => x && x.error);
      this._imgs = this._imgs.concat(ok).slice(0, 4);
      this._shell($('#view'));
      const msg = `${ok.length} 张图片已压缩并添加${failed.length ? `；${failed.length} 张失败：${failed.map(x => x.error).join('、')}` : ''}${selected.length > room ? '；最多保留 4 张' : ''}`;
      App.toast(msg, failed.length ? 'err' : 'ok');
    };
    const wStop = $('#btnWStop');
    if (wStop) wStop.onclick = () => this._wStop();
    const wReset = $('#btnWReset');
    if (wReset) wReset.onclick = () => this._wReset();
    // 本题总分：人工填写优先，留空则 AI 估算
    const wt = $('#wTotal');
    if (wt) wt.onchange = () => {
      const v = +wt.value;
      Store.d.writing = Store.d.writing || {};
      Store.d.writing.totalScore = v > 0 ? v : null;
      Store.flush();
    };

    const ed = $('#editor');
    if (ed) {
      const updateCount = App.debounce(() => {
        const c = $('#wCount');
        if (c) c.textContent = this._inputCount();
      }, 250);
      ed.oninput = () => {
        this.essay = ed.value;         // 立即同步：记忆与离开页面都读这个值
        updateCount();
        this._memoSoon(ed.value);      // 800ms 防抖自动记忆，最多保留最近 5 条
      };
    }

    on(root, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'memo') { this._openMemo(); return; }
      if (a === 'grade') {
        if (this.inkMode && $('#inkCanvas') && !_ink?.isEmpty()) {
          const hand = await inkRecognize();
          if (hand) {
            this.essay = (this.essay ? this.essay + '\n' : '') + hand;
            const ed = $('#editor'); if (ed) ed.value = this.essay;
          }
        }
        this.essay = ($('#editor') ? $('#editor').value : this.essay).trim();
        this._memoSoon(this.essay);   // 手写识别/图片合并进来的文字也参与「最近记录」
                // 有图片时允许纯图片提交（手写作文拍照即可）
        if (!this.essay && !(this._imgs && this._imgs.length)) {
          App.toast('请先写作文内容，或上传作文照片', ''); return;
        }
        await this._grade(task, isSentence);
      } else if (a === 'pickImg') {
        const inp = $('#wImg'); if (inp) inp.click();
      } else if (a === 'delImg') {
        const i = +t.dataset.i;
        this._imgs = (this._imgs || []).filter((_, k) => k !== i);
        this._shell($('#view'));
      } else if (a === 'clear') {
        this._memoFlush();
        this._resetMemo();
        this.essay = ''; if ($('#editor')) $('#editor').value = '';
        this._imgs = [];
        if ($('#inkCanvas')) inkReset();
        $('#wCount').textContent = '0';
        this.result = null; this._shell($('#view'));
      } else if (a === 'aiTest') {
        // 直接跑一次连通性测试，把真实错误显示出来
        App.toast('正在测试…', '');
        const r = await AI.test();
        App.toast(r.msg, r.ok ? 'ok' : 'err');
      } else if (a === 'toSetting') {
        App.go('settings');
      } else if (a === 'save') {
        this.essay = $('#editor') ? $('#editor').value : this.essay;
        this._memoSoon(this.essay);
        this._memoFlush();             // 保存草稿时一并把当前文本记进最近记录
        Store.d.writeLog.unshift({
          id: Date.now(), at: new Date().toISOString(), task: task.title || task.en,
          level: task.level || '练习', words: (this.essay.match(/[a-zA-Z']+/g) || []).length,
          text: this.essay, score: this.result ? this.result.score.total : null,
        });
        Store.d.writeLog = Store.d.writeLog.slice(0, 60);
        Store.flush();
        App.toast('草稿已保存到本地', 'ok');
      } else if (a === 'import') {
        this._openImporter();
      } else if (a === 'delTask') {
        if (!task.mine) { App.toast('内置仿真题不可删除', ''); return; }
        App.confirm(`删除「${(task.title || '').slice(0, 30)}…」？此操作不可撤销。`, () => {
          this._memoFlush();
          this._resetMemo();
          const arr = Dict.content.writing.tasks;
          const i = arr.indexOf(task);
          if (i >= 0) arr.splice(i, 1);
          Importer.unmarkMine('writing', task.id);
          this.curTask = arr[0];
          this.sel = { ...(this.sel || {}), no: 'all' };
          this._resetTaskState();
          this._shell($('#view'));
          App.toast('已删除', 'ok');
        });
      } else if (a === 'customTask') {
        this._customTask();
      } else if (a === 'nextTask') {
        this._memoFlush();
        this._resetMemo();
        this.result = null; this.essay = '';
        if (isSentence) {
          const arr = this._sentencePool();
          if (!arr.length) { App.toast('当前没有可用的翻译练习题', ''); return; }
          this.sentTask = arr[(arr.indexOf(this.sentTask || arr[0]) + 1) % arr.length];
        } else if (this.tab === 'ai') {
          await this._genTask();
          return;
        } else {
          const arr = Picker.filter(this._taskPool(), { ...(this.sel || { level: 'all', year: 'all', session: 'all' }), no: 'all' });
          if (!arr.length) return;
          const i = arr.findIndex(x => x.id === this.curTask.id);
          this.curTask = arr[(i + 1) % arr.length];
          this.sel = { ...(this.sel || { level: 'all', year: 'all', session: 'all' }), no: `id:${this.curTask.id}` };
        }
        this._shell($('#view'));
      }
      else if (a === 'undo') inkUndo();
      else if (a === 'inkClear') inkReset();
      else if (a === 'inkToText') {
        const hand = await inkRecognize();
        if (!hand) return;
        this.essay = (this.essay ? this.essay + '\n' : '') + hand;
        $('#editor').value = this.essay;
        this._memoSoon(this.essay);
        inkReset();
        App.toast('已合并到文字稿', 'ok');
      }
    });

    // 格式按钮
    on(root, 'click', '[data-fmt]', (e, t) => {
      const ed = $('#editor');
      if (!ed) return;
      const f = t.dataset.fmt;
      const s = ed.selectionStart, en = ed.selectionEnd;
      const sel = ed.value.slice(s, en) || 'text';
      const wrap = { bold: '**', italic: '_', underline: '__' }[f];
      ed.value = ed.value.slice(0, s) + wrap + sel + wrap + ed.value.slice(en);
      this.essay = ed.value;
      this._memoSoon(ed.value);
      ed.focus();
    });

    const sw = $('#swInk');
    if (sw) sw.onclick = () => { this.inkMode = !this.inkMode; this._shell($('#view')); };
    const ab = $('#aiAssist');
    if (ab) ab.onclick = () => App.modal('AI 辅助说明', `
      <p style="line-height:1.85">写作模块的 AI 功能包括：</p>
      <ul style="line-height:2;margin:10px 0 0 18px">
        <li><b>评分</b>：内容完整性 / 逻辑结构 / 语言表达 / 词汇语法四维打分</li>
        <li><b>修改建议</b>：结构建议、语言润色、词汇升级、句式优化</li>
        <li><b>范文</b>：给出润色后的完整版本</li>
      </ul>
      <div class="tipbox" style="margin-top:14px">${AI.ready
        ? '当前 AI 已启用，评分与建议由 AI 生成。'
        : '当前使用本地规则评分（基于词数、句长、连接词、词汇多样性等指标），启用 AI 后精度大幅提升。请在「设置」页填写 API Key。'}</div>
      <button class="btn btn-pri btn-blk" id="aaOk" style="margin-top:14px">知道了</button>`, b => { $('#aaOk', b).onclick = App.closeModal; });

    if (this.inkMode && $('#inkCanvas')) {
      inkInit($('#inkCanvas'), {
        color: () => $('#inkColor').value,
        width: () => +$('#inkW').value,
      });
      $('#inkColor').oninput = () => inkSetColor($('#inkColor').value);
      $('#inkW').oninput = () => inkSetWidth(+$('#inkW').value);
    }

    const cp = $('#copyPolished');
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(this.result.polished); App.toast('已复制', 'ok'); }
      catch (e) { App.toast('复制失败，请手动选择', 'err'); }
    };
  },

  async _grade(task, isSentence) {
    this._memoFlush();    // 提交前把当前作文/译文落盘
    this._resetMemo();    // 提交后继续输入算新的一条
    const box = $('#gradeBox');
    const imgs = this._imgs || [];
    const hasImg = imgs.length > 0;
    const isExamTranslation = this.tab === 'translation';
    box.innerHTML = `<div class="row" style="justify-content:center;padding:30px"><span class="spin"></span>
      <span class="dots">${hasImg ? 'AI 正在识别图片并评分' : isExamTranslation ? 'AI 正在检查中文译文并评分' : (AI.ready ? 'AI 正在批改' : '本地规则评分中')}</span></div>`;
    const isTr = this._isSentenceTab();
    const dir = this.trDir === 'cn2en' ? 'cn2en' : 'en2cn';
    const prompt = isTr
      ? (dir === 'cn2en'
        ? `将下面的中文句子翻译成英文（汉译英练习）：\n${task.cn}`
        : `将下面的英文句子翻译成中文（英译汉练习）：\n${task.en}`)
      : task.prompt || task.title;

    // 总分：人工填写优先，否则 AI 依据题目来源估算
    const manual = Store.d.writing && Store.d.writing.totalScore;
    let totalScore = manual > 0 ? manual : (task.expectScore > 0 ? task.expectScore : null);
    if (!totalScore) {
      totalScore = await AI.estimateTotalScore({
        level: task.level, genre: task.genre, title: task.title || prompt,
      });
    }

    let r;
    try {
      r = isExamTranslation ? await AI.gradeTranslation(task, this.essay, imgs, totalScore)
        : hasImg ? await AI.gradeWritingImages(prompt, this.essay, imgs, totalScore)
          : await AI.gradeWriting(prompt, this.essay);
    } catch (e) {
      App.toast('评分失败：' + (e.message || e).slice(0, 60), 'err');
      r = isExamTranslation ? { gradingFailed: true, errMsg: '翻译批改未完成：' + String(e.message || e).slice(0, 220) } : null;
    }
    if (r && (r.ocrFailed || r.gradingFailed)) {
      // 图片没有识别出作文时不计入学习统计，也不伪造 0 分作文记录。
      this.result = r;
      this._usedTotal = totalScore;
      this._shell($('#view'));
      return;
    }
    /* 用本题总分覆盖 AI 给的满分。
     * 【顺序陷阱】原来先写 r.score.max = totalScore，再算 ratio，
     * 于是分母用的是新满分、分子还是旧满分 → ratio 被放大，
     * 出现「18/15」这种得分超过满分的情况。
     * 正确顺序：先用**原满分**算得分率，再等比缩放到本题满分，并夹在满分以内。*/
    if (r && r.score) {
      const oldMax = +r.score.max || 30;          // AI 自报的满分
      const oldTotal = +r.score.total || 0;
      const newMax = +totalScore || oldMax;
      if (newMax > 0 && oldMax > 0) {
        // 得分率夹在0~1，防止 AI 给出 >1 的异常比例
        const ratio = Math.max(0, Math.min(1, oldTotal / oldMax));
        r.score.total = Math.round(ratio * newMax * 10) / 10;
      }
      r.score.max = newMax;
    }
    // 用照片 OCR 正文或输入框正文校验完整度，约束 AI/本地评分的虚高下限。
    // 句子翻译练习不套用作文篇幅规则。
    if (r && !isSentence && !isExamTranslation) {
      capIncompleteEssayScore(r, r.ocrText || this.essay, task.minWords || 150);
    }
    this.result = r;
    this._usedTotal = totalScore;
    Store.addStat('write', 1);
    Store.d.writeLog.unshift({
      id: Date.now(), at: new Date().toISOString(), task: prompt,
      level: task.level || '练习', words: (this.essay.match(/[a-zA-Z']+/g) || []).length,
      text: this.essay, score: r && r.score ? r.score.total : 0,
      max: totalScore, usedSec: this._usedSec || 0, hasImg,
    });
    Store.d.writeLog = Store.d.writeLog.slice(0, 60);
    Store.flush();
    // 记录时长与得分率（写作用得分率折算），供树园评估当日成长质量
    Store.logActivity({
      kind: 'write', seconds: this._pageSeconds(),
      correct: r && r.score ? r.score.total : 0, total: totalScore,
    });
    this._shell($('#view'));
    this._bindGradeTabs();
  },

  /** 本模块停留秒数（累计多次进出） */
  _pageSeconds() {
    this._accSeconds = (this._accSeconds || 0) + App.pageSeconds();
    App.resetPageTimer();
    return this._accSeconds;
  },

  /** 评分结果内的建议分类页签（综合/结构/语言/词汇升级/句式） */
  _bindGradeTabs() {
    const box = $('#gradeBox');
    if (!box) return;
    on(box, 'click', '[data-sug]', (e, t) => {
      const k = t.dataset.sug;
      $$('[data-sug]', box).forEach(x => x.classList.toggle('on', x === t));
      const sb = $('#sugBox', box);
      if (sb) sb.innerHTML = sugHTML(this.result, k);
      on(sb, 'click', '[data-say]', (ev, el) => Speech.speak(el.dataset.say, { rate: .85 }));
    });
    const first = $('[data-sug="all"]', box);
    if (first) first.classList.add('on');
  },

  async _genTask() {
    App.modal('AI 出题', `<div class="row" style="justify-content:center;padding:30px"><span class="spin"></span> <span class="dots">正在出题</span></div>`);
    const lv = ['CET-6', 'CET-4'][Math.floor(Math.random() * 2)];
    const d = await AI.genWritingTask(lv);
    App.closeModal();
    this._memoFlush();
    this._resetMemo();
    this.curTask = Object.assign({ id: 'ai' + Date.now(), level: lv }, d);
    this.result = null; this.essay = '';
    this._shell($('#view'));
  },

  _startTimer(limit) {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.wState !== 'running') return;      // 只有running 才递减
      this.left--;
      const d = $('#wTime');
      if (d) d.textContent = App.mmss(this.left);
      if (this.left <= 0) {
        clearInterval(this.timer);
        this.wState = 'finished';
        this._usedSec = limit * 60;
        App.toast('时间到', 'err');
        this._shell($('#view'));
      }
    }, 1000);
  },

  /* ---------- 计时状态机 ----------
   * idle（可选时间）→ 点开始 → running（倒计时）
   *   → 暂停 paused / 继续 running → 点结束 → finished（锁定）
   *   → 点归零 → idle（才能重新选时间）
   */
  _wLabel() {
    return {
      idle: '未开始', running: '写作中',
      paused: '已暂停', finished: '已结束',
    }[this.wState || 'idle'];
  },

  /** 开始计时（仅 idle 可点） */
  _wStart() {
    if (this.wState && this.wState !== 'idle') return;
    const sel = $('#wLimit');
    const limit = sel ? +sel.value : (this.limit || 30);
    this.limit = limit;
    this.left = limit * 60;
    this.wState = 'running';
    this._usedSec = 0;
    this._startTimer(limit);
    this._shell($('#view'));
    App.toast(`开始计时：${limit} 分钟`, 'ok');
  },

  /** 暂停 / 继续 */
  _togglePause() {
    if (this.wState !== 'running' && this.wState !== 'paused') return;
    this.wState = this.wState === 'running' ? 'paused' : 'running';
    const d = $('#wTime'), label = $('#wTimeLabel'), box = $('#wTimerBox');
    if (d) d.textContent = App.mmss(this.left);
    if (label) label.textContent = this._wLabel();
    if (box) {
      box.classList.toggle('paused', this.wState === 'paused');
      box.classList.remove('idle', 'done');
    }
    const btn = $('#btnWPause');
    if (btn) {
      btn.className = 'btn btn-xs ' + (this.wState === 'paused' ? 'btn-ok' : 'btn-warn');
      btn.innerHTML = this.wState === 'paused'
        ? '<svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>继续'
        : '<svg viewBox="0 0 24 24" class="ic ic-sm">❚❚</svg>暂停';
    }
    App.toast(this.wState === 'paused' ? '计时已暂停' : '继续计时', this.wState === 'paused' ? '' : 'ok');
  },

  /** 结束计时：停止并锁定，必须归零才能改时间 */
  _wStop() {
    if (this.wState !== 'running' && this.wState !== 'paused') return;
    clearInterval(this.timer);
    this._usedSec = (this.limit * 60) - this.left;
    this.wState = 'finished';
    this._shell($('#view'));
    App.toast(`计时结束，实际用时 ${App.mmss(this._usedSec)}。要重新计时请点「归零」。`, 'ok');
  },

  /** 归零：回到可选时间的状态 */
  _wReset() {
    clearInterval(this.timer);
    this.wState = 'idle';
    this.left = (this.limit || 30) * 60;
    this._usedSec = 0;
    this._shell($('#view'));
    App.toast('已归零，可以重新选择时间', '');
  },
};

/* ---------- 评分结果渲染 ---------- */
function gradeHTML(r) {
  if (r && r.gradingFailed) return `<div class="ai-warn"><b>翻译暂未评分</b>
    <div class="ai-warn-msg">${esc(r.errMsg || '请重试翻译批改。')}</div>
    <button class="btn btn-xs btn-gh" data-act="grade" style="margin-top:8px">重试批改</button></div>`;
  if (r && r.ocrFailed) return `
    <div class="ai-warn">
      <b>照片未识别，暂未评分</b>
      <div class="ai-warn-msg">${esc(r.errMsg || '当前模型没有返回图片识别结果。请换用支持图片输入的视觉模型，或先把识别出的文字填入作文框。')}</div>
      <button class="btn btn-xs btn-gh" data-act="grade" style="margin-top:8px">重试识别</button>
    </div>`;
  const s = r.score || {};
  const max = +s.max || 30;
  const total = Math.max(0, Math.min(max, +s.total || 0));   // 夹在满分以内

  /* 四维按本题满分等比分配，且**总和严格等于总分**。
   * 原来维度满分硬编码 /15，当本题满分是 20 时就会出现
   *「总分18/20 但维度显示 3/15+11/15+…」这种对不上的情况。*/
  const labels = r.translationDirection === 'cn2en' ? ['语义准确性', '信息完整性', '英文通顺度', '语法与表达']
    : r.translation ? ['语义准确性', '信息完整性', '中文通顺度', '术语与表达']
    : ['内容完整性', '逻辑结构', '语言表达', '词汇语法'];
  const RAW = ['TR', 'CC', 'LR', 'GRA'].map((key, i) => [labels[i], +s[key] || 0]);
  const rawSum = RAW.reduce((a, x) => a + x[1], 0);
  // 每维满分 = max/4；实际得分按 rawSum 的比例映射到 total，保证 sum === total
  const perMax = max / 4;
  const dims = RAW.map(([n, v], i) => {
    const val = rawSum > 0 ? (v / rawSum) * total : 0;
    return [n, Math.round(val * 10) / 10];
  });
  // 修正四舍五入误差：把差值补到最高分项
  const dimSum = dims.reduce((a, x) => a + x[1], 0);
  if (dims.length && Math.abs(dimSum - total) > 0.001) {
    let mi = 0;
    dims.forEach((x, i) => { if (x[1] > dims[mi][1]) mi = i; });
    dims[mi][1] = Math.round((dims[mi][1] + (total - dimSum)) * 10) / 10;
  }

  const pct = max > 0 ? total / max : 0;
  return `
  <div style="display:flex;align-items:center;gap:18px;margin-bottom:16px">
    <div class="score-ring" style="position:relative">
      ${App.ring(pct, 110, pct >= .8 ? 'var(--ok)' : pct >= .6 ? 'var(--pri)' : 'var(--warn)')}
      <div class="txt"><b>${total}</b><span>/ ${max} 分</span></div>
    </div>
    <div style="flex:1">
      <div class="hint" style="margin:-4px 0 8px">本题满分 ${max} 分，得 ${total} 分（得分率 ${Math.round(pct * 100)}%）</div>
      ${dims.map(([n, v]) => `
        <div class="dim-row"><span class="n">${n}</span>
          <span class="bar"><i style="width:${Math.round((v / perMax) * 100)}%"></i></span>
          <span class="s">${v} / ${Math.round(perMax * 10) / 10}</span></div>`).join('')}
    </div>
  </div>
  <div class="sec-t">总体评价</div>
  ${r.imageWarning ? `<div class="ai-warn"><b>照片未用于本次评分</b><div class="ai-warn-msg">${esc(r.imageWarning)}</div></div>` : ''}
  ${r.degraded ? `<div class="ai-warn">
    <b>${AI.ready ? 'AI 调用失败' : '未启用 AI'}</b>
    <div class="ai-warn-msg">${esc(r.errMsg || (AI.ready ? '请求未能完成，请到设置页点「测试连接」查看详情。' : '本次为本地规则评分，精度有限。可在设置页填入 API Key。'))}</div>
    ${AI.ready ? '<button class="btn btn-xs btn-gh" data-act="aiTest" style="margin-top:6px">测试 AI 连接</button>' : '<button class="btn btn-xs btn-gh" data-act="toSetting" style="margin-top:6px">去设置页</button>'}
  </div>` : ''}
  <div style="font-size:13.5px;line-height:1.8;color:var(--tx2)">${esc(r.comment || '')}</div>
  <div class="sec-t">修改建议</div>
  <div class="seg" style="margin-bottom:11px">
    ${[['all', '综合'], ['structure', '结构'], ['language', '语言'], ['vocab', '词汇升级'], ['grammar', '句式']]
      .map(([k, t]) => `<button class="mini-tab" data-sug="${k}">${t}</button>`).join('')}
  </div>
  <div id="sugBox">${sugHTML(r, 'all')}</div>`;
}
function sugHTML(r, tab) {
  const s = r.suggestions || {};
  const list = [];
  if (tab === 'all') {
    (s.structure || []).forEach(x => list.push(['结构', x]));
    (s.language || []).forEach(x => list.push(['语言', x]));
  } else if (tab === 'structure') (s.structure || []).forEach(x => list.push(['结构', x]));
  else if (tab === 'language') (s.language || []).forEach(x => list.push(['语言', x]));
  else if (tab === 'vocab') return (s.vocab || []).map((v, i) => {
    const fix = v.better || v.fix || '';
    return `<div class="sug-item"><span class="n">${i + 1}</span>
      <div class="vocab-cmp">
        <span class="old">${esc(v.origin || '')}</span><span class="arw">→</span><span class="new">${esc(fix)}</span>
        ${fix ? `<span class="sp"></span><button class="btn btn-xs btn-gh" data-say="${esc(fix)}">🔊</button>` : ''}
      </div>
      <div class="hint">${esc(v.why || '')}</div></div>`;
  }).join('') || '<div class="hint">暂无词汇建议</div>';
  else if (tab === 'grammar') return (s.grammar || []).map((v, i) => {
    /* 不同来源的模型返回字段不统一（better / fix 都可能出现），
     * 两者都读，避免出现"箭头后面空白"。*/
    const fix = v.fix || v.better || '';
    return `<div class="sug-item"><span class="n">${i + 1}</span>
      <div class="vocab-cmp">
        <span class="old">${esc(v.origin || '')}</span><span class="arw">→</span><span class="new">${esc(fix)}</span>
        ${fix ? `<span class="sp"></span><button class="btn btn-xs btn-gh" data-say="${esc(fix)}">🔊</button>` : ''}
      </div>
      <div class="hint">${esc(v.why || '')}</div></div>`;
  }).join('') || '<div class="hint">暂无语法建议</div>';

  return list.map(([tag, x], i) => `<div class="sug-item"><span class="n">${i + 1}</span>
    <span class="tag tag-pri">${tag}</span> ${esc(x)}</div>`).join('') || '<div class="hint">暂无建议</div>';
}
window.ViewWrite = ViewWrite;
/* 导出给翻译模块复用：翻译的评分结果结构与写作完全一致
 * （score.{total,max,TR,CC,LR,GRA} + translation 标记切换维度名），
 * 与其复制一份渲染逻辑，不如共用同一份——两处各改一半必然对不上。*/
window.gradeHTML = gradeHTML;
window.sugHTML = sugHTML;
