# Contributing

感谢你愿意参与 Keep Learning。

## 先看这些

- [README.md](README.md)：功能与使用
- [BUILDING.md](BUILDING.md)：本地构建
- [NOTICE](NOTICE) / [LICENSES/](LICENSES/)：第三方许可

## 提交前

1. 跑相关自检，至少：
   ```bash
   node tools/check-all.cjs
   ```
   如果环境缺少 `assets/audio` / `assets/models`，`check-audio-pack` 会自动 SKIP，这是正常的。
2. 不要提交：
   - `keystore.properties`、`*.jks`、任何密钥/Token；
   - 个人导入的题目（`data/content` 里 `mine:true` 的条目）；
   - `raw/`、`work/`、`assets/audio/`、`assets/models/`；
   - 真题原文、受版权保护的整篇材料。
3. 新增题目请自编仿真题；真题请让用户用「导入真题」自行导入。

## 代码风格

- 纯前端，无构建步骤（`index.html` + `js/` + `css/`）；
- 保持现有模块划分与中文 UI 文案；
- 涉及数据结构的改动要同步 `tools/check-*.cjs` 回归。

## 许可

- 代码：MIT（见 [LICENSE](LICENSE)）。
- 内置词库：`zhenghaoyang24/english-vocabulary` 数据为 **CC BY 4.0**；CET/SAT 搭配上游为 **BSD-3-Clause**。
- 提交 PR 即表示你同意以 MIT 许可贡献代码；不要提交你无权授权的内容。

## 问题与安全

- 普通 Bug / 功能请求：GitHub Issues（用模板）。
- 安全问题：见 [SECURITY.md](SECURITY.md)，不要开公开 Issue。
