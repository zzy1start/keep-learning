/* ============ speech.js : 语音合成（听力发音 / 单词发音）============
 * 使用浏览器内置 Web Speech API，离线可用，无需网络。
 */
const Speech = {
  voices: [],
  ready: false,
  /** 女声音色候选（按优先级） */
  /* 【为什么分优先/次选】
   * Windows 上常同时装有「Microsoft Zira」（传统合成，机械感重）与
   * 「Microsoft Aria / Jenny / AriaNeural」（神经网络合成，自然度明显更好）。
   * 只按名字顺序取很可能挑到传统音色——这正是"人机感"的来源。
   * 所以把神经网络音色排在前面。*/
  FEMALE: [
    'Aria Neural', 'Jenny Neural', 'AriaNG', 'Google UK English Female',
    /* Edge 云端神经音色（Online (Natural)）的女声名——不列出来就判不出性别，
     * 男女对话会退化成同一个音色（这就是"听力男女对读消失"的原因）。*/
    'Aria Online', 'Jenny Online', 'Emma Online', 'Libby Online', 'Sonia Online',
    'Michelle Online', 'Ava Online', 'Clara Online', 'Eliza Online', 'Natasha Online',
    'Maisie Online', 'Neerja Online', 'Amber Online', 'Ana Online', 'Ashley Online',
    'Coral Online', 'Elizabeth Online', 'Monica Online', 'Sara Online', 'Nancy Online',
    'Serena', 'Sonia', 'Libby', 'Samantha Premium',
    'Samantha', 'Microsoft Aria', 'Microsoft Zira', 'Google US English', 'Karen', 'Victoria',
    'Hazel', 'Susan',   // 本机 en-GB 女声：不列出来会被判成"无性别"
  ],
    /** 男声音色候选
   *  四六级听力考试音源以**英式男声**为主（考官录音，英音、不快不慢）。
   *  所以把英式男声排在最前，让默认音色贴近考试听感。
   *  其次是神经网络男声（自然度最好），最后才是传统合成兜底。*/
  MALE: [
    // 英式男声（最贴近四六级考试音源）
    'Google UK English Male', 'Ryan (Premium)', 'Thomas',
    /* Edge 云端神经音色的男声名（同上：不列出来就判不出性别） */
    'Guy Online', 'Ryan Online', 'Thomas Online', 'Christopher Online', 'Eric Online',
    'Andrew Online', 'Brian Online', 'Liam Online', 'William Online', 'Connor Online',
    'Roger Online', 'Steffan Online', 'Aaron Online', 'Alex Online', 'Davis Online',
    'Jason Online', 'Tony Online', 'Prabhat Online', 'Sam Online',
    // 神经网络男声（自然度高）
    'Guy Neural', 'Christopher Neural', 'EricNeural', 'RyanNeural',
    // 美式与传统音色（兜底）
    'David', 'Daniel', 'Microsoft David', 'Microsoft Mark', 'Alex', 'Fred', 'Tom', 'Rishi', 'George',
  ],
  _gender: 'female',          // 当前音色性别：female | male
  _forceGender: '',           // 听力页「女声/男声」按钮的强制覆盖（'' = 按材料的说话人标注）
  isEdge: false,              // 是否 Edge（Edge 里云端神经音色可用，见 init()）
  allowOnline: false,         // 是否放行云端（Online/Natural）音色
  cloudOff: false,            // 自愈开关：云端音色连续起音失败后置真，退回本地音色
  _queueing: false,           // 静音互斥：连续speak 会互相打断，这里加锁串行化
  _stoppedAt: 0,              // 上次 cancel 的时刻（用于计算"引擎安静下来"的等待）
  lastMs: 0,                  // 上一次朗读的总耗时（含引擎起音）
  lastStartMs: 0,             // 其中：调用 speak 到引擎真正开口（起音延迟）
  lastSpeakMs: 0,             // 其中：开口到读完（朗读时长）
  WORD_RATE: 1.0,             // 单词发音默认语速：一个常用词约 0.5–0.8s
  SETTLE_MS: 200,             // cancel 之后要等引擎安静的时间（小于它 speak 会吞首音节）
  MIN_PREROLL_MS: 30,         // 没有 cancel 时的最小起音间隔（越小越跟手）
  START_TIMEOUT_MS: 2500,     // 引擎多久没"开口"就判定回调丢失（Chrome 偶发不触发 onstart/onend）
  CLOUD_START_TIMEOUT_MS: 9000, // 云端音色（Online/Natural）要联网合成，起音预算放宽到 9 秒
  diag: [],                   // 最近 12 次朗读的耗时拆解，设置页可查看（用于定位"越读越慢"）
  /* 首次播放的两个"冷启动"参数（用户实测：刷新后第一次播放是人机声、且首个词吞音）：
   *   VOICE_WAIT_MS   等待"云端音色发布完"的上限 —— Edge 的音色列表是异步补齐的；
   *   FIRST_PREROLL_MS/FIRST_WARMUP 第一次朗读多等一点并先做一次静音预热。*/
  VOICE_WAIT_MS: 1200,
  FIRST_PREROLL_MS: 200,
  WARMUP_MS: 300,

  /**
   * 初始化语音列表
   *
   * 【为什么要轮询兜底】
   * `getVoices()` 在Chrome 上是**异步**的：页面刚加载时返回空数组，
   * 真正可用的音色要等几十到几百毫秒后才填充。
   * 只依赖 `onvoiceschanged` 在部分平台（尤其 Windows + 部分语音包）不触发，
   * 导致 `Speech.voices` 一直是空 → `pickVoice()` 返回 null → 整段朗读走进"静音模式"。
   * 所以加一个短周期轮询，拿到音色后自动停止。
   */
  init() {
    /* 只保留**本地**可用的英文语音。
     *
     * 【为什么必须过滤 Online / Natural】
     * Windows 11 安装「增强的语音识别」后，getVoices() 会多出几十个
     * "Microsoft Aria Online (Natural) - English (United States)" 之类的条目。
     * 这些是**云端神经网络语音**，Chrome 的 speechSynthesis 根本驱动不了：
     *   - getVoices() 列得出名字
     *   - 但 speak() 下去既不触发 onstart 也不报错，直到看门狗超时
     * 表现为"检测到 46 个英语语音包，但语音引擎未响应"。
     *
     * 判据：voiceURI 含 online / natural，或 localService === false。
     * localService 是标准字段，最可靠；名字判断作为兜底。*/
    /* 【云端音色：Edge 里默认放行，其它浏览器默认排除】
     * 「Microsoft * Online (Natural)」在 **Edge** 里就是它「大声朗读」用的那套 Azure 神经音色：
     * 零下载、自然度远好于系统 SAPI（本机系统英语音色只有 George/Hazel/Susan 这类老式合成）。
     * 但在 Chrome/Safari 下它们"有事件无声音"（列得出名字、speak() 不触发 onstart），
     * 所以只在 Edge 里默认放行，其它浏览器仍需用户显式打开开关。
     * cloudOff 是**自愈开关**：云端音色连续起音失败后自动退回本地音色，
     * 免得每个句子都白等一次 9 秒预算。*/
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    this.isEdge = /Edg\//.test(String(ua));
    this.allowOnline = this.isEdge || !!(typeof Store !== 'undefined' && Store.d && Store.d.settings
      && Store.d.settings.allowOnlineVoices);
    if (this.cloudOff && !this.allowOnline) { this.cloudOff = false; this._cloudOffAt = 0; this._cloudFails = 0; }
    const isUsable = v => this._voiceUsable(v);
    const load = () => this._refreshVoices();
    /* 【为什么不能"第一次拿到音色就收工"】
     * Edge 的云端神经音色是**异步发布**的：最先返回的往往只有 3 个本地 SAPI 音色
     *（Hazel / Susan / George），几十~几百毫秒后才补齐那 46 个云端音色。
     * 原来写成 `if (load()) return;` —— 一拿到非空列表就停止刷新，于是"刷新后第一次播放"
     * 只能在本地音色里挑：用户听到人机声，等一会儿（或来回切一下男女声）才恢复正常。
     * 现在改成等到列表里**出现期望的云端音色**（或等满 3 秒）才停。*/
    if (load() && this._voicesReady()) return;
    speechSynthesis.onvoiceschanged = load;
    // 轮询兜底：最多等 3 秒
    let n = 0;
    const timer = setInterval(() => {
      load();
      if (this._voicesReady() || ++n > 30) clearInterval(timer);
    }, 100);
    /* 离线语音库（Piper，仅安装版）：启动即握手，首次播放不必再等插件初始化。
     * 非安装版没有插件，available() 恒 false，这里等于空操作。*/
    if (this.local) this.local.init();
  },

  /** 音色是否属于女性音色 */
  /** 音色自然度打分（用于默认音色排序；分数越高越自然） */
  voiceScore(v) {
    const name = String((v && v.name) || '');
    const uri = String((v && v.voiceURI) || '');
    const all = name + ' ' + uri;
    let sc = 0;
    if (/enhanced|premium|高清|plus/i.test(all)) sc += 60;      // 系统高清音色
    if (/google/i.test(all)) sc += 50;                          // Chrome 内置
    if (/\b(ava|samantha|allison|serena|daniel|karen|moira|tessa|fiona)\b/i.test(name)) sc += 45;
    if (/\b(zira|mark|aria|jenny|guy|michelle)\b/i.test(name)) sc += 30;
    if (/\bdavid\b/i.test(name)) sc -= 20;                     // 最机械，兜底用
    if (/female|woman/i.test(all)) sc += 2;
    return sc;
  },

  /* Edge 云端神经音色的男/女名。
   * 【为什么不能只用短语匹配】它们的完整名形如
   * "Microsoft William Multilingual Online (Natural) - English (Australia)"，
   * 中间可能夹 Multilingual —— 用 'William Online' 这类短语匹配会**整条漏掉**。
   * 漏判的后果不是"少一个音色"，而是男声落到一个名字陌生的女声上：
   * 用户听到的现象就是"听力只有女生，没有男生"。这里按名字里的**名词（词边界）**判定，
   * 覆盖 Edge 全套 en-* 神经音色。*/
  CLOUD_F: ['aria', 'jenny', 'ava', 'emma', 'michelle', 'ana', 'clara', 'eliza', 'amber',
    'ashley', 'coral', 'elizabeth', 'monica', 'sara', 'nancy', 'libby', 'maisie', 'sonia',
    'natasha', 'neerja', 'emily', 'yan', 'molly', 'rosa', 'luna', 'imani', 'ezinne', 'asilia',
    'seraphina', 'niamh', 'orla', 'xiaoxiao', 'xiaoyi', 'hiugaai'],
  CLOUD_M: ['guy', 'davis', 'jason', 'tony', 'andrew', 'brian', 'christopher', 'eric', 'roger',
    'steffan', 'william', 'liam', 'ryan', 'thomas', 'sam', 'connor', 'prabhat', 'abeo',
    'chilemba', 'mitchell', 'james', 'wayne', 'elimu', 'duncan', 'neil'],

  /** 名字里是否出现某个名词（词边界，大小写无关） */
  _nameHas(n, word) {
    return new RegExp('\\b' + word + '\\b', 'i').test(n);
  },

  _isFemale(v) {
    if (!v) return false;
    /* 原来读的是 v.URI（不存在的属性），voiceURI 里的信息一直没被用上 */
    const n = (v.name || '') + ' ' + (v.voiceURI || v.URI || '');
    if (this.FEMALE.some(x => n.includes(x))) return true;
    if (this.MALE.some(x => n.includes(x))) return false;
    if (this.CLOUD_F.some(w => this._nameHas(n, w))) return true;   // Edge 云端女声名
    if (this.CLOUD_M.some(w => this._nameHas(n, w))) return false;  // Edge 云端男声名
    // 常见命名约定
    return /female|woman|samantha|aria|zira|karen|victoria|tessa|fiona|zoe|moira/i.test(n);
  },
  _isMale(v) {
    if (!v) return false;
    const n = (v.name || '') + ' ' + (v.voiceURI || v.URI || '');
    if (this.MALE.some(x => n.includes(x))) return true;
    if (this.FEMALE.some(x => n.includes(x))) return false;
    if (this.CLOUD_M.some(w => this._nameHas(n, w))) return true;   // Edge 云端男声名（含 Multilingual 形态）
    if (this.CLOUD_F.some(w => this._nameHas(n, w))) return false;
    return /\bmale\b|\bman\b|david|mark|daniel|alex|fred|tom|george|ryan/i.test(n);
  },

  /** 当前可用的女声 / 男声列表 */
  voicesByGender(g) {
    if (!this.voices.length) return [];
    return this.voices.filter(v => (g === 'male' ? this._isMale(v) : this._isFemale(v)));
  },

  /** 切换默认音色性别 */
  setGender(g) {
    this._gender = g === 'male' ? 'male' : 'female';
    return this._gender;
  },
  get gender() { return this._gender; },

  /**
   * 检查系统是否装了指定性别的英语音色。
   * 用于提示"系统需要安装男声/女声角色"——
   * 部分Windows 精简版只装了女声，遇到需要男声时会静默降级成女声，
   * 用户会以为"男声坏了"。
   */
  hasGenderVoices(g) {
    return this.voicesByGender(g === 'male' ? 'male' : 'female').length > 0;
  },

  /* ---------- 提示音（原文与题干之间的分界） ---------- */
  /** 在用户点击时预热音频上下文：浏览器要求有手势才允许播放提示音 */
  primeAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this._ac = this._ac || new AC();
      if (this._ac.state === 'suspended') this._ac.resume().catch(() => {});
    } catch (e) { /* 忽略：没有音频上下文也不影响朗读 */ }
  },

  /**
   * 叮—咚 提示音（Web Audio 实时合成，不依赖任何音频文件，离线可用）。
   * 用途：原文播完与题干开始之间的听觉分界（考场节奏需要一个明确信号）。
   * @returns {Promise<boolean>} 播放结束或无法播放时 resolve
   */
  chime() {
    return new Promise(resolve => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { resolve(false); return; }
        this._ac = this._ac || new AC();
        const ac = this._ac;
        if (ac.state === 'suspended') ac.resume().catch(() => {});
        const t0 = ac.currentTime + 0.02;
        [[880, 0], [587.33, 0.24]].forEach(note => {
          const freq = note[0], at = note[1];
          const osc = ac.createOscillator();
          const gain = ac.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0 + at);
          gain.gain.exponentialRampToValueAtTime(0.3, t0 + at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
          osc.connect(gain);
          gain.connect(ac.destination);
          osc.start(t0 + at);
          osc.stop(t0 + at + 0.62);
        });
        setTimeout(() => resolve(true), 1100);
      } catch (e) { resolve(false); }
    });
  },

  /** 当前平台：android | ios | windows | mac | other */
  platform() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    // iPadOS 13+ 的 UA 伪装成 Macintosh，用触点数区分
    if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
    return 'other';
  },

  /**
   * 缺音色时的安装指引：按平台给步骤。
   * 【为什么必须分平台】Web Speech 的音色来自操作系统/浏览器，
   * 手机和平板**不会**在网页里下载语音包；以前这里只写了 Windows 路径，
   * 手机用户照着找不到入口，还以为"引擎下载不了"。
   */
  voiceInstallGuide(g) {
    const need = g === 'male' ? '男声' : '女声';
    const p = this.platform();
    const guides = {
      android: {
        title: 'Android 安装方法',
        steps: [
          '打开「设置 → 系统 → 语言和输入法 → 文字转语音输出」',
          '「首选引擎」选 Speech Services by Google；没有就去应用商店安装（国行机可用华为 / 小米 / 讯飞的语音引擎）',
          '进入该引擎的「安装语音数据」，下载 English (US) 或 English (UK)',
          '回到浏览器刷新本页；Chrome / Edge 手机版没有单独的语音下载入口'
        ],
        note: '网页不能代替系统下载语音包；手机上的 Edge 也没有桌面 Edge 的云端神经音色。'
      },
      ios: {
        title: 'iPhone / iPad 安装方法',
        steps: [
          '打开「设置 → 辅助功能 → 朗读内容 → 声音」',
          '选择「英语（美国）」或「英语（英国）」，下载一个声音（可再下载增强 / 高级音质）',
          '回到 Safari 刷新本页；iOS 要求第一次发声前先点一下页面'
        ],
        note: '网页不能触发语音下载；Safari 用的就是系统里的这些音色。'
      },
      windows: {
        title: 'Windows 安装方法',
        steps: [
          '打开「设置 → 时间和语言 → 语言和区域」',
          '在「语音」区域点击「添加语音」，选择英语（英国）或英语（美国）',
          '勾选需要的' + need + '音色并下载',
          '回到本页面刷新即可生效'
        ],
        note: '精简版系统可能缺语音包；装英式语音包更接近四六级考场录音。'
      },
      mac: {
        title: 'macOS 安装方法',
        steps: [
          '打开「系统设置 → 辅助功能 → 朗读内容」',
          '点「系统声音 → 管理声音」，勾选英语音色并下载',
          '回到浏览器刷新本页'
        ],
        note: 'Safari / Chrome 都使用系统里的这些音色。'
      },
      other: {
        title: '安装系统语音',
        steps: [
          'Linux 可安装 speech-dispatcher + espeak-ng（英语音色）',
          '确认浏览器能读到英语音色后刷新本页'
        ],
        note: '语音由操作系统提供，网页本身不下载音色。'
      }
    };
    return Object.assign({ need }, guides[p]);
  },

  /** 一行式提示：设置页在"0 个音色"时直接展示 */
  voiceMissingHint(g) {
    const gd = this.voiceInstallGuide(g);
    return '未检测到英语音色。' + gd.title + '：' + gd.steps.join('；') + '。' + gd.note;
  },

  /** 弹出按平台生成的安装步骤（设置页按钮调用；inline onclick 也能用） */
  openInstallGuide(g) {
    if (typeof App === 'undefined' || !App.modal) return;
    const gd = this.voiceInstallGuide(g);
    App.modal('安装英语音色', `
      <p style="line-height:1.8;margin-bottom:12px">
        语音由操作系统提供，<b>网页不能下载语音包</b>。按下面的步骤装好后回到本页刷新即可。
      </p>
      <div class="rule-box">
        <b>${esc(gd.title)}</b><br>
        ${gd.steps.map((s, i) => (i + 1) + '. ' + esc(s)).join('<br>')}
      </div>
      <div class="hint" style="margin-top:10px">${esc(gd.note)}</div>
      <button class="btn btn-pri btn-blk" data-x style="margin-top:14px">知道了</button>`,
      b => { b.querySelector('[data-x]').onclick = App.closeModal; });
  },

  /** 缺音色时的安装指引（短句版，保留给旧调用方） */
  voiceHint(g) {
    if (this.hasGenderVoices(g)) return '';
    const gd = this.voiceInstallGuide(g);
    return '系统未安装' + gd.need + '英语音色，已暂用最接近的音色。' + gd.title + '：' + gd.steps.join('；') + '。';
  },

  /**
   * 选最合适的英语音色
   * @param {string} preferName 指定音色名（优先）
   * @param {string} gender 'male'|'female'，不传则用当前设置
   */
  /** 音色是否属于云端（Online/Natural） */
  _isCloud(v) {
    return !!v && (/online|natural/i.test(String(v.voiceURI || v.name || '')) || v.localService === false);
  },

  /** 云端音色自愈后的冷却时间：过了这段时间自动再试一次，不再"失败一次 = 整会话人机声" */
  CLOUD_RETRY_MS: 60000,

  /** 自愈是否仍在冷却期内（true = 这一句先用本地音色）。
   *  【为什么不能像原来那样永久关闭】cloudOff 原来一旦置真就**整会话不再恢复**：
   *  网络抖一下 → 之后每一句都是本地机器声，用户既看不到原因也没有入口改回来。
   *  现在改成**带冷却的软关闭**：冷却期内退回本地，冷却结束后自动再试云端。*/
  _cloudDisabled() {
    if (!this.cloudOff) return false;
    if (!this._cloudOffAt) this._cloudOffAt = Date.now();
    return (Date.now() - this._cloudOffAt) < this.CLOUD_RETRY_MS;
  },

  /** 立刻重新启用云端音色：设置页按钮、或冷却期结束后自动再试时调用。
   *  @returns {boolean} 之前是否处于"已自愈关闭"状态 */
  resetCloud(silent) {
    const was = !!this.cloudOff;
    this.cloudOff = false;
    this._cloudOffAt = 0;
    this._cloudFails = 0;
    if (was && !silent) App.toast('已重新启用云端神经音色，下一句开始生效', 'ok');
    return was;
  },

  /** 云端音色失败记账：连续 2 次就进入冷却（本地音色不走这里，绝不能误伤）。
   *  kind: 'no-start'（引擎没开口）/ 'no-end'（开口后没有回调）/ 'no-audio'（开口了但没声音）*/
  _noteCloudFail(kind) {
    this._cloudFails = (this._cloudFails || 0) + 1;
    const whyText = kind === 'no-start' ? '起音失败'
      : kind === 'no-end' ? '起音后收不到回调' : '起音后没有声音';
    if (this._cloudFails >= 2) {
      if (!this.cloudOff) {
        this.cloudOff = true;
        this._cloudOffAt = Date.now();
        const head = kind === 'no-start'
          ? '云端神经音色连续起音失败'
          : '云端神经音色连续 ' + this._cloudFails + ' 次未能正常发声（' + whyText + '）';
        App.toast(head + '，已暂时切回本地音色；'
          + Math.round(this.CLOUD_RETRY_MS / 1000) + ' 秒后自动再试，'
          + '也可在 设置 → 🩺 发音环境诊断 里立即重试', 'err');
      }
    } else if (!this.cloudOff && !this._cloudWarned) {
      this._cloudWarned = true;
      App.toast('云端神经音色本次未能正常发声（' + whyText + '），下一次仍会尝试', '');
    }
  },

  /** init() 的过滤口径（云端要放行且自愈未冷却）—— 单独成方法，供重新加载时复用 */
  _voiceUsable(v) {
    if (!v) return false;
    const uri = String(v.voiceURI || v.name || '');
    const cloud = v.localService === false || /online|natural/i.test(uri);
    if (!cloud) return true;
    return this.allowOnline && !this.cloudOff;
  },

  /** 重新读一次 getVoices() 并按 init() 的口径重建可用音色列表。
   *  用于"云端音色稍后才出现"的补齐，以及首次播放前的等待。*/
  _refreshVoices() {
    try {
      const all = window.speechSynthesis.getVoices() || [];
      if (!all.length) return false;
      this.allVoices = all;
      this.voices = all.filter(v => /^en/i.test(v.lang) && this._voiceUsable(v));
      this.ready = this.voices.length > 0;
      return this.ready;
    } catch (e) { return false; }
  },

  /** 音色列表是否已经"够用"：放行云端（Edge）时要等到**出现云端音色**才算齐；
   *  否则（非 Edge / 未放行 / 自愈冷却中）拿到英文音色就算齐。
   *  【用途】首次播放前先等它，避免用"只发布了 3 个本地音色"的半截列表选音色。*/
  _voicesReady() {
    if (!this.voices.length) return false;
    const expectCloud = this.allowOnline && !this._cloudDisabled();
    if (!expectCloud) return true;
    return this.voices.some(v => this._isCloud(v));
  },

  /** 【首次朗读前的静音预热】Windows 上语音引擎的第一次 speak() 常吞掉开头几十毫秒
   *  ——用户看到的就是"背单词第一个词发音不完全"。先读一个空格（无声），把冷启动的
   *  代价落在它身上，再读真正的内容；本会话只做一次。
   *  @returns {Promise<void>} 预热结束或超时后 resolve（绝不因此卡住真正的朗读）*/
  _warmUpOnce(u) {
    const self = this;
    if (self._warmedUp) return Promise.resolve();
    self._warmedUp = true;
    return new Promise(resolve => {
      let settled = false;
      const fin = () => { if (!settled) { settled = true; resolve(); } };
      try {
        const warm = new SpeechSynthesisUtterance(' ');
        if (u && u.voice) warm.voice = u.voice;
        warm.lang = (u && u.lang) || 'en-US';
        /* 不要把 volume 设成 0：部分引擎会直接跳过合成，预热就白做了（文本是空格，本来就不出声）*/
        warm.volume = 1;
        warm.onend = fin;
        warm.onerror = fin;
        speechSynthesis.speak(warm);
        setTimeout(fin, self.WARMUP_MS);
      } catch (e) { fin(); }
    });
  },

  /** 该音色当前是否可用：云端音色要放行且自愈未处于冷却期。
   *  【为什么不用 this.voices 直接判断】this.voices 是 init() 时的快照，
   *  cloudOff 翻转后必须立刻生效，否则"自动切回本地音色"只是嘴上说说。*/
  _usable(v) {
    return !this._isCloud(v) || (this.allowOnline && !this._cloudDisabled());
  },

  /**
   * 从候选池里按性别挑一个云端神经音色。
   * 【为什么单独写】Edge 的云端音色名字形如 "Microsoft Guy Online (Natural) - English (US)"，
   * 旧逻辑只按短语匹配，判不出性别时男/女分支会**双双落到同一个音色**——
   * 听力里的男女对话就变成一个人在读。这里保证两件事：
   *   1. 名字里能看出性别的，优先取该性别；
   *   2. 名字里看不出性别的（或全都看不出），也要保证男女**不是同一个**音色。
   */
  _pickCloudVoice(pool, g) {
    const cloud = pool.filter(v => this._isCloud(v));
    if (!cloud.length) return null;
    const want = v => (g === 'male' ? this._isMale(v) : this._isFemale(v));
    const anti = v => (g === 'male' ? this._isFemale(v) : this._isMale(v));
    /* 【变体优先英式】getVoices() 的返回顺序与音色质量无关：实测本机 Edge 把
     * William/Natasha（en-AU）排在 Sonia/Ryan/Thomas（en-GB）前面，
     * 直接取"第一个符合性别的"就会选中澳音——而四六级听力音源是英式。
     * 所以先按变体排序：en-GB → en-US → 其它英语变体。*/
    const langRank = v => (/^en-GB/i.test(String(v.lang || '')) ? 0
      : (/^en-US/i.test(String(v.lang || '')) ? 1 : 2));
    const byLang = (a, b) => langRank(a) - langRank(b);
    const ranked = cloud.filter(want).sort(byLang)
      .concat(cloud.filter(v => !want(v) && !anti(v)).sort(byLang))
      .concat(cloud.filter(anti).sort(byLang));
    if (ranked.length && want(ranked[0])) return ranked[0];
    /* 一个都判不出性别：男声取第一个、女声取第二个，避免两个人共用一个音色 */
    return ranked[g === 'male' ? 0 : Math.min(1, ranked.length - 1)] || cloud[0];
  },

  /**
   * 选音色。lang 用于"非英文广播"（例如结尾语用中文播报）：
   * 传了 lang 且不是英文时，从 this.allVoices（全部系统音色）里按语言前缀挑本地音色；
   * 不传或英文时保持原逻辑（只用英文音色列表）。
   */
  pickVoice(preferName, gender, lang) {
    const wantZh = lang && !/^en/i.test(lang);
    if (wantZh) {
      const pre = String(lang).split('-')[0].toLowerCase();
      const pool = (this.allVoices || []).filter(v => String(v.lang || '').toLowerCase().indexOf(pre) === 0);
      const local = pool.filter(v => v.localService !== false);
      const chosen = local[0] || pool[0];
      if (chosen) return chosen;
      return null;   // 没有对应语言的音色：交给调用方决定回落文案
    }
    const g = gender || this._gender;
    if (preferName) {
      const v = this.voices.find(x => x.name === preferName);
      if (v) return v;
    }
    // 先按性别筛选候选池（一律经过 _usable 实时判定，cloudOff 立刻生效）
    let pool = this.voicesByGender(g).filter(v => this._usable(v));
    if (!pool.length) pool = this.voices.filter(v => this._usable(v));   // 该性别不可用→退回全部可用
    /* 【云端自然音色优先】它们的名字里也含 "Microsoft Aria" 这类偏好词，混在一起排序会打架，
     * 所以单独先挑：能留下就说明放行条件已满足（Edge 或用户显式打开开关），
     * 此时它们就是本机最好的一档，应当优先使用（系统英语音色往往只有老式合成）。
     * 挑的时候按性别成对挑，男女说话人不会共用一个音色（见 _pickCloudVoice）。*/
    const cloudPick = this._pickCloudVoice(pool, g);
    if (cloudPick) return cloudPick;
    const pref = g === 'male' ? this.MALE : this.FEMALE;
    for (const n of pref) {
      const v = pool.find(x => x.name.includes(n));
      if (v) return v;
    }
    return pool.find(v => /en-US/i.test(v.lang)) || pool[0] || null;
  },

  /**
   * 预测这次朗读会用哪个音色（口径与 _pump 里取音色完全一致），
   * 供界面直接写"这一句会用什么声音"——"还是人机声"这件事必须当场看得见，
   * 而不是让用户去设置页里翻诊断自己猜。
   * @param {object} o { word, gender, voice, lang }
   * @returns {{name:string, cloud:boolean, source:string}|null}
   */
  previewVoice(o = {}) {
    const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
    const isWord = !!o.word;
    const profVoice = isWord ? (st.wordVoice || st.speechVoice || '') : (st.speechVoice || '');
    const spokeGender = this._forceGender || o.gender || this._gender;
    const genderVoice = isWord ? ''
      : (spokeGender === 'male' ? (st.speechVoiceMale || '') : (st.speechVoiceFemale || ''));
    const unified = (isWord || (!this._forceGender && !o.gender)) ? profVoice : '';
    const prefer = o.voice || genderVoice || unified;
    const v = this.pickVoice(prefer, spokeGender, o.lang);
    if (!v) return null;
    const source = o.voice ? '调用方指定'
      : (!prefer ? '自动（优先云端神经音色）'
        : (prefer === genderVoice ? (spokeGender === 'male' ? '听力男声设置' : '听力女声设置')
          : (isWord ? '背单词音色设置' : '统一音色设置')));
    return { name: v.name, cloud: this._isCloud(v), source };
  },

  list() { return this.voices; },

  /** 系统里是否有某语言的本地音色（如 'zh'）。用于结尾语：没有中文音色就改说英文。 */
  hasLang(prefix) {
    const pre = String(prefix || '').toLowerCase();
    return (this.allVoices || []).some(v => String(v.lang || '').toLowerCase().indexOf(pre) === 0
      && v.localService !== false);
  },

  /**
   * 朗读文本
   * @param {string} text
   * @param {object} o {rate, pitch, onend, onboundary}
   */
  /**
   * 朗读文本（串行化）
   *
   * 【无声的根因与修法】
   * 原实现每次都 speechSynthesis.cancel() + setTimeout(30ms) 再 speak()。
   * 逐词朗读时会在极短时间内连续调用多次，Chrome 会把**每一次**都当成
   * "新请求"从而把上一条 cancel 掉 → 结果全程静音。
   * 修法：所有朗读请求进同一个队列，串行执行；只有 stop() 才真正 cancel。
   *
   * @param {string} text
   * @param {object} o {rate, pitch, onend, onstart, onboundary, gender, voice}
   */
  speak(text, o = {}) {
    /* 【听力统一音色】听力场景（o.listening）只要有离线语音库就由它接管：
     * 否则内置听力有的句子在音频包里（Sonia/Ryan）、有的不在（Piper jenny/alan），
     * 同一篇甚至相邻句音色会跳。失败时回落原链路（pack → 词典 → 系统/在线）。*/
    const localReady = this.local && typeof this.local.available === 'function' && this.local.available();
    if (o.listening === true && localReady) {
      const seq0 = this._stopSeq || 0;
      return this.local.say(text, o).then(r => {
        if (r !== null) return r;
        if ((this._stopSeq || 0) !== seq0) return null;
        return this.speak(text, Object.assign({}, o, { local: false, listening: false }));
      });
    }
    /* ⓪ 预生成音频包最高优先：即使设置里开了“真人词典发音”，
     * 已被音频包覆盖的词也必须先走离线包，否则单词会被词典层截走。*/
    if (typeof AudioPack !== 'undefined' && AudioPack.canPlay(text, o)) {
      return AudioPack.say(text, o);
    }
    /* ③ 真人词典音频层：只用于**单词**（听力整句没有词典音频）。
     * 优先级：真人词典录音 → Kokoro → 系统语音；任一层失败/超时都自动回落下一层。
     * seq 用来防止"停止之后又被回落逻辑重新起一个引擎"——那样会在用户点了停止后突然出声。*/
    const seq = this._stopSeq || 0;
    if (o.word && this.dict.enabled()) {
      return this.dict.say(text, o).then(hit => {
        if (hit !== null) return hit;                       // 这一层播完了
        if ((this._stopSeq || 0) !== seq) return null;      // 取音频期间用户已停止：不再起别的引擎
        return this._speakByEngine(text, o);                // 这一层没有音频：回落
      }, () => {
        if ((this._stopSeq || 0) !== seq) return null;
        return this._speakByEngine(text, o);
      });
    }
    return this._speakByEngine(text, o);
  },

  /** 真·引擎分发：Kokoro（neural）→ 系统语音。词典层之外的所有调用都走这里。 */
  _speakByEngine(text, o = {}) {
    const seq = this._stopSeq || 0;
    /* 1) 预生成音频包优先：固定题库、双音色、可离线、语速由播放器控制。*/
    if (typeof AudioPack !== 'undefined' && AudioPack.canPlay(text, o)) {
      return AudioPack.say(text, o);
    }
    /* 1.5) 离线语音库（Piper）：系统没有可用英语音色时接管（平板），
     *      合成失败/被停止则回落原系统链路。*/
    if (this.local && this.local.shouldHandle(o)) {
      const self = this;
      return this.local.say(text, o).then(r => {
        if (r !== null) return r;
        if ((self._stopSeq || 0) !== seq) return null;
        return self._speakSystem(text, o);
      });
    }
    if (this._engineName() === 'neural') {
      const self = this;
      const ready = this.neural.state === 'ready' ? Promise.resolve(true) : this.neural.load();
      return Promise.resolve(ready).then(ok => {
        // 模型加载期间用户点了停止：不要加载完再突然出声
        if ((self._stopSeq || 0) !== seq) return null;
        if (!ok) {
          self._neuralWarn(self.neural.error || '模型未就绪');
          return self._speakSystem(text, o);
        }
        return self.neural.say(text, o).catch(e => {
          if (e && e.error === 'canceled') return null;
          self.neural.state = 'failed';
          self.neural.error = String((e && e.message) || e).slice(0, 200);
          self._neuralWarn(e);
          return self._speakSystem(text, o);
        });
      }).catch(e => {
        self._neuralWarn(e);
        return self._speakSystem(text, o);
      });
    }
    return this._speakSystem(text, o);
  },

  /** 当前使用的语音引擎：system | neural */
  _engineName() {
    return (typeof Store !== 'undefined' && Store.d && Store.d.settings
      && Store.d.settings.speechEngine) || 'system';
  },

  /**
   * 发音环境诊断：把「浏览器 / 全部英语音色（含被排除的云端音色）/ 当前会自动选哪个」列出来。
   * 用途：不用打开控制台也能一眼看清"为什么听起来是机器声"——
   * 若清单里没有 Online/Natural 音色，说明本机就没有神经音色可用。
   */
  /** 当前被**显式**选成本地（机器声）音色的项：听力女声/男声/统一音色 + 背单语音色。
   *  【为什么要查这个】听力里带说话人标注的行用 女声/男声，没有说话人标注的行用「统一音色」，
   *  背单词用「背单语音色」。任意一项被钉在旧式 SAPI 音色上（早期调音色时很容易留下），
   *  对应的那些句子就一定是人机声——而**下拉框里完全看不出这个后果**，
   *  用户只会觉得"有时还是人机声"。返回 [[项名, 音色名], ...]。*/
  localVoicePicks() {
    const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
    const items = [
      ['听力女声', st.speechVoiceFemale], ['听力男声', st.speechVoiceMale],
      ['听力统一音色', st.speechVoice], ['背单语音色', st.wordVoice],
    ];
    return items.filter(([, n]) => {
      if (!n) return false;
      const v = (this.allVoices || []).find(x => x.name === n)
        || (this.voices || []).find(x => x.name === n);
      return !!v && !this._isCloud(v);
    });
  },

  /** 上一条的文案版（没有则返回空串），供设置页与诊断共用 */
  voicePickWarning() {
    const picks = this.localVoicePicks();
    if (!picks.length) return '';
    return '⚠ ' + picks.map(x => x[0]).join('、') + ' 当前是本地音色（'
      + picks.map(x => x[1]).join('、') + '）：这些句子必然是机器声——'
      + '显式选择优先于"自动优先云端神经音色"。点「音色改回自动」（= 把这几个下拉改回「自动」）即恢复。';
  },

  /** 把被显式钉住的音色改回「自动」（空 = 自动优先云端神经音色）。
   *  @param {boolean} includeWord 是否连「背单语音色」一起改（背单词被钉在 Hazel 之类的本地音色上同样是人机声）
   *  @returns {string[]} 实际被清掉的项名 */
  resetVoicePicks(includeWord) {
    const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || null;
    if (!st) return [];
    const cleared = [];
    const clear = (key, label) => { if (st[key]) { st[key] = ''; cleared.push(label); } };
    clear('speechVoiceFemale', '听力女声');
    clear('speechVoiceMale', '听力男声');
    clear('speechVoice', '听力统一音色');
    if (includeWord) clear('wordVoice', '背单语音色');
    if (cleared.length && typeof Store.flush === 'function') Store.flush();
    return cleared;
  },

  voiceReport() {
    const all = (this.allVoices || []).filter(v => /^en/i.test(String(v.lang || '')));
    const lines = [];
    lines.push('浏览器：' + (this.isEdge ? 'Edge（自带 Azure 神经音色）' : '非 Edge')
      + '　云端音色放行：' + (this.allowOnline ? '是' : '否'));
    /* 【云端音色当前到底在不在用】"有时还是人机声"最需要先回答这一句：
     * 是自愈把它关了（冷却中/可立刻重试），还是根本没放行。*/
    const leftSec = this.cloudOff
      ? Math.max(0, Math.round((this.CLOUD_RETRY_MS - (Date.now() - (this._cloudOffAt || Date.now()))) / 1000)) : 0;
    lines.push('云端音色状态：' + (!this.allowOnline
      ? (this.isEdge ? '未放行（异常：Edge 下应自动放行）' : '未放行（非 Edge，可在下方开关打开）')
      : (this._cloudDisabled()
        ? '已自愈关闭（' + leftSec + ' 秒后自动再试；也可点「重新启用云端音色」立刻重试）'
        : '使用中' + (this._cloudFails ? '（最近有过 ' + this._cloudFails + ' 次失败）' : ''))));
    /* 【顺序很要紧】原来清单占 20 行，把"自动选中 / 听力将使用 / ⚠ 警告"全挤到屏幕外，
     * 截图发给别人时最关键的结论正好看不见。现在先给结论，再列清单。*/
    const auto = this.pickVoice('', this._gender);
    lines.push('自动选中：' + (auto ? auto.name + '（' + (this._isCloud(auto) ? '云端' : '本地') + '）' : '无可用音色'));

    /* 【听力"有时"是人机声的结构性原因】带说话人标注的行用 女声/男声 设置，
     * 没有说话人标注的行才用「统一音色」。所以只要这三项里有一项被显式选成了
     * **本地**音色（早期测试留下来的选择），对应那些材料就必然是机器声——
     * 显式选择优先于"自动优先云端"的规则，而下拉框里看不出来这个后果。*/
    const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
    const info = name => {
      if (!name) return { text: '自动', local: false };
      const v = (this.allVoices || []).find(x => x.name === name)
        || (this.voices || []).find(x => x.name === name);
      if (!v) return { text: name + '（已不在音色列表）', local: false };
      const cloud = this._isCloud(v);
      return { text: name + '（' + (cloud ? '云端' : '本地·机器声') + '）', local: !cloud };
    };
    const f = info(st.speechVoiceFemale), m = info(st.speechVoiceMale), u = info(st.speechVoice);
    lines.push('听力将使用：女声=' + f.text + '　男声=' + m.text + '　统一（无说话人标注时）=' + u.text);
    lines.push('背单词将使用：' + info(st.wordVoice).text + (st.dictAudio ? '　（真人词典录音已开启，优先于它）' : ''));
    /* 平板没有系统英语音色时由随包 Piper 语音库接管；这里把男女音色与状态写清楚，
     * 免得用户以为是"没声音"。*/
    const lv = this.local;
    lines.push('离线语音库（Piper）：' + (!lv || !lv.available()
      ? '非安装版不可用'
      : (lv.ready ? '可用' : '未就绪（首次播放时初始化）'))
      + (lv && lv.available() ? '　女=' + (st.localVoiceFemale || lv.VOICE_FEMALE) + '　男=' + (st.localVoiceMale || lv.VOICE_MALE)
        + (st.localTtsPreferred ? '　（已设为优先）' : '　（系统无音色时自动接管）') : ''));
    const warn = this.voicePickWarning();
    if (warn) lines.push(warn);
    /* 清单放在最后：它是"本机有没有神经音色"的证据，不需要抢占最显眼的位置 */
    lines.push('英语音色共 ' + all.length + ' 个，其中云端（Natural/Online）'
      + all.filter(v => this._isCloud(v)).length + ' 个，当前可用 ' + all.filter(v => this._usable(v)).length + ' 个'
      + '（清单见下）');
    for (const v of all.slice(0, 20)) {
      lines.push('· ' + v.name + '（' + v.lang + '，' + (this._isCloud(v) ? '云端' : '本地')
        + (this._usable(v) ? '，可用' : '，已排除') + '）');
    }
    if (all.length > 20) lines.push('…（仅列前 20 个）');
    return lines.join('\n');
  },

  /**
   * ② lookahead 预推理：把**下一句**的音频先合成好，等轮到它时直接用。
   * - 只在「当前引擎 = Kokoro 且模型已就绪」时生效；系统语音没有可复用的合成结果，直接返回 null；
   * - **只合成不播放**（绝不创建 Audio 元素），所以停止/切段之后不会突然出声；
   * - 调用方不需要 await，返回值只给测试与诊断用。
   */
  prefetch(text, o = {}) {
    /* 离线语音库：提前把下一句合成好（只合成不播放），句间等待明显变短；
     * 听力场景即使有系统音色也用本地（与 speak 的统一口径一致）。*/
    if (this.local && ((o.listening === true && this.local.available && this.local.available()) || this.local.shouldHandle(o))) {
      return this.local.prefetch(text, o);
    }
    if (this._engineName() !== 'neural') return null;
    if (this.neural.state !== 'ready') return null;
    return this.neural.prefetch(text, o);
  },

  /* ---------- 「可取消播放」的统一实现（① 的教训）----------
   * ①（Kokoro 停止不结算）的根因就是**同一种结算写了两份，生效的那份漏了结算**。
   * 现在任何"会出声的通道"（neural / dict）都必须用这两个方法：
   *   _newJob()  在**取音频之前**建 job，于是 stop() 任何时候都能无条件结算调用方的 Promise；
   *   _playJob() 只负责把已经拿到的 url 播出去，并复用同一个 job。
   * 通道对象只需要提供 playing / _audio / _job / _finish 四个字段。*/

  /** 建一个可取消的播放 job（同时把通道标记为"在播"） */
  _newJob(channel, o = {}) {
    const job = { canceled: false, finished: false, audio: null, resolve: null };
    job.outcome = new Promise(resolve => { job.resolve = resolve; });
    /* mode: 'end' 正常播完（回调 onend）| 'canceled' 被 stop（回调 onerror）
     *     | 'quiet' 这一层没拿到音频（不回调任何东西，交由上层回落） */
    const settle = mode => {
      if (job.finished) return;
      job.finished = true;
      job.canceled = mode === 'canceled';
      if (job.audio) {
        try { job.audio.pause(); job.audio.currentTime = 0; } catch (e) { /* 忽略 */ }
        if (channel._audio === job.audio) channel._audio = null;
        job.audio = null;
      }
      channel.playing = false;
      if (channel._job === job) { channel._job = null; channel._finish = null; }
      if (mode === 'canceled') {
        if (o.onerror) { try { o.onerror({ error: 'canceled' }); } catch (e) { /* 忽略 */ } }
      } else if (mode === 'end') {
        if (o.onend) { try { o.onend({}); } catch (e) { /* 忽略 */ } }
      }
      job.resolve(mode === 'end' ? undefined : null);
    };
    job.cancel = () => settle('canceled');     // 由 stop() 调用
    job.finish = () => settle('end');          // 音频正常结束
    job.quiet = () => settle('quiet');         // 取不到音频
    channel._job = job;
    channel._finish = job.cancel;
    channel.playing = true;
    return job;
  },

  /** 用已有 job 播放一个 url；job 若已在取音频阶段结束，则绝不再出声 */
  _playJob(channel, job, url, o = {}) {
    if (job.finished) return Promise.resolve(null);
    const el = new Audio(url);
    job.audio = el;
    channel._audio = el;
    el.onplaying = () => { if (o.onstart) { try { o.onstart({}); } catch (e) { /* 忽略 */ } } };
    el.onended = () => job.finish();
    el.onerror = () => {
      if (channel === Speech.online) channel.error = '播放失败（audio error）';
      job.finish();
    };
    const pr = el.play();
    if (pr && pr.catch) pr.catch(() => job.finish());
    return job.outcome;
  },

  /** 在线音频路径：仍走队列，避免连续点词时重叠播放。*/
  _speakOnline(text, o = {}) {
    const self = this;
    return new Promise(resolve => {
      self._q = self._q || [];
      if (o.word) {
        const stale = self._q.filter(job => job.o && job.o.word);
        if (stale.length) {
          self._q = self._q.filter(job => !(job.o && job.o.word));
          stale.forEach(job => job.resolve(null));
        }
      }
      self._q.push({ text, o, resolve, queuedAt: Date.now(), engineBusyAtQueue: self._engineBusy(), online: true });
      self._pump();
    });
  },

  /** 原生/系统音色初始化是异步的：Android TTS 刚启动时 getVoices 可能为空。
   * 先最多等 3 秒，避免"一按播放就先弹缺音色"的误判。*/
  _waitEnglishVoices(maxTries = 20) {
    return new Promise(resolve => {
      let n = 0;
      const check = () => {
        if (!this.voices.length) { try { this._refreshVoices(); } catch (e) {} }
        if (this.voices.length) return resolve(true);
        if (n++ >= maxTries) return resolve(false);
        setTimeout(check, 150);
      };
      check();
    });
  },

  /** 缺音色弹窗：按当前平台给步骤，不能一律写 Windows。 */
  _showNoVoiceModal() {
    const g = this._gender === 'male' ? 'male' : 'female';
    const gd = this.voiceInstallGuide(g);
    const native = (typeof window !== 'undefined' && window.__nativeTts)
      ? '原生 TTS 桥已连接。' : '未检测到原生 TTS 桥（PWA/桌面浏览器属正常）。';
    App.modal('系统缺少英语语音包', `
      <p style="line-height:1.85;margin-bottom:14px">
        当前没有读到可用的英语音色，因此听力/单词无法朗读。${esc(native)}
      </p>
      <div class="rule-box">
        <b>${esc(gd.title)}</b><br>
        ${gd.steps.map((s, i) => (i + 1) + '. ' + esc(s)).join('<br>')}
      </div>
      <div class="hint" style="margin-top:10px">${esc(gd.note)}</div>
      <button class="btn btn-pri btn-blk" data-x style="margin-top:14px">知道了</button>`,
      b => { b.querySelector('[data-x]').onclick = App.closeModal; });
  },

  /** 系统语音路径；保留原有起音、排队和防吞音逻辑。 */
  _speakSystem(text, o = {}) {
    if (!('speechSynthesis' in window)) { App.toast('当前浏览器不支持语音合成', 'err'); return null; }
    /* 音色可能尚未加载（Chrome 异步填充）。首次调用时补一次加载，
     * 否则 pickVoice() 返回 null，朗读会退化成"有事件无声音"。*/
    if (!this.voices.length) {
      const all = window.speechSynthesis.getVoices() || [];
      if (all.length) {
        this.allVoices = all;
        /* 【音色质量排序】不要默认拿列表第一个（常常是机械感最重的 Microsoft David）。
         * 打分顺序：本地 Enhanced/Premium > Google 内置 > Zira/Mark/Samantha 等 > David 兜底。
         * Natural/Online（云端）默认排除——Chrome 里"有事件无声音"，只有用户显式打开
         * allowOnlineVoices 才纳入（口径与 init() 的 isUsable 保持一致）。
         * 【这行原来是 voiceScore(b) - self.voiceScore(a)：两个引用都不成立】
         * voiceScore 是 Speech 的方法，裸写成 voiceScore(...) 就是 ReferenceError；
         * 而 self 直到本函数更后面才 `const self = this` 声明，也落在 TDZ 里。
         * 数组只有 1 个元素时 sort 不调用比较器，所以自检（模拟环境只给 1 个音色）
         * 一直没暴露它；真实机器有几十个英语音色，一进这条分支就直接抛错。
         * 变异探针 work/probe-tdz-voicescore.cjs 复现了：ReferenceError: voiceScore is not defined。*/
        const allowOnline = !!this.allowOnline;
        const isCloud = v => /online|natural/i.test(String(v.voiceURI || v.name || ''))
          || v.localService === false;
        this.voices = all.filter(v => /^en/i.test(v.lang) && (allowOnline || !isCloud(v)))
          .sort((a, b) => this.voiceScore(b) - this.voiceScore(a));
        this.ready = this.voices.length > 0;
      }
    }
    /* 系统/原生音色可能尚未初始化：等待一会儿再判定缺音色，
     * 否则 Android TTS 刚启动时第一次点播放会误弹"缺语音包"。*/
    if (!this.voices.length) {
      /* 系统没有可用音色时，优先用在线词典音频（安装版默认开启），
       * 这样即使平板没有 TTS 引擎，单词/听力也能出声。*/
      if (this.online.enabled()) return this._speakOnline(text, o);
      /* Android 原生 TTS 即使 getVoices 暂时为空，也能用系统默认音色发声；
       * 不能因为"没枚举到音色"就直接弹缺语音包，否则默认引擎也被误判成坏掉。*/
      if (!(typeof window !== 'undefined' && window.__nativeTts)) {
        return this._waitEnglishVoices().then(ok => {
          if (ok) return this._speakSystem(text, o);
          if (!this._noEnHinted) { this._noEnHinted = true; this._showNoVoiceModal(); }
          return null;
        });
      }
    }
    const self = this;
    return new Promise(resolve => {
      self._enqueue(text, o).then(resolve);
    });
  },

  /**
   * 单词发音（背单词卡片 / 词条详情统一入口）
   * - 默认语速 1.0：常用词 0.5–0.8s，加上起音时间接近"1 秒左右"的期望
   * - word:true 走防吞音路径（前导空格 + 等引擎安静），并跳过句子语调
   * @param {string} text 单词
   * @param {object} o { rate, gender, voice, onend, onstart }
   */
  speakWord(text, o = {}) {
    const word = String(text == null ? '' : text).trim();
    if (!word) return Promise.resolve(null);
    // 不在这里写死语速：交给 profile(true) 取设置里的背单词语速（默认 1.0）
    return this.speak(word, Object.assign({}, o, { word: true }));
  },

  /**
   * 读音参数按用途分开取——听力与背单词是**两套需求**：
   *   听力：按考试音源调语速与音色，句子还要做语调起伏，点播放先缓冲（缓冲在听力视图里）；
   *   背单词：1.0 语速、点了立刻读、不做句子语调。
   * 两套参数各自独立保存在 Store.settings（speech* / word*），互不影响。
   */
  profile(isWord) {
    const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
    if (isWord) {
      return {
        rate: s.wordRate != null ? Number(s.wordRate) : this.WORD_RATE,
        voice: s.wordVoice || s.speechVoice || '',
        prosody: false,      // 单词不加句子语调
        frontSpace: true,    // 前导空格防吞音
      };
    }
    /* 【不再手动改语调】整句（含句内标点）交给引擎，句末的 ?/! 由引擎自己生成
     * 自然的句尾升调/降调；过去按分句送 + 手动抬 pitch，会在每个逗号处被引擎
     * 强制做陈述句收尾（terminal fall），听起来一顿一顿的"机械感"。
     * 现在听力与背单词都不做 pitch/rate 微调，基准 pitch = 1.0。*/
    return {
      rate: s.speechRate != null ? Number(s.speechRate) : 1,
      voice: s.speechVoice || '',
      prosody: false,
      pitch: 1,
      frontSpace: false,
    };
  },

  /** 引擎是否还在忙（用于诊断与回落判断） */
  _engineBusy() {
    if (this.neural && (this.neural.busy || this.neural.playing)) return true;   // Kokoro 正在播放也算忙
    if (this.dict && (this.dict.busy || this.dict.playing)) return true;         // 真人词典音频同理
    if (this.online && (this.online.busy || this.online.playing)) return true;  // 在线词典音频
    if (this.local && this.local.playing) return true;                          // 离线语音库（合成/播放）
    if (typeof AudioPack !== 'undefined' && AudioPack.playing) return true;      // 预生成音频包
    try {
      return typeof speechSynthesis !== 'undefined'
        && !!(speechSynthesis.speaking || speechSynthesis.pending);
    } catch (e) { return false; }
  },

  /** 内部：入队并串行执行 */
  _enqueue(text, o = {}) {
    const self = this;
    return new Promise(resolve => {
      self._q = self._q || [];
      /* 【背单词用最新优先】连点时旧的朗读请求没有意义。
       * 留在队列里会让后面的词越读越慢——用户看到的现象正是"前几个 1 秒、后面 2–3 秒"。
       * 主动丢掉排在队里的旧词请求，并 resolve 掉它们的 Promise（避免悬挂）。*/
      if (o.word) {
        const stale = self._q.filter(job => job.o && job.o.word);
        if (stale.length) {
          self._q = self._q.filter(job => !(job.o && job.o.word));
          stale.forEach(job => job.resolve(null));
        }
      }
      self._q.push({ text, o, resolve, queuedAt: Date.now(), engineBusyAtQueue: self._engineBusy() });
      self._pump();
    });
  },

  _pump() {
    const self = this;
    if (self._busy) return;
    const job = self._q && self._q[0];
    if (!job) return;
    /* 【首次播放必须等音色列表齐全】Edge 最先只给 3 个本地音色，云端音色稍后才发布；
     * 这时候选音色只能选到本地机器声（用户实测："刷新后第一次播放是人机声"）。
     * 这里最多等 VOICE_WAIT_MS 毫秒，列表一齐就立刻继续。*/
    /* 原生 TTS 即使还没枚举到音色，也可以直接用系统默认音色；不要在这里空等/卡住。*/
    if (!(typeof window !== 'undefined' && window.__nativeTts)
      && !self._voicesReady() && (self._voiceWaitMs || 0) < self.VOICE_WAIT_MS) {
      self._voiceWaitMs = (self._voiceWaitMs || 0) + 100;
      self._refreshVoices();
      setTimeout(() => self._pump(), 100);
      return;
    }
    self._voiceWaitMs = 0;
    self._q.shift();
    self._busy = true;
    /* 在线音频任务：不进 SpeechSynthesisUtterance 流程，直接播一个 URL。*/
    if (job.online) {
      Promise.resolve(self.online.say(job.text, job.o)).then(res => {
        self._busy = false;
        job.resolve(res);
        setTimeout(() => self._pump(), 0);
      }, () => {
        self._busy = false;
        job.resolve(null);
        setTimeout(() => self._pump(), 0);
      });
      return;
    }
    const active = {};
    self._active = active;

    const isWord = !!job.o.word;
    const prof = self.profile(isWord);
    /* 单词发音前面加一个空格：给引擎留出起音时间，长单词的首音节不容易被吞
     *（TTS 把空白当停顿，不改变读音内容）*/
    const utteranceText = prof.frontSpace ? ' ' + job.text : job.text;
    let u = new SpeechSynthesisUtterance(utteranceText);
    /* 【听力：男女说话人各用一个音色】听力材料里 gender 来自说话人标记
     *（没有标记时按对话男女交替），所以这里按性别分别取设置：
     *   speechVoiceFemale / speechVoiceMale（空 = 自动，Edge 下自动优先云端神经音色）
     * 背单词没有性别概念，仍走统一的 speechVoice。*/
    const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
    /* 【强制性别】听力页的「女声/男声」按钮走 _forceGender：
     * 材料带 M/W 标注时每行都会传来自己的 gender，会盖掉按钮选择，
     * 用户点了"男声"却听不到任何变化。按钮现在**强制覆盖**行内标注。*/
    const spokeGender = self._forceGender || job.o.gender || self._gender;
    const genderVoice = isWord ? ''
      : (spokeGender === 'male' ? (st.speechVoiceMale || '') : (st.speechVoiceFemale || ''));
    /* 【统一音色只在性别未知时兜底】否则它会把男女两个说话人盖成同一个音色——
     * 用户看到的现象正是"听力只有女生，没有男生"（选的是女声就全变女声）。*/
    const unified = (isWord || !self._forceGender && !job.o.gender) ? prof.voice : '';
    u.voice = self.pickVoice(job.o.voice || genderVoice || unified, spokeGender, job.o.lang);
    u.lang = job.o.lang || (u.voice && u.voice.lang) || 'en-US';
    /* 语调自然化
     * 【为什么只微调 pitch / rate 就有效】
     * Web Speech API 不支持 SSML，无法真的"注入情感"，
     * 但**完全平的 pitch +恒定 rate** 正是"人机感"的主要来源。
     * 所以按句子的语义类型做小幅起伏：
     *   疑问句 → 音高略升（听上去像在提问）
     *   感叹/强调 → 音高与语速都有变化
     *   陈述句 → 接近平直，末尾略降
     * 幅度控制在 ±6% 以内——再大就会显得夸张、失去考试听感的稳重。
     */
    const t = String(job.text || '');
    let pitchAdj = 0, rateAdj = 0;
    /* 句子才做语调起伏；单词发音保持平直——
     * 给 "what" / "why" 这种单词套疑问语调反而怪，也更容易听不清。*/
    if (prof.prosody) {
      const isQuestion = /\?\s*$/.test(t) || /^(what|why|how|when|where|who|which|do|does|did|is|are|was|were|can|could|would|should|will|have|has)\b/i.test(t.trim());
      const isExclaim = /!/.test(t);
      const isList = /^(first|second|third|next|then|finally|firstly|secondly)\b/i.test(t.trim());
      const longClause = t.split(/[,;]/).length >= 3;
      if (isQuestion) { pitchAdj += 0.055; rateAdj -= 0.02; }
      if (isExclaim) { pitchAdj += 0.03; rateAdj += 0.05; }
      if (isList) { rateAdj += 0.03; pitchAdj += 0.015; }
      if (longClause) { rateAdj -= 0.015; }        // 复杂长句稍慢，更清楚
    }

    /* 基准 pitch = 1.0：不再按性别/句式手动缩放（那会让音色发闷失真）。
     * 只有调用方显式传 pitch 时才生效。*/
    u.pitch = Math.max(0.6, Math.min(1.6, job.o.pitch != null ? job.o.pitch : prof.pitch || 1));
    u.rate = Math.max(0.5, Math.min(2, job.o.rate != null ? job.o.rate : prof.rate));
    u.volume = 1;

    /* 三段计时：调用→引擎真正开口（起音，占大头的通常是这一段）、
     * 开口→读完（朗读）、以及合计。分开记录才能判断"2 秒"到底花在哪。 */
    const startedAt = job.queuedAt || Date.now();
    let speakAt = 0, startAt = 0;
    let watchdog = null;
    let preRollTimer = null;
    let finished = false;
    let retryCount = 0;
    const clearWatch = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
    /* 这一句实际用的音色是不是云端（决定起音预算、重试策略与失败记账口径）。
     * 必须在 done() 之前算出来：done() 里要做"起了个头却没声"的判定。*/
    const isCloudVoice = !!(u.voice && (u.voice.localService === false
      || /online|natural/i.test(String(u.voice.voiceURI || u.voice.name || ''))));
    const done = (why) => {
      if (finished) return;
      finished = true;
      clearWatch();
      if (preRollTimer) { clearTimeout(preRollTimer); preRollTimer = null; }
      self.lastMs = Date.now() - startedAt;
      self.lastWhy = why;
      if (startAt) {
        self.lastStartMs = speakAt ? startAt - speakAt : 0;
        self.lastSpeakMs = Date.now() - startAt;
      } else {
        self.lastStartMs = 0;
        self.lastSpeakMs = 0;
      }
      /* 【"起了个头就没声"检测】Edge 的云端神经音色（Online/Natural）会**只给事件不出声**：
       * speak() 后几十毫秒就来 onstart，紧接着 onend，听感是完全没声音。
       * 只看事件的话这一句算"成功"，既不提示也不退回 —— 用户听到的是一段静默。
       * 判据：云端音色 + 正常结束 + 朗读时长短得不可能（按 20ms/字符 的极低下限，另有 150ms 地板）。
       * 只对云端生效：本地音色读得短是正常的，不能误伤。*/
      let whyFinal = why;
      if (why === 'end' && isCloudVoice) {
        if (startAt && (Date.now() - startAt) < Math.max(150, String(job.text || '').length * 20)) {
          whyFinal = 'no-audio';
          self._noteCloudFail('no-audio');
        } else {
          /* 这一句云端音色确实正常读完了：清失败计数、解除自愈冷却 */
          if (self._cloudFails) self._cloudFails = 0;
          if (self.cloudOff) self.resetCloud(true);
        }
      }
      /* 【诊断】把"排队等待 / 引擎多久开口 / 读了多久"分开记下来。
       * "前几个 1 秒、后面 2–3 秒"这种越读越慢，就是靠这张表判断出是队列积压。*/
      self.diag.unshift({
        text: String(job.text || '').slice(0, 20),
        /* 真实字数：text 列被截断到 20 字，靠它算不出朗读速度（设置页要显示"字/秒"） */
        len: String(job.text || '').length,
        waitMs: speakAt ? Math.max(0, speakAt - startedAt) : -1,
        startMs: startAt && speakAt ? startAt - speakAt : -1,
        speechMs: startAt ? Date.now() - startAt : -1,
        totalMs: Date.now() - startedAt,
        busyAtQueue: job.engineBusyAtQueue ? 1 : 0,
        why: whyFinal || 'end',
        retries: retryCount,
        /* 【诊断要看得出"用的是哪个音色"】"有时还是人机声"必须能当场分辨：
         * 是自动选到了本地音色，还是自愈把云端关掉了。*/
        voiceName: (u.voice && u.voice.name) || '（浏览器默认）',
        voiceCloud: isCloudVoice ? 1 : 0,
      });
      self.diag = self.diag.slice(0, 12);
      if (self._active === active) {
        self._active = null;
        self._busy = false;
      }
      /* 连续合成很久后引擎内部队列会变慢：空闲时清一次（代价为零）。
       * 不记 _stoppedAt——本来就没在播，不需要等引擎安静。*/
      self._spoken = (self._spoken || 0) + 1;
      if (self._spoken % 20 === 0 && !(self._q && self._q.length)) {
        try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
      }
      if (why === 'canceled' || why === 'interrupted') {
        job.o.onerror && job.o.onerror({ error: why });
      } else {
        job.o.onend && job.o.onend();
      }
      job.resolve(u);
      setTimeout(() => self._pump(), 0);
    };
    active.cancel = () => done('canceled');
    /* 【看门狗：修"越读越慢"的关键】
     * Chrome/Windows SAPI 偶发不触发 onstart 或 onend。原来没有兜底，
     * 一次丢失就让 _busy 卡在 true —— 之后的朗读全部排队等待，延迟越滚越长
     *（正是"前几个 1 秒、后面 2–3 秒"）。现在超时强制收尾，队列不会被堵住。*/
    const guardMs = 3000 + String(job.text || '').length * 220;
    /* 【云端音色要另给预算】Microsoft * Online (Natural) 这类音色是**联网合成**的：
     * 首次起音要等一轮网络往返 + 云端合成，2.5 秒经常不够。
     * 而原来的 no-start 重试会把 voice 置空（"重试交给浏览器默认音色"）——
     * 对云端音色来说这等于**悄悄退回本地机器声**，用户看到的现象就是"开了自然音色还是人机声"。
     * 所以：云端音色给更长的起音预算，并且重试时**保留原音色**。*/
    const startBudget = isCloudVoice ? self.CLOUD_START_TIMEOUT_MS : self.START_TIMEOUT_MS;
    const forceFinish = (why) => {
      forcedWhy = why;
      self._stoppedAt = Date.now();
      try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
      done(why);
      /* 【no-start 的处置分两类，注意别被"只提示一次"的开关挡住计数】
       * 云端音色：计入自愈计数，连续两次就停用云端音色（否则每个句子白等 9 秒预算）；
       * 本地音色：维持原来的提示逻辑（缺语音包 / 引擎没响应，各提示一次）。*/
      if (why === 'no-end' && isCloudVoice) {
        /* 开口了、引擎却再没有回调：对云端音色同样是"这一句没出声"，
         * 必须一起记账，否则会一直卡在同一个坏音色上（旧代码只认 no-start）。*/
        self._noteCloudFail('no-end');
      }
      if (why === 'no-start') {
        if (isCloudVoice) {
          self._noteCloudFail('no-start');
        } else if (!self._noStartWarned) {
          self._noStartWarned = true;
          /* 两种情况提示必须分开——
           *  1) 列表里根本没有英文语音包 → 去系统设置装
           *  2) 有语音包但调不起来 → 多半是包还在下载/装了一半，
           *     或浏览器没重启导致语音服务没重新加载
           * 原来一句"系统语音未能启动"让人不知道该等还是该装，
           * 结果就是反复重试同一个无效动作。*/
          const enCount = (this.voices || []).length;
          if (!enCount) {
            App.toast('系统缺少英语语音包：' + this.voiceInstallGuide('female').title + '，安装后刷新页面', 'err');
          } else {
            App.toast('已检测到 ' + enCount + ' 个英语语音包，但语音引擎未响应。'
              + '若语音包仍在下载，请等下载完成；否则请完全重启浏览器', 'err');
          }
        }
      }
    };
    let forcedWhy = '';
    const retryNoStart = () => {
      retryCount++;
      clearWatch();
      self._stoppedAt = Date.now();
      const old = u;
      old.onstart = old.onend = old.onerror = old.onboundary = null;
      try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
      if (finished || self._active !== active) return;
      try {
        const next = new SpeechSynthesisUtterance(utteranceText);
        next.lang = old.lang;
        next.pitch = old.pitch;
        next.rate = old.rate;
        next.volume = old.volume;
        /* 本地音色首次可能起不来，重试交给浏览器默认音色；
         * 云端音色不能这么做——那会直接掉回机器声，等于把用户的选择吞掉。*/
        next.voice = isCloudVoice ? old.voice : null;
        u = next;
        bindUtterance(next);
        preRollTimer = setTimeout(() => doSpeak(1), self.SETTLE_MS);
      } catch (e) { forceFinish('throw'); }
    };
    const armWatchdog = () => {
      clearWatch();
      watchdog = setTimeout(() => {
        if (!startAt) {
          if (!retryCount) retryNoStart();
          else forceFinish('no-start');
          return;
        }
        watchdog = setTimeout(() => forceFinish('no-end'), guardMs);
      }, startBudget);
    };
    const callerStart = job.o.onstart;
    const bindUtterance = utterance => {
      utterance.onend = () => { if (u === utterance) done(forcedWhy || 'end'); };
      utterance.onerror = (e) => {
        if (u !== utterance) return;
        const err = (e && e.error) || '';
        if (err !== 'interrupted' && err !== 'canceled') console.warn('speech error:', err);
        done(forcedWhy || err);
      };
      utterance.onstart = (e) => {
        if (finished || u !== utterance) return;
        startAt = Date.now();
        self._noStartWarned = false;
        /* 【起音后立刻换哨】原来要等 startBudget（云端 9 秒）到点才去装第二个定时器；
         * 起音都已经发生了，这 9 秒纯属白等 —— 云端音色"起了个头就没声"时，
         * 用户要僵住十几秒才跳到下一句。这里起音即改挂"读完没有"的看门狗。*/
        clearWatch();
        watchdog = setTimeout(() => forceFinish('no-end'), guardMs);
        if (callerStart) callerStart(e);
      };
      if (job.o.onboundary) utterance.onboundary = e => {
        if (u === utterance && !finished) job.o.onboundary(e);
      };
    };
    bindUtterance(u);

    /* 【不吃字】cancel() 之后立刻 speak() 会吞掉首个音节：引擎还在拆上一句，
     * 新请求的开头就被截断了。所以记录 cancel 时刻，间隔不够就先等引擎安静下来。*/
    const sinceStop = self._stoppedAt ? (Date.now() - self._stoppedAt) : Infinity;
    let preRoll = Math.max(self.MIN_PREROLL_MS, self.SETTLE_MS - sinceStop);
    /* 本会话第一次朗读：引擎/音频设备是冷的，多留一点时间再开口 */
    if (!self._spokeAny) preRoll = Math.max(preRoll, self.FIRST_PREROLL_MS);
    /* 浏览器仍在 speaking 或 pending 时，先清理旧请求，
     * 按防吞音间隔再开口，避免新请求一直卡在引擎队列中。*/
    const doSpeak = (attempt) => {
      if (finished || self._active !== active) return;
      if (attempt === 0 && self._engineBusy()) {
        self._stoppedAt = Date.now();
        try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
        preRollTimer = setTimeout(() => doSpeak(1), self.SETTLE_MS);
        return;
      }
      try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) { /* 忽略 */ }
      const go = () => {
        if (finished || self._active !== active) return;
        speakAt = Date.now();
        self._spokeAny = true;
        armWatchdog();
        try { speechSynthesis.speak(u); } catch (e) { done('throw'); }
      };
      /* 首次朗读前先做一次静音预热（见 _warmUpOnce）：预热期间不武装看门狗，
       * 免得把冷启动时间算成引擎没响应。*/
      self._warmUpOnce(u).then(go, go);
    };
    preRollTimer = setTimeout(() => doSpeak(0), preRoll);
  },

  /**
   * 只在确实有朗读时才打断。
   * cancel 之后引擎要安静约 SETTLE_MS 才不吃字，无脑 cancel 等于每次播放先白等一次。
   */
  stopIfBusy() {
    let busy = false;
    try {
      busy = !!this._active || !!(this._q && this._q.length)
        || !!(this.neural && this.neural.busy)
        || !!(this.dict && this.dict.busy)
        || !!(this.online && this.online.busy)
        || !!(this.local && this.local.playing)
        || (typeof AudioPack !== 'undefined' && AudioPack.playing)
        || (typeof speechSynthesis !== 'undefined'
          && (speechSynthesis.speaking || speechSynthesis.pending));
    } catch (e) { busy = false; }
    if (busy) this.stop();
    return busy;
  },

  /** 停止全部朗读并清空队列 */
  stop() {
    /* 清队列时必须 resolve 掉这些任务：它们对应的 Promise 可能正被 await
     *（例如设置页的"试听并计时"），丢下不管会让调用方永远挂住。
     * 正在播的那一条由 cancel 触发的 onend/onerror 或看门狗收尾。*/
    const pending = this._q || [];
    const active = this._active;
    this._q = [];
    pending.forEach(job => { try { job.resolve(null); } catch (e) { /* 忽略 */ } });
    /* 开源人声（Kokoro）与真人词典音频是两条独立通道，都要停：
     * 两个 stop() 都无条件结算调用方的 Promise（详见 Speech._newJob）。
     * _stopSeq 让「取音频/加载模型期间被停止」的请求不再被回落逻辑重新起播。*/
    this._stopSeq = (this._stopSeq || 0) + 1;
    if (this.neural && typeof this.neural.stop === 'function') this.neural.stop();
    if (this.dict && typeof this.dict.stop === 'function') this.dict.stop();
    if (this.online && typeof this.online.stop === 'function') this.online.stop();
    if (typeof AudioPack !== 'undefined' && AudioPack.stop) AudioPack.stop();
    this._stoppedAt = Date.now();
    try { speechSynthesis.cancel(); } catch (e) { }
    if (active) active.cancel();
    else if (!this._active) this._busy = false;
  },

  /* ---------- 神经人声引擎（可选）：开源 kokoro-js / Kokoro-82M，Apache-2.0 ----------
   * ⛔ 【已停用，不要再接回 UI】用户明确表示"这个始终无法调好"，已从设置页移除入口，
   *    并在 Store.load() 里把旧的 speechEngine:'neural' 迁移回 'system'。
   *    听力的人声改由 Edge 自带的 Azure 神经音色（Online/Natural）承担：
   *    零下载、无需联网下载模型，见 init()/pickVoice() 的云端音色处理与 voiceReport()。
   *    以下代码**保留但不可达**（默认引擎恒为 system），仅供将来参考；
   *    相关自检 check-speech-prefetch.cjs / check-speech-load-source.cjs 仍会跑，保证它不会悄悄腐烂。
   *
   * 【为什么加】系统 TTS（Windows SAPI / Chrome 后端）听感机械，且起音慢；
   * Kokoro-82M 是开源方案里"体积 / 人声自然度"平衡较好的一档，浏览器内运行（WASM/WebGPU）。
   * 【代价与边界，写清楚免得误判】
   *   1) 首次使用要从 HuggingFace 下载量化模型（q8 约 90MB），之后由浏览器缓存离线可用；
   *   2) 需要能访问网络（默认走 jsDelivr 的 ESM 包 + HF 模型仓库）；
   *   3) 任何环节失败（无网 / 显存不足 / 模块变更）都**自动回落系统语音**，只提示一次，不影响朗读功能。
   */
  neural: {
    /** 默认音色：女声 af_heart（韵律最自然）、男声 am_fenrir、英音 bf_emma / bm_george */
    voiceFor(o = {}) {
      const st = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      if (o.voice) return o.voice;
      if (o.gender === 'male') return st.ttsVoiceMale || 'am_fenrir';
      if (o.gender === 'british-f') return 'bf_emma';
      if (o.gender === 'british-m') return 'bm_george';
      return st.ttsVoice || 'af_heart';
    },

    state: 'idle',        // idle | loading | ready | failed
    error: '',
    tts: null,
    onProgress: null,
    playing: false,       // 正在合成或播放（busy 的数据源之一）
    _audio: null,         // 当前音频元素（stop() 必须暂停它，否则停止后还在响）
    _job: null,           // 当前请求：stop() 靠它无条件结算调用方的 Promise
    _finish: null,        // 与 _job.cancel 等价的兼容入口
    _warned: false,
    _loadPromise: null,
    _queue: [],
    _active: null,

    /* ---------- 加载源（本机实测结论，2026-10-13）----------
     * 只换 CDN 入口是不够的——transformers 里还有两处**写死的默认地址**：
     *   env.remoteHost                  = https://huggingface.co/                     （取模型）
     *   env.backends.onnx.wasm.wasmPaths = https://cdn.jsdelivr.net/npm/@huggingface/transformers@<ver>/dist/
     * 本机实测：cdn.jsdelivr.net → ECONNRESET；huggingface.co → 连接超时（黑洞）。
     * 所以 JS 拿到了、模型或 wasm 照样拿不到。两个地址都必须在 import 之后覆盖。
     * 下面按顺序尝试，第一个通的就用；全部不通时把每个源的失败原因一起报出来。*/
    CDN_BASES: [
      'https://fastly.jsdelivr.net',    // 实测 200（1590ms）
      'https://gcore.jsdelivr.net',     // 实测 200（1793ms）
      'https://cdn.jsdelivr.net',       // 实测 ECONNRESET，放最后当兜底
    ],
    MODEL_HOSTS: [
      'https://hf-mirror.com',          // 实测 200（国内镜像，模型 88MB 可取）
      'https://huggingface.co',         // 实测连接超时
    ],
    /* kokoro-js 的 +esm 产物内部按**相对路径** import 下面两个依赖，
     * 所以「同一个 CDN 基址 + 同一个版本」是覆盖 env 生效的前提：
     * 浏览器按解析后的绝对 URL 复用模块实例，自己先 import 一次就拿到同一个 env。*/
    TRANSFORMERS_PATH: '/npm/@huggingface/transformers@3.5.1/+esm',
    TRANSFORMERS_DIST: '/npm/@huggingface/transformers@3.5.1/dist/',
    KOKORO_PATH: '/npm/kokoro-js@1.2.1/+esm',
    PROBE_TIMEOUT_MS: 4000,             // 探测单个源的预算：不通就换下一个，别让人干等 10 秒

    /** 动态 import 的接缝（自检里替换掉，测试就不必真的联网） */
    _import(url) { return import(url); },

    /** 失败原因的可读化：fetch 的 TypeError 本身不带信息，真正的原因在 cause 里 */
    _why(e) {
      const c = e && e.cause;
      return String((c && (c.code || c.name || c.message)) || (e && e.message) || e).slice(0, 120);
    },

    /** 带预算的 HEAD 探测：只用来判断"这个源通不通" */
    _head(url) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, this.PROBE_TIMEOUT_MS);
      const opt = { method: 'HEAD', cache: 'no-store' };
      if (ctrl) opt.signal = ctrl.signal;
      return fetch(url, opt).then(r => {
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return true;
      }, e => { clearTimeout(timer); throw e; });
    },

    /** 拿 transformers 的 env（必须先 import 一次，才能改掉它写死的默认地址） */
    async _env(base) {
      try {
        const mod = await this._import(base + this.TRANSFORMERS_PATH);
        return mod.env || (mod.default && mod.default.env) || null;
      } catch (e) { return null; }   // 拿不到 env 不致命：kokoro 的 import 会报出真正原因
    },

    /** 按顺序挑一个可达的模型源；都不通时仍返回第一个，让 from_pretrained 报真实错误 */
    async _pickHost(tried) {
      const model = this._modelId();
      for (const host of this.MODEL_HOSTS) {
        try {
          await this._head(host + '/' + model + '/resolve/main/config.json');
          return host;
        } catch (e) { tried.push('✗ 模型源 ' + host + '（' + this._why(e) + '）'); }
      }
      return this.MODEL_HOSTS[0];
    },

    _modelId() {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      return s.ttsModel || 'onnx-community/Kokoro-82M-v1.0-ONNX';
    },

    /**
     * 探测下载源可达性 → 返回可读报告（设置页「检测下载源」按钮用）。
     * 目的是：让用户在等 90MB 之前就知道这次能不能成。
     */
    async probe() {
      const lines = [];
      let cdn = '';
      for (const base of this.CDN_BASES) {
        const t0 = Date.now();
        try { await this._head(base + this.KOKORO_PATH); cdn = base; lines.push('✓ 语音包源 ' + base + '（' + (Date.now() - t0) + 'ms）'); break; }
        catch (e) { lines.push('✗ 语音包源 ' + base + '（' + this._why(e) + '）'); }
      }
      let host = '';
      for (const h of this.MODEL_HOSTS) {
        const t0 = Date.now();
        try { await this._head(h + '/' + this._modelId() + '/resolve/main/config.json'); host = h; lines.push('✓ 模型源 ' + h + '（' + (Date.now() - t0) + 'ms）'); break; }
        catch (e) { lines.push('✗ 模型源 ' + h + '（' + this._why(e) + '）'); }
      }
      lines.push(cdn && host
        ? '结论：可以加载，首次约 93MB（q8 模型 88MB + wasm 4MB），之后由浏览器缓存'
        : '结论：当前网络下无法加载，需要换网络或改下载源');
      this._src = { cdn: cdn, host: host };
      return lines.join('\n');
    },

    load(force = false) {
      if (this.state === 'ready') return true;
      if (this.state === 'loading') return this._loadPromise || false;
      if (this.state === 'failed' && !force) return false;
      this.state = 'loading';
      this.error = '';
      this._loadPromise = (async () => {
        const tried = [];
        try {
          const s = (Store.d && Store.d.settings) || {};
          // 1) 先挑可达的模型源：不通的源会白等 10 秒，看起来就像卡死
          const host = await this._pickHost(tried);
          // 2) 再从可达的 CDN 载入 JS，并覆盖 transformers 里写死的两个默认地址
          let KokoroTTS = null;
          for (const base of this.CDN_BASES) {
            try {
              const env = await this._env(base);
              if (env) {
                env.allowRemoteModels = true;
                env.remoteHost = host + '/';            // 必须是带结尾斜杠的基址
                if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
                  env.backends.onnx.wasm.wasmPaths = base + this.TRANSFORMERS_DIST;
                }
              }
              const mod = await this._import(base + this.KOKORO_PATH);
              KokoroTTS = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS);
              if (!KokoroTTS) throw new Error('模块未导出 KokoroTTS');
              this._src = { cdn: base, host: host };
              tried.push('✓ ' + base);
              break;
            } catch (e) {
              tried.push('✗ ' + base + '（' + this._why(e) + '）');
            }
          }
          if (!KokoroTTS) throw new Error('语音包源全部不可用：' + tried.join('；'));
          this.tts = await KokoroTTS.from_pretrained(this._modelId(), {
            dtype: ((typeof navigator !== 'undefined' && navigator.gpu) ? (s.ttsDtype || 'fp32') : 'q8'),
            device: (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm',
            progress_callback: p => { if (typeof this.onProgress === 'function') this.onProgress(p); },
          });
          this.state = 'ready';
          this.clearPrefetch();     // 换了模型/精度，旧音频不能复用
          return true;
        } catch (e) {
          this.state = 'failed';
          this.error = String((e && e.message) || e).slice(0, 300);
          return false;
        } finally { this._loadPromise = null; }
      })();
      return this._loadPromise;
    },

    /* ---------- lookahead 预推理（②）----------
     * 【为什么需要】Kokoro 在浏览器里合成一句话要几百毫秒到 1 秒。串行「读完再合成下一句」
     * 会把这段合成时间直接加进句间静默里，听感是"读完一句要等一会儿才出下一句"。
     * 做法：当前句一开口，就同时把**下一句**合成好放缓存；轮到它时直接复用，句间只剩设计的停顿。
     * 三条约束：
     *   1. 预取**只合成、不播放**——绝不创建 Audio 元素，所以停止/切段后不会突然出声；
     *   2. 合成结果只由「音色 | 语速 | 文本」决定，所以可安全缓存并复用；
     *   3. 预取失败静默丢弃：真正要播时会重新合成并走正常的回落流程。*/
    PREFETCH_MAX: 16,       // 缓存条数上限（一条约数百 KB，避免长材料把内存吃满）
    _cache: null,           // Map: key -> 已合成好的音频结果（LRU）
    _pending: null,         // Map: key -> 正在合成中的 Promise

    /** 缓存键：只有这三者变化才需要重新合成 */
    _key(text, o = {}) {
      return this.voiceFor(o) + '|'
        + Math.max(0.5, Math.min(1.6, Number(o.rate) || 1)) + '|'
        + String(text == null ? '' : text).trim();
    },

    _gen(text, o = {}) {
      return this.tts.generate(String(text == null ? '' : text).trim(), {
        voice: this.voiceFor(o),
        speed: Math.max(0.5, Math.min(1.6, Number(o.rate) || 1)),
      });
    },

    _remember(key, audio) {
      this._cache = this._cache || new Map();
      if (this._cache.has(key)) this._cache.delete(key);   // 命中/更新都移到末尾
      this._cache.set(key, audio);
      while (this._cache.size > this.PREFETCH_MAX) {
        this._cache.delete(this._cache.keys().next().value);
      }
    },

    /** 预取：把 text 的音频先合成好；返回 Promise（仅测试与诊断用，调用方可忽略） */
    prefetch(text, o = {}) {
      if (this.state !== 'ready' || !this.tts) return null;
      const t = String(text == null ? '' : text).trim();
      if (!t) return null;
      const key = this._key(t, o);
      if (this._cache && this._cache.has(key)) return Promise.resolve(this._cache.get(key));
      this._pending = this._pending || new Map();
      if (this._pending.has(key)) return this._pending.get(key);
      const p = this._gen(t, o).then(audio => {
        this._pending.delete(key);
        if (audio) this._remember(key, audio);
        return audio || null;
      }, () => {
        this._pending.delete(key);
        return null;      // 预取失败不提示、不回落：真正播的时候再走正常流程
      });
      this._pending.set(key, p);
      return p;
    },

    /** 取音频：优先用预取好的，其次等正在预取的，最后才现合成（现合成的结果同样入缓存，
     *  这样重播同一句/同一个词不必再合成一次） */
    async _obtain(text, o = {}) {
      const t = String(text == null ? '' : text).trim();
      const key = this._key(t, o);
      if (this._cache && this._cache.has(key)) {
        const hit = this._cache.get(key);
        this._remember(key, hit);            // LRU：命中也算最近使用
        return hit;
      }
      if (this._pending && this._pending.has(key)) {
        const audio = await this._pending.get(key);
        if (audio) return audio;
      }
      const audio = await this._gen(t, o);
      if (audio) this._remember(key, audio);
      return audio;
    },

    /** 丢弃全部预取（切换引擎/音色/口音或模型重载时用，避免旧结果被复用） */
    clearPrefetch() {
      if (this._cache) this._cache.clear();
      if (this._pending) this._pending.clear();
    },

    /**
     * 生成并播放。契约（自检 check-speech-options 的 Kokoro 用例逐条要求）：
     * - 合成一开始就置 `playing`：调用方（含 _engineBusy/stopIfBusy）必须能立刻判定"在播"
     * - 转发调用方的 onstart / onend：听力与背单词靠回调推进流程
     * - 被 stop() 打断时以 `{ error: 'canceled' }` 回调 onerror、以 null 结算 Promise
     */
    /**
     * 「正在播」判定（派生，不存状态）：
     * 只要还在合成/播放（playing）、音频元素存在且未暂停、或有排队/在跑的请求，就算忙。
     * 用派生值而不是布尔位，避免任何一处提前清标志导致"在播却报空闲"。
     */
    get busy() {
      return this.playing === true
        || !!(this._audio && this._audio.paused === false)
        || !!this._active
        || !!(this._queue && this._queue.length);
    },

    async say(text, o = {}) {
      const self = this;
      /* job 必须在**合成之前**建：这样 stop() 在"合成中"也能结算调用方的 Promise，
       * 并让合成结果回来后不再起播（① 的两个坑都出在这里）。结算逻辑统一在 Speech._newJob。*/
      const job = Speech._newJob(self, o);
      let url = '';
      try {
        /* 与 job.outcome 竞速：被 stop() 时**立刻**返回，不必等合成跑完。
         * 合成本身无法中断，但调用方的 await 既不能悬挂、也不该白等这几百毫秒。*/
        const audio = await Promise.race([self._obtain(text, o), job.outcome.then(() => null)]);
        if (job.finished || !audio) return null;   // 取音频期间已被 stop()
        url = URL.createObjectURL(audio.toBlob());
        return await Speech._playJob(self, job, url, o);
      } catch (e) {
        job.quiet();                            // 合成失败：清掉通道状态，异常交给 speak() 走回落
        throw e;
      } finally {
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }
      }
    },
    _pump() {
      if (this._active || !this._queue || !this._queue.length) return;
      const job = this._queue.shift();
      let audioEl = null, objectUrl = '', finished = false, started = false;
      const active = { cancel: null };
      this._active = active;
      const finish = error => {
        if (finished) return;
        finished = true;
        if (audioEl) {
          audioEl.onplaying = audioEl.onended = audioEl.onerror = null;
          try { audioEl.pause(); } catch (e) { }
          audioEl = null;
        }
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { } objectUrl = ''; }
        if (this._active === active) this._active = null;
        if (error) {
          if (error === 'canceled') {
            job.o.onerror && job.o.onerror({ error });
            job.resolve(null);
          } else {
            job.reject(error instanceof Error ? error : new Error(String(error)));
          }
        } else {
          job.o.onend && job.o.onend();
          job.resolve(null);
        }
        setTimeout(() => this._pump(), 0);
      };
      active.cancel = () => finish('canceled');
      (async () => {
        const s = (Store.d && Store.d.settings) || {};
        const profile = Speech.profile(!!job.o.word);
        const rate = job.o.rate != null ? Number(job.o.rate) : profile.rate;
        const output = await this.tts.generate(String(job.text == null ? '' : job.text).trim(), {
          voice: o.voice || s.ttsVoice || 'af_heart',
          speed: Math.max(0.5, Math.min(1.6, Number(rate) || 1)),
        });
        if (finished || this._active !== active) return;
        objectUrl = URL.createObjectURL(output.toBlob());
        audioEl = new Audio(objectUrl);
        audioEl.onplaying = () => {
          if (started || finished) return;
          started = true;
          job.o.onstart && job.o.onstart({ type: 'start' });
        };
        audioEl.onended = () => finish(null);
        audioEl.onerror = () => finish(new Error('Kokoro 音频播放失败'));
        const play = audioEl.play();
        if (play && play.then) play.then(() => {
          if (!started && !finished && audioEl && !audioEl.paused) {
            started = true;
            job.o.onstart && job.o.onstart({ type: 'start' });
          }
        }).catch(finish);
      })().catch(finish);
    },

    /**
     * 取消正在合成/播放的 Kokoro 音频，并清空待播队列（由 Speech.stop() 调用）。
     *
     * 【无条件结算】调用方的 Promise 挂在**当前 job** 上，而不是挂在 _audio 上：
     * 只要这次请求还在（不论处在"合成中"还是"播放中"、音频元素有没有建出来），
     * 就一律按 canceled 结算，并暂停音频元素。
     * 不做这个无条件结算的后果是 await 永不返回 —— 自检会在第 15 项静默停住后退出。
     */
    stop() {
      const pending = this._queue || [];
      this._queue = [];
      pending.forEach(job => { try { job.resolve(null); } catch (e) { /* 忽略 */ } });
      const job = this._job;
      if (job && typeof job.cancel === 'function') job.cancel();     // 暂停音频 + 结算 Promise
      else if (typeof this._finish === 'function') { const f = this._finish; this._finish = null; f(); }
      this._finish = null;
      this.playing = false;
      // 兜底：万一音频元素脱离了 job（异常路径），也要停下来，不能停止后还出声
      const orphan = this._audio;
      this._audio = null;
      if (orphan) { try { orphan.pause(); orphan.currentTime = 0; } catch (e) { /* 忽略 */ } }
      if (this._active && this._active.cancel) this._active.cancel();
    },
  },

  /* ---------- ③ 真人词典音频层（可选）：有道 dictvoice ----------
   * 【为什么加】系统 TTS 与 Kokoro 都是"合成音"；单词发音最自然的是词典自带的真人录音。
   * 【为什么必须走 serve.js 代理】实测有道端点**不返回 Access-Control-Allow-Origin**
   *（带 Origin 的 GET 无该头，OPTIONS 预检直接 403），页面 fetch() 读不到字节，
   * 无法缓存、也无法做"800ms 拿不到就回落"。所以由本机 serve.js 提供同源代理
   * /__dict-audio?w=<word>&type=<1|2>，并把结果落盘缓存到 .cache/dict-audio/。
   * 【代价，写清楚免得误判】
   *   1) 打开后每个单词都会向第三方发起查询（会把你在背的词发出去），所以默认关闭；
   *   2) 只有经 `node serve.js` 启动时才有代理；file:// 或别的静态服务器下第一次失败即
   *      标记本会话不可用，直接回落 Kokoro / 系统语音，不会每个词都白等一次；
   *   3) 800ms 预算内没拿到音频就回落——超时不等于失败，服务端仍会继续取回并写入缓存，
   *      下次点同一个词通常就是本机命中了。*/
  /* 在线词典发音兜底：系统 TTS 不可用时，用有道词典音频接口直接播放。
   * 不经过服务端代理；需要联网，会把待朗读文本发给有道。默认只在安装版启用，可在设置关闭。*/
  online: {
    state: 'idle',
    playing: false,
    _audio: null,
    _job: null,
    _finish: null,
    _hits: 0,

    get busy() { return this.playing === true || !!(this._audio && this._audio.paused === false); },

    enabled() {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      if (s.onlineTts === false) return false;
      /* 默认开启：很多 Android 平板没有系统 TTS 引擎，在线词典音频是唯一能出声的路径。
       * 设置页可关闭；系统音色可用时不会走到这里。*/
      return true;
    },

    urlFor(text) {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(text || '').trim())
        + '&type=' + (String(s.dictAccent) === '1' ? '1' : '2');
    },

    async say(text, o = {}) {
      const self = this;
      const job = Speech._newJob(self, o);
      if (job.finished) return null;
      self._hits = (self._hits || 0) + 1;
      try {
        const res = await Speech._playJob(self, job, self.urlFor(text), o);
        if (res !== null) self.state = 'ok';
        return res;
      } catch (e) {
        job.quiet();
        self.state = 'unavailable';
        self.error = (e && e.message) || String(e);
        return null;
      }
    },

    stop() {
      const job = this._job;
      if (job && typeof job.cancel === 'function') job.cancel();
      else if (typeof this._finish === 'function') { const f = this._finish; this._finish = null; f(); }
      this._finish = null;
      this.playing = false;
      const orphan = this._audio;
      this._audio = null;
      if (orphan) { try { orphan.pause(); orphan.currentTime = 0; } catch (e) { /* 忽略 */ } }
    },
  },

  dict: {
    state: 'idle',        // idle | ok | unavailable（本会话已判定代理不可用）
    playing: false,
    error: '',
    _audio: null,
    _job: null,
    _finish: null,
    _cache: null,         // Map: url -> Blob（会话内存缓存，磁盘缓存由 serve.js 负责）
    CACHE_MAX: 40,
    TIMEOUT_MS: 800,      // 取音频预算：超过就回落下一层

    /** 「正在播」判定（与 neural.busy 同口径，派生不存状态） */
    get busy() {
      return this.playing === true || !!(this._audio && this._audio.paused === false);
    },

    /** 是否启用（用户开关 + 本会话未被判定为不可用） */
    enabled() {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      return !!s.dictAudio && this.state !== 'unavailable';
    },

    /** 同源代理地址；口音 '1'=英音，'2'=美音 */
    urlFor(word, accent) {
      return '/__dict-audio?w=' + encodeURIComponent(String(word || '').trim())
        + '&type=' + (String(accent) === '1' ? '1' : '2');
    },

    /** 设置变化（开关 / 口音）后重置：丢弃内存缓存与"不可用"判定 */
    reset() { this.state = 'idle'; this.error = ''; this._cache = null; },

    statusText() {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      if (!s.dictAudio) return '未启用：背单词走 Kokoro / 系统语音';
      if (this.state === 'unavailable') return '不可用：未检测到本机代理（请用 node serve.js 启动）——已回落';
      if (this.state === 'ok') return '已启用：真人录音优先，取不到则回落（点过 ' + (this._hits || 0) + ' 次）';
      return '已启用：首次点词时会试取真人录音（800ms 内没到就回落）';
    },

    _remember(url, blob) {
      this._cache = this._cache || new Map();
      if (this._cache.has(url)) this._cache.delete(url);
      this._cache.set(url, blob);
      while (this._cache.size > this.CACHE_MAX) this._cache.delete(this._cache.keys().next().value);
    },

    /** 取音频字节：命中内存缓存 → 直接返回；否则 800ms 预算内取回（失败返回 null，交由上层回落） */
    async _blob(word) {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      const url = this.urlFor(word, s.dictAccent);
      if (this._cache && this._cache.has(url)) {
        const hit = this._cache.get(url);
        this._remember(url, hit);
        return hit;
      }
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, this.TIMEOUT_MS);
      try {
        const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        if (!blob || !blob.size) throw new Error('空音频');
        this._remember(url, blob);
        this._hits = (this._hits || 0) + 1;
        this.state = 'ok';
        return blob;
      } catch (e) {
        this.error = String((e && e.message) || e);
        /* 404/405：没有代理（file:// 或换了别的静态服务器）→ 本会话不再重试。
         * 超时/5xx 属于暂时性，下次仍会尝试（服务端可能已把结果写进缓存）。*/
        if (/HTTP (404|405|501)/.test(this.error)) this.state = 'unavailable';
        return null;
      } finally { clearTimeout(timer); }
    },

    /** 取到就播；取不到 / 超时 / 被停止都返回 null，由上层回落（或直接结束） */
    async say(word, o = {}) {
      const job = Speech._newJob(this, o);     // 先建 job：stop() 在取音频期间也能立刻结算
      let url = '';
      try {
        /* 与 job.outcome 竞速：stop() 时立刻返回，不等 800ms 预算走完
         *（取字节无法真正中断，但调用方的 await 不允许被拖住）。*/
        const blob = await Promise.race([this._blob(word), job.outcome.then(() => null)]);
        if (job.finished) return null;         // 取音频期间被 stop()
        if (!blob) { job.quiet(); return null; }
        url = URL.createObjectURL(blob);
        return await Speech._playJob(this, job, url, o);
      } catch (e) {
        job.quiet();
        this.error = String((e && e.message) || e);
        return null;
      } finally {
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }
      }
    },

    /** 取消正在播放的词典音频（由 Speech.stop() 调用；与 neural.stop 同一套语义） */
    stop() {
      const job = this._job;
      if (job && typeof job.cancel === 'function') job.cancel();
      else if (typeof this._finish === 'function') { const f = this._finish; this._finish = null; f(); }
      this._finish = null;
      this.playing = false;
      const orphan = this._audio;
      this._audio = null;
      if (orphan) { try { orphan.pause(); orphan.currentTime = 0; } catch (e) { /* 忽略 */ } }
    },
  },

  /* ---------- 离线语音库（Piper VITS，随 APK 打包）：系统没有英语音色时接管 ----------
   * 平板实测系统英语音色 0 个：原来听力只能走有道（单音色，做不出男女对问）。
   * LocalTtsPlugin 用 sherpa-onnx + Piper VITS 端侧合成 WAV，再由 AudioPackPlugin 的
   * filePath 通道播放；男女声由调用方 gender 决定（默认女=jenny 英音、男=ryan 美音；
   * 2026-10-22 按用户反馈移除了英音男声 alan，它不像四六级录音）。
   * 桌面浏览器没有这个插件 → available() 恒 false，行为与以前完全一致。
   */
  local: {
    ready: false,
    initError: '',
    playing: false,
    _warned: false,
    _initPromise: null,
    _prefetching: new Map(),
    VOICE_FEMALE: 'jenny',
    VOICE_MALE: 'ryan',
    VOICES: ['jenny', 'ryan', 'amy', 'joe'],

    _plugin() {
      const Cap = typeof window !== 'undefined' ? window.Capacitor : null;
      const native = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
      const p = native && Cap.Plugins && Cap.Plugins.LocalTts;
      return p || null;
    },

    /** 安装版里才有；设置里可以整体关闭 */
    available() {
      if (this._plugin() === null) return false;
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      return s.localTts !== false;
    },

    init() {
      if (this._initPromise) return this._initPromise;
      const p = this._plugin();
      if (!p) { this._initPromise = Promise.resolve(false); return this._initPromise; }
      this._initPromise = Promise.resolve(p.init()).then(r => {
        this.ready = !!(r && r.ok);
        return this.ready;
      }, e => {
        this.initError = (e && e.message) || String(e);
        this.ready = false;
        return false;
      });
      return this._initPromise;
    },

    /** 是否该由离线语音库接手：显式 local:true / 设置里优先 / 系统没有任何英语音色 */
    shouldHandle(o = {}) {
      if (!this.available()) return false;
      if (o.local === true) return true;
      if (o.local === false) return false;
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      if (s.localTtsPreferred) return true;
      const sp = typeof Speech !== 'undefined' ? Speech : null;
      if (sp && sp.voices && sp.voices.length) return false;   // 有系统/云端音色：优先它们（桌面）
      return true;                                            // 系统无音色（平板）：本地接管
    },

    /** 按 gender 选本地音色；settings 里可改男女各用哪个 */
    voiceFor(o = {}) {
      const s = (typeof Store !== 'undefined' && Store.d && Store.d.settings) || {};
      const sp = typeof Speech !== 'undefined' ? Speech : null;
      const g = o.gender || (sp && sp._forceGender) || '';
      const pick = v => (this.VOICES.indexOf(String(v)) >= 0 ? String(v) : '');
      if (o.voice && pick(o.voice)) return String(o.voice);
      if (g === 'male' || g === 'british-m') return pick(s.localVoiceMale) || this.VOICE_MALE;
      if (g === 'female' || g === 'british-f') return pick(s.localVoiceFemale) || this.VOICE_FEMALE;
      return pick(s.localVoiceFemale) || this.VOICE_FEMALE;
    },

    _norm(text) {
      if (typeof LocalTts !== 'undefined' && LocalTts.normalize) return LocalTts.normalize(text);
      return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    },

    async synthesize(text, o = {}) {
      const p = this._plugin();
      if (!p) throw new Error('离线语音库不可用（非安装版）');
      const voice = this.voiceFor(o);
      const r = await p.synthesize({ text: this._norm(text), voice });
      if (!r || !r.ok || !r.path) throw new Error((r && r.error) || '合成失败');
      return { path: r.path, voice, sampleRate: r.sampleRate };
    },

    /** 只合成不播放（听力下一句预热；命中插件磁盘缓存时很快） */
    prefetch(text, o = {}) {
      if (!this.available() || !text) return null;
      const key = this.voiceFor(o) + '|' + this._norm(text);
      if (this._prefetching.has(key)) return this._prefetching.get(key);
      const pr = this.init().then(ok => {
        if (!ok) return null;
        return this.synthesize(text, o).catch(() => null);
      }).then(r => { this._prefetching.delete(key); return r; });
      this._prefetching.set(key, pr);
      return pr;
    },

    /** 合成 + 播放；返回 undefined=播完，null=失败/被停止（调用方回落到系统/在线） */
    async say(text, o = {}) {
      const sp = typeof Speech !== 'undefined' ? Speech : null;
      const seq = (sp && sp._stopSeq) || 0;
      /* 合成阶段也算 busy：否则用户在"合成中"点停止时 stopIfBusy 判定为空闲，
       * stop 不会执行，合成结束后声音又突然出来。*/
      this.playing = true;
      try {
        await this.init();
        if (!this.ready) { this._warn(this.initError || '语音库未就绪'); return null; }
        let synth;
        try { synth = await this.synthesize(text, o); }
        catch (e) { this._warn(e); return null; }
        if (seq !== ((sp && sp._stopSeq) || 0)) return null;   // 合成期间被 stop：别再出声
        if (typeof AudioPack === 'undefined' || typeof AudioPack.playPath !== 'function') return null;
        const budget = Math.max(30000, Math.min(180000, 8000 + String(text || '').length * 180));
        const r = await AudioPack.playPath(synth.path, Object.assign({}, o, { timeoutMs: budget }));
        return r === null ? null : undefined;
      } finally {
        this.playing = false;
      }
    },

    _warn(e) {
      if (this._warned) return;
      this._warned = true;
      this.initError = (e && e.message) || String(e);
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('离线语音库合成失败，已改用系统/在线语音：' + String(this.initError).slice(0, 80), 'err');
      }
    },
  },

  /** 人声引擎失败：回落系统语音，并且只提示一次 */
  _neuralWarn(e) {
    if (this.neural._warned) return;
    this.neural._warned = true;
    const msg = (e && e.message) ? String(e.message).slice(0, 120) : String(e).slice(0, 120);
    App.toast('人声引擎不可用，已回落系统语音：' + msg, 'err');
  },

  /** 顺序朗读多段（如听力原文逐句） */
  speakSeq(list, o = {}) {
    let i = 0;
    const self = this;
    this.stopIfBusy();   // 没在播就别 cancel（省掉取消后的 200ms 安静等待）
    const next = () => {
      if (i >= list.length) { o.onAllEnd && o.onAllEnd(); return; }
      const seg = list[i];
      i++;
      self.speak(seg.text, {
        rate: seg.rate ?? o.rate,
        pitch: seg.pitch ?? o.pitch,
        gender: seg.gender ?? o.gender,
        onstart: () => o.onSeg && o.onSeg(i, seg),
        onend: () => setTimeout(next, o.gap ?? 380),
      });
    };
    next();
  },
  get speaking() {
    return !!(this.neural && this.neural.busy)
      || !!(this.local && this.local.playing)
      || (typeof speechSynthesis !== 'undefined' && !!speechSynthesis.speaking);
  },

  /** 逐词高亮（复现模式）—— 走队列，避免 cancel 导致静音 */
  speakWords(text, o = {}) {
    const parts = text.split(/(\s+)/).filter(x => x.trim());
    let i = 0;
    const self = this;
    this.stopIfBusy();
    const next = () => {
      if (i >= parts.length) { o.onAllEnd && o.onAllEnd(); return; }
      const w = parts[i];
      self.speak(w, {
        rate: (o.rate ?? 1) * 0.95,
        gender: o.gender,
        onstart: () => o.onWord && o.onWord(i, w),
        onend: () => { i++; setTimeout(next, 30); },
      });
    };
    next();
  },
};
window.Speech = Speech;
document.addEventListener('DOMContentLoaded', () => Speech.init());
