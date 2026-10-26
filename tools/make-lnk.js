/* 使用 Windows 自带的 Shell Link COM 接口生成 .lnk，无 npm 依赖。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HEADER_SIZE = 0x4C;
const CLSID = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

function verifyLnk(buf, expected = []) {
  const errors = [];
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return ['文件短于 ShellLinkHeader'];
  if (buf.readUInt32LE(0) !== HEADER_SIZE) errors.push('HeaderSize 不等于 76');
  if (!buf.slice(4, 20).equals(CLSID)) errors.push('Shell Link CLSID 错误');

  const flags = buf.readUInt32LE(20);
  if (!(flags & 0x00000001)) errors.push('快捷方式未包含目标 IDList');
  if (!(flags & 0x00000002)) errors.push('快捷方式未包含 LinkInfo');
  if (!(flags & 0x00000010)) errors.push('快捷方式未包含工作目录');
  if (!(flags & 0x00000020)) errors.push('快捷方式未包含参数');
  for (const item of expected) {
    const text = String(item);
    const latin = Buffer.from(text, 'latin1');
    const unicode = Buffer.from(text, 'utf16le');
    if (!buf.includes(latin) && !buf.includes(unicode)) errors.push('缺少字段: ' + text);
  }
  return errors;
}

/**
 * 校验 .ico 目录结构是否可用。
 * Windows 在 IconLocation 指向的图标文件无法解析时，会**静默回落到默认快捷方式图标**
 *（白色文档 + 箭头），这正是"图标不见了"最容易被忽略的一种原因，所以这里提前拦下。
 */
function verifyIco(buf) {
  const errors = [];
  if (!Buffer.isBuffer(buf) || buf.length < 6) return ['图标文件为空或过短'];
  if (buf.readUInt16LE(0) !== 0) errors.push('ICONDIR.reserved 不为 0');
  if (buf.readUInt16LE(2) !== 1) errors.push('不是图标类型（type != 1）');
  const count = buf.readUInt16LE(4);
  if (!count) errors.push('图标目录项为 0');
  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16;
    if (offset + 16 > buf.length) { errors.push('图标目录被截断'); break; }
    const size = buf.readUInt32LE(offset + 8);
    const dataOffset = buf.readUInt32LE(offset + 12);
    if (!size || dataOffset + size > buf.length) errors.push('第 ' + i + ' 张图标数据越界');
  }
  return errors;
}

function createLnk(target, args, workDir, desc, linkPath, iconPath) {
  if (process.platform !== 'win32') throw new Error('创建 Windows 快捷方式需要 Windows');

  target = path.resolve(target);
  workDir = path.resolve(workDir);
  linkPath = path.resolve(linkPath || path.join(os.homedir(), 'Desktop', 'Keep Learning.lnk'));
  iconPath = path.resolve(iconPath || path.join(__dirname, '..', 'assets', 'english-app.ico'));
  const iconLocation = iconPath + ',0';
  const tempPath = linkPath.replace(/\.lnk$/i, '.tmp-' + process.pid + '.lnk');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error('快捷方式目标不存在: ' + target);
  }
  if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
    throw new Error('工作目录不存在: ' + workDir);
  }
  if (!fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) {
    throw new Error('快捷方式图标不存在: ' + iconPath);
  }
  const iconErrors = verifyIco(fs.readFileSync(iconPath));
  if (iconErrors.length) throw new Error('快捷方式图标文件无效（' + iconPath + '）：' + iconErrors.join('；'));
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  // 用 Base64 传入数据，避免路径、引号或中文进入 PowerShell 源码时被转义。
  const payload = Buffer.from(JSON.stringify({
    target,
    args: String(args || ''),
    workDir,
    desc: String(desc || ''),
    iconLocation,
    linkPath: tempPath,
  }), 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "')) | ConvertFrom-Json",
    '$shell = New-Object -ComObject WScript.Shell',
    '$link = $shell.CreateShortcut([string]$data.linkPath)',
    '$link.TargetPath = [string]$data.target',
    '$link.Arguments = [string]$data.args',
    '$link.WorkingDirectory = [string]$data.workDir',
    '$link.Description = [string]$data.desc',
    '$link.IconLocation = [string]$data.iconLocation',
    '$link.WindowStyle = 7',
    '$link.Save()',
    '$check = $shell.CreateShortcut([string]$data.linkPath)',
    'if ($check.TargetPath -cne [string]$data.target) { throw "TargetPath readback mismatch: $($check.TargetPath)" }',
    'if ($check.Arguments -cne [string]$data.args) { throw "Arguments readback mismatch: $($check.Arguments)" }',
    'if ($check.WorkingDirectory -cne [string]$data.workDir) { throw "WorkingDirectory readback mismatch: $($check.WorkingDirectory)" }',
    'if ($check.IconLocation -ine [string]$data.iconLocation) { throw "IconLocation readback mismatch: $($check.IconLocation)" }',
    "Write-Output 'Shell Link saved and read back successfully'",
  ].join('; ');
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodedCommand,
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || result.stdout || 'PowerShell 退出码 ' + result.status).trim();
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) { /* 保留原始错误 */ }
    throw new Error('Windows Shell Link 创建或读回失败: ' + detail);
  }

  let buf;
  try { buf = fs.readFileSync(tempPath); }
  catch (error) { throw new Error('快捷方式没有写入磁盘: ' + error.message); }
  const bad = verifyLnk(buf, [path.basename(target), String(args || '')]);
  if (bad.length) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* 忽略 */ }
    throw new Error('快捷方式结构校验失败: ' + bad.join(', '));
  }
  try { fs.renameSync(tempPath, linkPath); }
  catch (error) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* 忽略 */ }
    throw new Error('快捷方式替换失败: ' + error.message);
  }
  return buf;
}

module.exports = { createLnk, verifyLnk, verifyIco };

/* 单独运行时在桌面生成快捷方式：node tools/make-lnk.js */
if (require.main === module) {
  const app = path.join(__dirname, '..');
  const out = path.join(os.homedir(), 'Desktop', 'Keep Learning.lnk');
  const args = '"' + path.join(app, 'serve.js') + '" 8777 --open';
  const icon = path.join(app, 'assets', 'english-app.ico');
  const buf = createLnk(process.execPath, args, app, 'Keep Learning', out, icon);
  console.log('written : ' + out);
  console.log('size    : ' + buf.length + ' bytes');
  console.log('header  : ' + buf.readUInt32LE(0) + ' bytes (Shell Link)');
  console.log('verify  : native target/arguments/working-directory/icon readback OK');
}
