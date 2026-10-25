import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // `#i18n` 是 @wxt-dev/i18n 模块在构建时注入的别名（指向 .wxt/i18n/index.ts），
      // 但 vitest 不走 WXT 的构建管线，需要手动映射到同一个文件。
      '#i18n': resolve(__dirname, '.wxt/i18n/index.ts'),
    },
  },
  test: {
    // 被测代码大量依赖 location / document / DOMParser（content script、popup）
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // 纯类型声明，无运行时代码
        'src/shared/chatgpt-types.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
