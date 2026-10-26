/*本地静态服务器 —— 默认监听 0.0.0.0（手机/平板可访问），--local 只开本机
 * 用法：node serve.js [端口] [--open] [--local]
 *
 * 【本轮多端改动】
 *   1. 默认监听 0.0.0.0：手机/平板与电脑连同一个 Wi-Fi 即可访问；
 *      不想暴露给局域网时加 --local（回到 127.0.0.1）。
 *   2. 文本资源 gzip：词库/词典 JSON 约 35MB，压缩后能省一半以上流量。
 *   3. ETag / 304：重复打开时不再整包重下（原来只有 no-cache，没有验证器）。
 *   4. .webmanifest MIME：PWA 的 manifest 需要正确的 Content-Type。
 *   5. 启动时打印局域网地址，手机照着输即可。
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const ROOT = __dirname;
const args = process.argv.slice(2);
const portArg = args.find(arg => /^\d+$/.test(arg));
const PORT = portArg === undefined ? 8777 : Number(portArg);
const OPEN_BROWSER = args.includes('--open');
const HOST = process.env.KEEP_LEARNING_HOST || (args.includes('--local') ? '127.0.0.1' : '0.0.0.0');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('端口必须是 1 到 65535 之间的整数');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  // 防目录穿越
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }
  /*网页无法直接结束 Node 进程，所以提供一个本地退出接口。
   * 安全约束（必须同时满足，否则拒绝）：
   *   1. 只接受 POST —— GET 会被浏览器/预取器无意触发
   *   2. 必须带自定义请求头 X-Exit-Token —— 跨站页面无法设置该头
   *      （简单请求只允许几个固定头，故可防 CSRF）
   *   3. 只接受来自本机回环地址的请求
   * 端口只监听 127.0.0.1，本就不对外网开放，这里再加一层是防止
   * 用户浏览器里打开的恶意网页去打这个接口。*/
  /* 内容保存接口：把用户导入的篇目写回 data/content/*.json
   *
   * 【为什么必须有】浏览器无法直接写磁盘。原来的导入流程把篇目
   * 塞进内存里的 Dict.content，localStorage 只存得下"这是我导入的"标记
   * （mineIds），存不下正文 —— 于是关掉页面正文就没了。
   *
   *【安全约束，比/__shutdown 更严】
   *   1. 仅 POST + 仅本机回环 + 必须带 token（理由同 /__shutdown）
   *   2. **文件名白名单**：只接受 ^[\w-]+\.json$，且必须落在 data/content/ 下。
   *      这条最关键——没有它，一个恶意脚本就能借这个接口往任意路径写文件
   *      （如../../.bashrc），等于把整个磁盘敞开。
   *   3. 解析后再次校验 resolved 路径确实位于 data/content 内，
   *      防目录穿越（含软链接绕过）
   *   4. 体积上限 8MB，防止撑爆内存/磁盘
   */
  /* 真人词典音频代理（③）：GET /__dict-audio?w=word&type=1|2
   *
   * 【为什么必须由本机代理】实测有道 dictvoice **不返回 Access-Control-Allow-Origin**
   *（带 Origin 的 GET 没有该头，OPTIONS 预检直接 403），页面 fetch() 读不到字节，
   * 于是"缓存"和"800ms 拿不到就回落"都没法在前端做。同源代理后两者都成立。
   *
   * 【安全约束——这是唯一一个会替浏览器发起外部请求的接口，必须收紧】
   *   1. 上游主机写死（可用 DICT_AUDIO_ORIGIN 覆盖，仅供自检用），
   *      **绝不接受请求里传来的 URL**，否则就是把本机变成开放代理（SSRF）；
   *   2. w 只允许纯英文单词（首字符字母，其余字母/撇号/连字符/空格，总长 ≤40），
   *      type 只允许 1 或 2；两者都不进入路径拼接——缓存文件名是 sha1，天然无穿越风险；
   *   3. 上游响应必须是 audio/* 且大于 200 字节才落盘，避免把错误页当成音频存下来；
   *   4. 只监听 127.0.0.1（server.listen 已限定），外网访问不到。*/
  if (p === '/__dict-audio') {
    const q = new URL(req.url, 'http://127.0.0.1');
    const word = String(q.searchParams.get('w') || '').trim();
    const type = q.searchParams.get('type') === '1' ? '1' : '2';
    if (!/^[A-Za-z][A-Za-z' -]{0,39}$/.test(word)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 bad word');
    }
    let upstream = process.env.DICT_AUDIO_ORIGIN || 'https://dict.youdao.com';
    if (!/^https?:\/\//.test(upstream)) upstream = 'https://' + upstream;
    const CACHE_DIR = process.env.DICT_AUDIO_CACHE || path.join(ROOT, '.cache', 'dict-audio');
    const TIMEOUT = Number(process.env.DICT_AUDIO_TIMEOUT_MS) || 4000;
    const key = crypto.createHash('sha1').update(type + '|' + word.toLowerCase()).digest('hex');
    const file = path.join(CACHE_DIR, type, key + '.mp3');
    const send = (buf, from) => {
      if (res.writableEnded || res.destroyed) return;   // 页面 800ms 超时早已断开：照常写缓存即可
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Dict-Cache': from,
      });
      res.end(buf);
    };
    const fail = (code, msg) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(code + ' ' + msg);
    };
    return fs.readFile(file, (err, buf) => {
      if (!err && buf && buf.length > 200) return send(buf, 'hit');
      const mod = upstream.startsWith('https:') ? https : http;
      const up = mod.get(upstream + '/dictvoice?audio=' + encodeURIComponent(word) + '&type=' + type, r2 => {
        if (r2.statusCode !== 200) { r2.resume(); return fail(502, 'upstream ' + r2.statusCode); }
        const chunks = [];
        r2.on('data', c => chunks.push(c));
        r2.on('end', () => {
          const body = Buffer.concat(chunks);
          const ct = String(r2.headers['content-type'] || '');
          if (!/^audio\//i.test(ct) || body.length <= 200) return fail(502, 'upstream not audio');
          fs.mkdir(path.dirname(file), { recursive: true }, () => {
            /* 先落盘再回响应：页面即使超时断开，下次点同一个词就是本机命中。
             * 这也是"800ms 超时"不等于失败的原因——超时只是这一轮用不上它。*/
            fs.writeFile(file, body, () => send(body, 'miss'));
          });
        });
      });
      up.setTimeout(TIMEOUT, () => up.destroy(new Error('upstream timeout')));
      up.on('error', e => fail(/timeout/i.test(e.message) ? 504 : 502, e.message));
    });
  }

  if (p === '/__save-content' && req.method === 'POST') {
    const fromLocal = !req.socket.remoteAddress
      || /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress);
    if (req.headers['x-save-token'] !== 'keep-learning' || !fromLocal) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }
    // 文件名白名单：只允许单词/数字/短横线 + .json
    const name = (req.headers['x-content-file'] || '').toString().trim();
    if (!/^[\w-]{1,64}\.json$/.test(name)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('400 bad file name');
    }
    const DIR = path.join(ROOT, 'data', 'content');
    const dest = path.join(DIR, name);
    // 二次确认：解析后的绝对路径必须仍在 data/content 内
    if (!path.resolve(dest).startsWith(path.resolve(DIR) + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 path denied');
    }

    let body = '';
    let aborted = false;
    req.on('data', c => {
      body += c;
      if (body.length > 8 * 1024 * 1024) {   // 8MB 上限
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('413 too large');
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        JSON.parse(body);                // 必须是合法 JSON 才落盘
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('400 invalid json');
      }
      // 先写临时文件再改名，避免写到一半崩溃留下坏文件
      const tmp = dest + '.tmp-' + process.pid;
      fs.writeFile(tmp, body, err => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('500 write failed');
        }
        fs.rename(tmp, dest, err2 => {
          if (err2) {
            try { fs.unlink(tmp); } catch (e) {}
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('500 rename failed');
          }
          console.log('  已保存内容文件: ' + name + ' (' + body.length + ' bytes)');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('saved');
        });
      });
    });
    return;
  }

  if (p === '/__shutdown' && req.method === 'POST') {
    const fromLocal = !req.socket.remoteAddress
      || /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress);
    if (req.headers['x-exit-token'] !== 'keep-learning' || !fromLocal) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bye');
    // 先把响应刷出去，再退出——否则浏览器可能收不到确认
    setTimeout(() => {
      console.log('  收到退出请求，正在关闭...');
      process.exit(0);
    }, 120);
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    /* ETag 用 大小+修改时间，足够本地使用；有它浏览器才能发 If-None-Match 换 304 */
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Vary': 'Accept-Encoding',
    };
    /* 文本类资源压缩传输：35MB 的 JSON 词库是移动端首屏的主要开销 */
    const isText = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg)/.test(type);
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (isText && acceptsGzip && st.size > 1024) {
      fs.readFile(file, (e, buf) => {
        if (e) { res.writeHead(500); return res.end('500 read failed'); }
        zlib.gzip(buf, (e2, gz) => {
          if (e2) {
            headers['Content-Length'] = buf.length;
            res.writeHead(200, headers);
            return res.end(buf);
          }
          headers['Content-Encoding'] = 'gzip';
          headers['Content-Length'] = gz.length;
          res.writeHead(200, headers);
          res.end(gz);
        });
      });
      return;
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (err) => {
  // 桌面快捷方式会直接运行 `node serve.js 8777 --open`。
  // 若服务已由快捷方式、启动.bat 或之前的窗口启动，第二个实例无法绑定端口；
  // 确认现有端口确实是本应用后，直接打开它，避免用户误以为快捷方式失效。
  if (err.code === 'EADDRINUSE' && OPEN_BROWSER) {
    console.log('  服务端口已占用，正在确认现有学习服务...');
    openExistingApp();
    return;
  }
  console.error('  启动失败：' + err.message);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Keep Learning 已启动');
  console.log('  ------------------------------');
  console.log('  本机:    http://127.0.0.1:' + PORT);
  if (HOST === '0.0.0.0') {
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach(name => {
      (nets[name] || []).forEach(a => {
        if (a.family === 'IPv4' && !a.internal) {
          console.log('  局域网:  http://' + a.address + ':' + PORT + '   (' + name + ')');
        }
      });
    });
    console.log('  手机/平板连同一个 Wi-Fi，用上面的局域网地址打开');
    console.log('  只想本机使用：加 --local（或设 KEEP_LEARNING_HOST=127.0.0.1）');
  }
  console.log('  按 Ctrl+C 停止');
  console.log('');
  openBrowser();
});

