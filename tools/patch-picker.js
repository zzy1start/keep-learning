/* 重写 Picker.bind：修复类型归一与场次联动 */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'js', 'picker.js');
let s = fs.readFileSync(p, 'utf8');

const startMark = '  /** 绑定变更事件；回调收到 { year, session, no } */';
const endMark = '  /** 按选择筛选 */';
const i = s.indexOf(startMark), j = s.indexOf(endMark);
if (i < 0 || j < 0) { console.log('MARK NOT FOUND', i, j); process.exit(1); }

const block = `  /**
   * 绑定变更事件；回调收到 { year, session, no }
   *
   * 类型归一（关键）：<select>.value 永远是字符串，而题库里的 year/no 是数字。
   * 必须显式转成数字，否则 filter() 里 \`x.year === sel.year\` 永远为 false，
   * 表现为"选了下拉框但内容没变"。
   */
  bind(root, items, cur, onChange) {
    const sel = k => root.querySelector('#pk' + k.charAt(0).toUpperCase() + k.slice(1));
    const read = () => {
      const y = sel('year'), n = sel('no'), s = sel('session');
      return {
        year: !y ? 'all' : (y.value === 'null' ? null : (y.value === 'all' ? 'all' : +y.value)),
        session: s ? s.value : 'all',
        no: !n ? 'all' : (n.value === 'all' ? 'all' : +n.value),
      };
    };
    // 重刷下级选项
    const fillSessions = y => {
      const ss = Picker.sessionsOf(items, y);
      const sEl = sel('session');
      if (!sEl) return ss;
      const cur2 = sEl.value;
      sEl.innerHTML = ss.length <= 1
        ? (ss.length ? \`<option value="\${ss[0]}">\${sessionLabel(ss[0])}</option>\` : '')
        : [\`<option value="all">全部场次</option>\`]
          .concat(ss.map(x => \`<option value="\${x}">\${sessionLabel(x)}</option>\`)).join('');
      sEl.value = ss.includes(cur2) ? cur2 : (ss.length === 1 ? ss[0] : 'all');
      return ss;
    };
    const fillParts = (y, sv) => {
      const nEl = sel('no');
      if (!nEl) return;
      const parts = Picker.partsOf(items, y, sv);
      nEl.innerHTML = \`<option value="all">全部篇章</option>\` + parts.map((x, i) =>
        \`<option value="\${x.no}">第 \${x.no || i + 1} 篇　\${esc((x.title || '').slice(0, 22))}</option>\`).join('');
      nEl.value = 'all';
    };

    ['year', 'session', 'no'].forEach(k => {
      const el = sel(k);
      if (!el) return;
      el.onchange = () => {
        const cur2 = read();
        if (k === 'year') {
          fillSessions(cur2.year);
          fillParts(cur2.year, (sel('session') || {}).value || 'all');
        } else if (k === 'session') {
          fillParts(cur2.year, cur2.session);
        }
        onChange(read());       // 以 DOM 现状为准重新读取
      };
    });
  },

`;
s = s.slice(0, i) + block + s.slice(j);
fs.writeFileSync(p, s);
console.log('bind已重写');