/* ============ check-web-search.cjs : 联网搜索模块自检 ============
 * 全部用合成 fixture + stub fetch，不依赖真实网络与 DOM（Node 里没有 DOMParser）。
 *
 * 覆盖：
 *   纯函数：buildQueries / bingUrl / parseBingResults / extractArticleText
 *   searchWeb：正常抓取与关键词打分、跨搜索词去重、maxQueries/maxPages、
 *              超时、非 HTML、空正文、过短正文、HTTP 错误、网络错误
 *   collectTranscriptText：按 score 降序拼接、来源清单、24000 上限、全失败兜底
 *   index.html：web-search.js 必须在 views/listening.js 之前加载
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WS = require(path.join(__dirname, '../js/web-search.js'));

let passed = 0;
let failed = 0;

function check(name, run) {
  try {
    run();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + ((error && error.message) || error));
  }
}

async function checkAsync(name, run) {
  try {
    await run();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + ((error && error.message) || error));
  }
}

/* ---------------- fixture 与 stub 工具 ---------------- */

function bingFixture(items) {
  return '<!DOCTYPE html><html><head><title>bing</title></head><body><ol id="b_results">'
    + items.map(function (item) {
      return '<li class="b_algo"><h2><a href="' + item.url + '">' + item.title + '</a></h2>'
        + '<div class="b_caption"><p>' + (item.url) + '</p></div></li>';
    }).join('')
    + '</ol></body></html>';
}

function articleHtml(options) {
  const opts = options || {};
  const hits = opts.hits == null ? 1 : opts.hits;
  const pad = opts.pad == null ? 10 : opts.pad;
  const parts = [];
  for (let i = 0; i < hits; i++) {
    parts.push('<p>Lines from Tapescript section ' + (i + 1) + ': the recording is provided for practice.</p>');
  }
  for (let i = 0; i < pad; i++) {
    parts.push('<p>W: This is sentence number ' + (i + 1) + ' of the listening material. M: I agree with you completely.</p>');
  }
  return '<html><body><article>' + parts.join('') + '</article></body></html>';
}

