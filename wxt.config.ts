import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // 产物目录改回约定俗成的 dist/（WXT 默认 .output/）。
  // 实际目录仍是 dist/<browser>-mv<version>/，由 outDirTemplate 拼出。
  outDir: 'dist',
  // Chrome 与 Firefox 统一产出 Manifest V3。
  // WXT 默认给 firefox 出 MV2，这里显式覆盖；产物随之变为 dist/firefox-mv3/。
  // 需要临时回退 MV2 时可用 CLI 覆盖：wxt build -b firefox --mv2
  manifestVersion: 3,
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
    // 最小权限：activeTab 从未被使用（下载走 downloads、注入走 scripting，
    // 两者所需的站点访问已由 host_permissions 覆盖），MV3 迁移时一并删除。
    permissions: ['downloads', 'scripting'],
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
        // Firefox 从 109 开始支持 manifest_version 3；不设下限时
        // 老版本会在升级后因无法解析 MV3 而直接禁用扩展。
        strict_min_version: '109.0',
        // 如实声明「不收集数据」。AMO 自 2025-11-03 起对新上架扩展强制要求；
        // addons-linter 对「低版本 + 该字段」组合不报错（旧版本忽略未知键）。
        data_collection_permissions: {
          required: ['none'],
        },
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
