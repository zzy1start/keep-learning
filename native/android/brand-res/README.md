# brand-res · Android 品牌图标与开屏启动页

这里保存 **Android 桌面图标（ic_launcher / round / adaptive foreground）** 和 **开屏 splash** 的
品牌素材，是这些资源的仓库级 source of truth。

## 为什么必须入库

`android/` 目录不入库（构建产物），由 `tools/init-android.cjs` 通过 `npx cap add android`
从 Capacitor 模板重新生成。模板自带的 `ic_launcher` / `splash` 是 **Capacitor 默认素材**
（蓝色 X + 网格），不覆盖就会把品牌标换回默认素材。

- 2026-10-29 换标时，图标只用一次性脚本写进了本机 `android/`，脚本又在未入库的 `work/` 下；
- 当天 21:01 重新生成 Android 工程后，品牌图标被模板覆盖；
- 结果 1.1.48 的桌面图标/启动页退回 Capacitor 默认素材，与宣传片/应用内 ZY logo 不一致。

因此把生成好的品牌素材原样入库，由 `tools/install-brand-res.cjs` 在每次重建工程后覆盖到
`android/app/src/main/res/`，并在 CI 用 `tools/check-brand-res.cjs` 做防回归校验。

## 文件内容（26 个 PNG）

| 类型 | 路径 | 尺寸 |
|---|---|---|
| 旧式桌面图标 | `mipmap-mdpi/ic_launcher.png` | 48×48 |
| | `mipmap-hdpi/…` / `xhdpi` / `xxhdpi` / `xxxhdpi` | 72 / 96 / 144 / 192 |
| 圆形图标 | `mipmap-*/ic_launcher_round.png` | 同上 |
| adaptive 前景 | `mipmap-mdpi/ic_launcher_foreground.png` | 108×108 |
| | `hdpi` / `xhdpi` / `xxhdpi` / `xxxhdpi` | 162 / 216 / 324 / 432 |
| 通用启动页 | `drawable/splash.png` | 480×320 |
| 横屏启动页 | `drawable-land-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splash.png` | 480×320 / 800×480 / 1280×720 / 1600×960 / 1920×1280 |
| 竖屏启动页 | `drawable-port-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splash.png` | 320×480 / 480×800 / 720×1280 / 960×1600 / 1280×1920 |

adaptive icon 的背景色由 `android/app/src/main/res/values/ic_launcher_background.xml`（#FFFFFF）提供，
模板默认值即为白色，无需覆盖。

## 由来

2026-10-29 品牌换标（蓝青渐变 ZY 标）时，由 `work/logo-assets/generate_brand_icons.py`
（依赖未入库的 `work/logo-source/new-logo.png`）生成；2026-11-02 从 1.1.47 官方 debug 包
（构建于覆盖之前）里原样提取保存，字节与当时生成的一致。

## 使用

```bash
node tools/install-brand-res.cjs   # 手动装到当前 android/ 工程（init-android.cjs 会自动调用）
node tools/check-brand-res.cjs     # 校验文件清单/尺寸/SHA-256；android/ 存在时做逐字节比对
```

换标时：替换本目录文件 → 更新 `tools/check-brand-res.cjs` 的 `EXPECTED` 清单 → 重新构建。
