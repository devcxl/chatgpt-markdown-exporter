import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        'src/i18n/types.ts',
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
