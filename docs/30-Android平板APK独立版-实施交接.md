# Keep Learning：Android 平板独立 APK 实施交接

> 状态：实施方案，尚未制作 APK 或完成真机验证。2026-10-18 用户确认：**直接下载安装的 Android 平板 App 优先**；AI、可选在线音色允许联网，本地音色/内置题库可离线。此前 [29 号 PWA 方案](29-Android平板独立版-PWA与APK实施交接.md) 已被本方案取代。

## 1. 交付定义

- 交付一个可在用户 Android 平板安装、从桌面图标启动、无浏览器标签栏的**签名 APK**。`index.html`、CSS、JS、必要 `data/*`、图片和 PDF.js 等随 APK 打包，**首次安装后不联网也能进入本地练习**；不依赖电脑、Cloudflare Pages、TWA 或热点。
- 保留单词、听力、阅读、写作、翻译、生词本、统计、树园、设置和现有 76px 平板图标栏。以 8.8 英寸竖屏真机为主；横屏/桌面布局保持现有响应式逻辑，不做手机专项设计。
- 个人学习记录和导入卷子只存平板应用私有空间。电脑互通仅靠手动导出/导入**覆盖式**便携备份；接收设备设置与 AI Key 不变。禁止自动同步或建设项目云数据库。
- AI 识别、评分、分析走用户自行配置的联网 API；不把 API Key 写入 APK。离线时学习、导入本地文件及系统离线 TTS 继续工作，AI 给出联网提示。
- 听力和单词先用 Android 系统 TTS 的**已安装本地英语音色**，保留现有起音时机、男女音色、试听、语速、停止/重播。在线音色可选：优先列出系统 TTS 提供且标明需联网的音色；若目标平板没有，则经用户自行配置的在线 TTS 提供方调用。音色资源也可由用户在 Android 语音引擎设置里下载后离线使用。不要擅自重新启用已停用的 Kokoro 引擎。

## 2. 需要注册什么

| 用途 | 当前建议 |
| --- | --- |
| 在自己的电脑构建、用 ADB 安装到自己的平板测试 | **不需要 Cloudflare、Google Play 或开发者账号**。需要安装 Node.js、Android Studio/SDK，并在平板打开开发者选项和 USB 调试。Android 官方说明 ADB 安装可继续用于未注册应用。 |
| 把 APK 文件发给自己的设备，点击文件安装 | 不需要 Cloudflare/Play 发布。安装体验受 Android 设备和地区的开发者验证政策影响；可能需要允许从该来源安装，未来可能需“高级安装流程”。为避免以后更新受阻，可考虑免费的 Android Developer Console **有限分发**注册：需要 Google 账号、两步验证及付款资料，最多 20 台已授权设备；这不是当前开始编码的前置条件。 |
| 发布到 Google Play | 需要 Play Console 开发者账号、一次性注册费及商店发布材料。**本轮自用 APK 不做这一步。** |
| AI 或在线 TTS | 只有选择需要 Key 的第三方提供方时，才需要该提供方账号/额度。系统本地 TTS 不需要项目账号；设备下载语音包是否需要应用商店账号取决于厂商引擎。 |

Android 开发者验证政策在变化：官方当前说明 2026-09-30 起先在部分地区/渠道执行，计划 2027 年扩大。交付时应以目标平板所在地区和官方当时政策复核，不能承诺“任何安卓设备永远点 APK 就能无提示安装”。

## 3. 技术方案

