# ChatGPT Markdown Exporter — AGENTS.md

## Quick commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Watch mode build (Vite programmatic, 3 entrypoints) |
| `pnpm build` | Production build → `dist/` |
| `pnpm typecheck` | `tsc --noEmit` (strict, noUnusedLocals, noUnusedParameters) |
| `pnpm lint` | ESLint flat config: 2-space, single quotes, semicolons |
| `pnpm lint:fix` | Auto-fix lint |
| `pnpm test` | Vitest (single test file: `src/shared/zip-core.test.ts`) |
| `pnpm package:all` | `build` then package Chrome + Firefox `.zip` at repo root |
| `pnpm package:chrome` / `pnpm package:firefox` | Single-target package |

## Build

Custom Vite build via `scripts/build.mjs` — NOT a standard `vite.config.ts`. Builds 3 entrypoints sequentially:

1. `src/background.ts` → `dist/background.js`
2. `src/content/index.ts` → `dist/content/index.js`
3. `src/popup/index.ts` → `dist/popup/index.js` (also copies `public/` HTML/icons + `manifest.json`)

## Package

`scripts/package.mjs` imports `src/shared/zip-core.ts` — **requires** `node --experimental-strip-types` (already set in scripts in `package.json`).

## Loading the extension

- **Chrome**: `chrome://extensions` → Load unpacked → select `dist/`
- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `dist/manifest.json`

## Key architecture

```
src/
├── background.ts              # Service Worker: message routing, download logic
├── content/                   # Content script (injected into chatgpt.com pages)
│   ├── index.ts               # Entry: mount export button, handle messages
│   ├── api.ts                 # ChatGPT backend API calls
│   ├── process-conversation.ts # Raw API data → structured model
│   ├── current-export-button.ts
│   └── panel.ts               # Batch export floating panel
├── popup/index.ts             # Extension popup: conversation list + batch export
├── markdown/conversation-to-markdown.ts  # Structured data → Markdown
├── shared/                    # Cross-context utilities
│   ├── messages.ts            # Message type definitions + type guards
│   ├── files.ts               # Filename sanitization + dedup
│   ├── zip-core.ts            # Dependency-free ZIP store-only format (shared by build & runtime)
│   ├── zip.ts                 # Browser wrapper (Blob output)
│   └── zip-core.test.ts       # Vitest tests
└── types.d.ts                 # Chrome/Firefox extension API type declarations
```

## CI pipeline (`.github/workflows/ci.yml`)

Order: `pnpm install` → `pnpm typecheck` → `pnpm lint` → `pnpm build` (no tests run in CI).

## Release flow

Tag `v*` triggers `.github/workflows/release.yml`: update versions → build → package → GitHub Release → optional AMO submission via `web-ext`.

## Browser-specific manifest differences

- **Firefox**: `background.service_worker` + `"type": "module"` → must be rewritten to `background.scripts: ["background.js"]` (done in `scripts/package.mjs`)
- **Chrome**: `browser_specific_settings` block is deleted before packaging

## Extension constraints

- `storage` permission available for extension state
- `downloads` + `scripting` permissions
- Host permissions: `chatgpt.com`, `chat.openai.com`
- Content script runs at `document_idle`
- Service worker type: `module`
