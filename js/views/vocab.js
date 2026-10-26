/* ============ views/vocab.js : 单词模块 ============ */
const ViewVocab = {
  book: null,
  queue: [],
  qi: 0,
  mode: 'smart',       // smart | new | review | random | spell
  phase: 'card',       // card | choice | detail | spell
  revealed: false,
  testState: null,

  async render(root, params) {
    let bookId = params.book || Store.d.activeBook;
    /* 【词书下架保护】词书列表变了（某本词书已下架）而存档里还记着旧 id 时，
     * 直接 Dict.load 会查不到词书、页面空白。这里回落到第一本可用词书。*/
    if (typeof BOOKS !== 'undefined' && Array.isArray(BOOKS) && !BOOKS.some(b => b.id === bookId)) {
      bookId = (BOOKS[0] && BOOKS[0].id) || 'cet6';
      App.toast('原词书已不在列表中，已切换到 ' + (bk0name(bookId) || bookId), '');
    }
    this.book = await Dict.load(bookId);
    Store.d.activeBook = bookId; Store.flush();
    this._renderShell(root);
  },

  /* ---------- 词书选择面板 ---------- */
  _renderShell(root) {
    root = App.freshView();
    const b = this.book;
    const prog = Store.bookProgress(b.id);
    const pct = prog.total ? Math.round(prog.learned / prog.total * 100) : 0;
    const dayN = Store.d.settings.dailyNew;
    /* 【今日新词按"真正学过的新词"统计】原来取 stats.daily.words，
     * 那里把复习/抽检/拼写答对也算进去 → 目标提前显示完成。*/
    const todayNew = this._dailyNewUsed(true);
    /* 目标已完成 ≠ 不能继续学新词：目标只决定"先补满多少"，之后进入加学（见引擎 _selectSlots）。
     * 复习是独立入口（到期词/遗忘曲线），不能被"日目标完成"顶替（2026-10-23 用户追加要求）。*/
    const goalDone = dayN > 0 && todayNew >= dayN;
    const dailyLeft = Math.max(0, dayN - todayNew);
    const recs = Store.d.srs[b.id] || {};
    const remainingNew = b.words.filter(w => !recs[w.w] || !recs[w.w].reps).length;
    /* 【2026-10-17】"还有没有新词可学"必须按引擎的实际状态算：定级/跳过可能把整本词书的生词
     * 直接并入 L1/L3 复习池，这时 srs 镜像里虽然还有没 reps 的词，引擎却已经没有 L0 可教了。
     * 用引擎口径决定按钮文案，避免出现"点开始学习却提示今天任务已完成"的困惑。*/
    const E = this._engine();
    const engineNewLeft = E ? this._engineNewLeft() : null;
    const newLeft = engineNewLeft != null ? engineNewLeft : remainingNew;
    /* 【恢复新词】没新词时看看还剩多少"能救回来"的词：引擎里从未真正作答过
     * （levelAttempts === 0）却被定级/旧迁移写成了 L1+。>0 时主按钮改成"恢复新词"，
     * 点击后调用 VocabEngine.releaseUnlearned() 把它们放回 L0。*/
    const recoverable = !newLeft ? this._engineRecoverable() : 0;
    /* "剩余 N 词 / N 天学完"要和按钮同一口径：引擎在用时以引擎为准，
     * srs 镜像可能还留着旧标熟记录（撤销后面包屑不一致）。*/
    const remainingForPlan = engineNewLeft != null ? engineNewLeft : remainingNew;
    /* 每轮新词数 = min(引擎每轮上限 10, 本词书剩余新词, 今日目标剩余额度)。
     * 例：目标 30 → 每轮 10、10、10 三轮到量；目标 5 → 一轮 5 个。*/
    const capPerRound = (E && E.CONFIG.NEW_PER_ROUND.max) || 10;
    const newPerRound = Math.max(1, goalDone
      ? Math.min(capPerRound, newLeft || 1)                       // 目标完成：继续加学，每轮 ≤10
      : Math.min(capPerRound, newLeft || 1, dailyLeft || 1));     // 未完成：先补满今日目标
    const estimatedDays = Math.ceil(remainingForPlan / Math.max(1, dayN));
    const dueList = this._dueWords();
    const skipInfo = Store.skipInfo(b.id);

    root.innerHTML = `
    <div class="phead">
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M4 5a2 2 0 012-2h9a2 2 0 012 2v14a2 2 0 00-2-2H6a2 2 0 00-2 2V5z"/><path d="M20 5a2 2 0 00-2-2h-1v16h1a2 2 0 012 2V5z"/></svg></div>
      <div>
        <h1>单词 <span style="font-size:12px;color:var(--tx3);letter-spacing:2px">VOCABULARY</span></h1>
        <div class="sub">积累词汇，夯实研究生英语基础。</div>
      </div>
      <div class="phead-r">
        <select class="inp" id="bookSel" style="width:auto;min-width:170px">
          ${BOOKS.map(x => `<option value="${x.id}"${x.id === b.id ? ' selected' : ''}>${x.name}</option>`).join('')}
        </select>
        <button class="btn btn-gh btn-s" data-act="test">词汇量测试</button>
        <button class="btn btn-gh btn-s" data-act="settings">学习设置</button>
      </div>
    </div>

    <div class="vocab-hero">
      <div class="card" style="display:flex;align-items:center;gap:20px;padding:20px">
        <div style="width:92px;height:92px;border-radius:20px;background:linear-gradient(135deg,#4f86ff,#6f5bff);
          color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none">
          <span style="font-size:22px;font-weight:800">${prog.learned}</span>
          <span style="font-size:11px;opacity:.85">/ ${b.total}</span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:750;margin-bottom:3px">${bk0name(b)}</div>
          <div class="bar" style="margin:8px 0 9px"><i style="width:${Math.min(100, pct)}%"></i></div>
          <div class="row" style="font-size:12.5px;color:var(--tx3);gap:16px">
            <span>已掌握 <b style="color:var(--ok)">${prog.mastered}</b></span>
            <span>待复习 <b style="color:var(--warn)">${dueList.length}</b></span>
            <span>覆盖率 ${pct}%</span>
            ${prog.skipped ? `<span>已跳过 <b style="color:var(--purple)">${prog.skipped}</b></span>` : ''}
          </div>
          ${skipInfo.liveSkipped ? `
          <div class="tipbox" style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="flex:1;min-width:180px">
              词汇量测试已跳过 <b>${skipInfo.liveSkipped}</b> 个基础词（词频低于 ${skipInfo.last ? skipInfo.last.threshold : '—'}）。
              这些词已标为熟，不会占用每日新词名额，但仍会按遗忘曲线复习。
            </span>
            <button class="btn btn-xs btn-gh" data-act="adjustSkip">调整跳过范围</button>
          </div>` : ''}
        </div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:13px;color:var(--tx2);font-weight:650;margin-bottom:10px">今日学习</div>
        <div class="grid g2" style="gap:10px">
          <div class="stat" style="padding:10px 12px"><div class="k">今日新词</div>
            <div class="v" style="font-size:20px">${todayNew}<small style="font-size:12px;color:var(--tx3)"> / ${dayN}</small></div></div>
          <div class="stat" style="padding:10px 12px"><div class="k">今日复习</div><div class="v" style="font-size:20px">${dueList.length}</div></div>
        </div>
        <div class="row" style="margin-top:10px;gap:8px;align-items:center;flex-wrap:wrap">
          <label for="dailyNewGoal" style="font-size:12px;color:var(--tx2);white-space:nowrap">每日新词目标</label>
          <input class="inp" id="dailyNewGoal" type="number" min="5" max="200" step="1" value="${dayN}"
            aria-label="每日新词目标" style="width:86px;padding:7px 9px">
          <span class="hint" id="dailyPlanEstimate">${remainingForPlan ? (dailyLeft ? `今日还可学 ${dailyLeft} 个新词 · 本词书剩余 ${remainingForPlan} 词，约 ${estimatedDays} 天学完` : `今日 ${dayN} 个新词目标已完成${todayNew > dayN ? `（已加学 ${todayNew - dayN} 个）` : ''} · 可继续加学新词，或去「复习单词」`) : '本词书的新词已学完'}</span>
        </div>
      </div>
    </div>

    ${this._engineMasteryCard()}

    <div class="grid g2">
      <div class="big-card">
        <div class="ill">Aa</div>
        <div>
          <h2>新单词</h2>
          <p>${newLeft
            ? (goalDone ? `今日 ${dayN} 个新词已完成，仍可继续加学新词；想巩固已学内容请用右侧「复习单词」。` : '开始今日新词学习，支持例句、发音与记忆提示。')
            : (recoverable
              ? '本词书的新词已学完——没学过的词都被词汇量测试的「整带跳过」或旧进度迁移标成了「已认识」。点下面按钮可以恢复。'
              : '本词书的新词已学完，点下面按钮继续复习巩固。')}</p>
          <div class="feat"><span>标准发音</span><span>真实例句</span><span>记忆提示</span><span>词根词缀</span></div>
          <button class="btn btn-lg" style="background:#fff;color:var(--pri);margin-top:13px" data-act="${!newLeft ? (recoverable ? 'recover-new' : 'start-review') : 'start-new'}">
            ${!newLeft
              ? (recoverable
                ? `恢复新词，从头开始学 → <span style="opacity:.6;font-weight:500">可恢复 ${recoverable} 词</span>`
                : '新词已学完 → <span style="opacity:.6;font-weight:500">继续复习巩固</span>')
              : (goalDone
                ? `继续学习新单词 → <span style="opacity:.6;font-weight:500">再加 ${newPerRound} 词</span>`
                : `${todayNew ? '继续学习' : '开始学习'} → <span style="opacity:.6;font-weight:500">本轮 ${newPerRound} 词</span>`)}</button>
          ${!newLeft && recoverable ? `<div class="hint" style="margin-top:8px;color:rgba(255,255,255,.78)">只重置本词书里从未真正作答过的词，已考过的进度不受影响；想保留「已认识」标记就继续用下面的复习入口。</div>` : ''}
        </div>
      </div>
      <div class="big-card mint">
        <div class="ill">↻</div>
        <div>
          <h2>复习单词</h2>
          <p>根据遗忘曲线复习今日待巩固单词。</p>
          <div class="feat"><span>智能复习</span><span>遗忘曲线</span><span>多维练习</span><span>识词记忆</span></div>
          <button class="btn btn-lg" style="background:#fff;color:#0d9488;margin-top:13px" data-act="start-review">
            开始复习 → <span style="opacity:.6;font-weight:500">${dueList.length} 词待复习</span></button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-h">学习模式</div>
      <div class="card-b">
        <div class="grid g4">
          ${[
      ['smart', '智能模式', '根据测试结果混合新词与复习，按遗忘曲线排序'],
      ['new', '新词学习', '只学未背过的词；按每日新词目标分轮学习，达标后可继续加学'],
      ['review', '复习巩固', '按曲线复习，按时到期词'],
      ['spell', '拼写练习', '听音写词，检验真实掌握程度'],
    ].map(([k, t, d]) => `
            <button class="card" data-act="start" data-mode="${k}" style="padding:14px;text-align:left;border:1px solid var(--line);cursor:pointer">
              <div style="font-weight:700;font-size:14.5px;margin-bottom:5px">${t}</div>
              <div style="font-size:12px;color:var(--tx3);line-height:1.6">${d}</div>
            </button>`).join('')}
        </div>
      </div>
    </div>`;

    on(root, 'click', '[data-act]', (e, t) => this._act(t.dataset.act, t.dataset.mode));
    const sel = $('#bookSel', root);
    if (sel) sel.onchange = () => App.go('vocab', { book: sel.value });
    const dailyGoal = $('#dailyNewGoal', root);
    const estimate = $('#dailyPlanEstimate', root);
    if (dailyGoal) {
      dailyGoal.oninput = () => {
        const value = Math.max(1, Number(dailyGoal.value) || dayN);
        const days = Math.ceil(remainingForPlan / value);
        if (estimate) estimate.textContent = remainingForPlan
          ? `本词书剩余 ${remainingForPlan} 词，约 ${days} 天学完` : '本词书的新词已学完';
      };
      dailyGoal.onchange = () => {
        Store.d.settings.dailyNew = Math.max(5, Math.min(200, Math.round(Number(dailyGoal.value) || 30)));
        Store.flush();
        this._renderShell($('#view'));
      };
    }
  },

  _act(act, mode) {
    const b = this.book;
    if (act === 'test') return this._vocabTest();
    if (act === 'settings') return this._settings();
    if (act === 'adjustSkip') return this._adjustSkip();
    if (act === 'start-new') return this._begin('new', { continueAfterGoal: true });
    if (act === 'recover-new') return this._recoverNewWords();
    if (act === 'start-review') return this._begin('review');
    if (act === 'start') return this._begin(mode, { continueAfterGoal: mode === 'new' });
  },

  /** 手动调整「跳过简单词」的范围——比自动比例更可控 */
  _adjustSkip() {
    const bk = this.book, b = bk.id;
    const words = bk.words, N = words.length;
    const info = Store.skipInfo(b);
    // 按词频降序排列，索引越大越基础
    const at = cnt => words.slice(N - cnt).map(w => w.w);
    const cur = info.liveSkipped;

    App.modal('调整跳过范围', `
      <p class="hint" style="margin-bottom:14px">
        词库按词频降序排列，<b>列表靠后 = 词频越低 = 越基础</b>。
        跳过这些词后，学习队列会从更靠前的难词开始。
      </p>
      <div class="fld">
        <label class="lab">跳过数量：<b id="skN" style="color:var(--pri);font-size:16px">${cur}</b> 词
          （共 ${N} 词，占 ${Math.round(cur / N * 100)}%）</label>
        <input type="range" id="skR" min="0" max="${Math.min(N, Math.floor(N * 0.75))}"
          step="${Math.max(1, Math.floor(N / 100))}" value="${cur}" style="width:100%">
        <div class="hint">0 = 全部从头学；拉得越靠右跳过的基础词越多。</div>
      </div>
      <div class="hint" style="margin-bottom:10px">预览将跳过的词（末尾 ${Math.min(20, cur)} 个）：</div>
      <div id="skPrev" style="max-height:110px;overflow-y:auto;padding:10px;background:var(--card2);
        border-radius:9px;font-size:12.5px;line-height:1.9;color:var(--tx2)">
        ${cur ? at(cur).slice(-20).map(w => esc(w)).join('　·　') : '（当前不跳过任何词）'}
      </div>
      ${info.batches ? `<div class="hint" style="margin-top:10px">
        已有 ${info.batches} 次测试标熟记录。当前生效 ${info.liveSkipped} 词。</div>` : ''}
      <div class="row" style="margin-top:18px;gap:8px">
        <button class="btn btn-warn" id="skClear">全部取消跳过</button>
        <span class="sp"></span>
        <button class="btn btn-gh" data-x>取消</button>
        <button class="btn btn-pri" id="skOk">应用</button>
      </div>`, bb => {
      const r = $('#skR', bb);
      r.oninput = () => {
        const v = +r.value;
        $('#skN', bb).textContent = v;
        $('#skPrev', bb).innerHTML = v
          ? at(v).slice(-20).map(w => esc(w)).join('　·　')
          : '（不跳过任何词）';
      };
      $('[data-x]', bb).onclick = App.closeModal;
      $('#skClear', bb).onclick = () => {
        let n = 0;
        while (Store.skipInfo(b).batches > 0) n += Store.undoTestSkip(b);
        /* 【2026-10-22】只撤销 srs 镜像不够：引擎里这些词早已被定级成 L1/L3，
         * 不一起放回 L0 的话，词书页仍然"新词已学完"（用户反馈的就是这个）。*/
        const E = this._engine();
        let released = 0;
        if (E) {
          E.load(Store);
          released = E.releaseUnlearned(Store, b.id).count;
          this._mirrorSrs();
        }
        App.closeModal();
        this._renderShell($('#view'));
        App.toast(n || released
          ? `已取消 ${n} 个词的跳过，恢复 ${released} 个新词` : '当前没有跳过记录', 'ok');
      };
      $('#skOk', bb).onclick = () => {
        const want = +r.value;
        // 先全清再按新值重设，保证与滑块一致
        let guard = 0;
        while (Store.skipInfo(b).batches > 0 && guard++ < 30) Store.undoTestSkip(b);
        if (want > 0) {
          // 反推一个能得到 want 个词的正确率
          const ratio = want / N;
          const rate = ratio <= 0.12 ? 0.30 : ratio <= 0.22 ? 0.45 : ratio <= 0.35 ? 0.60
            : ratio <= 0.45 ? 0.75 : 0.90;
          const got = Store.applyTestSkip(b, rate).skipped.length;
          App.toast(got ? `已跳过 ${got} 个基础词` : '未能应用，请重试', got ? 'ok' : 'err');
        } else {
          /* 滑块拉到 0 也意味着"全部从头学"：引擎定级同样要放回 L0 */
          const E2 = this._engine();
          if (E2) { E2.load(Store); E2.releaseUnlearned(Store, b.id); this._mirrorSrs(); }
          App.toast('已恢复为全部从头学', 'ok');
        }
        App.closeModal();
        this._renderShell($('#view'));
      };
    });
  },

  /** 直接设置跳过数量（供外部调用） */
  setSkip(count) { return Store.applyTestSkip(this.book.id, count / this.book.words.length); },

  _settings() {
    const s = Store.d.settings;
    App.modal('学习设置', `
      <div class="fld"><label class="lab">每日新词目标</label>
        <input class="inp" type="number" id="setDaily" min="5" max="200" value="${s.dailyNew}">
        <div class="hint">每天的新词目标：每轮最多 10 个、分几轮完成；达到目标后仍可继续加学新词（复习有独立入口）。
          建议：六级/考研备考 20-40 词；考前冲刺 60-80 词。</div></div>
      <div class="fld"><label class="lab">朗读语速</label>
        <input type="range" id="setRate" min="0.5" max="1.5" step="0.05" value="${s.speechRate}" style="width:100%">
        <div class="hint">当前 <b id="rateVal">${s.speechRate}</b> 倍速。听力练习建议 0.9-1.0。</div></div>
      <div class="fld"><label class="lab">发音音色</label>
        <select class="inp" id="setVoice">
          <option value="">自动选择</option>
          ${Speech.list().map(v => `<option value="${esc(v.name)}"${v.name === s.speechVoice ? ' selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('')}
        </select><div class="hint">当前系统可用英语音色 ${Speech.list().length} 个。</div></div>
      <button class="btn btn-pri btn-blk" id="saveSet">保存</button>`,
      (b2) => {
        const r = $('#setRate', b2);
        r.oninput = () => $('#rateVal', b2).textContent = r.value;
        $('#saveSet', b2).onclick = () => {
          s.dailyNew = Math.max(5, Math.min(200, +$('#setDaily', b2).value || 30));
          s.speechRate = +r.value;
          s.speechVoice = $('#setVoice', b2).value;
          Store.flush();
          App.closeModal();
          this._renderShell($('#view'));
          App.toast('已保存', 'ok');
        };
      });
  },

  /* ---------- 词汇量测试 ---------- */
  _vocabTest() {
    const bk = this.book;
    const qs = buildVocabTest(bk, 40);
    this.testState = { qs, i: 0, correct: 0, answered: new Array(qs.length).fill(null) };
    this._renderTest();
  },
  _renderTest() {
    const ts = this.testState, q = ts.qs[ts.i];
    const pct = Math.round(ts.i / ts.qs.length * 100);
    const opts = q.opts.map((o, i) => `
      <div class="choice" data-i="${i}">
        <span class="k">${'ABCD'[i]}</span><span>${esc(o)}</span>
      </div>`).join('');
    App.modal(`词汇量测试 · ${bk0name(this.book)}`, `
      <div class="row" style="justify-content:space-between;font-size:13px;color:var(--tx3)">
        <span>第 ${ts.i + 1} / ${ts.qs.length} 题</span>
        <span>已答对 <b style="color:var(--ok)">${ts.correct}</b></span>
      </div>
      <div class="test-bar"><i style="width:${pct}%"></i></div>
      <div style="text-align:center;margin:16px 0 6px">
        <span style="font-size:30px;font-weight:800;font-family:Georgia,serif">${esc(q.w)}</span>
      </div>
      <p style="text-align:center;color:var(--tx3);font-size:12.5px;margin-bottom:16px">选择正确的释义</p>
      <div style="display:flex;flex-direction:column;gap:8px">${opts}</div>
      <button class="btn btn-gh btn-blk" id="testSkip" style="margin-top:14px">不认识，跳过</button>`,
      (b2) => {
        on(b2, 'click', '.choice', (e, t) => {
          const i = +t.dataset.i;
          ts.answered[ts.i] = i;
          if (i === q.a) ts.correct++;
          $$('.choice', b2).forEach((c, k) => {
            c.classList.add('lock');
            if (k === q.a) c.classList.add('right');
            else if (k === i) c.classList.add('wrong');
          });
          setTimeout(() => { ts.i++; ts.i < ts.qs.length ? this._renderTest() : this._testDone(); }, 620);
        });
        $('#testSkip', b2).onclick = () => { ts.i++; ts.i < ts.qs.length ? this._renderTest() : this._testDone(); };
      });
  },
  _testDone() {
    const ts = this.testState, bk = this.book;
    const est = estimateVocab(ts.correct, ts.qs.length, bk.total);
    const rate = ts.correct / Math.max(1, ts.qs.length);
    Store.d.vocabTest[bk.id] = {
      correct: ts.correct, total: ts.qs.length, estimate: est,
      rate: Math.round(rate * 100), at: new Date().toISOString(),
    };
    Store.flush();
    // 按词汇量分层：简单词 / 中等词 / 难词 配比
    const easy = Math.round(bk.total * 0.30 + est * 0.05);
    Store.d.vocabTest[bk.id].tiers = {
      easy: Math.min(bk.total, easy),
      mid: Math.min(bk.total, Math.round(bk.total * 0.45)),
      hard: bk.total,
    };
    Store.flush();

    /* 【引擎定级（docs/27 §5.1）】把测试题按词频分位归到 6 个频带、算每带正确率，
     * 喂给 VocabEngine.placement()；组轮时对"第一次出现的词"惰性给起点（跳过带→L3 抽检池、
     * 边界带→L1、起点带及以后→L0；抽样答对的词→L3+抽检池）。*/
    const placement = this._runPlacement(ts, bk);
    /* 【整带跳过的覆盖面提醒】定级只用 40 道题就按频带外推整本词书：
     * 跳过带覆盖过半时，引擎里就没有 L0 新词了，每日新词会一直显示"已学完"
     * （2026-10-22 用户反馈）。这里提前把后果说清楚，并给出恢复入口。*/
    let placementCoverage = 0;
    if (placement && Array.isArray(placement.skipBands) && placement.skipBands.length) {
      const Q0 = this._quiz();
      if (Q0 && typeof Q0.bandOf === 'function') {
        const skipSet = new Set(placement.skipBands);
        let hit = 0;
        for (const w of bk.words) if (skipSet.has(Q0.bandOf(bk, w))) hit++;
        placementCoverage = bk.total ? hit / bk.total : 0;
      }
    }
    const placementWarn = placementCoverage >= 0.5;
    // 预览将要跳过的词（先算不落盘，等用户确认）
    const plan = skipPlan(rate, bk);
    const existing = Store.skipInfo(bk.id);

    App.modal('测试完成', `
      <div style="text-align:center;padding:10px 0">
        <div style="font-size:13px;color:var(--tx3)">你的估算词汇量（以 ${esc(bk0name(bk))} 为基准）</div>
        <div style="font-size:44px;font-weight:800;color:var(--pri);line-height:1.2">${est}</div>
        <div class="tag tag-pri">答对 ${ts.correct} / ${ts.qs.length}（${Math.round(rate * 100)}%）</div>
      </div>

      <div style="margin-top:18px" class="card" style="border:2px solid var(--pri)">
        <div class="card-b" style="padding:14px">
          ${plan.count > 0 ? `
            <div style="font-size:13px;line-height:1.75;margin-bottom:10px">
              根据你的测试表现，系统判断 <b style="color:var(--ok)">${plan.count}</b> 个基础高频词无需从头背，
              可直接标为已掌握。<b>剩余 ${bk.total - plan.count} 个词</b>进入正常学习队列。
            </div>
            <div class="hint" style="margin-bottom:10px">
              这些词词频低于 <b>${plan.threshold}</b>，属于六级/考研基础词。
              标熟后仍会按遗忘曲线安排复习（首次 30 天后），只是不会占用每日新词名额。
            </div>
            <div id="skipPreview" style="max-height:120px;overflow-y:auto;padding:9px;background:var(--card2);
              border-radius:9px;font-size:12.5px;line-height:1.9;color:var(--tx2)">
              ${plan.samples.map(w => esc(w)).join('　·　')}
              ${plan.count > plan.samples.length ? `<br><span class="hint">…等共 ${plan.count} 词</span>` : ''}
            </div>
            <label class="row" style="gap:8px;margin-top:12px;cursor:pointer">
              <span class="chk on" id="skipChk"></span>
              <b style="font-size:13px">立即跳过这些词</b>
            </label>
            <div class="hint" style="margin-top:6px">不勾选也可以直接开始学习，之后随时可在词书页重新操作。</div>
          ` : `
            <div style="font-size:13px;line-height:1.75">
              你的测试正确率为 ${Math.round(rate * 100)}%，基础词汇掌握还不够扎实，
              <b>建议不跳过</b>，从词书开头系统学习一遍。
            </div>
          `}
          ${existing.liveSkipped ? `<div class="tipbox" style="margin-top:10px">
            当前已有 <b>${existing.liveSkipped}</b> 个词被标记为已跳过（来自之前的测试）。
            <button class="btn btn-xs btn-warn" id="undoSkip" style="margin-left:8px">撤销</button></div>` : ''}
        </div>
      </div>

      ${placement ? `
      <div style="margin-top:14px">
        <div class="sec-t">引擎定级（按词频 6 个频带，docs/27 §5.1）</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          ${placement.rows.filter(r => r.sampled).map(r => `<tr>
            <td style="padding:4px 0;color:var(--tx2)">第 ${r.band + 1} 带 · ${r.correct}/${r.sampled}（${Math.round(r.correct / r.sampled * 100)}%）</td>
            <td style="text-align:right">${r.correct / r.sampled >= 0.8 ? '<span class="tag tag-ok">整带跳过</span>'
              : (r.correct / r.sampled >= 0.5 ? '<span class="tag">起点带附近 · 先当"眼熟"</span>' : '<span class="tag">从头学</span>')}</td></tr>`).join('')}
        </table>
        <div class="hint">起点：${placement.bandPlacement != null ? '第 ' + (placement.bandPlacement + 1) + ' 带' : '从头'}
          　·　估算词汇量 <b>${placement.vocabEstimate}</b>
          　·　抽样答对的 ${placement.correctIds.length} 个词只进"抽检"，不当作已掌握</div>
        ${placementWarn ? `<div class="tipbox" style="margin-top:8px;line-height:1.7">
          <b>注意：整带跳过覆盖了本词书约 ${Math.round(placementCoverage * 100)}% 的词。</b><br>
          这些词会被当成「已认识」进入复习/抽检，<b>不再出现在每日新词里</b>，词书页可能显示"新词已学完"。
          如果之后想继续背新词，可在词书页点「恢复新词，从头开始学」——只重置从未真正作答过的词。
        </div>` : ''}
      </div>` : ''}

      <div style="margin-top:14px">
        <div class="sec-t">分层学习配比（已自动应用到智能模式）</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:var(--tx2)">基础词（已标熟/低频）</td>
            <td style="text-align:right"><b>1次认识 + 2次拼写</b></td></tr>
          <tr><td style="padding:6px 0;color:var(--tx2)">中等词（中间区）</td>
            <td style="text-align:right"><b>2次认识 + 2次拼写</b></td></tr>
          <tr><td style="padding:6px 0;color:var(--tx2)">难词（高频难区）</td>
            <td style="text-align:right"><b>3次认识 + 3次拼写</b></td></tr>
        </table>
        <div class="hint">系统会依据你的表现动态调整每个词的重复次数与间隔。</div>
      </div>

      <div class="row" style="margin-top:18px;gap:8px">
        <button class="btn btn-gh sp" id="testNoSkip">全部从头学</button>
        <button class="btn btn-pri" id="testOk">${placement ? '按定级结果开始学习 →' : '开始学习 →'}</button>
      </div>`, (b) => {
      const chk = $('#skipChk', b);
      if (chk) chk.onclick = () => chk.classList.toggle('on');
      const un = $('#undoSkip', b);
      if (un) un.onclick = () => {
        const n = Store.undoTestSkip(bk.id);
        App.closeModal();
        this._testDone();          // 重算并重绘
        App.toast(n ? `已撤销 ${n} 个词的标熟记录` : '没有可撤销的记录', n ? 'ok' : '');
      };
      const apply = () => {
        if (chk && chk.classList.contains('on') && plan.count > 0) {
          const r = Store.applyTestSkip(bk.id, rate);
          if (r.skipped.length) {
            App.toast(`已跳过 ${r.skipped.length} 个简单词，直接从 ${bk.total - r.skipped.length} 个词开始学`, 'ok');
          }
        }
        App.closeModal();
        this._begin('smart');
      };
      $('#testOk', b).onclick = apply;
      $('#testNoSkip', b).onclick = () => { App.closeModal(); this._begin('smart'); };
    });
  },

  /** 把词汇量测试结果折算成"每频带正确率"并写进引擎（§5.1） */
  _runPlacement(ts, bk) {
    const E = this._engine(), Q = this._quiz();
    if (!E || !Q || !ts || !ts.qs || !ts.qs.length) return null;
    E.load(Store);
    const bands = E.CONFIG.PLACEMENT.BANDS;
    const rows = [];
    for (let b = 0; b < bands; b++) rows.push({ band: b, sampled: 0, correct: 0 });
    const sizes = new Array(bands).fill(0);
    for (const w of bk.words) sizes[Q.bandOf(bk, w)]++;
    const correctIds = [];
    ts.qs.forEach((q, i) => {
      const raw = bk.words.find(x => String(x.w) === String(q.w));
      if (!raw) return;
      const band = Q.bandOf(bk, raw);
      rows[band].sampled++;
      if (ts.answered && ts.answered[i] != null && ts.answered[i] === q.a) {
        rows[band].correct++;
        correctIds.push(Q.wordId(bk, raw));
      }
    });
    if (!rows.some(r => r.sampled)) return null;
    const p = E.placement(rows.filter(r => r.sampled > 0), sizes);
    E.applyPlacement(p, correctIds);
    return Object.assign({}, p, { rows, correctIds });
  },

  /* ---------- 生成学习队列 ----------
   * 【2026-10-17 新增】引擎口径的"还剩多少新词可学"：L0 的词 + 还没有引擎状态的词
   * （后者组轮时会惰性定级；若被定到 L1/L3 就不再算新词）。
   * 为什么不用 srs 镜像：引擎时代 srs 是双写镜像（reps 记录的是引擎 attempts），
   * 定级/跳过写进去的词 stage 已 ≥1，但引擎里可能根本没有 L0 可教（本函数会返回 0）。*/
  _engineNewLeft() {
    const E = this._engine();
    if (!E || !this.book) return null;
    E.load(Store);
    const st = E.load();
    /* 【只统计当前词书】引擎状态是跨词书共用的（key = "bookId:word#sense"）。
     * 旧实现没按词书前缀过滤：学过 cet6 后切到 toefl 时，byWord.size 已大于
     * toefl 的总词数 → unplaced 被算成 0，再加上其它书的 L0 → 结果恒为 0，
     * 词书页一直显示「新词已学完」。 */
    const prefix = String(this.book.id) + ':';
    const byWord = new Map();
    for (const k in st.words) {
      if (!k.startsWith(prefix)) continue;
      const i = k.lastIndexOf('#');
      const wid = i >= 0 ? k.slice(0, i) : k;
      const lv = st.words[k].level || 0;
      const cur = byWord.get(wid);
      byWord.set(wid, cur == null ? lv : Math.min(cur, lv));
    }
    let l0 = 0;
    byWord.forEach(lv => { if (lv === 0) l0++; });
    const total = (this.book.words || []).length;
    const unplaced = Math.max(0, total - byWord.size);
    return l0 + unplaced;
  },

  /**
   * 今日已安排/已学的新词数（引擎口径，跨天自动归零）。
   * 为什么不用 Store.d.stats.daily.words：那里把复习/抽检/拼写的答对也累加，
   * 用它衡量"每日新词目标"会虚高，目标提前显示完成（用户反馈"设定没有用"）。
   */
  _dailyNewUsed(excludePending) {
    const E = this._engine();
    if (E) {
      E.load(Store);
      const u = (E.load().user) || {};
      let used = (u.dailyNewDate || '') === App.today() ? Math.max(0, Number(u.dailyNewCount) || 0) : 0;
      /* 组轮时会把"本轮计划的新词"一次性计入 dailyNewCount。回到词书页时，
       * 这一轮里还没轮到的新词不该算进"今日已学"，否则中途退出会显示虚高进度。*/
      if (excludePending && used) {
        const round = E.load().round;
        if (round && !round.finished && Array.isArray(round.slots)) {
          used = Math.max(0, used - round.slots.filter(x => x.role === 'new').length);
        }
      }
      return used;
    }
    const st = Store.d.stats && Store.d.stats.daily && Store.d.stats.daily[App.today()];
    return Math.max(0, Number(st && st.words) || 0);
  },

  /**
   * 本词书里"能恢复成新词"的数量：引擎从未真正判过分（levelAttempts === 0）
   * 却被定级/旧迁移写成 L1+ 的词。只用于「恢复新词」按钮的文案。
   */
  _engineRecoverable() {
    const E = this._engine();
    if (!E || !this.book) return 0;
    E.load(Store);
    const st = E.load();
    const prefix = String(this.book.id) + ':';
    const seen = new Set();
    for (const k in st.words) {
      if (!k.startsWith(prefix)) continue;
      const row = st.words[k];
      if ((row.levelAttempts || 0) > 0) continue;       // 真考过的不算
      if ((row.level || 0) <= 0) continue;              // 已经是 L0，本来就是新词
      seen.add(k.slice(0, k.lastIndexOf('#')));
    }
    return seen.size;
  },

  /**
   * 「恢复新词」：把没真正考过却被标成已认识的词放回 L0，并清掉定级数据，
   * 让每日新词重新可用。只动本词书；已作答过的词不动。
   */
  _recoverNewWords() {
    const E = this._engine();
    const b = this.book;
    if (!E || !b) { App.toast('词汇引擎未加载，请刷新页面后重试', 'err'); return; }
    E.load(Store);
    const before = this._engineNewLeft();
    const r = E.releaseUnlearned(Store, b.id);
    /* 清掉 srs 镜像里由"测试标熟 / 定级双写"留下的记录（reps=0 或 skipped），
     * 否则首页词书进度、拼写练习池还会把这些词当已学。真实作答记录（reps>0）保留。*/
    const srs = (Store.d.srs && Store.d.srs[b.id]) || {};
    let removed = 0;
    for (const rec of r.words) {
      const key = Object.keys(srs).find(x => String(x).toLowerCase() === String(rec).toLowerCase());
      if (!key) continue;
      const row = srs[key];
      if (row && (row.skipped || !Number(row.reps))) { delete srs[key]; removed++; }
    }
    /* 旧的「跳过简单词」批次也撤销：它把同样的词写成了 stage 3。*/
    let undone = 0, guard = 0;
    while (Store.skipInfo(b.id).batches > 0 && guard++ < 50) {
      const n = Store.undoTestSkip(b.id);
      if (!n) break;
      undone += n;
    }
    if (typeof E.mirrorToSrs === 'function') this._mirrorSrs();
    Store.flush();
    const after = this._engineNewLeft();
    App.toast(
      after > before
        ? `已恢复 ${r.count} 个新词（清理镜像 ${removed} 条 / 撤销跳过 ${undone} 个）`
        : '没有可恢复的词（本词书的词都真正作答过了）',
      after > before ? 'ok' : ''
    );
    this._renderShell($('#view'));
  },

  /** 到期待复习 = 引擎里 L1/L2 的词 + 到点的 L4（§5.5）；引擎不可用时退回旧 srs */
  _dueWords() {
    const b = this.book;
    const E = this._engine();
    if (!E) {
      const recs = Store.d.srs[b.id] || {};
      const now = Date.now();
      return b.words.filter(w => { const r = recs[w.w]; return r && r.next && r.next <= now; });
    }
    E.load(Store);
    const st = E.load();
    const today = App.today();
    const out = [], seen = new Set();
    for (const k in st.words) {
      const row = st.words[k];
      const due = (row.level === 4 && row.nextDueAt && row.nextDueAt <= today)
        || row.level === 1 || row.level === 2;
      if (!due) continue;
      const wid = k.slice(0, k.lastIndexOf('#'));
      const name = wid.slice(String(b.id).length + 1);
      const w = b.words.find(x => String(x.w).toLowerCase() === name.toLowerCase());
      if (w && !seen.has(w.w)) { seen.add(w.w); out.push(w); }
    }
    return out;
  },

  /**
   * 队列去重：同一个拼写在一轮学习里只能出现一次。
   * 词书数据已按拼写去重（见 dict.js 的 load），这里是兜底——
   * 复习池与生词池合并、旧数据的重复条目、拼写练习重排都可能再引入重复，
   * 一旦重复就会出现「连着背同一个词」。
   */
  _dedupeQueue(list) {
    const seen = new Set();
    return (list || []).filter(w => {
      if (!w || !w.w) return false;
      const key = String(w.w).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  _newWords(continueAfterGoal = false) {
    const b = this.book, recs = Store.d.srs[b.id] || {};
    const target = Store.d.settings.dailyNew;
    const learnedToday = Store.d.stats.daily[App.today()]?.words || 0;
    const left = continueAfterGoal ? target : Math.max(0, target - learnedToday);
    const fresh = b.words.filter(w => !recs[w.w] || !recs[w.w].reps);

    /* 学习过的书不再混入四级词；只有六级/考研这类高层级词书才混入，
     * 且优先混入四级里「本词书没有」的高频词（这些才需要巩固）。*/
    const hiLevel = ['cet6', 'kaoyan', 'toefl', 'sat'].includes(b.id);
    if (!hiLevel || !WordLevel) return fresh.slice(0, left);

    const cet4 = Store.books ? (Store.books.find(x => x.id === 'cet4') || null) : null;
    const cet4Words = cet4 && cet4.words && cet4.words.length
      ? cet4.words
      : (Dict.cache && Dict.cache.cet4) || [];
    if (!cet4Words.length) return fresh.slice(0, left);

    // 剔除已学过的四级词
    const cet4Recs = Store.d.srs.cet4 || {};
    const cand = cet4Words.filter(w => !cet4Recs[w.w] || !cet4Recs[w.w].reps);

    const queue = WordLevel.buildQueue(fresh, cand, {
      keepCet4Ratio: Store.d.settings.cet4KeepRatio != null ? Store.d.settings.cet4KeepRatio : 0.18,
      injectEvery: Store.d.settings.cet4InjectEvery || 30,
    });
    return queue.slice(0, Math.max(left, Math.ceil(left * 1.06)));
  },

  /** 拼写练习只从有过学习记录的词中取题；今天学过的始终排在前面。 */
  _arrangeSpell(words, order = this.spellOrder || 'time') {
    const recs = Store.d.srs[this.book.id] || {};
    const timeOf = word => {
      const rec = recs[word.w] || {};
      const history = Array.isArray(rec.history) ? rec.history : [];
      const lastHistory = history.length ? history[history.length - 1].t : 0;
      return Number(rec.last || lastHistory || 0);
    };
    const isToday = word => {
      const ts = timeOf(word);
      if (!ts) return false;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === App.today();
    };
    const today = words.filter(isToday);
    const earlier = words.filter(word => !isToday(word));
    const arrangeGroup = group => order === 'random'
      ? App.shuffle(group.slice())
      : group.slice().sort((a, b) => timeOf(a) - timeOf(b) || a.w.localeCompare(b.w));
    return arrangeGroup(today).concat(arrangeGroup(earlier));
  },

  /** 词书页上的"引擎掌握度"卡：L0~L4 分布 + 定级信息 + 计数 */
  _engineMasteryCard() {
    const E = this._engine();
    if (!E) return '';
    E.load(Store);
    const st = E.stats();
    const s = E.load();
    const dist = [0, 0, 0, 0, 0];
    for (const k in s.words) dist[Math.min(4, s.words[k].level || 0)]++;
    const total = dist.reduce((a, b) => a + b, 0) || 1;
    const colors = ['var(--line2)', '#7c5cff', '#f79009', '#2f6bff', '#12b76a'];
    const labels = ['生词', '眼熟', '模糊', '认识', '巩固'];
    const u = s.user || {};
    return `
    <div class="card" style="margin-bottom:14px;padding:14px 16px">
      <div class="row" style="align-items:baseline;gap:10px;flex-wrap:wrap">
        <b style="font-size:13.5px">引擎掌握度（L0→L4）</b>
        <span class="hint" style="margin:0">已学 ${st.learned} · 巩固 ${st.mastered} · 复习中 ${st.reviewing} · 难词 ${st.hard}</span>
        <span class="sp"></span>
        ${u.vocabEstimate ? `<span class="tag tag-pri">定级估算 ${u.vocabEstimate}</span>` : ''}
        ${u.bandPlacement != null ? `<span class="tag">起点第 ${u.bandPlacement + 1} 带</span>` : ''}
        ${(u.skipBands || []).length ? `<span class="tag tag-ok">整带跳过 ${u.skipBands.length} 个</span>` : ''}
      </div>
      <div class="bar" style="display:flex;margin-top:9px">
        ${dist.map((n, i) => n ? `<i style="width:${n / total * 100}%;background:${colors[i]}" title="${labels[i]} ${n}"></i>` : '').join('')}
      </div>
      <div class="row" style="gap:14px;margin-top:6px;font-size:11.5px;color:var(--tx3)">
        ${labels.map((l, i) => `<span>${l} <b>${dist[i]}</b></span>`).join('')}
      </div>
    </div>`;
  },

  /* ---------- 引擎接入（docs/27 §5.2）----------
   * 【UI 不变，规则全换】"智能 / 复习 / 新词"三个入口都改由 VocabEngine 组轮；
   * 随机练习与拼写练习仍用原来的取词方式，但判分同样写进引擎状态（gradeFree），
   * 保证只有一份掌握度、一条迁移规则。*/
  _engine() { return (typeof VocabEngine !== 'undefined') ? VocabEngine : null; },
  /** 引擎状态 → Store.d.srs 镜像（过渡期双写：树园/统计/旧页面读数继续有效） */
  _mirrorSrs() {
    const E = this._engine();
    if (!E) return;
    E.mirrorToSrs(Store, this.book.id, wid => String(wid).slice(String(this.book.id).length + 1));
  },
  _quiz() { return (typeof VocabQuiz !== 'undefined') ? VocabQuiz : null; },
  /** 首次进入时把旧 srs 数据迁移进引擎（§6-#12），之后不再重复 */
  _ensureEngine() {
    const E = this._engine();
    if (!E) return null;
    E.load(Store);
    if (!this._engineMigrated) {
      this._engineMigrated = true;
      const recs = (Store.d.srs && Store.d.srs[this.book.id]) || {};
      E.migrateFromSrs(recs, w => VocabQuiz.wordId(this.book, { w }));
    }
    return E;
  },
  /** 词位 → 原始词条（UI 的卡片仍按原始词条渲染，markup 不变） */
  _wordOfSlot(slot) {
    if (!slot) return null;
    if (slot.wordRef) return slot.wordRef;
    const words = (this.book && this.book.words) || [];
    let w = slot.word ? words.find(x => String(x.w) === String(slot.word)) : null;
    if (!w && slot.entry) w = words.find(x => String(x.w) === String(slot.entry.word));
    if (!w && slot.wordId) {
      const name = String(slot.wordId).slice(String(this.book.id).length + 1);
      w = words.find(x => String(x.w) === name);
    }
    if (w) slot.wordRef = w;
    return w;
  },
  /** 引擎组轮 → 本页的 slots/queue（queue 仍保持"词对象数组"，其余代码不用改） */
  _loadEngineRound(mode) {
    const E = this._ensureEngine();
    const Q = this._quiz();
    if (!E || !Q) return false;
    const entries = Q.bookEntries(this.book);
    /* 【每日新词目标生效】把设置里的目标传给引擎组轮：今天最多安排这么多新词
     * （每轮仍 ≤ NEW_PER_ROUND.max），达标后本轮自动改成复习巩固。*/
    const round = E.startRound({
      entries, mode, today: App.today(), store: Store,
      dailyNewTarget: Number(Store.d.settings.dailyNew) || 0,
    });
    this.vocabRound = round;
    this._doneSlots = [];
    this._applyEngineQueue(round.slots);
    return this.slots.length > 0;
  },
  _applyEngineQueue(rest) {
    const E = this._engine();
    for (const slot of rest) {
      const w = this._wordOfSlot(slot);
      if (w) slot.wordRef = w;
    }
    this.slots = (this._doneSlots || []).concat(rest);
    this.queue = this.slots.map(x => x.wordRef).filter(Boolean);
  },
  /* ---------- 轮外练习统计（拼写 / 随机）----------
   * 这两种模式没有引擎 round（vocabRound=null），完成页过去只能显示 "—%"：
   * 现在按"每个词位第一次作答"累计 本轮征服 / 正确率 / 升级 / 难词，
   * 结构对齐 VocabEngine.report()，完成页模板不用分叉。*/
  _resetFreeStats(mode) {
    this._freeStats = {
      mode: mode || this.mode, seen: new Set(), total: 0, correct: 0,
      upgraded: [], hardWords: [], startedAt: Date.now(),
    };
  },
  _noteFreeResult(result, wordId, senseId) {
    const s = this._freeStats;
    if (!s || !s.seen) return;
    const key = String(wordId || '') + '#' + String(senseId || '');
    const correct = !!(result && result.correct);
    if (!s.seen.has(key)) {
      s.seen.add(key);
      s.total++;
      if (correct) s.correct++;
      else s.hardWords.push({ wordId, senseId });
    }
    const upgraded = !!(result && ((result.feedback && result.feedback.upgraded)
      || (result.transition && result.transition.upgraded)));
    if (upgraded && wordId && !s.upgraded.some(x => x.wordId === wordId)) s.upgraded.push({ wordId });
  },
  _freeReport() {
    const s = this._freeStats;
    if (!s || !s.total) return null;
    return {
      roundId: 'free-' + (s.mode || this.mode), startedAt: s.startedAt,
      durationMs: Date.now() - (s.startedAt || Date.now()),
      quizzed: { total: 0, passed: 0 },
      upgraded: s.upgraded.slice(), hardWords: s.hardWords.slice(),
      roundErrorRate: s.total ? (s.total - s.correct) / s.total : 0,
      truncated: false,
      nextRoundFocus: s.hardWords.map(h => h.wordId),
      total: s.total, correct: s.correct, free: true,
    };
  },
  /** 完成页/日志统一取本轮报告：引擎轮优先，拼写/随机用本地累计 */
  _roundReport() {
    const E = this._engine();
    if (E && this.vocabRound) return E.report(E.load().round || this.vocabRound);
    return this._freeReport();
  },

  _begin(mode, options = {}) {
    const b = this.book;
    this.mode = mode;
    this._clearQTick();
    this._resetFreeStats(mode);
    /* 拼写/随机也要先把引擎存档载入：否则 gradeFree 会先缓存一个空状态，
     * 完成页显示已学 0，且本轮判分写不进真实进度（真机复现过）。*/
    this._ensureEngine();
    /* 顺便刷新一次 srs 镜像：旧镜像里 interval 等字段可能缺失（首页"掌握 0"），
     * 引擎状态才是权威，开一轮时对齐一次成本很低。*/
    this._mirrorSrs();
    if (mode === 'smart' || mode === 'review' || mode === 'new') {
      const ok = this._loadEngineRound(mode === 'smart' ? 'smart' : mode);
      if (!ok) {
        App.toast(mode === 'review' ? '当前没有待复习的单词' : '当前没有可组的词，试试拼写练习', '');
        return;
      }
      /* 点"新词/继续学习"但已没有新词（或整本词书的新词都学过）→ 引擎自动改组复习轮，这里提示一句 */
      if (this.vocabRound && this.vocabRound.fallbackFromNew) {
        App.toast('本词书的新词已经学完啦，这轮自动安排了复习巩固 ✅', 'ok');
      } else if (this.vocabRound && this.vocabRound.newOverGoal) {
        App.toast(`今日 ${Number(Store.d.settings.dailyNew) || 0} 个新词目标已完成，继续加学新词 ✅`, 'ok');
      }
    } else if (mode === 'random') {
      this.vocabRound = null;
      this.slots = App.pick(b.words, Store.d.settings.dailyNew).map(w => ({ wordId: this._quiz() ? VocabQuiz.wordId(b, w) : w.w, senseId: 's0', wordRef: w, free: true }));
      this._doneSlots = [];
      this._applyEngineQueue(this.slots);
    } else if (mode === 'spell') {
      const recs = Store.d.srs[b.id] || {};
      const pool = b.words.filter(w => recs[w.w] && Number(recs[w.w].reps) > 0);
      if (!pool.length) {
        App.toast('还没有已学习的单词，请先学习一些词再做拼写练习', '');
        return;
      }
      this.spellOrder = this.spellOrder || 'time';
      this._spellAutoKey = '';
      this.vocabRound = null;
      this.slots = this._arrangeSpell(pool).slice(0, Math.min(20, Store.d.settings.dailyNew))
        .map(w => ({ wordId: this._quiz() ? VocabQuiz.wordId(b, w) : w.w, senseId: 's0', wordRef: w, free: true }));
      this._doneSlots = [];
      this._applyEngineQueue(this.slots);
    } else {
      this.vocabRound = null;
      const due = this._dueWords(), nw = this._newWords();
      const dueN = Math.min(due.length, Math.round((due.length + nw.length) * 0.6));
      this.queue = App.shuffle(due.slice(0, dueN).concat(nw));
      this.slots = this.queue.map(w => ({ wordId: this._quiz() ? VocabQuiz.wordId(b, w) : w.w, senseId: 's0', wordRef: w, free: true }));
      this._doneSlots = [];
    }
    this.queue = this._dedupeQueue(this.queue);
    this.slots = this._dedupeSlots(this.slots);
    if (!this.slots.length) {
      App.toast(mode === 'review' ? '当前没有待复习的单词' : '当前没有可组的词，试试拼写练习', '');
      return;
    }
    this.qi = 0; this.revealed = false;
    this.phase = (mode === 'spell') ? 'spell' : 'card';
    this._goodCount = 0; this._badCount = 0;
    this._logged = false;
    this._renderStudy();
  },
  /** 词位去重（同一拼写一轮只出现一次；引擎侧已按词聚合，这里是 UI 兜底） */
  _dedupeSlots(list) {
    const seen = new Set();
    return (list || []).filter(sl => {
      const key = String(sl && sl.wordRef && sl.wordRef.w || sl && sl.word || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  /* ---------- 学习界面 ---------- */
  _renderStudy() {
    this._clearQTick();
    /* 【答题守卫按"题"而不是按"词"】旧代码用 _graded[单词] 防重复判分，
     * 但同一个词会有重考/回血/抽检多道题，旧标记会让后续题直接 return，
     * 界面只染色不推进（"答对了/答错了都卡住"）。现在每渲染一道新题就换 token，
     * 只阻止"同一道题被 timeout 和点击各判一次"，换题自然放行。*/
    this._qSeq = (this._qSeq || 0) + 1;
    this._answeredFor = 0;
    const root = App.freshView();
    const slot = this.slots[this.qi];
    const w = slot && (slot.wordRef || this._wordOfSlot(slot));
    if (!w) return this._finish();
    const rec = Store.srsOf(this.book.id, w.w);
    /* 出题：引擎在轮内（§5.3 规则：多义辨析 / 形近词干扰）→ 否则退回旧的 buildChoices */
    let opts;
    if (slot && !slot.free && this._quiz()) {
      opts = this._quiz().choiceFor(slot, this.book, { rand: Math.random });
    } else {
      opts = buildChoices(w, this.book);
    }
    /* 每个选项对应的英文单词：答错后展示，帮助区分"这个释义其实是哪个词"。
     * 引擎返回 ids（wordId#senseId），兜底 buildChoices 返回 words。*/
    if (!opts.words || !opts.words.length) {
      opts.words = (opts.ids || []).map(id => String(id).split('#')[0].split(':').pop());
    }
    if (!opts.words || !opts.words.length) opts.words = opts.opts.map((_, i) => (i === opts.answer ? w.w : ''));
    this.cur = { w, opts, rec, slot };
    /* 相位：新词先看教学卡；复习/抽检/重考/恢复题直接答题（§7.2） */
    if (this.mode !== 'spell' && slot && !slot.free && this.phase !== 'detail') {
      /* 【只在换词时重置 phase / revealed】"不认识"和"认识，进入限时选择"
       * 都是先改 phase/revealed 再重绘；无条件重置会让这两个按钮点了没效果。*/
      const revealKey = w.w + '|' + (slot.senseId || '') + '|' + this.qi + '|' + slot.role;
      if (this._revealKey !== revealKey) {
        this.phase = (slot.role === 'new') ? 'card' : 'choice';
        this.revealed = false;
        this._revealKey = revealKey;
      }
    }

    const head = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-act="back">← 返回词书</button>
      <div>
        <h1 style="font-size:19px">${modeName(this.mode)}</h1>
        <div class="sub">${esc(this.book.name)} · ${this.qi + 1} / ${this.queue.length}</div>
      </div>
      <div class="phead-r">
        <div class="bar" style="width:180px"><i style="width:${Math.round(this.qi / this.queue.length * 100)}%"></i></div>
      </div>
    </div>`;

    if (slot && !slot.free && this._engine()) {
      const st = this._engine().stateOf(slot.wordId, slot.senseId, false);
      this.cur.levelName = st ? this._engine().levelName(st.level) : '';
    }
    const hud = this._roundHUD();
    if (this.phase === 'card') root.innerHTML = head + hud + this._cardHTML(w, opts);
    else if (this.phase === 'choice') root.innerHTML = head + hud + this._choiceHTML(w, opts);
    else if (this.phase === 'spell') root.innerHTML = head + hud + this._spellHTML(w);
    else root.innerHTML = head + hud + this._detailHTML(w, rec);

    this._bindStudy();

    /*进入卡片自动朗读当前单词（新词学习与复习都要）。
     * 用户看到单词的第一反应就是读出来——先给声音，再让他想意思。*/
    /* 【第一次出现就出声】原来只有新词卡与详情页自动朗读；复习/抽检位现在直接进
     * "限时四选一"，若不朗读就变成默读选择题了。同一个词 800ms 内的自动朗读仍去重，
     * 所以"新词卡 → 认识进入选择题"不会连读两遍。*/
    if (this.phase === 'card' || this.phase === 'detail' || this.phase === 'choice') {
      this._sayCur(true);
    }
  },

  /**
   * 朗读当前单词，并把音标高亮 + 按钮点亮
   * @param {boolean} auto 是否自动触发（自动触发时同样高亮）
   */
  _sayCur(auto) {
    const w = this.cur && this.cur.w;
    if (!w) return;
    const ph = document.querySelector('.wcard-ph');
    const btn = document.querySelector('.wcard-say');
    /* 【防重复朗读】卡片会因为答题状态变化重渲染，自动朗读若跟着重来一遍，
     * 用户听到的是"顿一下又读一遍"。同一个词 800ms 内的自动朗读只算一次；
     * 手动点 🔊（auto=false）不受限制。*/
    if (auto && !this._forceSay) {
      const now = Date.now();
      const last = this._lastSaid;
      if (last && last.w === w.w && now - last.at < 800) {
        // 高亮要保证会被清掉：上一次的 onend 持有的是旧节点，清不到新渲染的卡片
        if (ph) ph.classList.add('on');
        if (btn) btn.classList.add('playing');
        clearTimeout(this._sayClearTimer);
        this._sayClearTimer = setTimeout(() => {
          const p2 = document.querySelector('.wcard-ph');
          const b2 = document.querySelector('.wcard-say');
          if (p2) p2.classList.remove('on');
          if (b2) b2.classList.remove('playing');
        }, 800 - (now - last.at));
        return;
      }
      this._lastSaid = { w: w.w, at: now };
    }
    this._forceSay = false;      // 强制标记只生效一次
    // 去重后再打断：旧请求可能还在预等待阶段，浏览器此时并不报告 speaking/pending。
    Speech.stopIfBusy();
    if (ph) ph.classList.add('on');
    if (btn) btn.classList.add('playing');
    /* 单词走 speakWord：默认 1.0 语速（原来固定 0.85，长单词要读 1.5–2 秒），
     * 并启用防吞音路径（前导空格 + 等引擎安静后再起音）。*/
    Speech.speakWord(w.w, {
      onend: () => {
        if (ph) ph.classList.remove('on');
        if (btn) btn.classList.remove('playing');
      },
      onerror: () => {
        if (ph) ph.classList.remove('on');
        if (btn) btn.classList.remove('playing');
      },
    });
  },

  /** 本轮 HUD：引擎的轮构成、进度与实时战果（只用现有 tag/bar 样式，不新增版式） */
  _roundHUD() {
    const E = this._engine();
    const round = this.vocabRound;
    if (!E || !round) return '';
    const slots = this.slots || [];
    const done = (this._doneSlots || []).length;
    const live = E.load().round || round;
    const plan = round.plan || [];
    const count = role => plan.filter(x => x.role === role).length;
    const results = live.results || [];
    const passed = results.filter(x => x.role === 'quiz' && x.correct).length;
    const quizTotal = results.filter(x => x.role === 'quiz').length
      + (live.slots || []).filter(x => x.role === 'quiz').length;
    const upgraded = (live.upgraded || []).length;
    /* 今日新词进度：引擎的 dailyNewCount 在组轮时已把"本轮计划的新词"计入，
     * 这里减去本轮还没轮到的 new 词位，得到"真正已经过到手"的数量。*/
    const dailyTarget = Number(Store.d.settings.dailyNew) || 0;
    const usedAll = this._dailyNewUsed();
    const usedNow = Math.max(0, usedAll - (live.slots || []).filter(x => x.role === 'new').length);
    return `
    <div class="card" style="padding:11px 15px;margin-bottom:14px">
      <div class="row" style="gap:9px;align-items:center;flex-wrap:wrap;font-size:12.5px">
        <span class="tag tag-pri">本轮 ${plan.length} 个词位</span>
        <span class="tag">抽检 ${count('quiz')}</span>
        <span class="tag">复习 ${count('review')}</span>
        <span class="tag">新词 ${count('new')}</span>
        <span class="tag">今日新词 ${usedNow}/${dailyTarget}</span>
        <span class="sp"></span>
        ${upgraded ? `<span class="tag tag-ok">已升级 ${upgraded}</span>` : ''}
        ${quizTotal ? `<span class="tag ${passed === quizTotal ? 'tag-ok' : ''}">抽检通过 ${passed}/${quizTotal}</span>` : ''}
        <span style="color:var(--tx3)">进度 ${done}/${slots.length}</span>
      </div>
      <div class="bar" style="margin-top:7px"><i style="width:${Math.round(done / Math.max(1, slots.length) * 100)}%"></i></div>
    </div>`;
  },

  _cardHTML(w, opts) {
    const showCn = this.revealed;
    const cnRows = typeof Dict !== 'undefined' && Dict.meaningRows ? Dict.meaningRows(w) : (w.tr || []);
    return `
    <div class="wcard">
      <div class="wcard-top">
        <span class="tag tag-pri">${esc(bk0name(this.book))}</span>
        <span class="tag">${esc(this.cur && this.cur.levelName || SRS.stageName((Store.srsOf(this.book.id, w.w) || {}).stage))}</span>
        <span class="sp"></span>
        <button class="btn btn-xs ${Store.nbHas(w.w) ? 'btn-ok2' : 'btn-gh'}" data-act="nbToggle"
          title="${Store.nbHas(w.w) ? '已在生词本中，点击查看' : '加入生词本'}">
          ${Store.nbHas(w.w) ? '✓ 已在生词本' : '+ 生词本'}</button>
        <button class="btn btn-xs btn-gh" data-act="detail">
          <svg viewBox="0 0 24 24" class="ic ic-sm">ℹ</svg> 词条详情</button>
        <button class="btn btn-xs btn-gh" data-act="skip">跳过 →</button>
      </div>
      <div class="wcard-word">${esc(w.w)}</div>
      <div class="wcard-ph">${esc(w.ph || '')}
        <button class="btn btn-xs btn-gh wcard-say" data-act="say" title="朗读这个单词">
          <svg viewBox="0 0 24 24" class="ic ic-sm ic-fill">
            <path d="M4 9v6h3.5l5 4V5l-5 4H4z"/>
            <path d="M15.5 9.2a4 4 0 010 5.6M18 6.8a7.5 7.5 0 010 10.4"/>
          </svg>读</button>
      </div>
      ${showCn ? `
      <div class="wcard-cn">${cnRows.map(t => `${t.t ? `<span style="font-size:13px;color:var(--tx3)">${esc(t.t)}</span> ` : ''}${esc(t.d)}`).join('<br>')}</div>
      ${w.ex && w.ex.length ? `<div class="ex-item" style="margin-top:14px">
          ${esc(w.ex[0].en)}<div class="cn">${esc(w.ex[0].cn)}</div></div>` : ''}
      ` : `<div class="wcard-hint">先想一想它的意思</div>`}
            <div class="sp"></div>
      <div class="row" style="margin-top:22px;justify-content:center">
        ${showCn ? `
        <button class="btn btn-dan btn-lg" data-grade="0">不认识</button>
        <button class="btn btn-warn btn-lg" data-grade="1">模糊</button>
        <button class="btn btn-ok btn-lg" data-grade="2">认识</button>
        <button class="btn btn-pri btn-lg" data-grade="3">很熟</button>` :
        `<button class="btn btn-dan btn-lg" data-act="no">不认识，直接看释义</button>
         <button class="btn btn-ok btn-lg" data-act="know">认识，进入限时选择</button>
         <button class="btn btn-pri btn-lg" data-act="familiar">熟悉，查看词义和搭配</button>`}
      </div>
    </div>`;
  },

  _choiceHTML(w, opts) {
    return `
    <div class="wcard">
      <div class="wcard-top">
        ${(() => {
          const slot = this.cur && this.cur.slot;
          const role = slot && slot.isRecovery ? '回血题 · 选出正确释义'
            : slot && slot.isRetry ? '再考一次 · 选出正确释义' : '选出正确释义';
          const lvl = (slot && !slot.free && this._engine()) ? this._engine().stateOf(slot.wordId, slot.senseId, false) : null;
          const lvlTag = lvl ? `<span class="tag">${esc(this._engine().levelName(lvl.level))}</span>` : '';
          return `<span class="tag tag-pri">${role}</span>${lvlTag}<span class="sp"></span>`;
        })()}
        <button class="btn btn-xs ${Store.nbHas(w.w) ? 'btn-ok2' : 'btn-gh'}" data-act="nbToggle">
          ${Store.nbHas(w.w) ? '✓ 已在生词本' : '+ 生词本'}</button>
        <button class="btn btn-xs btn-gh" data-act="detail">词条详情</button>
      </div>
      <div class="wcard-word">${esc(w.w)}</div>
      <div class="wcard-ph">${esc(w.ph || '')}
        <button class="btn btn-xs btn-gh" data-act="say">🔊</button></div>
      <!-- 【2026-10-17 移除】这里原来显示 w.ex[0] 的单词首条例句。它和本题的目标义项没有对应
           关系（引擎按义项轮换出题，但例句是单词级的），词库数据里的例句顺序/含义也不总跟释义
           对齐（例：ear 释义是"（稻麦等的）穗"，例句却是"耳朵"；grave 的例句顺序和释义是反的）。
           例句留在教学卡/词条详情里（那里展示全部义项，不构成干扰），选择题只保留词+选项。 -->
      <div class="bar" style="margin-top:16px"><i id="qBar" style="width:100%"></i></div>
      <div style="display:flex;flex-direction:column;gap:9px;margin-top:8px">
        ${opts.opts.map((o, i) => `<div class="choice" data-i="${i}" data-word="${esc((opts.words && opts.words[i]) || '')}">
          <span class="k">${'ABCD'[i]}</span><span class="m">${esc(o)}</span>
          <span class="choice-word">${opts.words && opts.words[i] ? '（' + esc(opts.words[i]) + '）' : ''}</span></div>`).join('')}
      </div>
      <button class="btn btn-gh btn-blk choice-dunno" data-act="dunno">不认识这个单词（直接看答案）</button>
      <button class="btn btn-pri btn-blk choice-continue" data-act="continue" style="display:none;margin-top:10px">继续 →</button>
      <div class="sp"></div>
      <div style="margin-top:18px;text-align:center">
        <span class="tag tag-warn">选错会记录并再背一次</span>
        <span class="tag" id="qTime" style="margin-left:6px"></span>
      </div>
    </div>`;
  },

  _spellHTML(w) {
    const meanings = (typeof Dict !== 'undefined' && Dict.meaningRows ? Dict.meaningRows(w) : (w.tr || [])).map(row => row && row.d).filter(Boolean);
    return `
    <div class="wcard">
      <div class="wcard-top">
        <span class="tag tag-pur">拼写练习</span><span class="sp"></span>
        <button class="btn btn-xs ${Store.nbHas(w.w) ? 'btn-ok2' : 'btn-gh'}" data-act="nbToggle">
          ${Store.nbHas(w.w) ? '✓ 已在生词本' : '+ 生词本'}</button>
        <button class="btn btn-xs btn-gh" data-act="skip">跳过 →</button>
      </div>
      <div style="text-align:center;padding:14px 0">
        <div class="hint">根据音标和中文释义拼写</div>
        <div class="wcard-ph" style="font-size:20px;margin:14px 0">${esc(w.ph || '（暂无音标）')}</div>
        <div class="wcard-cn" style="margin:0 0 12px">${esc(meanings.join('；') || '（暂无中文释义）')}</div>
        <button class="play-btn wcard-say" data-act="say" title="播放单词读音" aria-label="播放单词读音" style="margin:12px auto;display:flex">
          <svg viewBox="0 0 24 24" class="ic" style="width:26px;height:26px"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
        </button>
      </div>
      <input class="spelling-inp" id="spellInput" placeholder="拼写..." autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="row" style="margin-top:18px;justify-content:center">
        <button class="btn btn-pri btn-lg" data-act="spellCheck">提交</button>
      </div>
      <div class="row" style="margin-top:16px;justify-content:center;gap:8px">
        <span class="hint">今日学习优先</span>
        <button class="btn btn-xs ${this.spellOrder === 'time' ? 'btn-pri' : 'btn-gh'}" data-act="spellOrder" data-order="time">按时间</button>
        <button class="btn btn-xs ${this.spellOrder === 'random' ? 'btn-pri' : 'btn-gh'}" data-act="spellOrder" data-order="random">乱序</button>
      </div>
      <div id="spellFb" style="margin-top:14px"></div>
    </div>`;
  },

  _detailHTML(w, rec) {
    const ai = w.phr || [];
    const aiData = this._detailCache && this._detailCache[w.w];
    const meanings = typeof Dict.meaningRows === 'function' ? Dict.meaningRows(w) : (w.tr || []);
    return `
    <div class="grid g2">
      <div class="card">
        <div class="card-b wdetail">
          <div class="wdetail-head">
            <span class="w">${esc(w.w)}</span>
            <span class="ph">${esc(w.ph || '')}</span>
            <button class="btn btn-xs btn-gh" data-act="say">🔊</button>
            ${Store.nbHas(w.w) ? '<span class="tag tag-ok">已在生词本</span>' :
        `<button class="btn btn-xs btn-gh" data-act="nb">+ 生词本</button>`}
          </div>
          ${(() => {
            const E = this._engine(); const slot = this.cur && this.cur.slot;
            if (!E || !slot || slot.free) return '';
            const st = E.stateOf(slot.wordId, slot.senseId, false);
            if (!st) return '';
            const et = st.errorTypes || {};
            const names = { polysemy: '多义混淆', confusable: '形近混淆', forgotten: '遗忘', timeout: '超时' };
            const errs = Object.keys(et).filter(k => et[k]).map(k => names[k] + ' ' + et[k]);
            return `<div class="hint" style="margin-top:6px">引擎状态：<b>${E.levelName(st.level)}</b>
              　作答 ${st.attempts || 0} 次　错 ${st.errors || 0} 次
              ${errs.length ? '（' + errs.join('；') + '）' : ''}
              ${st.nextDueAt ? '　下次复习 ' + esc(st.nextDueAt) : ''}</div>`;
          })()}
          <div class="sec-t">核心释义</div>
          ${meanings.map(t => `<div class="pos-line"><span class="t">${esc(t.t || '释义')}</span><span>${esc(t.d)}</span></div>`).join('') || '<div class="hint">本地词库无释义，可点击下方"AI 智能解析"获取。</div>'}
          ${ai.length ? `<div class="sec-t">固定搭配</div>
            <div>${ai.map(p => `<span class="chip" data-act="sayPhrase" data-p="${esc(p.p)}">${esc(p.p)} <span style="color:var(--tx3);font-size:11.5px">${esc(p.d)}</span></span>`).join('')}</div>` : ''}
          ${w.ex && w.ex.length ? `<div class="sec-t">例句</div>
            ${w.ex.map(e => `<div class="ex-item">${esc(e.en)}<div class="cn">${esc(e.cn)}</div></div>`).join('')}` : ''}
          ${aiData && aiData.root ? `<div class="sec-t">词根词缀</div><div style="font-size:13.5px">${esc(aiData.root)}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-h">AI 智能解析<span class="r">
          <button class="btn btn-xs btn-pri" data-act="aiDetail">${aiData ? '重新解析' : '开始解析'}</button></span></div>
        <div class="card-b" id="aiBox">
          ${aiData ? aiDetailHTML(aiData) : `<div class="empty"><p>点击「开始解析」获取：词根词缀、近反义词、<br>近年常见搭配与语境释义</p></div>`}
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:14px;justify-content:center">
      <button class="btn btn-gh" data-act="say">🔊 再听一遍</button>
      <button class="btn btn-gh" data-act="prevWord">← 上一个</button>
      <button class="btn btn-pri btn-lg" data-act="nextWord">下一个 →</button>
    </div>`;
  },

  /* ---------- 交互 ---------- */
  /* ---------- 答题计时（§7.1）----------
   * 计时从"题目渲染完成"开始；教学卡不计时；到时限前端自动交卷并上报 timedOut。
   * 倒计时写在选项卡原有的提示标签旁边（不改版式，只多一个 tag）。*/
  _clearQTick() {
    if (this._qTimer) { clearTimeout(this._qTimer); this._qTimer = null; }
    if (this._qTick) { clearInterval(this._qTick); this._qTick = null; }
  },
  _startQTick() {
    this._clearQTick();
    const E = this._engine();
    const slot = this.slots[this.qi];
    const w = this.cur && this.cur.w;
    if (!E || !slot || slot.free || !w) return;
    const st = E.stateOf(slot.wordId, slot.senseId, false);
    const level = st ? st.level : 0;
    let limit = E.timeLimit(level);
    /* 选项越长越需要阅读时间：4 个整行英文释义时 5 秒根本读不完（走查里
     * 真的出现超时判错）。按选项总字数给 5 秒档加一点阅读余量，最多 +5 秒。*/
    try {
      const chars = [...document.querySelectorAll('#view .choice')]
        .reduce((n, el) => n + String(el.innerText || '').trim().length, 0);
      if (limit <= 5000 && chars > 120) limit += Math.min(5000, Math.round((chars - 120) * 35));
    } catch (e) { /* 拿不到选项就按原限时 */ }
    this._qLimit = limit;
    this._qStart = Date.now();
    const el = () => document.getElementById('qTime');
    const paint = () => {
      const box = el();
      const bar = document.getElementById('qBar');
      const leftMs = Math.max(0, limit - (Date.now() - this._qStart));
      if (bar) {
        bar.style.width = Math.round(leftMs / limit * 100) + '%';
        bar.style.background = leftMs / limit < 0.3 ? 'var(--warn)' : '';
      }
      if (!box) return;
      box.textContent = '限时 ' + Math.ceil(leftMs / 1000) + 's';
      box.className = 'tag ' + (leftMs <= 3000 ? 'tag-warn' : '');
    };
    paint();
    this._qTick = setInterval(paint, 250);
    this._qTimer = setTimeout(() => { this._answer(-1, true); }, limit);
  },
  _bindStudy() {
    const root = $('#view');
    Speech.stop();

    on(root, 'click', '[data-act]', (e, t) => this._onAct(t.dataset.act, t));
    on(root, 'click', '[data-grade]', (e, t) => this._grade(+t.dataset.grade));
    on(root, 'click', '.choice', (e, t) => {
      if (t.classList.contains('lock')) return;
      this._answer(+t.dataset.i);
    });

    // 拼写
    const inp = $('#spellInput');
    if (inp) {
      setTimeout(() => inp.focus(), 60);
      inp.onkeydown = ev => { if (ev.key === 'Enter') this._spellCheck(); };
    }
    if (this.phase === 'choice') this._startQTick();
    // 自动发音
    if (this.phase === 'spell') {
      const wordKey = `${this.book.id}:${this.cur.w.w}`;
      if (this._spellAutoKey !== wordKey) {
        this._spellAutoKey = wordKey;
        setTimeout(() => {
          if (this.phase === 'spell' && this.cur && `${this.book.id}:${this.cur.w.w}` === wordKey) this._sayCur(true);
        }, 300);
      }
    }
  },

  async _onAct(act, t) {
    switch (act) {
      case 'back': this._logSession(); this._logged = true; this._renderShell($('#view')); break;
      case 'say': {
        // 复用统一入口：内部会先stop 再播，并点亮音标
        this._sayCur(false);
        break;
      }
      case 'spellOrder': {
        const order = t.dataset.order === 'random' ? 'random' : 'time';
        if (order === this.spellOrder) break;
        this.spellOrder = order;
        const completed = this.queue.slice(0, this.qi);
        const current = this.queue[this.qi] ? [this.queue[this.qi]] : [];
        const remaining = this._arrangeSpell(this.queue.slice(this.qi + 1), order);
        this.queue = this._dedupeQueue(completed.concat(current, remaining));
        $$('[data-act="spellOrder"]').forEach(button => {
          button.className = `btn btn-xs ${button.dataset.order === order ? 'btn-pri' : 'btn-gh'}`;
        });
        break;
      }
      case 'sayPhrase': Speech.speak(t.dataset.p); break;
      /* 【修复：跳过与"不认识"必须提交 SRS】
       * 原来这两个分支只是推进队列，不写任何学习记录：
       *   - skip：直接 _next()
       *   - no：只 this.revealed = true（显示答案）
       * 结果这些词在 srs 里永远没有记录，
       * _newWords() 的过滤条件 `!recs[w] || !recs[w].reps` 判定它们还是"新词"，
       * 于是下次打开又排在最前面 —— 表现为"每次新学都是同样的单词"。
       *
       * 现在：跳过 = 记为 grade 1（模糊）；看过答案 = grade 0（忘了）。
       * grade 0 会安排 10 分钟后重来，符合遗忘曲线预期。
       */
      case 'skip': {
        /* 跳过 = 不主动教学，但进抽检池保留复现路径（§6-#2）。不再写"模糊"的 SRS 记录。*/
        const slot = this.cur && this.cur.slot;
        const E = this._engine();
        if (E && slot) { E.skipSlot(slot.wordId, slot.senseId); this._mirrorSrs(); }
        else {
          const w = this.cur && this.cur.w;
          if (w) {
            const rec = Store.srsOf(this.book.id, w.w) || { word: w.w };
            Store.srsUpdate(this.book.id, w.w, SRS.schedule(rec, 1));
          }
        }
        this._advance();
        break;
      }
      case 'hint': {
        const w = this.cur.w;
        App.toast(`${w.w.length} 个字母，首字母 ${w.w[0]}`);
        break;
      }
      case 'no': {
        /* 点"不认识"→ 揭晓释义（教学卡阶段，不计分）。之后用下面的 0~3 自评决定去向：
         * 自评"不认识/模糊" → 引擎安排本轮重考；自评"认识/很熟" → 只能进抽检池（§6-#2）。*/
        this.revealed = true;
        this._forceSay = true;
        this._badCount = (this._badCount || 0) + 1;
        this._renderStudy();
        break;
      }
      /* 下面几个都是"用户主动操作"：认识 / 熟悉 / 词条详情 / 上一个词，
       * 每次都重新朗读当前单词——这是背单词该有的手感（点一下就再听一遍）。*/
      case 'know': this.phase = 'choice'; this._forceSay = true; this._renderStudy(); break;
      case 'familiar': this._forceSay = true; this._grade(3, true); break;
      case 'detail': this.phase = 'detail'; this._forceSay = true; this._renderStudy(); break;
      case 'prevWord': this.qi = Math.max(0, this.qi - 1); this.phase = 'card'; this.revealed = false; this._forceSay = true; this._renderStudy(); break;
      case 'nextWord': this._next(); break;
      case 'spellCheck': this._spellCheck(); break;
      case 'nb': this._addNb(this.cur.w); break;
      case 'nbToggle': this._nbToggle(this.cur.w); break;
      case 'dunno': this._answer(-1); break;   // 直接看答案，按答错记
      case 'continue': this.phase = 'detail'; this._renderStudy(); break;
      case 'aiDetail': await this._aiDetail(this.cur.w); break;
    }
  },

  _grade(g, showDetails = false) {
    this._clearQTick();
    const w = this.cur.w;
    /* 幂等保护：同一道题只判一次；换题后 token 变化，重考题可以正常作答 */
    if (this._answeredFor === this._qSeq) {
      if (showDetails) { this.phase = 'detail'; this._renderStudy(); }
      return;
    }
    this._answeredFor = this._qSeq;

    const slot = this.cur.slot;
    const E = this._engine();
    const Q = this._quiz();
    if (E && slot) {
      if (g >= 2) {
        /* §6-#2 用户自评"我认识"：只能置 L3 + 进抽检池 —— 抽检错会被打回 L2，
         * 不允许把"看了答案觉得眼熟"直接当已掌握。*/
        E.selfRateKnown(slot.wordId, slot.senseId);
      } else {
        /* 自评"不认识 / 模糊" = 教学卡看完；引擎会在本轮安排一次重考（不计错误率） */
        E.teachingReveal(slot.wordId, slot.senseId);
      }
      this._mirrorSrs();
    } else {
      const rec = Store.srsOf(this.book.id, w.w) || { word: w.w };
      Store.srsUpdate(this.book.id, w.w, SRS.schedule(rec, g));
    }
    if (g >= 2 && typeof Garden !== 'undefined') Garden.noteWord(w.w, this.book.id);
    if (g >= 2) {
      Store.addStat('words', 1);
      this._goodCount = (this._goodCount || 0) + 1;
      if (!Store.nbHas(w.w) && g === 3) this._addNb(w, true);
    } else this._badCount = (this._badCount || 0) + 1;
    if (showDetails) {
      this.phase = 'detail';
      this._renderStudy();
    } else this._advance();
  },

  _answer(i, auto) {
    this._clearQTick();
    const c = this.cur.opts, w = this.cur.w, slot = this.cur.slot;
    const right = i >= 0 && i === c.answer;
    $$('.choice').forEach((el, k) => {
      el.classList.add('lock');
      if (k === c.answer) el.classList.add('right');
      else if (k === i) el.classList.add('wrong');
    });
    if (this._answeredFor === this._qSeq) return;
    this._answeredFor = this._qSeq;
    /* 无论答对答错，都显示"其他选项"对应的英文单词：
     * 答错时用来解释每条释义属于哪个词；答对时用来顺便认识干扰词。*/
    $$('.choice').forEach((el, k) => {
      if (k !== c.answer && el.dataset.word) el.classList.add('reveal-word');
    });

    const E = this._engine(), Q = this._quiz();
    const responseMs = Math.max(0, Date.now() - (this._qStart || Date.now()));
    let fb = null;
    if (E && slot) {
      const entry = Q ? Q.entryOf(this.book, w) : null;
      if (slot.free) {
        /* 随机练习这类"轮外"作答：同一套迁移，但不进轮统计 */
        const freeRes = E.gradeFree({ wordId: slot.wordId, senseId: slot.senseId, correct: right, responseMs, entry });
        this._noteFreeResult(freeRes, slot.wordId, slot.senseId);
      } else {
        const res = E.grade({
          wordId: slot.wordId, senseId: slot.senseId, role: slot.role,
          correct: right, responseMs,
          selectedOptionId: (i >= 0 && c.ids && c.ids[i]) ? c.ids[i] : null,
          answered: i >= 0,
          entry,
        });
        fb = res.feedback;
        /* §7.2 心理干预：连续两错后引擎已插入恢复题 / 或要求直接看答案 */
        if (res.intervene) {
          if (res.intervene.mode === 'recovery') App.toast('先回一道熟词找找手感', '');
          else if (!right) App.toast('别急，先看清楚这个释义', '');
        }
        if (res.truncated) App.toast('这轮有点吃力，剩下的新词明天继续', '');
      }
      this._mirrorSrs();
    } else {
      const rec = Store.srsOf(this.book.id, w.w) || { word: w.w };
      Store.srsUpdate(this.book.id, w.w, SRS.schedule(rec, right ? 2 : 0));
    }
    if (right) {
      Store.addStat('words', 1);
      this._goodCount = (this._goodCount || 0) + 1;
      if (typeof Garden !== 'undefined') Garden.noteWord(w.w, this.book.id);
    } else {
      this._badCount = (this._badCount || 0) + 1;
      if (!Store.nbHas(w.w)) this._addNb(w, true);
    }
    const msg = auto ? '超时未作答（本题按错处理）'
      : right ? '回答正确'
        : (fb && fb.timedOut ? '超时了，答案是：' : '正确答案：') + c.opts[c.answer];
    App.toast(msg, right ? 'ok' : 'err');
    const dunnoBtn = $('.choice-dunno');
    if (dunnoBtn) dunnoBtn.style.display = 'none';
    if (right) {
      /* 答对：留 1.5 秒看"其他选项的英文单词"，再自动进入词条详情 */
      setTimeout(() => {
        this.phase = 'detail';
        this._detailCache = this._detailCache || {};
        this._renderStudy();
      }, 1500);
    } else {
      /* 答错 / 不认识：停在本题，让用户看完正确答案与其他选项的英文词，
       * 点"继续 →"后再进入词条详情（避免还没看清就跳走）。*/
      const cont = $('.choice-continue');
      if (cont) cont.style.display = '';
    }
  },

  _spellCheck() {
    const inp = $('#spellInput');
    if (!inp) return;
    const w = this.cur.w;
    const val = inp.value.trim().toLowerCase();
    const fb = $('#spellFb');
    if (!val) { App.toast('请先拼写', ''); return; }
    const right = val === w.w.toLowerCase();
    const E = this._engine(), Q = this._quiz();
    let nr;
    if (E && Q && this.cur.slot) {
      /* 拼写属于"主动回忆"：答对按限时内答对记 1.0，答错记 0，迁移规则与轮内一致 */
      const spellRes = E.gradeFree({
        wordId: this.cur.slot.wordId, senseId: this.cur.slot.senseId,
        correct: right, responseMs: 3000, entry: Q.entryOf(this.book, w),
      });
      this._noteFreeResult(spellRes, this.cur.slot.wordId, this.cur.slot.senseId);
      this._mirrorSrs();
      nr = Store.srsOf(this.book.id, w.w) || {};
    } else {
      const rec = Store.srsOf(this.book.id, w.w) || { word: w.w };
      nr = SRS.schedule(rec, right ? 3 : 0);
      Store.srsUpdate(this.book.id, w.w, nr);
    }
    if (right) {
      Store.addStat('words', 1);
      fb.innerHTML = `<div class="tipbox" style="border-left-color:var(--ok);background:var(--ok-l)">
        ✓ 拼写正确！${esc(w.tr && w.tr[0] ? w.tr[0].d : '')}　下次复习：${SRS.describe(nr)}</div>`;
      setTimeout(() => this._next(), 1000);
    } else {
      fb.innerHTML = `<div class="tipbox" style="border-left-color:var(--err);background:var(--err-l)">
        ✗ 拼写错误。正确拼写：<b>${esc(w.w)}</b>　${esc(w.tr && w.tr[0] ? w.tr[0].d : '')}<br>
        <span class="hint">已记录，该词将在 10 分钟后重新出现。</span></div>`;
      inp.value = ''; inp.focus();
    }
  },

  /** 生词本按钮：一键加入 / 取消加入，带即时视觉反馈 */
  _nbToggle(w) {
    const has = Store.nbHas(w.w);
    if (has) {
      Store.nbRemove(w.w);
      App.toast(`已从生词本移除 ${w.w}`, '');
    } else {
      this._addNb(w);
      // 记录到树园（种树系统会用到）
      if (typeof Garden !== 'undefined') Garden.noteWord(w.w, this.book.id);
    }
    // 只重绘按钮本身，避免整卡刷新打断当前学习状态
    const btn = $('[data-act="nbToggle"]');
    if (btn) {
      btn.innerHTML = Store.nbHas(w.w) ? '✓ 已在生词本' : '+ 生词本';
      btn.className = 'btn btn-xs ' + (Store.nbHas(w.w) ? 'btn-ok2' : 'btn-gh');
    }
  },

  /** 本模块停留秒数（累计多次进出） */
  _pageSeconds() {
    this._accSeconds = (this._accSeconds || 0) + App.pageSeconds();
    App.resetPageTimer();
    return this._accSeconds;
  },

  /** 结束一轮学习：记录时长与掌握正确率，供树园评估当日成长质量 */
  _logSession() {
    const rep = this._roundReport();
    const total = rep ? rep.total : (this.queue || []).length;
    if (!total) return;
    const good = rep ? rep.correct : (this._goodCount || 0);
    Store.logActivity({ kind: 'words', seconds: this._pageSeconds(), correct: good, total });
    /* 正向框架：只报"征服 / 抽检通过"，不报"错了几个" */
    const parts = ['本轮完成 ' + total + ' 词'];
    if (rep) {
      if (rep.upgraded.length) parts.push('升级 ' + rep.upgraded.length + ' 词');
      if (rep.quizzed.total) parts.push('抽检通过 ' + rep.quizzed.passed + '/' + rep.quizzed.total);
    }
    App.toast(parts.join(' · '), '');
  },

  _addNb(w, silent) {
    const ok = Store.nbAdd({
      w: w.w, ph: w.ph,
      tr: w.tr || [],
      phr: (w.phr || []).map(p => `${p.p} — ${p.d}`),
      root: '', extra: [],
      ex: w.ex && w.ex[0] ? `${w.ex[0].en}  ${w.ex[0].cn}` : '',
      srcTag: this.mode === 'review' ? '复习加入' : (this.mode === 'spell' ? '拼写错误' : '学习加入'),
      origin: `来自「${this.book.name}」学习流程（${modeName(this.mode)}），${App.today()} 学习时${this.mode === 'spell' ? '拼写错误自动收录' : '手动或自动加入'}`,
    });
    if (ok && !silent) App.toast('已加入生词本', 'ok');
  },

  async _aiDetail(w) {
    const box = $('#aiBox');
    box.innerHTML = `<div class="row" style="justify-content:center;padding:30px"><span class="spin"></span> <span class="dots">AI 解析中</span></div>`;
    const d = await AI.lookup(w.w, (w.ex && w.ex[0] ? w.ex[0].en : ''));
    this._detailCache = this._detailCache || {};
    this._detailCache[w.w] = d;
    box.innerHTML = aiDetailHTML(d);
    // 同步词根到生词本
    if (d.root || (d.collocation && d.collocation.length)) {
      const it = Store.d.notebook.find(x => x.w === w.w);
      if (it) { it.root = d.root || it.root; it.extra = (d.collocation || []).slice(0, 5); Store.flush(); }
    }
  },

  /** 推进到下一题：把刚完成的词位归档，再用引擎的当前队列重建（重考/恢复题已插好） */
  _advance() {
    this._clearQTick();
    const cur = this.slots[this.qi];
    const E = this._engine();
    /* 【消费当前词位】"熟悉 / 跳过 / 只看词条详情"这些操作不经过 E.grade，
     * 引擎轮里的词位不会被移除；重建队列时它又回到最前面，表现为
     * "点熟悉就一直循环背这个单词"（2026-10-23 用户反馈）。
     * 这里统一按对象身份把它从引擎当前轮里消费掉；已判分过的词位早已被
     * E.grade 移除，indexOf 找不到会安全返回 false。*/
    if (E && this.vocabRound && cur && !cur.free) E.consumeSlot(cur.wordId, cur.senseId, cur);
    if (cur && !(this._doneSlots || []).includes(cur)) this._doneSlots = (this._doneSlots || []).concat([cur]);
    let rest;
    if (E && this.vocabRound) {
      const live = E.load().round;
      rest = (live && live.roundId === this.vocabRound.roundId) ? live.slots.slice() : [];
    } else {
      rest = this.slots.slice(this.qi + 1);
    }
    this._applyEngineQueue(rest);
    this.qi = (this._doneSlots || []).length;
    this.revealed = false;
    this.phase = this.mode === 'spell' ? 'spell' : 'card';
    if (this.qi >= this.slots.length) this._finish();
    else this._renderStudy();
  },
  _next() { this._advance(); },

  _finish() {
    this._clearQTick();
    const root = App.freshView();
    // 完成整轮 → 记录本轮时长与认识率
    if (!this._logged) { this._logSession(); this._logged = true; }
    const E = this._engine();
    const rep = this._roundReport();
    const engStats = E ? E.stats() : null;
    const srsAll = Store.d.srs[this.book.id] || {};
    const learned = engStats ? engStats.learned : Object.keys(srsAll).filter(k => srsAll[k].reps > 0).length;
    const mastered = engStats ? engStats.mastered
      : Object.keys(srsAll).filter(k => (srsAll[k].interval || srsAll[k].gap * 864e5 || 0) >= 21 * 864e5).length;
    const nameOf = id => esc(String(id).split(':').pop());
    root.innerHTML = `
    <div class="card" style="max-width:640px;margin:32px auto;text-align:center;padding:32px">
      <div style="font-size:48px;margin-bottom:6px">🎉</div>
      <h2 style="font-size:22px;margin-bottom:6px">本轮学习完成</h2>
      <p style="color:var(--tx2);margin-bottom:18px">
        你完成了 <b style="color:var(--pri)">${rep ? rep.total : this.queue.length}</b> 个词位
        ${rep && rep.upgraded.length ? `　·　<b style="color:var(--ok)">${rep.upgraded.length}</b> 个升级` : ''}
        ${rep && rep.quizzed.total ? `　·　抽检通过 <b>${rep.quizzed.passed}/${rep.quizzed.total}</b>` : ''}</p>
      <div class="grid g4" style="margin-bottom:18px">
        <div class="stat"><div class="k">本轮征服</div><div class="v" style="font-size:20px">${rep ? rep.total : this.queue.length}</div></div>
        <div class="stat"><div class="k">升级</div><div class="v" style="font-size:20px;color:var(--ok)">${rep ? rep.upgraded.length : 0}</div></div>
        <div class="stat"><div class="k">本轮正确率</div><div class="v" style="font-size:20px">${rep ? Math.round((1 - rep.roundErrorRate) * 100) : '—'}%</div></div>
        <div class="stat"><div class="k">待复习</div><div class="v" style="font-size:20px;color:var(--warn)">${this._dueWords().length}</div></div>
      </div>
      ${rep && rep.upgraded.length ? `
      <div class="sec-t" style="text-align:left">本轮升级</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${rep.upgraded.slice(0, 14).map(u => `<span class="chip">${nameOf(u.wordId)}</span>`).join('')}
        ${rep.upgraded.length > 14 ? '<span class="chip">…</span>' : ''}</div>` : ''}
      ${rep && rep.nextRoundFocus.length ? `
      <div class="sec-t" style="text-align:left">下轮优先（难词 / 到期）</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${rep.nextRoundFocus.slice(0, 12).map(id => `<span class="chip">${nameOf(id)}</span>`).join('')}</div>` : ''}
      ${rep && rep.truncated ? '<div class="tipbox" style="margin-bottom:16px">这轮有点吃力，剩下的新词已顺延到下一轮</div>' : ''}
      <div class="hint" style="margin-bottom:18px">本词书已学 ${learned} · 已掌握 ${mastered} · 待复习 ${this._dueWords().length}</div>
      <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px">
        <button class="btn btn-gh btn-lg" data-act="back">返回词书</button>
        <button class="btn btn-pri btn-lg" data-act="more">继续学习 →</button>
        <button class="btn btn-gh btn-lg" data-act="spell">再来一组拼写</button>
      </div>
    </div>`;
    on(root, 'click', '[data-act]', (e, t) => {
      if (t.dataset.act === 'back') this._renderShell($('#view'));
      else if (t.dataset.act === 'more') this._begin('smart');
      else this._begin('spell');
    });
  },
};

function bk0name(b) { const m = BOOKS.find(x => x.id === b.id); return m ? m.name : b.name; }

/**
 * 预览「将跳过哪些词」——纯计算，不写数据，等用户确认后才落盘。
 * 词库在运行时已按词频降序排列（dict.js: words.sort((a,b)=>b.freq-a.freq)），
 * 因此数组尾部 = 词频最低 = 最基础/common 的词，正是应该跳过的部分。
 * 比例设计与 Store.applyTestSkip 保持一致。
 */
/**
 * 词汇量测试 → 规划「跳过哪些简单词」
 *
 * 【关键修复】原来按"词频列表末尾 N 个"来跳，导致：
 *   - 跳的范围不一定是真正的简单词（可能跳过生僻长尾，也可能漏掉高频基础词）
 *   - 用户诉求是覆盖**小学/初中/高中**基础词
 * 现在改为：先把**显式基础词表**（小学~高中核心词）全部纳入跳过集，
 * 再按正确率决定是否额外跳过低频长尾词。
 */
function skipPlan(rate, book) {
  const words = book.words, N = words.length;
  const r = Math.max(0, Math.min(1, rate));

  // 1) 基础词（小学/初中/高中）无条件纳入
  let skipSet = new Set();
  if (typeof WordLevel !== 'undefined') {
    const base = WordLevel.skipSetOf(words, { tailSkip: 0 });
    skipSet = new Set(base);
  }

  // 2) 按正确率决定是否额外跳过低频长尾词
  //    正确率越高说明基础越好→ 可以多跳一些生僻词
  const extraRatio = r >= 0.9 ? 0.18 : r >= 0.75 ? 0.12 : r >= 0.6 ? 0.07
    : r >= 0.45 ? 0.03 : 0;
  if (extraRatio > 0) {
    const tail = words.slice()
      .filter(w => !skipSet.has(w.w))
      .sort((a, b) => (a.freq || 0) - (b.freq || 0))
      .slice(0, Math.floor(N * extraRatio));
    tail.forEach(w => skipSet.add(w.w));
  }

  const skipped = words.filter(w => skipSet.has(w.w));
  return {
    count: skipped.length,
    threshold: skipped.length ? (skipped[0].freq || 0) : 0,
    samples: skipped.slice(0, 40).map(w => w.w),
    byLevel: typeof WordLevel !== 'undefined' ? WordLevel.statsOf(skipped) : null,
    ratio: N ? skipped.length / N : 0,
  };
}
function modeName(m) {
  return { smart: '智能模式', new: '新词学习', review: '复习巩固', random: '随机练习', spell: '拼写练习' }[m] || m;
}
function aiDetailHTML(d) {
  if (!d) return '';
  const sec = (t, arr, cls) => (arr && arr.length)
    ? `<div class="sec-t">${t}</div><div>${arr.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : '';
  // partial=true 表示这是本地词典的即时结果，AI 数据尚未到达
  if (d.partial) {
    return `
  <div style="font-size:24px;font-weight:800;font-family:Georgia,serif">${esc(d.word)}</div>
  <div class="an-ph">${esc(d.phonetic || '')}</div>
  ${d.pos && d.pos.length ? `<div class="sec-t">释义（本地词典）</div>
    ${d.pos.map(p => `<div class="pos-line"><span class="t">${esc(p.t || '释义')}</span><span>${esc(p.d)}</span></div>`).join('')}` : ''}
  ${sec('固定搭配（本地）', d.collocation)}
  ${d.example && d.example.en ? `<div class="sec-t">例句（本地）</div>
    <div class="ex-item">${esc(d.example.en)}<div class="cn">${esc(d.example.cn || '')}</div></div>` : ''}
  <div class="hint" style="margin-top:10px">以上为本地词典即时结果（&lt; 50ms）。词根、近反义和常见用法等由 AI 补充；当前没有联网核验具体真题出处。</div>`;
  }
  return `
  <div style="font-size:24px;font-weight:800;font-family:Georgia,serif">${esc(d.word)}</div>
  <div class="an-ph">${esc(d.phonetic || '')}</div>
  ${d.pos && d.pos.length ? `<div class="sec-t">释义</div>
    ${d.pos.map(p => `<div class="pos-line"><span class="t">${esc(p.t || '释义')}</span><span>${esc(p.d)}</span></div>`).join('')}` : ''}
  ${d.origin ? `<div class="sec-t">语境含义</div><div style="font-size:13.5px;color:var(--tx2);line-height:1.7">${esc(d.origin)}</div>` : ''}
  ${sec('固定搭配', d.collocation)}
  ${sec('近年常见用法', d.recent)}
  ${sec('近义词', d.synonym)}
  ${sec('反义词', d.antonym)}
  ${d.root ? `<div class="sec-t">词根词缀</div><div style="font-size:13.5px">${esc(d.root)}</div>` : ''}
  ${d.example && d.example.en ? `<div class="sec-t">例句</div>
    <div class="ex-item">${esc(d.example.en)}<div class="cn">${esc(d.example.cn || '')}</div></div>` : ''}
  ${d.easy ? `<div class="tipbox" style="margin-top:12px"><b>一句话记忆</b><br>${esc(d.easy)}</div>` : ''}
  <div class="ai-source-note">${d.degraded
    ? '来源核验：当前显示的是本地词典或降级结果，未核验外部资源。'
    : '来源核验：以上为 AI 生成的语言分析；本应用未联网检索，具体真题年份、出处和外部资源尚未核验。请以可追溯的原卷或官方发布为准。'}</div>`;
}
window.ViewVocab = ViewVocab;
