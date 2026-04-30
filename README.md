<div align="center">

# ChatGPT Markdown Exporter

<img src="public/icons/icon-128.png" width="128" height="128" />

> English: [README.en.md](./README.en.md)

[![CI](https://github.com/devcxl/chatgpt-markdown-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/devcxl/chatgpt-markdown-exporter/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/devcxl/chatgpt-markdown-exporter)](https://github.com/devcxl/chatgpt-markdown-exporter/releases)
[![License](https://img.shields.io/github/license/devcxl/chatgpt-markdown-exporter)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Firefox](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefoxbrowser)](https://www.mozilla.org/firefox/)

浏览器扩展：将 ChatGPT 对话导出为 Markdown 文件。支持 Chrome 和 Firefox。

</div>

## 功能

- 一键导出当前 ChatGPT 对话
- 支持批量导出多段对话
- 通过 ChatGPT 后端 API 获取数据，而非脆弱地抓取 DOM
- 保留 User / Assistant 角色标注
- 保留代码块、数学公式
- 保留多模态内容（图片、音频）占位符
- 保留网页引用链接
- 支持分享页导出
- Manifest V3，兼容 Chrome 和 Firefox

## 安装

**Chrome Web Store  / Firefox Add-ons**

> 暂未上架商店，可通过以下方式手动安装。

### Chrome / Edge / Arc 等 Chromium 浏览器

1. 从 [Releases](https://github.com/devcxl/chatgpt-markdown-exporter/releases) 下载 `*-chrome.zip`
2. 解压到本地目录
3. 打开 `chrome://extensions`，开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的目录

### Firefox

1. 从 [Releases](https://github.com/devcxl/chatgpt-markdown-exporter/releases) 下载 `*-firefox.zip`
2. 解压到本地目录
3. 打开 `about:debugging#/runtime/this-firefox`
4. 点击「临时载入附加组件」，选择解压目录中的 `manifest.json`

## 使用

1. 打开 [chatgpt.com](https://chatgpt.com)
2. 点击页面顶部的 **「导出 Markdown」** 按钮导出当前对话，或点击扩展图标打开批量导出面板
3. 导出的 `.md` 文件可直接用任何 Markdown 编辑器或笔记应用（Obsidian、Notion、Typora 等）打开

## 技术架构

```
src/
├── background.ts         # Service Worker：消息路由、下载、Tab 管理
├── content/              # Content Script：注入 ChatGPT 页面
│   ├── index.ts          #   入口：挂载按钮、分发消息
│   ├── api.ts            #   调用 ChatGPT 后端 API（/backend-api/...）
│   ├── process-conversation.ts  #   原始数据 → 结构化 Conversation
│   ├── current-export-button.ts #   页面顶部「导出」按钮
│   └── panel.ts          #   批量导出悬浮面板
├── popup/                # 扩展弹窗 UI
│   └── index.ts          #   会话列表、全选、批量导出触发
├── markdown/             # 结构化数据 → Markdown 字符串
│   └── conversation-to-markdown.ts
├── shared/               # 跨 context 共享工具
│   ├── messages.ts       #   消息类型定义
│   └── files.ts          #   文件名构建 / 去重
└── types.d.ts            # Chrome/Firefox 扩展 API 类型声明
```

**核心流程**：Content Script 通过 `fetch` 调用 ChatGPT 的后端 API（`/backend-api/conversation/{id}`）获取原始对话数据，经 `process-conversation` 转为结构化模型，再由 `conversation-to-markdown` 渲染为 Markdown 字符串，最终通过 Service Worker 的 `downloads.download()` 写入文件。

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（文件变更自动构建）
pnpm dev

# 构建到 dist/
pnpm build

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 自动修复
pnpm lint:fix

# 打包浏览器安装包
pnpm package:all     # 同时生成 Chrome + Firefox .zip
pnpm package:chrome  # 仅 Chrome
pnpm package:firefox # 仅 Firefox
```

### 加载到 Chrome

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist` 目录

### 加载到 Firefox

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击「临时载入附加组件」
3. 选择 `dist/manifest.json`

## License

MIT

本项目灵感来源于 [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter)。
