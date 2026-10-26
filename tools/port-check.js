/*端口探测 + 服务状态检查（Node 实现，供 .bat 调用）
 *
 * 为什么用 Node 而不是 netstat/findstr：
 *   批处理里 `for /f` + 管道 + findstr 的组合在变量提前展开、转义等场景下
 *   极不可靠（实测在 if 括号块内 EXIST_PID 取值为空，导致重复启动检测失效）。
 *   Node 一定是应用的前置依赖，用它探测既可靠又跨环境一致。
 *
 * 用法：
 *   node port-check.js serve    → 端口空闲时 exit 0；已占用时打印 PID 并 exit 10
 *   node port-check.js wait     → 等待端口就绪（最多25秒），就绪 exit 0
 *   node port-check.js stop     → 结束占用端口的进程，exit 0
 *   node port-check.js status   → 打印状态 JSON，exit 0
 */
const net = require('net');
const { execSync } = require('child_process');

const PORT = +(process.env.KL_PORT || 8777);

/** 探测端口是否被占用，返回占用它的 PID（取 netstat 解析）或 0 */
function probe() {
  // 先用 TCP 连接实测（最可靠，不依赖文本解析）
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', err => {
      // EADDRINUSE = 被占用
      resolve(err.code === 'EADDRINUSE' ? pidFromNetstat() || 1 : 0);
    });
    srv.once('listening', () => srv.close(() => resolve(0)));
    srv.listen(PORT, '127.0.0.1');
  });
}

function pidFromNetstat() {
  // 优先用 netstat（无需额外进程），解析失败再退回 PowerShell
  const byNetstat = (() => {
    try {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(':' + PORT) || !/LISTENING/.test(line)) continue;
        const cols = line.trim().split(/\s+/);
        const pid = parseInt(cols[cols.length - 1], 10);
        if (pid > 1) return pid;
      }
    } catch (e) { /* ignore */ }
    return 0;
  })();
  if (byNetstat) return byNetstat;

  // 退回：Get-NetTCPConnection 按端口精确查
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -EA SilentlyContinue | Select -First 1).OwningProcess"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pid = parseInt(String(out).trim(), 10);
    if (pid > 1) return pid;
  } catch (e) { /* ignore */ }
  return 0;
}

/** 探测服务是否可连接（用于 wait） */
function canConnect() {
  return new Promise(resolve => {
    const c = net.connect({ port: PORT, host: '127.0.0.1' });
    const ok = () => { c.destroy(); resolve(true); };
    const no = () => { c.destroy(); resolve(false); };
    c.setTimeout(1500);
    c.once('connect', ok);
    c.once('error', no);
    c.once('timeout', no);
  });
}

const cmd = process.argv[2] || 'status';

(async () => {
  if (cmd === 'serve') {
    const pid = await probe();
    if (pid) { console.log(pid); process.exit(10); }   // 10 = 已占用
    process.exit(0);                                   // 0 = 空闲
  }

  if (cmd === 'wait') {
    // 等待「服务可用」= TCP 能连上，而不是端口空闲。
    // 注意：这里必须用 connect 探测；用 bind 探测会把"已在运行"误判为"未就绪"。
    for (let i = 0; i < 25; i++) {
      if (await canConnect()) {
        console.log('READY');
        process.exit(0);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('TIMEOUT');
    process.exit(1);
  }

  if (cmd === 'stop') {
    const pid = await probe();
    if (!pid) { console.log('NOT_RUNNING'); process.exit(0); }
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log('STOPPED ' + pid);
      process.exit(0);
    } catch (e) {
      console.log('STOP_FAILED ' + pid);
      process.exit(1);
    }
  }

  // status
  const pid = await probe();
  console.log(JSON.stringify({ port: PORT, listening: !!pid, pid }));
  process.exit(0);
})();