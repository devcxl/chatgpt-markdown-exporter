# Source Code Review Instructions

## Environment

- **Node.js**: 22
- **Package Manager**: pnpm
- **OS**: Linux (Ubuntu latest)

## Build Steps

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Lint source code
pnpm lint

# Build and package Firefox extension
pnpm package:firefox
```

## Build System

The extension is built using [Vite](https://vitejs.dev/) (v5.x) as the bundler. The build entry points are:

- `src/background.ts` → `dist/background.js` (Service Worker)
- `src/content/index.ts` → `dist/content/index.js` (Content Script)
- `src/popup/index.ts` → `dist/popup/index.js` (Popup UI)

Static assets (`manifest.json`, HTML files, icons) are copied directly from the project root and `public/` directory to `dist/`.

## Output

The Firefox extension package is generated at the repository root:

```
chatgpt-md-exporter-extension-<version>-firefox.zip
```

To reproduce the unpacked extension directory (as submitted):

```bash
unzip chatgpt-md-exporter-extension-<version>-firefox.zip -d extension-dir
```

## Source Map

```
src/
├── background.ts              # Service Worker: message routing, downloads, tab management
├── content/
│   ├── index.ts               # Entry: mounts buttons, dispatches messages
│   ├── api.ts                 # ChatGPT backend API client (/backend-api/...)
│   ├── process-conversation.ts # Raw API data → structured Conversation model
│   ├── current-export-button.ts # Page header export button
│   └── panel.ts               # Batch export floating panel
├── popup/
│   └── index.ts               # Extension popup UI: conversation list, selection, export trigger
├── markdown/
│   └── conversation-to-markdown.ts # Structured model → Markdown string
├── shared/
│   ├── messages.ts            # Message type definitions
│   ├── files.ts               # Filename construction, deduplication
│   └── zip.ts                 # Local ZIP file writer
└── types.d.ts                 # Chrome/Firefox extension API type declarations

scripts/
├── build.mjs                  # Vite build orchestration
└── package.mjs                # ZIP packaging for Chrome / Firefox

manifest.json                  # Extension manifest (shared by Chrome/Firefox)
public/                        # Static HTML and icon assets
```

## Notes

- No generated files are manually edited.
- The submitted extension is built from this repository using the commands above.
- The `manifest.json` `browser_specific_settings.gecko.id` is `chatgpt-md-exporter@example.com`.
- The `background.service_worker` field in `manifest.json` is rewritten to `background.scripts` during Firefox packaging for compatibility.
- All runtime JavaScript is generated from the TypeScript source under `src/`.
- Dependencies (`webextension-polyfill`, `sanitize-filename`) are bundled into the output by Vite; the local `src/shared/zip.ts` provides ZIP generation.
