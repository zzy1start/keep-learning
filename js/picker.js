/* ============ picker.js : 年份 / 场次 / 篇章选择器 ============
 * 听力、阅读、写作三模块共用。阅读与写作可启用考试类型筛选。
 * 题库字段：{ level, year, session, no }。
 */

const Picker = {
  /** 将 level 归并成阅读筛选使用的考试类别。 */
  familyOf(value) {
    const s = String(value || '').toLowerCase();
    if (/cet\s*[- ]?4|四级/.test(s)) return 'cet4';
    if (/cet\s*[- ]?6|六级/.test(s)) return 'cet6';
    if (/kaoyan|考研/.test(s)) return 'kaoyan';
    return 'other';
  },

  familyLabel(key) {
    return ({ cet4: '大学英语四级（CET-4）', cet6: '大学英语六级（CET-6）',
      kaoyan: '考研', other: '其他 / 待核验' })[key] || key;
  },

  families(items, include = []) {
    const found = new Set([...(items || []).map(x => this.familyOf(x.level)), ...include]);
    return ['cet4', 'cet6', 'kaoyan', 'other'].filter(x => found.has(x));
  },

  matchesYear(item, year) {
    if (year === 'all') return true;
    if (year === null || year === 'null') return item.year === null || item.year === undefined;
    return String(item.year) === String(year);
  },

  sessionOf(item) {
    if (this.familyOf(item.level) !== 'kaoyan') return item.session;
    const paper = `${item.examPaper || ''} ${item.session || ''}`;
    if (/english[-_ ]?1|英语一|英一/i.test(paper)) return 'english-1';
    if (/english[-_ ]?2|英语二|英二/i.test(paper)) return 'english-2';
    return 'other';
  },

  matchesPart(item, value) {
    if (value === 'all' || value === undefined) return true;
    return String(value).startsWith('id:') ? item.id === String(value).slice(3) : item.no === value;
  },

  /** 从题库数组提取可选年份（降序），可选地限定考试类型。 */
  years(items, family = 'all') {
    const ys = [...new Set(items.filter(x => family === 'all' || this.familyOf(x.level) === family)
      .map(x => x.year).filter(v => v !== null && v !== undefined))];
    return ys.sort((a, b) => b - a);
  },

  partLabel(item, index, unitWord) {
    /* 内置仿真题与导入真题可能在同一「年份·场次·第 N 篇」下重名（走查发现），
     * 统一在篇目标签后标出来源，避免用户以为题库重复/编号错了。*/
    const src = item && item.mine ? '（导入）' : '';
    if (item && item.pickerLabel) return `${item.pickerLabel}${item.title ? ` · ${item.title}` : ''}${src}`;
    const unit = unitWord || '篇';
    return `第 ${item.no || index + 1} ${unit}　${String(item.title || '').slice(0, 22)}${src}${item.questions ? `（${item.questions.length} 题）` : item.qs ? `（${item.qs.length} 题）` : ''}`;
  },

  sessionsAllLabel(items, year, family = 'all') {
    const sessions = this.sessionsOf(items, year, family);
    if (family === 'kaoyan' || year === 0 || year === '0') return '选择英语一 / 英语二';
    if (sessions.length && sessions.every(s => /^\d{1,2}$/.test(String(s)))) return '全部月份';
    return '全部场次';
  },

  /** 场次（同一年），无 year 的按 session 归类。 */
  sessionsOf(items, year, family = 'all') {
    return [...new Set(items.filter(x => this.matchesYear(x, year)
      && (family === 'all' || this.familyOf(x.level) === family))
      .map(x => this.sessionOf(x)).filter(Boolean))].sort();
  },

  /** 套别：1/2/3…；未标注返回空串。 */
  setOf(item) {
    const n = item && item.setNo;
    if (n === null || n === undefined || n === '' || Number(n) === 0) return '';
    return String(n);
  },

  /** 某年某场下出现过的套别（数字字符串，升序）。 */
  setsOf(items, year, session, family = 'all') {
    return [...new Set(items.filter(x => this.matchesYear(x, year)
      && (session === 'all' || this.sessionOf(x) === session)
      && (family === 'all' || this.familyOf(x.level) === family))
      .map(x => this.setOf(x)))].filter(Boolean).sort((a, b) => Number(a) - Number(b));
  },

  setLabel(v) {
    return (v === '' || v === null || v === undefined) ? '未分套' : '第 ' + v + ' 套';
  },

  /** 某年某场某套的篇章。 */
  partsOf(items, year, session, family = 'all', set = 'all') {
    return items.filter(x => this.matchesYear(x, year)
      && (session === 'all' || this.sessionOf(x) === session)
      && (set === 'all' || !set || this.setOf(x) === String(set))
      && (family === 'all' || this.familyOf(x.level) === family))
      .sort((a, b) => (a.no || 0) - (b.no || 0));
  },

  /**
   * 渲染选择器 HTML。
   * @param {object} o { items, sel, type, unitWord, levelFilter }
   */
  html(o) {
    const items = o.items || [];
    const partItems = o.partItems || items;
    const sel = o.sel || {};
    const levelFilter = !!o.levelFilter;
    const familyVal = levelFilter ? (sel.level !== undefined ? sel.level : 'all') : 'all';
    const familyKeys = levelFilter ? this.families(items, o.families || []) : [];
    const years = this.years(items, familyVal);
    const yearVal = sel.year !== undefined ? sel.year : 'all';
    const sessions = this.sessionsOf(items, yearVal, familyVal);
    const sessVal = sel.session !== undefined ? sel.session : (sessions.length === 1 ? sessions[0] : 'all');
    const sets = this.setsOf(items, yearVal, sessVal, familyVal);
    const setVal = sel.set !== undefined ? sel.set : 'all';
    const parts = this.partsOf(partItems, yearVal, sessVal, familyVal, setVal);
    const noVal = sel.no !== undefined ? sel.no : 'all';

    const familyOpts = levelFilter ? [
      `<option value="all"${familyVal === 'all' ? ' selected' : ''}>全部考试类型</option>`,
      ...familyKeys.map(key => `<option value="${key}"${key === familyVal ? ' selected' : ''}>${this.familyLabel(key)}</option>`),
    ].join('') : '';

    const hasNull = items.some(x => (familyVal === 'all' || this.familyOf(x.level) === familyVal)
      && (x.year === null || x.year === undefined));
    const yOpts = [
      ...years.map(y => `<option value="${y}"${String(y) === String(yearVal) ? ' selected' : ''}>${y === 0 && levelFilter ? '年份未标注' : y === 0 ? '考研' : `${y} 年`}</option>`),
      hasNull ? `<option value="null"${yearVal === null || yearVal === 'null' ? ' selected' : ''}>通用 / 年份未标注</option>` : '',
      `<option value="all"${yearVal === 'all' ? ' selected' : ''}>全部年份</option>`,
    ].join('');

    /* 把「月份」与「套别」合并进同一个下拉：6月·全部套 / 6月·第1套 / 6月·第2套。
     * value 使用 06|1 这种复合值，read() 再拆回 session + set。*/
    const selectedSession = (sessVal !== 'all' && setVal !== 'all') ? `${sessVal}|${setVal}` : String(sessVal);
    const sessionChoices = [];
    sessions.forEach(s => {
      const ss = this.setsOf(items, yearVal, s, familyVal);
      if (ss.length) {
        const sLabel = String(sessionLabel(s)).replace(/\s*月卷$/, ' 月');
        sessionChoices.push({ v: String(s), label: sLabel + ' · 全部套' });
        ss.forEach(set => sessionChoices.push({ v: `${s}|${set}`, label: sLabel + ' · 第' + set + '套' }));
      } else {
        sessionChoices.push({ v: String(s), label: sessionLabel(s) });
      }
    });
    const allSessionLabel = levelFilter ? this.sessionsAllLabel(items, yearVal, familyVal) : this.sessionsAllLabel(items, yearVal);
    const sOpts = [`<option value="all"${selectedSession === 'all' ? ' selected' : ''}>${allSessionLabel}</option>`]
      .concat(sessionChoices.map(x => `<option value="${esc(x.v)}"${x.v === selectedSession ? ' selected' : ''}>${esc(x.label)}</option>`)).join('');

    const setOpts = ['<option value="all"' + (setVal === 'all' ? ' selected' : '') + '>全部套别</option>']
      .concat(sets.map(s => '<option value="' + esc(s) + '"' + (String(s) === String(setVal) ? ' selected' : '') + '>' + esc(this.setLabel(s)) + '</option>'))
      .join('');

    const pOpts = [
      `<option value="all"${noVal === 'all' ? ' selected' : ''}>全部篇章</option>`,
      ...parts.map((p, i) => {
        const value = o.partById && p.id ? `id:${p.id}` : p.no;
        return `<option value="${esc(value)}"${this.matchesPart(p, noVal) && noVal !== 'all' ? ' selected' : ''}>${esc(this.partLabel(p, i, o.unitWord))}</option>`;
      }),
    ].join('');
    const shown = parts.filter(p => this.matchesPart(p, noVal)).length;
    const familyGrid = levelFilter ? 'picker-level-grid' : 'g3';

    return `
    <div class="card yearbox">
      <div class="card-h">
        <svg viewBox="0 0 24 24" class="ic ic-sm"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        ${o.filterTitle || '按年份与篇章选择'}
        <span class="r"><span class="tag tag-pri">${o.unitWord || '篇章'} ${shown} / ${parts.length}</span></span>
      </div>
      <div class="card-b">
        <div class="grid ${familyGrid}" style="gap:9px">
          ${levelFilter ? `<select class="inp" id="pkLevel" data-pk="level">${familyOpts}</select>` : ''}
          <select class="inp" id="pkYear" data-pk="year">${yOpts}</select>
          <select class="inp" id="pkSession" data-pk="session">${sOpts}</select>

          <select class="inp" id="pkNo" data-pk="no">${pOpts}</select>
        </div>
        <div class="hint" style="margin-top:9px">
          ${o.hint || ''}
          当前可用：<b>${parts.length}</b> ${o.unitWord || '篇'}。
          ${o.aiTip ? '<br><b>' + esc(o.aiTip) + '</b>' : ''}
        </div>
      </div>
    </div>`;
  },

  /** 绑定变更事件；回调收到 { level, year, session, no }。 */
  bind(root, items, cur, onChange, opts = {}) {
    const partItems = opts.partItems || items;
    const sel = k => root.querySelector('#pk' + k.charAt(0).toUpperCase() + k.slice(1));
    const read = () => {
      const y = sel('year'), n = sel('no'), s = sel('session'), l = sel('level');
      let session = s ? s.value : 'all';
      let set = (function () { const el = sel('set'); return el ? el.value : 'all'; })();
      if (session !== 'all' && session.indexOf('|') >= 0) {
        const parts = session.split('|');
        session = parts[0];
        set = parts[1] || 'all';
      }
      return {
        level: l ? l.value : 'all',
        year: !y ? 'all' : (y.value === 'null' ? null : (y.value === 'all' ? 'all' : +y.value)),
        session,
        set,
        no: !n ? 'all' : (n.value === 'all' || n.value.startsWith('id:') ? n.value : +n.value),
      };
    };
    const fillYears = (family, reset = false) => {
      const yEl = sel('year');
      if (!yEl) return;
      const previous = yEl.value;
      const years = Picker.years(items, family);
      const hasNull = items.some(x => (family === 'all' || Picker.familyOf(x.level) === family)
        && (x.year === null || x.year === undefined));
      yEl.innerHTML = [
        ...years.map(y => `<option value="${y}">${y === 0 ? '年份未标注' : `${y} 年`}</option>`),
        hasNull ? '<option value="null">通用 / 年份未标注</option>' : '',
        '<option value="all">全部年份</option>',
      ].join('');
      const valid = [...yEl.options].some(option => option.value === previous);
      yEl.value = !reset && valid ? previous : 'all';
    };
    const fillSessions = (year, family, reset = false) => {
      const sessions = Picker.sessionsOf(items, year, family);
      const sEl = sel('session');
      if (!sEl) return sessions;
      const previous = sEl.value;
      const choices = [];
      sessions.forEach(s => {
        const ss = Picker.setsOf(items, year, s, family);
        if (ss.length) {
          const sLabel = String(sessionLabel(s)).replace(/\s*月卷$/, ' 月');
          choices.push({ v: String(s), label: sLabel + ' · 全部套' });
          ss.forEach(set => choices.push({ v: `${s}|${set}`, label: sLabel + ' · 第' + set + '套' }));
        } else choices.push({ v: String(s), label: sessionLabel(s) });
      });
      sEl.innerHTML = ['<option value="all">全部月份</option>']
        .concat(choices.map(x => `<option value="${x.v}">${x.label}</option>`)).join('');
      const valid = [...sEl.options].some(o => o.value === previous);
      sEl.value = !reset && valid ? previous : 'all';
      return sessions;
    };
    const fillSets = (year, session, family, reset = false) => {
      const setEl = sel('set');
      if (!setEl) return [];
      const sets = Picker.setsOf(items, year, session, family);
      const previous = setEl.value;
      setEl.innerHTML = ['<option value="all">全部套别</option>']
        .concat(sets.map(x => '<option value="' + esc(x) + '">' + esc(Picker.setLabel(x)) + '</option>')).join('');
      setEl.value = !reset && sets.includes(previous) ? previous : 'all';
      return sets;
    };
    const fillParts = (year, session, family, set) => {
      const nEl = sel('no');
      if (!nEl) return;
      const parts = Picker.partsOf(partItems, year, session, family, set || 'all');
      nEl.innerHTML = '<option value="all">全部篇章</option>' + parts.map((x, i) =>
        `<option value="${esc(opts.partById && x.id ? `id:${x.id}` : x.no)}">${esc(Picker.partLabel(x, i, opts.unitWord))}</option>`).join('');
      nEl.value = 'all';
    };

    ['level', 'year', 'session', 'set', 'no'].forEach(k => {
      const el = sel(k);
      if (!el) return;
      el.onchange = () => {
        const current = read();
        if (k === 'level') {
          fillYears(current.level, true);
          const year = read().year;
          fillSessions(year, current.level, true);
          fillParts(year, 'all', current.level, 'all');
        } else if (k === 'year') {
          fillSessions(current.year, current.level);
          fillParts(current.year, read().session, current.level, read().set);
        } else if (k === 'session') {
          fillParts(current.year, current.session, current.level, current.set);
        }
        onChange(read());
      };
    });
  },

  /** 按选择筛选。
   * 注意：sel 可能只带部分键（阅读页点题型 tab 时历史上会生成 {no:'all'}）。
   * 缺省的 level/year/session/set 一律按“全部”处理，否则会一条都筛不出来，
   * 界面就会显示“当前筛选条件下没有题目”（真实 bug：点选词填空 tab 后 3 篇全没了）。*/
  filter(items, sel) {
    const s = sel || {};
    const level = s.level || 'all';
    const year = (s.year === undefined || s.year === null) ? 'all' : s.year;
    const session = (s.session === undefined || s.session === null) ? 'all' : s.session;
    const set = (s.set === undefined || s.set === null) ? 'all' : s.set;
    return items.filter(x =>
      (level === 'all' || this.familyOf(x.level) === level) &&
      (year === 'all' || (year === 'null' ? !x.year : this.matchesYear(x, year))) &&
      (session === 'all' || this.sessionOf(x) === session) &&
      (set === 'all' || this.setOf(x) === String(set)) &&
      this.matchesPart(x, s.no));
  },
};

function sessionLabel(s) {
  if (s === 'english-1' || s === 'english1') return '英语一';
  if (s === 'english-2' || s === 'english2') return '英语二';
  if (s === 'other' || !s) return '不分卷';
  const str = String(s);
  if (/^\d{1,2}$/.test(str)) return str.replace(/^0/, '') + ' 月卷';
  return str;
}

function fullLabel(y, s) {
  if (y === 0 || y === '0') return s ? sessionLabel(s) : '考研';
  if (y) return `${y} 年 ${sessionLabel(s)}`;
  return sessionLabel(s);
}
window.Picker = Picker;
window.sessionLabel = sessionLabel;
window.fullLabel = fullLabel;
