/* ============ audio-pack.js : 预生成音频包（小样） ============
 * APK 内 assets/audio/index.json 记录词/句与男女声文件；
 * Capacitor 下交给 AudioPackPlugin（Android MediaPlayer）播放。
 * 浏览器/PWA 没有插件时自动跳过，仍走原 speech.js 兜底。
 */
const AudioPack = {
  ready: false,
  error: '',
  entries: {},
  words: {},
  sentences: {},
  voices: {},
  playing: false,
  _current: null,
  _seq: 0,
  _native: null,

  norm(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  },

  _plugin() {
    if (this._native) return this._native;
    const Cap = typeof window !== 'undefined' ? window.Capacitor : null;
    const native = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
    const plugin = native && Cap.Plugins && Cap.Plugins.AudioPack;
    if (plugin) this._native = plugin;
    return plugin || false;
  },

  async load() {
    try {
      const res = await fetch('assets/audio/index.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      this.entries = data.entries || {};
      this.voices = data.voices || {};
      for (const key of Object.keys(this.entries)) {
        const entry = this.entries[key];
        if (!entry || !entry.text) continue;
        const n = this.norm(entry.text);
        if (key.indexOf('words:') === 0) this.words[n.toLowerCase()] = entry;
        else this.sentences[n] = entry;
      }
      this.ready = true;
    } catch (e) {
      this.error = e && e.message || String(e);
    }
  },

  _entry(text, o = {}) {
    const n = this.norm(text);
    const w = this.words[n.toLowerCase()];
    if (o.word) return w;
    /* 阅读/生词本里的“读”按钮常常没有 word:true，单词也要能命中；
     * 先按整句查，查不到再按单词查。*/
    return this.sentences[n] || w;
  },

  canPlay(text, o = {}) {
    const plugin = this._plugin();
    if (!plugin || !this.ready) return false;
    return !!this._path(this._entry(text, o), o);
  },

  _voiceKey(o = {}) {
    const g = o.gender || (typeof Speech !== 'undefined' ? Speech._forceGender : '') || 'female';
    return g === 'male' ? 'male' : 'female';
  },

  /* 【2026-10-22 缩小音频包】单词只保留女声（男声在正常背单词链路里不会被请求，
   * 删掉省 57.6MB；句子仍保留男女声给听力对话）。这里做「缺声道回退」：
   * 请求 male 但条目没有 male 时退回 female，绝不能返回空路径导致静音。*/
  _path(entry, o = {}) {
    if (!entry) return '';
    const key = this._voiceKey(o);
    return entry[key] || entry.female || entry.male || '';
  },

  /** 真正调用原生播放并等待 audioEvent 结算（say / playPath 共用）
   * opts.filePath: 用插件 filePath 通道（本地 TTS 合成出的绝对路径 wav）。
   * opts.timeoutMs: 看门狗；本地长句可能 >30s，调用方按文本长度给预算。*/
  _play(path, o = {}, opts = {}) {
    const plugin = this._plugin();
    if (!plugin || !path) return Promise.resolve(null);
    /* 【吞音修复 2】只有真的在播时才 stop；顺序播放（上一句已 end）时不要再 stop→play，
     * 否则会把刚起播的播放器/音频焦点打断，听感就是句首被吞。
     * 有在播时也等原生 stop 完成后再 play，避免 stop 晚到把新播放器掐掉。*/
    const prev = this._current;
    const stopDone = prev ? Promise.resolve(plugin.stop()).catch(() => null) : Promise.resolve();
    if (prev && prev.resolve) prev.resolve(null);
    return stopDone.then(() => new Promise(resolve => {
      const id = String(++this._seq);
      this.lastPath = path;
      const speed = Math.max(0.5, Math.min(2.0, Number(o.rate) || 1));
      const timeoutMs = Math.max(20000, Math.min(180000, Number(opts.timeoutMs) || 30000));
      const payload = opts.filePath ? { filePath: path, speed, id } : { path, speed, id };
      const timer = setTimeout(() => {
        if (this._current && this._current.id === id) {
          this._current = null; this.playing = false;
          this.error = 'play timeout';
          resolve(null);
        }
      }, timeoutMs);
      this._current = { id, resolve, o, timer, path };
      this.playing = true;
      plugin.play(payload).catch(err => {
        clearTimeout(timer);
        this._current = null; this.playing = false;
        this.error = (err && err.message) || String(err);
        resolve(null);
      });
    }));
  },

  say(text, o = {}) {
    const entry = this._entry(text, o);
    const path = this._path(entry, o);
    if (!path) return Promise.resolve(null);
    return this._play(path, o);
  },

  /** 播放一个原生文件路径（本地 TTS 合成 WAV 用；AudioPackPlugin 的 filePath 通道）
   * 事件与 AudioPack.say 完全一致：onstart/onend/onerror，stop 时结算。*/
  playPath(filePath, o = {}) {
    return this._play(filePath, o, { filePath: true, timeoutMs: o.timeoutMs });
  },

  stop() {
    const cur = this._current;
    this._current = null;
    this.playing = false;
    if (cur) { clearTimeout(cur.timer); if (cur.resolve) cur.resolve(null); }
    const plugin = this._plugin();
    if (plugin) { try { plugin.stop(); } catch (e) { /* ignore */ } }
  },

  async init() {
    const plugin = this._plugin();
    if (!plugin) return;
    try {
      await plugin.addListener('audioEvent', ev => {
        const cur = this._current;
        if (!cur || !ev || String(ev.id) !== cur.id) return;
        if (ev.type === 'start') {
          if (typeof cur.o.onstart === 'function') { try { cur.o.onstart({}); } catch (e) {} }
          return;
        }
        clearTimeout(cur.timer);
        this._current = null; this.playing = false;
        if (ev.type === 'error') {
          this.error = ev.error || 'audio error';
          if (typeof cur.o.onerror === 'function') { try { cur.o.onerror({ error: this.error }); } catch (e) {} }
          cur.resolve(null);
        } else {
          if (typeof cur.o.onend === 'function') { try { cur.o.onend({}); } catch (e) {} }
          cur.resolve(undefined);
        }
      });
    } catch (e) { this.error = e && e.message || String(e); }
    this.load();
  },
};

if (typeof window !== 'undefined') {
  window.AudioPack = AudioPack;
  AudioPack.init();
}