function makeResponse(body, options) {
  const opts = options || {};
  const status = opts.status === undefined ? 200 : opts.status;
  const contentType = Object.prototype.hasOwnProperty.call(opts, 'contentType')
    ? opts.contentType
    : 'text/html; charset=utf-8';
  return {
    status: status,
    ok: status < 400,
    headers: {
      get: function (name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    text: async function () { return body; },
  };
}

/* 把全局 fetch 换成路由 stub；handler 返回 Response 形态或 pending/抛错的 Promise。 */
async function withStubFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = function (url) {
    const target = String(url);
    calls.push(target);
    return Promise.resolve().then(function () { return handler(target, calls.length); });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/* ---------------- fixture 常量 ---------------- */

const BING_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><title>2023年12月 六级 听力原文 - 搜索</title>'
  + '<style>.b_algo{display:block}</style><script>window.__b={};</script></head><body><ol id="b_results">'
  + '<li class="b_algo"><div class="b_tpcn"><h2><a href="https://www.kekenet.com/cet6/202312/tape1.shtml">2023年12月六级听力原文 Tapescript 第1套</a></h2></div>'
  + '<div class="b_caption"><p>2023年12月 六级 听力原文 全文 ...</p></div></li>'
  + '<li class="b_algo"><h2><a class="tilk" href="https://www.233.com/cet6/202312/tape.html">2023年12月英语六级听力真题原文</a></h2></li>'
  + '<li class="b_algo"><h2><a href="https://www.kekenet.com/cet6/202312/tape1.shtml">重复的同一链接</a></h2></li>'
  + '<li class="b_algo"><h2><a href="https://www.bing.com/aclk?ld=1&amp;adid=2">Bing 站内广告</a></h2></li>'
  + '<li class="b_algo"><h2><a href="https://support.microsoft.com/zh-cn/topic/abc">Microsoft 支持页</a></h2></li>'
  + '<li class="b_algo"><h2>大家还在搜</h2></li>'
  + '<li class="b_ad"><h2><a href="https://ads.example.com/promo">外部推广链接</a></h2></li>'
  + '<li class="b_algo"><h2><a href="https://www.zhihu.com/question/12345">知乎：六级听力怎么练</a></h2></li>'
  + '<li class="b_algo"><h2><a href="javascript:void(0)">脚本链接</a></h2></li>'
  + '</ol></body></html>';

const ARTICLE_HTML = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
  + '<title>2023年12月六级听力原文 Tapescript</title>'
  + '<style>body{display:none}</style>'
  + '<script>var ad = "这段脚本不应出现在正文";</script>'
  + '<noscript>请开启 JavaScript 才能继续</noscript>'
  + '</head><body>'
  + '<nav>首页 | 六级 | 听力</nav>'
  + '<header><h1>站点页头不应出现</h1></header>'
  + '<main><article>'
  + '<p>Section A&nbsp;Conversation One</p>'
  + '<p>W: Good morning, Tom. Did you finish the report?<br>M: Not yet, but I&rsquo;m almost done.</p>'
  + '<div>Questions 1 to 4 are based on the conversation you have just heard.</div>'
  + '<p>Price &amp; copy &#169; 2023 &#x4e2d;&#x6587; &#8212; “quoted”</p>'
  + '<iframe src="https://ad.example.com/frame">iframe 广告正文不应出现</iframe>'
  + '<table><tr><td>Plain</td><td>Text</td></tr></table>'
  + '</article></main>'
  + '<footer>版权所有 页脚不应出现</footer>'
  + '</body></html>';

/* ================= 一、模块接口 ================= */

check('导出 6 个接口函数', function () {
  ['buildQueries', 'bingUrl', 'parseBingResults', 'extractArticleText', 'searchWeb', 'collectTranscriptText']
    .forEach(function (name) { assert.equal(typeof WS[name], 'function', name + ' 必须是函数'); });
});

check('浏览器环境挂到 window.WebSearch（不依赖 DOM）', function () {
  const code = fs.readFileSync(path.join(__dirname, '../js/web-search.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.equal(typeof sandbox.window.WebSearch, 'object');
  assert.equal(typeof sandbox.window.WebSearch.buildQueries, 'function');
});

/* ================= 二、buildQueries ================= */

check('buildQueries：六级 2023 年 12 月第 1 套，包含年份/月份/套数/Tapescript 变体', function () {
  const queries = WS.buildQueries({ type: 'cet6', year: 2023, session: '12', setNo: 1, title: '校园志愿活动' });
  assert.ok(Array.isArray(queries));
  assert.ok(queries.length >= 3 && queries.length <= 5, '应给 3~5 条：' + queries.length);
  assert.equal(new Set(queries).size, queries.length, '不能有重复搜索词');
  queries.forEach(function (q) { assert.equal(typeof q, 'string'); assert.ok(q.trim().length > 0); });
  const joined = queries.join(' ');
  assert.ok(joined.includes('2023年12月'), '缺少年份月份：' + joined);
  assert.ok(joined.includes('六级'), '缺少考试类型：' + joined);
  assert.ok(joined.includes('第1套'), '缺少套数：' + joined);
  assert.ok(/Tapescript/i.test(joined), '缺少 Tapescript 变体：' + joined);
  assert.ok(queries.some(function (q) { return /听力原文/.test(q); }), '缺少“听力原文”变体');
  assert.ok(queries.some(function (q) { return /真题原文/.test(q); }), '缺少“真题原文”变体');
  assert.ok(queries.some(function (q) { return q.includes('校园志愿活动'); }), '缺少标题变体');
  assert.ok(!queries.some(function (q) { return /undefined|null|NaN/.test(q); }));
});

check('buildQueries：四级 6 月卷 / 无套数时不出“套”', function () {
  const queries = WS.buildQueries({ type: 'cet4', year: 2022, session: '06', setNo: 0 });
  const joined = queries.join(' ');
  assert.ok(queries.length >= 3 && queries.length <= 5);
  assert.ok(joined.includes('2022年6月'), '月份应写作 6月：' + joined);
  assert.ok(joined.includes('四级'));
  assert.ok(!joined.includes('第'), '没有套数时不应出现“第N套”：' + joined);
});

check('buildQueries：考研 + english-1 场次不出月份，也不留占位词', function () {
  const queries = WS.buildQueries({ type: 'kaoyan', year: 2021, session: 'english-1' });
  const joined = queries.join(' ');
  assert.ok(queries.length >= 3 && queries.length <= 5);
  assert.ok(joined.includes('考研英语'));
  assert.ok(joined.includes('2021'));
  assert.ok(!/[0-9]月/.test(joined), '考研英语一不是月份卷：' + joined);
  assert.ok(!joined.includes('other'));
});

check('buildQueries：缺 meta / 空对象也能给出 3~5 条有效搜索词', function () {
  for (const meta of [undefined, null, {}, { type: 'unknown' }]) {
    const queries = WS.buildQueries(meta);
    assert.ok(queries.length >= 3 && queries.length <= 5, 'meta=' + JSON.stringify(meta) + ' 得到 ' + queries.length);
    assert.ok(queries.every(function (q) { return q.trim().length > 0 && !/undefined|null/.test(q); }));
  }
});

/* ================= 三、bingUrl ================= */

check('bingUrl：encodeURIComponent + setlang=zh-CN', function () {
  const query = '2023年12月 六级 听力原文 & Tapescript';
  assert.equal(WS.bingUrl(query), 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN');
  assert.ok(!WS.bingUrl(query).includes(' '), '空格必须编码');
});

/* ================= 四、parseBingResults ================= */

check('parseBingResults：解析 h2/a 结果，去广告/站内链接并去重', function () {
  const results = WS.parseBingResults(BING_HTML);
  assert.deepEqual(results.map(function (r) { return r.url; }), [
    'https://www.kekenet.com/cet6/202312/tape1.shtml',
    'https://www.233.com/cet6/202312/tape.html',
    'https://www.zhihu.com/question/12345',
  ]);
  assert.ok(results[0].title.includes('Tapescript'));
  assert.ok(!results.some(function (r) { return /bing\.com|microsoft\.com|msn\.com|ads\.example\.com|javascript:/.test(r.url); }));
});

check('parseBingResults：href 里的 &amp; 实体解码', function () {
  const results = WS.parseBingResults('<h2><a href="https://example.com/a?x=1&amp;y=2">A</a></h2>');
  assert.equal(results[0].url, 'https://example.com/a?x=1&y=2');
});

check('parseBingResults：最多 10 条', function () {
  const many = '<ol>' + Array.from({ length: 14 }, function (_, i) {
    return '<li class="b_algo"><h2><a href="https://example.com/p' + i + '">标题 ' + i + '</a></h2></li>';
  }).join('') + '</ol>';
  assert.equal(WS.parseBingResults(many).length, 10);
});

check('parseBingResults：空输入/垃圾输入返回空数组，不抛异常', function () {
  assert.deepEqual(WS.parseBingResults(''), []);
  assert.deepEqual(WS.parseBingResults(null), []);
  assert.deepEqual(WS.parseBingResults(undefined), []);
  assert.deepEqual(WS.parseBingResults('<html><body>没有结果</body></html>'), []);
});

check('parseBingResults：解出 Bing /ck/a 跳转包裹的真实外链', function () {
  const packed = Buffer.from('https://www.kekenet.com/cet6/wrapped.shtml', 'utf8').toString('base64url');
  const html = '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=abc&u=a1' + packed + '&ntb=1">包裹结果</a></h2></li>';
  const results = WS.parseBingResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://www.kekenet.com/cet6/wrapped.shtml');
});

/* ================= 五、extractArticleText ================= */

check('extractArticleText：去噪音标签、解实体、保留句子换行、压空白', function () {
  const text = WS.extractArticleText(ARTICLE_HTML);
  assert.ok(text.length > 0);
  /* 噪音块整块剔除 */
  ['这段脚本不应出现', '请开启 JavaScript', '首页 | 六级', '站点页头不应出现',
    'iframe 广告正文不应出现', '版权所有 页脚不应出现'].forEach(function (noise) {
    assert.ok(!text.includes(noise), '正文不应包含噪音：' + noise);
  });
  /* 正文与实体 */
  assert.ok(text.includes('Section A Conversation One'), '&nbsp; 应解码为空格：' + text);
  assert.ok(text.includes('Price & copy © 2023 中文 — “quoted”'), '实体解码不完整：' + text);
  /* <br> 换行，句子不被粘连 */
  assert.ok(text.includes('report?\nM: Not yet'), '<br> 应转换行：' + text);
  assert.ok(text.includes('W: Good morning, Tom.'), '应保留英文句子');
  assert.ok(text.includes('Questions 1 to 4 are based on the conversation you have just heard.'));
  /* 段落之间换行，且没有标签残留 / 连续空格 / 三段以上空行 */
  assert.ok(!/[<>]/.test(text), '正文不应残留标签：' + text);
  assert.ok(!/ {2,}/.test(text), '正文不应有连续空格：' + text);
  assert.ok(!/\t/.test(text), '正文不应有制表符');
  assert.ok(!/\n{3,}/.test(text), '正文空行最多一段：' + JSON.stringify(text));
});

check('extractArticleText：逐词 <span> 不能把英文粘成一个词（2026-10-29 用户报错回归）', function () {
  /* 实站（听力原文页）把每个单词包在 <span> 里。旧实现把标签直接删掉，
   * 正文变成 "Thatsoundsamazing.Doyouhavetorelocate?"：
   * AI 切出的原文/证据句与候选正文逐字对不上 → 原文被整段丢弃；
   * 同一份正文又被拿去抽题干 → 写出假题干。这里锁住"标签当分隔符"的行为。 */
  const words = ['That', 'sounds', 'amazing.', 'Do', 'you', 'have', 'to', 'relocate?'];
  const html = '<html><body><article><p><b>*M*:</b>'
    + words.map(function (w) { return '<span class="w">' + w + '</span>'; }).join('')
    + '</p></article></body></html>';
  const text = WS.extractArticleText(html);
  assert.ok(text.indexOf('That sounds amazing. Do you have to relocate?') >= 0,
    '逐词 span 之间必须保留空格：' + JSON.stringify(text));
  assert.equal(text.indexOf('Thatsoundsamazing'), -1, '英文单词不能跨标签粘连：' + JSON.stringify(text));
  const badge = WS.extractArticleText('<p><b>*M*:</b><span>That</span> <span>sounds</span> <span>amazing.</span></p>');
  assert.ok(badge.indexOf('*M*: That sounds amazing.') >= 0,
    '说话人徽标与正文之间要有空格：' + JSON.stringify(badge));
});

check('extractArticleText：<p> 分段、纯文本输入与空输入', function () {
  assert.ok(WS.extractArticleText('<p>First paragraph.</p><p>Second paragraph.</p>').includes('First paragraph.\n\nSecond paragraph.'));
  assert.equal(WS.extractArticleText('  just text  '), 'just text');
  assert.equal(WS.extractArticleText(''), '');
  assert.equal(WS.extractArticleText(null), '');
  assert.equal(WS.extractArticleText(undefined), '');
});

/* ================= 六、searchWeb：正常抓取与打分 ================= */

(async function main() {
  await checkAsync('searchWeb：抓取候选页、按关键词打分降序、记录 tried 与空 errors', async function () {
    const pages = {
      'https://www.kekenet.com/a.shtml': articleHtml({ hits: 2 }),
      'https://www.233.com/b.html': articleHtml({ hits: 1 }),
    };
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) {
        return makeResponse(bingFixture([
          { url: 'https://www.kekenet.com/a.shtml', title: 'A 原文' },
          { url: 'https://www.233.com/b.html', title: 'B 原文' },
        ]));
      }
      if (pages[url]) return makeResponse(pages[url]);
      throw new Error('unexpected url ' + url);
    }, async function () {
      const result = await WS.searchWeb(['2023年12月 六级 听力原文'], { keywords: ['Tapescript'], timeoutMs: 2000 });
      assert.equal(result.tried, 2);
      assert.deepEqual(result.errors, []);
      assert.equal(result.results.length, 2);
      assert.equal(result.results[0].url, 'https://www.kekenet.com/a.shtml', '关键词命中多的应排前面');
      assert.equal(result.results[0].score, 2);
      assert.equal(result.results[0].title, 'A 原文');
      assert.equal(result.results[1].score, 1);
      result.results.forEach(function (r) {
        assert.ok(r.text.length >= 500, '正文应 >= 500 字符');
        assert.equal(typeof r.text, 'string');
      });
    });
  });

  await checkAsync('searchWeb：多个搜索词命中同一 URL 只抓一次（跨词去重）', async function () {
    const articleUrls = [];
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) {
        const second = /q=second/.test(url);
        return makeResponse(bingFixture(second
          ? [{ url: 'https://www.kekenet.com/a.shtml', title: 'A 重复' },
             { url: 'https://www.233.com/c.html', title: 'C 原文' }]
          : [{ url: 'https://www.kekenet.com/a.shtml', title: 'A 原文' },
             { url: 'https://www.233.com/b.html', title: 'B 原文' }]));
      }
      articleUrls.push(url);
      return makeResponse(articleHtml());
    }, async function () {
      const result = await WS.searchWeb(['first query', 'second query'], { maxQueries: 2, timeoutMs: 2000 });
      assert.equal(result.tried, 3, 'A/B/C 共 3 个不同候选页');
      assert.equal(result.results.length, 3);
      assert.equal(new Set(result.results.map(function (r) { return r.url; })).size, 3);
      assert.equal(articleUrls.filter(function (u) { return u === 'https://www.kekenet.com/a.shtml'; }).length, 1, 'A 只抓一次');
    });
  });

  await checkAsync('searchWeb：maxQueries / maxPages 生效', async function () {
    let bingCalls = 0;
    const fetched = [];
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) {
        bingCalls++;
        return makeResponse(bingFixture([
          { url: 'https://example.com/p1', title: 'P1' },
          { url: 'https://example.com/p2', title: 'P2' },
          { url: 'https://example.com/p3', title: 'P3' },
        ]));
      }
      fetched.push(url);
      return makeResponse(articleHtml());
    }, async function () {
      const result = await WS.searchWeb(['q1', 'q2', 'q3'], { maxQueries: 1, maxPages: 2, timeoutMs: 2000 });
      assert.equal(bingCalls, 1, 'maxQueries=1 只搜一次');
      assert.equal(result.tried, 2, 'maxPages=2 只抓两页');
      assert.equal(fetched.length, 2);
      assert.equal(result.results.length, 2);
    });
  });

  /* ================= 七、searchWeb：失败要优雅 ================= */

  await checkAsync('searchWeb：超时/非 HTML/空正文/过短/HTTP 错误/网络错误都记入 errors，不抛异常', async function () {
    const candidates = [
      { url: 'https://example.com/slow', title: '慢页' },
      { url: 'https://example.com/nothtml', title: 'PDF 页' },
      { url: 'https://example.com/short', title: '过短页' },
      { url: 'https://example.com/empty', title: '空正文页' },
      { url: 'https://example.com/http503', title: '503 页' },
      { url: 'https://example.com/dnsfail', title: '域名失败页' },
      { url: 'https://www.kekenet.com/ok.shtml', title: '正常页' },
    ];
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) return makeResponse(bingFixture(candidates));
      if (url === 'https://example.com/slow') return new Promise(function () { /* 永不返回，靠超时收手 */ });
      if (url === 'https://example.com/nothtml') return makeResponse('%PDF-1.4 binary', { contentType: 'application/pdf' });
      if (url === 'https://example.com/short') return makeResponse('<html><body><p>太短了</p></body></html>');
      if (url === 'https://example.com/empty') return makeResponse('   ');
      if (url === 'https://example.com/http503') return makeResponse('busy', { status: 503 });
      if (url === 'https://example.com/dnsfail') throw new Error('ENOTFOUND example.com');
      if (url === 'https://www.kekenet.com/ok.shtml') return makeResponse(articleHtml());
      throw new Error('unexpected url ' + url);
    }, async function () {
      const result = await WS.searchWeb(['failures'], { maxPages: 7, timeoutMs: 40 });
      assert.equal(result.tried, 7);
      const byUrl = {};
      result.errors.forEach(function (e) { byUrl[e.url] = e.error; });
      assert.equal(byUrl['https://example.com/slow'], 'timeout');
      assert.ok(String(byUrl['https://example.com/nothtml']).startsWith('non-html'), byUrl['https://example.com/nothtml']);
      assert.equal(byUrl['https://example.com/short'], 'too-short');
      assert.equal(byUrl['https://example.com/empty'], 'empty');
      assert.equal(byUrl['https://example.com/http503'], 'HTTP 503');
      assert.ok(String(byUrl['https://example.com/dnsfail']).includes('ENOTFOUND'), byUrl['https://example.com/dnsfail']);
      assert.equal(result.errors.length, 6);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].url, 'https://www.kekenet.com/ok.shtml');
    });
  });

  await checkAsync('searchWeb：Bing 搜索页本身超时也优雅失败', async function () {
    await withStubFetch(function () {
      return new Promise(function () { /* 永不返回 */ });
    }, async function () {
      const result = await WS.searchWeb(['timeout query'], { timeoutMs: 40 });
      assert.equal(result.results.length, 0);
      assert.equal(result.tried, 0);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].error, 'timeout');
    });
  });

  await checkAsync('searchWeb：没有搜索词 / 搜索页无结果时返回空结构', async function () {
    const empty = await WS.searchWeb([], { timeoutMs: 100 });
    assert.deepEqual(empty, { results: [], errors: [], tried: 0 });

    await withStubFetch(function () {
      return makeResponse('<html><body><p>没有结果</p></body></html>');
    }, async function () {
      const result = await WS.searchWeb(['nothing'], { timeoutMs: 200 });
      assert.deepEqual(result.results, []);
      assert.equal(result.tried, 0);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].error, 'no-results');
    });
  });

  /* ================= 八、collectTranscriptText ================= */

  await checkAsync('collectTranscriptText：按 score 降序拼接、加来源 URL、记录 sources', async function () {
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) {
        return makeResponse(bingFixture([
          { url: 'https://www.kekenet.com/a.shtml', title: 'A 原文' },
          { url: 'https://www.233.com/b.html', title: 'B 原文' },
        ]));
      }
      if (url === 'https://www.kekenet.com/a.shtml') return makeResponse(articleHtml({ hits: 3 }));
      if (url === 'https://www.233.com/b.html') return makeResponse(articleHtml({ hits: 1 }));
      throw new Error('unexpected url ' + url);
    }, async function () {
      const collected = await WS.collectTranscriptText(
        { type: 'cet6', year: 2023, session: '12', setNo: 1 },
        { keywords: ['Tapescript'], maxChars: 1500, timeoutMs: 2000 }
      );
      assert.ok(collected.text.startsWith('来源 URL：https://www.kekenet.com/a.shtml\n'), '正文应以来源 URL 开头：' + collected.text.slice(0, 80));
      assert.ok(collected.text.indexOf('kekenet') < collected.text.indexOf('233.com'), '高分页应排前面');
      assert.ok(collected.text.length <= 1500, '不能超过 maxChars：' + collected.text.length);
      assert.equal(collected.sources.length, 2);
      assert.equal(collected.sources[0].url, 'https://www.kekenet.com/a.shtml');
      assert.equal(collected.sources[0].title, 'A 原文');
      assert.ok(collected.sources[0].len >= 500, 'len 记录整页正文长度');
      assert.deepEqual(collected.errors, []);
      assert.equal(collected.tried, 2);
    });
  });

  await checkAsync('collectTranscriptText：默认上限 24000 字符', async function () {
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) {
        return makeResponse(bingFixture([{ url: 'https://www.kekenet.com/big.shtml', title: '大页' }]));
      }
      const huge = '<p>' + new Array(400).join('Tapescript paragraph with a fairly long English sentence. ') + '</p>';
      return makeResponse('<html><body>' + huge + '</body></html>');
    }, async function () {
      const collected = await WS.collectTranscriptText({ type: 'cet6', year: 2023, session: '12' }, { timeoutMs: 2000 });
      assert.ok(collected.text.length > 0);
      assert.ok(collected.text.length <= 24000, '默认上限 24000：' + collected.text.length);
    });
  });

  await checkAsync('collectTranscriptText：全部失败时 text 为空字符串', async function () {
    await withStubFetch(function () {
      throw new Error('ENETUNREACH');
    }, async function () {
      const collected = await WS.collectTranscriptText({ type: 'cet4', year: 2022, session: '06' }, { timeoutMs: 100 });
      assert.equal(collected.text, '');
      assert.deepEqual(collected.sources, []);
      assert.equal(collected.tried, 0);
      assert.ok(collected.errors.length >= 1);
    });
  });


  /* ================= 八·五、多引擎与跳转（2026-10-26 实网补强） ================= */

  check('parseBaiduResults：百度 h3/t 结果，接受 /link?url= 跳转、去站内链接', function () {
    const html = '<div><h3 class="t"><a href="http://www.baidu.com/link?url=abc&amp;x=1">2023年12月 六级 听力原文 - 新东方在线</a></h3></div>'
      + '<h3><a href="https://www.baidu.com/s?wd=别的">站内搜索</a></h3>'
      + '<h3><a href="javascript:void(0)">脚本</a></h3>';
    const results = WS.parseBaiduResults(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].url, 'http://www.baidu.com/link?url=abc&x=1');
    assert.ok(results[0].title.includes('听力原文'));
  });

  check('parseSogouResults：相对 /link?url= 补成绝对地址', function () {
    const html = '<h3 class="vr-title"><a href="/link?url=hedJjaC291PnHBoX">2023年12月六级英语听力原文</a></h3>';
    const results = WS.parseSogouResults(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].url, 'https://www.sogou.com/link?url=hedJjaC291PnHBoX');
  });

  check('parseSo360Results：/link?m= 跳转保留，站内 wenku.so.com 搜索页剔除', function () {
    const html = '<h3 class="g-title"><a href="https://www.so.com/link?m=abc%2Bdef">六级听力原文 - 站点</a></h3>'
      + '<h3 class="g-title"><a href="https://wenku.so.com/s?q=2023">360文库搜索</a></h3>';
    const results = WS.parseSo360Results(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].url, 'https://www.so.com/link?m=abc%2Bdef');
  });

  check('redirectTarget：抽出 window.location.replace / meta refresh 目标，正常页返回空', function () {
    assert.equal(WS.redirectTarget('<script>window.location.replace("https://a.com/x")</script>'), 'https://a.com/x');
    assert.equal(WS.redirectTarget('<noscript><META http-equiv="refresh" content="0;URL=\'https://b.com/y\'"></noscript>'), 'https://b.com/y');
    assert.equal(WS.redirectTarget('<html><body><p>' + '正文'.repeat(1000) + '</p></body></html>'), '');
    assert.equal(WS.redirectTarget(''), '');
  });

  await checkAsync('searchWeb：Bing 无可用正文时回退百度；多引擎 errors 带 engine 标记', async function () {
    const fetched = [];
    await withStubFetch(function (url) {
      fetched.push(url);
      if (/bing\.com\/search/.test(url)) return makeResponse(bingFixture([{ url: 'https://example.com/short1', title: 'B1' }]));
      if (/baidu\.com\/s/.test(url)) return makeResponse(
        '<h3 class="t"><a href="https://www.kekenet.com/ok.shtml">2023年12月 六级 听力原文</a></h3>');
      if (url === 'https://example.com/short1') return makeResponse('<html><body><p>太短</p></body></html>');
      if (url === 'https://www.kekenet.com/ok.shtml') return makeResponse(articleHtml());
      throw new Error('unexpected url ' + url);
    }, async function () {
      const result = await WS.searchWeb(['2023年12月 六级 听力原文'], { engines: ['bing', 'baidu'], timeoutMs: 2000 });
      assert.equal(result.results.length, 1, '应回退到百度并抓到可用页');
      assert.equal(result.results[0].url, 'https://www.kekenet.com/ok.shtml');
      const shortErr = result.errors.find(function (e) { return e.url === 'https://example.com/short1'; });
      assert.ok(shortErr && shortErr.error === 'too-short');
      assert.equal(shortErr.engine, 'bing', '失败项应标引擎');
      assert.ok(fetched.some(function (u) { return /baidu\.com\/s/.test(u); }), '应真的请求过百度');
    });
  });

  await checkAsync('searchWeb：requireMatch 挡掉无关正文，并继续试下一个引擎', async function () {
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) return makeResponse(bingFixture([{ url: 'https://example.com/off', title: 'HTML特殊字符编码对照表' }]));
      if (/baidu\.com\/s/.test(url)) return makeResponse('<h3 class="t"><a href="https://www.kekenet.com/cet6.shtml">六级听力</a></h3>');
      if (url === 'https://example.com/off') {
        return makeResponse('<html><body><p>' + 'ASCII table row '.repeat(80) + '</p></body></html>');
      }
      return makeResponse(articleHtml());
    }, async function () {
      const result = await WS.searchWeb(['2023年12月 六级 听力原文'], {
        engines: ['bing', 'baidu'], timeoutMs: 2000, requireMatch: /(?:听力|六级|CET|tapescript)/i,
      });
      assert.equal(result.results.length, 1, '无关页不该算结果，应回退百度');
      assert.equal(result.results[0].url, 'https://www.kekenet.com/cet6.shtml');
      assert.ok(result.errors.some(function (e) { return e.url === 'https://example.com/off' && e.error === 'off-topic'; }));
    });
  });

  await checkAsync('fetchPage：跳转壳（搜狗/360 的 200+脚本）自动跟一跳拿真正文', async function () {
    const shell = '<meta content="always" name="referrer"><script>window.location.replace("https://max.book118.com/html/x.shtm")</script>';
    const seen = [];
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) return makeResponse(bingFixture([{ url: 'https://www.sogou.com/link?url=abc', title: '跳转页' }]));
      seen.push(url);
      if (url === 'https://www.sogou.com/link?url=abc') return makeResponse(shell);
      if (url === 'https://max.book118.com/html/x.shtm') return makeResponse(articleHtml());
      throw new Error('unexpected url ' + url);
    }, async function () {
      const result = await WS.searchWeb(['q'], { timeoutMs: 2000 });
      assert.equal(result.results.length, 1);
      assert.deepEqual(seen, ['https://www.sogou.com/link?url=abc', 'https://max.book118.com/html/x.shtm']);
    });
  });

  await checkAsync('collectTranscriptText：返回逐页正文 blocks（供调用方挑最像该篇的一页）', async function () {
    await withStubFetch(function (url) {
      if (/bing\.com\/search/.test(url)) return makeResponse(bingFixture([
        { url: 'https://www.kekenet.com/a.shtml', title: 'A' },
        { url: 'https://www.233.com/b.html', title: 'B' },
      ]));
      return makeResponse(articleHtml());
    }, async function () {
      const got = await WS.collectTranscriptText({ type: 'cet6', year: 2023, session: '12' }, { timeoutMs: 2000 });
      assert.ok(Array.isArray(got.blocks) && got.blocks.length === 2, 'blocks 应有 2 页');
      got.blocks.forEach(function (b) {
        assert.ok(b.url && b.text && b.text.length >= 500, '每页带 url 与完整正文');
        assert.ok(b.text.length >= (got.sources[0].len > 0 ? 500 : 500));
      });
    });
  });

  /* ================= 八点五、直连原文源（2026-10-29） ================= */

  check('transcriptPageUrls：按 年-月-套号 生成懒笔记直连地址；缺元数据不出地址', function () {
    assert.equal(typeof WS.transcriptPageUrls, 'function', '缺少导出 transcriptPageUrls');
    assert.equal(typeof WS.collectDirectTranscript, 'function', '缺少导出 collectDirectTranscript');
    const urls = WS.transcriptPageUrls({ type: 'cet6', year: 2025, session: '06', setNo: 1 });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].url, 'https://english-exam.lazynote.cn/cet6/sections/listening/2025-06-1/');
    assert.equal(urls[0].setNo, 1);
    assert.ok(/第 1 套|第1套/.test(urls[0].title));
    const cet4 = WS.transcriptPageUrls({ type: 'cet4', year: 2023, session: '12' });
    assert.equal(cet4.length, 3, '没识别套号时依次试 1~3 套');
    assert.ok(cet4.every(function (u) { return /\/cet4\/sections\/listening\/2023-12-[1-3]\//.test(u.url); }));
    assert.deepEqual(WS.transcriptPageUrls({ type: 'kaoyan', year: 2025, session: '06' }), []);
    assert.deepEqual(WS.transcriptPageUrls({ type: 'cet6', session: '06' }), []);
    assert.deepEqual(WS.transcriptPageUrls(null), []);
  });

  await checkAsync('collectDirectTranscript：直连页抽正文并返回 sources/blocks；404 记 errors 不抛异常', async function () {
    const page = '<html><body><article><p>Tapescript 2025年6月六级听力原文</p>'
      + '<p>Questions 1 to 4 are based on the conversation you have just heard.</p>'
      + '<p>M: My name is Bob Fetterman. I am the computer technician from Alpha Maintenance.</p>'
      + '<p>W: Did not I call for you last week? I spoke to a lady there last Tuesday and made it clear it was urgent.</p>'
      + new Array(8).join('<p>W: I am indignant that it has taken you so long to come, but I understand it may not be your fault.</p>')
      + '</article></body></html>';
    const seen = [];
    await withStubFetch(function (url) {
      seen.push(url);
      if (url === 'https://english-exam.lazynote.cn/cet6/sections/listening/2025-06-1/') return makeResponse(page);
      return makeResponse('not found', { status: 404 });
    }, async function () {
      const got = await WS.collectDirectTranscript({ type: 'cet6', year: 2025, session: '06', setNo: 1 },
        { timeoutMs: 2000, requireMatch: /听力|Tapescript|Questions/i });
      assert.equal(got.tried, 1);
      assert.equal(got.blocks.length, 1, '应返回 1 页正文：' + JSON.stringify(got.errors));
      assert.ok(/Alpha Maintenance/.test(got.text), '正文应含目标内容');
      assert.ok(got.sources[0].url.indexOf('lazynote') >= 0);
      assert.equal(seen.length, 1);

      /* 404：errors 记录原因、不抛异常、不产生 blocks */
      const miss = await WS.collectDirectTranscript({ type: 'cet6', year: 2019, session: '06', setNo: 2 }, { timeoutMs: 1000 });
      assert.equal(miss.blocks.length, 0);
      assert.ok(miss.errors.length >= 1, '404 应记录 errors');
    });
  });

  /* ================= 九、index.html 加载顺序 ================= */

  check('index.html 在 views/listening.js 之前加载 js/web-search.js', function () {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const webSearchAt = html.indexOf('<script src="js/web-search.js">');
    const listeningAt = html.indexOf('<script src="js/views/listening.js">');
    assert.ok(webSearchAt >= 0, 'index.html 缺少 <script src="js/web-search.js">');
    assert.ok(listeningAt >= 0, 'index.html 缺少 listening.js（可能被改动）');
    assert.ok(webSearchAt < listeningAt, 'web-search.js 必须在 listening.js 之前');
  });

  if (failed) {
    console.error('\n' + failed + ' 项失败，' + passed + ' 项通过');
    process.exitCode = 1;
  } else {
    console.log('\n全部 ' + passed + ' 项检查通过');
  }
})();
