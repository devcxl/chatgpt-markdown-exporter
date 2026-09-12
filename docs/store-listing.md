# 商店文案（Store Listing Copy）

各商店的「商店页文案」与包内 i18n 是**两套独立机制**，切勿混淆：

| 字段 | 来源 | 能否自动化 |
|---|---|---|
| 包内文案（扩展名、工具栏标题、界面文本） | `public/_locales/*/messages.json` + `src/i18n/` | ✅ 随包自动生效 |
| CWS 简短说明（132 字符内） | `manifest.json` 的 `description`（经 `__MSG_` 解析） | ✅ 拖包上传时自动填入 |
| CWS 详细说明（16000 字符内） | 只能在开发者后台手填 | ❌ API 不支持 |
| AMO name / summary / description | `amo-metadata.json`（经 `--amo-metadata` 提交） | ✅ 随 release 自动写入 |

## 自动化现状

- **AMO**：`amo-metadata.json` 由 `.github/workflows/release.yml` 的 `prepare-amo-metadata.mjs`
  注入当次 release notes 后，随 `web-ext sign --amo-metadata` 提交。**无需人工操作。**
- **Chrome Web Store**：`update`（写 listing）能力仅存在于已废弃的 API **V1.1**，
  官方支持截止 **2026-10-15**；V2 只有 `upload` / `publish` / `fetchStatus` / `cancelSubmission` /
  `setPublishedDeployPercentage`，**没有任何 listing 字段**。
  因此详细说明必须人工粘贴，本文件即为粘贴源。

> 若 2026-10-15 后仍想自动化 CWS listing，需要关注 Google 是否在 V2 补齐该能力。

## Chrome Web Store

粘贴位置：开发者后台 → 该扩展 → **Store listing** 标签页 → 顶部语言下拉框切换语言。

支持的语言下拉项需与包内 `_locales/` 目录对应（`en`、`zh_CN`）。

### 简体中文（zh_CN）

**详细说明：**

```
一款将 ChatGPT 对话导出为 Markdown 文件的浏览器扩展。

功能特性：

- 一键导出当前 ChatGPT 对话
- 批量导出多条对话
- 单条无附件的对话直接下载 .md，无需解压
- 通过 ChatGPT 后端 API 获取数据（非 DOM 抓取）
- 保留用户/助手角色标签、代码块和数学公式
- 保留多模态内容占位符（图片、音频）
- 保留网页引用链接
- 支持分享页面的对话导出
- Manifest V3，兼容 Chrome 和 Firefox

所有处理均在本地完成，不收集、不传输任何用户数据。

开源（MIT 协议）：https://github.com/devcxl/chatgpt-markdown-exporter
```

### English（en）

**Detailed description:**

```
A browser extension that exports ChatGPT conversations as Markdown files.

Features:

- One-click export of the current ChatGPT conversation
- Batch export of multiple conversations
- Direct .md download for a single conversation without attachments
- Fetches data via ChatGPT backend API (not DOM scraping)
- Preserves User/Assistant role labels, code blocks, and math formulas
- Preserves multimodal content placeholders (images, audio)
- Preserves web reference links
- Supports shared conversation page export
- Manifest V3, compatible with Chrome and Firefox

All processing happens locally. No user data is collected or transmitted.

Open source (MIT): https://github.com/devcxl/chatgpt-markdown-exporter
```

### 简短说明（自动填入，仅作核对）

简短说明来自包内 `manifest.json` 的 `description`，**拖包上传时会自动填入**，
无需手工维护；如与下方不一致，说明包内 `_locales` 需要更新。

| 语言 | 内容 | 字符数（上限 132） |
|---|---|---|
| en | Export ChatGPT conversations as Markdown files, with code blocks, math formulas and image placeholders preserved. | 113 |
| zh_CN | 将 ChatGPT 对话导出为 Markdown 文件。支持单条与批量导出，保留代码块、数学公式与多模态占位符。 | 56 |

## Firefox Add-ons (AMO)

由 `amo-metadata.json` 自动提交，此处仅记录与 CWS 的差异：

- AMO 的 `summary` 限制比 CWS 宽松，因此英文 summary 比上面的简短说明更长（143 字符），
  两者**不需要**保持一致
- AMO 的 `description` 支持 Markdown（AMO 会渲染为 HTML）
- `version.release_notes` 由 release 流程按当次 GitHub Release 说明动态注入

## 修改文案时的检查清单

1. 改包内名称/简短说明 → 编辑 `public/_locales/*/messages.json`，**确认英文 ≤ 132 字符**
2. 改 AMO 文案 → 编辑 `amo-metadata.json`，保持 `supported_locales` 与各翻译字段的语言键一致
3. 改完核对本文件上述表格与代码块，保持同步
4. Chrome 详细说明改动后，需登录开发者后台手动粘贴（两种语言都要改）
5. `pnpm test` 会校验 `amo-metadata.json` 的结构与语言一致性
