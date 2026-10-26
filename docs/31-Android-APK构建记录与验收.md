# Android 平板 APK：构建记录与验收清单

> 依据 `docs/30-Android平板APK独立版-实施交接.md` 实施。  
> 当前状态：**debug APK 已构建成功，未在真实平板上安装/验收**；下列“待测”项不得当成已通过。

## 1. 构建产物

- APK：`keeplearning-multidevice/KeepLearning-android-debug.apk`（工程内副本 `english-app/KeepLearning-debug.apk`）
- 包名：`com.keeplrn.tablet`
- 版本：`1.1.18-test`（versionCode 30）
- 大小：405.18 MB
- SHA-256：`86BAFE9996DE0F249AA9D2D0997B96D1888543E06E4F56A98B0CA09F3A4946FA`
- 签名：Android Debug（仅自用测试；升级必须继续用本机同一个 debug keystore）
- minSdk 23 / targetSdk 35

## 2. 已完成

- `tools/build-android.cjs`：白名单构建 `dist-android/`，剔除 `data/content` 中 **37 条** `mine:true` 个人题目，生成隐私扫描；发布目录不含 `serve.js`、`sw.js`、`docs`、`tools`、原始 PDF、备份、`.git`。
- Capacitor 7.6.9 Android 工程已生成，`webDir=dist-android`，本地资源随 APK 打包，不依赖电脑/Pages。
- 原生 TTS 插件 `TtsPlugin` + JS 兼容层 `js/native-tts.js`：在 Capacitor 原生环境把 `speechSynthesis` 映射到 Android TextToSpeech；桌面/PWA 环境不生效。
- AI 原生 HTTP 桥 `js/native-http.js`：Capacitor 下把外部 AI 请求交给 `CapacitorHttp`，绕开 WebView CORS；同源请求仍走浏览器 fetch。
- 学习进度 v2 导出/导入：`Store.progressBackup()` 带 `version:2`、`personalContent`（个人题库正文）、`importedPapers`；`Store.importProgress()` 覆盖个人题库并写入 `contentBackup`；不含 `settings`/AI Key。

## 2.1 1.0.1 修复

- 语音：Android TTS 初始化等待；原生环境没有枚举到音色时**立即用系统默认音色**，不再空等/误弹缺语音包；TTS 未就绪自动重试 12 次；缺音色弹窗按平台给步骤。
- PDF 导入：补 `Math.sumPrecise`、`Promise.withResolvers`、`Array.toSorted/toReversed/with` 旧 WebView 兼容。
- 阅读：词性翻译只高亮当前词 + 词旁浮窗（可加生词本）；长难句模式才整句高亮；提示按模式区分。
- 做题模式：新增手写笔记画布、橡皮擦、清除。
- 导出：Capacitor 下改用 Filesystem + 系统分享，不再依赖浏览器 `a[download]`。

## 2.2 1.0.2 修复

- 系统音色为 0 时自动使用在线词典音频兜底（有道 dictvoice，单词/句子均可），设置页可关闭；系统音色可用时不走在线。
- 词性统一显示 v. / n. / adj. 等简写；音标统一为 /.../，并把 ASCII 冒号/撇号修成 IPA。
- 修复阅读里遗留的重复选中分支：词性模式下拖选不会再变成“整句”分析。
- 词旁浮窗：点页面其他位置/滚动/切词自动关闭。
- 阅读两列题目标题高度对齐，选项从同一基线开始。
- PDF 旧 WebView polyfill 追加 Promise.try、findLast/findLastIndex、Object.hasOwn。

## 2.3 1.0.3 修复

- PDF.js Worker 内补 Math.sumPrecise/withResolvers/findLast/toHex：之前主线程 polyfill 进不了 Worker，旧平板仍报 Math.sumPrecise is not a function。
- Android WebView 允许无手势自动播放音频，在线词典发音/听力自动播放不再被拦。
- 阅读词性分析浮窗与下方词性面板去掉音标，只保留词性简写+释义。
- 阅读题型标签的数量改为按全部题库统计，切换题型不再显示“全 0/像被删光”；空题型页明确说明只是筛选。

## 2.4 1.0.4 修复

- PDF 的 Root/xref 损坏时用 pdf-lib 重新解析另存再交给 PDF.js（针对 Invalid Root reference）。
- 阅读/翻译的筛选为空时显示“清除筛选，查看全部”，并明确说明切换题型不会删数据。
- 阅读两列最后一道落单题居中占整行。

## 2.5 1.0.5 修复

