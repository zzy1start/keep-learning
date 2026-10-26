/* ============ native-tts.js : Capacitor Android 原生 TTS 桥 ============
 * Android WebView 的 Web Speech 支持不可靠；在 Capacitor 原生环境里用
 * 最小插件 Tts 提供 speechSynthesis 的兼容层，原有 speech.js 不改调用方式。
 * 非 Capacitor 环境直接返回，不影响 PWA/桌面浏览器。
 */
(function () {
  try {
    const Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
    const Tts = Cap.Plugins && Cap.Plugins.Tts;
    if (!Tts) return;

    let seq = 0;
    let voices = [];
    let queue = [];
    let current = null;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices() { return voices.slice(); },
      speak(u) { if (!u) return; queue.push(u); pump(); },
      cancel() {
        queue = [];
        current = null;
        synth.speaking = false;
        synth.pending = false;
        try { Tts.stop(); } catch (e) { /* ignore */ }
      },
      pause() { synth.paused = true; },
      resume() { synth.paused = false; },
    };

    class Utterance {
      constructor(text) {
        this.text = String(text == null ? '' : text);
        this.lang = 'en-US';
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onboundary = null;
        this._id = ++seq;
      }
    }

    function fire(u, type, err) {
      try {
        const fn = u && u['on' + type];
        if (typeof fn === 'function') fn(err || { type, utterance: u });
      } catch (e) { /* ignore */ }
    }

    function finish(u, type, err) {
      synth.speaking = false;
      synth.pending = queue.length > 0;
      if (current === u) current = null;
      fire(u, type, err);
      if (type !== 'error') pump();
    }

    async function pump() {
      if (current || !queue.length) return;
      const u = queue.shift();
      current = u;
      synth.pending = queue.length > 0;
      const attempt = async (n) => {
        try {
          await Tts.speak({
            text: u.text,
            rate: Math.max(0.1, Number(u.rate) || 1),
            pitch: Math.max(0.1, Number(u.pitch) || 1),
            lang: u.lang || 'en-US',
            voice: u.voice && (u.voice.voiceURI || u.voice.name) || '',
            id: u._id,
          });
        } catch (e) {
          if (current !== u) return;
          /* Android TextToSpeech 启动是异步的：刚进入页面时可能 "not ready"，
           * 先重试几次，不要直接静音。*/
          if (n < 12) {
            setTimeout(() => { if (current === u) attempt(n + 1); }, 250);
            return;
          }
          window.__nativeTtsError = (e && e.message) || String(e);
          if (typeof App !== 'undefined' && App.toast && !window.__nativeTtsErrShown) {
            window.__nativeTtsErrShown = true;
            App.toast('原生语音引擎未就绪：' + window.__nativeTtsError + '；请检查系统文字转语音设置', 'err');
          }
          finish(u, 'error', { error: window.__nativeTtsError });
        }
      };
      attempt(0);
    }

    try {
      Tts.addListener('ttsEvent', (ev) => {
        if (!current || !ev || ev.id !== current._id) {
          if (ev && ev.type === 'start' && !current) synth.speaking = true;
          return;
        }
        if (ev.type === 'start') {
          synth.speaking = true;
          fire(current, 'start');
        } else if (ev.type === 'end') {
          finish(current, 'end');
        } else if (ev.type === 'error') {
          finish(current, 'error', { error: ev.error || 'tts error' });
        }
      });
    } catch (e) { /* ignore */ }

    async function loadVoices() {
      try {
        const r = await Tts.getVoices();
        if (r && Array.isArray(r.voices)) {
          voices = r.voices.map((v, i) => ({
            name: v.name || ('Android voice ' + (i + 1)),
            lang: v.lang || 'en-US',
            voiceURI: v.voiceURI || v.name || '',
            localService: v.local !== false,
            default: i === 0,
          }));
          if (typeof synth.onvoiceschanged === 'function') synth.onvoiceschanged();
        }
      } catch (e) { /* ignore */ }
    }

    window.__nativeTts = true;
    try {
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true, writable: true });
    } catch (e) { try { window.SpeechSynthesisUtterance = Utterance; } catch (e2) {} }
    try {
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
    } catch (e) { try { window.speechSynthesis = synth; } catch (e2) {} }
    loadVoices();
    setInterval(loadVoices, 400);
    setTimeout(loadVoices, 1200);
  } catch (e) { console.warn('native-tts init fail', e); }
})();
