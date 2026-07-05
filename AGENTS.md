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
| `pnpm test` | Vitest (single test file: `src/shared/zip-core.test.ts`) |

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

## Release flow

Tag `v*` triggers `.github/workflows/release.yml`: update package.json version → build → zip → GitHub Release → optional AMO submission via `web-ext sign`.

## Extension constraints

- `downloads` + `scripting` permissions
- Host permissions: `chatgpt.com`, `chat.openai.com`
- Content script runs at `document_idle`
