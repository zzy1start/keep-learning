/*
 * Keep Learning -- Service Worker
 *
 * install : 预缓存 app 外壳（Promise.allSettled，个别 404 不影响安装）
 * activate: 清理旧版本缓存 + clients.claim
 * fetch   : 只接管 GET / 同源 / 非 /__ 前缀 / 非 range 请求
 *           导航请求  : network-first，失败回退缓存的 '/'
 *           /data/ JSON 与其它静态资源: stale-while-revalidate（成功后入缓存，离线可用）
 */

/* 2026-10-22：样式/脚本修复后必须换 cache 版本，否则 stale-while-revalidate 会先回旧 CSS，
 * 用户刷新一次看不到修复（要刷两次）。 */
const CACHE = 'keeplrn-v19';
const CACHE_PREFIX = 'keeplrn-';

// app 外壳。相对路径按 SW 作用域解析，便于整站部署到任意子路径。
const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',

  'css/base.css',
  'css/modules.css',
  'css/shell.css',        // 由 Lead 稍后创建，404 时跳过
  'css/pages-mobile.css', // 由 Lead 稍后创建，404 时跳过

  'js/core.js',
  'js/store.js',
  'js/text-repair.js',
  'js/translate-metric.js',
  'js/native-http.js',
  'js/native-tts.js',
  'js/audio-pack.js',
  'js/local-tts.js',
  'js/ai.js',
  'js/import-pipeline.js',
  'js/speech.js',
  'js/web-search.js',          // 听力自动补全依赖：联网搜索 + 正文抽取
  'js/listening-autofill.js',  // 听力自动补全：原文/题干补全编排（必须在 views/listening.js 前加载）
  'js/srs.js',
  'js/pdf.js',
  'js/ink.js',
  'js/dict.js',
  'js/vocab-engine.js',
  'js/vocab-quiz.js',
  'js/picker.js',
  'js/importer.js',
  'js/garden.js',
  'js/garden-view.js',
  'js/welcome.js',
  'js/wordlevel.js',
  'js/views/home.js',
  'js/views/vocab.js',
  'js/views/listening-sent.js',
  'js/views/listening.js',
  'js/views/reading.js',
  'js/views/writing.js',
  'js/views/translation.js',
  'js/views/notebook.js',
  'js/views/stats.js',
  'js/views/settings.js',
  'js/views/hubs.js',
  'js/app.js',

  'vendor/sbd/dist/sbd.js',

  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/icon-180.png',

  // index.html 直接引用的图片（外壳的一部分）
  'favicon.svg',
  'assets/logo.png',
  'assets/logo-lg.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个 add 而不是 addAll：单个资源 404（如尚未创建的 shell.css）不会让整个安装失败。
    const results = await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    const failed = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') failed.push(APP_SHELL[i]);
    });
    if (failed.length) {
      console.warn('[sw] precache skipped:', failed);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// 导航：network-first，离线时回退到缓存的 app 外壳
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await matchAppShell();
    if (cached) return cached;
    throw err;
  }
}

async function matchAppShell() {
  const cache = await caches.open(CACHE);
  for (const url of ['./', 'index.html']) {
    const hit = await cache.match(url);
    if (hit) return hit;
  }
  return undefined;
}

// 静态资源：stale-while-revalidate（先回缓存，后台更新；首次成功后入缓存）
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      // 只缓存成功的同源响应，404 / opaque 不入库
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;

  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只处理 GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 只处理同源
  if (url.origin !== self.location.origin) return;

  // 内部调试/管理接口一律放行
  if (url.pathname.startsWith('/__')) return;

  // range 请求（音频拖动、词典音频分片）交给浏览器/网络，避免破坏 206 语义
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // /data/ 下的 JSON（题库、词典）与其它静态资源同属 stale-while-revalidate：
  // 先给缓存保证离线可用，后台成功取回后刷新缓存。
  event.respondWith(staleWhileRevalidate(request));
});