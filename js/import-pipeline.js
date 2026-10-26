/* ============ import-pipeline.js : 结构优先切批 + 原文位置/覆盖校验 ============
 * 设计目标（2026-10-17，按用户方案）：
 *   1) 结构优先切批：先按 Section / Passage / Text / Questions N to M / Directions 等边界
 *      切出「篇章 + 它的题目」结构块；长度 4500 字符只作为兜底上限，超长时优先在段落/
 *      题目边界内拆，并标记 continuation（前一段只作为上下文，不许重复输出）。
 *   2) 每批只处理同类结构：批次自带 module（listening/reading/writing）与 title，
 *      调用方据此只让 AI 输出该模块，避免三个模块挤占同一份输出额度。
 *   3) 原文位置：批次记录 [start,end) 字符区间与页码；校验时把 AI 产出的题干/选项文本
 *      与批次原文做「压缩后包含」比对，得到覆盖率、定位缺失清单；题号按原文里的
 *      Questions N to M / 编号行推导期望集合，缺题/多题直接报错。
 *   4) 程序侧完整性：validateBatch 返回结构化 errors / warnings / stats，
 *      供调用方做「只修复失败范围」和结果展示。
 *
 * 本模块是纯逻辑（无 DOM），供 js/importer.js 使用，也可单独在 Node 里跑测试。
 */
