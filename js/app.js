/* ============ app.js : 路由与启动 ============ */
App.views = {
  // 图标：Lucide「languages」（ISC 许可）——比原先的「文A + 双向箭头」在 26px 下更清晰
  translation: { title: '翻译', ic: '<path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>', view: () => ViewTranslate },
  home: { title: '首页', ic: '<path d="M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>', view: () => ViewHome },
  vocab: { title: '单词', ic: '<path d="M4 5a2 2 0 012-2h9a2 2 0 012 2v14a2 2 0 00-2-2H6a2 2 0 00-2 2V5z"/><path d="M20 5a2 2 0 00-2-2h-1v16h1a2 2 0 012 2V5z"/>', view: () => ViewVocab },
  listening: { title: '听力', ic: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>', view: () => ViewListen },
  writing: { title: '写作', ic: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>', view: () => ViewWrite },
  reading: { title: '阅读', ic: '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>', view: () => ViewRead },
  notebook: { title: '生词本', ic: '<path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/>', view: () => ViewNotebook },
  stats: { title: '统计', ic: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', view: () => ViewStats },
  settings: { title: '设置', ic: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>', view: () => ViewSettings },
  // 手机端两个聚合页：底部 Tab 只有 5 个位置，9 个入口需要合并
  practice: { title: '读写', ic: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>', view: () => ViewPractice },
  me: { title: '我的', ic: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>', view: () => ViewMe },
};

/* 手机底部导航：把 9 个页面合并成 5 组 */
App.mobileTabs = [
  { k: 'home', t: '今日', ic: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1z"/>' },
  { k: 'vocab', t: '单词', ic: '<path d="M4 5a2 2 0 012-2h9a2 2 0 012 2v14a2 2 0 00-2-2H6a2 2 0 00-2 2z"/><path d="M20 5a2 2 0 00-2-2h-1v16h1a2 2 0 012 2V5z"/>' },
  { k: 'listening', t: '听力', ic: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>' },
  { k: 'practice', t: '读写', ic: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>' },
  { k: 'me', t: '我的', ic: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>' },
];

/* 当前页面应该高亮哪个 Tab */
App.tabOf = function (name) {
  if (name === 'reading' || name === 'writing' || name === 'translation') return 'practice';
  if (name === 'notebook' || name === 'stats' || name === 'settings' || name === 'me') return 'me';
  return name;
};

App.buildTabBar = function () {
  const tb = $('#tabBar');
  if (!tb) return;
  tb.innerHTML = App.mobileTabs.map(t =>
    '<button data-nav="' + t.k + '"><svg viewBox="0 0 24 24" class="ic">' + t.ic + '</svg><span>' + t.t + '</span></button>'
  ).join('');
  on(document, 'click', '#tabBar [data-nav]', (e, t) => App.go(t.dataset.nav));
};

App.cur = 'home';

App.go = function (name, params) {
  if (!App.views[name]) name = 'home';
  App.cur = name;
  location.hash = '#/' + name + (params && params.book ? '/' + params.book : '');
  App.render(params);
};

/**
 * 渲染失败时把错误显示出来，并给一个可点的出口。
 *
 * 【为什么不能直接用 App.render 手里的 root】每个视图的 render() 第一行都调用
 * App.freshView()，而它会把旧 #view **整个换成新节点** —— 此时 App.render 局部变量
 * root 已经是被替换掉的游离节点。往游离节点里写"页面出错"，用户看到的是**空白页**
 * （新 #view 是空的，连加载动画都没有）。这正是"统计点不开"以及
 * "数据管理→学习报告 PDF 点了没反应"（找不到统计页的导出按钮）的共同成因。
 * 所以这里重新取当前真实存在的 #view 再写。
 */
App.renderError = function (title, err, fallbackRoot) {
  const live = document.getElementById('view') || fallbackRoot;
  if (!live) return;
  live.innerHTML = `<div class="card" style="padding:24px"><b>${esc(title)}</b>
    <div class="hint" style="margin-top:8px">${esc((err && err.message) || err)}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn btn-pri" onclick="location.reload()">刷新重试</button>
      <button class="btn btn-gh" onclick="location.hash='#/home'">回首页</button>
    </div></div>`;
  console.error(err);
};

App.render = function (params) {
  Speech.stop();
  App.resetPageTimer();          // 换页重置停留计时，供树园统计时长
  const conf = App.views[App.cur];
  const root = $('#view');
  // 导航高亮
  $$('#sbNav .sb-item').forEach(b => b.classList.toggle('on', b.dataset.nav === App.cur));
  $$('#sbFoot .sb-item').forEach(b => b.classList.toggle('on', b.dataset.nav === App.cur));
  const tabNow = App.tabOf(App.cur);
  $$('#tabBar [data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === tabNow));
  root.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    const V = conf.view();
    const r = V.render(root, params || {});
    if (r && typeof r.then === 'function') r.catch(err => App.renderError('页面加载失败', err, root));
  } catch (err) {
    App.renderError('页面出错', err, root);
  }
  const sc = root.parentElement || $('.main');
  if (sc) sc.scrollTop = 0;
};

App._nav = function () {
  const h = location.hash.replace('#/', '');
  const [name, arg] = h.split('/');
  if (!App.views[name]) { location.hash = '#/home'; return; }
  if (name !== App.cur) { App.cur = name; App.render(arg ? { book: arg } : null); }
};

window.addEventListener('hashchange', App._nav);

/* ---------- 启动 ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  /* PWA：尽早注册 Service Worker。
   * 原来放在启动流程最后，要等词库+词书几十 MB 加载完才注册，安装入口和离线缓存都太晚。
   * 只在安全上下文注册（https / localhost）；局域网 http://IP 静默跳过。*/
  try {
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!native && 'serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker 注册失败', err));
    }
  } catch (e) { console.warn('Service Worker 不可用', e); }

  Store.load();
  /* 【P0 存量修复 2026-10-29】旧版"首次组轮就把整本词书每个词写成状态"，会把 localStorage
   * 撑到 5MB 配额以上，之后学习进度静默不落盘。启动时一次性裁掉从未作答、无层级/时间记录的
   * 默认状态；新词现在改为惰性创建（见 vocab-engine.ensurePlacementLevel），不会回涨。*/
  try {
    if (typeof VocabEngine !== 'undefined' && VocabEngine.pruneEmptyStates) {
      const pruned = VocabEngine.pruneEmptyStates({ store: Store });
      if (pruned) console.log('[vocab] pruned empty states:', pruned);
    }
  } catch (e) { console.warn('vocab prune fail', e); }
  App.applyTheme(Store.d.settings.theme);
  /* 【为什么要再 init 一次】speech.js 自己的 DOMContentLoaded 比这里更早触发，
   * 那时 Store.d 还是 null —— "非 Edge 也允许云端音色"这个设置读不到（非 Edge 用户
   * 会被误判成未放行，音色列表里永远没有云端音色）。存档读完后再按真实设置刷一次。*/
  try { Speech.init(); } catch (e) { console.warn('speech init fail', e); }

  // 侧边导航（首页在最上，翻译在最后）
  const nav = $('#sbNav'), foot = $('#sbFoot');
  nav.innerHTML = ['home', 'vocab', 'listening', 'writing', 'reading', 'translation'].map(k => {
    const v = App.views[k];
    return `<button class="sb-item" data-nav="${k}">
      <svg viewBox="0 0 24 24" class="ic">${v.ic}</svg><span>${v.title}</span></button>`;
  }).join('');
  const bind = () => {
    on(document, 'click', '.sb-item', (e, t) => App.go(t.dataset.nav));
  };
  bind();
  $('#btnCollapse').onclick = () => document.body.classList.toggle('sb-min');
  App.buildTabBar();

  // 加载词库
  try {
    await Dict.boot();
    /* 只取各词书 index 里的 total 显示容量，不在这里加载全部单词：
     * 五本词书合计约 13MB，全部预加载会让首屏/PWA 安装等很久；
     * 单词页会自己 await Dict.load(当前词书)。*/
    for (const b of BOOKS) {
      fetch(`data/${b.id}/index.json`).then(r => r.json())
        .then(d => { b.size = (d.total || 0) + ' 词'; })
        .catch(() => {});
    }
  } catch (e) {
    console.error('dict load fail', e);
    App.toast('词库加载失败，请确认通过本地服务器打开（见 README）', 'err');
  }

  // 初始路由
  const h = location.hash.replace('#/', '');
  const [nm, arg] = h.split('/');
  if (nm && App.views[nm]) { App.cur = nm; App.render(arg ? { book: arg } : null); }
  else App.go('home');

  // 启动欢迎弹窗（每次打开都弹，可勾选"不再提示"）
  // 放在路由渲染之后：此时词库已就绪、页面已可交互，弹窗内容才准确
  {
    const isFirst = !(Store.d.stats.days || []).length;
    const showWelcome = () => {
      try { Welcome.show(isFirst); } catch (e) { console.warn('welcome fail', e); }
    };
    if (Welcome.shouldShow()) setTimeout(showWelcome, 480);
    // 勾选了「不再提示」就尊重用户，不再弹；可在设置页恢复
    App.showWelcome = showWelcome;                  // 设置页恢复提示用
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
    if (Store.d.settings.theme === 'auto') App.applyTheme('auto');
  });

});