# 安全政策

## 适用范围

这是一个**纯本地工具**：数据存在你电脑的 `data/` 目录，不上云，
不调外部模型 API。最大的安全面其实是你自己的稿件——
`data/body.md`、`data/project.json` 默认是进版本库的，
fork 后如果不想公开自己的稿子，先把它们从跟踪里拿掉。

## 报告漏洞

请**不要**直接开公开 Issue 讨论安全问题。
用 GitHub 的 [Private vulnerability reporting](https://github.com/litich001/writing-desk/security/advisories/new)
（仓库 Security → Advisories → New draft advisory）私下报告，
我们会在 7 天内回复。

报告里请写：影响的版本或 commit、复现步骤、影响范围评估。
如果是路径穿越、任意文件读写这类服务端问题，优先处理。

## 已知的安全设计

- 图片上传只认 `image/*` 的 Content-Type，按类型定扩展名，不信原文件名。
- 文件名经过清洗（见 `engine/safe-test.mjs`），`..` 穿越会被拦。
- 服务默认只听 `127.0.0.1`，不要用 `--host 0.0.0.0` 把它暴露到局域网——
  它没有任何鉴权，暴露即裸奔。
