# vendor/sbd — 上游副本与集成说明

本目录保存 [sbd](https://github.com/Tessmore/sbd) 的原始文件，用于 `js/text-repair.js`
的英文断句。应用按原样以 `<script>` 加载 `dist/sbd.js`（浏览器构建产物），不做修改。

| 项目 | 值 |
|---|---|
| 上游仓库 | https://github.com/Tessmore/sbd |
| 固定 commit | `6eb72541591136da12e134872dce46ad9c8e76e8`（2022-12-13） |
| 许可证 | MIT（见 `LICENSE`） |
| 版本文件 | `dist/sbd.js`（14KB，UMD 构建，浏览器/Node 均可用） |

## 接入位置

- `index.html`：`<script src="vendor/sbd/dist/sbd.js"></script>`（在 `js/text-repair.js` 之前）
- `js/text-repair.js` 的 `sentences()`：英文优先调用 `sbd.sentences()`；
  拿不到（文件未加载/执行异常）时退回正则切分，功能不依赖它是否加载成功
- 调用点：`js/importer.js` 的听力材料切句、`js/translate-metric.js` 的英文句数统计

## 为什么需要它

正则切句会把缩写当成句末标点。同一段文本：

```
输入：In traditional Chinese culture, exchanging gifts is a courtesy.
      Mr. Smith agrees, e.g. he does it every year.

sbd  ：2 句（正确）
正则 ：4 句 —— 切开成 "Mr." / "Smith agrees, e.g." / "he does it every year."
```

句数算错会直接影响翻译完整性检查（覆盖率被低估 → 误判漏译），所以这里的收益不只是拆分好看。
对照断言见 `tools/check-text-repair.cjs` 中「对照：没有 sbd 时同一段文本会被正则误切」。

## 浏览器全局名

`dist/sbd.js` 把接口挂在 `window.tokenizer`（不是 `SBD`），用法：

```js
window.tokenizer.sentences('Some text. Mr. Smith agrees.', { });
```

`TextRepair.sentences()` 已经把两种查找入口（`window.tokenizer` / 全局 `tokenizer`）封好。
