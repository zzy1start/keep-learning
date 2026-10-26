# vendor/sacrebleu — 上游 chrF 源码（仅作移植依据与对照，不参与运行）

本目录保存 [sacrebleu](https://github.com/mjpost/sacrebleu) 的**原始文件副本**，
用于 `js/translate-metric.js` 中 chrF / chrF++ 移植的溯源与交叉验证。
应用运行时**不加载也不依赖**本目录（纯静态站点没有 Python 运行时）。

| 项目 | 值 |
|---|---|
| 上游仓库 | https://github.com/mjpost/sacrebleu |
| 固定 commit | `c596d9d2072a8f84200574a7a5c56c618e8d37e8` |
| commit 日期 | 2026-08-20 |
| 许可证 | Apache-2.0（见 `LICENSE.txt`，随源码一并保留） |

## 文件

- `chrf.py` — `sacrebleu/metrics/chrf.py` 原文（chrF / chrF++ 定义与 F 值计算）
- `helpers.py` — `sacrebleu/metrics/helpers.py` 原文（字符 / 词 n-gram 提取）
- `LICENSE.txt` — Apache-2.0 许可证原文

## 移植位置

`js/translate-metric.js` 的 `chrf()` / `chrfMulti()` 及其内部函数（`extractAllCharNgrams`、
`extractWordNgrams`、`removePunctuation`、`matchStatistics`、`fScore`）逐函数对应上游，
文件头注释列出了与上游的差异（JS 按码点切分、去空白的等价写法、默认参数）。

## 如何复核移植是否与上游一致

```bash
python tools/sacrebleu-crosscheck/run-upstream.py   # 用本目录源码算出对照值
node   tools/sacrebleu-crosscheck/compare.cjs       # 与 JS 移植逐用例比对
```

`tools/sacrebleu-crosscheck/` 会在自身目录下临时搭一个最小包壳（跑完自动删除，不修改上游文件），
只补 `chrf.py` 需要的 `sum_of_lists` 与 `Metric/Score/Signature` 空壳。
当前 19 个用例全部一致（误差 < 1e-9）。

> 说明：`js/translate-metric.js` 里**除 chrF 之外**的规则（覆盖率门槛、chrF→得分映射、
> 对齐校正、四维缩放）都是本项目为学习打分场景自行定义的，与 sacrebleu 无关。
