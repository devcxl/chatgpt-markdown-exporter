# ChatGPT Markdown Exporter — AGENTS.md

## Quick commands

| Command | Purpose |
|---|---|
| `pnpm dev` | WXT dev server (HMR) |
| `pnpm dev:firefox` | WXT dev server (Firefox) |
| `pnpm build` | Production build → `.output/` |
| `pnpm build:firefox` | Production build (Firefox) |
| `pnpm zip` | Build + Chrome `.zip` |
| `pnpm zip:firefox` | Build + Firefox `.zip` |
| `pnpm zip:all` | Build + package Chrome + Firefox |
| `pnpm typecheck` | `tsc --noEmit` (strict, noUnusedLocals, noUnusedParameters) |
| `pnpm lint` | ESLint flat config: 2-space, single quotes, semicolons |
| `pnpm lint:fix` | Auto-fix lint |
| `pnpm test` | Vitest (jsdom 环境，含覆盖率阈值检查) |
| `pnpm test:coverage` | Vitest + v8 覆盖率报告（阈值 90%） |

## Build

WXT framework — entrypoints are auto-detected from `src/entrypoints/`:

1. `src/entrypoints/background.ts` → Service Worker
2. `src/entrypoints/chatgpt.content/` → Content script (chatgpt.com pages)
3. `src/entrypoints/popup/` → Extension popup

Output: `.output/{browser}-mv{2,3}/`

## Loading the extension

- **Chrome**: `chrome://extensions` → Load unpacked → select `.output/chrome-mv3/`
- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `.output/firefox-mv2/manifest.json`

## Key architecture

```
src/
├── wxt.config.ts                # WXT configuration
├── entrypoints/                 # WXT entrypoints
│   ├── background.ts            # Service Worker: message routing, download logic
│   ├── chatgpt.content/         # Content script (injected into chatgpt.com pages)
│   │   ├── index.ts             # Entry: mount export button, handle messages
│   │   ├── api.ts               # ChatGPT backend API calls
│   │   ├── process-conversation.ts
│   │   ├── current-export-button.ts
│   │   ├── images.ts            # Image resolution
│   │   ├── page.ts              # Page utilities
│   │   └── toast.ts             # Toast notifications
│   └── popup/                   # Extension popup
│       ├── index.html
│       └── index.ts
├── markdown/
│   └── conversation-to-markdown.ts
├── shared/
│   ├── messages.ts
│   ├── files.ts
│   ├── zip-core.ts
│   ├── zip.ts
│   ├── chatgpt-types.ts         # Shared ChatGPT API types
│   └── zip-core.test.ts
└── i18n/                        # Custom i18n (not WXT's built-in)
```

## CI pipeline (`.github/workflows/ci.yml`)

Order: `pnpm install` → `pnpm typecheck` → `pnpm lint` → `pnpm build` (no tests run in CI).
## Testing

- 测试文件与被测模块同目录、同名 `.test.ts`；`test/setup.ts` 注入 WXT 自动导入的 stub（`defineBackground` / `defineContentScript`）与 `@webext-core/fake-browser` 的 `browser`
- `vitest.config.ts`：`environment: 'jsdom'`，覆盖率阈值 90%（statements/branches/functions/lines）
- **注意**：WXT 会把 `src/entrypoints/*.test.ts` 当作入口点，`wxt.config.ts` 的 `entrypoints:found` hook 负责过滤，新增测试文件无需额外配置
- 纯类型文件（`shared/chatgpt-types.ts`、`i18n/types.ts`）已在 coverage 中排除

## Release flow

**约定：用户说「Release / 发版本」时，执行改版本号 + 打标签 + 创建草稿 release，且一律创建草稿，不自行发布。**

Draft-first 两阶段流程（`.github/workflows/release.yml`）：

1. 本地：`package.json` 版本号递增 → commit → 推送 master
2. 打并推送 `v<version>` 标签 → `draft` 任务校验 tag 与 `package.json` 版本一致，
   跑 typecheck / lint / test / zip，创建**草稿** release 并附上两个 zip
3. **人工复核草稿**（确认产物与发布说明）后，在 GitHub 上点「Publish release」
   → 触发 `submit` 任务，正式提交 Chrome Web Store（STAGED_PUBLISH）与 AMO

关键点：

- 草稿 release 不会触发 release 事件，因此「发布草稿」天然成为上架前的人工闸门；
  仅推标签不会向商店提交任何内容
- `submit` 任务在 `published` 事件上运行，靠 release 事件重新构建产物并提交
- Chrome 提交需要 `CHROME_EXTENSION_ID` / `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` /
  `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` 三个 secret；AMO 需要 `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`。
  缺失时对应步骤自动跳过（不会报错）
- tag 与 `package.json` 版本必须一致（先改版本再打标签），`draft` 任务会硬校验

## Extension constraints

- `downloads` + `scripting` permissions
- Host permissions: `chatgpt.com`, `chat.openai.com`
- Content script runs at `document_idle`