- 内置 Noto Sans 字体，音标统一使用 IPA 字体，解决平板音标显示成方框的问题。
- PDF 修复 fallback 保留未转移的 ArrayBuffer 副本，修复 “Cannot perform Construct on a detached ArrayBuffer”。
- 阅读/翻译筛选为空时自动切回全部题库，并保留“清除筛选”按钮。
- 在线词典发音默认开启，并新增「测试在线发音」按钮与错误状态。
- 阅读词性浮窗与面板不再显示音标。

## 2.6 1.0.6 离线音频包小样

- 20 个 CET6 单词 + 20 条内置听力脚本，男女声各一份（en-GB-Sonia / en-GB-Ryan），共 80 个 MP3，约 2.01 MB。
- 新增原生 AudioPackPlugin（Android MediaPlayer）：读 APK assets、支持 stop 与 0.5–2.0 倍速。
- speech.js 播放顺序改为：音频包 → 在线词典兜底 → 系统 TTS。
- 设置页新增「离线音频包小样」状态与两个试听按钮。
- 仅小样覆盖；其它词/句仍走原有兜底。

## 2.7 1.0.7 单词音频修复

- 原因：单词播放会先进入“真人词典发音”层，音频包优先级在其后；句子没有词典层，所以句子能播、单词不能。
- 修复：AudioPack 提升到 Speech.speak 最前；并允许没有 word:true 的调用（阅读/生词本“读”按钮）命中单词音频。
- 真机待确认；JS mock 已确认词典开启时仍走 audio/words/f/001.mp3。

## 2.8 1.0.8 全量离线音频包（五本词书）

- 五本词书去重 11,187 词 + 内置听力 62 句，男女声各一份，共 22,498 个 MP3。
- Edge TTS 生成：女声 en-GB-SoniaNeural，男声 en-GB-RyanNeural；0 条失败。
- 统一转 24 kbps 单声道并裁掉首尾静音：音频 42.5 MB；APK 70.61 MB。
- JS 索引校验：words 11187 / sentences 62；单词无 `word:true` 也能命中。
- `AudioPackPlugin` 仍是 v1.0.6 的 MediaPlayer 实现，支持 stop / 0.5–2.0 倍速。
- 未覆盖：导入的 13 篇听力没有 Tapescript，仍无法生成；导入的新文章也不会自动入包。
- 全量音频未做逐条人工听审；Edge 生成的声音可能有专名/多音词读法问题。

## 2.9 1.0.9-test 本地 TTS 试验

- 引入 sherpa-onnx v1.13.5 Android AAR（arm64-v8a），新增 LocalTtsPlugin。
- 模型：vits-vctk.int8.onnx（39.8 MB）+ lexicon.txt（36.7 MB）+ tokens.txt；VCTK 109 speakers。
- 合成结果写应用私有目录 `files/tts-cache/*.wav`，由 AudioPackPlugin 的 filePath 播放。
- 设置页新增「本地 TTS 试验」按钮；首次合成要加载模型，可能数秒。
- APK 仍包含完整 22,498 个音频包；只用于端侧验证，未接入正式播放链路。
- 未做真机验证；模型/数据许可、发热、内存、首句延迟待测。

## 2.10 1.0.10-test 音色/数字修正

- 本地 TTS 增加 VCTK 音色选择（0/10/20/.../108），用于试听男女声与清晰度。
- 合成前增加英文文本规范化：年份 2030 → twenty thirty，数字/百分比/金额/AI 等缩写转写，解决数字被跳过。
- 真机反馈：首句约 2 秒、缓存有效、离线可播、无崩溃；当前 VCTK 音色清晰度待换 speaker 或改用 Piper 模型。
- 测试 APK 139 MB 左右；仍未接入正式播放链路。

## 2.11 1.1.0-test 四音色 Piper

- 新增四个 Piper medium 本地音色：Alan（英男）、Jenny（英女）、Ryan（美男）、Amy（美女）。
- 每个模型约 63 MB；共享 eSpeak-ng-data；APK 333.42 MB。
- sherpa-onnx Python 侧已用同一 tokens/espeak 配置验证四个模型均可生成 WAV（22050 Hz）。
- 设置页「本地 TTS 试验」改为四音色下拉；合成仍走 LocalTtsPlugin → WAV 缓存 → AudioPackPlugin。
- 未做 Android 真机运行验证；体积/安装时间/内存/首句延迟待测。
- 仍未接入正式播放链路；四六级 MP3 绑定/Tapescript 处理未做。

