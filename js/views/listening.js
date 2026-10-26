/* ============ views/listening.js : 听力模块 ============ */
/**
 * 听力起始缓冲（毫秒）。
 * 【这是听力独有的产品需求，不是引擎慢】点播放后先缓冲一下再开口，
 * 让眼睛先找到第一句、耳朵也准备好（用户明确要求保留约 2 秒）。
 * 与背单词无关：背单词走 speakWord 通道，点了立刻读、没有缓冲。
 * 数值可在设置页「听力发音 → 起始缓冲」里调整，默认 2 秒。
 */
function listenLeadInMs() {
  const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
  const sec = s.listenLeadIn == null ? 2 : Number(s.listenLeadIn);
  if (!Number.isFinite(sec)) return 2000;
  return Math.round(Math.max(0, Math.min(5, sec)) * 1000);
}
/**
 * 把一句话按标点切成小段，用于「逐分句朗读」。
 *
 * 【为什么要切】
 * 真人说话会在逗号处换气、句末落下语调。
 * 整句一次性朗读虽然省事，但听起来平、像在念稿——这正是"人机感"的来源。
 * 切成小段后逐段播、段间留短停顿，语气自然度明显提升，
 * 而且**不依赖 SSML**（Web Speech API 根本不支持 SSML）。
 *
 * 切分点与停顿时长（按真人口语习惯）：
 *   逗号 , → 80ms   顿号 、 → 70ms
 *   分号 ; → 110ms  冒号 : → 110ms
 *   破折号 —— → 130ms
 *   句末 . ! ? 留在同一次语音合成中，由语音引擎处理自然停顿
 *
 * @param {string} text
 * @returns {Array<{text:string, gap:number}>}
 */
function splitClauses(text) {
  const s = String(text || '');
  if (!s.trim()) return [{ text: '', gap: 0 }];
  /* 很短的句子整体读更自然——切成 "Hi," / " there." 两段反而
   * 会出现两段之间多余的停顿，听感割裂。*/
  if (s.length <= 28) return [{ text: s, gap: 0 }];

  const out = [];
  let buf = '';
  /* 句末标点不拆成新的 speech utterance：一些浏览器语音引擎在新 utterance
   * 开头会漏掉第一个词（例如 "everything. Just bring..." 中的 Just）。
   * 句号/问号/感叹号保留在文本内，让引擎在同一段朗读中处理句间停顿。
   * 内部标点仍可切分长句，以保留自然换气和逐词高亮节奏。*/
  const PUNCT = [
    [',', 80], ['，', 80], ['、', 70],
    [';', 110], ['；', 110], [':', 110], ['：', 110],
    ['—', 130], ['–', 110],
  ];
  // 太短的分句另起一次 speechSynthesis.speak() 时，部分语音引擎会吞掉开头音节；
  // 保留在同一语音请求中，让短语（如 "Oh, I see."）连续朗读。
  const MIN_CLAUSE_LENGTH = 12;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    const hit = PUNCT.find(([p]) => p === ch);
    // 两侧都保留足够长的语音片段，避免短音节另起一次合成后被吞
    if (hit && buf.trim().length >= MIN_CLAUSE_LENGTH
      && s.slice(i + 1).trim().length >= MIN_CLAUSE_LENGTH) {
      out.push({ text: buf, gap: hit[1] });
      buf = '';
    }
  }
  if (buf.trim()) out.push({ text: buf, gap: 0 });
  return out.length ? out : [{ text: s, gap: 0 }];
}

/* ============ 听力修复：可单测的纯函数 ============ */
/**
 * 判断一篇材料是否属于“对话类”（长对话/短对话）。
 * 【为什么需要】没有 M/W 标注且 AI 识别失败时，独白必须全篇同一音色；
 * 对话则应按轮次男女交替——旧版对独白也交替，一段一个人的材料被读成两个人在对话。
 * 判据来自材料自身字段与页面推导出的题型（如 Section A → 长对话）。
 */
function isDialogueMaterial(paper, kindHint) {
  if (!paper) return false;
  const parts = [kindHint, paper.type, paper.genre, paper.title,
    paper.listeningType, paper.sectionType, paper.listeningGenre];
  const text = parts.filter(Boolean).map(String).join(' ').toLowerCase();
  return /conversation|dialogue|对话/.test(text);
}

/** 按行交替分配男女声：第 1 行（下标 0）男声，第 2 行女声…… */
function alternateGenders(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const out = [];
  for (let i = 0; i < n; i++) out.push(i % 2 === 0 ? 'male' : 'female');
  return out;
}

/** 空解析兜底：至少给「正确答案：B. 选项原文」，不再留一个空的“解析”蓝框。 */
function listenExplainFallbackHTML(q, note) {
  const opts = Array.isArray(q && q.opts) ? q.opts : [];
  const a = q && Number.isInteger(q.a) ? q.a : -1;
  const letter = a >= 0 && a < 26 ? String.fromCharCode(65 + a) : '';
  const answer = (a >= 0 && opts[a] != null && String(opts[a]).trim())
    ? '正确答案：' + (letter ? letter + '. ' : '') + esc(opts[a])
    : '正确答案暂缺';
  const tail = note ? '<br><span style="color:var(--tx3)">' + esc(note) + '</span>' : '';
  return '<div class="tipbox lsn-explain-fallback"><b>解析</b>　' + answer + tail + '</div>';
}

/** 校验 AI 给的 evidence 是否真能在原文里逐字找到；找不到就丢弃（绝不把编造的句子当依据）。 */
function listenEvidenceFromScript(evidence, scriptText) {
  const norm = s => String(s == null ? '' : s).toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim();
  const ev = String(evidence == null ? '' : evidence).trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!ev) return '';
  const needle = norm(ev), hay = norm(scriptText);
  if (!needle || !hay) return '';
  return hay.includes(needle) ? ev : '';
}

/** HTML 实体解码（网页抓取用；纯字符串处理，Node 自检可直接调用）。 */
function decodeHtmlEntities(s) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    copy: '©', reg: '®', trade: '™',
  };
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n < 0x10FFFF ? String.fromCodePoint(n) : m;
    })
    .replace(/&#(\d+);/g, (m, d) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) && n > 0 && n < 0x10FFFF ? String.fromCodePoint(n) : m;
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (m, name) => {
      const v = named[String(name).toLowerCase()];
      return v != null ? v : m;
    });
}

/**
 * 从网页 HTML 抽正文：去掉 script/style 等，把块级标签换成换行，再解实体、压缩空白。
 * 【为什么不用 DOMParser】APK 的 WebView 有 DOM，但 Node 自检没有；
 * 纯正则实现既能在浏览器跑，也能在 vm 里直接单测。
 */