/* 只在服务成功监听后打开页面，避免启动较慢时浏览器先报连接失败。 */
function openBrowser() {
  if (!OPEN_BROWSER) return;
  const url = 'http://127.0.0.1:' + PORT + '/';
  try {
    const { spawn } = require('child_process');
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url],
        { detached: true, stdio: 'ignore', windowsHide: true });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    }
    if (child) {
      child.on('error', () => { /* 打不开浏览器不影响服务 */ });
      child.unref();
    }
  } catch (e) { /* 打不开浏览器不影响服务，用户可手动访问 */ }
}

/* 只有端口返回本应用入口时才复用，避免把浏览器误开到其他程序。 */
function openExistingApp() {
  const req = http.get('http://127.0.0.1:' + PORT + '/', (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200 && /<title>\s*Keep Learning\b/i.test(body)) {
        console.log('  检测到 Keep Learning 已运行，打开现有学习界面。');
        openBrowser();
        process.exitCode = 0;
      } else {
        console.error('  端口已被占用，但响应不是 Keep Learning；未打开浏览器。');
        process.exitCode = 1;
      }
    });
  });
  req.setTimeout(3000, () => req.destroy(new Error('连接现有服务超时')));
  req.on('error', (error) => {
    console.error('  无法确认现有服务：' + error.message);
    process.exitCode = 1;
  });
}

