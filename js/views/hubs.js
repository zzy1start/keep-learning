/* ============ views/hubs.js : 手机端两个聚合页 ============
 * 底部 Tab 只有 5 个位置，所以「阅读 / 写作 / 翻译」合成「读写」，
 * 「生词本 / 统计 / 设置 / 树园」合成「我的」。
 * 两个 hub 只在手机 Tab 里作为入口，桌面侧栏仍直达原页面。
 */
const ViewPractice = {
  render(root) {
    root = App.freshView();
    const day = Store.d.stats.daily[App.today()] || {};
    root.innerHTML = `
    <div class="phead">
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
      <div><h1>读写</h1><div class="sub">阅读 · 写作 · 翻译</div></div>
    </div>

    <div class="hub-grid">
      <button class="hub-card hc-blue" data-go="reading">
        <span class="hc-en">READING</span>
        <h2>阅读</h2>
        <p>真题精读：做题计时、划词划线、长难句解析与段落翻译</p>
        <span class="hc-tags"><span>四选一</span><span>选词填空</span><span>段落匹配</span></span>
        <span class="hc-go">开始阅读 ›</span>
      </button>

      <button class="hub-card hc-amber" data-go="writing">
        <span class="hc-en">WRITING</span>
        <h2>写作</h2>
        <p>真题作文与单句：计时、四维评分、修改建议与范文</p>
        <span class="hc-tags"><span>真题作文</span><span>单句</span><span>手写</span></span>
        <span class="hc-go">开始写作 ›</span>
      </button>

      <button class="hub-card hc-mint" data-go="translation">
        <span class="hc-en">TRANSLATION</span>
        <h2>翻译</h2>
        <p>考研翻译与单句互译：自动判分、参考译文与逐句拆解</p>
        <span class="hc-tags"><span>英译汉</span><span>汉译英</span><span>自定义</span></span>
        <span class="hc-go">开始翻译 ›</span>
      </button>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="stat"><div class="k">今日阅读</div><div class="v">${day.read || 0}<small>篇</small></div></div>
      <div class="stat"><div class="k">今日写作</div><div class="v">${day.write || 0}<small>次</small></div></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-h">小提示</div>
      <div class="card-b hint" style="margin:0">
        手机上阅读与写作会把「原文 / 题目 / 评分」上下排列；横屏或平板会把它们并排显示，答案和原文可以同屏对照。
      </div>
    </div>`;

    on(root, 'click', '[data-go]', (e, t) => App.go(t.dataset.go));
  }
};

const ViewMe = {
  render(root) {
    root = App.freshView();
    const st = Store.d.stats || {};
    const days = (st.days || []).length;
    const streak = st.streak || 0;
    const nb = Store.d.notebook.length;
    root.innerHTML = `
    <div class="phead">
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></div>
      <div><h1>我的</h1><div class="sub">学习记录与设置</div></div>
    </div>

    <div class="card me-card">
      <div class="me-avatar">周</div>
      <div style="min-width:0">
        <div class="me-name">Keep Learning</div>
        <div class="me-sub">连续 ${streak} 天 · 累计 ${days} 天 · 开源项目</div>
      </div>
    </div>

    <div class="me-stats">
      <div class="stat"><div class="k">生词本</div><div class="v">${nb}<small>词</small></div></div>
      <div class="stat"><div class="k">连续</div><div class="v">${streak}<small>天</small></div></div>
      <div class="stat"><div class="k">累计</div><div class="v">${days}<small>天</small></div></div>
    </div>

    <div class="hub-list" style="margin-top:14px">
      <button class="hub-row" data-go="notebook">
        <span class="hri"><svg viewBox="0 0 24 24" class="ic"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></span>
        <span><b>生词本</b><em>收藏的单词、分类与 PDF 导出</em></span>
        <span class="hr-r">${nb} 词 <svg viewBox="0 0 24 24" class="ic"><path d="M9 18l6-6-6-6"/></svg></span>
      </button>
      <button class="hub-row" data-go="stats">
        <span class="hri"><svg viewBox="0 0 24 24" class="ic"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></span>
        <span><b>学习统计</b><em>近 7 天学习量、词书进度与学习报告</em></span>
        <span class="hr-r"><svg viewBox="0 0 24 24" class="ic"><path d="M9 18l6-6-6-6"/></svg></span>
      </button>
      <button class="hub-row" data-go="home">
        <span class="hri"><svg viewBox="0 0 24 24" class="ic"><path d="M12 22v-8"/><path d="M12 14c-4 0-7-3-7-7 4 0 7 3 7 7z"/><path d="M12 14c4 0 7-3 7-7-4 0-7 3-7 7z"/></svg></span>
        <span><b>我的树园</b><em>在首页底部，看今天种的树和保持率</em></span>
        <span class="hr-r"><svg viewBox="0 0 24 24" class="ic"><path d="M9 18l6-6-6-6"/></svg></span>
      </button>
      <button class="hub-row" data-go="settings">
        <span class="hri"><svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg></span>
        <span><b>设置</b><em>AI 配置、音色、词库与数据备份</em></span>
        <span class="hr-r"><svg viewBox="0 0 24 24" class="ic"><path d="M9 18l6-6-6-6"/></svg></span>
      </button>
    </div>

    <p class="hint" style="text-align:center;margin-top:16px;line-height:1.8">
      数据默认只保存在本机浏览器<br>可在「设置 → 数据管理」导出备份
    </p>`;

    on(root, 'click', '[data-go]', (e, t) => App.go(t.dataset.go));
  }
};
