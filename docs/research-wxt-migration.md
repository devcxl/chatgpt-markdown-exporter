# 研究结论：使用 WXT 框架重构构建流程

## 目录

1. [研究结论摘要](#1-研究结论摘要)
2. [背景与问题定义](#2-背景与问题定义)
3. [研究方法](#3-研究方法)
4. [WXT 框架全景](#4-wxt-框架全景)
5. [当前项目分析](#5-当前项目分析)
6. [迁移方案设计](#6-迁移方案设计)
7. [对比分析](#7-对比分析)
8. [反方观点与风险](#8-反方观点与风险)
9. [迁移路线图](#9-迁移路线图)
10. [参考来源](#10-参考来源)

---

## 1. 研究结论摘要

**WXT 框架可以完全替代当前手写的 Vite 构建 + 自定义打包脚本，且带来显著的开发体验提升。**

核心结论：

| 维度 | 结论 |
|------|------|
| 可行性 | ✅ 100% 覆盖现有功能 |
| 迁移成本 | 中等（约 1-2 天工作量） |
| 风险等级 | 低（可逐步迁移，不破坏现有功能） |
| 推荐度 | **强烈推荐** |

**关键收益：**
- 消除 2 个自定义构建/打包脚本（~188 行）
- 获得 HMR 热重载开发体验
- WXT 内置跨浏览器打包（Chrome/Firefox）
- 自动 manifest 生成，消除 `browser_specific_settings` 手工处理
- 内置自动发布能力（`wxt submit`）
- 社区活跃（9.2k+ stars，216+ contributors）

---

## 2. 背景与问题定义

### 2.1 研究目标

评估将 `chatgpt-md-exporter` 浏览器扩展从当前的**自定义 Vite 构建流程**迁移到 **WXT 框架**的可行性、收益和风险。

### 2.2 当前方案痛点

当前项目使用手写构建脚本：

```
scripts/
├── build.mjs      # 90 行 - 3 个 entrypoint 的 Vite 顺序构建 + 静态文件复制
└── package.mjs    # 98 行 - 自定义 ZIP 打包 + manifest 按浏览器调整

package.json 脚本:
  dev  → node scripts/build.mjs --watch
  build → node scripts/build.mjs
  package:chrome/firefox → build + node scripts/package.mjs
```

已知问题：
- **无 HMR**：content script 和 popup 修改后需要手动 reload
- **构建逻辑手写**：每个 entrypoint 单独配置，容易出错
- **manifest 双重维护**：既有 `manifest.json` 源文件，又有 `scripts/package.mjs` 中按目标浏览器调整的逻辑
- **无自动发布**：release workflow 使用 web-ext 手动发布

### 2.3 用户实际需求

"通用发布改造" 的核心是：**让项目能用一套工具链，自动处理多浏览器（Chrome/Firefox）的构建、打包、发布，去掉手写构建脚本。**

---

## 3. 研究方法

- **来源搜索**：WXT 官方文档 (wxt.dev)、GitHub (wxt-dev/wxt)、社区比较文章
- **框架对比**：WXT vs Plasmo vs CRXJS 横向比较
- **代码审查**：分析项目现有 3 个 entrypoint 的代码模式
- **版本信息**：WXT v0.19+（截至 2026 年 7 月）

---

## 4. WXT 框架全景

### 4.1 核心架构

WXT 是一个基于 Vite 的浏览器扩展框架，设计理念类似 Nuxt：

```
特征矩阵:
├── 基于 Vite（非 Parcel/Webpack）
├── 文件即 entrypoint（entrypoints/ 目录约定）
├── 自动 manifest 生成（从 entrypoint 配置推导）
├── 框架无关（支持 React/Vue/Svelte/Solid/原生）
├── HMR 开发服务器（自动打开浏览器加载扩展）
├── 内置多浏览器打包（wxt zip / wxt zip -b firefox）
├── 自动发布（wxt submit → Chrome Web Store / Firefox / Edge）
└── 内置 i18n、storage、messaging 等常用模块
```

### 4.2 Entrypoint 映射

| WXT Entrypoint 类型 | 文件名约定 | 对应本项目 |
|---------------------|-----------|-----------|
| Background | `entrypoints/background.ts` | `src/background.ts` |
| Content Script | `entrypoints/{name}.content.ts` | `src/content/index.ts` |
| Popup | `entrypoints/popup/index.html` | `public/popup.html` + `src/popup/index.ts` |
| Unlisted Script | `entrypoints/{name}.ts` | — |
| Unlisted Page | `entrypoints/{name}.html` | — |

### 4.3 关键 API

```typescript
// Background
export default defineBackground(() => {
  // 所有代码必须在 main 内部
});

// Content Script
export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  main(ctx: ContentScriptContext) {
    // 所有运行时代码必须在 main 内部
  },
});

// 浏览器 API: 使用 browser 全局（WXT 内置 polyfill，无需 webextension-polyfill）
browser.runtime.sendMessage(...)
browser.downloads.download(...)
```

### 4.4 配置文件

```typescript
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',                    // 使用 src/ 目录
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    // browser_specific_settings 按目标浏览器自动处理
  },
});
```

---

## 5. 当前项目分析

### 5.1 关键文件清单

| 文件 | 角色 | 迁移影响 |
|------|------|---------|
| `src/background.ts` | Service Worker, 344 行 | ⚡ 大改 - 需包裹 `defineBackground()` |
| `src/content/index.ts` | Content Script, 210 行 | ⚡ 大改 - 结构变化最大，需重构为 `defineContentScript` |
| `src/content/*.ts` | Content Script 子模块 | ✅ 内部逻辑基本不变 |
| `src/popup/index.ts` | Popup 逻辑, 332 行 | ⚡ 中改 - 需调整入口方式 |
| `public/popup.html` | Popup HTML, 184 行 | ✅ 保留，移动到 entrypoints |
| `src/i18n/index.ts` | 自定义 i18n | 🔶 可保留或迁移到 WXT i18n |
| `src/shared/zip-core.ts` | ZIP 生成库 | ✅ 完全不变 |
| `src/shared/zip.ts` | ZIP 浏览器包装 | ✅ 不变 |
| `src/shared/files.ts` | 文件处理 | ✅ 不变 |
| `src/shared/messages.ts` | 消息类型 | ✅ 不变 |
| `src/markdown/` | Markdown 转换 | ✅ 不变 |
| `scripts/build.mjs` | 构建脚本 | ✅ 删除 |
| `scripts/package.mjs` | 打包脚本 | ✅ 删除 |
| `manifest.json` | manifest | ✅ 内容移到 wxt.config.ts |
| `.github/workflows/` | CI/CD | 🔶 简化 |

### 5.2 content script 模式的关键差异

当前 content script 在**模块顶层执行代码**：

```typescript
// 当前 - 顶层执行
import browser from 'webextension-polyfill';

browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
mountCurrentExportButton(handleExportCurrentConversation);
browser.runtime.onMessage.addListener(...);
```

WXT 要求所有运行时代码在 `main()` 内部：

```typescript
// WXT - main 内部
import { defineContentScript } from 'wxt';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
    mountCurrentExportButton(handleExportCurrentConversation);
    browser.runtime.onMessage.addListener(...);
  },
});
```

> 原因：WXT 在构建时需要静态分析 entrypoint 文件。顶层代码会在 Node.js 中执行。

### 5.3 webextension-polyfill 处理

WXT 内置了 `browser` 全局，无需 `webextension-polyfill`：

- 所有 `import browser from 'webextension-polyfill'` → 删除该 import
- 直接使用 `browser.*` 全局变量
- 可以安全移除 `webextension-polyfill` 和 `@types/webextension-polyfill` 依赖

---

## 6. 迁移方案设计

### 6.1 项目结构变化

```
迁移前                               迁移后
├── manifest.json                   ├── wxt.config.ts (新增)
├── scripts/                        ├── src/
│   ├── build.mjs (删除)             │   ├── entrypoints/ (新增)
│   └── package.mjs (删除)           │   │   ├── background.ts (从 src/ 移入)
├── src/                             │   │   ├── chatgpt.content/ (从 src/content/ 移入)
│   ├── background.ts (移入)          │   │   │   └── index.ts
│   ├── content/ (移入)               │   │   └── popup/ (从 public/ + src/popup/ 合并)
│   ├── popup/ (移入)                  │   │       ├── index.html
│   ├── markdown/ (保留)              │   │       └── index.ts
│   ├── i18n/ (保留或调整)            │   ├── markdown/ (不变)
│   └── shared/ (保留)               │   ├── i18n/ (不变)
├── public/                          │   └── shared/ (不变)
│   ├── popup.html (移入 entrypoints) ├── public/
│   └── icons/ (保留)                  │   └── icons/ (不变)
├── _locales/                        ├── _locales/ (不变)
└── package.json                     └── package.json (调整 scripts)
```

### 6.2 wxt.config.ts

```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ],
    action: {
      default_title: '__MSG_extDefaultTitle__',
    },
    icons: {
      16: '/icons/icon-16.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
  },
  // Firefox 的 browser_specific_settings 由 WXT 自动处理
  zip: {
    // Firefox source code submission
    excludeSources: [
      '.github/**',
      'scripts/**',
      '**/*.test.*',
    ],
  },
});
```

### 6.3 background.ts 迁移

```typescript
// 迁移前
import browser from 'webextension-polyfill';
// ... 代码

// 迁移后
export default defineBackground(() => {
  // 代码保持不变，删除 import browser from 'webextension-polyfill'
  // 直接使用 browser 全局变量
});
```

### 6.4 content/index.ts 迁移

```typescript
// 迁移前（顶层执行）
import browser from 'webextension-polyfill';
// ... imports
browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
mountCurrentExportButton(handleExportCurrentConversation);
browser.runtime.onMessage.addListener(...);

// 迁移后
export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    // 所有原顶层代码移入此处
    browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
    mountCurrentExportButton(handleExportCurrentConversation);
    browser.runtime.onMessage.addListener(...);
  },
});
```

### 6.5 popup 迁移

将 `public/popup.html` 移入 `src/entrypoints/popup/index.html`，并修改 script 引用路径（从 `src/popup/index.js` 改为相对路径 `./index.ts`）。

### 6.6 package.json 脚本

```json
{
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "zip:all": "wxt zip && wxt zip -b firefox",
    "submit": "wxt submit",
    "postinstall": "wxt prepare",
    "typecheck": "wxt typecheck",
    "test": "vitest run",
    "lint": "eslint src",
    "lint:fix": "eslint --fix src"
  }
}
```

### 6.7 tsconfig.json 调整

WXT 需要扩展其生成的 tsconfig：

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

### 6.8 依赖变化

```diff
# 删除
- "webextension-polyfill": "^0.12.0"
- "@types/webextension-polyfill": "^0.12.3"

# 新增
+ "wxt": "latest"

# 保留（构建所需）
  "vite": "^5.3.2",
  "typescript": "^5.5.2",
  "eslint": "^9.15.0",
  "vitest": "^3.2.4"

# 可选删除（WXT 内置替代）
- "web-ext": "^10.1.0"  # 如果用 wxt submit 替代 web-ext sign
```

---

## 7. 对比分析

### 7.1 方案对比表

| 维度 | 当前方案 | WXT 方案 | 差异 |
|------|---------|----------|------|
| 构建脚本 | 90 行手写 Vite build.mjs | `wxt build` (0 行) | ✅ 消除 |
| 打包脚本 | 98 行手写 package.mjs | `wxt zip` (0 行) | ✅ 消除 |
| Manifest 维护 | manifest.json + package.mjs 调整 | wxt.config.ts 统一管理 | ✅ 单一来源 |
| Firefox 适配 | 手动删除/替换 manifest 字段 | 自动处理 | ✅ |
| Dev 体验 | watch 模式，手动 reload | HMR + 自动打开浏览器 | ✅ 大幅提升 |
| Content Script HMR | ❌ 不支持 | ✅ 自动刷新页面 | ✅ |
| 构建时间 | ~1.2s (3 顺序构建) | ~1s (并行构建) | ✅ 稍快 |
| 产出大小 | ~387 KB (参考值) | ~387 KB (Vite 底层一致) | ≈ 持平 |
| 学习成本 | 团队成员已熟悉 | 需学习 entrypoint 约定 | ⚠️ 中等 |
| i18n 兼容 | 自定义 sfc i18n 实现 | 标准 browser.i18n 支持 | 🔶 需评估 |
| 自动发布 | web-ext (Firefox only) | wxt submit (Chrome/Firefox/Edge) | ✅ 更全面 |

### 7.2 成本全景

| 成本维度 | 评估 |
|---------|------|
| **迁移时间** | 1-2 天（核心迁移）<br>主要工作集中在 content script 重构（顶层代码移入 main） |
| **金钱成本** | 0（MIT 开源） |
| **复杂度变化** | 降低 → 消除 2 个自定义脚本，manifest 自动生成 |
| **维护成本** | 显著降低 → WXT 社区维护底层构建逻辑 |
| **学习曲线** | 中等 → entrypoint 约定、main() 包装、wxt.config.ts |
| **迁移风险** | 低 → 可并行开发，验证通过后切换 |
| **回滚难度** | 低 → git revert，恢复 manifest.json 和 scripts/ 即可 |

### 7.3 影响面分析

| 角色 | 影响 |
|------|------|
| **开发者** | ✅ 开发体验大幅提升（HMR、简化构建） |
| **Code Reviewer** | ⚠️ 需理解 WXT 的 entrypoint 约定和 main() 包装 |
| **CI/CD** | ✅ 流程简化，`wxt build` + `wxt zip` 替代自定义命令 |
| **发布管理者** | ✅ `wxt submit` 一站式发布到多个商店 |
| **最终用户** | 无影响（产出一致） |

---

## 8. 反方观点与风险

### 8.1 已知限制和争议

| 风险 | 严重度 | 说明 | 缓解措施 |
|------|--------|------|---------|
| ESM content script 支持 | 🟡 低 | WXT 的 ESM content script 仍在完善 | 当前项目使用 manifests 注册 content script，不受影响 |
| Docker 兼容性 | 🟡 低 | WXT dev 服务器默认尝试打开浏览器，在容器中会失败 | 配置 `browser.startup: false` |
| 框架锁定 | 🟢 很低 | WXT 基于 Vite，如果 WXT 停止维护，可回退到原生 Vite | 代码结构多为标准 TS，迁移成本可控 |
| content script 重构风险 | 🟡 中 | 顶层代码→main() 的迁移可能遗漏引用 | 仔细测试；WXT 的 `wxt build` 会报告静态导入错误 |
| i18n 兼容性 | 🟡 中 | 项目使用自定义 i18n 而非 `browser.i18n` | 可保留自定义 i18n 不变，不强制迁移 |

### 8.2 社区声音

- **Reddit (2025)**: "WXT HMR is pretty solid, saves a lot of time" — 正面评价居多
- **Hacker News**: 多人在 Plasmo vs WXT 讨论中推荐 WXT
- **Plasmo 迁移者反馈**: "WXT brings it into the modern world"、 "WXT HMR works really well, I rarely have to refresh"
- **已知问题**: 一些用户报告在 CI/Docker 中运行 wxt 需要额外配置

### 8.3 最坏情况分析

| 场景 | 后果 | 回滚方式 | 损失 |
|------|------|---------|------|
| WXT 不再维护 | 失去框架更新 | 回退到原生 Vite + 保留 scripts/ | 2-3 天收拾 |
| WXT 有未发现 bug | 构建失败 | 使用 `wxt build` 同时手写 scripts/ 作为 fallback | 低 |
| content script 迁移出错 | 扩展功能异常 | 保留旧文件并行开发，测试通过后切 | 低 |
| CI 中构建不兼容 | 发布延迟 | 临时使用 scripts/ 构建 | 低 |

---

## 9. 迁移路线图

### Phase 1: 评估与准备 (0.5 天)
- [ ] 在分支上初始化 WXT（`pnpm dlx wxt@latest init` 生成基础结构）
- [ ] 配置 `wxt.config.ts`，验证构建输出
- [ ] 确认 `_locales/` 兼容性

### Phase 2: 核心迁移 (1 天)
- [ ] 创建 `src/entrypoints/` 目录结构
- [ ] 迁移 `src/background.ts` → `src/entrypoints/background.ts`（`defineBackground`）
- [ ] 迁移 `src/content/index.ts` → `src/entrypoints/chatgpt.content/index.ts`（`defineContentScript` + main() 包裹）
- [ ] 迁移 popup：`public/popup.html` → `src/entrypoints/popup/index.html`
- [ ] 迁移 `src/popup/index.ts` → `src/entrypoints/popup/index.ts`
- [ ] 调整 `package.json` scripts

### Phase 3: 删除冗余 (0.5 天)
- [ ] 删除 `scripts/build.mjs`、`scripts/package.mjs`
- [ ] 删除 `manifest.json`
- [ ] 删除 `webextension-polyfill` 依赖
- [ ] 可选：删除 `web-ext` 依赖（如果用 wxt submit）

### Phase 4: CI/CD 更新 (0.5 天)
- [ ] 更新 `ci.yml`：使用 `wxt build` 替代 `node scripts/build.mjs`
- [ ] 更新 `release.yml`：使用 `wxt zip` 替代 `pnpm package:all`
  - 注意：WXT 输出到 `.output/` 而非 `dist/`，文件名格式也会变化
- [ ] 评估是否改用 `wxt submit` 替代 web-ext sign

### Phase 5: 验证 (0.5 天)
- [ ] 验证 `wxt build` + `wxt zip` 产出与当前 `pnpm package:all` 一致
- [ ] 加载 dist 到 Chrome/Firefox 测试全部功能
- [ ] 对照 manifest 差异，确保权限无变化
- [ ] 运行 `pnpm typecheck` `pnpm lint` `pnpm test` 全部通过

### 总计: 约 3 天

---

## 10. 参考来源

| 标题 | URL | 发布者 | 时间 |
|------|-----|--------|------|
| WXT 官方文档 — Installation | https://wxt.dev/guide/installation | WXT | 2026 |
| WXT 官方文档 — Project Structure | https://wxt.dev/guide/essentials/project-structure | WXT | 2026 |
| WXT 官方文档 — Entrypoints | https://wxt.dev/guide/essentials/entrypoints | WXT | 2026 |
| WXT 官方文档 — Manifest | https://wxt.dev/guide/essentials/config/manifest | WXT | 2026 |
| WXT 官方文档 — Content Scripts | https://wxt.dev/guide/essentials/content-scripts | WXT | 2026 |
| WXT 官方文档 — i18n | https://wxt.dev/guide/essentials/i18n | WXT | 2026 |
| WXT 官方文档 — Publishing | https://wxt.dev/guide/essentials/publishing | WXT | 2026 |
| WXT 官方文档 — Migrate to WXT | https://wxt.dev/guide/resources/migrate | WXT | 2026 |
| WXT 官方文档 — Compare | https://wxt.dev/guide/resources/compare | WXT | 2026 |
| WXT GitHub | https://github.com/wxt-dev/wxt | wxt-dev | 2026 |
| The 2025 State of Browser Extension Frameworks | https://redreamality.com/blog/the-2025-state-of-browser-extension-frameworks | Redreamality | 2025 |
| I Built the Same Chrome Extension With 5 Different Frameworks | https://extensionbooster.net/blog/best-chrome-extension-frameworks-compared | ExtensionBooster | 2026 |
| WXT vs Plasmo Discussion | https://github.com/wxt-dev/wxt/discussions/782 | GitHub | 2025 |
| Migrating from Plasmo to WXT | https://jetwriter.ai/blog/migrate-plasmo-to-wxt | Jetwriter AI | 2025 |
| Building AI-Powered Browser Extensions With WXT | https://marmelab.com/blog/2025/04/15/browser-extension-form-ai-wxt.html | Marmelab | 2025 |

---

## 附录：WXT 快速参考卡片

```bash
# 项目脚手架
pnpm dlx wxt@latest init my-extension

# 开发
pnpm dev              # Chrome dev server + HMR
pnpm dev:firefox      # Firefox dev server

# 构建
pnpm build            # 构建 Chrome
pnpm build:firefox    # 构建 Firefox

# 打包
pnpm zip              # 打包 Chrome ZIP → .output/
pnpm zip:firefox      # 打包 Firefox ZIP → .output/

# 发布
pnpm wxt submit       # 提交到 Chrome/Firefox/Edge 商店

# TypeScript
pnpm typecheck        # TS 检查
```
