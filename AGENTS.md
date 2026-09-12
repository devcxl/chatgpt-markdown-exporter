# ChatGPT Markdown Exporter — AGENTS.md

## Quick commands

| Command | Purpose |
|---|---|
| `pnpm dev` | WXT dev server (HMR) |
| `pnpm dev:firefox` | WXT dev server (Firefox) |
| `pnpm build` | 构建 Chrome：解包目录 + `.zip` → `.output/` |
| `pnpm build:firefox` | 构建 Firefox：解包目录 + `.zip` + sources `.zip` |
| `pnpm build:all` | 构建 Chrome + Firefox |
| `pnpm typecheck` | `tsc --noEmit` (strict, noUnusedLocals, noUnusedParameters) |
| `pnpm lint` | ESLint flat config: 2-space, single quotes, semicolons |
| `pnpm lint:fix` | Auto-fix lint |
| `pnpm test` | Vitest (jsdom 环境，含覆盖率阈值检查) |
| `pnpm test:coverage` | Vitest + v8 覆盖率报告（阈值 90%） |

## Build

`build` 系列基于 `wxt zip`，**一次同时产出解包目录与 `.zip`**：

- 解包目录：`.output/chrome-mv3/`、`.output/firefox-mv2/`（用于加载调试）
- 压缩包：`.output/chatgpt-markdown-exporter-<version>-<browser>.zip`（用于上传商店）
- Firefox 额外产出 `-sources.zip`（AMO 源码审核用）

没有「仅解包不产 zip」的命令；需要解包目录直接取上述路径即可。

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
- Chrome 提交需要 4 个 secret（缺任一则自动跳过，不报错），配置步骤见下节
- AMO 提交需要 `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`
- tag 与 `package.json` 版本必须一致（先改版本再打标签），`draft` 任务会硬校验

### Chrome Web Store 自动发布配置

需在 GitHub 仓库配置 4 个 secret：

| Secret | 说明 |
|---|---|
| `CHROME_EXTENSION_ID` | 扩展 ID（商店链接中 32 位小写串） |
| `CHROME_PUBLISHER_ID` | 发布者 UUID（v2 API 路径 `publishers/{id}/items/{id}` 必需） |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | 服务账号邮箱 |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | 服务账号私钥（**base64**，见下） |

获取方式：

1. Google Cloud Console 启用 **Chrome Web Store API**
2. 创建服务账号（无需授予 IAM 权限），生成 **JSON 密钥**并下载
3. CWS 开发者后台 → **Account** → 添加服务账号邮箱（漏做会 403）
4. 后台右上角选择发布者，URL `.../devconsole/<PUBLISHER_ID>` 中即为 Publisher ID

配置命令（推荐，从 GCP 下载的 JSON 密钥文件直接提取）：

```bash
KEY=~/Downloads/<项目ID>-<key-id>.json   # GCP 下载的服务账号密钥

gh secret set CHROME_EXTENSION_ID --body "<32 位扩展 ID>"
gh secret set CHROME_PUBLISHER_ID --body "<发布者 UUID>"
jq -r .client_email "$KEY" | gh secret set CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL
jq -r .private_key  "$KEY" | gh secret set CHROME_SERVICE_ACCOUNT_PRIVATE_KEY
```

`jq -r` 会把 JSON 中的字面量 `\n` 还原为真实换行，得到的 PEM 可直接用于签名（已实测）。
`gh secret set` 不带 `--body` 时从 stdin 读取，完整保留多行内容。

**为什么不能直接存整个 JSON**：`private_key` 在 JSON 文件里是字面量 `\n`，
直接当环境变量传入会得到不含换行的 PEM，签名时报 `DECODER routines::unsupported`
（已实测）。又因为 workfow 里的 base64 分支只负责解码，
传 base64(整个JSON) 会得到 JSON 文本而非 PEM，同样失败。
所以只传私钥字符串本身，不做 base64 包装。

提交行为：使用 `STAGED_PUBLISH`，即提交后**不自动上架**，需在开发者后台手动发布。
Chrome 不支持通过 API 写商店文案（listing），详细说明只能手动填，见 `docs/store-listing.md`。

## Store metadata（商店文案）

商店页文案与包内 i18n 是**两套独立机制**，详细说明见 [`docs/store-listing.md`](docs/store-listing.md)：

| 字段 | 来源 | 自动化 |
|---|---|---|
| 包内文案（扩展名/标题/界面） | `public/_locales/*/messages.json` + `src/i18n/` | 随包生效 |
| CWS 简短说明 | `manifest.json` 的 `description` | 拖包自动填入 |
| CWS 详细说明 | 只能后台手填 | ❌ API 不支持 |
| AMO name/summary/description | `amo-metadata.json` | ✅ release 流程自动写入 |

- 改 AMO 文案：编辑 `amo-metadata.json`（保持 `supported_locales` 与翻译字段语言键一致）
- 改包内名称/简短说明：编辑 `public/_locales/*/messages.json`，**英文 ≤ 132 字符**（CWS manifest 硬上限）
- `version.release_notes` 由 `scripts/prepare-amo-metadata.mjs` 从当次 GitHub Release
  说明动态注入，**不要在 amo-metadata.json 中手写**（其中的値仅作兜底）
- `src/store-metadata.test.ts` 校验上述约束
- **不要尝试自动化 CWS listing**：写能力仅存于已废弃的 API V1.1（2026-10-15 停用），
  V2 无任何 listing 字段

## Extension constraints

- `downloads` + `scripting` permissions
- Host permissions: `chatgpt.com`, `chat.openai.com`
- Content script runs at `document_idle`
