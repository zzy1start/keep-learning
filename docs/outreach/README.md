# 开源发布 · 数据授权联络

记录第三方数据来源的许可状态、联络进度和后续动作。**当前状态：zhenghaoyang24 已授权 CC BY 4.0（2026-10-25），可以公开包含该数据的仓库/APK。**

## 状态总表

| 来源 | 本项目用到的数据 | 许可现状 | 需要动作 | 状态 |
|---|---|---|---|---|
| [zhenghaoyang24/english-vocabulary](https://github.com/zhenghaoyang24/english-vocabulary) | `tb_vocabulary.json`（约 25MB，10 万+ 词条音标/释义/词频）、`tb_voc_examples.json`（约 39MB，14 万+ 双语例句）、`tb_book.json` / `tb_voc_book.json`（词书分组） | 仓库**没有 LICENSE**（API license: null），默认保留所有权利 | 发邮件申请再分发授权（MIT / CC BY 4.0 或作者指定许可） | **已授权：CC BY 4.0**（2026-10-25 22:09 邮件回复，见下） |
| [zahi-ko/english-vocabulary](https://github.com/zahi-ko/english-vocabulary)（CET4/6、SAT 搭配） | 上游生成 `cet4_full.json` / `cet6_full.json` / `sat_full.json` | fork 本身没有 LICENSE，但**上游 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) 是 BSD-3-Clause**；已比对：两个仓库同路径数据文件 blob SHA 完全一致 | **无需授权**；在 NOTICE/LICENSES 保留 BSD-3 版权声明与许可全文即可 | 待补声明 |

> 已核实（2026-10-25）：zahi-ko 是 KyleBing 的 fork，两仓库中 `1 初中-乱序.txt` … `7 SAT-乱序.txt`、`json/*`、`full_line_*` 等文件的 git blob SHA 完全相同；KyleBing 仓库根目录有 `LICENSE`（BSD 3-Clause, Copyright (c) 2022-2026, KyleBing）。zahi-ko 把 LICENSE 删掉了，但上游许可仍约束这份数据，我们按上游许可合规使用并署名。
>
> 另：本地 `raw/cet4_full.json` / `cet6_full.json` / `sat_full.json` 与上游 `json/3-CET4-顺序.json` / `json/4-CET6-顺序.json` / `json/7-SAT-顺序.json` 的字节数只差 1（本地多 1 字节），且通过 jsDelivr 取样 100KB 逐字节比对，前缀完全一致——可判定为同源派生数据。

## 授权结果（2026-10-25 22:09）

- 作者 **zhenghaoyang24** 邮件回复：**“同意数据按 CC BY 4.0 授权”**，署名 zhenghaoyang，邮箱 zhenghaoyang24@foxmail.com。
- 覆盖数据：`tb_vocabulary.json`、`tb_voc_examples.json`、`tb_book.json`、`tb_voc_book.json`（即邮件申请的 english-vocabulary 数据集）。
- 证据：截图归档在 [2026-10-25-zhenghaoyang24-reply-CC-BY-4.0.jpg](2026-10-25-zhenghaoyang24-reply-CC-BY-4.0.jpg)；原始邮件请保留在邮箱中。
- 许可：**CC BY 4.0**（https://creativecommons.org/licenses/by/4.0/）。要求：署名、附许可链接、标注修改（本项目做了合并、筛选、格式转换）。
- **无需再跟进；ECDICT 换源备选方案取消。**

## 进度

- [x] 2026-10-25 起草给 zhenghaoyang24 的邮件
- [x] 2026-10-25 用户用 163 邮箱发送
- [x] 2026-10-25 22:09 作者回复同意按 CC BY 4.0 授权
- [x] 归档截图证据到 docs/outreach/
- [ ] 把 CC BY 4.0 与 KyleBing BSD-3 声明补进 NOTICE + LICENSES

## 备选方案（已取消：2026-10-25 作者授权 CC BY 4.0）

1. 用 ECDICT（MIT）重建词库/词形/词频/考纲标签；例句换 Tatoeba（CC-BY）或运行时 AI 生成；搭配先去掉或自建。
2. 发布「不含数据」的源码，数据由用户自备（可用性最差，但法律最干净）。
3. 删除相关数据后再公开仓库（不推荐，App 会失去核心能力）。

## 注意

- 公开仓库的 git 历史不可撤回，**授权到手或数据移除之前不要 push**。
- 所有对外邮件保留原文到本目录，便于日后证明授权范围。
