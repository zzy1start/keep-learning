const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = process.argv[2] || path.join(__dirname, '..', 'js', 'speech.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function load(mode) {
  const calls = [];
  let active = null;
  let starts = 0;
  let resumes = 0;
  let warnings = 0;
  const synth = {
    speaking: mode === 'ghost', pending: false, paused: mode === 'paused',
    getVoices: () => [{ name: 'English Test', lang: 'en-US' }],
    speak(u) {
      /* 静音预热不参与状态机与计数 */
      if (!String(u.text == null ? '' : u.text).trim()) { setTimeout(() => u.onend?.({}), 1); return; }
      calls.push(u);
      if (this.speaking || this.paused || mode === 'silent' || (mode === 'bad-voice' && u.voice)) return;
      active = u;
      this.speaking = true;
      starts++;
      setTimeout(() => u.onstart?.({}), 3);
      setTimeout(() => { this.speaking = false; u.onend?.({}); }, 12);
    },
    cancel() {
      const old = active;
      active = null;
      this.speaking = false;
      this.pending = false;
      if (old) setTimeout(() => old.onerror?.({ error: 'canceled' }), 3);
    },
    resume() { resumes++; this.paused = false; },
  };
  const ctx = vm.createContext({
    window: { speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    Store: { d: { settings: { speechEngine: 'system' } } },
    App: { toast() { warnings++; }, modal() {} }, document: { addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Math, console,
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), ctx, { filename: source });
  const Speech = vm.runInContext('Speech', ctx);
  /* 同上：本套测"残影/暂停状态清理"，不是首次冷启动策略（由 check-speech-cloud 覆盖） */
  Speech._warmedUp = true; Speech._spokeAny = true;
  Speech.START_TIMEOUT_MS = 55;
  Speech.SETTLE_MS = 30;
  return { Speech, synth, calls, get starts() { return starts; }, get resumes() { return resumes; }, get warnings() { return warnings; } };
}

async function main() {
  {
    const t = load('normal');
    t.Speech.init();
    assert.equal(t.calls.length, 0, 'page initialization must not queue a pre-gesture silent utterance');
  }
  {
    const t = load('ghost');
    await Promise.race([t.Speech.speakWord('hello'), sleep(600).then(() => { throw Error('timeout'); })]);
    assert.equal(t.starts, 1, 'orphaned speaking state must be cleared before actual speech');
    assert.equal(t.Speech.diag[0].why, 'end');
    assert.ok(t.Speech.diag[0].waitMs < 100, 'ghost cleanup should not wait for no-start watchdog');
  }
  {
    const t = load('paused');
    await Promise.race([t.Speech.speakWord('hello'), sleep(600).then(() => { throw Error('timeout'); })]);
    assert.equal(t.starts, 1, 'paused synthesis must be resumed before actual speech');
    assert.ok(t.resumes >= 1);
  }
  {
    const t = load('bad-voice');
    await Promise.race([t.Speech.speakWord('hello'), sleep(600).then(() => { throw Error('timeout'); })]);
    assert.equal(t.starts, 1, 'no-start should retry once with browser default voice');
    assert.equal(t.calls.length, 2);
    assert.equal(t.Speech.diag[0].why, 'end');
  }
  {
    const t = load('silent');
    await Promise.race([t.Speech.speakWord('hello'), sleep(600).then(() => { throw Error('timeout'); })]);
    assert.equal(t.calls.length, 2, 'permanent no-start should retry only once');
    assert.equal(t.Speech.diag[0].why, 'no-start');
    assert.equal(t.Speech.diag[0].retries, 1);
    assert.equal(t.warnings, 1, 'silent failure must give the user a visible message');
  }
  console.log('PASS no-start recovery');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