## 2.12 1.1.1-test PDFBox 兜底

- 新增 PdfTextPlugin（PDFBox-Android 2.0.27）：lenient 解析 PDF 文本。
- PDF.js 失败 → pdf-lib 修复 → PDFBox 原生兜底，三级链路。
- 目标错误：Invalid Root reference / pdf-lib 的 Expected instance of e。
- APK 342 MB（含四音色模型 + 完整离线音频）。
- 未真机验证 PDFBox 对用户这份 PDF 是否成功；需要用户重试并反馈新错误。

## 2.13 1.1.3-test 多套/听力提示

- 导入正文识别“第3套”/年份/月份，自动填 setNo（10.19 测试.pdf → 2024 年 6 月第 3 套）。
- 识别“本套听力未重复显示/与第一二套相同”，导入成功页提示；不会把听力当原文编造。
- 导入结果提示阅读 Section 数与实际入库篇数不一致（用于定位“两篇只识一篇”）。
- AI prompt 增加“听力未重复显示返回空、不要用选项冒充原文”。
- 尚未实现：同套听力自动挂到缺听力套；Section B 筛选消失；其他模块导入后消失的完整重构；URL 文本抓取+AI审核+本地朗读。

## 2.14 1.1.5-test 月份+套别合并

- Picker 的“月份”下拉改为“6月·全部套 / 6月·第1套 / 6月·第2套”复合选项，阅读/听力/写作/翻译四个模块共用。
- 选择复合项后 read() 拆回 session + set，filter 仍按原字段过滤。
- 只有该年该月存在 setNo 数据时才出现套别选项。

## 2.15 1.1.6-test 删除导入/TTS 崩溃修复

- 设置 → 数据管理新增「删除所有导入的真题（PDF/文档）」；只删除 mine 导入内容，保留单词进度/生词本/统计。
- 本地 TTS：eSpeak-ng-data 首次从 assets 复制到 filesDir，再以绝对路径传给 Piper；之前直接传 assets 路径可能导致 native 崩溃。
- 月份下拉仍为复合「6月·第1套」。

## 2.16 1.1.7-test 月份套别/删除/TTS 真机验证

- 无线 ADB 已连接（192.168.137.215:37401），安装 v1.1.7 并直接操作。
- 删除所有导入真题：确认删除后 Store.importedPapers=0，听力/阅读/写作 mine 条目均为 0。
- 本地 TTS：通过 WebView CDP 直接调用 LocalTts.synthesize，返回 ok=true、22050 Hz、WAV 路径；界面状态也显示“合成成功并已播放”，不再闪退。
- Picker 真机验证（用两条假数据）：月份下拉出现“6 月 · 全部套 / 6 月 · 第1套 / 6 月 · 第2套”，无独立套别下拉。

## 2.17 1.1.8-test 导入计数口径修复

- 真机检查 2024年6月六级第1套导入结果：听力 7 个材料/25 题、阅读 4 篇/29 题（选词填空10、段落匹配10、Passage One 5、Passage Two 4）、写作 2 题（作文+翻译）。
- 原“已入库 13 道题目”实际是 13 个条目，不是 13 道题；Success 页改为“13 个条目（共 56 道题）”，模块行显示“篇/条目 + 题数”。
- 数据中 4 篇阅读均 setNo=1，readingType 正确；听力 script=0 因为源 PDF 只有题目、无 Tapescript。
- 结论：该次导入没有丢阅读/段落匹配；此前是计数文案误导。

## 2.18 1.1.9-test 导入持久化修复（真机验证）

- 根因：Capacitor WebView 对 `/__save-content` 可能返回 200/index.html，旧逻辑误判保存成功，删掉 contentBackup；重装/刷新后导入正文丢失，只剩个别记录。
- 修复：native 环境一律跳过 `/__save-content`，写 Store.d.contentBackup；重启后 dict.js 合并。
- 真机导入 2024年6月六级第1套：听力7材料/25题、阅读4篇/29题、写作2题，共13条目/56题。
- 刷新后仍为 7/4/2，contentBackup 保留 7/4/2。
- 月份下拉：6月·全部套/6月·第1套；选第1套后 Passage One/Passage Two 唯一；段落匹配能显示 The Curious Case...，不再为空。

## 2.19 1.1.11-test 题干混入/黏连修复

