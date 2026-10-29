/* ============ views/home.js : 首页 ============ */
const ViewHome = {
  render(root) {
    root = App.freshView();
    const st = Store.d.stats;
    const day = App.today();
    const todayStat = st.daily[day] || { words: 0, listen: 0, read: 0, write: 0, min: 0 };
    /* 【口径统一】"今日新学单词"按引擎的新词计数，与词书页「今日新词 X / 目标」一致。
     * 不再用 stats.daily.words —— 那里把复习/抽检/拼写答对也累加，会出现"今日 39 词"
     * 与"每日新词目标 30"对不上的困惑（2026-10-23 用户反馈）。
     * 当前未完成轮里还没轮到的新词位要扣掉，中途退出不虚高。*/
    let todayNewWords = todayStat.words || 0;
    try {
      if (typeof VocabEngine !== 'undefined' && VocabEngine && typeof VocabEngine.load === 'function') {
        VocabEngine.load(Store);
        const vu = VocabEngine.load().user || {};
        if ((vu.dailyNewDate || '') === day) {
          let n = Math.max(0, Number(vu.dailyNewCount) || 0);
          const round = VocabEngine.load().round;
          if (round && !round.finished && Array.isArray(round.slots)) {
            n = Math.max(0, n - round.slots.filter(s => s && s.role === 'new').length);
          }
          todayNewWords = n;
        } else {
          todayNewWords = 0;
        }
      }
    } catch (e) { /* 引擎读取异常时回落旧口径，首页不能因此打不开 */ }
    const prog = {};
    BOOKS.forEach(b => {
      const p = Store.bookProgress(b.id);
      if (p.total) prog[b.id] = p;
    });
    const nb = Store.d.notebook.length;

    // 近7 天
    const recent = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const k = App.fmtDate(d);
      const s = st.daily[k] || {};
      recent.push({
        k: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        v: (s.words || 0) + (s.listen || 0) + (s.read || 0) + (s.write || 0),
      });
    }

    const mods = [
      { k: 'vocab', cls: 'm1', ic: `<path d="M4 5a2 2 0 012-2h9a2 2 0 012 2v14a2 2 0 00-2-2H6a2 2 0 00-2 2V5z"/><path d="M20 5a2 2 0 00-2-2h-1v16h1a2 2 0 012 2V5z"/><path d="M8 8h4M8 12h6"/>`,
        t: '单词', en: 'VOCABULARY' },
      { k: 'listening', cls: 'm2', ic: `<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>`, t: '听力', en: 'LISTENING' },
      { k: 'writing', cls: 'm3', ic: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>`, t: '写作', en: 'WRITING' },
      { k: 'reading', cls: 'm4', ic: `<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>`, t: '阅读', en: 'READING' },
    ];

    root.innerHTML = `
    <section class="hero">
      <div style="position:relative;z-index:1">
        <div class="d">今天是你连续学习的第 <b style="font-size:16px">${st.streak || 0}</b> 天</div>
        <div class="n">Keep <small>Learning</small></div>
        <div class="d" style="margin-top:4px">坚持一点点，离目标更近一步！</div>
      </div>
      <div class="hero-r">
        <div class="cal">
          <span class="m">${nowMonth()}</span>
          <span class="d">${new Date().getDate()}</span>
        </div>
      </div>
    </section>

    <section class="mods">
      ${mods.map(m => `
        <button class="mod ${m.cls}" data-go="${m.k}">
          <span class="mi"><svg viewBox="0 0 24 24" class="ic">${m.ic}</svg></span>
          <span style="text-align:left">
            <span class="en">${m.en}</span>
            <h3>${m.t}</h3>
          </span>
          <span class="go"><svg viewBox="0 0 24 24" class="ic"><path d="M9 18l6-6-6-6"/></svg></span>
        </button>`).join('')}
    </section>

    <section class="grid g4" style="margin-top:14px">
      ${[
      { k: '今日新学单词', v: todayNewWords, u: '词', i: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>' },
      { k: '听力练习', v: todayStat.listen || 0, u: '次', i: '<path d="M3 18v-6a9 9 0 0118 0v6"/>' },
      { k: '阅读练习', v: todayStat.read || 0, u: '篇', i: '<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>' },
      { k: '生词本', v: nb, u: '词', i: '<path d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2z"/>' },
    ].map(s => `
        <div class="stat">
          <div class="k"><svg viewBox="0 0 24 24" class="ic ic-sm">${s.i}</svg>${s.k}</div>
          <div class="v">${s.v}<small>${s.u}</small></div>
        </div>`).join('')}
    </section>

    <div class="hint" style="margin:8px 2px 0">「今日新学单词」按每日新词目标口径统计：只算新词，不含复习 / 抽检 / 拼写答对。</div>

    <section class="grid g2" style="margin-top:14px">
      <div class="card">
        <div class="card-h">近 7 天学习量<svg viewBox="0 0 24 24" class="ic ic-sm" style="margin-left:auto;color:var(--tx3)"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg></div>
        <div class="card-b">${App.bars(recent, 88)}</div>
      </div>
      <div class="card">
        <div class="card-h">词书进度<span class="r"><button class="btn btn-xs btn-gh" data-go="vocab">全部</button></span></div>
        <div class="card-b">
          ${Object.keys(prog).length ? BOOKS.filter(b => prog[b.id]).map(b => {
      const p = prog[b.id];
      const total = p.total || 1;
      const pct = Math.round(p.learned / total * 100);
      return `<div style="margin-bottom:12px">
              <div class="row" style="margin-bottom:5px;font-size:13px">
                <b>${b.name}</b>
                <span class="sp"></span>
                <span style="color:var(--tx3)">${p.learned} / ${total} · 掌握 ${p.mastered}</span>
              </div>
              <div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>
            </div>`;
    }).join('') : '<div class="empty"><p>还没有学习记录，去背单词开始吧</p></div>'}
        </div>
      </div>
    </section>

    <section class="start-garden-row" style="margin-top:14px">
      <div class="card start-learning-card">
        <div class="card-h">开始学习</div>
        <div class="card-b">
          <div class="grid" style="gap:9px">
            <button class="btn btn-pri btn-lg" data-go="vocab" style="justify-content:center">
              <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>背单词
              <span style="opacity:.75;font-weight:500;font-size:12.5px">今日 ${Store.d.settings.dailyNew} 词</span></button>
            <button class="btn btn-gh btn-lg" data-go="listening" style="justify-content:center">
              <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>练听力</button>
            <button class="btn btn-gh btn-lg" data-go="reading" style="justify-content:center">
              <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>做阅读</button>
            <button class="btn btn-gh btn-lg" data-go="writing" style="justify-content:center">
              <svg viewBox="0 0 24 24" class="ic ic-sm">▶</svg>写作文</button>
          </div>
        </div>
      </div>

      <div class="garden-box" id="gardenBox">
        ${Garden.renderGarden({ size: 56 })}
        <div class="row" style="margin-top:10px;gap:6px" id="gardenTabs">
          <button class="btn btn-xs btn-gh ${this.gPanel === 'rules' ? 'on' : ''}" data-panel="rules">规则说明</button>
          <button class="btn btn-xs btn-gh ${this.gPanel === 'school' ? 'on' : ''}" data-panel="school">设置校树</button>
          <button class="btn btn-xs btn-gh ${this.gPanel === 'species' ? 'on' : ''}" data-panel="species">
            树种库 (${Garden.SPECIES.length})</button>
        </div>
        <div class="gpanel ${this.gPanel ? 'open' : ''}" id="gPanel" ${this.gPanel ? '' : 'hidden'}>
          ${this.gPanel ? Garden.panelHTML(this.gPanel) : ''}
        </div>
      </div>
    </section>

    <!-- =====退出学习并关闭服务器===== -->
    <section class="exit-zone">
      <button class="btn btn-gh exit-btn" id="btnExit">
        <svg viewBox="0 0 24 24" class="ic ic-sm"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        退出学习并关闭服务器
      </button>
      <p class="exit-hint" id="exitHint">会保存当前进度并结束本地服务，下次从桌面图标重新打开即可</p>
    </section>`;

    /* 「退出学习并关闭服务器」是桌面浏览器 + 本地 serve.js 专属能力；
     * Android 安装包里没有本地服务器，显示这个按钮只会让人误点。*/
    const exitZone = root.querySelector('.exit-zone');
    if (exitZone && App.isNative()) exitZone.remove();

    on(root, 'click', '[data-go]', (e, t) => App.go(t.dataset.go));
    on(root, 'click', '#btnExit', () => this._exitApp(root));
    on(root, 'click', '.tree-cell', (e, t) => this._treeDetail(t.dataset.tid));
    on(root, 'click', '.lawn-tree', (e, t) => this._treeDetail(t.dataset.tid));
    on(root, 'click', '.tcard', (e, t) => this._treeDetail(t.dataset.tid));
    on(root, 'click', '.sp-card', (e, t) => this._speciesDetail(t.dataset.sp));
    on(root, 'click', '[data-iron]', () => this._ironDetail());

    /* 三按钮折叠面板：点展开 → 点其他切换 → 再点收起 */
    on(root, 'click', '[data-panel]', (e, t) => {
      const which = t.dataset.panel;
      this.gPanel = this.gPanel === which ? null : which;   // 再次点同按钮则折叠
      this.render(root);
    });
    on(root, 'click', '[data-panel-close]', () => { this.gPanel = null; this.render(root); });
    // 面板内交互
    on(root, 'click', '.sp-item', (e, t) => {
      const inp = $('#scName', root);
      if (inp) inp.value = t.dataset.sp;
      $$('.sp-item', root).forEach(x => x.classList.toggle('on', x === t));
    });
    const scSave = $('#scSave', root);
    if (scSave) scSave.onclick = () => {
      const n = ($('#scName', root).value || '').trim();
      if (!n) { App.toast('请填写校树名称', ''); return; }
      Garden.setSchoolTree(n, ($('#scNote', root).value || '').trim());
      this.gPanel = null;
      this.render(root);
      App.toast(`校树已设置为「${n}」`, 'ok');
    };
    const scClr = $('#scClr', root);
    if (scClr) scClr.onclick = () => {
      Garden.clearSchoolTree();
      this.gPanel = null;
      this.render(root);
      App.toast('已清除校树设置', 'ok');
    };
  },

  /* ---------- 树种详情 ---------- */
  _speciesDetail(name) {
    const s = Garden.SPECIES.find(x => x.name === name);
    const g = Garden._g();
    const trees = g.trees.filter(t => t.species === name);
    const isSchool = g.schoolTree && g.schoolTree.name === name;
    if (!s) {
      App.modal(name, `<div class="rule-box">这是你设置的<b>校树</b>。
        ${trees.length ? `园中已种下 ${trees.length} 棵。` : '园中还没有种下过。'}
        <br>校树会以约 40% 的概率出现，成熟节奏按 120 天计。</div>
        <button class="btn btn-pri btn-blk" data-x style="margin-top:14px">知道了</button>`,
        b => { b.querySelector('[data-x]').onclick = App.closeModal; });
      return;
    }
    const got = trees.length > 0;
    const mature = trees.filter(t => t.growth >= 0.75).length;
    App.modal(s.name, `
      <div style="text-align:center;padding:6px 0 14px">
        <div style="display:inline-block">${Garden._miniTree(s, 96)}</div>
        <div style="font-size:12px;color:var(--tx3);font-style:italic;margin-top:6px">${esc(s.latin)}</div>
        <div class="hint" style="margin-top:6px">${esc(s.note || '')}</div>
      </div>
      <div class="grid g3" style="gap:8px;margin-bottom:14px">
        ${[['成熟周期', s.matureDays, '天'], ['已种下', trees.length, '棵'], ['已成材', mature, '棵']]
        .map(([k, v, u]) => `<div class="stat" style="padding:9px;text-align:center">
          <div class="k" style="justify-content:center">${k}</div>
          <div class="v" style="font-size:18px">${v}<small>${u}</small></div></div>`).join('')}
      </div>
      ${got ? `<div class="sec-t">园中它的树</div>
        ${trees.map(t => `<div class="row" style="gap:8px;padding:5px 0;font-size:12.5px">
          <span style="width:82px">${esc(t.date)}</span>
          <span class="bar" style="flex:1"><i style="width:${Math.round(t.growth * 100)}%"></i></span>
          <span style="width:38px;text-align:right">${Math.round(t.growth * 100)}%</span>
        </div>`).join('')}`
        : `<div class="tipbox">还没种下过。树种是<b>随机分配</b>的——种到哪棵就收集哪棵，
          无法指定，这与真实学习一样：结果不由偏好决定。</div>`}
      ${isSchool ? '<div class="tipbox" style="margin-top:10px">这是你设置的<b>校树</b>。</div>' : ''}
      <button class="btn btn-pri btn-blk" data-x style="margin-top:16px">关闭</button>`,
      b => { b.querySelector('[data-x]').onclick = App.closeModal; });
  },

  /* ---------- 珍稀树（彩蛋，不解释规则） ---------- */
  _ironDetail() {
    const s = Garden.ironState();
    const bloomed = s.blooms.length > 0;

    if (!s.grown) {
      App.modal('园中珍稀', `<div style="text-align:center;padding:16px">
        <div style="font-size:34px">🌱</div>
        <div style="font-weight:700;margin-top:8px">还看不见它</div>
        <div class="hint" style="margin-top:6px">继续学习吧。</div>
      </div>`);
      return;
    }

    App.modal('园中珍稀', `
      <div style="text-align:center;padding:6px 0 16px">
        ${Garden.drawIron(bloomed, 120)}
        <div style="font-size:16px;font-weight:750;margin-top:10px;color:${bloomed ? 'var(--purple)' : 'var(--tx)'}">
          ${bloomed ? '它开花了' : '它还活着'}
        </div>
        <div class="hint" style="margin-top:6px;line-height:1.8">
          ${bloomed
        ? `「铁树开花」——比喻极难之事终于实现。<br>这是第 ${s.blooms.length} 次开花。`
        : '它比别的树长得慢得多，也许很多年都不会开花。'}
        </div>
      </div>

      ${bloomed ? `
        <div class="sec-t">开花记录</div>
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <tr style="color:var(--tx3);font-size:11px">
            <th style="text-align:left;padding:4px">日期</th><th>连续</th><th>累计</th><th>保持率</th><th>质量</th>
          </tr>
          ${s.blooms.slice().reverse().map(b => `<tr style="border-top:1px solid var(--line)">
            <td style="padding:5px">${b.date}</td><td style="text-align:center">${b.streak}</td>
            <td style="text-align:center">${b.totalDays}</td>
            <td style="text-align:center">${b.R}%</td>
            <td style="text-align:center">${b.Q}%</td>
          </tr>`).join('')}
        </table>`
        : `<div class="rule-box">
        它需要<b>很长的连续学习</b>才能等到开花，而且不只是坚持就够——
        你的<b>记忆保持率</b>和<b>学习质量</b>也要真正达标。
        <br><br>
        这些条件不会写在任何地方。做到了，它自己会开。
      </div>`}`);
  },

  /* ---------- 树详情 ---------- */
  _treeDetail(id) {
    const g = Garden._g();
    const t = g.trees.find(x => x.id === id);
    if (!t) return;
    const style = TREE_STYLE[t.state] || TREE_STYLE.sapling;
    const info = Garden.infoOf(t.species);
    const R = Math.round((t.state === 'stump' ? 0 : (t.R || 0)) * 100);
    const hist = (t.history || []).slice(-8).reverse().map(h =>
      `<tr><td>${new Date(h.t).toLocaleDateString('zh-CN')}</td>
        <td>${Math.round(h.R * 100)}%</td>
        <td>${(TREE_STYLE[h.state] || {}).label || h.state}</td></tr>`).join('');
    App.modal(t.species, `
      <div style="display:flex;gap:18px;align-items:center;margin-bottom:16px">
        <div style="flex:none">${Garden.drawTree(t, { size: 88 })}</div>
        <div style="flex:1">
          <div style="font-size:20px;font-weight:750;font-family:Georgia,serif">${esc(t.species)}</div>
          ${info.latin ? `<div style="font-size:11.5px;color:var(--tx3);font-style:italic">${esc(info.latin)}</div>` : ''}
          <div style="margin-top:8px">
            <span class="tag" style="background:${style.leaf ? style.leaf + '22' : 'var(--card2)'};color:${style.leaf || 'var(--tx2)'}">
              ${style.label}</span>
            <span class="tag tag-pri">保持率 ${R}%</span>
          </div>
          <div class="hint" style="margin-top:7px">${style.desc}${info.note ? '　·　' + esc(info.note) : ''}</div>
        </div>
      </div>
      <div style="font-size:12.5px;line-height:1.8;color:var(--tx2)">
        <div>树种：<b>${esc(t.species)}</b>${info.latin ? `　<span style="color:var(--tx3);font-style:italic">${esc(info.latin)}</span>` : ''}</div>
        <div>种植日期：<b>${esc(t.date)}</b>${t.stumpAt ? '　砍伐日期：<b>' + esc(App.fmtDate(new Date(t.stumpAt))) + '</b>' : ''}</div>
        <div>累计投入学习时长：<b>${Math.round(Garden.investedMinutes(t))}</b> 分钟</div>
        <div>成熟周期：<b>${info.matureDays || 30}</b> 天　当前成长：<b>${Math.round(t.growth * 100)}%</b></div>
        <div>关联单词：<b>${t.words.length}</b> 个${t.words.length ? '（' + t.words.slice(0, 8).map(w => esc(w.word)).join('、') + (t.words.length > 8 ? '…' : '') + '）' : '　<b style="color:var(--warn)">当天未记录单词，成长按时间衰减</b>'}</div>
      </div>
      <div class="sec-t">当日学习质量（影响成长度）</div>
      ${(() => {
      const dq = Garden.dailyQuality(t.date);
      if (dq.empty) return '<div class="hint">当天无学习记录</div>';
      const p = dq.parts || {};
      const row = (k, label, v) => `
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0">
          <span style="width:62px;flex:none;font-size:12px;color:var(--tx2)">${label}</span>
          <span class="bar" style="flex:1"><i style="width:${Math.round((v || 0) * 100)}%"></i></span>
          <span style="width:34px;text-align:right;font-size:11.5px;font-weight:700">${Math.round((v || 0) * 100)}</span>
        </div>`;
      return `
        <div style="font-size:12px;color:var(--tx3);margin-bottom:7px">
          综合质量 <b style="color:var(--pri);font-size:15px">${Math.round(dq.q * 100)}</b> 分　·　
          用时 <b>${Math.round(dq.minutes)}</b> 分钟　·　
          正确率 <b>${Math.round(dq.acc * 100)}%</b>
        </div>
        ${row('words', '单词', p.words)}
        ${row('listen', '听力', p.listen)}
        ${row('read', '阅读', p.read)}
        ${row('write', '写作', p.write)}
        ${row('time', '时长', p.time)}
        ${row('acc', '正确率', p.acc)}
        <div class="hint" style="margin-top:7px">${esc(dq.count)}</div>
        <div class="hint">${t.trackingVersion === 2 ? '新树按有效学习时长成长；学习质量与记忆保持率仍会影响树木健康状态。' : '这棵旧树沿用原有的学习质量成长规则。'}</div>`;
    })()}
      ${hist ? `<div class="sec-t">状态变化</div>
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <tr style="color:var(--tx3);font-size:11px"><th style="text-align:left;padding:4px">日期</th><th>保持率</th><th>状态</th></tr>
          ${hist}
        </table>` : ''}
      ${t.state === 'stump' ? `<div class="tipbox" style="margin-top:12px;border-left-color:var(--err);background:var(--err-l)">
        保持率曾跌破 <b>55%</b>，该树已永久枯萎并被砍伐为木桩。<b>木桩永不恢复</b>——这是设计规则的一部分，
        提醒你：落下的记忆是真的会丢的。</div>`
        : t.state === 'withered' ? `<div class="tipbox" style="margin-top:12px;border-left-color:var(--warn);background:var(--warn-l)">
        保持率降到 <b>55%–85%</b> 且<b>已逾期未复习</b>，树暂时枯萎。<b>继续复习</b>即可让保持率回升、重新变绿；
        若跌到 <b>55% 以下</b>就会变成木桩。</div>`
          : t.state === 'young' ? `<div class="tipbox" style="margin-top:12px">
        保持率 <b>≥55%</b>，只是<b>还没到复习时间</b>，所以只是"成长中"而非枯萎。
        到期后若不复习，保持率会跌破 <b>55%</b> 变成木桩。</div>`
            : `<div class="tipbox" style="margin-top:12px">
        保持率 <b>≥85%</b>，长势良好。按遗忘曲线，到期不复习会开始衰减。</div>`}`);
  },

  /* ---------- 规则说明 ---------- */
  _gardenRules() {
    App.modal('种树规则（与遗忘曲线绑定）', `
      <div class="rule-box">
        <b>一句话</b>：一次培育一棵树，累计英语学习时长推动它成长；成熟后，下次学习再种下一棵。原有树木数据会保留。<br><br>
        <b>保持率怎么算？</b><br>
        公式 <code>R(t) = e^(−t / S)</code>，其中 <code>S = ef × 间隔天数</code>，
        <code>t</code> 是距上次复习的天数。这与 SM-2 间隔重复模型一致：
        <b>复习间隔越长，遗忘越快</b>（ef 随每次成功复习上升，所以好掌握的词掉得慢）。<br><br>
        <b>状态判定</b>（阈值固定，<u>不可通过改代码绕过</u>）：<br>
        <table style="width:100%;font-size:12.5px;margin-top:6px;border-collapse:collapse">
          <tr><td style="padding:4px 0;width:190px"><b style="color:var(--ok)">R ≥ 85%</b></td><td>健康成树 🌳</td></tr>
          <tr><td style="padding:4px 0"><b style="color:var(--ok)">55% ≤ R &lt; 85%</b><br><span style="color:var(--tx3);font-size:11.5px">且未到复习时间</span></td>
              <td>成长中 🌱（还没到点，不算忘）</td></tr>
          <tr><td style="padding:4px 0"><b style="color:var(--warn)">55% ≤ R &lt; 85%</b><br><span style="color:var(--tx3);font-size:11.5px">且已逾期</span></td>
              <td>暂时枯萎 🍂　<b>可恢复</b>，复习即回升</td></tr>
          <tr><td style="padding:4px 0"><b style="color:var(--err)">R &lt; 55%</b></td>
              <td>永久枯萎，砍伐为<b>木桩</b> 🪵，<b>永不恢复</b></td></tr>
        </table><br>
        判定用<b>保持率 + 是否逾期</b>两个条件，因为「到复习时间了」和「已经忘了」是两件事：
        还没到期的词即使 <code>R</code> 略低也只是等待，不该惩罚。<br><br>
        <b>关键性质</b>：到期当天复习时 <code>t = 间隔</code>，此时 <code>R = e⁻¹ ≈ 37% &lt; 55%</code>，
        因此<b>「到期不复习必然开始枯萎」</b>——这正是艾宾浩斯遗忘曲线。<br>
        反过来，掌握牢固的词（<code>ef</code> 高→间隔长）即使过了很久 <code>R</code> 仍可能 &gt;55%，
        不会平白枯萎——因为牢固的记忆确实更耐久。<br><br>
        <b>树种</b>：默认取辽宁地区常见乡土树种（油松、樟子松、落叶松、白桦、蒙古栎、银杏、刺槐、小青杨…），
        依据《沈阳市绿地树种名录》与辽宁数字植物标本馆。
        设置<b>校树</b>后，校树会以约 <b>40%</b> 概率出现。<br><br>
        <b>新树成长度 = 累计有效学习分钟数 ÷ 树种所需分钟数</b>，每次学习只计入当前树。<br>
        不同树种的<b>成熟周期不同</b>：以每天约 20 分钟为参考，垂柳约 22 天成材，油松、樟子松要 90 天。<br>
        既有树木继续沿用旧版成长计算，已有记录不会被重置。<br><br>
        <b>不会发生的事</b>：手动改数据库、或不复习，都不能阻止枯萎。
        木桩是<b>永久</b>的——落下的记忆不会因为「假装学过」而回来。<br><br>
        <b>🌳 树种库</b>：树种<b>随机分配</b>，无法指定。种到哪棵就收集哪棵，
        下方树种库会记录你的收集进度。
      </div>
      <button class="btn btn-pri btn-blk" data-x style="margin-top:16px">知道了</button>`,
      b => { b.querySelector('[data-x]').onclick = App.closeModal; });
  },

  /* ---------- 设置校树 ---------- */
  _setSchool() {
    const g = Garden._g();
    App.modal('设置本校校树', `
      <p class="hint" style="margin-bottom:14px">
        填写你学校的校树后，树园里会以约 <b>40%</b> 的概率种出它，
        陪你一起成长。<br>校树信息只保存在本机。
      </p>
      <div class="fld">
        <label class="lab">校树名称</label>
        <input class="inp" id="scName" placeholder="如：油松 / 银杏 / 樟子松" value="${esc(g.schoolTree ? g.schoolTree.name : '')}">
      </div>
      <div class="fld">
        <label class="lab">备注（可选）</label>
        <input class="inp" id="scNote" placeholder="如：辽宁工学院主道两侧" value="${esc(g.schoolTree ? (g.schoolTree.note || '') : '')}">
      </div>
      <div class="sec-t">或从辽宁常见树种中选择</div>
      <div class="garden-species-grid">
        ${Garden.SPECIES.filter(s => s.local).map(s =>
      `<div class="sp-item ${g.schoolTree && g.schoolTree.name === s.name ? 'on' : ''}" data-sp="${esc(s.name)}">
            ${esc(s.name)}<small>${esc(s.note || '')}</small></div>`).join('')}
      </div>
      <div class="row" style="margin-top:16px;gap:8px">
        ${g.schoolTree ? '<button class="btn btn-warn" id="scClr">清除校树</button>' : ''}
        <span class="sp"></span>
        <button class="btn btn-gh" data-x>取消</button>
        <button class="btn btn-pri" id="scSave">保存</button>
      </div>`, b => {
      $('[data-x]', b).onclick = App.closeModal;
      on(b, 'click', '.sp-item', (e, t) => {
        $('#scName', b).value = t.dataset.sp;
        $$('.sp-item', b).forEach(x => x.classList.toggle('on', x === t));
      });
      $('#scSave', b).onclick = () => {
        const n = $('#scName', b).value.trim();
        if (!n) { App.toast('请填写校树名称', ''); return; }
        Garden.setSchoolTree(n, $('#scNote', b).value.trim());
        App.closeModal();
        ViewHome.render($('#view'));
        App.toast(`校树已设置为「${n}」`, 'ok');
      };
      const cl = $('#scClr', b);
      if (cl) cl.onclick = () => {
        Garden.clearSchoolTree();
        App.closeModal(); ViewHome.render($('#view'));
        App.toast('已清除校树设置', 'ok');
      };
    });
  },

  /* ---------- 树种库 ---------- */
  _speciesList() {
    const locals = Garden.SPECIES.filter(s => s.local);
    const others = Garden.SPECIES.filter(s => !s.local);
    const row = s => `<tr>
        <td style="padding:6px 0"><b>${esc(s.name)}</b></td>
        <td style="font-size:11.5px;color:var(--tx3);font-style:italic">${esc(s.latin)}</td>
        <td style="font-size:12px;color:var(--tx2)">${esc(s.note || '')}</td>
        ${s.local ? '<td><span class="tag tag-ok">辽宁</span></td>' : '<td></td>'}
      </tr>`;
    App.modal(`树种库（${Garden.SPECIES.length} 种）`, `
      <div class="hint" style="margin-bottom:10px">
        树种不影响规则，只影响视觉。种哪种树由随机决定，你无法指定——
        这和真实学习一样，结果不由偏好决定。
      </div>
      <div class="sec-t">辽宁常见（${locals.length} 种，约 70% 概率池）</div>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse">${locals.map(row).join('')}</table>
      <div class="sec-t">其他备选（${others.length} 种）</div>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse">${others.map(row).join('')}</table>
      <button class="btn btn-pri btn-blk" data-x style="margin-top:16px">关闭</button>`,
      b => { b.querySelector('[data-x]').onclick = App.closeModal; });
  },

  /* 退出学习并关闭本地服务器
   *
   * 【为什么需要两步】网页 JS 无法直接结束 Node 进程，
   * 必须由 serve.js 提供一个本地退出接口（POST /__shutdown）。
   *
   * 【为什么要先确认】关服务是不可逆的：页面会立刻变成"无法连接"，
   * 用户可能还有没保存的东西。误点一次就得重开，所以加二次确认。
   */
  _exitApp(root) {
    App.confirm('将保存当前进度并关闭本地服务器。\n下次请从桌面图标重新打开。', async () => {
      App.closeModal();

      // 1) 先落盘，避免关服务时丢进度
      /* 用 flush() 而不是 save()：save() 是 debounce(400ms)，
       * 页面马上要断连，等不到防抖就会丢掉最后一次改动。*/
      try { Store.flush(); } catch (e) { /* 存不进去也要允许退出 */ }

      const hint = root.querySelector('#exitHint');
      const btn = root.querySelector('#btnExit');
      if (btn) { btn.disabled = true; btn.textContent = '正在关闭...'; }
      if (hint) hint.textContent = '正在保存进度并结束服务，请稍候...';

      // 2) 调退出接口
      try {
        await fetch('/__shutdown', {
          method: 'POST',
          headers: { 'X-Exit-Token': 'keep-learning' },
        });
      } catch (e) {
        // 请求发不出去通常意味着服务已经关了（fetch 也会失败），按成功处理
      }

      // 3) 服务已退出，页面呈现"已关闭"终态
      if (hint) hint.textContent = '已关闭。下次请从桌面图标重新打开。';
      if (btn) btn.textContent = '已退出';
      // 兜底：即使服务没关掉，3 秒后也切到终态，避免卡在"正在关闭"
      setTimeout(() => {
        if (btn && btn.textContent === '正在关闭...') btn.textContent = '已退出';
      }, 3000);
    });
  },
};
function nowMonth() { return (new Date().getMonth() + 1) + ' 月'; }
window.ViewHome = ViewHome;
