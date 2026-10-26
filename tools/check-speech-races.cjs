const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = process.argv[2] || path.join(__dirname, '..', 'js', 'speech.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeSpeech(options = {}) {
  const spoken = [];
  let current = null;
  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => [{ name: 'English', lang: 'en-US' }],
    speak(u) {
      /* 静音预热不参与竞态状态机与计数 */
      if (!String(u.text == null ? '' : u.text).trim()) { setTimeout(() => u.onend?.({}), 1); return; }
      spoken.push(u);
      current = u;
      this.speaking = true;
      u.onstart?.({});
    },
    cancel() {
      const old = current;
      current = null;
      this.speaking = false;
      this.pending = false;
      if (old && options.lateCancelCallback) {
        setTimeout(() => old.onerror?.({ error: 'canceled' }), 20);
      }
    },
  };
  const ctx = vm.createContext({
    window: { speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    Store: { d: { settings: { speechEngine: 'system' } } },
    App: { toast() {}, modal() {} },
    document: { addEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Math, console,
  });
  vm.runInContext(fs.readFileSync(source, 'utf8'), ctx, { filename: source });
  const S = vm.runInContext('Speech', ctx);
  /* 本套验证的是**停止/竞态**语义，不是"首次朗读的冷启动策略"（静音预热 + 首次额外等待，
   * 由 check-speech-cloud 的专项用例覆盖）。先把首次标记置位，免得 300ms 预热混进竞态窗口。*/
  S._warmedUp = true; S._spokeAny = true;
  return { Speech: S, synth, spoken };
}

async function main() {
  {
    const { Speech, spoken } = makeSpeech();
    const first = Speech.speakWord('old');
    assert.equal(Speech.stopIfBusy(), true, 'pre-roll request counts as busy');
    assert.equal(await Promise.race([first.then(() => 'resolved'), sleep(100).then(() => 'timeout')]), 'resolved',
      'stop must settle the active request even if the engine gives no callback');
    await sleep(250);
    assert.equal(spoken.length, 0, 'a stopped pre-roll must never speak later');
  }
  {
    const { Speech, spoken } = makeSpeech({ lateCancelCallback: true });
    const first = Speech.speakWord('old');
    await sleep(70);
    assert.equal(spoken.length, 1);
    Speech.stop();
    const second = Speech.speakWord('new');
    await sleep(60);
    assert.equal(Speech._busy, true, 'late callback from old request must not unlock new request');
    assert.equal(Speech.diag.filter(x => x.text === 'old').length, 1,
      'canceled request must be recorded once');
    Speech.stop();
    await Promise.all([first, second]);
  }
  {
    const { Speech, spoken } = makeSpeech();
    const requests = [];
    for (let i = 0; i < 20; i++) {
      Speech.stopIfBusy();
      requests.push(Speech.speakWord('word' + i));
      await sleep(5);
    }
    await sleep(250);
    assert.deepEqual(spoken.map(u => u.text), [' word19'],
      'rapid card changes must leave only the newest word audible');
    assert.ok(Speech.diag[0].waitMs < 300, 'the final word must not inherit earlier queue delays');
    Speech.stop();
    await Promise.all(requests);
  }
  console.log('PASS speech cancellation races');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
