/*补丁3：修复阅读页两个问题
 * 1) 划词点击后 _reRenderPassage 换掉#passage 节点，事件委托随之丢失
 *    → 改为把「点词查词」的委托统一绑在 root 上（#view 每次 shell 都是新节点）
 * 2) _bindPanel 用 freshNode 换 #anBox 后，_anPanel 内部对 #anBox 的引用需同步
 */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'js', 'views', 'reading.js');
let s = fs.readFileSync(p, 'utf8');

/* --- 1) 点词委托移到 root --- */
const oldWordBind = `    // 选词 / 选句
    const ps = $('#passage', root);
    if (ps && this.mode === 'edit') {
      // 鼠标选择
      ps.addEventListener('mouseup', () => {
        setTimeout(() => this._onSelect(), 10);
      });
      // 点击单词/句子（移动端友好）
      on(ps, 'click', '[data-w]', (e, t) => {
        const w = t.dataset.w;
        if (this._selText && this._selText.trim().split(/\\s+/).length > 2) return;
        this.selected = { type: 'word', text: w };
        this.anTab = 'word';
        $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === 'word'));
        this._markWord(w);
        $('#anBox').innerHTML = this._anPanel();
        this._bindPanel();
      });
    }`;

const newWordBind = `    // 选词 / 选句
    // 注意：委托必须绑在 root(#view) 上而非 #passage，
    // 因为 _reRenderPassage 会替换 #passage 节点，绑在其上的监听器会丢失。
    if (this.mode === 'edit') {
      on(root, 'click', '[data-w]', (e, t) => {
        // 若是划线（已选中过整句），交给划线逻辑处理
        if (this._selText && this._selText.trim().split(/\\s+/).length > 2) return;
        this.selected = { type: 'word', text: t.dataset.w };
        this.anTab = 'word';
        $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === 'word'));
        this._markWord(t.dataset.w);
        this._refreshPanel();
      });
      on(root, 'mouseup', '#passage', () => setTimeout(() => this._onSelect(), 10));
    }`;

if (!s.includes(oldWordBind)) { console.log('MISS wordBind'); }
else { s = s.replace(oldWordBind, newWordBind); console.log('OK   wordBind'); }

/* --- 2) 所有直接刷 #anBox 的地方改用 _refreshPanel() --- */
s = s.replace(/\$\('#anBox'\)\.innerHTML = this\._anPanel\(\);\n(\s*)this\._bindPanel\(\);/g,
  "this._refreshPanel();");
s = s.replace(/\$\('#anBox'\)\.innerHTML = this\._anPanel\(\);\n(\s*)this\._bindPanel\(\);/g,
  "this._refreshPanel();");

// 面板内直接改innerHTML 的两处
s = s.replace(`      $('#anBox').innerHTML = this._anPanel();
      this._bindPanel();
    });
    const ts = $('#timeSel', root);`, `      this._refreshPanel();
    });
    const ts = $('#timeSel', root);`);

s = s.replace(`    this.marks = {}; this.selected = null;
    this._shell(App.freshView());`, `    this.marks = {}; this.selected = null;
    this._shell(App.freshView());`);

/* --- 3) 新增 _refreshPanel --- */
s = s.replace(`  _bindPanel() {`,
`  /** 统一刷新右侧分析面板（换节点 + 重新绑定，避免监听器累积） */
  _refreshPanel() {
    const html = this._anPanel();
    const old = document.querySelector('#anBox');
    if (old) {
      const n = old.cloneNode(false);
      n.innerHTML = html;
      old.replaceWith(n);
    }
    this._bindPanel();
  },

  _bindPanel() {`);

/* --- 4) _anSent / _aiLookup 中的加载态也要走 _refreshPanel --- */
s = s.replace(`    const box = $('#anBox');
    box.innerHTML = \`<div class="row" style="justify-content:center;padding:24px"><span class="spin"></span> <span class="dots">解析中</span></div>\`;
    const ctx = this._ctxOf(this.selected.text);
    const d = await AI.lookup(this.selected.text, ctx);
    this.aiData = d; this.anTab = 'ai';
    $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === 'ai'));
    box.innerHTML = this._anPanel();
    this._bindPanel();`,
`    this._panelLoading('解析中');
    const ctx = this._ctxOf(this.selected.text);
    const d = await AI.lookup(this.selected.text, ctx);
    this.aiData = d; this.anTab = 'ai';
    $$('[data-atab]').forEach(x => x.classList.toggle('on', x.dataset.atab === 'ai'));
    this._refreshPanel();`);

s = s.replace(`    const box = $('#anBox');
    box.innerHTML = \`<div class="row" style="justify-content:center;padding:24px"><span class="spin"></span> <span class="dots">分析中</span></div>\`;
    const d = await AI.analyzeSentence(this.selected.text);
    this.sentAn = d;
    box.innerHTML = this._anPanel();
    this._bindPanel();`,
`    this._panelLoading('分析中');
    const d = await AI.analyzeSentence(this.selected.text);
    this.sentAn = d;
    this._refreshPanel();`);

// 新增 _panelLoading
s = s.replace(`  /** 统一刷新右侧分析面板`,
`  _panelLoading(text) {
    const old = document.querySelector('#anBox');
    if (!old) return;
    const n = old.cloneNode(false);
    n.innerHTML = '<div class="row" style="justify-content:center;padding:24px"><span class="spin"></span> <span class="dots">' + text + '</span></div>';
    old.replaceWith(n);
    this._bindPanel();
  },

  /** 统一刷新右侧分析面板`);

fs.writeFileSync(p, s);
console.log('done');