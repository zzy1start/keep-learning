/* ============ core.js : 全局工具 ============ */
const App = {};
window.App = App;

/* ---- DOM 助手 ---- */
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function el(tag, attrs = {}, html = '') {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'style') n.style.cssText = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (html) n.innerHTML = html;
  return n;
}
/** HTML 转义，所有用户/题库文本插入 DOM 前必须过一遍 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** 事件委托 */
function on(root, evt, sel, fn) {
  root.addEventListener(evt, e => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  });
}

/**
 * 关键：重渲染前必须调用。
 * 各视图用事件委托绑定在容器上，若只替换 innerHTML 而不替换节点，
 * 旧监听器会持续累积，导致一次点击触发多次。故每次渲染都换一个干净节点。
 */
App.freshView = () => {
  const old = document.getElementById('view');
  const n = document.createElement('div');
  n.className = 'view';
  n.id = 'view';
  old.replaceWith(n);
  return n;
};

/** 同 freshView，但针对容器内部的某个子节点（用于局部重渲染区域） */
App.freshNode = (sel, root = document) => {
  const old = $(sel, root);
  if (!old) return null;
  const n = old.cloneNode(false);   // 不复制子节点与监听器
  old.replaceWith(n);
  return n;
};

/* ---- Toast ---- */
App.toast = (msg, type = '') => {
  const w = $('#toastWrap');
  const t = el('div', { class: 'toast ' + type }, esc(msg));
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; t.style.transition = '.3s'; }, 2200);
  setTimeout(() => t.remove(), 2600);
};

/* ---- Modal ---- */
App.modal = (title, bodyHTML, onMount) => {
  const mask = $('#modalMask'), box = $('#modal');
  box.innerHTML = `<div class="modal-h">${esc(title)}<button class="x" data-x>&times;</button></div><div class="modal-b">${bodyHTML}</div>`;
  mask.classList.add('on');
  box.querySelector('[data-x]').onclick = App.closeModal;
  mask.onclick = e => { if (e.target === mask) App.closeModal(); };
  if (onMount) onMount(box.querySelector('.modal-b'), box);
  return box;
};
App.closeModal = () => $('#modalMask').classList.remove('on');
App.confirm = (msg, onYes) => {
  /* white-space:pre-line：确认文案里的换行不再被 HTML 折叠成空格（P2 修复） */
  App.modal('确认', `<p style="line-height:1.8;white-space:pre-line">${esc(msg)}</p>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn btn-gh" data-x>取消</button>
      <button class="btn btn-dan" id="cfmYes">确定</button></div>`,
    (b) => { b.querySelector('[data-x]').onclick = App.closeModal; b.querySelector('#cfmYes').onclick = () => { App.closeModal(); onYes && onYes(); }; });
};

/* ---- 格式化 ----
 * 【2026-11-14】统一走 App.now()：测试可以替换时钟，线上仍返回 new Date()。
 * 之前各模块到处 new Date()，连续天数却用 UTC 的 toISOString 算“昨天”，
 * 在东八区 00:00–08:00 会把昨天算成前天（详见 docs/53）。*/
