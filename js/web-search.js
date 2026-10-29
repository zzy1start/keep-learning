/* ============ web-search.js : 联网搜索 + 网页正文抽取 ============
 * 用途：听力/阅读页「导入后自动补原文/题干」——先用 Bing 搜真题原文，再把候选页
 * 正文抽成纯文本，交给调用方做关键词打分或 AI 归纳。
 *
 * 环境说明：
 *   - 平板 App（Capacitor）里 js/native-http.js 会把外网 fetch 转给原生 CapacitorHttp，
 *     没有 CORS 限制；PWA/桌面浏览器直连 Bing 会被 CORS 拦，这里记入 errors 返回空结果，
 *     不影响调用方（失败要优雅）。
 *   - 被搜站点偶尔用 GBK 编码，CapacitorHttp 按 UTF-8 解码后中文可能乱码；英文
 *     Tapescript 正文是 ASCII，不受影响。
 *
 * 接口（浏览器 window.WebSearch / Node module.exports）：
 *   buildQueries(meta)               -> string[] 3~5 条中英文搜索词（纯函数）
 *   bingUrl(query)                   -> string
 *   parseBingResults(html)           -> [{url,title}] 最多 10 条（纯函数，无 DOM）
 *   extractArticleText(html)         -> string 正文纯文本，保留英文句子换行（纯函数）
 *   searchWeb(queries, opts)         -> Promise<{results,errors,tried}>
 *   collectTranscriptText(meta, opts)-> Promise<{text,sources,errors,tried}>
 *
 * 纯函数不依赖 DOM，可在 Node 里直接 require 测试；网络只走全局 fetch。
 */