function extractArticleText(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|template|svg|head|iframe|object|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // 未闭合的 script/style（网页被截断时）一直删到结尾，避免把 JS 当正文
  s = s.replace(/<(script|style|noscript|template|svg|head|iframe)\b[^>]*>[\s\S]*$/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|td|th|dd|dt|ul|ol|table)\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeHtmlEntities(s);
  s = s.replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '');
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const ViewListen = {
  kind: 'sentence',     // sentence | dialogue | cet6
  mode: 'read',         // read（改：可看原文、点击复现） | write（写：不显示原文）
  idx: 0,
  playing: false,
  curQ: 0,
  answers: {},
  submitted: false,
  _quizRevealed: false,

  render(root) {
    this._shell(root);
  },

  /** 本模块停留秒数（累计多次进出，避免切换页签丢失） */
  _pageSeconds() {
    this._accSeconds = (this._accSeconds || 0) + App.pageSeconds();
    App.resetPageTimer();
    return this._accSeconds;
  },

  /** 某套没有单独听力材料时，自动借用同场次第1/2套的听力，供第3套直接练习。*/
  _withSharedListening(pool) {
    const out = (pool || []).slice();
    const papers = (typeof Store !== 'undefined' && Store.d && Store.d.importedPapers) || [];
    const has = new Set(out.map(p => p.year + '|' + p.session + '|' + p.setNo));
    for (const paper of papers) {
      const setNo = Number(paper && paper.setNo);
      if (!setNo || !paper.year || !paper.session) continue;
      if (has.has(paper.year + '|' + paper.session + '|' + setNo)) continue;
      const donors = out.filter(p => p && p.year === paper.year && p.session === paper.session
        && p.setNo && Number(p.setNo) !== setNo);
      if (!donors.length) continue;
      const nums = donors.map(p => Number(p.setNo)).filter(Boolean);
      const donorSet = Math.min.apply(null, nums);
      const picked = donors.filter(p => Number(p.setNo) === donorSet);
      if (!picked.length) continue;
      picked.forEach((p, idx) => {
        out.push(Object.assign({}, p, {
          id: String(p.id || p.title || 'listening') + '-shared-' + setNo,
          setNo: setNo,
          no: idx + 1,
          sharedFromSet: donorSet,
          sharedListening: true,
        }));
      });
      has.add(paper.year + '|' + paper.session + '|' + setNo);
    }
    return out;
  },
  _shell(root) {
    root = App.freshView();
    /* 整页重建后，上一页的「局部重渲染目标」已脱离文档，必须清掉 */
    this._passBox = null;
    const L = Dict.content.listening;
    /* 长篇按年份/场次/篇章筛选。
     * cet4 与 cet6 走**完全相同**的结构与筛选路径，
     * 仅 level 标签与题目难度不同——这样界面、交互、配色天然一致。*/
    const type = ['cet6', 'cet4'].includes(this.kind) ? this.kind : null;
    let pool = L.passages;
    if (type) pool = pool.filter(p => p.type === type);
    else pool = pool.filter(p => p.type === 'dialogue');   // 对话/篇章听力用 dialogue 类
    if (type) {
      pool = this._withSharedListening(pool);
      /* 【补丁必须在这里叠加】导入后自动补全（js/listening-autofill.js）把原文/题干存在
       * Store.d.lsnPatch；补丁要赶在 Picker 计数与渲染之前生效，否则界面还按"原始导入数据"
       * 显示成"明明补过还是缺"。共享副本 id 形如 xxx-shared-2，模块内部会回退到原篇目补丁。*/
      this._applyPatches(pool);
    }
    const filt = type ? Picker.filter(pool, this.sel || { year: 'all', session: 'all', no: 'all' }) : pool;
    const shared = filt.find(p => p && p.sharedListening);
    this._sharedNote = shared
      ? `本套听力未单独提供（原卷说明与第 ${shared.sharedFromSet} 套相同），已自动使用第 ${shared.sharedFromSet} 套听力。答题/播放均按这套内容。`
      : '';
    this.pool = pool;
    this.shown = filt.length ? filt : pool;
    this.curPass = this.shown[0] || null;

    root.innerHTML = `
    <div class="phead">
      <button class="btn btn-gh btn-s" data-nav="home">← 返回首页</button>
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg></div>
      <div>
        <h1>听力 <span style="font-size:12px;color:var(--tx3);letter-spacing:2px">LISTENING</span></h1>
        <div class="sub">坚持精听精练，听见更大的世界！</div>
      </div>
      <div class="phead-r">
        <div class="mode-switch">
          <button class="${this.mode === 'read' ? 'on' : ''}" data-mode="read">📖 改</button>
          <button class="${this.mode === 'write' ? 'on' : ''}" data-mode="write">✍️ 写</button>
        </div>
        <span class="tag ${this.mode === 'read' ? 'tag-pri' : 'tag-warn'}">
          ${this.mode === 'read' ? '可看原文，点击复现' : '不显示原文，听写练习'}</span>
        <button class="btn btn-gh btn-s" data-act="import">📄 导入真题</button>
      </div>
    </div>

    <div class="lsn-tabs">
      ${[['sentence', '单句听力'], ['dialogue', '对话听力'], ['cet4', '四级听力'],
      ['cet6', '六级听力']]
        .map(([k, t]) => `<button class="btn btn-s ${this.kind === k ? 'btn-pri' : 'btn-gh'}" data-kind="${k}">${t}</button>`).join('')}
    </div>

    <div id="lsnPicker">${type ? Picker.html({
      items: pool, sel: this.sel || {}, unitWord: '篇',
      hint: '内置为仿真题，按真题「年份·场次·篇章」结构组织；也可导入自己的真题。',
      aiTip: '换年份/篇章后，当前作答会重置。',
    }) : ''}</div>

    ${this._sharedNote ? `<div class="tipbox" style="margin:10px 0;background:var(--warn-l)">${esc(this._sharedNote)}</div>` : ''}

    ${(type && this.shown.length > 1) ? `
    <div class="part-tabs">
      ${this.shown.map((p, i) => `
        <button class="part-tab ${i === 0 ? 'on' : ''}" data-pi="${i}">
          <span class="yr">${fullLabel(p.year, p.session)}</span>
          第${p.no || i + 1}篇 · ${esc((p.title || '').slice(0, 16))}${p.mine ? '（导入）' : ''}
        </button>`).join('')}
    </div>` : ''}

    <div id="lsnBody"></div>`;

    if (type) {
      Picker.bind(root, pool, this.sel || {}, s => {
        this.sel = s;
        this.answers = {}; this.submitted = false; this._quizRevealed = false; this.piPass = 0;
        this._shell(root);
      });
      on(root, 'click', '[data-pi]', (e, t) => {
        /* 切篇必须停掉上一篇正在朗读的语音，否则会继续播上一段。*/
        this._playAbort = true;
        this.playing = false;
        Speech.stop();
        $$('.part-tab', root).forEach(x => x.classList.toggle('on', x === t));
        this.piPass = +t.dataset.pi;
        this.answers = {}; this.submitted = false; this._quizRevealed = false;
        this._body();
      });
    }
    on(root, 'click', '[data-kind]', (e, t) => {
      this.kind = t.dataset.kind; this.idx = 0; this.curQ = 0;
      this.submitted = false; this.answers = {}; this._quizRevealed = false; this.sel = null;
      this._shell(root);
    });
    on(root, 'click', '[data-mode]', (e, t) => { this.mode = t.dataset.mode; this._quizRevealed = false; Speech.stop(); this._shell(root); });
    on(root, 'click', '[data-nav]', (e, t) => App.go(t.dataset.nav));
    // 男声 / 女声切换：**强制覆盖**材料的说话人标注（否则按钮点了没效果）
    on(root, 'click', '[data-spk]', (e, t) => {
      const g = t.dataset.spk;
      /* 再点一次当前选中的那个 = 取消强制，回到"按材料 M/W 标注分角色朗读"。
       * 过去只调 Speech.setGender()，而每一行都会传自己的 gender，
       * 于是按钮对带标注的对话（正是需要分角色的那类）完全无效。*/
      Speech._forceGender = (Speech._forceGender === g) ? '' : g;
      if (Speech._forceGender) Speech.setGender(g);
      const forced = !!Speech._forceGender;
      $$('[data-spk]').forEach(x => x.classList.toggle('on', forced && x.dataset.spk === g));
      const pool = Speech.voicesByGender(g).length;
      const name = g === 'male' ? '男声' : '女声';
      if (!forced) {
        App.toast('已取消强制：改为按对话里的说话人标注分角色朗读', '');
        return;
      }
      if (pool) {
        const v = Speech.pickVoice(null, g);
        App.toast(`已切换为${name}：${v ? v.name : '默认音色'}（全篇都用这个音色）`, '');
      } else {
        /* 系统没装该性别音色：按平台给可操作的安装指引。
         * 手机/平板不会在网页里下载语音包，所以不能再只写 Windows 的路径。*/
        const guide = Speech.voiceInstallGuide(g);
        App.modal(`系统缺少${name}音色`, `
          <p style="line-height:1.85;margin-bottom:14px">
            你的系统当前<b>没有安装${name}英语语音包</b>，已暂时使用最接近的音色代替。
            四六级听力考试录音多为<b>英式发音</b>，安装英式语音包后听感会更接近考试。
          </p>
          <div class="rule-box">
            <b>${esc(guide.title)}</b><br>
            ${guide.steps.map((s, i) => (i + 1) + '. ' + esc(s)).join('<br>')}
          </div>
          <div class="hint" style="margin-top:12px">
            ${esc(guide.note)}
          </div>
          <button class="btn btn-pri btn-blk" data-x style="margin-top:16px">知道了</button>`,
          bx => { bx.querySelector('[data-x]').onclick = App.closeModal; });
      }
    });
    on(root, 'click', '[data-act="import"]', () => Importer.open('listening'));

    this._body();
  },

  _body() {
    const box = App.freshNode('#lsnBody');
    if (!box) return;
    if (this.kind === 'sentence') this._sentence(box);
    else if (this.kind === 'dialogue') this._dialogue(box);
    else if (this.kind === 'cet4') this._cet4(box);
    else this._passage(box);
  },
  /* ---------- 四级听力 ----------
   * 数据已转成与六级完全同构的 passages 格式（type: 'cet4'），
   * 因此直接复用 _passage 的全部渲染与答题流程——
   * 布局层级、卡片样式、答题交互、状态标识、配色都与六级相同，
   * 只有题目难度与 level 标签不同。
   */
  _cet4(box) {
    return this._passage(box);
  },

  /* ---------- 单句听力 ---------- */
  /* ---------- 单句听力（含练习闭环）---------- */
  _sentence(box) {
    const arr = Dict.content.listening.sentences;
    if (!arr.length) { box.innerHTML = `<div class="empty"><p>暂无单句材料</p></div>`; return; }
    if (this.idx >= arr.length) this.idx = 0;
    const s = arr[this.idx];
    const q = (window.SentQuiz ? SentQuiz.getQuiz(arr)[this.idx] : null);
    this._sentQ = q;
    this._sentPick = null;

    box.innerHTML = `
    <div class="lsn-cols">
      <div class="lsn-left">
        <div class="card">
          <div class="card-h">第 ${this.idx + 1} / ${arr.length} 句
            <span class="tag tag-pri">单句听力</span>
            ${(s.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
            <span class="r">
              <button class="btn btn-xs btn-gh" data-act="prev">← 上一句</button>
              <button class="btn btn-xs btn-gh" data-act="next">下一句 →</button>
            </span></div>
          <div class="card-b">
            <div class="player">
              <button class="play-btn" data-act="play" title="按考场顺序播放：先原文，再逐题读题干">
                <svg viewBox="0 0 24 24" class="ic" style="width:26px;height:26px;fill:currentColor;stroke:none"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <div style="flex:1">
                <div class="wave">${Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:${i * .06}s"></i>`).join('')}</div>
                <div class="hint" style="margin-top:4px">点击播放后约 2 秒开始发声（语音准备时间）</div>
                <div class="hint" id="sentDirHint">先听音频，再作答</div>
                <div class="hint" id="voiceNow" style="margin-top:4px"></div>
                <div class="row" style="margin-top:10px">
                  <span class="seg" title="选择朗读音色">
                    <button class="mini-tab ${Speech.gender !== 'male' ? 'on' : ''}" data-spk="female">女声</button>
                    <button class="mini-tab ${Speech.gender === 'male' ? 'on' : ''}" data-spk="male">男声</button>
                  </span>
                  <select class="inp" id="spd" style="width:auto;padding:5px 9px;font-size:12px">
                    ${[0.6, 0.75, 0.9, 1, 1.15].map(r => `<option value="${r}"${Math.abs(r - (Store.d.settings.speechRate || 1)) < .05 ? ' selected' : ''}>${r}x</option>`).join('')}
                  </select>
                  <button class="btn btn-xs btn-gh" data-act="repeat">🔁 循环播放</button>
                  <button class="btn btn-xs btn-gh" data-act="stop">停止</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div id="scriptCard"></div>
      </div>

      <div class="lsn-right" id="sentQuizCard"></div>
    </div>`;

    this._script($('#scriptCard', box), s.en ? [{ sp: '', en: s.en, cn: s.cn }] : [], s.title);
    this._renderSentQuiz($('#sentQuizCard', box), arr, s);
    /* 播放区提示：这一句会用哪个音色（"人机声"必须当场看得见） */
    this._paintVoiceNow(box);
    this._bindCommon(box, s.en);
  },

  /** 单句听力的答题卡：**只有一个题型**——选出你听到的那句英文。
   *  【用户明确要求】右侧只要能"选该句的英文原句"，其余题型（中文选项、方向切换）都不要。
   *  听的是英文原句，四个选项都是英文句子（干扰项取自其他句子），考的是"听清整句"。
   */
  _renderSentQuiz(box, arr, s) {
    if (!box) return;
    const q = this._sentQ;
    if (!q) { box.innerHTML = '<div class="card"><div class="card-b hint">题目生成中…</div></div>'; return; }
    const submitted = this._sentSubmitted;
    const pick = q.pick || { opts: [], a: 0 };

    box.innerHTML = `
    <div class="card">
      <div class="card-h">单句练习
        <span class="r"><button class="btn btn-xs btn-gh" data-sq="toggleText">${submitted ? '🙈 隐藏原文' : '👁 显示原文'}</button></span>
      </div>
      <div class="card-b">
        <div class="q-item">
          <div class="qt">1. 选出你听到的英文句子（听音选句）</div>
          ${pick.opts.map((o, k) => {
      const cls = submitted ? (k === pick.a ? 'right' : (this._sentPick === k ? 'wrong' : '')) : (this._sentPick === k ? 'sel' : '');
      return `<div class="q-opt ${cls}" data-sq="pick" data-k="${k}"><span class="k">${'ABCD'[k]}</span><span>${esc(o)}</span></div>`;
    }).join('')}
        </div>

        <div class="row" style="margin-top:14px">
          <button class="btn btn-pri" data-sq="submit">${submitted ? '重新作答' : '提交答案'}</button>
          <button class="btn btn-gh" data-sq="skip">跳过这题</button>
        </div>

        <div id="sqFeedback">${submitted ? this._sentFeedbackHTML(pick, s) : ''}</div>

        ${this.mode === 'write' ? `
        <div class="sec-t">全文听写</div>
        <textarea class="inp" id="dictation" placeholder="听到什么就写什么，可写不确定的部分..." style="min-height:90px"></textarea>
        <button class="btn btn-gh" data-act="checkDict" style="margin-top:8px">对照批改</button>
        <div id="dictResult"></div>` : ''}
      </div>
    </div>`;

    on(box, 'click', '[data-sq]', (e, t) => {
      const a = t.dataset.sq;
      if (a === 'pick') {
        if (this._sentSubmitted) { App.toast('已提交，可点「重新作答」再改', ''); return; }
        this._sentPick = +t.dataset.k;
        $$('[data-sq="pick"]', box).forEach(x => x.classList.toggle('sel', +x.dataset.k === this._sentPick));
      } else if (a === 'submit') {
        if (this._sentPick == null) { App.toast('请先选择答案', ''); return; }
        this._sentSubmitted = true;
        this._renderSentQuiz(box, arr, s);
        App.toast('已提交', 'ok');
      } else if (a === 'skip') {
        this._sentSubmitted = false; this._sentPick = null;
        this.idx = (this.idx + 1) % arr.length;
        this._body();
      } else if (a === 'toggleText') {
        const sc = $('#scriptCard', box);
        if (sc) sc.style.filter = sc.style.filter ? '' : 'blur(4px)';
        t.textContent = t.textContent.includes('隐藏') ? '👁 显示原文' : '🙈 隐藏原文';
      }
    });
  },

  /** 播放区那行：本句会用哪个音色。
   *  【为什么写在卡片上】"单句听力还是人机声"必须当场能判断：是自动选到了本地音色，
   *  还是设置里某个下拉被钉成了本地音色。以前只能进设置页翻诊断，用户根本不知道去哪看。*/
  _paintVoiceNow(box) {
    const el = $('#voiceNow', box);
    if (!el || typeof Speech === 'undefined' || !Speech.previewVoice) return;
    const v = Speech.previewVoice({});
    if (!v) { el.textContent = ''; return; }
    const cloudReady = (Speech.list() || []).some(x => Speech._isCloud && Speech._isCloud(x));
    el.innerHTML = '🎙 本句音色：<b>' + esc(v.name) + '</b>（' + (v.cloud ? '云端神经音色' : '本地音色·机器声')
      + '　来源：' + esc(v.source) + '）'
      + ((!v.cloud && cloudReady) ? '　<button class="btn btn-xs btn-gh" data-act="cloudVoice">改用云端音色</button>' : '');
  },

  /** 单句练习的反馈 HTML（只讲这一题：正确项 + 原文/译文对照） */
  _sentFeedbackHTML(pick, s) {
    const ok = this._sentPick === pick.a;
    return `
    <div class="sq-fb">
      <div class="sq-line ${ok ? 'ok' : 'err'}">
        ${ok ? '✓' : '✗'} 听音选句${ok ? '答对' : '答错'}
        ${ok ? '' : `　正确答案：<b>${'ABCD'[pick.a]}. ${esc(pick.opts[pick.a])}</b>`}
      </div>
      <div class="sq-ref">
        <div><b>原文</b>　${esc(s.en)}</div>
        <div style="margin-top:4px"><b>译文</b>　${esc(s.cn)}</div>
      </div>
    </div>`;
  },

  /* ---------- 短对话 ---------- */
  _dialogue(box) {
    const L = Dict.content.listening;
    const arr = L.dialogues || [];
    if (!arr.length) { box.innerHTML = `<div class="empty"><p>暂无对话</p></div>`; return; }
    if (this.idx >= arr.length) this.idx = 0;
    const d = arr[this.idx];
    const turns = d.turns || [];

    box.innerHTML = `
    <div class="card">
      <div class="card-h">${esc(d.title || '短对话')}
        <span class="tag ${d.level === 'CET-4' ? 'tag-ok' : 'tag-pri'}">${esc(d.level || '对话')}</span>
        <span class="r">
          <button class="btn btn-xs btn-gh" data-act="prev">← 上一段</button>
          <button class="btn btn-xs btn-gh" data-act="next">下一段 →</button>
        </span></div>
      <div class="card-b">
        <div class="player">
          <button class="play-btn" data-act="play" title="按考场顺序播放：先原文，再逐题读题干">
            <svg viewBox="0 0 24 24" class="ic" style="width:26px;height:26px;fill:currentColor;stroke:none"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div style="flex:1">
            <div class="wave">${Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:${i * .06}s"></i>`).join('')}</div>
            <div class="hint" style="margin-top:4px">点击播放后约 2 秒开始发声；句间停顿按句长和语气自动调整</div>
            <div class="row" style="margin-top:10px">
              <span class="seg" title="选择朗读音色">
                <button class="mini-tab ${Speech.gender !== 'male' ? 'on' : ''}" data-spk="female">女声</button>
                <button class="mini-tab ${Speech.gender === 'male' ? 'on' : ''}" data-spk="male">男声</button>
              </span>
              <select class="inp" id="spd" style="width:auto;padding:5px 9px;font-size:12px">
                ${[0.6, 0.75, 0.9, 1, 1.15].map(r => `<option value="${r}"${Math.abs(r - (Store.d.settings.speechRate || 1)) < .05 ? ' selected' : ''}>${r}x</option>`).join('')}
              </select>
              <button class="btn btn-xs btn-gh" data-act="repeat">🔁 循环播放</button>
              <span class="sp"></span>
              <button class="btn btn-xs btn-gh" data-act="prev">← 上一句</button>
              <button class="btn btn-xs btn-gh" data-act="next">下一句 →</button>
            </div>
            <div id="genderInfo" class="hint" style="margin-top:8px"></div>
          </div>
        </div>
      </div>
    </div>
    <div id="scriptCard"></div>`;

    this._script($('#scriptCard', box), turns, d.title);
    // 识别对话性别（男男/男女/女女），用于分配男女声
    /* 对话视图本身就是对话类：把 type/title 传进去，AI 失败时才能按轮次交替兜底 */
    this._spGender = null;
    this.genderInfo = '';
    this._paintGender();
    this.detectGenders(turns, { type: d.type, title: d.title, genre: d.genre }).then(() => this._paintGender());
    this._bindCommon(box, turns.map(t => t.en).join(' '));
  },

  /**
   * 这篇听力的「题型」。
   * 【为什么要推导】导入的真题往往没有题型字段，标题只有 "Questions 9 to 11" 这类题号范围，
   * 卡片上于是什么都标不出来——用户看不出这篇是长对话还是短文（2024-12 六级那卷就是这样）。
   * 判据优先级：记录里已有的字段 → 标题里的 Section 字母 → 标题/题目里的题号范围。
   * 题号与题型的对应关系按真题结构（四级与六级的 Section A/B/C 并不相同）：
   *   六级：1-8 长对话 · 9-15 听力篇章 · 16-25 讲座/讲话
   *   四级：1-7 短篇新闻 · 8-15 长对话 · 16-25 听力篇章
   */
  _paperKind(p) {
    if (!p) return '';
    const given = String(p.genre || p.listeningType || p.sectionType || '').trim();
    if (given) return given;
    const title = String(p.title || '');
    const cet4 = p.type === 'cet4';
    const map = cet4
      ? [[7, '短篇新闻'], [15, '长对话'], [25, '听力篇章']]
      : [[8, '长对话'], [15, '听力篇章'], [25, '讲座/讲话']];
    const bySection = cet4
      ? { A: '短篇新闻', B: '长对话', C: '听力篇章' }
      : { A: '长对话', B: '听力篇章', C: '讲座/讲话' };
    const sec = title.match(/section\s*([a-c])\b/i);
    if (sec) return bySection[sec[1].toUpperCase()] || '';
    const pick = n => { for (const [last, label] of map) if (n <= last) return label; return ''; };
    const rng = title.match(/questions?\s*(\d+)\s*(?:to|[-–—~])\s*(\d+)/i);
    if (rng) return pick(parseInt(rng[1], 10));
    const nums = (Array.isArray(p.qs) ? p.qs : [])
      .map(q => parseInt(String((q && q.q) || '').replace(/[^\d]/g, ''), 10))
      .filter(n => n > 0);
    return nums.length ? pick(Math.min.apply(null, nums)) : '';
  },

  /* ---------- 长篇（四级 / 六级）---------- */
  _passage(box) {
    const p = this.shown && this.shown[this.piPass || 0];
    if (!p) { box.innerHTML = `<div class="empty"><p>请先选择一篇材料</p></div>`; return; }
    /* 补丁兜底：_shell 已叠加过一次，这里再套一次（例如导入后回来、切篇回来）。
     * 模块的 applyPatches 只补缺、幂等，重复调用无害。*/
    this._applyPatches([p]);
    /* 导入文本里的“W:/M:”标签在这里拆成 sp 并去掉前缀（内置数据本来就是 sp 字段） */
    const lines = this._normalizeSpeakerLines(p.script || []);
    const isCet4 = p.type === 'cet4';
    const LV = {
      cet4: 'CET-4 听力理解', cet6: 'CET-6 听力理解',
    }[p.type] || '听力作答';
    /* 题型只渲染一次：_paperKind 本身会优先返回 p.genre，
     * 所以不能再单独渲染一次 genre，否则会出现"短对话 · 短对话"。*/
    const paperKind = this._paperKind(p);
    /* 导入卷常见：只解析到选项、没有题干。头部先给一个数量提示。*/
    const missingStemCount = (p.qs || []).filter((q, i) => this._stemInfo(q, i, p).missing).length;

    /* 左右分栏：左边播放器 + 原文与复现，右边听力理解作答（如图3布局） */
    box.innerHTML = `
    <div class="lsn-cols">
      <div class="lsn-left">
        <div class="card">
          <div class="card-h">${esc(p.title || '听力材料')}
            ${p.sharedListening
              ? '<span class="tag tag-warn">第 ' + p.setNo + ' 套 · 共用第 ' + p.sharedFromSet + ' 套听力</span>'
              : p.setNo ? '<span class="tag">第 ' + p.setNo + ' 套</span>' : ''}
            <span class="tag ${isCet4 ? 'tag-ok' : 'tag-pri'}">${esc(p.level || '')}</span>
            ${paperKind ? `<span class="tag">${esc(paperKind)}</span>` : ''}
            ${missingStemCount ? `<span class="tag tag-warn lsn-stem-tag" title="四六级听力卷面只印选项，题干只在录音中播报">卷面未印题干 ${missingStemCount}</span>` : ''}
            ${p.typeVerification === 'ai-verified'
              ? `<span class="tag tag-ok" title="${esc((p.typeEvidence || []).join('；'))}">AI 核验类型</span>`
              : p.typeVerification ? '<span class="tag tag-warn">类型待核验</span>' : ''}
            ${p.genre && p.genre !== paperKind ? `<span class="tag tag-warn">${esc(p.genre)}</span>` : ''}
            <span class="r">
              <button class="btn btn-xs btn-gh" data-act="prev">← 上一篇</button>
              <button class="btn btn-xs btn-gh" data-act="next">下一篇 →</button>
            </span></div>
          <div class="card-b">
            <div class="shortnews-meta">
              ${(p.keywords || []).length ? `<div style="font-size:11.5px;color:var(--tx3)">关键词：${(p.keywords || []).map(k => `<span class="chip">${esc(k)}</span>`).join(' ')}</div>` : ''}
            </div>
            <div class="player">
              <button class="play-btn" data-act="play" title="按考场顺序播放：先原文，再逐题读题干">
                <svg viewBox="0 0 24 24" class="ic" style="width:26px;height:26px;fill:currentColor;stroke:none"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <div style="flex:1">
                <div class="wave">${Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:${i * .06}s"></i>`).join('')}</div>
                <div class="hint" style="margin-top:4px">考场顺序播放：先读原文，再逐题读题干；<b>每题后留白按考场 13-15 秒</b>；原文后「叮咚」分界（下方可调）</div>
                <div class="row" style="margin-top:10px">
                  <span class="seg" title="选择朗读音色">
                    <button class="mini-tab ${Speech.gender !== 'male' ? 'on' : ''}" data-spk="female">女声</button>
                    <button class="mini-tab ${Speech.gender === 'male' ? 'on' : ''}" data-spk="male">男声</button>
                  </span>
                  <select class="inp" id="spd" style="width:auto;padding:5px 9px;font-size:12px">
                    ${[0.6, 0.75, 0.9, 1, 1.15].map(r => `<option value="${r}"${Math.abs(r - (Store.d.settings.speechRate || 1)) < .05 ? ' selected' : ''}>${r}x</option>`).join('')}
                  </select>
                  <button class="btn btn-xs btn-gh" data-act="repeat">🔁 循环播放</button>
                  <span class="sp"></span>
                  <button class="btn btn-xs btn-gh" data-act="s2s">逐句复现</button>
                  <button class="btn btn-xs btn-gh" data-act="stop">停止</button>
                </div>
                <div class="hint" id="playStatus" style="margin-top:6px;min-height:18px;color:var(--pri)"></div>
                <div id="qNow" style="margin-top:6px;font-size:15px;font-weight:600;color:var(--tx)"></div>
                <div class="row" style="margin-top:6px">
                  <button class="btn btn-xs btn-gh" id="diagBtn">🔍 发音诊断（点一次播放后查看）</button>
                </div>
                <div class="hint" id="diagBox2" style="display:none;margin-top:6px"></div>
                <div class="row" style="margin-top:8px">
                  <label class="hint" style="display:flex;align-items:center;gap:5px;cursor:pointer"
                    title="真题 Directions 只播报 question，A)-D) 选项印在试卷上；需要连选项一起听时勾选">
                    <input type="checkbox" id="examOpts" ${Store.d.settings.listenReadOptions ? 'checked' : ''}> 连 ABCD 选项一起读
                  </label>
                  <label class="hint" style="display:flex;align-items:center;gap:5px;cursor:pointer"
                    title="原文读完 2.5 秒后播「叮咚」，再 2.5 秒开始报题干">
                    <input type="checkbox" id="examChime" ${Store.d.settings.listenChime !== false ? 'checked' : ''}> 叮咚提示音
                  </label>
                  <label class="hint" style="display:flex;align-items:center;gap:5px;cursor:pointer"
                    title="最后一道题的留白结束后，用人声播报「听力到此结束」">
                    <input type="checkbox" id="examEnd" ${Store.d.settings.listenEndSay !== false ? 'checked' : ''}> 结尾语
                  </label>
                  <span class="hint">每题后留白</span>
                  <select class="inp" id="examPause" style="width:auto;padding:5px 9px;font-size:12px">
                    ${[13, 15, 20].map(v => `<option value="${v}"${(Number(Store.d.settings.listenQaPause) || 15) === v ? ' selected' : ''}>${v} 秒</option>`).join('')}
                  </select>
                </div>
                <div id="genderInfo" class="hint" style="margin-top:8px"></div>
              </div>
            </div>
          </div>
        </div>
        <div id="scriptCard"></div>
      </div>

      <div class="lsn-right" id="quizCard"></div>
    </div>`;

    /* 只在「换篇」时重置作答状态。
     * 原来这里无条件清空，导致点「提交作答 / 显示答案」后调 _body() 重渲染，
     * submitted 又被置回 false —— 答案和解析永远显示不出来。*/
    if (this._lastPassId !== p.id) {
      this.answers = {}; this.submitted = false; this._quizRevealed = false; this.curQ = 0;
      this._lastPassId = p.id;
    }
    /* missing:true —— 没有原文时给出"为什么/怎么办"，而不是留一片空白 */
    this._script($('#scriptCard', box), lines, p.title, { missing: true, p });
    /* 【2026-10-26】换篇时先清掉上一篇的说话人结论：没有原文的导入篇不会进 detectGenders，
     * 旧实现会把上一篇的"男女对话/AI 识别"或"说话人识别失败"留在新篇上，误导用户。*/
    this._spGender = null;
    this.genderInfo = '';
    this._paintGender();
    this.detectGenders(lines, p).then(() => this._paintGender());
    /* 记下"这次按几行原文推过说话人"：补进原文后行数会变，_refreshPassage 据此再推一次 */
    this._genderSig = this._passKey(p) + '|' + lines.length;
    this._bindCommon(box, lines.map(l => l.en).join(' '), p);
    if (p.qs && p.qs.length) this._renderQuiz(box, p.qs, p.id);
    /* 记下这一篇的容器：自动补全/解析回来后只局部重渲染，不整页重建（否则会打断播放与作答）*/
    this._passBox = box;
    this._paintAfStatus(p);
    /* 【不阻塞】缺原文或缺题干的篇目，进页面就自动补全一次；不 await，作答与播放立刻可用 */
    this._autoFill(p);
  },

  /* ---------- 听力原文区 ---------- */
  _script(card, lines, title, opt = {}) {
    if (!card) return;
    /* 自动补全状态行：只在长篇（opt.missing）出现，行内容由 _paintAfStatus 填；
     * 单句/对话视图不插，免得每张卡都多一块空提示。*/
    const afLine = opt.missing
      ? '<div class="hint" id="afScriptStatus" style="margin:2px 0 8px;color:var(--tx3);line-height:1.7"></div>'
      : '';
    /* 【缺原文的卷子必须写明原因，而不是留一片空白】
     * 真题 PDF 常常只有题干与选项，导入之后 script 是空的：
     * 原文区空白、点播放没有声音、答案也无从判断。空白会被当成"播放坏了"，
     * 所以这里直接说明缺什么、为什么、怎么补救。*/
    if (!lines.length && opt.missing) {
      /* 【不再只报"没有原文"】进篇就会自动联网检索并核验；这里给出实时状态、失败原因
       * 与重试入口，同时保留原来的手动粘贴/抓取通道。*/
      card.innerHTML = `
      <div class="sec-t">听力原文</div>
      <div class="card"><div class="card-b">
        <b style="color:var(--warn)">⚠ 本篇没有听力原文</b>
        <div class="hint" style="margin-top:6px;line-height:1.9">
          导入时源文件里只有题干与选项，没有「听力原文 / Tapescripts / 录音材料」，因此：<br>
          · <b>无法播放</b>：没有可朗读的文本（点播放只会按题号读题干）；<br>
          · <b>无法判分</b>：选项在题目区，答案需要自己核对。<br>
          已自动联网检索并核验该套听力的 Tapescript，失败会给出原因；也可以粘贴 Tapescript，
          由 AI 按题号切分/审核后补入本页，再用本地 TTS 朗读。
        </div>
        <div class="hint" id="afScriptStatus" style="margin-top:8px;line-height:1.8;color:var(--tx3)"></div>
        <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
          <button class="btn btn-pri btn-s" data-act="autofillScript">🔄 自动联网补全原文</button>
          <button class="btn btn-gh btn-s" data-act="fillTranscript">补原文（抓文本 + AI 审核 + 本地朗读）</button>
        </div>
      </div></div>`;
      return;
    }
    const shown = this.mode === 'write' && !this.submitted;
    if (shown) {
      card.innerHTML = `
      ${afLine}<div class="sec-t">听力原文（写模式已隐藏文字，仅可听）</div>
        <div class="hidden-locked">
          ${lines.map((l, i) => `<div class="script-line" data-say="${esc(l.en)}" style="padding-right:76px">
            <span class="n">${l.sp || (i + 1)}</span>
            <span class="t">${l.sp ? `<b class="sp">${esc(l.sp)}</b>` : ''}${this._wSpan(l.en)}</span>
            <button class="btn btn-xs btn-gh play-btn-sm" data-say="${esc(l.en)}"
              style="position:absolute;right:10px;top:9px" title="复现这句">
              <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>播放</button>
          </div>`).join('')}
        </div>
      </div>`;
      return;
    }
    card.innerHTML = afLine + `
    <div class="sec-t">原文与复现（点击任意句子可单独复现）</div>
      <div style="max-height:330px;overflow-y:auto" id="scriptLines">
      ${lines.map((l, i) => `<div class="script-line" data-say="${esc(l.en)}">
        <span class="n">${l.sp || (i + 1)}</span>
        <span class="t">${l.sp ? `<b class="sp">${esc(l.sp)}</b>` : ''}${this._wSpan(l.en)}
        ${l.cn ? `<span class="cn">${esc(l.cn)}</span>` : ''}</span>
        <button class="btn btn-xs btn-gh play-btn-sm" data-say="${esc(l.en)}" title="复现这句">
          <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>播放</button>
      </div>`).join('')}
      </div>`;
  },

  /* ---------- 听力自动补全（原文/题干）：js/listening-autofill.js 接线 ----------
   * 用户要求：导入 PDF 后自动识别试卷；没有 Tapescript 时自动上网搜索、核验并导入；
   * 同一月份不同套若其实是同一套听力，自动为未印题干的套卷补全题干，
   * 而不是只提示"导入 PDF 上没印"。
   * 这里只做「接线 + 状态 UI」：纯函数与联网/AI 编排都在 js/listening-autofill.js。
   * 三条硬约束：不阻塞作答与播放；同一篇不重复联网；失败只降级显示原因，绝不弹错误框。*/

  /** 取自动补全服务。脚本缺失（旧缓存 / Node 自检的 vm 环境）时返回 null，页面照常可用。 */
  _autofill() {
    if (typeof ListeningAutoFill !== 'undefined' && ListeningAutoFill) return ListeningAutoFill;
    if (typeof window !== 'undefined' && window && window.ListeningAutoFill) return window.ListeningAutoFill;
    return null;
  },

  /** 把 Store.d.lsnPatch 里的补丁叠加到篇目。
   *  模块负责"只补缺、幂等"，共享副本（id 带 -shared-N）会自动回退到原篇目的补丁。*/
  _applyPatches(papers) {
    const AF = this._autofill();
    if (!AF || typeof AF.applyPatches !== 'function' || !Array.isArray(papers) || !papers.length) return 0;
    let patches = {};
    try {
      patches = (typeof AF.readPatches === 'function')
        ? AF.readPatches(typeof Store !== 'undefined' ? Store : null) : {};
    } catch (e) { patches = {}; }
    if (!patches || typeof patches !== 'object') return 0;
    try { return Number(AF.applyPatches(papers, patches)) || 0; } catch (e) { return 0; }
  },

  /** 缺题干统计：{ total, missing }（与答题卡渲染同一个 _stemInfo 口径）。 */
  _stemCounts(p, qs) {
    const list = Array.isArray(qs) ? qs : ((p && Array.isArray(p.qs)) ? p.qs : []);
    let missing = 0;
    for (let i = 0; i < list.length; i++) {
      if (this._stemInfo(list[i], i, p).missing) missing++;
    }
    return { total: list.length, missing: missing };
  },

  /** 这篇是否还缺东西：没有原文，或题干没印在卷面。补丁已完整时返回 false（不再联网）。 */
  _needsAutoFill(p) {
    if (!p) return false;
    if (!((p.script && p.script.length) || 0)) return true;
    return this._stemCounts(p).missing > 0;
  },

  /** run() 写补丁用的篇目：共享副本（id 形如 xxx-shared-2）借用原篇目的 id。
   *  否则补丁落在每次渲染都会重建的副本 id 上，下次进页面就找不到补丁了。*/
  _patchTarget(p) {
    const id = String((p && p.id) || '');
    const rootId = id.replace(/-shared-\d+$/, '');
    if (!rootId || rootId === id) return p;
    const base = (this.pool || []).find(x => x && !x.sharedListening && String(x.id) === rootId);
    return base ? Object.assign({}, base) : Object.assign({}, p, { id: rootId });
  },

  _afStates() { this._afState = this._afState || {}; return this._afState; },

  /** 本次运行内"自动补全跑过一次"的标记：跳过/失败也不重复联网、不重复花钱。 */
  _afTried() { this._autoTried = this._autoTried || {}; return this._autoTried; },

  /**
   * 进篇后不阻塞地自动补全：同套题干复用 → 原文口播抽题干 → 联网检索原文/题干并核验。
   * @param {object} p 当前篇目
   * @param {{force?:boolean}} [opts] force=true 表示用户点按钮重试（绕过"本次只跑一次"）
   */
  _autoFill(p, opts) {
    const o = opts || {};
    if (!p) return null;
    const key = this._passKey(p);
    const states = this._afStates();
    const tried = this._afTried();
    const st = states[key];
    if (st && st.status === 'running') return st.promise || null;
    if (!o.force && tried[key]) return null;
    if (!o.force && !this._needsAutoFill(p)) { tried[key] = true; return null; }
    const AF = this._autofill();
    if (!AF || typeof AF.run !== 'function') {
      states[key] = { status: 'skipped', errors: ['自动补全模块未加载（脚本缺失或缓存是旧版）'] };
      tried[key] = true;
      this._paintAfStatus(p);
      return null;
    }
    tried[key] = true;
    const self = this;
    const state = states[key] = { status: 'running', progress: '正在检查同套听力 / 检索原文…', errors: [], report: null };
    let promise;
    try {
      /* 模块自己 writePatch 并调 onPatch；这里不重复构造 patch，只把结果落盘并局部重渲染 */
      promise = Promise.resolve(AF.run(this._patchTarget(p), {
        store: (typeof Store !== 'undefined' ? Store : undefined),
        pool: this.pool,
        onProgress: msg => self._afProgress(key, msg),
        onPatch: (paper, patch) => self._onAutoPatch(p, patch),
      }));
    } catch (e) {
      state.status = 'failed';
      state.errors = [String((e && e.message) || e || '自动补全启动失败')];
      this._paintAfStatus(p);
      return null;
    }
    state.promise = promise;
    promise.then(report => self._afDone(p, key, report), err => self._afFail(p, key, err));
    this._paintAfStatus(p);
    return promise;
  },

  /** 进度行：只在用户仍停在这一篇时刷新（切走后不打扰）。 */
  _afProgress(key, msg) {
    const st = this._afStates()[key];
    if (!st) return;
    st.progress = String(msg == null ? '' : msg);
    const cur = this.shown && this.shown[this.piPass || 0];
    if (cur && this._passKey(cur) === key) this._paintAfStatus(cur);
  },

  /** 编排结束：状态落到状态行；这次补到东西就按最新 Store 再叠加一次并局部重渲染。 */
  _afDone(p, key, report) {
    const st = this._afStates()[key] || (this._afStates()[key] = {});
    const r = (report && typeof report === 'object') ? report : {};
    st.report = r;
    st.progress = '';
    st.errors = Array.isArray(r.errors) ? r.errors.slice(0, 6) : [];
    st.status = String(r.status || ((r.stemsFilled || r.scriptAdded) ? 'done' : 'skipped'));
    const cur = this.shown && this.shown[this.piPass || 0];
    if (!cur || this._passKey(cur) !== key) return;
    const changed = !!(r.stemsFilled || r.scriptAdded);
    if (changed && !st.patched) {
      this._applyPatches([cur]);
      this._refreshPassage();
    } else {
      this._paintAfStatus(cur);
    }
    if (changed && typeof App !== 'undefined' && App.toast) {
      if (r.scriptAdded) App.toast('已自动联网补全本篇听力原文', 'ok');
      else App.toast('已自动补全 ' + r.stemsFilled + ' 题题干（' + this._stemSourceLabel(cur, st) + '）', 'ok');
    }
  },

  /** 模块承诺不抛异常；万一抛了也只降级显示，不影响作答与判分。 */
  _afFail(p, key, err) {
    const st = this._afStates()[key] || (this._afStates()[key] = {});
    st.status = 'failed';
    st.progress = '';
    st.errors = [String((err && err.message) || err || '自动补全失败')];
    const cur = this.shown && this.shown[this.piPass || 0];
    if (cur && this._passKey(cur) === key) this._paintAfStatus(cur);
  },

  /**
   * 补丁落地（模块已自己 writePatch，这里不重复写）：
   * ① 同步 Store.d.contentBackup.listening 里同 id 的导入条目（只补缺）；
   * ② Store.flush() 落盘；③ 局部重渲染原文卡 / 答题卡 / 头部标签 / 状态行。
   */
  _onAutoPatch(p, patch) {
    if (!p || !patch || typeof patch !== 'object') return;
    const key = this._passKey(p);
    const st = this._afStates()[key];
    if (st) { st.patched = true; st.progress = '已补入本篇，正在继续补其余项…'; }
    this._syncContentBackup(p, patch);
    try { if (typeof Store !== 'undefined' && Store.flush) Store.flush(); } catch (e) { /* 落盘失败只影响持久化 */ }
    this._applyPatches([p]);
    const cur = this.shown && this.shown[this.piPass || 0];
    if (cur && this._passKey(cur) === key) this._refreshPassage();
  },

  /** 把补丁同步进 contentBackup 里的导入条目（只补缺，不覆盖已有原文/题干）。
   *  【为什么】导入篇目重启后是从 contentBackup 合并回来的；不同步的话，
   *  下次启动页面又变回"缺原文/缺题干"，导出的备份也带不走补全结果。*/
  _syncContentBackup(p, patch) {
    if (typeof Store === 'undefined' || !Store.d || !patch) return 0;
    const b = Store.d.contentBackup && Store.d.contentBackup.listening;
    const arr = Array.isArray(b) ? b : (b && Array.isArray(b.passages) ? b.passages : []);
    if (!arr.length) return 0;
    const ids = new Set();
    const id = String((p && p.id) || '');
    if (id) { ids.add(id); ids.add(id.replace(/-shared-\d+$/, '')); }
    if (!ids.size) return 0;
    const self = this;
    const script = Array.isArray(patch.script) ? patch.script : null;
    const stems = (patch.stems && typeof patch.stems === 'object') ? patch.stems : null;
    let n = 0;
    arr.forEach(item => {
      if (!item || !ids.has(String(item.id))) return;
      if (script && script.length && !(Array.isArray(item.script) && item.script.length)) {
        item.script = script.map((l, i) => ({ s: i, en: String((l && (l.en != null ? l.en : l.text)) || '') }))
          .filter(l => l.en);
        if (item.script.length && patch.scriptSource) item.scriptSource = patch.scriptSource;
      }
      if (stems) {
        Object.keys(stems).forEach(k => {
          const i = Number(k);
          const qs = Array.isArray(item.qs) ? item.qs : [];
          if (!Number.isInteger(i) || i < 0 || i >= qs.length) return;
          const text = String(stems[k] == null ? '' : stems[k]).trim();
          if (!text) return;
          if (!self._stemInfo(qs[i], i, item).missing) return;   // 只补缺，已有题干不动
          qs[i].q = text;
          delete qs[i].stemMissing;
        });
        if (patch.stemSource) item.stemSource = patch.stemSource;
      }
      n++;
    });
    return n;
  },

  /** 题干来源的中文标签：只说真实来源，不写没有根据的"已补全"。 */
  _stemSourceLabel(p, st) {
    const r = (st && st.report) || {};
    const src = String(r.stemsFrom || (p && p.stemSource) || '');
    if (src === 'set') {
      const set = Number(r.donorSetNo || (p && p.stemFromSet) || 0);
      return set ? '同套第 ' + set + ' 套' : '同套听力';
    }
    if (src === 'transcript') return '原文口播';
    if (src === 'web') return '联网核验';
    if (src === 'ai') return 'AI 从原文提取（逐字核验）';
    return '';
  },

  /** 原文卡片状态行：检索/核验的实时状态、结果来源、或没补到的具体原因。 */
  _afScriptStatusHTML(p, st) {
    const hasScript = !!(p && Array.isArray(p.script) && p.script.length);
    if (st && st.status === 'running') {
      return '⏳ 正在自动联网检索并核验本篇听力原文……'
        + (st.progress ? '<br>' + esc(st.progress) : '');
    }
    if (hasScript) {
      const url = String((p && p.scriptUrl) || '');
      if ((p && p.scriptSource) === 'web') {
        return '✅ 原文已自动联网检索并核验'
          + (url ? '（来源：' + esc(url) + '）' : '（来源：网页正文）')
          + ((p && p.scriptVerdict) === 'ai-verified' ? '，AI 已逐字核验' : '')
          + '；可用本地语音朗读。';
      }
      if ((p && p.scriptSource) === 'transcript') return '✅ 原文已补入（手动粘贴 / 网页抓取 + AI 审核）。';
      return '';
    }
    const errs = (st && st.errors && st.errors.length) ? st.errors.slice(0, 3) : [];
    if (errs.length) {
      return (st.status === 'failed' ? '⚠ 自动补全失败：' : '⚠ 自动补全暂时没补到：')
        + esc(errs.join('；'))
        + '<br>可以点「🔄 自动联网补全原文」重试，或自己找到 Tapescript 后点「补原文」。';
    }
    if (st && st.status === 'skipped') {
      return 'ℹ 自动补全已跳过：没有可补的内容（AI 未配置 / 没联网 / 没有检索结果）。';
    }
    return '';
  },

  /** 缺题干提示条：idle / 正在补 / 已补（来源）/ 没补到的原因，都只陈述事实。 */
  _afStemHTML(p, st, qs) {
    const cnt = this._stemCounts(p, qs);
    if (!cnt.total) return '';
    const src = this._stemSourceLabel(p, st);
    const running = !!(st && st.status === 'running');
    const errs = (st && st.errors && st.errors.length) ? st.errors.slice(0, 3) : [];
    const got = Number((st && st.report && st.report.stemsFilled) || 0);
    const tip = (body, ok, button) => '<div class="tipbox" style="margin-bottom:14px;border-left-color:'
      + (ok ? 'var(--ok)' : 'var(--warn)') + ';background:' + (ok ? 'var(--ok-l)' : 'var(--warn-l)') + '">'
      + '<b>' + (ok ? '✅ 题干' : 'ℹ 题干') + '</b>　' + body + (button || '') + '</div>';
    const retry = running
      ? '<button class="btn btn-xs btn-gh" data-act="autofillStem" style="margin-top:8px" disabled>⏳ 正在检索…</button>'
      : '<button class="btn btn-xs btn-gh" data-act="autofillStem" style="margin-top:8px">🔎 联网补全题干</button>';
    if (running) {
      return tip('本篇 ' + cnt.total + ' 题里还有 ' + cnt.missing + ' 题的题干未印在卷面'
        + '（四六级听力只在录音中播报题干）。<br>正在自动补全：'
        + esc(st.progress || '同套卷题干复用 → 原文口播 → 联网核验…'), false, retry);
    }
    if (!cnt.missing) {
      if (!src) return '';
      return tip('题干已齐全' + (got ? '（本次补全 ' + got + ' 题）' : '') + '，来源：' + esc(src) + '。'
        + '<br><span style="color:var(--tx3)">补入的题干经同套听力逐字核对，选项与答案没有改动。</span>', true);
    }
    let head;
    if (got || src) {
      head = (got ? '已补全 ' + got + ' 题' : '已补全部分题干') + (src ? '（来源：' + esc(src) + '）' : '')
        + '，仍缺 ' + cnt.missing + ' 题';
    } else {
      head = '本篇 ' + cnt.total + ' 题里有 ' + cnt.missing + ' 题题干未印在卷面'
        + '（四六级听力只在录音中播报题干，卷面只有选项）';
    }
    let tail;
    if (errs.length) tail = '<br><span style="color:var(--err)">自动补全没补到：' + esc(errs.join('；')) + '</span>';
    else if (!st) tail = '<br>进入本篇会自动补全：同套卷题干复用 → 原文口播 → 联网核验。';
    else tail = '<br>原文里没有播报这些题的题干，联网也没有可靠结果，可稍后重试。';
    return tip(head + tail, false, retry);
  },

  /** 刷新自动补全三处状态：原文卡状态行 / 缺题干提示条 / 头部「卷面未印题干 N」。 */
  _paintAfStatus(p) {
    const cur = this.shown && this.shown[this.piPass || 0];
    if (!cur) return;
    const target = p || cur;
    if (this._passKey(target) !== this._passKey(cur)) return;
    const st = this._afStates()[this._passKey(target)] || null;
    const box = this._passBox;
    if (box && box.querySelector) {
      const sc = box.querySelector('#afScriptStatus');
      if (sc) sc.innerHTML = this._afScriptStatusHTML(target, st);
      const sb = box.querySelector('#afStemBox');
      if (sb) sb.innerHTML = this._afStemHTML(target, st);
    }
    this._paintStemTag(target);
  },

  /** 头部「卷面未印题干 N」：全补上后标签自然消失（不保留旧数字，也不作假）。 */
  _paintStemTag(p) {
    const box = this._passBox;
    if (!box || !box.querySelector) return;
    const tag = box.querySelector('.lsn-stem-tag');
    if (!tag) return;
    const cnt = this._stemCounts(p);
    if (cnt.missing) { tag.textContent = '卷面未印题干 ' + cnt.missing; return; }
    if (typeof tag.remove === 'function') tag.remove();
    else if (tag.parentNode && tag.parentNode.removeChild) tag.parentNode.removeChild(tag);
  },

  /** 局部重渲染：原文卡 + 答题卡 + 状态行/头部标签（不整页 _shell，避免打断播放与作答）。 */
  _refreshPassage() {
    const box = this._passBox;
    const p = this.shown && this.shown[this.piPass || 0];
    if (!box || !p) return;
    const lines = this._normalizeSpeakerLines(p.script || []);
    const card = $('#scriptCard', box);
    if (card) this._script(card, lines, p.title, { missing: true, p: p });
    if (p.qs && p.qs.length) this._renderQuiz(box, p.qs, p.id);
    this._paintAfStatus(p);
    /* 补进来的原文可能带 W:/M: 标注：行数变了才重推说话人，避免每次补丁都打一次 AI */
    const sig = this._passKey(p) + '|' + lines.length;
    if (lines.length && this._genderSig !== sig) {
      this._genderSig = sig;
      this.detectGenders(lines, p).then(() => this._paintGender());
    }
  },

  /* ---------- 题目 ---------- */
  /** 判断某题的"题干"是真正题干还是只有题号/空 */
  _stemInfo(q, i, p) {
    const raw = String((q && q.q) || '').trim();
    /* 占位判断与 js/listening-autofill.js 的 stemIsPlaceholder 用同一口径：
     * 空 / 纯题号 / "Question 5" / Directions / 中文占位 都算"题干没印在卷面"。
     * 两边口径不同会让提示条说"缺 N 题"而页面又渲染出题干，互相打架。
     * 模块没加载（旧缓存 / Node 自检的 vm）时退回原来的题号正则。*/
    const AF = this._autofill();
    const placeholder = (AF && typeof AF.stemIsPlaceholder === 'function')
      ? AF.stemIsPlaceholder(q)
      : (!raw || /^(?:question\s*)?\d+\s*[.、]?$/i.test(raw));
    let no = 0;
    const m = raw.match(/^(?:question\s*)?(\d+)\s*[.、]?$/i);
    if (m) no = Number(m[1]);
    if (!no) {
      const rng = String((p && p.title) || '').match(/questions?\s*(\d+)\s*(?:to|[-–—~])\s*(\d+)/i);
      no = rng ? Number(rng[1]) + i : i + 1;
    }
    return { no, text: placeholder ? '' : raw, missing: placeholder };
  },

  _renderQuiz(box, qs, key) {
    const card = App.freshNode('#quizCard', box) || $('#quizCard', box);
    if (!card) return;
    const hidden = this.mode === 'write' && !this.submitted && !this._quizRevealed;
    const p = this.shown && this.shown[this.piPass || 0];
    const total = qs.length * 2.5;
    const stems = qs.map((q, i) => this._stemInfo(q, i, p));
    const LV = {
      cet4: 'CET-4 听力理解', cet6: 'CET-6 听力理解',
    }[(p && p.type) || this.kind] || '听力作答';
    /* 【解析】CET4 自带 explain/evidence → 原样显示；CET6 / 导入卷 explain 为空时
     * 至少显示正确答案，AI 可用时随后自动补全（见 _ensureMissingExplains）。*/
    const explains = this.submitted ? qs.map((q, i) => this._explainFor(p, q, i)) : [];
    const explainNote = this.submitted && explains.some(x => !x) ? this._explainNote(p) : '';

    card.innerHTML = `
    <div class="card-h">${LV} <span class="tag tag-pri">满分 ${total}</span>
      <span class="r">${this.mode === 'write' && !this.submitted ? `<button class="btn btn-xs btn-gh" data-act="toggleAns">${hidden ? '👁 查看题干' : '🙈 隐藏题干'}</button>` : ''}</span></div>
    <div class="card-b">
      <div id="afStemBox">${this._afStemHTML(p, this._afStates()[this._passKey(p)] || null, qs)}</div>
      ${this.mode === 'write' && !this.submitted ? `<div class="tipbox listen-quiz-tip" style="margin-bottom:14px" ${hidden ? '' : 'hidden'}>🔒 题干已模糊，选项保持可见，听完后可查看题干。</div>` : ''}
      <div class="listen-quiz-content ${hidden ? 'listen-quiz-question-hidden' : ''}">
      ${qs.map((q, i) => `
        <div class="q-item">
          <div class="qt"><span class="qt-no">${stems[i].no}.</span> <span class="q-stem">${stems[i].missing ? '<span class="q-missing">本题题干未印在卷面（只在录音中播报）</span>' : esc(stems[i].text)}</span></div>
          ${q.opts.map((o, k) => `<div class="q-opt ${this.submitted ? (k === q.a ? 'right' : (this.answers[i] === k ? 'wrong' : '')) : (this.answers[i] === k ? 'sel' : '')}"
            data-q="${i}" data-o="${k}"><span class="k">${'ABCD'[k]}</span><span>${this._wording(o)}</span></div>`).join('')}
          ${this.submitted ? (explains[i]
            ? `<div class="tipbox"><b>解析</b>　${esc(explains[i].explain)}${explains[i].evidence ? `<br><span style="color:var(--tx3)">原文依据：${esc(explains[i].evidence)}</span>` : ''}</div>`
            : listenExplainFallbackHTML(q, explainNote)) : ''}
        </div>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn btn-pri" data-act="submit">${this.submitted ? '已提交' : '提交作答'}</button>
        <button class="btn btn-gh" data-act="showAns">显示答案</button>
        <span class="sp"></span>
        <span class="ans-count" id="ansCount">${this._answered()} / ${qs.length} 题</span>
        ${this.submitted ? `<b style="color:var(--pri);font-size:15px">得分 ${this._score(qs)} / ${total}</b>` : ''}
      </div>
    </div>`;

    /* 必须在 innerHTML 之后绑定：
     * App.freshNode 会替换旧节点（不复制监听器），
     * 若先绑定再innerHTML，监听会随旧节点一起丢失，
     * 导致「提交作答 / 显示答案」点了没反应。*/
    this._bindQuiz(card, qs);
    /* 判分/重渲染已经完成，这里只是**不阻塞地**补解析；
     * AI 未配置、无原文或失败都静默降级为上面的“正确答案”兜底。*/
    if (this.submitted) this._ensureMissingExplains(p, qs, explains);
  },

  _bindQuiz(card, qs) {
    on(card, 'click', '.q-opt', (e, t) => {
      if (this.submitted) return;
      const qi = +t.dataset.q, oi = +t.dataset.o;
      if (this.answers[qi] === oi) delete this.answers[qi];
      else this.answers[qi] = oi;
      /* 只更新当前题的高亮：对所有选项 toggle 时 same 为 false 会把
       * 其他题已选中的 sel 一并移除，导致多题选择只剩最后一题有反馈。*/
      $$(`.q-opt[data-q="${qi}"]`, card).forEach(x => {
        x.classList.toggle('sel', this.answers[qi] === +x.dataset.o);
      });
      const c = $('#ansCount', card);
      if (c) c.textContent = `${this._answered()} / ${qs.length} 题`;
    });

    on(card, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      if (a === 'toggleAns') {
        this._quizRevealed = !this._quizRevealed;
        const content = card.querySelector('.listen-quiz-content');
        if (content) content.classList.toggle('listen-quiz-question-hidden', !this._quizRevealed);
        const hint = card.querySelector('.listen-quiz-tip');
        if (hint) hint.hidden = this._quizRevealed;
        t.textContent = this._quizRevealed ? '🙈 隐藏题干' : '👁 查看题干';
      } else if (a === 'submit') {
        this.submitted = true;
        Store.addStat('listen', 1);
        const sc = this._score(qs);
        Store.d.listenLog = Store.d.listenLog || {};
        const p = this.shown && this.shown[this.piPass || 0];
        if (p) Store.d.listenLog[p.id] = { at: Date.now(), score: sc, total: qs.length * 2.5 };
        Store.flush();
        Store.logActivity({
          kind: 'listen', seconds: this._pageSeconds(),
          correct: sc, total: qs.length * 2.5,
        });
        this._body();
      } else if (a === 'showAns') {
        qs.forEach((q, i) => this.answers[i] = q.a);
        this.submitted = true;
        this._body();
      }
    });
  },

  /* ---------- 缺失解析：正确答案兜底 + AI 一次性补全 ---------- */
  /** 缓存键：篇目 id（内置/导入都稳定）；没有 id 时退回标题。 */
  _passKey(p) {
    if (!p) return '';
    return String(p.id != null ? p.id : (p.title || ''));
  },

  /** Store.d 里的解析缓存：{ [passId]: { [题下标]: { explain, evidence } } } */
  _explainStore() {
    if (typeof Store === 'undefined' || !Store.d) return {};
    if (!Store.d.lsnExplain || typeof Store.d.lsnExplain !== 'object') Store.d.lsnExplain = {};
    return Store.d.lsnExplain;
  },

  /** 某题的解析：题库自带的 explain 优先（CET4 行为不变），其次用缓存。 */
  _explainFor(p, q, i) {
    const own = String((q && q.explain) || '').trim();
    if (own) return { explain: own, evidence: String((q && q.evidence) || '').trim(), from: 'data' };
    const key = this._passKey(p);
    if (!key) return null;
    const slot = this._explainStore()[key];
    const hit = slot && slot[i];
    const explain = String((hit && hit.explain) || '').trim();
    if (!explain) return null;
    return { explain: explain, evidence: String((hit && hit.evidence) || '').trim(), from: 'ai' };
  },

  /** 兜底框下面那行灰字：正在生成 / 暂缺。 */
  _explainNote(p) {
    const key = this._passKey(p);
    this._explainLoading = this._explainLoading || {};
    this._explainTried = this._explainTried || {};
    this._explainFailed = this._explainFailed || {};
    if (this._explainLoading[key]) return 'AI 正在生成本篇解析，稍后自动刷新…';
    if (this._explainFailed[key] || this._explainTried[key]) return '解析暂缺，已显示正确答案';
    const hasScript = !!this._scriptTextOf(p);
    if (typeof AI !== 'undefined' && AI && AI.ready && hasScript) return 'AI 正在生成本篇解析，稍后自动刷新…';
    return '解析暂缺，已显示正确答案';
  },

  /** 本篇原文纯文本（M/W 标签已在 _normalizeSpeakerLines 里拆掉）。 */
  _scriptTextOf(p) {
    const arr = (p && Array.isArray(p.script)) ? p.script : [];
    return arr.map(l => String((l && (l.en != null ? l.en : l.text)) || '')).filter(Boolean).join('\n').trim();
  },

  /**
   * 提交后：若本篇仍有题缺解析，且 AI 可用、本篇有原文 → **一次请求**为整篇补齐。
   * 结果写 Store.d.lsnExplain[passId]（持久化，避免重复花钱），成功后局部重渲染。
   * 失败/未配置：不改判分结果，保留“正确答案”兜底，只给轻提示。
   */
  _ensureMissingExplains(p, qs, explains) {
    if (!this.submitted || !p || !Array.isArray(qs) || !qs.length) return;
    const missing = [];
    qs.forEach((q, i) => { if (!(explains && explains[i])) missing.push(i); });
    if (!missing.length) return;
    const key = this._passKey(p);
    this._explainLoading = this._explainLoading || {};
    this._explainTried = this._explainTried || {};
    this._explainFailed = this._explainFailed || {};
    this._explainNotified = this._explainNotified || {};
    if (this._explainLoading[key] || this._explainTried[key]) return;
    const scriptText = this._scriptTextOf(p);
    const hasAI = typeof AI !== 'undefined' && AI && AI.ready;
    /* 未配置 AI / 本篇没有原文：静默降级（不回退、不阻塞判分），只提示一次。 */
    if (!hasAI || !scriptText) {
      if (!this._explainNotified[key]) {
        this._explainNotified[key] = true;
        if (typeof App !== 'undefined' && App.toast) App.toast('解析暂缺，已显示正确答案', '');
      }
      return;
    }
    this._explainLoading[key] = true;
    const self = this;
    const items = missing.map(i => {
      const q = qs[i] || {};
      const opts = Array.isArray(q.opts) ? q.opts : [];
      const letter = Number.isInteger(q.a) && q.a >= 0 && q.a < 26 ? String.fromCharCode(65 + q.a) : '';
      const stem = self._stemInfo(q, i, p);
      return {
        i: i,
        question: stem.text || '（卷面未印题干，只播报）',
        options: opts.map((o, k) => 'ABCD'[k] + ') ' + String(o || '')),
        answer: letter || '未知',
        answerText: opts[q.a] != null ? String(opts[q.a]) : '',
      };
    });
    const prompt = [
      '你是四六级听力解析员。根据下面的听力原文，为每道题写中文解析和原文依据。',
      '要求：',
      '1) explain：用中文说明正确答案为什么成立、主要干扰项为什么错，80 字以内；',
      '2) evidence：必须从原文中**逐字摘抄**一个能支持答案的完整英文句子，不得改写、翻译或拼接；',
      '3) 题目可能没有印题干（四六级听力只在录音里播报），此时以正确答案选项为主要线索解释；',
      '4) 只返回 JSON：{"items":[{"i":0,"explain":"…","evidence":"…"}]}，i 是题目下标（从 0 开始）。',
      '', '题目：' + JSON.stringify(items),
      '', '原文：', scriptText.slice(0, 12000),
    ].join('\n');
    const render = function () {
      const cur = self.shown && self.shown[self.piPass || 0];
      if (!cur || self._passKey(cur) !== key || !self.submitted) return;
      const box = (typeof document !== 'undefined' && document.querySelector)
        ? document.querySelector('#lsnBody') : null;
      if (box) self._renderQuiz(box, qs, p.id);
    };
    AI.jsonRetry([
      { role: 'system', content: '你只输出合法 JSON，不要 markdown。解析要基于原文，禁止编造原文依据。' },
      { role: 'user', content: prompt },
    ], { max: 6000, temp: 0.2, timeout: 90000 }).then(function (out) {
      const list = Array.isArray(out) ? out : ((out && (out.items || out.questions)) || []);
      const nums = list.map(function (x) { return Number(x && x.i); }).filter(Number.isInteger);
      const oneBased = nums.length > 0 && nums.indexOf(0) < 0
        && nums.every(function (n) { return n >= 1 && n <= qs.length; });
      const store = self._explainStore();
      const slot = Object.assign({}, store[key] || {});
      let saved = 0;
      list.forEach(function (it) {
        let i = Number(it && it.i);
        if (!Number.isInteger(i)) return;
        if (oneBased) i -= 1;
        if (i < 0 || i >= qs.length) return;
        const explain = String((it && it.explain) || '').trim();
        if (!explain) return;
        const evidence = listenEvidenceFromScript(it && it.evidence, scriptText);
        slot[i] = { explain: explain, evidence: evidence };
        saved++;
      });
      if (saved) {
        store[key] = slot;
        if (typeof Store !== 'undefined' && Store.flush) Store.flush();
      } else {
        self._explainFailed[key] = true;
      }
      self._explainTried[key] = true;
      self._explainLoading[key] = false;
      render();
      if (saved && typeof App !== 'undefined' && App.toast) App.toast('已生成 ' + saved + ' 道题的解析', 'ok');
    }).catch(function () {
      self._explainLoading[key] = false;
      self._explainFailed[key] = true;
      self._explainTried[key] = true;
      render();
      if (typeof App !== 'undefined' && App.toast) App.toast('解析暂缺，已显示正确答案', '');
    });
  },

  /* ---------- 把选项也拆成可划线词（供长句/难句分析）---------- */
  _wording(s) {
    const text = String(s || '');
    if (this.mode !== 'edit') return esc(text);
    const tokens = text.split(/([A-Za-z][A-Za-z'’-]*)/);
    return tokens.map(tok => {
      if (!tok) return '';
      if (!/^[A-Za-z]/.test(tok)) return esc(tok);
      return `<span data-w="${esc(tok.toLowerCase())}" data-wraw="${esc(tok)}">${esc(tok)}</span>`;
    }).join('');
  },

  /* ---------- 公共绑定 ---------- */
  /** 粘贴 Tapescript → AI 按题号切分/审核 → 写回听力材料并持久化。*/
  _fillTranscript(item) {
    if (!item) return;
    const roots = (this.pool || []).filter(x => x && !x.sharedListening
      && x.year === item.year && x.session === item.session
      && (!item.sharedFromSet || Number(x.setNo) === Number(item.sharedFromSet)))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'en', { numeric: true }));
    if (!roots.length) { App.toast('找不到对应听力篇目', 'err'); return; }
    App.modal('补听力原文', `
      <div class="hint" style="line-height:1.8;margin-bottom:10px">
        把 Tapescript / 听力原文粘贴进来，或从网页抓取正文。AI 会按题号范围切分到 ${roots.length} 篇材料，
        去掉题干说明、页眉页脚和中文注释，保留原文；保存后即可用本地 TTS 逐句朗读。
      </div>
      <div class="row" style="gap:8px;align-items:flex-end;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div class="hint" style="margin-bottom:4px">网页地址（仅 http/https）</div>
          <input class="inp" id="fillUrl" placeholder="https://…/tapescript.html" style="width:100%">
        </div>
        <button class="btn btn-gh" id="fillFetch">联网抓取</button>
      </div>
      <div class="hint" id="fillFetchMsg" style="line-height:1.7;margin-bottom:10px">
        抓的是网页正文，可能混入导航/评论；请自己确认是该篇 Tapescript，再点「AI 审核并补入」。
      </div>
      <textarea class="inp" id="fillRaw" style="min-height:300px"
        placeholder="粘贴听力原文，例如：Conversation one ... Question 1 ..."></textarea>
      <div class="hint" id="fillMsg" style="margin-top:8px;line-height:1.7"></div>
      <div class="row" style="margin-top:10px;justify-content:flex-end;gap:8px">
        <button class="btn btn-gh" data-x>取消</button>
        <button class="btn btn-pri" id="fillGo">AI 审核并补入</button>
      </div>`, bx => {
      bx.querySelector('[data-x]').onclick = App.closeModal;
      const ta = bx.querySelector('#fillRaw');
      const btn = bx.querySelector('#fillGo');
      const msg = bx.querySelector('#fillMsg');
      const urlInp = bx.querySelector('#fillUrl');
      const fetchBtn = bx.querySelector('#fillFetch');
      const fetchMsg = bx.querySelector('#fillFetchMsg');
      if (fetchBtn) fetchBtn.onclick = () => this._fetchTranscriptUrl(urlInp && urlInp.value, ta, fetchMsg, fetchBtn);
      btn.onclick = async () => {
        const raw = String(ta.value || '').trim();
        if (raw.length < 80) { msg.innerHTML = '<span style="color:var(--err)">内容太短，先粘贴完整听力原文</span>'; return; }
        if (!AI.ready) { msg.innerHTML = '<span style="color:var(--err)">AI 未启用：请先在设置里填写 API Key/模型</span>'; return; }
        btn.disabled = true; btn.textContent = 'AI 审核中…';
        msg.innerHTML = '<span style="color:var(--pri)">正在按题号切分并审核，约需 30–90 秒…</span>';
        try {
          const items = await Promise.race([
            this._reviewTranscript(raw, roots),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI 审核超时（100 秒），请缩短原文或改用分段粘贴')), 100000)),
          ]);
          if (!items || !items.length) throw new Error('AI 没有返回可用的分段');
          this._applyTranscript(roots, items);
        } catch (e) {
          btn.disabled = false; btn.textContent = '重试';
          msg.innerHTML = '<span style="color:var(--err)">' + esc(e && e.message || e) + '</span>';
        }
      };
    });
  },

  /**
   * 「联网抓取」：URL → fetch（APK 内 js/native-http.js 已把外部请求转给 CapacitorHttp，
   * 可跨域）→ extractArticleText 纯函数抽正文 → 填进 textarea。**不自动提交 AI**。
   * 只允许 http/https，10 秒超时；失败给出具体原因（地址/网络/跨域/非 HTML/超时）。
   */
  async _fetchTranscriptUrl(rawUrl, ta, msg, btn) {
    const setMsg = html => { if (msg) msg.innerHTML = html; };
    const url = String(rawUrl == null ? '' : rawUrl).trim();
    if (!url) { setMsg('<span style="color:var(--err)">请先填写网页地址（http/https）</span>'); return; }
    if (!/^https?:\/\//i.test(url)) { setMsg('<span style="color:var(--err)">只支持 http/https 网页地址</span>'); return; }
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
    } catch (e) {
      setMsg('<span style="color:var(--err)">地址格式不正确（只支持 http/https）</span>');
      return;
    }
    if (typeof fetch !== 'function') {
      setMsg('<span style="color:var(--err)">当前环境不支持网络请求，请改用粘贴</span>');
      return;
    }
    const label = btn ? btn.textContent : '联网抓取';
    if (btn) { btn.disabled = true; btn.textContent = '抓取中…'; }
    setMsg('<span style="color:var(--pri)">正在抓取网页正文…（10 秒超时）</span>');
    let timer = null;
    let ctrl = null;
    const timeoutP = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        reject(new Error('抓取超时（10 秒）'));
      }, 10000);
    });
    try {
      ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const req = fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        signal: ctrl ? ctrl.signal : undefined,
      });
      const res = await Promise.race([req, timeoutP]);
      if (!res || !res.ok) throw new Error('HTTP ' + ((res && res.status) || '?'));
      const ctype = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
      if (ctype && !/html|xml|text\/plain/i.test(ctype)) {
        throw new Error('返回的不是网页（' + ctype.split(';')[0].trim() + '）');
      }
      const html = await res.text();
      const text = extractArticleText(html);
      if (!text || text.length < 80) throw new Error('没有抽到正文（可能是动态加载页面，或需要登录）');
      const oldText = ta ? String(ta.value || '').trim() : '';
      if (ta) ta.value = oldText ? oldText + '\n\n' + text : text;
      setMsg('<span style="color:var(--ok)">已抓取 ' + text.length + ' 字符（' + (oldText ? '追加到' : '填入')
        + '文本框）。抓的是网页正文，请自己确认是该篇 Tapescript，再点「AI 审核并补入」。</span>');
    } catch (e) {
      const em = String((e && e.message) || e || '');
      let tip;
      if (/超时|timeout|abort/i.test(em)) tip = '抓取超时（10 秒）：网络慢、站点不响应或被拦截';
      else if (/failed to fetch|networkerror|load failed|网络|跨域|cors/i.test(em)) {
        tip = '网络请求失败：可能是断网、跨域/CORS 限制或站点拒绝访问'
          + (typeof window !== 'undefined' && window.__nativeHttp ? '' : '（APK 内会走原生网络，可跨域）');
      } else if (/HTTP \d+/.test(em)) tip = '网页返回错误（' + em + '）';
      else tip = em || '抓取失败';
      setMsg('<span style="color:var(--err)">' + esc(tip) + '</span>');
    } finally {
      if (timer) clearTimeout(timer);
      if (btn) { btn.disabled = false; btn.textContent = label || '联网抓取'; }
    }
  },

  async _reviewTranscript(raw, roots) {
    const targets = roots.map((p, i) => ({
      id: p.id,
      title: p.title || ('第' + (i + 1) + '篇'),
      questions: (p.qs || []).map(q => String(q.q || '')).filter(Boolean).slice(0, 12),
    }));
    const prompt = [
      '你是四六级听力 Tapescript 校对员。下面是一份从网页/文档抓取的听力原文，以及按题号拆好的目标篇目。',
      '请只做文本整理，不要编造、不要改写句意：',
      '1) 去掉 Directions、题号说明（Questions X to Y are based on...）、题干 Question N、页眉页脚、中文注释；',
      '2) 修复 OCR/复制造成的缺空格、大小写、标点问题；',
      '3) 按目标篇目顺序切分原文，每个目标返回一个 script 字符串数组（每句/每个说话人一行）；',
      '4) 找不到对应原文的目标返回空数组，绝对不要用题干冒充原文。',
      '只输出 JSON：{"items":[{"id":"目标id","script":["..."]}]}',
      '', '目标篇目：', JSON.stringify(targets), '', '抓取原文：', String(raw).slice(0, 24000),
    ].join('\n');
    const out = await AI.jsonRetry([
      { role: 'system', content: '你只输出合法 JSON，不要 markdown。' },
      { role: 'user', content: prompt },
    ], { max: 12000, temp: 0.1, timeout: 180000 });
    const items = Array.isArray(out) ? out : (out && out.items) || [];
    return (items || []).map(x => ({
      id: x && x.id, script: (x && Array.isArray(x.script) ? x.script : [])
        .map(s => String(s || '').trim()).filter(Boolean),
    }));
  },

  _applyTranscript(roots, items) {
    const byId = new Map((items || []).map(x => [String(x.id), x]));
    let done = 0;
    roots.forEach((p, i) => {
      const it = byId.get(String(p.id)) || items[i];
      const lines = it && Array.isArray(it.script) ? it.script : [];
      if (!lines.length) return;
      p.script = lines.map((en, n) => ({ s: n, en: String(en) }));
      done++;
    });
    const b = Store.d.contentBackup && Store.d.contentBackup.listening;
    const bArr = Array.isArray(b) ? b : (b && Array.isArray(b.passages) ? b.passages : []);
    roots.forEach(p => {
      const hit = bArr.find(x => x && String(x.id) === String(p.id));
      if (hit && p.script && p.script.length) hit.script = p.script;
    });
    Store.flush();
    App.closeModal();
    App.toast('已补入 ' + done + ' 篇听力原文，可直接播放', done ? 'ok' : 'err');
    this.piPass = 0; this._lastPassId = null;
    this._shell(document.querySelector('#view'));
  },
  _bindCommon(box, fullText, item) {
    const self = this;
    const rate = () => {
      const s = $('#spd', box);
      return s ? +s.value : (Store.d.settings.speechRate || 1);
    };
    // 当前段落（长篇=整篇；单句/对话=逐句）
    const lines = $$('.script-line', box).map(x => ({ el: x, text: x.dataset.say || '' }));
    /* 有题目时主播放按钮按考场顺序：原文 → 逐题题干；没有题目（单句/对话）行为不变。
     * 注意题干要**点击时**才取（_bindCommon 早于 _renderQuiz 执行，快照会是空的）。*/
    /* 考试参数在**点击时**读取（页面上可改；改动会写入设置） */
    const examReadOptions = () => {
      const c = $('#examOpts', box);
      return c ? !!c.checked : !!Store.d.settings.listenReadOptions;
    };
    const examPauseMs = () => {
      const s = $('#examPause', box);
      const v = s ? +s.value : Number(Store.d.settings.listenQaPause || 15);
      return (Number.isFinite(v) ? Math.max(0, v) : 15) * 1000;
    };
    const eo = $('#examOpts', box);
    if (eo) eo.onchange = () => { Store.d.settings.listenReadOptions = !!eo.checked; Store.flush(); };
    const ep = $('#examPause', box);
    if (ep) ep.onchange = () => { Store.d.settings.listenQaPause = +ep.value; Store.flush(); };
    const ec = $('#examChime', box);
    if (ec) ec.onchange = () => { Store.d.settings.listenChime = !!ec.checked; Store.flush(); };
    const ee = $('#examEnd', box);
    if (ee) ee.onchange = () => { Store.d.settings.listenEndSay = !!ee.checked; Store.flush(); };
    /* 发音诊断：Speech.diag 是语音模块里现成的环形日志，记录每一次朗读
     * （文本 / 排队等待 / 起音 / 朗读时长 / 结束原因）。"题干到底有没有被朗读、
     * 引擎有没有回调"看这张表最直接——no-start / no-end 就是引擎没响应。*/
    const diagBtn = $('#diagBtn', box);
    if (diagBtn) diagBtn.onclick = () => {
      const el = $('#diagBox2', box);
      if (!el) return;
      const rows = (typeof Speech !== 'undefined' && Speech.diag) ? Speech.diag : [];
      el.style.display = '';
      if (!rows.length) { el.textContent = '还没有朗读记录：先点播放，再回来查看。'; return; }
      /* 【为什么要显示音色】"有时还是人机声"必须能当场分辨：这一句用的是云端神经音色，
       * 还是本地机器声（自动选的、还是设置里显式指定的）。光看毫秒数看不出来。*/
      el.innerHTML = '<b>最近 ' + rows.length + ' 次朗读（毫秒）</b>'
        + '<table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse">'
        + '<tr><th style="text-align:left">内容</th><th>音色</th><th>排队</th><th>起音</th><th>朗读</th><th>结束</th></tr>'
        + rows.map(r => '<tr><td>' + esc(r.text) + '</td>'
          + '<td style="font-size:11px">' + esc(String(r.voiceName || '—').replace(/^Microsoft\s*/, '').slice(0, 28))
          + (r.voiceCloud ? ' <b style="color:var(--pri)">云端</b>' : ' 本地') + '</td>'
          + '<td style="text-align:center">' + r.waitMs + '</td>'
          + '<td style="text-align:center">' + r.startMs + '</td>'
          + '<td style="text-align:center">' + r.speechMs + '</td>'
          + '<td style="text-align:center">' + esc(r.why) + '</td></tr>').join('')
        + '</table><div class="hint">「排队」大 = 队列积压；「起音」大 = 引擎启动慢；'
        + '<b>no-start / no-end / no-audio</b> = 引擎没真正读出声音（no-audio 特指"起音了但没声"，'
        + '云端音色连续两次就会暂时退回本地，60 秒后自动再试，也可在设置页点「重新启用云端音色」）。'
        + '音色列写明每句用的是<b>云端</b>还是本地。</div>';
    };
    /* 【题干来源：优先 DOM，其次题库数据】
     * 只依赖 DOM 曾导致"点了播放只读原文"：题干是 _renderQuiz 渲染的，
     * 任何让查询落空的时序/结构变化都会静默失败。题库数据 p.qs 一定存在，
     * 因此这里用数据兜底，并在状态行里说明用的是哪一种。*/
    const dataStems = (item && Array.isArray(item.qs)) ? item.qs.map((q, i) => ({
      text: (i + 1) + '. ' + String((q && q.q) || ''),
      opts: (q && Array.isArray(q.opts)) ? q.opts.slice() : [],
    })) : [];
    const stemsNow = () => {
      const dom = this._quizStems(box);
      return (dom && dom.length) ? dom : dataStems;
    };
    const setStatus = msg => {
      const el = $('#playStatus', box);
      if (el) el.innerHTML = msg;
    };
    const examEndSay = () => {
      const c = $('#examEnd', box);
      return c ? !!c.checked : Store.d.settings.listenEndSay !== false;
    };
    const examChime = () => {
      const c = $('#examChime', box);
      return c ? !!c.checked : Store.d.settings.listenChime !== false;
    };
    /* 单句听力的播放：只播这一句**英文原文**（走 _playLines，保留逐词高亮）。
     * 不套"考场顺序"：单句本来就没有题干，那条路径会去找题干并提示
     * "这道材料没有题目数据，只播原文"（用户看到的就是"读完就结束 + 一句莫名其妙的提示"）。*/
    const playSentence = session => this._playLines(lines, { rate: rate(), leadIn: listenLeadInMs(), session });

    const playExam = opts => {
      Speech.primeAudio();   // 点击手势里预热音频上下文，否则提示音播不出来
      return this._playExamOrder(lines, stemsNow(),
        Object.assign({
          readOptions: examReadOptions(), gapMs: examPauseMs(), chime: examChime(), status: setStatus,
          endSay: examEndSay(), endText: Store.d.settings.listenEndText,
          // 题干播报时在播放区显示大字：即使听不到，也能看出系统有没有走到题干这一步
          question: (n, total, body) => {
            const el = $('#qNow', box);
            if (el) el.textContent = '🔊 第 ' + n + '/' + total + ' 题：' + body;
          },
        }, opts));
    };

    on(box, 'click', '[data-act]', async (e, t) => {
      const a = t.dataset.act;
      switch (a) {
        case 'play': case 'playDlg': case 'playPassage':
          t.classList.add('playing');
          this.playing = false;
          this.stopHL();
          /* 新会话：旧链（上一段的原文/题干）会因 session 不一致立刻退出 */
          const session = this._newPlaySession();
          /* 单句听力没有题干：走它自己的播放路径；其余（对话/长篇）仍按考场顺序
           * 先原文、再逐题题干（起始缓冲是听力独有需求，默认 2 秒）。*/
          (this.kind === 'sentence'
            ? playSentence(session)
            : playExam({ rate: rate(), leadIn: listenLeadInMs(), readOptions: examReadOptions(), gapMs: examPauseMs(), session }))
            .then(() => t.classList.remove('playing'));
          break;
        case 'repeat': case 'repeatDlg': {
          if (this.playing) {
            this.playing = false;
            this.stopHL();
            t.textContent = '🔁 循环播放';
            t.classList.remove('playing');
          } else {
            this.stopHL();
            this.playing = true;
            t.textContent = '⏸ 停止循环';
            const loop = () => {
              if (!this.playing) return;
              const session = this._newPlaySession();
              /* 单句听力也走 playSentence()：只播这一句英文原文，不报题干、不报结尾语 */
              const run = (this.kind === 'sentence')
                ? playSentence(session)
                : this._playLines(lines, { rate: rate(), session });
              run.then(() => {
                if (this.playing && this._playCurrent(session)) setTimeout(loop, 450);
              });
            };
            loop();
          }
          break;
        }
        case 'stop': this.stopHL(); t.textContent = '停止'; break;
        case 's2s': this._seqRead(lines, rate()); break;
        case 'prev': case 'next': {
          // 长篇切换篇目；单句/对话切换句段
          if (['cet4', 'cet6'].includes(this.kind)) {
            const n = this.shown.length;
            this.piPass = (this.piPass + (a === 'next' ? 1 : n - 1)) % n;
            this.answers = {}; this.submitted = false; this._quizRevealed = false;
            $$('.part-tab').forEach((x, i) => x.classList.toggle('on', i === this.piPass));
          } else {
            const arr = this.kind === 'sentence'
              ? Dict.content.listening.sentences
              : (Dict.content.listening.dialogues || []);
            this.idx = (this.idx + (a === 'next' ? 1 : arr.length - 1)) % arr.length;
            // 换句时清空单句练习的作答状态
            /* 换句时清空单句练习的作答状态（只清选择） */
            this._sentSubmitted = false; this._sentPick = null;
          }
          this.playing = false;
          /* 换篇/换句必须先把上一段（含题干播报和留白计时）彻底停掉 */
          this.stopHL();
          this._body();
          break;
        }
        case 'checkDict': this._checkDict(); break;
        case 'cloudVoice': {
          /* 卡片上的「改用云端音色」：把被显式钉住的本地音色清掉，立刻用回云端神经音色 */
          const cleared = (typeof Speech.resetVoicePicks === 'function') ? Speech.resetVoicePicks(true) : [];
          App.toast(cleared.length
            ? '已改回自动（' + cleared.join('、') + '）：本句起使用云端神经音色'
            : '音色本来就是「自动」；若仍是机器声，点「🔍 发音诊断」看云端音色状态',
            cleared.length ? 'ok' : '');
          this._body();
          break;
        }
        case 'nb': ViewNotebook.open(); break;
        case 'import': Importer.open('listening'); break;
        case 'fillTranscript': this._fillTranscript(item); break;
        case 'autofillScript': case 'autofillStem':
          /* 「自动联网补全原文 / 联网补全题干」：强制重试一次（绕过"本次只跑一次"），
           * 不阻塞作答；AI 未配置/断网/超时只更新状态行，不弹错误框。*/
          this._autoFill(item || (this.shown && this.shown[this.piPass || 0]), { force: true });
          break;
      }
    });

    // 单句复现：读这一句英文原文
    on(box, 'click', '[data-say]', (e, t) => {
      this.playing = false;
      this.stopHL();
      const el = t.closest('.script-line');
      $$('.script-line', box).forEach(x => x.classList.remove('on'));
      if (el) el.classList.add('on');
      setStatus('🔁 复现：' + String(t.dataset.say || '').slice(0, 60));
      Speech.speak(t.dataset.say, { rate: rate(), listening: true });
    });

    // 句子进度：单句模式下高亮当前句
    on(box, 'click', '.script-line', (e, t) => {
      if (this.mode === 'write') return;
      $$('.script-line', box).forEach(x => x.classList.toggle('on', x === t));
    });
  },

  /* ---------- 逐句复现 ---------- */
  _seqRead(lines, rate) {
    this.stopHL();
    this._playAbort = false;
    const token = this._playToken = (this._playToken || 0) + 1;
    let i = 0;
    const self = this;
    const next = () => {
      if (self._playToken !== token || self._playAbort) return;
      if (i >= lines.length) { self._clearWordHL(); return; }
      const l = lines[i]; i++;
      $$('.script-line').forEach(x => x.classList.remove('on'));
      l.el.classList.add('on');
      // 整句朗读（不是逐词拼读），句间留自然停顿
      const s = l.text;
      Speech.speak(s, {
        rate, gender: (self._spGender && self._spGender[i - 1]) || undefined, listening: true,
        onend: () => { if (self._playToken === token && !self._playAbort) setTimeout(next, self._sentenceGap(s)); },
      });
    };
    next();
  },

  /** 按难度、句长和句末语气给自然但不拖沓的句间停顿。 */
  /**
   * 句间停顿（毫秒）。
   * 【按清单调整】不再用逗号级微停顿（70–130ms，且每段还要等 preRoll），改为：
   *   完整句子之间：300–400ms（自然换气）
   *   段落之间：    600–800ms（换段）
   * paraStart 由原文行的 data-para 标记决定（导入时写入；没有标记按句子处理）。
   */
  _sentenceGap(text, paraStart) {
    /* 【独白更连贯】独白是一个人连续说一段话，句间留 300–400ms 会听出"一句一停"的
     * 割裂感（而且每句还要叠加引擎的起音时间）。独白（没有说话人标注，或用户强制了
     * 单一音色）把停顿压到换气级别：句子 160–200ms、段落 380ms。
     * 对话仍保留原来的停顿——对话本来就有来有回，停了才自然。*/
    const mono = !this._spGender || !!Speech._forceGender;
    if (paraStart) return mono ? 380 : 700;
    const t = String(text || '').trim();
    // 问句/感叹句收尾稍长一点，让语气落下来
    if (/[?!]["')\]]?$/.test(t)) return mono ? 200 : 400;
    return mono ? 160 : 340;
  },

  /* ---------- 听力原文默写批改 ---------- */
  _checkDict() {
    const ta = $('#dictation');
    const out = $('#dictResult');
    if (!ta || !out) return;
    const user = ta.value.trim();
    if (!user) { App.toast('请先写下你听到的内容', ''); return; }
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
    const mine = norm(user);
    const truth = norm(this._curText());
    // 逐词比对（允许 15% 容错）
    const setTruth = new Set(truth);
    const hit = mine.filter(w => setTruth.has(w)).length;
    const miss = truth.filter(w => !new Set(mine).has(w));
    const rate = truth.length ? hit / truth.length : 0;
    out.innerHTML = `<div class="tipbox" style="margin-top:12px">
      <b>对照批改</b>　识别率 <b style="color:${rate >= .85 ? 'var(--ok)' : rate >= .6 ? 'var(--warn)' : 'var(--err)'}">${Math.round(rate * 100)}%</b>
      （命中 ${hit} / ${truth.length} 词）<br>
      ${miss.length ? `<span style="color:var(--tx3)">漏掉或写错：${miss.slice(0, 20).map(esc).join('、')}</span>` : '<span style="color:var(--ok)">全部命中</span>'}
    </div>`;
  },

  _curText() {
    const p = this.shown && this.shown[this.piPass || 0];
    if (p) return (p.script || []).map(x => x.en).join(' ');
    if (this.kind === 'sentence') {
      const s = Dict.content.listening.sentences[this.idx];
      return s ? s.en : '';
    }
    if (this.kind === 'dialogue') {
      const d = (Dict.content.listening.dialogues || [])[this.idx];
      return d ? (d.turns || []).map(t => t.en).join(' ') : '';
    }
    return '';
  },

  _answered() { return Object.keys(this.answers).length; },
  _score(qs) {
    return qs.reduce((n, q, i) => n + (this.answers[i] === q.a ? 1 : 0), 0) * 2.5;
  },

  /* ---------- 逐词朗读 + 高亮 ---------- */
  /**
   * 逐词朗读 + 精确高亮。
   *
   * @param {Array<string|{text:string, gender?:'male'|'female'}>} sentences
   *        传字符串则整段同一音色；传对象可逐行指定音色（对话场景）。
   */
  /**
   * 整段/逐句连续朗读（推荐路径）
   *
   * 【为什么不用逐词朗读】
   * 逐词朗读（每词一次 speak()）听起来是一顿一顿的机械音，
   * 完全不像真实考试听力。真实考试是**连贯的整段语音**，
   * 语调起伏与句间停顿都由语音引擎自然产生。
   *
   * 实现要点：
   * 1. 每个**句子**作为一次 speak() 调用（而不是每个词），
   *    句间留 380ms 停顿 —— 接近真人换气的节奏。
   * 2. 词级高亮用 `onboundary`（charIndex → 定位到具体词 span）。
   *    若浏览器/语音包不触发该事件（`_bHit` 一直为 0），
   *    自动降级为句级高亮：宁可粗一点，也不能读得断开。
   * 3. 对话按 `sp` 标注轮流男女声（M/W），实现"分角色朗读"。
   *
   * @param {Array<{text:string}>} lines 句子数组
   * @param {object} o { rate, gender, onend }
   * @returns {Promise}
   */
  /**
   * 取当前答题卡的题干元素（.q-item .qt）。
   * 【必须在点击播放时调用，不能在 _bindCommon 里提前快照】
   * _passage() 的顺序是：先 _bindCommon(...) 再 _renderQuiz(...)，
   * 也就是说绑定时题干 DOM 还没生成——快照拿到的是空数组，
   * 表现就是「点播放只读原文，跟以前一样」。
   * 回退：答题卡不在 box 内时按全文档找（兼容其它渲染路径）。
   */
  _quizStems(box) {
    const inBox = $$('#quizCard .q-item', box);
    const list = (inBox && inBox.length) ? inBox : $$('.q-item');
    return (list || []).map(it => {
      const qt = it.querySelector ? it.querySelector('.qt') : null;
      const opts = it.querySelectorAll ? Array.from(it.querySelectorAll('.q-opt')).map(o => {
        const span = o.querySelector ? o.querySelector('span:not(.k)') : null;
        const raw = String((span && span.textContent) || (o && o.textContent) || '');
        /* 只去掉 "A) " / "B. " 这种**带分隔符**的选项编号。
         * 不能写成 [.)]?（把分隔符设为可选）——那样 "Alpha"、"A good idea"
         * 这类选项的首字母会被一起吃掉。*/
        return raw.replace(/^\s*[A-D]\s*[.)、．]\s*/, '').trim();
      }) : [];
      return { el: qt, text: String((qt && qt.textContent) || ''), opts: opts };
    });
  },
  /**
   * 【四六级考场顺序】先播原文，再按题号逐题播题干——真实考场就是这么放的：
   * 一段音频先放完整原文，然后 "Question 1. …" "Question 2. …" 逐个报题干，
   * 题间留出作答时间。旧版只放原文，所以在软件里做题和考场顺序不一致。
   * @param {Array<{text:string}>} lines 原文句子
   * @param {Array<HTMLElement>} stems 题干元素（.q-item .qt），可空
   * @param {object} o { rate, leadIn, gapMs }
   */
  async _playExamOrder(lines, stems, o = {}) {
    /* 官方说明（四六级考试说明）：「每个问题后留有 13-15 秒的答题时间」。
     * 所以默认按考场留白 15 秒；可在听力页调整（13/15/20 秒）。*/
    /* session：这次播放的会话号。新播放/停止都会换 session；旧链每一步都用它自检，
     * 不会再因为新播放把 _playAbort 重置成 false 而“复活”继续读上一段的题干。*/
    const session = o.session != null ? o.session : this._playSession;
    const gapMs = o.gapMs == null ? 15000 : o.gapMs;
    const status = t => { if (typeof o.status === 'function') o.status(t); };
    const total = (stems || []).length;
    status('① 正在播报原文…' + (total ? '（之后还有 ' + total + ' 道题的题干）' : '（本题没有题干）'));
    await this._playLines(lines, Object.assign({}, o, { session }));
    if (!this._playCurrent(session)) { status('已停止'); return; }
    if (!total) {
      /* 不再静默返回：没有题干时也要告诉用户，否则看起来就是"只读了原文" */
      status('⚠️ 没有找到题干，无法按考场顺序播报（材料里没有题目数据）');
      App.toast('这道材料没有题目数据，只播原文', '');
      return;
    }
    /* 【原文与题干之间的节奏】原文读完 → 2.5 秒 → 叮咚提示音 → 2.5 秒 → 逐题报题干。
     * 用户要求 2-3 秒各一段；提示音给一个明确的听觉分界，考场节奏也更清楚。*/
    const preChime = o.chimeBeforeMs == null ? 2500 : o.chimeBeforeMs;
    const postChime = o.chimeAfterMs == null ? 2500 : o.chimeAfterMs;
    if (o.chime !== false) {
      status('🔔 原文结束，' + (preChime / 1000) + ' 秒后播提示音…');
      if (preChime > 0) await new Promise(res => setTimeout(res, preChime));
      if (!this._playCurrent(session)) { status('已停止'); return; }
      await Speech.chime();
      status('🔔 叮咚 → ' + (postChime / 1000) + ' 秒后开始报题干');
      if (postChime > 0) await new Promise(res => setTimeout(res, postChime));
      if (!this._playCurrent(session)) { status('已停止'); return; }
    }
    for (let i = 0; i < stems.length; i++) {
      if (!this._playCurrent(session)) return;
      stems.forEach(x => x.classList && x.classList.remove('ask'));
      if (stems[i].classList) stems[i].classList.add('ask');
      // 题干自带 "1. " 前缀，播报时去掉，避免读成 "Question 1. 1. …"
      const item = stems[i] || {};
      const raw = item.text != null ? item.text : item.textContent;
      const body = String(raw || '').replace(/^\s*\d+\s*[.、．]\s*/, '').trim();
      /* 选项默认不读：真题 Directions 原文是
       * "Both the news report and the questions will be spoken only once.
       *  After you hear a question, you must choose the best answer from the four
       *  choices marked A), B), C) and D)." —— 被播报的是 questions，
       *  A)–D) 四个选项印在试卷上。需要连选项一起听时打开听力页的开关即可。*/
      const parts = [];
      if (body) parts.push(body);
      if (o.readOptions) {
        const list = Array.isArray(item.opts) ? item.opts : [];
        list.forEach((txt, k) => { if (txt) parts.push('ABCD'[k] + ') ' + String(txt).trim()); });
      }
      if (parts.length) {
        const say = 'Question ' + (i + 1) + '. ' + parts.join(' ');
        if (typeof o.question === 'function') o.question(i + 1, total, body);
        status('② 正在播报第 ' + (i + 1) + '/' + total + ' 题题干：' + body.slice(0, 40) + (body.length > 40 ? '…' : ''));
        await new Promise(res => {
          let settled = false;
          const fin = () => { if (!settled) { settled = true; res(); } };
          try {
            Speech.speak(say, { rate: o.rate, listening: true, onend: fin, onerror: fin });
          } catch (e) { fin(); }
          setTimeout(fin, 15000);   // 兜底：引擎不回调也不能卡住后面的题
        });
      }
      if (!this._playCurrent(session)) { status('已停止'); return; }
      if (gapMs > 0) {
        status('⏳ 留白 ' + Math.round(gapMs / 1000) + ' 秒（考场答题时间）… 下一题：' + (i + 2) + '/' + total);
        await new Promise(res => setTimeout(res, gapMs));
        if (!this._playCurrent(session)) { status('已停止'); return; }
      }
    }
    stems.forEach(x => x.classList && x.classList.remove('ask'));
    if (!this._playCurrent(session)) return;
    /* 【结尾语】最后一道题的留白结束后播报"听力到此结束"——考场节奏的收尾。
     * 用中文音色播报；系统里没有中文音色时改说英文，避免用英文音色念中文（听不清）。*/
    const endSay = o.endSay !== false;
    const endText = (o.endText != null && String(o.endText)) || '听力到此结束';
    if (endSay && endText) {
      const zh = typeof Speech.hasLang === 'function' && Speech.hasLang('zh');
      const say = zh ? endText : 'This is the end of the listening test.';
      status('🔔 留白结束，播报结尾语：' + say);
      await new Promise(res => {
        let settled = false;
        const fin = () => { if (!settled) { settled = true; res(); } };
        try {
          /* 中文结尾语必须留给系统中文音色（本地 Piper 只有英文）；英文结尾语走统一音色 */
          Speech.speak(say, { rate: 1, lang: zh ? 'zh-CN' : 'en-US', listening: !zh, onend: fin, onerror: fin });
        } catch (e) { fin(); }
        setTimeout(fin, 15000);   // 兜底：引擎不回调也不能卡住收尾
      });
      status('✅ 听力到此结束（原文 + ' + total + ' 道题干）');
      return;
    }
    status('✅ 播放完成：原文 + ' + total + ' 道题干');
  },

  _playLines(lines, o = {}) {
    this._clearWordHL();
    this._playAbort = false;
    // 每轮播放使用独立序号；被新播放/停止操作取代的旧回调不能再改高亮。
    const playToken = this._playToken = (this._playToken || 0) + 1;
    this._bHit = 0;                 // onboundary 触发次数（用于判断是否降级）
    this._silent = false;           // 引擎不可用时转静音逐句模式
    if (!lines.length) return Promise.resolve();

    /* 语音引擎可用性检测：
     * 无引擎的环境（部分内嵌浏览器、自动化测试）里 speak() 既不播也不回调，
     * 必须走"静音推进"分支，否则整篇卡在第一句不动。*/
    const t0 = Date.now();
    const hasEngine = !!(window.speechSynthesis && Speech.voices.length);

    const domLines = $$('.script-line');
    let i = 0;
    const self = this;
    const session = o.session == null ? null : o.session;
    const isCurrent = () => self._playToken === playToken && !self._playAbort
      && (session == null || self._playSession === session);

    // 当前句的词 span，用于 onboundary 定位
    const wordsOf = idx => (domLines[idx] ? $$('.w', domLines[idx]) : []);

    const markLine = idx => {
      $$('.script-line').forEach(x => x.classList.remove('on'));
      $$('.script-line .w.on').forEach(x => x.classList.remove('on'));
      if (idx < 0 || idx >= domLines.length) return;
      const el = domLines[idx];
      el.classList.add('on');
      const box = document.getElementById('scriptLines');
      if (box) {
        const er = el.getBoundingClientRect(), br = box.getBoundingClientRect();
        if (er.top < br.top || er.bottom > br.bottom) {
          box.scrollTop += (er.top - br.top) - br.height / 3;
        }
      }
    };

    // charIndex → 词 span 下标
    /*词位置定位：见下方 inClause（按分句范围精确定位）。
     * 早前用 indexOf 逐词累计，遇到重复词/连字符会跳错位置，已废弃。 */

    const step = () => {
      if (!isCurrent()) return Promise.resolve();
      if (i >= lines.length) {
        self._clearWordHL();
        o.onend && o.onend();
        return Promise.resolve();
      }
      const idx = i;
      const text = lines[idx].text || lines[idx].en || '';
      i++;
      if (!text.trim()) return step();

      markLine(idx);
      const words = wordsOf(idx);

      /* 句内分段：把长句按逗号/分号等内部标点切成小段，逐段朗读，段间留短停顿；
       * 句号仍留在 speech 文本中，避免语音引擎在新句开头漏读首词。
       * 真人说话会在逗号处换气；整段一次读完会显得平、像在念稿。
       * 这是不依赖 SSML 也能明显提升自然度的做法。*/
      /* 【按整句送引擎，不切逗号】过去按逗号/分号切碎再逐段朗读，
       * 每段末尾都会被引擎当成句末做陈述句降调（terminal fall），
       * 加上段间叠加的 preRoll 等待，听起来一顿一顿的很机械。
       * 现在整句（含句内标点）一次交给引擎，句末的 ?/! 由它自己生成自然语调。*/
      const clauses = [{ text: text, gap: 0 }];
      const sourceWords = Array.from(text.matchAll(/[A-Za-z][A-Za-z'’-]*/g));

      /* ② lookahead 预推理：本句一开始，就把**下一句**送去合成。
       * Kokoro 合成一句要几百毫秒，串行「读完再合成」会把这时间直接加进句间静默；
       * 预取让下一句轮到它时已有音频（speech.js 里按 音色|语速|文本 缓存复用），
       * 句间就只剩下面 _sentenceGap() 设计好的停顿。只预取、不播放：
       * 停止/切段后不会突然出声（预取路径根本不创建 Audio 元素）。
       * 空行要跳过（原文里的段落空行也在 lines 里），音色取下一句自己的说话人。*/
      for (let k = idx + 1; k < lines.length; k++) {
        const t2 = String(lines[k].text || lines[k].en || '').trim();
        if (!t2) continue;
        Speech.prefetch(t2, { rate: o.rate, gender: (self._spGender && self._spGender[k]) || o.gender, listening: true });
        break;
      }

      return new Promise(resolve => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        /* 逐分句朗读：段间留短停顿，语气更自然。
         * charIndex 需要**加上前面分句的累计偏移**，
         * 否则每段都从0 开始算，高亮会一直跳回句首。*/
        const gender = (self._spGender && self._spGender[idx]) || o.gender;
        /* 【四级对话男声偏快】用户实测：六级短文男声正常，四级对话男声快。
         * 同一音色下只把「对话中的男声」播放速度降 5%（0.95x），独白/短文不变；
         * MediaPlayer 变速保持音高，不会变成慢放闷音。*/
        const isDialogue = !!(self._spGender && Object.keys(self._spGender).length > 1);
        const lineRate = (isDialogue && gender === 'male') ? Math.max(0.5, (o.rate || 1) * 0.95) : o.rate;
        let base = 0;
        let lineActiveWord = -1;
        let clauseGeneration = 0;

        const speakClause = (k) => {
          if (!isCurrent()) { done(); return; }
          if (k >= clauses.length) { clauseGeneration++; done(); return; }
          const clauseToken = ++clauseGeneration;
          let clauseFinished = false;
          const isClauseCurrent = () => isCurrent()
            && clauseGeneration === clauseToken && !clauseFinished;
          const cl = clauses[k];
          /* 本分句在整句中的起始偏移。
           * 必须在推进 base **之前**算好并捕获，
           * 否则回调里再读 base 已经是下一句的值，定位全错。*/
          const myBase = base;

          /* 本分句包含的词（按出现顺序）。
           * 用「从 myBase 开始往后找」来划定范围，
           * 而不是靠 filter 猜——后者会误匹配到全句其他位置的同名词。*/
          const inClause = [];
          // DOM span 与原文按相同正则逐项对齐，重复词（如两个 the）也保持各自位置。
          words.forEach((w, wi) => {
            const match = sourceWords[wi];
            if (!match) return;
            const at = match.index;
            if (at >= myBase && at < myBase + cl.text.length) inClause.push({ w, at, order: wi });
          });

           /* 时间轴兜底高亮
            * 【为什么需要】`onboundary` 并非在所有浏览器/语音包上都触发，
            * 有的只发出部分词边界。时间轴从 onstart 启动；收到真实边界时
            * 校准当前词和下一词的位置，缺失边界则由兜底继续推进。
           *【关键】timer 必须是**每个分句独立**的局部定时器，
           * 不能所有分句共用一个——否则新分句会清掉上一句的定时器，
           * 两个循环互相打断，表现为只有第一个词亮着。*/
          let myTimer = null;
          /* 用 clearTimeout：兜底高亮是 setTimeout 链，不是 setInterval。
           * 两者虽都能停止定时器，但混用会在改写逻辑时埋坑。*/
          const stopFallback = () => { if (myTimer) { clearTimeout(myTimer); myTimer = null; } };

          /* 兜底高亮：按**每个词自己的长度**决定亮多久，
           * 而不是整段均分。
           * 原来用 setInterval(estMs/词数) 均分，
           * 导致 "I" 和 "extraordinary" 亮一样久——短词一闪而过、
           * 长词迟迟不换，看起来就是"卡在某个词不动"。
           * 改成逐词 setTimeout：每个词的时长 = 它占本段字符数的比例。*/
          let fallbackStarted = false;
          const rate = o.rate || 1;
          /* 每字符约 90ms，并按用户选择的语速缩放。 */
          const MS_PER_CHAR = 90 / rate;
          const wordDuration = n => {
            const word = inClause[n] && inClause[n].w;
            return word ? Math.max(130, Math.min(600, word.textContent.length * MS_PER_CHAR)) : 0;
          };
          let ti = 0;
          let activeIndex = -1;
          let lastBoundaryHit = -1;
          const highlightWord = n => {
            const cur = inClause[n];
            if (!cur || !isClauseCurrent() || cur.order < lineActiveWord) return false;
            lineActiveWord = cur.order;
            activeIndex = n;
            $$('.script-line .w.on').forEach(x => x.classList.remove('on'));
            cur.w.classList.add('on');
            return true;
          };
          const tick = () => {
            myTimer = null;
            if (!isClauseCurrent() || settled || ti >= inClause.length) { stopFallback(); return; }
            const n = ti++;
            // 语音边界可能晚于计时兜底到达；不能因此把高亮倒退到相邻词。
            if (n <= activeIndex) {
              if (ti < inClause.length) myTimer = setTimeout(tick, wordDuration(activeIndex));
              return;
            }
            highlightWord(n);
            myTimer = setTimeout(tick, wordDuration(n));
          };
          const scheduleFallback = delay => {
            if (!fallbackStarted || !isClauseCurrent() || settled) return;
            stopFallback();
            myTimer = setTimeout(tick, delay);
          };
          const startFallback = () => {
            // 语音合成入队与实际发声之间可能有延迟，计时必须从 onstart 开始。
            if (fallbackStarted || !isClauseCurrent() || settled || !inClause.length) return;
            fallbackStarted = true;
            scheduleFallback(60);
          };

          /* 送给语音引擎的文本要去掉**首尾空白与孤立标点**。
           * 【首词失音的根因】分句切分点保留标点，第二段常以 ", " / " " 开头
           * （如 " are you volunteering for..."）。Chrome 的语音合成
           * 对**以空白开头的文本**会吞掉第一个音节，听起来就是"首词读了一半"。
           * 去掉前导空白后首音就能正常发出。
           * 注意：偏移计算仍用原始 cl.text（保持与整句 text 的位置一致）。*/
          const speakText = String(cl.text || '').replace(/^[\s,;:.、，。；：]+/, '').replace(/[\s]+$/, '');
          if (!speakText) {
            base = myBase + cl.text.length;
            clauseFinished = true;
            setTimeout(() => { if (isCurrent() && clauseGeneration === clauseToken) speakClause(k + 1); }, 20);
            return;
          }
          const skipChars = cl.text.length - String(cl.text).replace(/^[\s,;:.、，。；：]+/, '').length;

          Speech.speak(speakText, {
            rate: lineRate,
            gender,
            listening: true,
            onstart: startFallback,
            onboundary: (event) => {
              // Web Speech API 传入的是 SpeechSynthesisEvent，不是 charIndex 数字。
              if (event && event.name === 'sentence') return;
              const charIndex = typeof event === 'number' ? event
                : (event && Number.isFinite(event.charIndex) ? event.charIndex : null);
              if (charIndex == null || !isClauseCurrent() || settled) return;
              /* charIndex 是相对 **speakText** 的，而定位用的是整句 text，
               * 需补上被剥掉的前缀长度（trimStart 的字符数）。*/
              const abs = myBase + skipChars + charIndex;
              // 找到该位置所属的词（inClause 已在该分句范围内）
              let hit = -1;
              for (let n = 0; n < inClause.length; n++) {
                const e = inClause[n];
                if (abs >= e.at && abs < e.at + e.w.textContent.length) { hit = n; break; }
              }
              if (hit < 0 || hit <= lastBoundaryHit) return;
              lastBoundaryHit = hit;
              self._bHit++;
              // 兜底计时或下一分句已前进时，忽略迟到的旧边界，避免缩写处高亮倒退。
              if (inClause[hit].order < lineActiveWord) return;
              // 精确边界刷新当前词；若后续边界事件缺失，定时兜底继续推进下一词。
              fallbackStarted = true;
              if (!highlightWord(hit)) return;
              // 边界只允许向前推进；迟到事件不能把兜底游标倒回前面的词。
              ti = Math.max(ti, hit + 1);
              scheduleFallback(wordDuration(hit));
            },
            onend: () => {
              stopFallback();
              if (!isCurrent()) { done(); return; }
              if (!isClauseCurrent()) return;
              clauseFinished = true;
              base = myBase + cl.text.length;
              // 段间停顿：逗号处短一点，句号处长一点
              setTimeout(() => { if (isCurrent() && clauseGeneration === clauseToken) speakClause(k + 1); }, cl.gap || 90);
            },
            onerror: () => {
              stopFallback();
              if (!isCurrent()) { done(); return; }
              if (!isClauseCurrent()) return;
              clauseFinished = true;
              base = myBase + cl.text.length;
              setTimeout(() => { if (isCurrent() && clauseGeneration === clauseToken) speakClause(k + 1); }, 60);
            },
          });
        };
        speakClause(0);
        // 兜底：某些环境（无语音引擎 / 引擎卡死）不触发 onend，
        // 用「按字数估算的时长 + 余量」兜底推进，避免整篇卡在第一句。
        /* 兜底计时：**只在首句**用来探测引擎是否可用。
         * 后续句子绝不能因为"估算时长到了"就提前推进——
         * 那会造成两个用户可见的问题：
         *   1) 高亮跑得比朗读快（句子还没读完就跳下一句）
         *   2) 打断时 cancel 掉正在播的句子，导致下一句**首词只听到后半段**
         * 正常英文约 180 词/分钟 ≈ 每字符 380ms，这里给足余量。
         * 真正的进度由 onend 驱动，兜底只在onend 永不触发时兜底。*/
        const FIRST_PROBE = 4500 + text.length * 200;  // 首句：放宽到 4.5s+
        const LATER_GUARD = 20000 + text.length * 600;  // 后续：极宽松，正常永不触发
        setTimeout(() => {
          if (settled || !isCurrent()) return;
          if (idx === 0) {
            /* 首句超时 → 判定引擎不可用。
             * 判定依据不只是"超时"，还要看onboundary 是否有命中过——
             * 只要曾经收到过边界事件，就说明引擎在工作，只是这句慢。*/
            if (self._bHit > 0) { done(); return; }
            self._silent = true;
            App.toast('未检测到语音引擎（可在设置页检查系统语音），已切换为静音逐句模式', '');
          }
          done();
        }, idx === 0 ? FIRST_PROBE : LATER_GUARD);
      }).then(() => {
        if (!isCurrent()) return;
        /* 句间停顿：按标点给不同长度，让节奏更像真人换气。
         *   问号/叹号 → 略长（语气收尾）
         *   逗号结尾   → 短（其实还没说完）
         *   句号/无标点 → 中等
         * 静音模式按字数等速推进（没有真实语音时保持节奏感）。*/
        let gap;
        if (self._silent) {
          const wordCount = (text.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
          gap = Math.max(220, Math.min(650, wordCount * 36 / (o.rate || 1)));
        } else {
          /* 整句之间的自然换气停顿：300–400ms；段落之间 600–800ms。
           * 段落信息来自原文行的 data-para 标记（导入时写入），没有标记就按句子处理。*/
          const paraStart = !!(domLines[idx + 1] && domLines[idx + 1].dataset
            && domLines[idx + 1].dataset.para === '1');
          gap = self._sentenceGap(text, paraStart);
        }
        /* 【把整篇的链条接完】原来这里是 setTimeout(() => isCurrent() ? step() : null, gap)：
         * 下一句的 Promise 被丢掉，于是本句的 Promise 在本句读完时就 resolve —— 
         * 也就是说 _playLines() 只等到"第一句"就返回了（repeat 循环会与原文重叠；
         * 考场顺序播放的叮咚/题干也会提前启动、和剩下的原文抢语音队列）。
         * 现在返回一个等"后面全部读完"才 resolve 的 Promise。*/
        return new Promise(res => {
          setTimeout(() => {
            if (!isCurrent()) { res(); return; }
            step().then(res, res);
          }, gap);
        });
      });
    };

    /* 起始缓冲：先把第一句标好、等leadIn 毫秒再开口。
     * 这样"点了播放→先看到第一句被选中→2秒后开始读"，
     * 不会有"先听见声音、眼睛还在找句子"的错位感。*/
    if (o.leadIn > 0) {
      markLine(0);
      return new Promise(resolve => {
        setTimeout(() => {
          if (!isCurrent()) { resolve(); return; }
          /* 【必须把 step() 的 Promise 接出来】
           * 原来这里写的是 isCurrent() ? step() : resolve() —— step() 的返回被丢掉，
           * 这个 Promise 只在"被打断"时才 resolve，正常读完永远挂着。
           * 主播放键带着 leadIn 走这条分支，于是调用方 await 卡死：
           * 原文读完后既没有叮咚、也没有题干（外面看起来就是"只读原文"）。*/
          step().then(resolve, resolve);
        }, o.leadIn);
      });
    }
    return step();
  },

  /**
   * 逐词朗读（保留备用，仅在用户明确需要逐词跟读时使用）
   * @param {Array<string|{text:string, gender?:'male'|'female'}>} sentences
   */
  _playWords(sentences, o = {}) {
    this._clearWordHL();
    const lines = $$('.script-line');
    const arr = sentences.map(s => (typeof s === 'string' ? { text: s } : s));
    if (!lines.length) {
      Speech.speak(arr.map(x => x.text).join('. '), { rate: o.rate, gender: o.gender, listening: true });
      return;
    }

    let li = 0, wi = 0;
    const self = this;
    this._playAbort = false;

    const hl = () => {
      $$('.script-line .w.on').forEach(x => x.classList.remove('on'));
      $$('.script-line.on').forEach(x => x.classList.remove('on'));
      if (li >= lines.length) return;
      const line = lines[li];
      line.classList.add('on');
      const word = $$('.w', line)[wi];
      if (word) {
        word.classList.add('on');
        const box = document.getElementById('scriptLines');
        if (box) {
          const wr = word.getBoundingClientRect(), br = box.getBoundingClientRect();
          if (wr.top < br.top || wr.bottom > br.bottom) {
            box.scrollTop += (wr.top - br.top) - br.height / 3;
          }
        }
      }
    };

    const step = () => {
      if (self._playAbort) return;
      if (li >= lines.length) { self._clearWordHL(); o.onend && o.onend(); return; }
      const line = lines[li];
      const words = $$('.w', line);
      if (!words.length || wi >= words.length) { li++; wi = 0; hl(); return step(); }

      const raw = words[wi].textContent;
      hl();
      /* 该行音色：对话按 M/W 轮流男女声；未标注则用当前选择的音色。*/
      const gender = (self._spGender && self._spGender[li]) || o.gender;
      Speech.speak(raw, {
        rate: o.rate,
        gender,
        listening: true,
        onend: () => { wi++; setTimeout(step, 10); },
        onerror: () => { wi++; setTimeout(step, 10); },
      });
    };
    step();
  },

  /** 新的一次播放会话：play/循环每次开始都换 session。
   * 【为什么需要】旧实现只靠 _playAbort；而新播放一开头会把它重置为 false，
   * 于是上一段还在等待的「考场顺序」链在睡醒后看到 abort=false，就继续读上一段的题干——
   * 用户看到的就是「点下一篇后，上一段的题目还在读」。session 不受重置影响。*/
  _newPlaySession() {
    this._playSession = (this._playSession || 0) + 1;
    this._playAbort = false;
    return this._playSession;
  },
  _playCurrent(session) {
    /* 先看 abort：手工 stop（包括测试里直接置 _playAbort）必须立即生效；
     * 再看 session：新播放/停止会换会话号，旧链据此退出。*/
    if (this._playAbort) return false;
    return session == null || this._playSession === session;
  },

  stopHL() {
    this._playAbort = true;
    this._playSession = (this._playSession || 0) + 1;
    this._playToken = (this._playToken || 0) + 1;
    /* 没有在播就不要 cancel：cancel 之后引擎要安静约 200ms 才不吃字，
     * 点了播放却先白等 200ms 就是这么来的。*/
    Speech.stopIfBusy();
    this._clearWordHL();
  },

  /* ---------- 逐词高亮 ---------- */
  /**
   * 把一句话拆成带序号的单词 span。
   * 关键：每个单词按**出现位置**编号（w0,w1,w2...），
   * 因此 "Excuse me ... me" 里两个 me 是不同节点，可分别高亮。
   * 早期版本按词去重（同名共用一个节点），导致只高亮第一个。
   */
  _wSpan(text) {
    const tokens = String(text || '').split(/([A-Za-z][A-Za-z'’-]*)/);
    let i = 0;
    return tokens.map(tok => {
      if (!tok) return '';
      if (!/^[A-Za-z]/.test(tok)) return esc(tok);
      return `<span class="w" data-wi="${i++}">${esc(tok)}</span>`;
    }).join('');
  },

  _clearWordHL() {
    $$('.script-line .w.on').forEach(x => x.classList.remove('on'));
    $$('.script-line.on').forEach(x => x.classList.remove('on'));
    this._lastHL = null;
  },

  /** 从「M:/W:/Man:/Woman:/Male:/Female:」这类说话人前缀里拆出性别，并从**显示/朗读文本**里去掉前缀。
   * 内置数据本来就有 sp 字段；导入的原文/AI 文本常把标签写在正文里，不处理会念出“W colon”，
   * 也没法男女对读（用户要求导入听力按文本男女对问）。*/
  _normalizeSpeakerLines(lines) {
    if (!Array.isArray(lines)) return [];
    const RE = /^\s*(M|W|MAN|WOMAN|MALE|FEMALE)\s*[:：]\s*/i;
    return lines.map(l => {
      if (!l) return l;
      const en = String(l.en == null ? (l.text == null ? '' : l.text) : l.en);
      const m = en.match(RE);
      if (!m) return l;
      const tag = m[1].toUpperCase();
      const sp = (tag === 'M' || tag === 'MAN' || tag === 'MALE') ? 'M'
        : (tag === 'W' || tag === 'WOMAN' || tag === 'FEMALE') ? 'W' : (l.sp || '');
      const clean = en.replace(RE, '');
      return Object.assign({}, l, { en: clean, text: clean, sp: sp || l.sp || '' });
    });
  },

  /* ---------- 对话性别识别 ---------- */
  /**
   * AI 识别对话性别构成（男男 / 男女 / 女女）
   * 识别结果用于：1) 朗读时自动分配男声/女声　2) 界面上告知学生
   */
  async detectGenders(lines, paper) {
    if (!lines || !lines.length) {
      this._spGender = null;
      this.genderInfo = '';
      return null;
    }
    // 先用数据自带的 M/W 标注（最可靠）
    const annotated = lines.map(l => (l.sp || '').toUpperCase());
    if (annotated.some(x => x === 'M' || x === 'W')) {
      const map = {};
      /* 只给**有标注**的行指定性别：同一篇里没标注的行（旁白、题干、说明行）
       * 不能一律当女声，否则听感会变成"只有女生"。没标注的行留空 → 走全局音色。*/
      lines.forEach((l, i) => {
        if (annotated[i] === 'M' || annotated[i] === 'W') map[i] = annotated[i] === 'M' ? 'male' : 'female';
      });
      const hasM = Object.values(map).includes('male');
      const hasW = Object.values(map).includes('female');
      const label = hasM && hasW ? '男女对话' : (hasM ? '男男对话' : '女女对话');
      this._spGender = map;
      this.genderInfo = `本篇为${label}（依据对话中的说话人标注）`;
      return this.genderInfo;
    }

    /* 【对话类兜底】没有 M/W 标注时：若本篇从类型/标题/题型可判定为对话
     * （长对话、短对话、Section A 等），AI 不可用或识别失败就按轮次交替男女声；
     * 独白仍保持全篇同一音色——不再把独白读成“男女对话”。*/
    const kindHint = (paper && typeof this._paperKind === 'function') ? this._paperKind(paper) : '';
    const dialogue = isDialogueMaterial(paper, kindHint);
    const fallbackMono = () => {
      /* 【独白不轮换】没有说话人标注就**不指定逐行性别**：
       * 全篇用同一个音色（上方「女声/男声」按钮可强制指定）。*/
      this._spGender = null;
      this.genderInfo = '本篇按独白处理：全篇同一个音色（上方可切男声 / 女声）';
      return this.genderInfo;
    };
    const fallbackDialogue = () => {
      this._spGender = alternateGenders(lines.length);
      this.genderInfo = '按对话轮次自动交替男女声（未识别到真实性别）';
      return this.genderInfo;
    };

    // 数据没标注 → 交给 AI 判断（AI 未加载/未配置时不要抛错）
    if (typeof AI === 'undefined' || !AI || !AI.ready) {
      return dialogue ? fallbackDialogue() : fallbackMono();
    }
    try {
      const r = await AI.json([{
        role: 'system', content: `根据英语对话内容判断说话人的性别构成。
只返回 JSON：{"genders":["male","female",...],"label":"男男对话|男女对话|女女对话"}
数组长度必须与对话轮次一致，元素为 male 或 female。
判断依据：称谓（Mr/Ms/sir/madam）、称谓习惯、场景、句子风格。
举例：办公室上级对下属说话→male first；客服对顾客→female first。`
      }, {
        role: 'user', content: '对话内容：\n' + lines.map((l, i) => `${i + 1}. ${l.text || l.en || ''}`).join('\n')
      }], { max: 400 });
      if (r && Array.isArray(r.genders) && r.genders.length === lines.length
        && /对话/.test(String(r.label || ''))) {
        this._spGender = r.genders.map(x => (String(x).toLowerCase() === 'male' ? 'male' : 'female'));
        this.genderInfo = `本篇为${r.label || '对话'}（AI 识别）`;
      } else if (dialogue) {
        /* 明明是对话类却判成独白 → 也走交替兜底，避免整篇一个音色 */
        return fallbackDialogue();
      } else {
        /* AI 没判成对话（多半就是独白）→ 不轮换，全篇同一个音色 */
        this._spGender = null;
        this.genderInfo = '未识别出对话说话人：全篇用同一个音色（上方可切男声 / 女声）';
      }
      return this.genderInfo;
    } catch (e) {
      if (dialogue) return fallbackDialogue();
      /* 独白即使 AI 调用失败也不该显示"说话人识别失败"（用户会以为功能坏了）：
       * 按独白口径说明——全篇同一音色，可用上方按钮强制指定。*/
      return fallbackMono();
    }
  },

  /** 局部更新性别提示（不重渲染，避免循环） */
  _paintGender() {
    const el = $('#genderInfo');
    if (!el) return;
    el.textContent = this.genderInfo ? `🎭 ${this.genderInfo}` : '';
  },
};
window.ViewListen = ViewListen;
