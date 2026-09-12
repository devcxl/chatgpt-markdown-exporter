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
    // 本地化名称/描述/工具栏标题。Chrome 的硬性规则：
    // 产物含 _locales/ 时 manifest 必须有 default_locale，否则报 Extension is invalid；
    // 反之无 _locales/ 时必须省略。_locales 位于 public/ 下才会被 WXT 复制进产物。
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
