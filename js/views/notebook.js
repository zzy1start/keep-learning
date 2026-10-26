/* ============ views/notebook.js : 生词本 ============ */
const ViewNotebook = {
  filter: 'all',     // all | new | tomorrow | mastered

  render(root) { this._shell(root); },

  open() { App.go('notebook'); },

  _shell(root) {
    root = App.freshView();
    const nb = Store.d.notebook;
    const f = this.filter;
    const list = nb.filter(x => f === 'all' ? true : f === 'mastered' ? x.mastered : f === 'tomorrow' ? x.tomorrow : !x.mastered);
    const today = nb.filter(x => x.addedAt && x.addedAt.slice(0, 10) === App.today());

    root.innerHTML = `
    <div class="phead">
      <div class="phead-ic"><svg viewBox="0 0 24 24" class="ic"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></div>
      <div>
        <h1>生词本</h1>
        <div class="sub">共 ${nb.length} 词 · 今日新增 ${today.length} 词 · 手动标记 ${nb.filter(x => x.mastered).length} 词</div>
      </div>
      <div class="phead-r">
        <button class="btn btn-gh btn-s" data-act="import">导入词表</button>
        <button class="btn btn-gh btn-s" data-act="clearMastered">清理手动标记</button>
        <button class="btn btn-pri btn-s" data-act="export">导出 PDF</button>
      </div>
    </div>

    <div class="grid g4" style="margin-bottom:14px">
      ${[['all', '全部生词', nb.length, 'var(--pri)'], ['new', '待巩固', nb.filter(x => !x.mastered).length, 'var(--warn)'],
      ['tomorrow', '明日待背', nb.filter(x => x.tomorrow && !x.mastered).length, 'var(--purple)'],
      ['mastered', '手动标记', nb.filter(x => x.mastered).length, 'var(--ok)']]
      .map(([k, t, v, c]) => `
        <div class="stat" data-f="${k}" style="cursor:pointer;${f === k ? 'border-color:' + c : ''}">
          <div class="k">${t}</div><div class="v" style="color:${c}">${v}</div></div>`).join('')}
    </div>

    <div class="card">
      <div class="card-h">词表
        <span class="r"><input class="inp" id="nbSearch" placeholder="搜索单词或释义..." style="width:200px;padding:6px 11px;font-size:12.5px"></span></div>
      <div class="card-b" id="nbList">
        ${list.length ? list.map(x => `
          <div class="nb-item ${x.mastered ? 'mastered' : ''}" data-w="${esc(x.w)}">
            <span class="w">${esc(x.w)}</span>
            <span class="cn">${esc((x.tr && x.tr[0] ? x.tr[0].d : '') || '—')}
              ${x.tr && x.tr.length > 1 ? `<span style="color:var(--tx3);font-size:12px"> / ${esc(x.tr.slice(1, 3).map(t => t.d).join(' / '))}</span>` : ''}</span>
            ${x.srcTag ? `<span class="tag ${tagCls(x.srcTag)}">${esc(x.srcTag)}</span>` : ''}
            ${x.tomorrow ? '<span class="tag tag-pur">明日背</span>' : ''}
            <span class="sp"></span>
            <button class="btn btn-xs btn-gh" data-nb="say">🔊</button>
            <button class="btn btn-xs btn-gh" data-nb="detail">详情</button>
            <button class="btn btn-xs btn-gh" data-nb="master">${x.mastered ? '取消掌握' : '标为掌握'}</button>
            <button class="btn btn-xs btn-warn" data-nb="del">删除</button>
          </div>`).join('')
        : `<div class="empty"><svg viewBox="0 0 24 24" class="ic"><path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          <p>${f === 'all' ? '生词本是空的，去阅读划线或背单词时加入吧' : '该分类下暂无单词'}</p></div>`}
      </div>
    </div>`;

    on(root, 'click', '[data-f]', (e, t) => { this.filter = t.dataset.f; this._shell($('#view')); });
    on(root, 'click', '[data-nb]', (e, t) => {
      const w = t.closest('[data-w]').dataset.w;
      const a = t.dataset.nb;
      if (a === 'say') Speech.speak(w, { rate: .85 });
      else if (a === 'del') { Store.nbRemove(w); this._shell($('#view')); App.toast('已删除'); }
      else if (a === 'master') { Store.nbToggle(w, { mastered: !Store.d.notebook.find(x => x.w === w).mastered }); this._shell($('#view')); }
      else if (a === 'detail') this._detail(w);
    });
    const sr = $('#nbSearch');
    if (sr) sr.oninput = App.debounce(() => {
      const q = sr.value.trim().toLowerCase();
      $$('#nbList .nb-item').forEach(it => {
        const w = it.dataset.w.toLowerCase();
        const cn = it.textContent.toLowerCase();
        it.style.display = (!q || w.includes(q) || cn.includes(q)) ? '' : 'none';
      });
    }, 200);

    on(root, 'click', '[data-act]', (e, t) => {
      const a = t.dataset.act;
      if (a === 'export') {
        if (!nb.length) { App.toast('生词本为空', ''); return; }
        const meta = BOOKS.find(x => x.id === Store.d.activeBook);
        PDF.openNotebookExport(nb, { bookName: (meta ? meta.name : '') + ' 等' });
      } else if (a === 'clearMastered') {
        App.confirm('清理所有「手动标记」的生词？此操作不可撤销。', () => { Store.nbClearMastered(); this._shell($('#view')); });
      } else if (a === 'import') this._import();
    });
  },

  _detail(w) {
    const it = Store.d.notebook.find(x => x.w === w);
    if (!it) return;
    App.modal(w, `<div class="wdetail">
      <div class="wdetail-head"><span class="w">${esc(it.w)}</span><span class="ph">${esc(it.ph || '')}</span>
        <button class="btn btn-xs btn-gh" id="dSay">🔊</button></div>
      <div class="sec-t">释义</div>
      ${(it.tr || []).map(t => `<div class="pos-line"><span class="t">${esc(t.t || '释义')}</span><span>${esc(t.d)}</span></div>`).join('') || '<div class="hint">无本地释义</div>'}
      ${it.phr && it.phr.length ? `<div class="sec-t">固定搭配</div><div>${it.phr.map(p => `<span class="chip" data-say="${esc(p)}">${esc(p)}</span>`).join('')}</div>` : ''}
      ${it.root ? `<div class="sec-t">词根词缀</div><div>${esc(it.root)}</div>` : ''}
      ${it.extra && it.extra.length ? `<div class="sec-t">拓展搭配</div><div>${it.extra.map(p => `<span class="chip">${esc(p)}</span>`).join('')}</div>` : ''}
      ${it.ex ? `<div class="sec-t">例句</div><div class="ex-item">${esc(it.ex)}</div>` : ''}
      <div class="sec-t">来源分析</div>
      <div class="src" style="border-left-color:var(--pri);padding-left:9px;background:var(--card2);border-radius:0 8px 8px 0;font-size:12.5px;color:var(--tx2);line-height:1.75">
        <b>来源</b>：${esc(it.srcTag || '手动添加')}<br>
        <b>时间</b>：${it.addedAt ? esc(it.addedAt.replace('T', ' ').slice(0, 16)) : '—'}<br>
        <b>分析</b>：${esc(it.origin || '')}</div>
      <div class="row" style="margin-top:16px;gap:7px">
        <button class="btn btn-gh btn-s" id="dAi">✨ AI 深度解析</button>
        <button class="btn btn-gh btn-s" id="dExport">导出这一条</button>
      </div></div>`, b => {
      on(b, 'click', '[data-say]', (e, t) => Speech.speak(t.dataset.say));
      $('#dSay', b).onclick = () => Speech.speak(it.w, { rate: .85 });
      // 单个单词直接导出，不弹日期选择（只有一天，没什么可选）
      $('#dExport', b).onclick = () => PDF.notebook([it], {});
      $('#dAi', b).onclick = async () => {
        b.querySelector('#dAi').innerHTML = '<span class="spin"></span>';
        const d = await AI.lookup(it.w, it.origin || '');
        Store.nbToggle(it.w, {
          root: d.root || it.root,
          extra: [...(it.extra || []), ...(d.collocation || [])].slice(0, 8),
          phr: [...(it.phr || []), ...(d.collocation || []).map(c => c)].slice(0, 6),
        });
        App.closeModal(); App.toast('已更新词条', 'ok');
        setTimeout(() => this._detail(it.w), 60);
      };
    });
  },

  _import() {
    App.modal('导入词表', `
      <p class="hint" style="margin-bottom:12px">支持以下格式（每行一条）：<br>
      <code style="font-size:12px">word 释义</code>　或<code style="font-size:12px">word,释义</code>　或<code style="font-size:12px">word\t释义</code><br>
      也支持 JSON 数组：<code style="font-size:12px">[{"w":"word","tr":[{"t":"n.","d":"释义"}]}]</code></p>
      <textarea class="inp" id="impText" style="min-height:180px" placeholder="abandon 放弃&#10;ability 能力&#10;..."></textarea>
      <div class="row" style="margin-top:14px;gap:8px">
        <label class="row" style="font-size:12.5px;gap:6px;cursor:pointer">
          <span class="chk on" id="chkTom"></span>标记为明日待背</label>
        <span class="sp"></span>
        <button class="btn btn-pri" id="impGo">导入</button>
      </div>`, b => {
      const c = $('#chkTom', b);
      c.onclick = () => c.classList.toggle('on');
      $('#impGo', b).onclick = () => {
        const txt = $('#impText', b).value.trim();
        if (!txt) return;
        let items = [];
        if (txt[0] === '[' || txt[0] === '{') {
          try {
            const j = JSON.parse(txt);
            items = (Array.isArray(j) ? j : [j]).map(x => ({
              w: x.w || x.word,
              tr: x.tr || [{ t: '', d: x.d || x.translation || '' }],
              phr: (x.phr || []).map(p => typeof p === 'string' ? p : `${p.p} — ${p.d}`),
            }));
          } catch (e) { App.toast('JSON 解析失败', 'err'); return; }
        } else {
          items = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const m = l.split(/[,，\t]/);
            const w = m[0].trim();
            const rest = m.slice(1).join(' ').trim();
            const d = Dict.get(w);
            return { w, tr: rest ? [{ t: '', d: rest }] : (d ? [{ t: '', d: d[1] }] : []), phr: [] };
          });
        }
        let n = 0;
        items.forEach(x => {
          if (!x.w) return;
          if (Store.nbAdd({
            w: x.w.toLowerCase(), ph: x.ph || (Dict.get(x.w) ? '/' + Dict.get(x.w)[0] + '/' : ''),
            tr: x.tr || [], phr: x.phr || [], extra: [], root: '',
            ex: '', srcTag: '导入', tomorrow: c.classList.contains('on'),
            origin: `手动导入词表，导入时间 ${App.fmtDT()}`,
          })) n++;
        });
        App.closeModal();
        App.toast(`成功导入 ${n} 个单词`, 'ok');
        this._shell($('#view'));
      };
    });
  },
};
function tagCls(t) {
  if (t.indexOf('阅读') >= 0) return 'tag-pur';
  if (t.indexOf('听力') >= 0) return 'tag-pri';
  if (t.indexOf('拼写') >= 0) return 'tag-err';
  return 'tag-warn';
}
window.ViewNotebook = ViewNotebook;