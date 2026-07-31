import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
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