- 阅读段落提交前新增 cleanImportedParagraphs：去掉 Questions X to Y are based on the following passage / Directions 前缀。
- 增加 repairGluedText：用原文词表拆分粘连词、补标点后空格；当前数据已通过 WebView 调试修复题干前缀与标点空格。
- 仍存在少量词间空格丢失（如 andjazzhave），因 PDF/AI 原文没有空格；后续用原文词表/AI 清理继续修。
- 真机集三数据：阅读4篇、写作2题、听力0条（原卷注明与第一/二套共用）。

## 2.20 1.1.12-test 单词音频截断修复

- 根因：上一版为压体积对音频做了首尾静音裁剪，短单词被剪掉约一半（Asia 1.10s→0.41s，April 1.10s→0.46s），听感就是没读完被掐断。
- 重新从 raw 生成 22,498 条音频，去掉 silenceremove，仅转 24kbps；Africa 1.25s、April 1.15s。
- 音频包 42.5 MB→105.51 MB，APK 405.18 MB。
- 真机直接调用 AudioPack.say：Africa 1.34s、April 1.32s，播放完整，不再截断。

## 2.21 1.1.13-test 常见义优先级

- 根因：VocabQuiz.entryOf 先按词书 tr 排序；second 词书只存 v.支持，导致正确答案显示冷门 v 义。
- 改为以内置词典合并义项顺序优先：second 现在 senses = n.秒/瞬间 → v.支持/临时调派 → adj.第二的/次要的 → adv.第二/其次。
- 每个词性最多取 2 个常见释义，过滤生僻义。
- 真机 WebView 验证 choiceFor(second)：正确项 answerId=cet6:second#s0，选项文本“秒；瞬间”。

## 2.22 1.1.14-test 全词库常见义/POS

- Dict.meaningRows 改为先读内置词典顺序，再合并词书；每个词性最多 2 条常见义，第二个词性需至少 2 条常见义才展示。hard → adj.困难/硬 + adv.努力/猛力（不再出现 n.硬海滩）；second → n.秒/瞬间 + adj.第二/次要。
- 全词库扫描：cet4 7508、cet6 5651、kaoyan 6357、toefl 2760、sat 8885 词；可疑首义仅 4/4/17/4/9，均为（两者之中）等正常括注，不是冷门义先出。
- VocabQuiz 选项带 n./v./adj. 标签，正确项可含两个不同词性；settle 只保留 v.解决/安排。
- 真机验证：hard 正确项“adj. 困难的；硬的；adv. 努力地；猛力地”；second 正确项“n. 秒；瞬间；adj. 第二的；次要的”。

## 2.23 1.1.15-test 第三套听力共用

- 选第3套时，若没有自己的听力篇目，自动复制同场次第1套（无1套则2套）的听力篇目到第3套视图，标注“共用第1套听力”。
- 真机验证：月份下拉出现 6月·第3套；选中后 7 个材料、提示“本套听力未单独提供…已自动使用第1套”，卡片带“第3套/共用第1套听力”。
- 限制：第1套源 PDF 的听力只有题干/选项，script=0，所以共用后仍没有原文/音频可播；要能播放，需先给第1/2套补 Tapescript，或接入音频。

## 2.24 1.1.17-test 听力原文补入 + 标签排版

- 卡片头 .tag 加 white-space:nowrap / flex:0 0 auto，card-h 允许 wrap；第3套共用标签合并，不再竖排单字。
- 听力缺原文卡片加“补原文（抓文本 + AI 审核 + 本地朗读）”按钮：粘贴 Tapescript，AI 按题号切分/校对，写回 Dict.content + contentBackup；本地 TTS 直接朗读。
- 2024年6月第一套 7 段听力原文已从公开 Tapescript 抓取并程序化切分补入（27/26/12/9/19/22/15 句），第三套共用第一套后也有原文。
- 真机验证：第三套页面 7 篇材料、原文区有句子、可点击逐句复现；标签横排，card-h 高度 87px（原竖排）。
- 待改进：AI 审核一次性提交 16k 文本在真机上超时；当前补入用了程序化切分，后续改成分段小请求。

## 2.25 1.1.18-test 编号/切篇语音

- 导入续号改为按 year+session+setNo 且只统计 mine 条目；现有 set1/set3 数据通过调试接口重排，听力1-7、阅读1-4、写作1-2。
- 第三套共用听力别名 no 按 donor 顺序重排为 1-7。
- 切篇时先 Speech.stop()，避免上一篇语音继续播。
- 真机验证：set3 part-tabs 从第1篇开始；写作 set1/set3 均从第1题开始。
- 仍未解决：导入题目缺失（阅读 A/B 10 题 q.q 与 opts 全空；听力 Q1-4/Q5-8 题干缺失；set3 Passage Two 1 题选项空）。需下一窗口专门处理导入抽取。

