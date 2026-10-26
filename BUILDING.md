# Building Keep Learning

本仓库是 **Keep Learning** 的开源源码。代码许可 MIT；内置词库数据许可见 [NOTICE](NOTICE) 与 [LICENSES/](LICENSES/)。

仓库默认是 **lite 源码**：不包含 `assets/audio/`（约 48MB MP3）和 `assets/models/`（约 258MB Piper 模型），
因此 clone 体积可控；缺少它们时应用会回退到系统语音，不会崩溃。

## 平台支持

| 平台 | 状态 | 说明 |
|---|---|---|
| Windows 10/11 | ✅ 支持 | Chrome/Edge + `serve.js`；桌面快捷方式 |
| Android 平板（arm64） | ✅ 支持 | lite APK，Android 6.0+（minSdk 23），平板 UI |
| iPad / iPhone | ❌ 不支持 | 没有 iOS 工程/签名 |
| macOS | ❌ 不支持 | 未打包、未测试 |
| Android 手机 | ❌ 未适配 | 手机布局/交互未完成 |
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
| macOS + Xcode | ❌ 不支持；仓库不包含 iOS 工程，也不提供 iOS 构建 |

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

## 7. 未支持平台

- **iOS / iPad**：没有 iOS 工程、没有签名流程，也没有移植 TTS/AudioPack/LocalTts/PDF/Print 插件。
- **macOS**：未打包、未测试。
- **Android 手机**：APK 可能能装，但手机布局/交互未完成，不提供支持。
- **Linux / 其他**：未测试。

如果以后要做 iOS，需要 macOS + Xcode + Apple 开发者账号，并重写 5 个原生插件；见 README 讨论记录。

## 发布

- 官方 Release 使用 **lite APK**（不含音频）；签名证书指纹见 README「官方渠道与 APK 签名校验」。
- **只发布 GitHub**（不发布 Gitee）。
- GitHub Actions：`ci.yml` 跑自检 + lite Web 构建；`release-lite-apk.yml` 在打 tag 时构建 **CI debug 签名** APK（文件名含 `CI-debug`，仅供测试）；官方包由维护者用正式 keystore 本地构建。
- 平台限制：只构建 **Android 平板 arm64** APK；Windows 走浏览器/源码；iOS/iPad、macOS、Android 手机不在构建范围内。
