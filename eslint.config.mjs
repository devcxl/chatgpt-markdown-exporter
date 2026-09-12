import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    commaDangle: 'always-multiline',
  }),
  {
    // WXT 产物目录是 .output/，不存在 dist/；
    // 而 `*.mjs` 仅匹配根级（如 eslint.config.mjs 自身），scripts/*.mjs 仍会被 lint。
    ignores: ['node_modules/', '.output/', '.wxt/', 'coverage/', '*.mjs'],
  },
);