## 2.26 1.1.19-test PDF 导入缺失修复（版本号 31→37，最终 37）

- 修复四类导入缺失：阅读 Section A/B 通用 q/opts、听力伪造题干、Passage Two 缺选项/缺题、写作 Directions 空格与断词。
- 根因不止 AI 输出：Unicode 罗马数字 `Part Ⅲ` 未被识别导致阅读/听力模块错标；推理模型吃光 4400/5200 输出预算导致导入失败；选词填空词库字符串形态/AI 各批次格式不一致；写作批次 schema 缺翻译变体；Section B 被切成 3 个碎片。
- 入库前补全（js/importer.js）：`completeImportedReadingItem`（A：cloze 裸题号→___N___、词库归一化、答案字母归一；B：statement→q、段落字母→opts；traditional：缺题/缺选项按原文回填、题号区间补缺）、`completeImportedListeningItem`（清 Question N/纯题号占位、原文有题干才回填、空题干标 stemMissing）、`polishImportedEnglish`（Directions 空格/粘连词修复，词典精确命中 + 词形保护，URL 不处理）。
- 切批与校验（js/import-pipeline.js）：切点不拆开题干与选项；Part Ⅲ Unicode 罗马数字识别 + 合并批次保留模块；听力题干空/占位只告警、可按原文回填。
- 写作批次 schema 增加 `writingType:"translation"` + `translationText`，翻译题不再整题丢失；引用批次缓存 promptVersion 升 v3。
- AI 输出预算：`_aiSplitBatched` 8000/12000，`ai.js` 截断扩容上限 12000（deepseek-flash 推理模型）。
- 构建产物：`android/app/build/outputs/apk/debug/app-debug.apk`，424,871,888 字节，SHA-256 `18536C52006EC391638B2859F8BA8B85C8B35D37E4404979CA42F5D3ACA6E390`；工程根目录副本 `KeepLearning-debug.apk`。
- 真机（192.168.137.215:37401，versionCode 37 / 1.1.19-test）重新导入 2024-06 六级第一套 + 第三套：听力 7 材料/25 题、阅读 8 篇/60 题（A/B 各 10 题 q+opts 齐、Passage 51-55 齐、Q55 四选项）、写作 4 题（2 作文 + 2 翻译）；听力 7 篇原文脚本从旧数据备份恢复。
- 验收：`node tools/check-import-missing.cjs --items=debug/device-raw-items-after.json` 9/9 PASS；`check-import-pipeline` 26/26；旧快照验收 9/9；全系统自检 29 套（`check-vocab-engine`/`check-vocab-options` 2 套为既有失败，与本轮无关）。
- 未做：四六级听力题干在卷面不存在，只做"不伪造 + 明确标注"，不补题干。

## 2.27 1.1.19-test 拼写完成页统计（versionCode 38→41）

- 拼写/随机练习是轮外练习（`vocabRound=null`），完成页只认引擎报告 → 「本轮正确率」显示 `—%`、升级恒 0。
- 新增轮外练习统计（`_resetFreeStats/_noteFreeResult/_freeReport/_roundReport`），`_begin` 先载入引擎存档，`_finish/_logSession` 统一取报告。
- 修正统计口径：已学=作答过；已掌握=L4 且作答过（不再出现 已学126 < 已掌握160）。
- `stats()` 口径改为「已学=作答过；已掌握=L4且作答过」；`mirrorToSrs` 补写 interval（L4=30 天）修首页「掌握 0」。
- 新增 `tools/check-vocab-round-stats.cjs` 7 项；真机 versionCode 41 验证完成页 20/90%/1、已学 126/已掌握 67，详见 docs/33。

## 2.28 1.1.19-test 模拟用户真机走查（versionCode 42→43）

- 按用户要求用 ADB 真实触摸走查 8 个模块（单词/听力/阅读/写作/翻译/生词本/统计/设置），全程无 JS error、无 logcat 崩溃。
- 修复 3 个真实问题：阅读题型 tab 后列表筛空（Picker.filter 缺省键 + sel={no:'all'}）；Section A 空位下拉点击误触发长难句 AI 分析；首页「掌握 0」/已学<已掌握（mirror interval 口径 + 开轮刷新镜像）。
- 新增/更新回归：check-reading-nav 5 项、check-vocab-round-stats 7 项；真机 v43 复验通过。
- 详细过程、截图清单与未改观察项见 docs/34。
- 第二轮继续测试：树园/词汇量测试/学习设置/拼写真实一轮/对话与四级听力/阅读 AI 解析/写作单句与自定义/翻译单句/生词本搜索与导出弹窗/统计导出与备份分享/设置外观；未发现新崩溃，新增 5 条观察项（见 docs/34 第 6-7 节）。

