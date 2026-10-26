/* 本地 TTS 试验：sherpa-onnx VITS VCTK，合成 WAV 后交给 AudioPackPlugin 播放 */
const LocalTts = {
  _plugin() {
    const Cap = typeof window !== 'undefined' ? window.Capacitor : null;
    const native = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
    return native && Cap.Plugins && Cap.Plugins.LocalTts ? Cap.Plugins.LocalTts : null;
  },
  ready() { return !!this._plugin(); },
  async init() {
    const p = this._plugin();
    if (!p) return null;
    try { return await p.init(); } catch (e) { return { ok: false, error: e.message }; }
  },

  /* VITS/VCTK 的 lexicon 不处理阿拉伯数字；先把年份/数字/常见缩写读成英文。
   * 例如 2030 -> twenty thirty, 3.14 -> three point one four, AI -> A I。*/
  _numWords(n) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 0) return String(n);
    const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
    const tens = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + this._numWords(n % 100) : '');
    const units = [['billion', 1000000000], ['million', 1000000], ['thousand', 1000]];
    for (const [name, value] of units) {
      if (n >= value) return this._numWords(Math.floor(n / value)) + ' ' + name + (n % value ? ' ' + this._numWords(n % value) : '');
    }
    return String(n);
  },
  _yearWords(n) {
    n = Number(n);
    if (n >= 2000 && n < 2100) {
      const low = n % 100;
      if (low === 0) return this._numWords(Math.floor(n / 100)) + ' hundred';
      if (low < 10) return this._numWords(Math.floor(n / 100)) + ' oh ' + this._numWords(low);
      return this._numWords(Math.floor(n / 100)) + ' ' + this._numWords(low);
    }
    if (n >= 1900 && n < 2000) {
      const low = n % 100;
      if (low === 0) return this._numWords(Math.floor(n / 100)) + ' hundred';
      return this._numWords(Math.floor(n / 100)) + ' ' + this._numWords(low);
    }
    return this._numWords(n);
  },
  normalize(text) {
    let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    // common abbreviations
    s = s.replace(/\bAI\b/g, 'A I').replace(/\bCET[- ]?([46])\b/gi, 'C E T $1')
      .replace(/\b([A-Z])\.([A-Z])\./g, '$1 $2');
    // percentages / money
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => (n.includes('.') ? this._decimalWords(n) : this._numWords(n)) + ' percent');
    s = s.replace(/\$\s*(\d+(?:\.\d+)?)/g, (_, n) => (n.includes('.') ? this._decimalWords(n) : this._numWords(n)) + ' dollars');
    // years first (1900-2099)
    s = s.replace(/\b(19\d{2}|20\d{2})\b/g, (_, n) => this._yearWords(+n));
    // decimals
    s = s.replace(/\b(\d+)\.(\d+)\b/g, (_, a, b) => this._numWords(+a) + ' point ' + [...b].map(d => ['zero','one','two','three','four','five','six','seven','eight','nine'][+d] || d).join(' '));
    // remaining integers
    s = s.replace(/\b\d+\b/g, n => this._numWords(+n));
    return s.replace(/\s+/g, ' ').trim();
  },
  _decimalWords(n) {
    const [a, b] = String(n).split('.');
    return this._numWords(+a || 0) + ' point ' + [...(b || '')].map(d => ['zero','one','two','three','four','five','six','seven','eight','nine'][+d] || d).join(' ');
  },
  async synthesize(text, voice = 'ryan') {
    const p = this._plugin();
    if (!p) throw new Error('当前不是安装版，LocalTts 不可用');
    const normalized = this.normalize(text);
    return p.synthesize({ text: normalized, voice: String(voice || 'ryan') });
  },
  async play(path, speed = 1.0) {
    const Cap = window.Capacitor;
    const audio = Cap && Cap.Plugins && Cap.Plugins.AudioPack;
    if (!audio) throw new Error('AudioPack 插件不可用');
    return audio.play({ filePath: path, speed: Number(speed) || 1.0, id: String(Date.now()) });
  },
};
window.LocalTts = LocalTts;