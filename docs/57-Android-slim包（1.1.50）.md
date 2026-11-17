# 57 · Android slim 包（1.1.50，2026-11-17）

> 目标：把 APK 从 **304 MB** 降到 **59 MB**，让「点链接→下载→安装」在手机/平板上真正可行。

## 1. 体积账

1.1.49 lite 包（304,133,306 B）解包后 360.6 MB，其中：

| 内容 | 解压后 |
|---|---|
| `assets/public/assets/models`（Piper 语音模型，381 个文件） | **258.3 MB** |
| 其余（JS/CSS/题库/词典/vendor/native lib/dex） | 102.3 MB |

模型是 onnx，几乎不可压缩，所以它占了 APK 总体积的 85%。`--no-audio` 只剔音频，没动模型——这就是「lite 包还有 304 MB」的原因。

## 2. 改动

`tools/build-android.cjs` 新增 `--no-models`（等价环境变量 `KEEP_LRN_NO_MODELS=1`）：

```js
const NO_MODELS = process.argv.includes('--no-models') || process.env.KEEP_LRN_NO_MODELS === '1';
// assets 过滤：!(NO_MODELS && n === 'models')
```

缺模型时应用回落到系统 TTS（BUILDING.md 已有的行为：缺 `assets/models` 不崩溃）。

## 3. 构建

```bash
node tools/build-android.cjs --no-audio --no-models   # dist-android: 295 files / 45.82 MB
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android && gradlew.bat assembleRelease
```

版本号：`android/app/build.gradle`（本机构建用，不入库）已同步到 versionCode **74** / versionName **1.1.50**；
入库模板 `native/android/gradle-templates/app-build.gradle` 同步改过。

## 4. 产物与核验

| 项 | 值 |
|---|---|
| 文件 | `KeepLearning-1.1.50-slim-release.apk` |
| 大小 | **61,981,363 B**（59.11 MB），1.1.49 是 304,133,306 B |
| SHA-256 | `7CAC356D8CCE255D128FD443E02269CD31C3B0C824E5EC867DAE05A519878E83` |
| 包名 | `com.keeplrn.tablet` |
| 版本 | versionCode **74** / versionName **1.1.50**（aapt2 dump badging） |
| ABI / minSdk / targetSdk | arm64-v8a / 23 / 35 |
| 签名证书 SHA-256 | `44F02BF27F1B662E018631641C309CB0B86F1633960CD61F394FD52C28752B6D`（与 README 官方指纹一致） |
| 包内 models 条目 | **0** |
| 包内 *.mp3 条目 | **0** |
| assets/public 体积 | 45.82 MB（与 dist-android 一致） |
| 条目总数 | 865（1.1.49 为 1246，差值 = 381 个模型文件） |

## 5. 影响与未验证

- **发音**：没有 Piper 模型 → 走系统 TTS（Android 自带英文语音）。设置页若选择「本地 Piper」会回落，不会崩溃；
  想要离线自然音色仍可按 docs/36 自行生成音频包，或等待后续「按需下载模型」。
- **未做真机安装验证**：本机没有连接设备，本轮完成的是签名核验、版本核验、包内容核验；
  首次真机安装建议重点看：覆盖安装 1.1.49（versionCode 73 → 74，签名相同应可覆盖）、系统 TTS 是否可选、设置页语音项是否报错。
- 旧版 1.1.49（含模型）仍可从 v1.1.49 Release 下载，供需要离线语音的用户使用。

## 6. 发布

已补挂到 <https://github.com/zzy1start/keep-learning/releases/tag/v1.1.50>：
`KeepLearning-1.1.50-slim-release.apk` + `.sha256`。
