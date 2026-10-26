# Building Keep Learning

本仓库是 **Keep Learning** 的开源源码。代码许可 MIT；内置词库数据许可见 [NOTICE](NOTICE) 与 [LICENSES/](LICENSES/)。

仓库默认是 **lite 源码**：不包含 `assets/audio/`（约 48MB MP3）和 `assets/models/`（约 258MB Piper 模型），
因此 clone 体积可控；缺少它们时应用会回退到系统语音，不会崩溃。

## 环境要求

| 依赖 | 版本/说明 |
|---|---|
| Node.js | 20 或 22（推荐 22 LTS） |
| pnpm | 9.x（`corepack enable` 后使用 lockfile；也可 `npm i -g pnpm@9`） |
| JDK | 21（Capacitor 7 / Android Gradle 要求） |
| Android SDK | compileSdk 35；设置 `ANDROID_HOME`，或让 `tools/init-android.cjs` 写入 `android/local.properties` |
| Python 3 + edge-tts + ffmpeg | 仅生成离线音频包时需要，见 [docs/36-离线音频包生成.md](docs/36-离线音频包生成.md) |
| macOS + Xcode | 仅 iOS 原生构建需要（目前仓库未包含 iOS 工程） |

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

## 7. iOS（未来）

代码是 Capacitor 7，理论上可 `npx cap add ios`，但需要 macOS/Xcode 和 iOS 原生插件移植
（TTS/AudioPack/LocalTts/PDF/Print）。目前在路线图中，尚未提供 iOS 工程。

## 发布

- 官方 Release 使用 **lite APK**（不含音频）；签名证书指纹见 README「官方渠道与 APK 签名校验」。
- GitHub Actions：`ci.yml` 跑自检 + lite Web 构建；`release-lite-apk.yml` 在打 tag 时构建 **CI debug 签名** APK（文件名含 `CI-debug`，仅供测试）；官方包由维护者用正式 keystore 本地构建；`mirror-gitee.yml` 把仓库镜像到 Gitee。

### Gitee 只读镜像配置

1. 在 Gitee 创建同名仓库（默认 `ZZY1START/keep-learning`）。
2. 生成一对**部署公钥/私钥**，把公钥加到 Gitee 仓库的「部署公钥」（只读权限即可，镜像推送需要写权限则给可写）。
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：
   - `GITEE_SSH_PRIVATE_KEY`：私钥全文；
   - `GITEE_REPO`（可选）：`git@gitee.com:你的用户名/keep-learning.git`，不填则用默认值。
4. 配好 secret 后，在 GitHub Actions 里手动运行一次 `Mirror to Gitee`；
   确认成功后再取消 workflow 里 `push` 触发器的注释，实现 push/tag 自动镜像。

> 镜像仓库请设为只读说明：Issue/PR 以 GitHub 为准，避免两边分叉。
