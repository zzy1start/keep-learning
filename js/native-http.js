/* ============ native-http.js : Capacitor 原生 HTTP 桥 ============
 * Android WebView 直接 fetch 第三方 AI 接口常被 CORS 拦；
 * 在 Capacitor 原生环境把外部 http(s) 请求交给 CapacitorHttp（原生网络栈），
 * 同源/本地请求仍走浏览器 fetch。PWA/桌面浏览器不生效。
 */
(function () {
  try {
    const Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
    const Http = Cap.Plugins && Cap.Plugins.CapacitorHttp;
    if (!Http || typeof Http.request !== 'function') return;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (input, init = {}) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!/^https?:/i.test(url)) return originalFetch(input, init);
      let target;
      try { target = new URL(url); } catch (e) { return originalFetch(input, init); }
      if (target.origin === location.origin || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname)) {
        return originalFetch(input, init);
      }
      const method = String(init.method || 'GET').toUpperCase();
      let headers = init.headers || {};
      if (typeof Headers !== 'undefined' && headers instanceof Headers) headers = Object.fromEntries(headers.entries());
      let data;
      if (init.body != null) {
        if (typeof init.body !== 'string') return originalFetch(input, init); // FormData/Blob 不走原生桥
        try { data = JSON.parse(init.body); } catch (e) { return originalFetch(input, init); }
      }
      const res = await Http.request({
        url,
        method,
        headers,
        data,
        connectTimeout: 60000,
        readTimeout: 60000,
      });
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data == null ? '' : res.data);
      const outHeaders = {};
      if (res.headers) for (const k of Object.keys(res.headers)) outHeaders[k] = String(res.headers[k]);
      return new Response(body, { status: res.status || 200, headers: outHeaders });
    };
    window.__nativeHttp = true;
  } catch (e) { console.warn('native-http init fail', e); }
})();
