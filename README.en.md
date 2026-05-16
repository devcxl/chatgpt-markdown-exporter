<div align="center">

# ChatGPT Markdown Exporter

<img src="public/icons/icon-128.png" width="128" height="128" />

> 中文：[README.md](./README.md)


[![CI](https://github.com/devcxl/chatgpt-markdown-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/devcxl/chatgpt-markdown-exporter/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/devcxl/chatgpt-markdown-exporter)](https://github.com/devcxl/chatgpt-markdown-exporter/releases)
[![License](https://img.shields.io/github/license/devcxl/chatgpt-markdown-exporter)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-blue?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefoxbrowser)](https://addons.mozilla.org/zh-CN/firefox/addon/chatgpt-markdown-exporter1/)

Browser extension that exports ChatGPT conversations to Markdown files. Supports Chrome and Firefox.

</div>

## Features

- One-click export of the current ChatGPT conversation
- Batch export multiple conversations
- Uses ChatGPT backend API instead of fragile DOM scraping
- Preserves User / Assistant role labels
- Preserves code blocks and math formulas
- Preserves multimodal content (images, audio) placeholders
- Preserves web reference links
- Supports export from shared links
- Manifest V3, compatible with Chrome and Firefox

## Installation

**Chrome Web Store**

> Not yet listed on Chrome Web Store. Manual installation available below.

### Chrome / Edge / Arc and other Chromium browsers

1. Download `*-chrome.zip` from [Releases](https://github.com/devcxl/chatgpt-markdown-exporter/releases)
2. Extract to a local directory
3. Open `chrome://extensions` and enable **Developer mode**
4. Click **Load unpacked** and select the extracted directory

### Firefox

**Now available on Firefox Add-ons:** [Install from store](https://addons.mozilla.org/zh-CN/firefox/addon/chatgpt-markdown-exporter1/)

<a href="https://addons.mozilla.org/zh-CN/firefox/addon/chatgpt-markdown-exporter1/"><img src="https://extensionworkshop.com/assets/img/documentation/publish/get-the-addon-178x60px.png" height="60" alt="Get the addon"></a>

Or download `*-firefox.zip` from [Releases](https://github.com/devcxl/chatgpt-markdown-exporter/releases) for manual installation:

1. Extract to a local directory
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select `manifest.json` from the extracted directory

## Usage

1. Open [chatgpt.com](https://chatgpt.com)
2. Click the **"Export Markdown"** button at the top of the page to export the current conversation, or click the extension icon to open the batch export panel
3. The exported `.md` file can be opened with any Markdown editor or note-taking app (Obsidian, Notion, Typora, etc.)

## Architecture

```
src/
├── background.ts         # Service Worker: message routing, downloads, tab management
├── content/              # Content Script: injected into ChatGPT pages
│   ├── index.ts          #   Entry: mount buttons, dispatch messages
│   ├── api.ts            #   Calls ChatGPT backend API (/backend-api/...)
│   ├── process-conversation.ts  #   Raw data → structured Conversation
│   ├── current-export-button.ts #   "Export" button at page top
│   └── panel.ts          #   Batch export floating panel
├── popup/                # Extension popup UI
│   └── index.ts          #   Conversation list, select all, batch export trigger
├── markdown/             # Structured data → Markdown string
│   └── conversation-to-markdown.ts
├── shared/               # Cross-context shared utilities
│   ├── messages.ts       #   Message type definitions
│   └── files.ts          #   Filename construction / deduplication
└── types.d.ts            # Chrome/Firefox extension API type declarations
```

**Core Flow**: Content Script uses `fetch` to call ChatGPT's backend API (`/backend-api/conversation/{id}`) to get raw conversation data, converts it to a structured model via `process-conversation`, renders it to a Markdown string via `conversation-to-markdown`, and finally writes the file via Service Worker's `downloads.download()`.

## Development

```bash
# Install dependencies
pnpm install

# Development mode (auto rebuild on file changes)
pnpm dev

# Build to dist/
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint

# Auto fix
pnpm lint:fix

# Package browser installers
pnpm package:all     # Generate both Chrome + Firefox .zip
pnpm package:chrome  # Chrome only
pnpm package:firefox # Firefox only
```

### Load into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` directory

### Load into Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/manifest.json`

## License

MIT

Inspired by [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter).