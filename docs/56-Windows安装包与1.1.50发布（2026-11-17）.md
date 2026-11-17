# 56 · Windows 安装包 v1.1.50（2026-11-17）

> 本轮把 11-02 之后积压的 89 个文件改动整理成 **1.1.50**，并第一次产出 **Windows 一键安装包**。
> 目的：让普通用户「下载 → 双击 → 用」，不再需要自己装 Node.js。

## 1. 版本与产物

| 项 | 值 |
|---|---|
| 版本 | versionCode **74** / versionName **1.1.50** |
| 安装包 | `KeepLearning-Setup-1.1.50.exe` |
| 大小 | **34,420,223 B**（约 32.8 MB） |
| SHA-256 | `27225eb13029d16e674dc66a6456ee5d9b59ccb68e8c878219a353c23bbfe72a` |
| 安装位置 | `%LOCALAPPDATA%\KeepLearning`（当前用户，无需管理员） |
| 安装后占用 | **305 个文件 / 129.2 MB** |
| 卸载 | 设置 → 应用 → Keep Learning，或开始菜单「卸载」 |
| SW 缓存 | `keeplrn-v36` → **`keeplrn-v37`** |

## 2. 安装包结构

```
%LOCALAPPDATA%\KeepLearning\
├─ KeepLearning.exe        启动器（C# / WinExe，112 KB，无控制台窗口）
├─ runtime\node.exe        Node 22.23.5（87 MB，用户无需自装 Node）
├─ app\                    Web 资源（45.9 MB）：index.html / js / css / data / vendor / assets
│   ├─ serve.js            本地静态服务（127.0.0.1:8777，默认 --local 只监听本机）
│   └─ sw.js               PWA/离线缓存（v37）
├─ 使用说明.txt
└─ logs\server.log         启动日志（排障用）
```

**不含** `assets/models`（258 MB Piper 模型）：Windows 走浏览器语音（Edge 云端神经音色 / 系统 TTS），
模型只在 Android 原生语音引擎里用。去掉后 app 目录从 304 MB 降到 **45.9 MB**。

## 3. 构建命令（本机实测）

```powershell
node tools/build-android.cjs --no-audio          # dist-android（含 models）
robocopy dist-android work\win-package\app /E /XD \dist-android\assets\models
copy serve.js, sw.js -> app\
csc /target:winexe /win32icon:assets\english-app.ico work\win-package\Launcher.cs
makensis /INPUTCHARSET UTF8 work\win-package\installer-abs.nsi
```

启动器行为：探测 8777 是否已有 KeepLearning 在跑 → 有则直接开浏览器（不重复起服务）；
没有则以 `CreateNoWindow` 启动 `runtime\node.exe app\serve.js 8777 --local`，轮询 60×500ms 后开浏览器；
超时弹窗并给出日志路径。`--stop` 走 `POST /__shutdown`（带 `X-Exit-Token`），`--quiet` 时不弹窗（安装/卸载调用）。

## 4. 验证记录（2026-11-17 本机）

| 项 | 结果 |
|---|---|
| `node tools/check-all.cjs` | **59 套全部通过**（`全部通过`，逐套 exit 0） |
| 静默安装 `/S /D=<临时目录>` | 306 个文件落盘，目录结构正确 |
| 启动器启动 | `index.html` 200、`sw.js` 200、`data/content/writing.json` 200 |
| 二次启动 | 复用已有服务（日志只有一条 start） |
| `--stop --quiet` | 端口关闭（curl 000） |
| 卸载 `/S` | 安装目录删除、注册表卸载项清除、端口释放 |
| 发布前清理 | `tools/strip-personal.cjs --apply` 移除 13 条 `mine:true` 个人导入内容（备份在 `work/personal-content-backup/`） |

## 5. 已知限制 / 未验证

- **未做代码签名**：首次运行触发 SmartScreen「更多信息 → 仍要运行」，属预期。
- 沙箱限制下**桌面/开始菜单快捷方式创建未能端到端验证**（写入 Desktop/Start Menu 被拒绝）；
  安装包内 `CreateShortcut` 指令正常，需在无沙箱环境复测一次。
- **Android APK 本轮未重打**；现有 1.1.49 lite 包 304 MB，其中 258 MB 是 Piper 模型，
  做 `--no-models` 分支后可降到约 **46–50 MB**（待实现）。
- 安装包只做 **x64 Windows 10/11**；未测 Win7、ARM64。

## 6. 为什么 Windows 包不带「语音包自动下载」

- `js/audio-pack.js` 的播放路径依赖 `Capacitor.Plugins.AudioPack`（Android 原生 MediaPlayer），
  浏览器里 `_plugin()` 直接返回 false → **Windows 端根本不会用到 assets/audio**；
- Windows 的自然发音由 **Edge 浏览器的 Azure 神经音色（Online Natural）** 在线合成，音质优于预生成 MP3，
  断网时回落系统 SAPI 语音；
- 因此「安装时下载 Edge TTS 语音包」在 Windows 上无收益；Android 侧要做离线，
  更合适的是按需下载 **Piper 开源模型**（可合法分发），而不是 Edge TTS 产物（再分发风险不变）。

## 7. 下一步

1. GitHub 建 `v1.1.50` Release，上传本安装包 + SHA256（源码 commit `5ab146d` 已推送）；
2. 夸克盘建分享目录：安装包 + 使用说明 + 宣传片；
3. Android 出 slim 包（`--no-models`）后再补 Release 资产。
