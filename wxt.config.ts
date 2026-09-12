import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  hooks: {
    // WXT 会把 entrypoints/ 下的 *.test.ts 当作入口点，
    // 与同名源文件冲突导致 build 报 “Multiple entrypoints with the same name”。
    'entrypoints:found': (_wxt, entrypoints) => {
      for (let index = entrypoints.length - 1; index >= 0; index -= 1) {
        if (/\.test\.[jt]sx?$/.test(entrypoints[index].inputPath)) {
          entrypoints.splice(index, 1);
        }
      }
    },
  },
  manifest: {
    name: 'ChatGPT Markdown Exporter',
    description: 'Export ChatGPT conversations to Markdown files',
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ],
    action: {
      default_title: 'ChatGPT Markdown Exporter',
    },
    icons: {
      16: '/icons/icon-16.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    browser_specific_settings: {
      gecko: {
        id: 'chatgpt-markdown-exporter@devcxl.cn',
      },
    },
  },
  zip: {
    excludeSources: [
      '.github/**',
      'scripts/**',
      '**/*.test.*',
    ],
  },
});