App.now = () => new Date();
App.fmtDate = (d = App.now()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
App.fmtTime = (d = App.now()) => {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
App.fmtDT = (d = App.now()) => App.fmtDate(d) + ' ' + App.fmtTime(d);
App.mmss = sec => {
  sec = Math.max(0, Math.round(sec));
  const p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 60))}:${p(sec % 60)}`;
};
App.today = () => App.fmtDate(App.now());
/** 把 YYYY-MM-DD 解析为“本地日历”的 00:00，绝不经 UTC 往返 */
App.parseDay = key => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key == null ? '' : key));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
};
/** 日期键平移 N 天（负数为向前），按本地日历算，跨月/跨年安全 */
App.shiftDay = (key, delta) => {
  const d = App.parseDay(key) || App.now();
  d.setDate(d.getDate() + (Number(delta) || 0));
  return App.fmtDate(d);
};

/* ---- 打乱 ---- */
App.shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
App.pick = (arr, n) => App.shuffle(arr).slice(0, n);

/* ---- 防抖 ---- */
App.debounce = (fn, ms = 350) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ---- 主题 ---- */
App.applyTheme = mode => {
  if (mode === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme:dark)').matches;
    document.body.classList.toggle('dark', dark);
  } else document.body.classList.toggle('dark', mode === 'dark');
};

/* ---- 平台判断 ---- */
App.isNative = () => {
  const Cap = window.Capacitor;
  return !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
};

/* ---- 导出 ---- */
App.download = async (blob, name) => {
  /* Android Capacitor WebView 里 a[download] 不会触发系统下载；
   * 用 Filesystem 写入缓存目录，再调系统分享/保存面板。*/
  try {
    const Cap = window.Capacitor;
    const Fs = Cap && Cap.Plugins && Cap.Plugins.Filesystem;
    const Share = Cap && Cap.Plugins && Cap.Plugins.Share;
    if (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Fs && Share) {
      const base64 = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => {
          const s = String(rd.result || '');
          resolve(s.slice(s.indexOf(',') + 1));
        };
        rd.onerror = () => reject(rd.error || new Error('read blob failed'));
        rd.readAsDataURL(blob);
      });
      const saved = await Fs.writeFile({ path: name, data: base64, directory: 'CACHE', recursive: true });
      App.toast('已生成 ' + name + '，在系统分享面板里保存即可', 'ok');
      try {
        await Share.share({ title: name, url: saved.uri });
      } catch (e) {
        /* 用户在分享面板点取消：这不是错误，别再抛到 console 里吓人。*/
        const msg = String((e && (e.message || e.errorMessage)) || e || '');
        if (/cancel/i.test(msg)) { App.toast('已取消保存', ''); return false; }
        throw e;
      }
      return true;
    }
  } catch (e) {
    const msg = String((e && (e.message || e.errorMessage)) || e || '');
    if (/cancel/i.test(msg)) { App.toast('已取消保存', ''); return false; }
    console.warn('native export failed, fallback to download', e);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};

/* ---- 环形进度 ---- */
App.ring = (pct, size = 96, color = 'var(--pri)') => {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
      style="transition:stroke-dashoffset .6s"/></svg>`;
};

/* ---- 分词（阅读划词用）---- */
App.words = txt => (txt.toLowerCase().match(/[a-z][a-z'-]*/g) || []);

/* ---- 生词来源标签统一 ----
 * 历史上阅读页有两个入口：点击单词浮层的「+生词本」（阅读划词）和划线分析面板的
 * 「+ 生词本」（阅读划线）。两者是同一个动作，导出标题会并排出现两个几乎一样的标签。
 * 统一显示为「阅读划词」，历史数据在展示时归一，不改存档。*/
App.nbTag = tag => {
  const s = String(tag == null ? '' : tag).trim();
  if (!s) return '手动';
  if (s === '阅读' || s === '阅读划线' || s === '阅读划词') return '阅读划词';
  return s;
};

/* ---- 简易柱状图 ---- */
/* ---- 页面停留计时（供树园评估学习时长）---- */
App.pageT0 = Date.now();
App.resetPageTimer = () => { App.pageT0 = Date.now(); };
App.pageSeconds = () => Math.round((Date.now() - (App.pageT0 || Date.now())) / 1000);

App.bars = (data, h = 74) => {
  const max = Math.max(1, ...data.map(d => d.v));
  return `<div style="display:flex;align-items:flex-end;gap:${Math.max(2, 100 / data.length / 2.6)}%;height:${h}px">
    ${data.map(d => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end">
      <div style="font-size:10.5px;color:var(--tx3);font-weight:600">${d.v || ''}</div>
      <div title="${esc(d.k)}:${d.v}" style="width:100%;max-width:26px;height:${Math.max(3, d.v / max * (h - 26))}px;
        border-radius:4px 4px 2px 2px;background:${d.v ? 'linear-gradient(180deg,#4d85ff,#2f6bff)' : 'var(--line)'}"></div>
      <div style="font-size:10.5px;color:var(--tx3)">${esc(d.k)}</div></div>`).join('')}
  </div>`;
};