(function () {
  const LIMIT_DEFAULT = 4500;
  const CONTEXT_TAIL = 1800;

  /* 结构标题：行首出现即视为新结构块开始（Section/Part 允许字母或罗马数字/阿拉伯数字） */
  /* 罗马数字：真卷 PDF 常直接排 Unicode 罗马数字（如 "Part  Ⅲ  Reading Comprehension"），
   * 只写 [ivx]+ 会漏掉它，导致 Reading 大标题不被识别、阅读模块继承成 listening。
   * U+2160–U+217F 用负向前瞻收尾，避免 \b 对非 ASCII 字符失效。*/
  const HEADING_RE = /^\s*(?:part\s+(?:[a-d]|[ivx]+|\d+|[\u2160-\u217f])(?![A-Za-z0-9])|section\s+(?:[a-d]|[ivx]+|\d+|[\u2160-\u217f])(?![A-Za-z0-9])|passage\s+(?:one|two|three|four|five|six|\d+)\b|text\s+(?:one|two|three|four|five|six|\d+)\b|questions?\s+\d{1,3}\s*(?:-|to|–|—)\s*\d{1,3}\b|directions?\b|writing\b|translation\b|listening\b|reading\b|作文|书面表达|听力|阅读|翻译|完形填空|选词填空|段落匹配)/i;
  /* 题号行："16."、"5 1."（PDF 把 51 切成 5 1）、"46、" */
  const QUESTION_LINE_RE = /^\s*((?:\d\s*){1,3})\s*[.、)）]/;

  function normalize(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }
  function loose(text) {
    return String(text == null ? '' : text).replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '');
  }
  /** 题干是否只是占位（空 / "Question 9" / "Questions 1 to 4 are based on ..."）。
   * 四六级听力卷面只印选项、不印题干，AI 常把范围行或空串当题干，需要单独统计而不是判错。*/
  function isPlaceholderStem(stem) {
    const s = String(stem == null ? '' : stem).trim();
    if (!s) return true;
    if (/^questions?\s+\d{1,3}\s*[.。]?$/i.test(s)) return true;                 // "Question 9"
    if (/^questions?\s+\d{1,3}\s*(?:-|to|–|—)\s*\d{1,3}\b/i.test(s)) return true; // "Questions 1 to 4 are based on ..."
    return false;
  }
  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  }
  function lineAt(text, starts, index) {
    return text.slice(starts[index], starts[index + 1] == null ? text.length : starts[index + 1] - 1);
  }
  function moduleOfHeading(line) {
    const s = String(line || '');
    if (/listening|听力/i.test(s)) return 'listening';
    if (/writing|translation|作文|书面表达|翻译/i.test(s)) return 'writing';
    return 'reading';
  }
  /** 只认"大标题"里显式的模块关键字；Section/Questions/Passage 这类小标题返回 ''（继承上层）。
   * 只看冒号前的标签部分——否则 "Directions: write an essay on reading" 会因为正文里的
   * reading/writing 被误判成阅读/写作模块。*/
  function explicitModule(line) {
    const s = String(line || '').trim().split(/[:：]/)[0];
    if (/listening|听力/i.test(s)) return 'listening';
    if (/writing|translation|作文|书面表达|翻译/i.test(s)) return 'writing';
    if (/reading|阅读/i.test(s)) return 'reading';
    return '';
  }
  /** 从批次原文推导"应该出现的题号集合"（Questions N to M / 编号行，兼容 "5 1." 这类 OCR 拆分） */
  function expectedNumbers(text) {
    const src = normalize(text);
    const set = new Set();
    const rangeRe = /questions?\s+(\d{1,3})\s*(?:-|to|–|—)\s*(\d{1,3})/gi;
    let m;
    while ((m = rangeRe.exec(src))) {
      const a = Number(m[1]), b = Number(m[2]);
      if (b >= a && b - a < 60) for (let n = a; n <= b; n++) set.add(n);
    }
    const lines = src.split('\n');
    for (const line of lines) {
      if (/^\s*[A-D]\s*[).、]/.test(line)) continue;          // 选项行
      const q = line.match(QUESTION_LINE_RE);
      if (!q) continue;
      const digits = String(q[1]).replace(/\s+/g, '');
      const n = Number(digits);
      if (Number.isFinite(n) && n > 0 && n < 1000) set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  /** 题块区间：题号行起点 → 该题选项/续行最后一行末尾（页脚、空行不会结束题块）。
   * 切批时用来拒绝"落在题干与其 A-D 选项之间"的切点。*/
  function questionSpans(text) {
    const src = normalize(text);
    const starts = lineStarts(src);
    const spans = [];
    let cur = null;
    for (let i = 0; i < starts.length; i++) {
      const raw = lineAt(src, starts, i);
      const trimmed = raw.trim();
      const lineEnd = starts[i] + raw.length;
      if (HEADING_RE.test(trimmed) && !QUESTION_LINE_RE.test(trimmed)) {
        if (cur) { spans.push(cur); cur = null; }
        continue;
      }
      const m = trimmed.match(QUESTION_LINE_RE);
      if (m) {
        if (cur) spans.push(cur);
        cur = { number: Number(String(m[1]).replace(/\s+/g, '')), start: starts[i], end: lineEnd };
        continue;
      }
      if (!trimmed) continue;
      if (cur) cur.end = lineEnd;
    }
    if (cur) spans.push(cur);
    return spans;
  }

  /** 切点 pos 是否落在某道题的题块内部（题干行之后、该题选项结束之前） */
  function cutInsideQuestion(spans, pos) {
    for (const sp of spans) if (pos > sp.start && pos < sp.end) return sp;
    return null;
  }

  function pageOf(pages, offset) {
    if (!Array.isArray(pages) || !pages.length) return null;
    for (const p of pages) if (offset >= p.start && offset < p.end) return p.no;
    return pages[pages.length - 1].no;
  }

  /**
   * 结构优先切批。
   * @param {string} text 原文（已修复）
   * @param {{pages?: Array<{no:number,start:number,end:number}>, maxChars?: number}} opts
   * @returns {Array<{id,index,title,module,start,end,pageStart,pageEnd,text,continuation}>}
   */
  function buildBatches(text, opts = {}) {
    const src = normalize(text);
    const maxChars = Math.max(600, Math.min(20000, Number(opts.maxChars) || LIMIT_DEFAULT));
    const pages = Array.isArray(opts.pages) && opts.pages.length ? opts.pages : null;
    if (!src.trim()) return [];

    const starts = lineStarts(src);
    const lineCount = starts.length;
    const boundaries = [];
    for (let i = 0; i < lineCount; i++) {
      const line = lineAt(src, starts, i);
      if (HEADING_RE.test(line.trim())) {
        boundaries.push({ line: i, offset: starts[i], heading: line.trim().slice(0, 120) });
      }
    }
    /* 模块归属沿"Part/大标题"向下继承：Section A、Questions、Passage 等小标题本身不带
     * listening/reading 字样，必须沿用最近一次出现的 Part 模块，否则听力题会被并进阅读批。*/
    let currentModule = '';
    boundaries.forEach(b => {
      const m = explicitModule(b.heading);
      if (m) currentModule = m;
      b.module = currentModule || 'reading';
    });
    /* 结构块：从每个结构标题到下一个结构标题；首个标题之前的内容自成一个块 */
    const blocks = [];
    if (!boundaries.length || boundaries[0].offset > 0) {
      const head = boundaries.length ? boundaries[0].offset : src.length;
      if (head > 0 && src.slice(0, head).trim()) {
        blocks.push({ start: 0, end: head, heading: '', module: 'reading' });
      }
    }
    boundaries.forEach((b, i) => {
      const end = i + 1 < boundaries.length ? boundaries[i + 1].offset : src.length;
      if (end > b.offset) blocks.push({ start: b.offset, end, heading: b.heading, module: b.module });
    });
    if (!blocks.length) blocks.push({ start: 0, end: src.length, heading: '', module: 'reading' });
    /* 只有标题行、没内容的短块并入下一块，避免"Passage One"这种标题被单独切成一批 */
    for (let i = 0; i < blocks.length - 1;) {
      const cur = blocks[i];
      if (cur.end - cur.start < 160 && cur.module === blocks[i + 1].module) {
        blocks[i + 1] = {
          start: cur.start, end: blocks[i + 1].end,
          heading: cur.heading || blocks[i + 1].heading,
          module: cur.module,
        };
        blocks.splice(i, 1);
      } else i++;
    }

    const out = [];
    const pushBatch = (start, end, heading, continuation, moduleOverride) => {
      const slice = src.slice(start, end);
      if (!slice.trim()) return;
      out.push({
        id: 'b' + out.length,
        index: out.length,
        title: (heading || '').replace(/^\s+|\s+$/g, ''),
        module: moduleOverride || moduleOfHeading(heading || slice.slice(0, 120)),
        start, end,
        pageStart: pageOf(pages, start),
        pageEnd: pageOf(pages, Math.max(start, end - 1)),
        text: slice,
        continuation: !!continuation,
      });
    };
    /* 把结构块合并到接近上限；只合并同模块（听力/阅读/写作）的相邻结构，避免一份请求里
     * 同时塞三种模块。单个块超长时按「段落 → 题目行 → 句子 → 空白」拆。*/
    let cur = null;
    /* 合并批次必须带上 cur.module：pushBatch 在不传 override 时会用 moduleOfHeading(标题)
     * 重新猜模块，而 Section/Questions 这类小标题猜出来永远是 reading——
     * 听力 Section C 的 Questions 批会被错标成 reading。*/
    const flush = () => { if (cur) { pushBatch(cur.start, cur.end, cur.heading, cur.continuation, cur.module); cur = null; } };
    for (const b of blocks) {
      const len = b.end - b.start;
      const blockModule = b.module || 'reading';
      const okSameModule = cur && cur.module === blockModule;
      if (cur && (!okSameModule || cur.end - cur.start + len > maxChars)) flush();
      if (len <= maxChars) {
        if (!cur) cur = { start: b.start, end: b.end, heading: b.heading, continuation: false, module: blockModule };
        else cur.end = b.end;
      } else {
        flush();
        splitLongBlock(src, b, maxChars, pushBatch, blockModule);
      }
    }
    flush();
    out.forEach((b, i) => { b.index = i; b.id = 'b' + i; });
    return out;
  }

  /** 超长结构块：优先空行（段落），其次题号行，再次句末，最后空白/硬切；保证不丢字符 */
  function splitLongBlock(src, block, maxChars, pushBatch, blockModule) {
    const headingOf = first => first ? block.heading : '';
    const pushSplit = (start, end, first) => {
      const slice = src.slice(start, end);
      if (!slice.trim()) return;
      pushBatch(start, end, headingOf(first), !first, blockModule || moduleOfHeading(slice.slice(0, 120)));
    };
    const spans = questionSpans(src);
    let pos = block.start;
    let first = true;
    while (pos < block.end) {
      const remain = block.end - pos;
      if (remain <= maxChars) {
        pushSplit(pos, block.end, first);
        return;
      }
      const windowText = src.slice(pos, Math.min(block.end, pos + maxChars));
      const cuts = [];
      /* 段落边界 */
      const blank = /\n\s*\n/g;
      let m;
      while ((m = blank.exec(windowText))) cuts.push({ cut: m.index + m[0].length, rank: 3 });
      /* 题号行边界 */
      const qline = /\n(?=\s*(?:\d\s*){1,3}\s*[.、)）])/g;
      while ((m = qline.exec(windowText))) cuts.push({ cut: m.index + 1, rank: 2 });
      /* 句末边界（英文/中文） */
      const sent = /[.!?。！？]["'”’)]?\s+/g;
      while ((m = sent.exec(windowText))) cuts.push({ cut: m.index + m[0].length, rank: 1 });
      let chosen = -1;
      const min = Math.floor(maxChars * 0.35);
      if (cuts.length) {
        /* 按既有优先级（段落→题号行→句末）从后往前试；切点若落在某道题的题干行之后、
         * 该题 A-D 选项结束之前，这道题就会被拆到两批（AI 只看到一半，回填也补不回），
         * 必须跳到下一个候选；全部候选都不行时切到该题选项结束之后。*/
        const ordered = cuts.filter(c => c.cut >= min && c.cut <= maxChars)
          .sort((a, b) => b.rank - a.rank || b.cut - a.cut);
        let blocked = null;
        for (const c of ordered) {
          const hit = cutInsideQuestion(spans, pos + c.cut);
          if (!hit) { chosen = c.cut; break; }
          if (!blocked) blocked = hit;
        }
        if (chosen < 0 && blocked) chosen = blocked.end - pos;
      }
      if (chosen < 0) {
        const space = windowText.lastIndexOf(' ');
        chosen = space > maxChars * 0.5 ? space + 1 : windowText.length;
        const hit = cutInsideQuestion(spans, pos + chosen);
        if (hit) chosen = hit.end - pos;
      }
      chosen = Math.max(1, Math.min(chosen, block.end - pos));
      pushSplit(pos, pos + chosen, first);
      pos += chosen;
      first = false;
    }
  }

  /** 压缩后包含：忽略空白与标点，用于检查 AI 产出的题干/选项是否真的来自原文 */
  function containsSource(source, piece) {
    const p = loose(piece);
    return !!p && loose(source).includes(p);
  }

  /**
   * 校验一批 AI 结果。
   * @param {object|Array} result AI 返回（{module, items, complete} 或 {modules:{...}} 或数组）
   * @param {object} batch buildBatches 产出的批次
   * @param {{module?:string}} opts
   * @returns {{ok:boolean,module:string,items:Array,errors:Array,warnings:Array,stats:object}}
   */
  function validateBatch(result, batch, opts = {}) {
    const partial = !!opts.partial;   // 批内二分出的子批：只查结构，不查题号是否覆盖父批范围
    const errors = [];
    const warnings = [];
    const module = String(opts.module || (batch && batch.module) || 'reading');
    let items = null;
    if (Array.isArray(result)) items = result;
    else if (result && Array.isArray(result.items)) items = result.items;
    else if (result && result.modules && Array.isArray(result.modules[module])) items = result.modules[module];
    if (!items) {
      return { ok: false, module, items: [], errors: [{ code: 'NO_ITEMS', detail: 'AI 结果里没有 ' + module + ' 数组' }], warnings: [], stats: {} };
    }
    const src = batch && batch.text || '';
    const expected = batch ? expectedNumbers(src) : [];
    const gotNumbers = [];
    const seenNumbers = new Set();
    const seenTitles = new Set();

    const addError = (code, detail, extra = {}) => errors.push({ code, detail, ...extra });
    const addWarning = (code, detail, extra = {}) => warnings.push({ code, detail, ...extra });

    items.forEach((item, idx) => {
      if (!item || typeof item !== 'object') { addError('EMPTY_ITEM', '第 ' + (idx + 1) + ' 个条目为空'); return; }
      /* 位置字段（可选）：range 必须在批次范围内 */
      if (item.source && Number.isFinite(Number(item.source.start))) {
        const s = Number(item.source.start), e = Number(item.source.end);
        if (s < 0 || e > src.length || e <= s) addError('SOURCE_RANGE_OUT_OF_BATCH', '条目 ' + (idx + 1) + ' 的 source 区间越界', { itemIndex: idx });
      }
      if (module === 'reading') {
        const typeHint = `${item.readingType || ''} ${item.genre || ''}`.toLowerCase();
        const rtype = /section[-_ ]?a|word.?bank|选词填空/.test(typeHint) ? 'section-a'
          : /section[-_ ]?b|paragraph.?match|段落匹配/.test(typeHint) ? 'section-b'
            : /cloze|完形填空|完型填空/.test(typeHint) ? 'cloze' : 'traditional';
        const title = String(item.title || '').trim();
        if (!title) addError('EMPTY_TITLE', '阅读条目 ' + (idx + 1) + ' 缺少标题');
        if (title && seenTitles.has(title)) addWarning('DUP_TITLE', '阅读标题重复：' + title);
        seenTitles.add(title);
        const questions = Array.isArray(item.questions) ? item.questions : [];
        /* 空题目的片段允许存在（批内二分会产生 body-only 片段）；整批无题号由批级 NO_QUESTIONS 判定 */
        const bank = Array.isArray(item.wordBank) ? item.wordBank.filter(w => w && w.letter) : [];
        if (rtype === 'section-a' && !bank.length) addError('NO_WORD_BANK', (title || '选词填空') + ' 缺少选词词库');
        if (rtype === 'section-a') {
          const bankLetters = new Set(bank.map(w => String(w.letter).toUpperCase()));
          questions.forEach(q => {
            const a = String(q && q.a == null ? '' : q.a).toUpperCase();
            if (a && !bankLetters.has(a)) addError('ANSWER_OUT_OF_BANK', (title || '选词填空') + ' 答案 ' + a + ' 不在词库中');
          });
        }
        if (rtype === 'section-b') {
          const labels = new Set((Array.isArray(item.paragraphs) ? item.paragraphs : [])
            .map(p => p && String(p.label || '').toUpperCase()).filter(Boolean));
          questions.forEach(q => {
            const a = String(q && q.a == null ? '' : q.a).toUpperCase();
            if (a && labels.size && !labels.has(a)) addError('ANSWER_OUT_OF_PARAGRAPHS', (title || '段落匹配') + ' 答案 ' + a + ' 没有对应段落');
          });
        }
        questions.forEach((q, qi) => {
          const num = Number(q && q.number);
          if (Number.isFinite(num)) {
            if (seenNumbers.has(num)) addError('DUP_QUESTION_NUMBER', '题号重复：' + num);
            seenNumbers.add(num);
            gotNumbers.push(num);
          }
          if (rtype === 'traditional' || rtype === 'cloze') {
            const optsArr = Array.isArray(q && q.opts) ? q.opts : [];
            if (optsArr.length !== 4) addError('OPTIONS_NOT_4', (title || '阅读') + ' 第 ' + (q.number || qi + 1) + ' 题选项数 ' + optsArr.length);
            optsArr.forEach((o, oi) => { if (!String(o == null ? '' : o).trim()) addError('EMPTY_OPTION', (title || '阅读') + ' 第 ' + (q.number || qi + 1) + ' 题选项 ' + 'ABCD'[oi] + ' 为空'); });
            if (q && q.a != null && !(Number.isInteger(q.a) && q.a >= 0 && q.a <= 3)) addError('ANSWER_INDEX_INVALID', (title || '阅读') + ' 第 ' + (q.number || qi + 1) + ' 题答案下标非法：' + q.a);
          }
          /* 原文覆盖：题干/选项应能在批次原文中定位（压缩空格标点后包含） */
          const stem = String(q && (q.q || q.statement || '') || '');
          if (stem && loose(stem).length >= 8 && !containsSource(src, stem)) {
            addWarning('STEM_NOT_IN_SOURCE', (title || '阅读') + ' 第 ' + (q.number || qi + 1) + ' 题题干未能在原文定位');
          }
          (Array.isArray(q && q.opts) ? q.opts : []).forEach((o, oi) => {
            const t = String(o == null ? '' : o);
            if (t && loose(t).length >= 3 && !containsSource(src, t)) {
              addWarning('OPTION_NOT_IN_SOURCE', (title || '阅读') + ' 第 ' + (q.number || qi + 1) + ' 题选项 ' + 'ABCD'[oi] + ' 未能在原文定位');
            }
          });
        });
      } else if (module === 'listening') {
        const title = String(item.title || '').trim();
        if (!title) addError('EMPTY_TITLE', '听力材料 ' + (idx + 1) + ' 缺少标题');
        const qs = Array.isArray(item.qs) ? item.qs : [];
        qs.forEach((q, qi) => {
          const num = Number(q && q.number);
          if (Number.isFinite(num)) {
            if (seenNumbers.has(num)) addError('DUP_QUESTION_NUMBER', '听力题号重复：' + num);
            seenNumbers.add(num);
            gotNumbers.push(num);
          }
          const optsArr = Array.isArray(q && q.opts) ? q.opts : [];
          if (optsArr.length !== 4) addError('OPTIONS_NOT_4', (title || '听力') + ' 第 ' + (q.number || qi + 1) + ' 题选项数 ' + optsArr.length);
          if (q && q.a != null && !(Number.isInteger(q.a) && q.a >= 0 && q.a <= 3)) addError('ANSWER_INDEX_INVALID', (title || '听力') + ' 第 ' + (q.number || qi + 1) + ' 题答案下标非法');
          /* 四六级听力卷面本来只印选项、不印题干：q 为空或 "Question N"/范围行占位时只告警，
           * 供上层统计（不要做成 error，否则整批会被判失败）。*/
          const stem = String(q && (q.q || q.statement || '') || '').trim();
          if (!stem) addWarning('STEM_MISSING', (title || '听力') + ' 第 ' + (q.number || qi + 1) + ' 题题干为空');
          else if (isPlaceholderStem(stem)) addWarning('STEM_PLACEHOLDER', (title || '听力') + ' 第 ' + (q.number || qi + 1) + ' 题题干是占位文本');
        });
      } else if (module === 'writing') {
        const prompt = String(item.prompt || '').trim();
        if (prompt.length < 10) addError('EMPTY_PROMPT', '写作题 ' + (idx + 1) + ' 的 prompt 过短或为空');
        if (/translation/i.test(String(item.writingType || '')) && !String(item.translationText || '').trim()) {
          addError('NO_TRANSLATION_TEXT', '翻译题 ' + (idx + 1) + ' 缺少翻译原文');
        }
      }
    });

    /* 题号完整性：以原文推导的期望集合为准（仅 listening/reading；二分出的子批跳过） */
    if (!partial && (module === 'listening' || module === 'reading') && expected.length) {
      const gotSet = new Set(gotNumbers);
      const missing = expected.filter(n => !gotSet.has(n));
      const extra = gotNumbers.filter(n => !expected.includes(n));
      if (missing.length) addError('MISSING_QUESTIONS', '原文有但结果缺题号：' + missing.slice(0, 12).join(',') + (missing.length > 12 ? '…' : ''), { numbers: missing });
      if (extra.length) addError('EXTRA_QUESTIONS', '结果里有原文没有的题号：' + extra.slice(0, 12).join(',') + (extra.length > 12 ? '…' : ''), { numbers: extra });
    }
    /* 整批一道题都没回到（用于"AI 空响应"判定；单个 body-only 片段不算错，批内二分会产生这种片段） */
    if (!partial && module === 'reading' && expected.length && gotNumbers.length === 0) {
      addError('NO_QUESTIONS', '整批没有识别出任何题号');
    }

    const totalOpts = items.reduce((s, it) => s + ((Array.isArray(it && it.opts) ? it.opts.length : 0) + (Array.isArray(it && it.questions) ? it.questions.reduce((s2, q) => s2 + (Array.isArray(q && q.opts) ? q.opts.length : 0), 0) : 0)), 0);
    const stats = {
      items: items.length,
      questions: gotNumbers.length,
      expectedQuestions: expected.length,
      uncoveredStems: warnings.filter(w => w.code === 'STEM_NOT_IN_SOURCE').length,
      uncoveredOptions: warnings.filter(w => w.code === 'OPTION_NOT_IN_SOURCE').length,
      missingStems: warnings.filter(w => w.code === 'STEM_MISSING').length,
      placeholderStems: warnings.filter(w => w.code === 'STEM_PLACEHOLDER').length,
      options: totalOpts,
    };
    return { ok: errors.length === 0, module, items, errors, warnings, stats };
  }

  /** 在 30%~70% 区间内选最佳切点把文本一分为二（批内二分的最后手段） */
  function splitTextHalves(text) {
    const s = String(text || '');
    if (s.length < 800) return null;
    const min = Math.floor(s.length * 0.30), max = Math.ceil(s.length * 0.70);
    const cuts = [];
    let m;
    const blank = /\n\s*\n/g;
    while ((m = blank.exec(s))) { const cut = m.index + m[0].length; if (cut >= min && cut <= max) cuts.push({ cut, rank: 3 }); }
    const qline = /\n(?=\s*(?:\d\s*){1,3}\s*[.、)）])/g;
    while ((m = qline.exec(s))) { const cut = m.index + 1; if (cut >= min && cut <= max) cuts.push({ cut, rank: 2 }); }
    const sent = /[.!?。！？]["'”’)]?\s+/g;
    while ((m = sent.exec(s))) { const cut = m.index + m[0].length; if (cut >= min && cut <= max) cuts.push({ cut, rank: 1 }); }
    let cut = -1;
    if (cuts.length) cut = cuts.sort((a, b) => b.rank - a.rank || Math.abs(a.cut - s.length / 2) - Math.abs(b.cut - s.length / 2))[0].cut;
    if (cut < 0) {
      const space = s.lastIndexOf(' ', Math.floor(s.length / 2));
      cut = space >= min && space <= max ? space + 1 : Math.floor(s.length / 2);
    }
    const left = s.slice(0, cut).trimEnd();
    const right = s.slice(cut).trimStart();
    return left && right ? [left, right] : null;
  }

  /** 把批次一分为二（只用于批内二分兜底；页码为近似继承，字符区间仍精确） */
  function splitBatch(batch) {
    const halves = splitTextHalves(batch && batch.text);
    if (!halves) return null;
    const [leftText, rightText] = halves;
    const left = {
      ...batch, text: leftText,
      end: batch.start + leftText.length,
      continuation: !!batch.continuation,
    };
    const right = {
      ...batch, text: rightText,
      start: batch.start + leftText.length, end: batch.end,
      title: '', continuation: true,
    };
    return [left, right];
  }

  /** 从原文按题号抽出题干与 A-D 选项（修复 AI 漏题/漏选项用；只取有选项的题） */
  function numberedQuestions(text) {
    const src = normalize(text);
    const lines = src.split('\n');
    const map = new Map();
    let cur = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!cur && !trimmed) continue;
      if (HEADING_RE.test(trimmed) && !QUESTION_LINE_RE.test(trimmed)) { cur = null; continue; }
      const m = trimmed.match(QUESTION_LINE_RE);
      if (m) {
        const n = Number(String(m[1]).replace(/\s+/g, ''));
        if (!Number.isFinite(n) || n <= 0 || n >= 1000) continue;
        const stem = trimmed.slice(m[0].length).trim();
        cur = map.get(n) || { number: n, stem, opts: [] };
        if (!cur.stem) cur.stem = stem;
        map.set(n, cur);
        continue;
      }
      if (!cur) continue;
      const o = trimmed.match(/^([A-D])\s*[.)、）]\s*(.+)$/);
      if (o) {
        const idx = 'ABCD'.indexOf(o[1].toUpperCase());
        if (idx >= 0 && !cur.opts[idx]) cur.opts[idx] = o[2].trim();
        continue;
      }
      if (!cur.opts.some(Boolean) && trimmed && cur.stem.length < 400) cur.stem = (cur.stem + ' ' + trimmed).trim();
    }
    return map;
  }

  /**
   * 失败批的本地兜底：不改写 AI 已给出的正确内容，只从原文补齐——
   *   · 缺选项：按题号找回 A-D 选项并补齐；
   *   · 漏题（仅阅读，且批次不是 Section A/B）：从原文题号行直接生成题目（答案 a=null）。
   * @returns {{result:object, repairs:Array<{code,detail,question?}>}}
   */
  function repairFromSource(result, batch, opts = {}) {
    const src = (batch && batch.text) || '';
    const module = String(opts.module || (batch && batch.module) || 'reading');
    const parsed = numberedQuestions(src);
    const items = Array.isArray(result && result.items) ? result.items.map(it => JSON.parse(JSON.stringify(it))) : [];
    const repairs = [];
    const expected = expectedNumbers(src);
    const have = new Set();

    const fillOptions = (q, label) => {
      const num = Number(q && q.number);
      if (!Number.isFinite(num)) return;
      have.add(num);
      const info = parsed.get(num);
      if (!info || !info.opts.some(Boolean)) return;
      const current = Array.isArray(q.opts) ? q.opts.slice() : [];
      let changed = false;
      for (let i = 0; i < 4; i++) {
        if ((current[i] == null || String(current[i]).trim() === '') && info.opts[i]) { current[i] = info.opts[i]; changed = true; }
      }
      while (current.length < 4 && info.opts[current.length]) { current.push(info.opts[current.length]); changed = true; }
      if (changed) {
        q.opts = current.slice(0, 4);
        repairs.push({ code: 'FILLED_OPTIONS', question: num, detail: label + ' 第 ' + num + ' 题从原文回填选项' });
      }
    };

    /* 听力题干回填：只有原文里真的按题号印了题干才回填；16.A)... 这种选项行会被
     * numberedQuestions 当成题干，必须排除，避免把选项文本填进题干。*/
    const fillStem = (q, label) => {
      const num = Number(q && q.number);
      if (!Number.isFinite(num)) return;
      const current = String(q && q.q == null ? '' : q.q).trim();
      if (current && !isPlaceholderStem(current)) return;   // AI 已给出真实题干：不动
      const info = parsed.get(num);
      const stem = String(info && info.stem || '').trim();
      if (!stem || /^[A-D]\s*[.)、）]/.test(stem) || isPlaceholderStem(stem)) return;
      q.q = stem;
      repairs.push({ code: 'FILLED_STEM', question: num, detail: label + ' 第 ' + num + ' 题从原文回填题干' });
    };

    items.forEach((item, idx) => {
      const label = String(item && (item.title || item.readingType) || ('条目' + (idx + 1)));
      if (module === 'listening') {
        (Array.isArray(item.qs) ? item.qs : []).forEach(q => { fillOptions(q, label); fillStem(q, label); });
        return;
      }
      const typeHint = `${item.readingType || ''} ${item.genre || ''}`.toLowerCase();
      const rtype = /section[-_ ]?a|word.?bank|选词填空/.test(typeHint) ? 'section-a'
        : /section[-_ ]?b|paragraph.?match|段落匹配/.test(typeHint) ? 'section-b'
          : /cloze|完形填空|完型填空/.test(typeHint) ? 'cloze' : 'traditional';
      if (rtype === 'section-a' || rtype === 'section-b') return;   // 词库/段落匹配不漏选项，不硬填
      (Array.isArray(item.questions) ? item.questions : []).forEach(q => fillOptions(q, label));
    });

    /* 阅读漏题：从原文题号行补题（只在批次不含 Section A/B 时做，避免把词库字母当选项） */
    if (module === 'reading' && !/section\s+[ab]\b/i.test(src)) {
      const missing = expected.filter(n => !have.has(n) && parsed.has(n) && parsed.get(n).opts.filter(Boolean).length === 4);
      if (missing.length) {
        const title = (batch && batch.title) || '本地规则回填';
        items.push({
          readingType: 'traditional', title, genre: '导入', paragraphs: [],
          questions: missing.sort((a, b) => a - b).map(n => ({
            number: n,
            q: parsed.get(n).stem || ('第 ' + n + ' 题'),
            opts: parsed.get(n).opts.slice(0, 4),
            a: null,
          })),
        });
        repairs.push({ code: 'LOCAL_BACKFILL', detail: '从原文回填漏题：' + missing.join(',') });
      }
    }
    return { result: { ...(result || {}), module, items }, repairs };
  }

  /** 稳定哈希（FNV-1a 32bit），用于批次缓存 key */
  function hashText(text) {
    const s = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /** 批次缓存 key：原文 + 模块 + 类型 + prompt 版本 */
  function batchKey(batch, meta, promptVersion) {
    return 'ibc-' + hashText([batch && batch.text, batch && batch.module, meta && meta.type, promptVersion].join('\u0001'));
  }

  window.ImportPipeline = {
    LIMIT_DEFAULT, CONTEXT_TAIL,
    normalize, loose, containsSource, pageOf,
    moduleOfHeading, expectedNumbers, buildBatches, splitLongBlock, validateBatch,
    numberedQuestions, repairFromSource, hashText, batchKey, questionSpans, isPlaceholderStem,
    splitTextHalves, splitBatch,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = window.ImportPipeline;
})();