(function () {
  'use strict';

  /* 桌面 UA：Bing 对移动 UA 返回不同结构，这里用桌面版结果页（b_algo 结构稳定）。 */
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7';
  const REQUEST_TIMEOUT = 12000;      // 每请求 12s
  const DEFAULT_MAX_QUERIES = 2;
  const DEFAULT_MAX_PAGES = 5;
  const DEFAULT_MAX_CHARS = 24000;    // collectTranscriptText 拼接上限
  const MIN_ARTICLE_TEXT = 500;       // 正文短于 500 字符视为无效页
  const MAX_RESULTS = 10;             // parseBingResults 最多返回条数
  const MAX_KEYWORD_HITS = 5;         // 单个关键词最多计 5 次，避免刷分

  const LEVEL_LABEL = { cet6: '六级', cet4: '四级', kaoyan: '考研英语' };
  const LEVEL_EN = { cet6: 'CET6', cet4: 'CET4', kaoyan: 'Postgraduate English Exam' };
  const MONTH_EN = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  /* 结果里必须剔掉的 Bing/微软/msn 站内链接（host 后缀匹配）。 */
  const SITE_HOST_RE = /(?:^|\.)(?:bing\.com|microsoft\.com|msn\.com|microsofttranslator\.com|live\.com)$/i;

  /* 整块删除的噪音标签：脚本/样式/导航/页头页脚/嵌入框等。 */
  const NOISE_BLOCK_RE = /<(script|style|noscript|template|svg|iframe|nav|header|footer|form|aside|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const NOISE_OPEN_RE = /<(?:script|style|noscript|template|svg|iframe|nav|header|footer|form|aside|button)\b[^>]*\/?>/gi;
  const BLOCK_CLOSE_RE = /<\/(?:p|div|section|article|main|li|ul|ol|dl|dd|dt|tr|td|th|table|thead|tbody|h[1-6]|blockquote|pre|figure|figcaption|address|center)\s*>/gi;
  const BLOCK_OPEN_RE = /<(?:p|div|section|article|main|li|ul|ol|dl|dd|dt|tr|table|thead|tbody|h[1-6]|blockquote|pre|figure|figcaption|address|center)\b[^>]*>/gi;
  const BR_RE = /<br\s*\/?>/gi;
  const ANY_TAG_RE = /<[^>]*>/g;

  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
    thinsp: ' ', shy: '', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—',
    ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
    laquo: '«', raquo: '»', middot: '·', bull: '•', dagger: '†', permil: '‰',
    deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', sup2: '²',
    sup3: '³', micro: 'µ', para: '¶', sect: '§', euro: '€', pound: '£',
    yen: '¥', cent: '¢', iexcl: '¡', iquest: '¿', not: '¬', larr: '←', rarr: '→',
    uarr: '↑', darr: '↓', harr: '↔', prime: '′', Prime: '″', dagger2: '‡',
  };

  /* ---------------- 纯函数：HTML 实体 ---------------- */

  function decodeEntities(input) {
    if (input == null) return '';
    let text = String(input);
    text = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, function (all, body) {
      if (body.charAt(0) === '#') {
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!isFinite(code) || code <= 0 || code > 0x10ffff) return all;
        try { return String.fromCodePoint(code); } catch (e) { return all; }
      }
      const named = NAMED_ENTITIES[body];
      if (named != null) return named;
      const lower = NAMED_ENTITIES[body.toLowerCase()];
      return lower != null ? lower : all;
    });
    /* 真实页面里偶有漏写分号的数字实体（&#8217 / &#x27），兜底解一次。 */
    text = text.replace(/&#x([0-9a-fA-F]{2,6})(?![0-9a-fA-F]);?/g, function (all, hex) {
      const code = parseInt(hex, 16);
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return all;
      try { return String.fromCodePoint(code); } catch (e) { return all; }
    });
    text = text.replace(/&#([0-9]{2,7})(?![0-9]);?/g, function (all, dec) {
      const code = parseInt(dec, 10);
      if (!isFinite(code) || code <= 0 || code > 0x10ffff) return all;
      try { return String.fromCodePoint(code); } catch (e) { return all; }
    });
    return text;
  }

  function stripTagsToText(html) {
    return decodeEntities(String(html || '').replace(ANY_TAG_RE, ' ')).replace(/\s+/g, ' ').trim();
  }

  /* ---------------- meta 解析 ---------------- */

  function yearOf(value) {
    const n = Number(value);
    if (!isFinite(n)) return '';
    const year = Math.floor(n);
    return year >= 1990 && year <= 2100 ? String(year) : '';
  }

  function monthOf(session) {
    const text = String(session == null ? '' : session).trim();
    if (!/^\d{1,2}$/.test(text)) return 0;   // 'other' / 空 / 非数字都不出月份
    const month = Number(text);
    return month >= 1 && month <= 12 ? month : 0;
  }

  function setNoOf(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    const setNo = Math.floor(n);
    return setNo >= 1 && setNo <= 20 ? setNo : 0;
  }

  function cleanTitle(title) {
    return String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* ---------------- 搜索词 ---------------- */

  function buildQueries(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const level = LEVEL_LABEL[m.type] || '英语';
    const year = yearOf(m.year);
    const month = monthOf(m.session);
    const setNo = setNoOf(m.setNo);
    const title = cleanTitle(m.title);
    const period = (year ? year + '年' : '') + (month ? month + '月' : '');
    const setText = setNo ? '第' + setNo + '套' : '';
    const join = function () {
      const parts = [];
      for (let i = 0; i < arguments.length; i++) {
        const part = arguments[i] == null ? '' : String(arguments[i]).trim();
        if (part) parts.push(part);
      }
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    };

    /* 【2026-10-26 实网验证】搜索词越“精确”越容易在中文引擎里查不到：
     * 实测 "…Tapescript 第1套" 在 Bing 返回了一批完全无关的数学题结果，
     * 而 "2023年12月 六级 听力原文" 在百度/搜狗/360 都能命中新东方/文库的原文页。
     * 所以把最宽的词放第一条，专用词放后面，由调用方按 maxQueries 取前 N 条。*/
    const raw = [
      /* 第一条**不带套数**：实测 Bing 对 "…听力原文 第1套" 会返回无关结果，
       * 而 "2023年12月 六级 听力原文" 能直接命中懒笔记/新东方的整页原文；
       * 套数放到第二条，由调用方按需取用。*/
      join(period, level, '听力原文'),
      join(period, level, '听力原文 Tapescript', setText),
      join(period, level, '听力 真题原文', setText),
      title ? join(period, level, '听力原文', title) : '',
      join(LEVEL_EN[m.type] || '', year, month ? MONTH_EN[month] : '', 'listening transcript',
        setText ? 'Set ' + setNo : ''),
    ];

    const queries = [];
    for (let i = 0; i < raw.length; i++) {
      const query = raw[i];
      if (query && queries.indexOf(query) < 0) queries.push(query);
    }
    return queries.slice(0, 5);
  }

  function bingUrl(query) {
    return 'https://www.bing.com/search?q=' + encodeURIComponent(String(query == null ? '' : query)) + '&setlang=zh-CN';
  }

  /* ---------------- 纯函数：Bing 结果解析 ---------------- */

  function normalizeUrl(url) {
    return String(url == null ? '' : url).trim().replace(/#.*$/, '');
  }

  function hostOf(url) {
    const text = String(url == null ? '' : url);
    try {
      if (typeof URL === 'function') return new URL(text).hostname.toLowerCase();
    } catch (e) { /* 退回正则 */ }
    const m = /^https?:\/\/([^/?#:]+)/i.exec(text);
    return m ? m[1].toLowerCase() : '';
  }

  /* Bing 有时把自然结果包成 /ck/a?u=a1<base64url> 再跳转；解出真实外部链接，
   * 解不出就保留原样，由域名过滤决定去留（aclk 广告不在这里解）。 */
  function unwrapBingLink(url) {
    if (!/^https?:\/\/(?:[^/]+\.)?bing\.com\/ck\/a(?:[?#]|$)/i.test(url)) return url;
    const m = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(url);
    if (!m) return url;
    try {
      let raw = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (raw.length % 4) raw += '=';
      let decoded = '';
      if (typeof atob === 'function') decoded = atob(raw);
      else if (typeof Buffer !== 'undefined') decoded = Buffer.from(raw, 'base64').toString('binary');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    } catch (e) { /* 保留原链接 */ }
    return url;
  }

  function isAdContext(html, index) {
    const before = html.slice(0, index);
    const li = before.lastIndexOf('<li');
    if (li < 0) return false;
    if (before.lastIndexOf('</li>') > li) return false;   // 最近的 li 已闭合，不在 li 内
    const end = before.indexOf('>', li);
    const tag = end < 0 ? '' : before.slice(li, end + 1);
    return /\bb_ad\b/i.test(tag);
  }

  function parseBingResults(html) {
    const results = [];
    if (typeof html !== 'string' || !html) return results;
    const seen = Object.create(null);
    const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
    let h2;
    while ((h2 = h2Re.exec(html))) {
      if (results.length >= MAX_RESULTS) break;
      const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i.exec(h2[1]);
      if (!anchor) continue;
      const rawHref = decodeEntities(anchor[1] != null ? anchor[1] : anchor[2]).trim();
      if (!/^https?:\/\//i.test(rawHref)) continue;
      if (isAdContext(html, h2.index)) continue;
      const url = unwrapBingLink(rawHref);
      const host = hostOf(url);
      if (!host || SITE_HOST_RE.test(host)) continue;      // Bing/微软/msn 自身链接
      const title = stripTagsToText(anchor[3]);
      if (!title) continue;
      const key = normalizeUrl(url);
      if (seen[key]) continue;
      seen[key] = true;
      results.push({ url: url, title: title });
    }
    return results;
  }

  /* ---------------- 纯函数：多引擎结果解析（百度/搜狗/360） ----------------
   * 【为什么加】中文环境下 Bing 对“真题原文”这类长尾词的召回很差（实测返回无关结果），
   * 而百度/搜狗/360 都能命中新东方、文库、B站的原文页。多引擎按顺序回退，
   * 任一引擎抓到可用正文就停，避免全挂在一个引擎上。
   * 这些解析器只做“结果块 → {url,title}”，不判断相关性；相关性交给关键词打分。*/

  /** 通用：把 <h3> 结果块里的第一个外链抽出来。opts.resolveUrl 处理相对跳转链接。 */
  function parseResultBlocks(html, opts) {
    const out = [];
    if (typeof html !== 'string' || !html) return out;
    const options = opts || {};
    const seen = Object.create(null);
    const h3Re = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
    let block;
    while ((block = h3Re.exec(html)) && out.length < MAX_RESULTS) {
      const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i.exec(block[1]);
      if (!anchor) continue;
      let url = decodeEntities(anchor[1] != null ? anchor[1] : anchor[2]).trim();
      const title = stripTagsToText(anchor[3]);
      if (!title) continue;
      if (options.resolveUrl) url = options.resolveUrl(url);
      if (!/^https?:\/\//i.test(url)) continue;
      const host = hostOf(url);
      if (!host) continue;
      if (options.rejectHost && options.rejectHost.test(host) && !(options.acceptPath && options.acceptPath.test(url))) continue;
      const key = normalizeUrl(url);
      if (seen[key]) continue;
      seen[key] = true;
      out.push({ url: url, title: title });
    }
    return out;
  }

  /** 百度：h3 里是 www.baidu.com/link?url=… 跳转，跟随 302 由 fetch 完成。 */
  function parseBaiduResults(html) {
    return parseResultBlocks(html, {
      rejectHost: /(?:^|\.)baidu\.com$/i,
      acceptPath: /\/link\?url=|\/baidu\.php\?url=/i,
    });
  }

  /** 搜狗：h3 里是相对链接 /link?url=…，补上 https://www.sogou.com。 */
  function parseSogouResults(html) {
    return parseResultBlocks(html, {
      resolveUrl: function (url) {
        if (/^\/link\?/i.test(url)) return 'https://www.sogou.com' + url;
        if (/^https?:\/\/[^/]*sogou\.com\/link\?/i.test(url)) return url;
        return url;
      },
      rejectHost: /(?:^|\.)sogou\.com$/i,
      acceptPath: /\/link\?url=/i,
    });
  }

  /** 360：h3 里是 https://www.so.com/link?m=… 跳转；wenku.so.com 站内搜索页不算正文页。 */
  function parseSo360Results(html) {
    return parseResultBlocks(html, {
      resolveUrl: function (url) {
        if (/^\/link\?/i.test(url)) return 'https://www.so.com' + url;
        return url;
      },
      rejectHost: /(?:^|\.)so\.com$/i,
      acceptPath: /\/link\?m=/i,
    });
  }

  /* ---------------- 纯函数：正文抽取 ---------------- */

  function extractArticleText(html) {
    if (typeof html !== 'string' || !html) return '';
    let text = html.replace(/\r\n?/g, '\n');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(NOISE_BLOCK_RE, ' ');
    text = text.replace(NOISE_OPEN_RE, ' ');
    text = text.replace(BR_RE, '\n');
    text = text.replace(BLOCK_CLOSE_RE, '\n');
    text = text.replace(BLOCK_OPEN_RE, '\n');
    /* 【2026-10-29 修复】行内标签不能直接删掉：
     * 一些听力原文页把每个单词包在 <span> 里（<span>That</span><span>sounds</span>），
     * 标签一删就粘成 "Thatsoundsamazing"，AI 切出的原文/证据句与候选正文逐字对不上，
     * 原文被整段丢弃，而同一份'没核验'的正文又被拿去抽题干 → 写出
     * "*M*:Thatsoundsamazing.Doyouhavetorelocate?" 这类假题干（用户 2026-10-29 报错）。
     * 改成用空格分隔，再收紧标点前的空白，英文单词就不会跨标签粘连。*/
    text = text.replace(ANY_TAG_RE, ' ');
    text = decodeEntities(text);
    text = text.split('\n').map(function (line) {
      return line
        .replace(/[\t\f\v\u00a0 ]+/g, ' ')
        .replace(/\s+([,.;:!?%])/g, '$1')
        .replace(/^\s+|\s+$/g, '');
    }).filter(function (line, i, all) {
      /* 保留段落之间至多一个空行；行首行尾空行去掉 */
      if (line) return true;
      return i > 0 && i < all.length - 1 && all[i - 1] !== '';
    }).join('\n');
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------- 网络 ---------------- */

  function makeError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }

  function describeError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    if (error.name === 'AbortError') return 'timeout';
    if (error.code) return String(error.code);
    return String(error.message || error);
  }

  function readContentType(res) {
    const headers = res && res.headers;
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') {
        const value = headers.get('content-type');
        return value == null ? '' : String(value);
      }
      return String(headers['content-type'] || headers['Content-Type'] || '');
    } catch (e) {
      return '';
    }
  }

  function isHtmlContentType(contentType) {
    const text = String(contentType || '').toLowerCase();
    if (!text) return true;    // 头缺失时不武断拒绝，交给正文长度把关
    return /(?:text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)/.test(text);
  }

  /**
   * 搜狗/360 的 /link?url= 跳转页不返回 302，而是 HTTP 200 + 一段脚本：
   *   <script>window.location.replace("https://…")</script>
   *   <noscript><META http-equiv="refresh" content="0;URL='https://…'"></noscript>
   * 不跟这一步就只剩 270 字，正文全丢。这里抽出目标地址，跟一跳。
   * 只接受 http(s)，且只跟一跳，避免循环。
   */
  function redirectTarget(html) {
    if (typeof html !== 'string' || !html) return '';
    if (html.length > 4000) return '';                 // 正常正文页不会这么短，这里只管跳转壳
    const patterns = [
      /window\.location\.replace\(\s*["']([^"']+)["']/i,
      /window\.location\.href\s*=\s*["']([^"']+)["']/i,
      /location\.replace\(\s*["']([^"']+)["']/i,
      /http-equiv=["']?refresh["']?[^>]*content=["'][^"']*URL=['"]?([^"'\s>]+)/i,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = patterns[i].exec(html);
      if (!m) continue;
      const target = decodeEntities(String(m[1] || '')).trim();
      if (/^https?:\/\//i.test(target)) return target;
    }
    return '';
  }

  async function fetchPage(url, timeoutMs) {
    const fetchImpl = typeof fetch === 'function' ? fetch : null;
    if (!fetchImpl) throw makeError('fetch-unavailable');
    let controller = null;
    if (typeof AbortController === 'function') {
      try { controller = new AbortController(); } catch (e) { controller = null; }
    }
    let timer = null;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) { /* ignore */ } }
        reject(makeError('timeout'));
      }, timeoutMs);
    });
    const task = (async function () {
      const init = {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: ACCEPT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      };
      if (controller) init.signal = controller.signal;
      const res = await fetchImpl(url, init);
      if (!res) throw makeError('no-response');
      const status = Number(res.status || 0);
      if (status >= 400) throw makeError('HTTP ' + status);
      const contentType = readContentType(res);
      let text = '';
      if (typeof res.text === 'function') text = String(await res.text());
      else if (typeof res.body === 'string') text = res.body;
      else if (res.data != null) text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      /* 跳转壳（搜狗/360 常见）→ 跟一跳拿真正文 */
      const hop = text.length < 4000 ? redirectTarget(text) : '';
      if (hop && hop !== url) {
        try {
          const second = await fetchImpl(hop, Object.assign({}, init, { headers: Object.assign({}, init.headers, { Referer: url }) }));
          if (second && Number(second.status || 0) < 400) {
            const secondType = readContentType(second);
            let secondText = '';
            if (typeof second.text === 'function') secondText = String(await second.text());
            else if (second.body === 'string') secondText = second.body;
            if (secondText) return { url: hop, status: Number(second.status || 0), contentType: secondType, text: secondText };
          }
        } catch (e) { /* 跟跳失败就返回跳转壳，由调用方按正文长度判无效 */ }
      }
      return { url: url, status: status, contentType: contentType, text: text };
    })();
    task.catch(function () { /* 超时先到时不产生 unhandled rejection */ });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------------- 打分 ---------------- */

  function normalizeKeywords(keywords) {
    if (keywords == null) return [];
    const list = Array.isArray(keywords) ? keywords : [keywords];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const keyword = String(list[i] == null ? '' : list[i]).trim();
      if (keyword && out.indexOf(keyword) < 0) out.push(keyword);
    }
    return out;
  }

  function scoreText(text, keywords) {
    if (!text || !keywords.length) return 0;
    const hay = String(text).toLowerCase();
    let score = 0;
    for (let i = 0; i < keywords.length; i++) {
      const needle = keywords[i].toLowerCase();
      if (!needle) continue;
      let hits = 0;
      let from = 0;
      while (hits < MAX_KEYWORD_HITS) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        hits++;
        from = at + needle.length;
      }
      score += hits;
    }
    return score;
  }

  function defaultKeywords(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const out = [];
    if (m.title) out.push(cleanTitle(m.title));
    const level = LEVEL_LABEL[m.type];
    if (level) out.push(level);
    const year = yearOf(m.year);
    if (year) out.push(year);
    const month = monthOf(m.session);
    if (month) out.push(month + '月');
    out.push('Tapescript', '听力原文');
    return out;
  }

  /* ---------------- 搜索引擎注册表 ----------------
   * 默认只用 bing（历史行为，单元测试与 PWA 兼容）；
   * 听力自动补全会显式传 engines:['bing','baidu','sogou','so360']，
   * 按顺序回退：一个引擎抓不到可用正文才换下一个。*/
  const ENGINES = {
    bing: { id: 'bing', url: function (query) { return bingUrl(query); }, parse: parseBingResults },
    baidu: {
      id: 'baidu',
      url: function (query) { return 'https://www.baidu.com/s?wd=' + encodeURIComponent(String(query == null ? '' : query)); },
      parse: parseBaiduResults,
    },
    sogou: {
      id: 'sogou',
      url: function (query) { return 'https://www.sogou.com/web?query=' + encodeURIComponent(String(query == null ? '' : query)); },
      parse: parseSogouResults,
    },
    so360: {
      id: 'so360',
      url: function (query) { return 'https://www.so.com/s?q=' + encodeURIComponent(String(query == null ? '' : query)); },
      parse: parseSo360Results,
    },
  };
  const ENGINE_ORDER = ['bing', 'baidu', 'sogou', 'so360'];

  function normalizeEngines(value) {
    if (typeof value === 'string') value = [value];
    const out = [];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const id = String(value[i] == null ? '' : value[i]).trim().toLowerCase();
        if (id && ENGINES[id] && out.indexOf(id) < 0) out.push(id);
      }
    }
    return out.length ? out : ['bing'];
  }

  /* ---------------- 搜索主流程 ---------------- */

  function normalizeQueries(queries) {
    if (typeof queries === 'string') queries = [queries];
    if (!Array.isArray(queries)) return [];
    const out = [];
    for (let i = 0; i < queries.length; i++) {
      const query = String(queries[i] == null ? '' : queries[i]).replace(/\s+/g, ' ').trim();
      if (query && out.indexOf(query) < 0) out.push(query);
    }
    return out;
  }

  function positiveInt(value, fallback, min, max) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  /**
   * 搜索并抓取候选页正文。
   * @param {string[]|string} queries
   * @param {{maxQueries?:number,maxPages?:number,keywords?:string[]|string,timeoutMs?:number}} [opts]
   * @returns {Promise<{results:Array<{url:string,title:string,text:string,score:number}>,
   *   errors:Array<{url:string,error:string}>, tried:number}>}
   *   tried = 实际尝试抓取的候选正文页数（不含 Bing 搜索页）。
   */
  /**
   * 搜索并抓取候选页正文。
   * opts.engines: 引擎顺序（默认 ['bing']；听力自动补全传 4 个引擎依次回退）。
   * opts.maxTries: 跨引擎抓正文页的总上限（0 = 不限制）。
   * 一个引擎抓不到任何可用正文时才换下一个；任一引擎成功即停。
   */
  async function searchWeb(queries, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const queryList = normalizeQueries(queries);
    const maxQueries = positiveInt(options.maxQueries, DEFAULT_MAX_QUERIES, 1, 10);
    const maxPages = positiveInt(options.maxPages, DEFAULT_MAX_PAGES, 1, 20);
    const timeoutMs = positiveInt(options.timeoutMs, REQUEST_TIMEOUT, 1, 120000);
    const keywords = normalizeKeywords(options.keywords);
    const engines = normalizeEngines(options.engines);
    const maxTries = positiveInt(options.maxTries, 0, 0, 60);
    /* 主题门槛：给了正则时，正文必须命中才算“可用结果”，否则跳过并试下一个引擎。
     * 听力自动补全用它挡掉 Bing 偶尔返回的完全无关页（字符表/数学题）。*/
    let requireMatch = null;
    if (options.requireMatch instanceof RegExp) requireMatch = options.requireMatch;
    else if (typeof options.requireMatch === 'string' && options.requireMatch) {
      try { requireMatch = new RegExp(options.requireMatch, 'i'); } catch (e) { requireMatch = null; }
    }
    const errors = [];
    const results = [];
    const seen = Object.create(null);
    let tried = 0;

    if (!queryList.length) return { results: [], errors: [], tried: 0 };
    const searched = queryList.slice(0, maxQueries);

    for (let e = 0; e < engines.length; e++) {
      if (results.length) break;
      const engine = ENGINES[engines[e]];
      if (!engine) continue;
      const candidates = [];
      for (let i = 0; i < searched.length; i++) {
        const searchUrl = engine.url(searched[i]);
        let page;
        try {
          page = await fetchPage(searchUrl, timeoutMs);
        } catch (error) {
          errors.push({ url: searchUrl, error: describeError(error), engine: engine.id });
          continue;
        }
        if (!isHtmlContentType(page.contentType)) {
          errors.push({ url: searchUrl, error: 'non-html' + (page.contentType ? ' (' + page.contentType + ')' : ''), engine: engine.id });
          continue;
        }
        let found = [];
        try { found = engine.parse(page.text) || []; } catch (error) { found = []; }
        if (!found.length) {
          errors.push({ url: searchUrl, error: 'no-results', engine: engine.id });
          continue;
        }
        for (let j = 0; j < found.length && candidates.length < maxPages; j++) {
          const key = normalizeUrl(found[j].url);
          if (seen[key]) continue;
          seen[key] = true;
          candidates.push(found[j]);
        }
        if (candidates.length >= maxPages) break;
      }
      if (!candidates.length) continue;      // 这个引擎没有结果，换下一个

      for (let i = 0; i < candidates.length; i++) {
        if (maxTries && tried >= maxTries) break;
        const candidate = candidates[i];
        tried++;
        let page;
        try {
          page = await fetchPage(candidate.url, timeoutMs);
        } catch (error) {
          errors.push({ url: candidate.url, error: describeError(error), engine: engine.id });
          continue;
        }
        if (!isHtmlContentType(page.contentType)) {
          errors.push({ url: candidate.url, error: 'non-html' + (page.contentType ? ' (' + page.contentType + ')' : ''), engine: engine.id });
          continue;
        }
        let text = '';
        try { text = extractArticleText(page.text); } catch (err) { text = ''; }
        if (!text) {
          errors.push({ url: candidate.url, error: 'empty', engine: engine.id });
          continue;
        }
        if (text.length < MIN_ARTICLE_TEXT) {
          errors.push({ url: candidate.url, error: 'too-short', engine: engine.id });
          continue;
        }
        if (requireMatch && !requireMatch.test(text)) {
          errors.push({ url: candidate.url, error: 'off-topic', engine: engine.id });
          continue;
        }
        results.push({
          url: candidate.url,
          title: candidate.title,
          text: text,
          score: scoreText(text, keywords),
        });
      }
      /* 本引擎抓不到可用正文 → 换下一个引擎继续（errors 保留，便于 UI 说明原因） */
    }

    results.sort(function (a, b) { return b.score - a.score; });
    return { results: results, errors: errors, tried: tried };
  }

  /* ---------------- 直连原文源（按页面 URL 规律，2026-10-29） ---------------- */

  /* 「自动联网补全原文」过去只靠搜索引擎召回：实测 2025-06 六级第 1 套原文页
   * （懒笔记 english-exam.lazynote.cn）明明存在，但 Bing/百度/搜狗/360 在当期都可能
   * 返回广告页/无关 docx，导致原文补不进来、题干只能从错误正文里硬抽。
   * 这里按已知站的 URL 规律先直连一次（失败再回退搜索），把“能确定地址的原文”补上。*/
  const DIRECT_SOURCES = [
    {
      id: 'lazynote',
      name: '懒笔记',
      host: 'english-exam.lazynote.cn',
      path: function (type, year, month, setNo) {
        var mm = month < 10 ? '0' + month : String(month);
        return '/' + type + '/sections/listening/' + year + '-' + mm + '-' + setNo + '/';
      },
    },
  ];

  /** 按试卷身份生成直连原文页 URL（纯函数）：cet4/cet6 + 年 + 月 + 套号。 */
  function transcriptPageUrls(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    const type = String(m.type || '').toLowerCase();
    if (type !== 'cet4' && type !== 'cet6') return [];
    const year = yearOf(m.year);
    const month = monthOf(m.session);
    if (!year || !month) return [];
    const setNo = setNoOf(m.setNo);
    const sets = setNo ? [setNo] : [1, 2, 3];   // 没识别出套号时依次试 1~3 套
    const out = [];
    for (let s = 0; s < DIRECT_SOURCES.length; s++) {
      const src = DIRECT_SOURCES[s];
      for (let i = 0; i < sets.length; i++) {
        const n = sets[i];
        out.push({
          source: src.id,
          host: src.host,
          url: 'https://' + src.host + src.path(type, year, month, n),
          title: year + '年' + month + '月 ' + type.toUpperCase() + ' 第' + n + '套 听力原文（' + src.name + '）',
          setNo: n,
        });
      }
    }
    return out;
  }

  /**
   * 直连已知原文站的候选页并抽正文。失败不抛异常，把原因放进 errors 交给调用方回退搜索。
   * @returns {Promise<{text:string,sources:Array,blocks:Array,errors:Array,tried:number}>}
   */
  async function collectDirectTranscript(meta, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const timeoutMs = positiveInt(options.timeoutMs, REQUEST_TIMEOUT, 1, 120000);
    const maxUrls = positiveInt(options.maxUrls, 4, 1, 10);
    const targets = transcriptPageUrls(meta).slice(0, maxUrls);
    const sources = [];
    const blocks = [];
    const errors = [];
    let tried = 0;
    let requireMatch = null;
    if (options.requireMatch instanceof RegExp) requireMatch = options.requireMatch;
    else if (typeof options.requireMatch === 'string' && options.requireMatch) {
      try { requireMatch = new RegExp(options.requireMatch, 'i'); } catch (e) { requireMatch = null; }
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      tried++;
      let page;
      try {
        page = await fetchPage(target.url, timeoutMs);
      } catch (error) {
        errors.push({ url: target.url, error: describeError(error), source: target.source });
        continue;
      }
      if (!isHtmlContentType(page.contentType)) {
        errors.push({ url: target.url, error: 'non-html' + (page.contentType ? ' (' + page.contentType + ')' : ''), source: target.source });
        continue;
      }
      let text = '';
      try { text = extractArticleText(page.text); } catch (err) { text = ''; }
      if (!text) { errors.push({ url: target.url, error: 'empty', source: target.source }); continue; }
      if (text.length < MIN_ARTICLE_TEXT) { errors.push({ url: target.url, error: 'too-short', source: target.source }); continue; }
      if (requireMatch && !requireMatch.test(text)) { errors.push({ url: target.url, error: 'off-topic', source: target.source }); continue; }
      const finalUrl = String(page.url || target.url);
      sources.push({ url: finalUrl, title: target.title, len: text.length, source: target.source, setNo: target.setNo });
      blocks.push({ url: finalUrl, title: target.title, text: text, len: text.length, source: target.source });
    }
    let text = blocks.map(function (b) { return '来源 URL：' + b.url + '\n' + b.text; }).join('\n\n');
    const maxChars = positiveInt(options.maxChars, DEFAULT_MAX_CHARS, 500, 200000);
    if (text.length > maxChars) text = text.slice(0, maxChars);
    return { text: text, sources: sources, blocks: blocks, errors: errors, tried: tried };
  }

  /**
   * 组合 buildQueries + searchWeb，把命中页正文按 score 降序拼成一段。
   * 每页前加“来源 URL：”，总长不超过 opts.maxChars（默认 24000）。
   * @returns {Promise<{text:string, sources:Array<{url:string,title:string,len:number}>,
   *   errors:Array<{url:string,error:string}>, tried:number}>}
   */
  async function collectTranscriptText(meta, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const queries = buildQueries(meta);
    const keywords = normalizeKeywords(Array.isArray(options.keywords) ? options.keywords : defaultKeywords(meta));
    const found = await searchWeb(queries, {
      maxQueries: options.maxQueries,
      maxPages: options.maxPages,
      timeoutMs: options.timeoutMs,
      keywords: keywords,
      engines: options.engines,
      maxTries: options.maxTries,
      requireMatch: options.requireMatch,
    });
    const maxChars = positiveInt(options.maxChars, DEFAULT_MAX_CHARS, 500, 200000);
    const sources = [];
    const blocks = [];
    const detail = [];       // 每页单独保留一份正文，供调用方挑“最像该篇”的那页喂给 AI
    let used = 0;

    for (let i = 0; i < found.results.length; i++) {
      const result = found.results[i];
      const head = '来源 URL：' + result.url + '\n';
      const separator = blocks.length ? 2 : 0;
      const room = maxChars - used - separator - head.length;
      if (room < 200) break;     // 剩余额度连半段正文都放不下，收手
      let body = result.text;
      let truncated = false;
      if (body.length > room) {
        body = body.slice(0, room);
        truncated = true;
      }
      const tail = truncated ? '\n…（正文过长，已截断）' : '';
      blocks.push(head + body + tail);
      used += separator + head.length + body.length + tail.length;
      sources.push({ url: result.url, title: result.title, len: result.text.length });
      detail.push({ url: result.url, title: result.title, text: result.text, len: result.text.length });
    }

    let text = blocks.join('\n\n');
    if (text.length > maxChars) text = text.slice(0, maxChars);
    return { text: text, sources: sources, blocks: detail, errors: found.errors, tried: found.tried };
  }

  const WebSearch = {
    buildQueries: buildQueries,
    bingUrl: bingUrl,
    parseBingResults: parseBingResults,
    parseBaiduResults: parseBaiduResults,
    parseSogouResults: parseSogouResults,
    parseSo360Results: parseSo360Results,
    extractArticleText: extractArticleText,
    redirectTarget: redirectTarget,
    searchWeb: searchWeb,
    collectTranscriptText: collectTranscriptText,
    transcriptPageUrls: transcriptPageUrls,
    collectDirectTranscript: collectDirectTranscript,
    engines: ENGINE_ORDER.slice(),
  };

  if (typeof window !== 'undefined' && window) window.WebSearch = WebSearch;
  if (typeof module !== 'undefined' && module.exports) module.exports = WebSearch;
})();