## 2.29 1.1.21-test 第二轮走查问题全部修复（versionCode 44→45）

- 修复 9 项：APK 隐藏 PWA 退出按钮、整句高亮一致、原生 PrintPlugin（真 PDF 导出）、导出取消提示、已掌握口径统一（生词本改「手动标记」）、内置/导入篇目来源标识、单词限时按阅读量、PDF 标点残留清理+旧档迁移、写作 AI 练习题自动出题与来源标签。
- 补测未覆盖功能：翻译 AI 批改（14/15）、写作 AI 出题、生词本详情/标掌握/导入/删除、主题切换、欢迎弹窗、导出学习进度、本地 TTS、阅读导出弹窗、听力导入向导、树园设置校树。
- 回归：check-ui-round2 9/9；check-all 31 套 / 380 项通过（2 套既有失败不变）。真机截图 62–89。

## 2.30 1.1.23-test 方案A冗余入口清理（versionCode 46→47）

- 删除 9 个重复按钮（写作/翻译顶部批改、阅读生词本、统计两个导出、设置导出生词本/学习报告、单词卡测试、设置重统词库）。
- 改名 2 处（AI 辅助说明、导出阅读生词 PDF）；10 个发音诊断控件收进「发音与音色诊断（高级）」折叠。
- 新增 check-ui-cleanup 8 项；check-all 32 套 / 388 项通过；真机截图 90–101。
- v46 试装发现「学习报告 PDF」两边都删了，v47 在设置→数据管理恢复唯一入口并真机验证打印出 1 页报告。

## 2.31 1.1.25-test 平板竖屏排版修复（versionCode 48→49）

- 翻译页不再套写作两列布局：原文通栏，译文与 AI 评分在 tr-bottom（≤900px 单列）。
- 写作页 ≤1180px 单列；同视口核对首页/单词/听力/阅读/生词本/统计/设置排版均正常。
- 新增 check-ui-layout 2 项；更新 check-translation-view 排版骨架断言；真机截图 102–107。
- v49 补回 v48 丢失的 adv-diag 折叠样式，并把误触的背单词语速恢复 1.0。

## 3. 待真机验收

- 安装后首次断网启动：首页、单词、听力、阅读、写作、翻译、生词本、统计、树园。
- 语音：本地男/女声、单词、听力、停止/重播、语速；原生 TTS 插件在真机能否列出音色并发声（当前仅用 mock 验证 JS 桥）。
- AI：从 Capacitor 环境请求用户配置的 API，确认 CORS/HTTP 桥有效。
- 文件：PDF/DOCX/TXT 导入、长 PDF、拍照/相册、备份导出/导入、PDF 导出。
- 数据：导入多套后强制结束/重启/覆盖升级不丢；v2 备份平板→电脑→平板；存储不足提示。
- 8.8 英寸竖屏/横屏/深色/字体放大：无裁切、无页面级横向滚动、触摸目标。
- APK 覆盖安装升级（不要卸载重装）。

## 4. 复现构建

环境：JDK 21（`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`），Android SDK（`C:\Android\sdk`，platform 35/build-tools 35），pnpm 已安装依赖。

```powershell
cd <项目根目录>
node tools/build-android.cjs
node node_modules/@capacitor/cli/bin/capacitor sync android
cd android
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME='C:\Android\sdk'
.\gradlew.bat --no-daemon assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 5. 安装到平板

- 平板与电脑同一热点：浏览器打开 `http://192.168.137.1:8777/KeepLearning-debug.apk` 下载，允许“安装未知应用”；
- 或 USB 拷贝 APK 后点击安装；
- 安装后桌面图标启动，首次打开不依赖电脑/网络（内置题库随包）。

## 6. 已知缺口（下一阶段）

- 未做正式签名 release APK / 应用图标（当前为 Capacitor 默认图标）。
- 个人题库仍在 `localStorage.contentBackup`，尚未迁 IndexedDB；超过约 5MB 会失败。
- 备份 v2 尚无导入前预览/回滚快照；电脑端导入题库尚未写回 `data/content`。
- 未验证 Android WebView 文件选择/下载、相机、手写、长按/触控笔。
- 未在真机验证 TTS/AI CORS。