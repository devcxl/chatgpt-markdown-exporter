# ChatGPT Markdown Exporter

Export the current ChatGPT conversation as Markdown.

## Features

- Export current ChatGPT conversation
- Use ChatGPT conversation API instead of fragile DOM scraping
- Preserve user / assistant roles
- Preserve code blocks
- Preserve multimodal text placeholders
- Preserve web citation links when available
- Support Chrome and Firefox Manifest V3

## Development

```bash
pnpm install
pnpm build
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select `dist`

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist/manifest.json`

## License

MIT License

This project is inspired by [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter).