1. **用 Capacitor 包装现有原生 HTML/CSS/JS，而不是重写页面。**新增 `package.json`、确定性的 `dist-android/` 构建脚本、`capacitor.config.*` 和 `android/` 工程。`webDir` 指向 `dist-android/`；把现有静态相对路径和 PDF.js worker/CMap/字体路径全部纳入构建清单。`npx cap sync android` 后由 Android Studio 构建 APK。
2. **资源随包，个人数据分离。**APK 只含已确认可分发的内置题库和素材。当前 `data/content/listening.json`、`reading.json`、`writing.json` 有 `mine:true` 的个人导入条目；构建时必须剔除并做扫描，不要把个人卷子或 Key 烧进 APK。把用户导入题库存应用私有持久空间（IndexedDB 或原生 `Directory.Data`/SQLite，经实测选型）；卸载应用会删除私有数据，因此保留可导出的备份。
3. **本机存储与迁移。**`js/store.js` 现用 `localStorage`，`js/importer.js` 静态模式下用 `contentBackup` 暂存大题库。新增明确的 Web/Android 存储适配层；首次启动迁移旧记录、写入失败告警。导入后重开 App、升级 APK 均不丢题目。
4. **便携备份 v2。**导出学习记录、生词本、个人题库正文、`importedPapers`、自定义题及来源信息；排除设备设置、AI Key、内置题库与缓存。导入前显示来源、时间和覆盖范围，用户确认后覆盖便携字段，保留接收端设置/Key；先做本机回滚快照。电脑端导出要从 `data/content/*.json` 中收集 `mine:true`，不能只读当前 `Store.d.contentBackup`。旧备份单独迁移并提示缺失风险。
5. **语音适配。**先在目标平板验证 WebView 的 Web Speech 是否实际能列出音色并发声；若不稳定，则做一个最小 Android `TextToSpeech` Capacitor 插件，向现有 `js/speech.js` 暴露 `listVoices/speak/stop`、开始/完成/错误事件，必要时暴露词边界事件；用 `Voice.isNetworkConnectionRequired()` 区分本地/在线。Android 设置页保留试听、音色切换和语音安装指引。不要改变用户确认过的播放时机。第三方词典录音依赖桌面 `/__dict-audio` 代理，在 APK 中须关闭该路径并稳定回落系统 TTS，或另行取得可合法打包的音频资源。
6. **联网与文件桥接。**AI API 优先保留现有兼容接口；若 WebView 请求遇到 CORS，再用 Capacitor 原生 HTTP 适配，保持超时、取消与错误提示。PDF/DOCX/TXT 由 Android 文件选择器导入，照片由相机/相册，备份和 PDF 用系统分享/保存流程导出；逐一验证长 PDF、手写照片和大文件。在线 TTS 只向用户选择的服务发送待朗读文本。
7. **应用更新。**固定包名和签名密钥，版本升级使用同一密钥。先备份，再用新版 APK 覆盖安装验证学习记录仍在；**不要卸载重装来测试升级**。签名密钥放在仓库外安全保存，不写进代码或提交记录。

## 4. 实施顺序与每阶段的过关条件

| 阶段 | 工作 | 过关条件 |
| --- | --- | --- |
| A. 保护基线 | 记录当前 `git status` 和个人题目；建立只打包公开资源的 `dist-android/` 构建；不要 reset/clean 当前未提交工作 | 发布目录无 `mine:true`、AI Key、原始 PDF；所有静态资源路径可解析 |
| B. 空壳 APK | 接入 Capacitor/Android，打包现有页面与内置资源 | 平板首次安装后，飞行模式下可从图标打开首页和内置单词/练习；无电脑/Pages 依赖 |
| C. 本机数据 | 持久化个人题库，修复 v2 覆盖式备份与电脑导入/导出 | 导入多套 PDF 后强制结束再启动、升级 APK，题库和进度保留；备份双向传输准确且不改接收端 Key |
| D. 原生能力 | 语音、AI HTTP、文件选择、相机、PDF/备份导出 | 无网本地音色可发声；联网 AI/可选在线音色按配置可用；文件功能逐项真机通过 |
| E. 平板验收 | 8.8 英寸竖/横屏、深色、字体放大、触摸/笔、长时间导入和异常网络 | 九个页面/树园无重要裁切；离线/联网、重启、升级、存储不足均有实际记录与截图 |
| F. 自用发布 | 生成签名 APK，记录包名、版本、哈希和签名证书指纹，备份签名密钥 | 用户平板可安装并覆盖升级；不需要 Play/Pages，交付 APK 与备份说明 |

## 5. 给其他 AI 的直接指令

> 当前目标是**自用 Android 平板独立 APK**，不是先部署 PWA/TWA。请在 `<项目根目录>` 依据 `docs/30-Android平板APK独立版-实施交接.md` 按 A→F 实施。保留现有全部模块与平板布局；先保护工作区未提交修改和个人题目，禁止 reset/clean。使用 Capacitor 将内置网页资源打进 APK，个人题库存应用私有空间，AI/可选在线音色走用户配置的联网服务，本地系统 TTS 离线可用。修复进度备份为包含导入题库的覆盖式 v2，保留接收设备设置与 AI Key。每阶段给出源码、构建产物和真实设备验收证据；未实际在安卓平板测试的项目标“待测”，不得声称已通过。无需 Cloudflare/Google Play 账号即可开始自用 APK 开发；正式上架不在本轮范围。

## 6. 官方依据（2026-10-18 核对）

- [Capacitor：接入现有网页应用](https://capacitorjs.com/docs/getting-started)
- [Capacitor：Android 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor：原生 HTTP](https://capacitorjs.com/docs/apis/http)
- [Capacitor：应用文件存储](https://capacitorjs.com/docs/apis/filesystem)
- [Android：TextToSpeech 与 Voice](https://developer.android.com/reference/android/speech/tts/TextToSpeech)
- [Android：开发者验证现行说明](https://developer.android.com/developer-verification/guides/faq)
- [Android：免费有限分发账号要求](https://developer.android.com/developer-verification/guides/limited-distribution)
- [Google Play Console 注册说明](https://support.google.com/googleplay/android-developer/answer/6112435)
