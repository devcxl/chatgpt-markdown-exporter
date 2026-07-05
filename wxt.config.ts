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
