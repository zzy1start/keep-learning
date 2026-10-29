/* ============ store.js : 本地数据层（localStorage）============ */
const Store = {
  KEY: 'keeplrn_v1',
  d: null,

  def() {
    return {
      createdAt: App.today(),
      settings: {
        theme: 'auto',
        ai: { baseUrl: '', key: '', model: 'gpt-4o-mini', enabled: false },
        dailyNew: 30,
        readingTime: 25,
        listeningRepeat: true,
        handwritingInk: '#1a2337',
        speechRate: 1,          // 听力语速
        speechVoice: '',        // 听力音色（空=自动）——背单词也用它作为回落
        speechVoiceFemale: '',  // 听力女说话人音色（空=自动；Edge 下自动优先云端神经音色）
        speechVoiceMale: '',    // 听力男说话人音色（空=自动）
        wordRate: 1,            // 背单词语速（与听力独立）
        wordVoice: '',          // 背单词音色（空=跟随听力音色）
        listenLeadIn: 2,        // 听力起始缓冲（秒）：点播放后先缓冲再发声，是听力独有的需求
        listenReadOptions: false, // 听力播放是否连 ABCD 选项一起读（真题 Directions 只播报 question，故默认关）
        listenQaPause: 15,       // 每题后留白秒数（官方说明：每个问题后留 13-15 秒答题时间）
        listenChime: true,       // 原文与题干之间播「叮咚」提示音（原文后 2.5s，提示音后 2.5s 开始报题干）
        listenEndSay: true,      // 最后一道题的留白结束后，播报结尾语（考场结束提示）
        listenEndText: '听力到此结束', // 结尾语中文文案（没有中文音色时自动改说英文）
        speechEngine: 'system', // system=系统语音（零下载）| neural=Kokoro 开源人声（首次约 90MB）
        ttsModel: 'onnx-community/Kokoro-82M-v1.0-ONNX',
        ttsDtype: 'q8',
        ttsVoice: 'af_heart',   // Kokoro 女声/女说话人音色（af_heart / bf_emma …）
        ttsVoiceMale: 'am_fenrir', // Kokoro 男声/男说话人音色（听力无说话人标记时按对话男女交替）
        allowOnlineVoices: false, // 是否允许「Microsoft * Online (Natural)」这类云端音色（仅 Edge 可用，默认排除）
        dictAudio: false,       // 真人词典音频层（有道 dictvoice，需经 serve.js 代理；默认关：会把所背单词发往第三方）
        dictAccent: '2',        // 词典音频口音：'1'=英音，'2'=美音
        /* 离线语音库（Piper VITS，随 APK 打包）：平板没有系统英语音色时自动接管听力/单词。
         * 默认女=jenny（英音）、男=ryan（美音）；alan 英音男声因不像四六级已移除。*/
        localTts: true,            // 总开关（安装版才有效）
        localTtsPreferred: false,  // 有系统音色时也优先用离线语音库（默认关：桌面仍用云端音色）
        localVoiceFemale: 'jenny',
        localVoiceMale: 'ryan',
      },
      // 词书学习记录: { [bookId]: { [word]: SRS } }
      srs: {},
      activeBook: 'cet6',
      vocabTest: {},          // 各词书词汇量测试结果
      notebook: [],           // 生词本
      readNotes: {},          // 阅读做题模式手写笔记 { [passageId]: strokes[] }
      listenLog: {},
      readLog: {},
      writeLog: [],           // 写作记录
      /* 最近输入记忆（只留最近 5 条，翻译页/写作页各自独立）
       * 翻译页自动记译文草稿、写作页自动记作文/译文草稿，用于「🕘 最近记录」里一键恢复。
       * 只存文本与题目定位信息，不改变 writeLog 的评分记录口径。*/
      translationHistory: [],     // 最近 5 条翻译输入
      writingHistory: [],         // 最近 5 条写作输入
      translationCustomTasks: [], // 用户自定义翻译题，随备份一起保存
      importedPapers: [],         // 已导入的 PDF/文档登记（哈希 + 年份/场次/套别），用于重复导入提醒
      translation: { totalScore: 0 }, // 翻译页手填的"本题满分"（0 = 按题型推导）
      stats: { days: [], streak: 0, lastStudy: '', daily: {} },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      this.d = raw ? Object.assign(this.def(), JSON.parse(raw)) : this.def();
    } catch (e) { console.warn('store load fail', e); this.d = this.def(); }
    // 补齐缺失字段
    const def = this.def();
    for (const k in def) if (this.d[k] === undefined) this.d[k] = def[k];
    this.d.settings = Object.assign(def.settings, this.d.settings);
    /* 【嵌套字段也要补齐】上面那个 for 只补**顶层**字段：存档里 stats 存在但缺 daily/days 时
     *（旧版本写的、或导入/部分损坏的存档），统计页第一行 `st.daily[k]` 就抛
     * TypeError: Cannot read properties of undefined —— 现象正是"统计点不开"。
     * 这里把用到的嵌套对象逐个补齐，缺什么补什么。*/
    const nest = (obj, defObj) => Object.assign({}, defObj, (obj && typeof obj === 'object') ? obj : {});
    /* 注意：数组也是 object，必须单独排除——存档里 srs 若是数组，
     * Object.keys 会给出 '0','1'，后面按词书取值就取到数字，一访问属性就抛。*/
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const asArr = v => Array.isArray(v) ? v : [];
    this.d.stats = nest(this.d.stats, { days: [], streak: 0, lastStudy: '', daily: {} });
    this.d.stats.days = Array.isArray(this.d.stats.days) ? this.d.stats.days : [];
    this.d.stats.daily = isObj(this.d.stats.daily) ? this.d.stats.daily : {};
    this.d.srs = isObj(this.d.srs) ? this.d.srs : {};
    this.d.vocabTest = isObj(this.d.vocabTest) ? this.d.vocabTest : {};
    this.d.listenLog = isObj(this.d.listenLog) ? this.d.listenLog : {};
    this.d.readLog = isObj(this.d.readLog) ? this.d.readLog : {};
    this.d.writeLog = asArr(this.d.writeLog);
    /* 最近输入记忆是后加的字段：旧存档里没有（上面 for 会补 []）或被写坏
     *（字符串/对象/数字）时统一归一为数组，否则 rememberInput/recentInputs 一碰就崩。*/
    this.d.translationHistory = asArr(this.d.translationHistory);
    this.d.writingHistory = asArr(this.d.writingHistory);
    this.d.notebook = asArr(this.d.notebook);
    this.d.translation = nest(this.d.translation, { totalScore: 0 });
    this.d.translationCustomTasks = asArr(this.d.translationCustomTasks);
    /* 【已停止使用开源 Kokoro 人声引擎】用户明确表示"这个始终无法调好"，不再提供该引擎。
     * 旧存档里可能还留着 speechEngine:'neural'，这里迁移回系统语音——
     * 否则页面仍会去下载 90MB 模型再回落，等于把已经否掉的方案又跑一遍。*/
    if (this.d.settings.speechEngine === 'neural') this.d.settings.speechEngine = 'system';
    /* 旧存档里的 PDF 标点残留（soundtrack.,If / life.In）一次性清掉：
     * 只修「句号后多一个逗号」与「小写字母后直接接大写」两种空格问题，不改字词。
     * 修复后打标记，避免每次启动全量扫描。*/
    if (!this.d.__punctRepairV1) {
      const fixPunct = s => s
        .replace(/\.\s*,\s*(?=[A-Za-z])/g, '. ')
        .replace(/([a-z])\.(?=[A-Z][a-z])/g, '$1. ');
      const walk = v => {
        if (typeof v === 'string') return fixPunct(v);
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
        return v;
      };
      ['contentBackup', 'readLog', 'writeLog', 'notebook'].forEach(k => {
        if (this.d[k] !== undefined) this.d[k] = walk(this.d[k]);
      });
      this.d.__punctRepairV1 = 1;
      this.flush();
    }
    return this.d;
  },
  save: App.debounce(function () { Store.flush(); }, 400),
  /** 删除所有“导入”的 PDF/文档内容（mine:true），保留单词进度/生词本/统计。*/
  clearImportedContent() {
    const targets = [
      ['listening', 'passages'],
      ['reading', 'passages'],
      ['writing', 'tasks'],
    ];
    let removed = 0;
    for (const [target, key] of targets) {
      const block = (typeof Dict !== 'undefined' && Dict.content && Dict.content[target]) || null;
      if (block && Array.isArray(block[key])) {
        const before = block[key].length;
        block[key] = block[key].filter(x => !(x && x.mine === true));
        removed += before - block[key].length;
      }
      if (this.d.contentBackup && this.d.contentBackup[target]) {
        const b = this.d.contentBackup[target];
        const arr = Array.isArray(b) ? b : (b && Array.isArray(b[key]) ? b[key] : []);
        const kept = arr.filter(x => !(x && x.mine === true));
        if (Array.isArray(b)) this.d.contentBackup[target] = kept;
        else this.d.contentBackup[target] = { ...b, [key]: kept };
        if (!kept.length) delete this.d.contentBackup[target];
      }
    }
    this.d.importedPapers = [];
    this.flush();
    return removed;
  },

  flush() {
    try {
      // _bookCache 只是运行时对词库的引用，不能序列化进localStorage，
      // 否则每次保存都会写入几 MB 并撑爆 5MB 配额
      const dump = Object.assign({}, this.d);
      delete dump._bookCache;
      localStorage.setItem(this.KEY, JSON.stringify(dump));
      this.lastFlushOk = true;
      return true;
    } catch (e) {
      this.lastFlushOk = false;
      App.toast('存储空间不足，请在设置中清理数据', 'err');
      return false;
    }
  },
  set(fn) { fn(this.d); this.flush(); },

  /* ---------- 最近输入记忆（翻译 / 写作各最多 5 条） ----------
   * 设计口径：
   * - 两个页面各自独立：translationHistory / writingHistory；
   * - 按 id 去重：同一次编辑会话反复输入只更新同一条并移到最前，
   *   换题 / 提交后视图生成新 id —— 这样历史里不会堆满同一段文字；
   * - 最新在前，最多 5 条，空文本不占位；
   * - 每次写入立刻 flush 到 localStorage，刷新/重启后仍在。
   */
  INPUT_FIELDS: { translation: 'translationHistory', writing: 'writingHistory' },

  _inputField(kind) { return this.INPUT_FIELDS[kind] || ''; },

  /** 记录一条输入。entry: {id, at, taskId, taskTitle, mode/tab, dir, text, chars} */
  rememberInput(kind, entry) {
    const field = this._inputField(kind);
    if (!field || !this.d || !entry) return [];
    const text = String(entry.text == null ? '' : entry.text);
    // 空文本（清空输入框）不占用记录位，也不覆盖已记下的内容
    if (!text.trim()) return this.recentInputs(kind);
    const item = Object.assign({}, entry, {
      id: String(entry.id || (kind + '::' + Date.now())),
      at: entry.at || new Date().toISOString(),
      taskId: entry.taskId == null ? '' : String(entry.taskId),
      taskTitle: entry.taskTitle == null ? '' : String(entry.taskTitle),
      text,
      chars: Number.isFinite(Number(entry.chars)) ? Number(entry.chars)
        : Array.from(text.replace(/\s+/gu, '')).length,
    });
    const list = this.recentInputs(kind);
    // 同 id = 同一次编辑会话：更新内容、更新时间，并移到最前
    const same = list.findIndex(x => x.id === item.id);
    if (same >= 0) list.splice(same, 1);
    list.unshift(item);
    this.d[field] = list.slice(0, 5);
    this.flush();
    return this.d[field];
  },

  /** 最近输入：最新在前，最多 5 条。旧存档里混入的坏条目直接跳过，渲染不会崩。 */
  recentInputs(kind) {
    const field = this._inputField(kind);
    const list = (field && this.d) ? this.d[field] : null;
    if (!Array.isArray(list)) return [];
    // 返回副本：视图（弹窗/恢复）即使改动返回对象也不会污染持久化数据
    return list.filter(x => x && typeof x === 'object' && typeof x.text === 'string')
      .slice(0, 5).map(x => Object.assign({}, x));
  },

  /** 清空某一页的最近输入（另一页不受影响），返回清掉的数量。 */
  clearInputs(kind) {
    const field = this._inputField(kind);
    if (!field || !this.d) return 0;
    const before = Array.isArray(this.d[field]) ? this.d[field].length : 0;
    this.d[field] = [];
    this.flush();
    return before;
  },

  /* ---------- 统计 ---------- */
  markStudy() {
    const t = App.today();
    const st = this.d.stats;
    let firstToday = false;
    if (st.lastStudy !== t) {
      firstToday = true;
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      st.streak = st.lastStudy === y ? st.streak + 1 : 1;
      st.lastStudy = t;
      if (!st.days.includes(t)) st.days.push(t);
      if (st.days.length > 400) st.days = st.days.slice(-400);
    }
    // 一次只培育一棵；成熟后，下一次学习才种新苗。
    if (typeof Garden !== 'undefined') {
      try { Garden.plantDay(t); } catch (e) { console.warn('garden plant fail', e); }
    }
    const day = this.d.stats.daily[t] || (this.d.stats.daily[t] = { words: 0, listen: 0, read: 0, write: 0, min: 0 });
    return day;
  },
  addStat(kind, n = 1) {
    const day = this.markStudy();
    day[kind] = (day[kind] || 0) + n;
    this.save();
  },

  /* ---------- 生词本 ---------- */
  nbHas(w) { return this.d.notebook.some(x => x.w === w); },
  nbAdd(item) {
    if (this.nbHas(item.w)) return false;
    this.d.notebook.unshift(Object.assign({
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      addedAt: new Date().toISOString(),
      status: 'new', mastered: false,
    }, item));
    this.flush();
    return true;
  },
  nbRemove(w) { this.d.notebook = this.d.notebook.filter(x => x.w !== w); this.flush(); },
  nbToggle(w, patch) {
    const it = this.d.notebook.find(x => x.w === w);
    if (it) { Object.assign(it, patch); this.flush(); }
    return it;
  },
  nbClearMastered() { this.d.notebook = this.d.notebook.filter(x => !x.mastered); this.flush(); },

  /* ---------- SRS 记录 ---------- */
  srsOf(book, word) {
    const b = this.d.srs[book] || (this.d.srs[book] = {});
    return b[word];
  },
  srsUpdate(book, word, patch) {
    const b = this.d.srs[book] || (this.d.srs[book] = {});
    b[word] = Object.assign(b[word] || { word, ef: 2.5, reps: 0, lapses: 0, stage: 0 }, patch);
    this.flush();
    return b[word];
  },
  bookProgress(book) {
    const b = this.d.srs[book] || {};
    const ks = Object.keys(b);
    /* 【2026-10-22】total 必须是「词书总词数」，不是 srs 记录数。
     * 恢复新词会删掉定级/测试写进 srs 的镜像记录（reps=0），如果拿记录数当分母，
     * 词书页/首页/统计的覆盖率会从 3% 直接跳到 100%（真机实测到过）。
     * 优先用运行时词书缓存，其次 Dict 已加载词书，最后才退回记录数。*/
    let bookTotal = 0;
    const cache = this.d._bookCache && this.d._bookCache[book];
    if (cache && Array.isArray(cache.words) && cache.words.length) bookTotal = cache.words.length;
    else if (typeof Dict !== 'undefined' && Dict.books && Dict.books[book] && Array.isArray(Dict.books[book].words)) {
      bookTotal = Dict.books[book].words.length;
    }
    return {
      learned: ks.filter(k => b[k].reps > 0).length,
      reviewing: ks.filter(k => b[k].next && new Date(b[k].next) <= new Date()).length,
      mastered: ks.filter(k => (b[k].interval || 0) >= 21).length,
      skipped: ks.filter(k => b[k].skipped).length,
      records: ks.length,
      total: bookTotal || ks.length,
    };
  },

  /** 只属于"学习进度"的字段：导出备份后，另一台设备可只更新这些，保留本机设置 */
  PROGRESS_FIELDS: ['srs', 'notebook', 'stats', 'listenLog', 'readLog', 'writeLog',
    'vocabTest', 'translationCustomTasks', 'translation', 'activeBook', 'garden', 'skipBatches',
    'mineIds', 'importedPapers', 'readNotes'],

  /** 从备份 JSON 只导入学习进度；不动 settings / AI Key。导入的题库正文合并进 contentBackup。 */
  importProgress(j) {
    if (!j || typeof j !== 'object') throw new Error('备份格式不正确');
    let n = 0;
    for (const k of this.PROGRESS_FIELDS) {
      if (j[k] !== undefined) { this.d[k] = j[k]; n++; }
    }
    /* v2：用备份里的个人题库覆盖本机个人题库；内置题库不动。
     * 同时写 contentBackup，保证 Capacitor/静态版重启后还能合并回来。*/
    if (j.personalContent && typeof j.personalContent === 'object') {
      const map = { listening: 'passages', reading: 'passages', writing: 'tasks' };
      this.d.contentBackup = this.d.contentBackup || {};
      for (const target of Object.keys(map)) {
        const listKey = map[target];
        const incoming = Array.isArray(j.personalContent[target]) ? j.personalContent[target] : [];
        if (typeof Dict !== 'undefined' && Dict.content && Dict.content[target]) {
          const pool = Dict.content[target][listKey] || (Dict.content[target][listKey] = []);
          const kept = pool.filter(x => !(x && x.mine === true));
          incoming.forEach(x => { if (x) kept.push(Object.assign({}, x, { mine: true })); });
          Dict.content[target][listKey] = kept;
        }
        this.d.contentBackup[target] = incoming.map(x => Object.assign({}, x, { mine: true }));
      }
    }
    if (j.contentBackup && typeof j.contentBackup === 'object') {
      this.d.contentBackup = this.d.contentBackup || {};
      for (const t of Object.keys(j.contentBackup)) {
        const incoming = j.contentBackup[t];
        const arr = Array.isArray(incoming) ? incoming
          : (incoming && Array.isArray(incoming[t === 'writing' ? 'tasks' : 'passages'])
            ? incoming[t === 'writing' ? 'tasks' : 'passages'] : []);
        const prev = Array.isArray(this.d.contentBackup[t]) ? this.d.contentBackup[t] : [];
        const seen = new Set(prev.map(x => x && x.id).filter(Boolean));
        const merged = prev.slice();
        arr.forEach(x => { if (x && x.id && !seen.has(x.id)) { seen.add(x.id); merged.push(x); } });
        if (merged.length) this.d.contentBackup[t] = merged;
      }
    }
    this.flush();
    return n;
  },

  /** 只导出学习进度 + 个人题库（不含 settings / AI Key），用于平板↔电脑互传 */
  progressBackup() {
    const out = { _type: 'keeplrn-progress', version: 2, exportedAt: new Date().toISOString() };
    for (const k of this.PROGRESS_FIELDS) if (this.d[k] !== undefined) out[k] = this.d[k];
    const personal = { listening: [], reading: [], writing: [] };
    try {
      const c = (typeof Dict !== 'undefined' && Dict.content) ? Dict.content : null;
      if (c) {
        personal.listening = (c.listening.passages || []).filter(x => x && x.mine === true);
        personal.reading = (c.reading.passages || []).filter(x => x && x.mine === true);
        personal.writing = (c.writing.tasks || []).filter(x => x && x.mine === true);
      }
    } catch (e) { /* 题库未加载时只导出进度 */ }
    out.personalContent = personal;
    return JSON.stringify(out, null, 2);
  },

  /** 导出备份（自动剔除运行时缓存，保证文件轻量） */
  backup() {
    /* 导出前先裁掉词库引擎里历史遗留的空状态，避免备份被撑到几 MB（P0 附带修复） */
    try {
      if (typeof VocabEngine !== 'undefined' && VocabEngine.pruneEmptyStates) {
        VocabEngine.pruneEmptyStates({ store: this });
      }
    } catch (e) { /* 裁剪失败不影响导出 */ }
    const dump = Object.assign({}, this.d);
    delete dump._bookCache;
    return JSON.stringify(dump, null, 2);
  },

  /**
   * 记录一次学习活动（时长 + 正确率），供树园计算「当日成长质量」。
   * 四模块统一走这个入口，保证数据口径一致。
   * @param {object} o { kind:'words'|'listen'|'read'|'write', seconds, correct, total }
   */
  logActivity(o) {
    const day = this.markStudy();
    const k = o.kind;
    if (!day[k]) day[k] = 0;
    day[k]++;
    if (o.seconds > 0) {
      day.seconds = (day.seconds || 0) + Math.min(7200, Math.round(o.seconds));
    }
    // 正确率：累计对/总，避免单次波动
    if (typeof o.total === 'number' && o.total > 0) {
      day.acc = day.acc || { c: 0, t: 0 };
      day.acc.c += (o.correct || 0);
      day.acc.t += o.total;
      // 分模块也记一份，便于树园展示"哪一项练得好"
      day.accBy = day.accBy || {};
      const m = day.accBy[k] || (day.accBy[k] = { c: 0, t: 0 });
      m.c += (o.correct || 0); m.t += o.total;
    }
    // 活动明细，供树园"今天做了什么"展示
    day.log = day.log || [];
    day.log.push({ k, at: Date.now(), sec: Math.round(o.seconds || 0) });
    if (day.log.length > 60) day.log = day.log.slice(-60);
    if (typeof Garden !== 'undefined' && o.seconds > 0) {
      Garden.recordActivity(Math.min(7200, Math.round(o.seconds)));
    }
    this.flush();
  },

  /* ---------- 词汇量测试后的批量标熟（跳过简单词） ---------- */
  /**
   * 按测试正确率决定「跳过」多少低频基础词。
   * 词库在运行时已按词频降序排列 → 数组尾部 = 低频 = 基础/common 词。
   * 得分越高说明基础越扎实，可跳过的低频词越多。
   * @param {string} bookId 词书
   * @param {number} rate正确率 0~1
   * @returns {{skipped:string[], total:number, threshold:number}} 被标熟的词列表
   */
  applyTestSkip(bookId, rate) {
    const bk = this.d._bookCache && this.d._bookCache[bookId];
    if (!bk) return { skipped: [], total: 0, threshold: 0 };
    const words = bk.words;
    const N = words.length;

    // 得分率 → 可跳过比例。设计依据：
    //   ≥90%: 基础极扎实，跳过尾部 55%
    //   75-90%: 跳过 45%
    //   60-75%: 跳过 35%
    //   45-60%: 跳过 22%
    //   30-45%: 跳过 12%
    //   <30%: 不跳过，从头学
    const ratio = Math.max(0, Math.min(1, rate));
    let skipRatio;
    if (ratio >= 0.9) skipRatio = 0.55;
    else if (ratio >= 0.75) skipRatio = 0.45;
    else if (ratio >= 0.6) skipRatio = 0.35;
    else if (ratio >= 0.45) skipRatio = 0.22;
    else if (ratio >= 0.3) skipRatio = 0.12;
    else skipRatio = 0;

    if (skipRatio === 0) return { skipped: [], total: N, threshold: 0 };

    // 词库已按 freq 降序 → 取尾部 skipCount 个作为"基础词"
    const skipCount = Math.floor(N * skipRatio);
    if (skipCount < 1) return { skipped: [], total: N, threshold: 0 };
    const tail = words.slice(N - skipCount);
    const threshold = tail.length ? (tail[0].freq || 0) : 0;

    const srs = this.d.srs[bookId] || (this.d.srs[bookId] = {});
    const now = Date.now();
    const skipped = [];
    for (const w of tail) {
      const prev = srs[w.w];
      // 已学过的不覆盖，保留真实学习记录
      if (prev && prev.reps > 0) continue;
      srs[w.w] = {
        word: w.w,
        reps: 1, lapses: 0, ef: 2.5,
        stage: 3,                    // 直接进"中期"阶段，不算新词
        gap: 30,                     // 30 天后再复习
        skipped: true,               // 标记来源，便于撤销与统计区分
        skipFreq: w.freq,
        last: now,
        next: now + 30 * 864e5,
        history: [{ t: now, g: 3, by: 'test' }],
      };
      skipped.push(w.w);
    }
    // 记录本次批量操作，便于整体撤销
    this.d.skipBatches = this.d.skipBatches || [];
    this.d.skipBatches.push({
      at: new Date().toISOString(),
      book: bookId, rate: Math.round(ratio * 100),
      count: skipped.length, threshold,
      words: skipped,
    });
    if (this.d.skipBatches.length > 20) this.d.skipBatches.shift();
    this.flush();
    return { skipped, total: N, threshold, skipRatio };
  },

  /** 撤销最近一次批量标熟（只回滚由测试自动标熟的词） */
  undoTestSkip(bookId) {
    const b = this.d.skipBatches;
    if (!b || !b.length) return 0;
    let i = b.length - 1;
    while (i >= 0 && b[i].book !== bookId) i--;
    if (i < 0) return 0;
    const batch = b.splice(i, 1)[0];
    const srs = this.d.srs[bookId] || {};
    let n = 0;
    for (const w of batch.words) {
      const r = srs[w];
      if (r && r.skipped) { delete srs[w]; n++; }
    }
    this.flush();
    return n;
  },

  /** 该词书是否已有测试标熟记录 */
  skipInfo(bookId) {
    const b = this.d.skipBatches || [];
    const mine = b.filter(x => x.book === bookId);
    const srs = this.d.srs[bookId] || {};
    const live = Object.keys(srs).filter(k => srs[k].skipped).length;
    return { batches: mine.length, liveSkipped: live, last: mine[mine.length - 1] || null };
  },
};
window.Store = Store;
