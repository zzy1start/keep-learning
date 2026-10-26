# Building Keep Learning

本仓库是 **Keep Learning** 的开源源码。代码许可 MIT；内置词库数据许可见 [NOTICE](NOTICE) 与 [LICENSES/](LICENSES/)。

仓库默认是 **lite 源码**：不包含 `assets/audio/`（约 48MB MP3）和 `assets/models/`（约 258MB Piper 模型），
因此 clone 体积可控；缺少它们时应用会回退到系统语音，不会崩溃。

## 平台支持

| 平台 | 状态 | 说明 |
|---|---|---|
| Windows 10/11 | ✅ 支持 | Chrome/Edge + `serve.js`；桌面快捷方式 |
| Android 平板（arm64） | ✅ 支持 | lite APK，Android 6.0+（minSdk 23），平板 UI |
| iPad / iPhone | 🚧 制作中 | iOS 原生版在制作中；暂无构建 |
| macOS | 🚧 制作中 | 桌面原生版在制作中；暂无构建 |
| Android 手机 | 🚧 制作中 | 手机适配在制作中；暂无支持 |
| Linux / 其他 | ❌ 不支持 | 未测试 |

> 当前只发布 GitHub，不发布 Gitee。

## 环境要求

| 依赖 | 版本/说明 |
|---|---|
| Node.js | 20 或 22（推荐 22 LTS） |
| pnpm | 9.x（`corepack enable` 后使用 lockfile；也可 `npm i -g pnpm@9`） |
| JDK | 21（Capacitor 7 / Android Gradle 要求） |
| Android SDK | compileSdk 35；设置 `ANDROID_HOME`，或让 `tools/init-android.cjs` 写入 `android/local.properties` |
| Python 3 + edge-tts + ffmpeg | 仅生成离线音频包时需要，见 [docs/36-离线音频包生成.md](docs/36-离线音频包生成.md) |
| macOS + Xcode | 🚧 iOS 制作中；仓库暂不包含 iOS 工程 |

## 1. 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 2. 跑自检

```bash
node tools/check-all.cjs
```

lite 源码缺少大体积资源时，`check-audio-pack.cjs` 会自动 SKIP；其余套件应通过。
若只改前端，可先跑相关的几套：

```bash
node tools/check-data-integrity.cjs
node tools/check-import-pipeline.cjs
node tools/check-vocab-engine.cjs
node tools/check-feedback-mail.cjs
```

## 3. 构建 Web 资源

```bash
# lite：不打包音频（官方 Release 使用这个）
node tools/build-android.cjs --no-audio

# 本地需要离线音频时：先生成，再构建
node tools/gen-audio-pack.cjs
node tools/build-android.cjs
```

产物在 `dist-android/`。

## 4. 构建 Android APK

```bash
node tools/init-android.cjs      # 从 native/ 模板重建 android/ 工程
cd android
./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug
```

APK：`android/app/build/outputs/apk/debug/app-debug.apk`。

正式签名：在项目根目录放 `keystore.properties` + `.jks`（**不要提交**），再 `./gradlew assembleRelease`。
没有签名材料时会自动回退到 debug 签名，仅供本地测试。

## 5. 本地运行 Web 版

```bash
node serve.js                    # 默认 http://127.0.0.1:8777
```

或双击 `启动.bat`（Windows）。

## 6. 生成离线音频包（可选）

见 [docs/36-离线音频包生成.md](docs/36-离线音频包生成.md)。Windows 可直接双击 `生成音频包.bat`。
生成的 MP3 **不要提交 git、不要上传公开 Release**。

## 7. 制作中 / 未支持平台

**制作中（暂无构建，不要按可用版本宣传）：**

- **iOS / iPad**：需要 macOS + Xcode + Apple 开发者账号，并移植 TTS/AudioPack/LocalTts/PDF/Print 插件；暂无 iOS 工程。
- **macOS**：桌面原生版在制作中；暂无打包。
- **Android 手机**：手机布局/交互适配在制作中；APK 可能能装但不保证体验。

**未支持：**

- **Linux / 其他**：未测试、不提供构建。

## 发布

- 官方 Release 使用 **lite APK**（不含音频）；签名证书指纹见 README「官方渠道与 APK 签名校验」。
- **只发布 GitHub**（不发布 Gitee）。
- GitHub Actions：`ci.yml` 跑自检 + lite Web 构建；`release-lite-apk.yml` 在打 tag 时构建 **CI debug 签名** APK（文件名含 `CI-debug`，仅供测试）；官方包由维护者用正式 keystore 本地构建。
- 平台限制：只构建 **Android 平板 arm64** APK；Windows 走浏览器/源码；iOS/iPad、macOS、Android 手机在制作中，暂无构建。
