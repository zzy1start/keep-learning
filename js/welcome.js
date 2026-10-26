/* ============ welcome.js : 启动欢迎弹窗 ============
 *
 * 每次打开应用都弹出，底部可勾选「不再提示」——勾选后写入 localStorage，
 * 之后不再打扰（设置页可恢复）。
 *
 * 署名说明：仅署名创作者本人 + 协作方式，不做多余修饰。
 */
const Welcome = {
  KEY_SKIP: 'keeplrn_welcome_skip',

  shouldShow() {
    try { return localStorage.getItem(this.KEY_SKIP) !== '1'; }
    catch (e) { return true; }
  },
  skip(on) {
    try {
      if (on) localStorage.setItem(this.KEY_SKIP, '1');
      else localStorage.removeItem(this.KEY_SKIP);
    } catch (e) { /* ignore */ }
  },
  isSkipped() {
    try { return localStorage.getItem(this.KEY_SKIP) === '1'; } catch (e) { return false; }
  },

  show(firstRun) {
    const st = Store.d.stats;
    const streak = st.streak || 0;
    const isReturn = !firstRun;
    // 今天是第几天
    const dayN = (st.days || []).length + (st.lastStudy === App.today() ? 0 : 1);

    const body = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
      <img src="assets/logo-lg.png" alt="" style="width:56px;height:56px;flex:none">
      <div>
        <div style="font-size:19px;font-weight:750;letter-spacing:-.3px">Keep Learning</div>
        <div style="font-size:12.5px;color:var(--tx2);margin-top:2px">
          ${isReturn
        ? `欢迎回来，今天是你连续学习的第 <b style="color:var(--pri)">${streak}</b> 天`
        : '本地英语学习工作台'}
        </div>
      </div>
    </div>

    ${isReturn ? `
    <div class="grid g3" style="gap:8px;margin-bottom:16px">
      ${[['连续学习', streak, '天'], ['累计天数', (st.days || []).length, '天'], ['生词本', Store.d.notebook.length, '词']]
      .map(([k, v, u]) => `<div class="stat" style="padding:10px 12px;text-align:center">
        <div class="k" style="justify-content:center;white-space:nowrap">${k}</div>
        <div class="v" style="font-size:19px">${v}<small>${u}</small></div>
      </div>`).join('')}
    </div>
    <div class="row" style="gap:6px;margin-bottom:16px">
      <button class="btn btn-pri" data-go="vocab" style="flex:1;justify-content:center">背单词</button>
      <button class="btn btn-gh" data-go="listening" style="flex:1;justify-content:center">练听力</button>
      <button class="btn btn-gh" data-go="reading" style="flex:1;justify-content:center">做阅读</button>
      <button class="btn btn-gh" data-go="writing" style="flex:1;justify-content:center">写作文</button>
    </div>`
        : `
    <div style="margin:6px 0 16px">
      ${[['📚 单词', '内置 CET4/6、考研、托福、SAT 词书，共 2 万余词条，遗忘曲线复习'],
      ['🎧 听力', '浏览器内置发音引擎，离线可用。「改」模式复现原文，「写」模式做听写'],
      ['📖 阅读', '做题模式计时+禁止查词；修改模式可划线、查词、长难句分析'],
      ['✍️ 写作', '四维评分、修改建议、词汇升级与范文；支持电子笔手写'],
      ['🌳 树园', '学习时长培育当前树，成熟后再种下一棵；遗忘仍会影响树木状态'],
      ['📒 生词本', '导出 PDF，含日期时间、来源标签与来源分析']]
        .map(([a, b]) => `<div style="display:flex;gap:10px;margin-bottom:8px;align-items:baseline">
          <b style="flex:none;white-space:nowrap">${a}</b>
          <span style="color:var(--tx2);font-size:12.5px;line-height:1.65">${b}</span></div>`).join('')}
    </div>
    <div class="tipbox">想要 AI 写作评分、长难句精准分析、生词在线释义？去「设置」页填一个 API Key 即可（不填也能用，只是这些功能会降级）。</div>`}

    <!-- 不再提示 -->
    <label class="row" style="gap:9px;cursor:pointer;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
      <span class="chk" id="wSkip"></span>
      <span style="font-size:13px;color:var(--tx2)">不再提示此弹窗</span>
      <span class="sp"></span>
      <span style="font-size:11.5px;color:var(--tx3)">可在设置页恢复</span>
    </label>

    <div class="row" style="margin-top:14px;gap:8px">
      <button class="btn btn-gh sp" data-x>稍后</button>
      <button class="btn btn-pri" id="wGo" style="min-width:120px">${isReturn ? '继续学习' : '开始学习'}</button>
    </div>

    <!-- 署名 -->
    <div class="welcome-sign">
      <div class="ws-line">Keep Learning 开源项目</div>
      <div class="ws-sub">与 AI 协作完成</div>
    </div>`;

    App.modal('欢迎', body, (b) => {
      const chk = $('#wSkip', b);
      chk.onclick = () => {
        const on = !chk.classList.contains('on');
        chk.classList.toggle('on', on);
        Welcome.skip(on);
      };
      $('[data-x]', b).onclick = App.closeModal;
      $('#wGo', b).onclick = () => {
        // 点击开始时才最终确认勾选状态
        Welcome.skip(chk.classList.contains('on'));
        App.closeModal();
      };
      on(b, 'click', '[data-go]', (e, t) => {
        Welcome.skip(chk.classList.contains('on'));
        App.closeModal();
        App.go(t.dataset.go);
      });
    });
  },
};
window.Welcome = Welcome;
