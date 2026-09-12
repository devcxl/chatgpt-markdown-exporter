import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* i18n 在模块加载时按 navigator.language 决定语言，
 * 因此每个用例都 resetModules 后重新 import，才能覆盖 zh / en 两个分支。 */

async function loadI18n(language: string) {
  vi.resetModules();
  Object.defineProperty(navigator, 'language', { value: language, configurable: true });
  return import('./index.ts');
}

describe('t', () => {
  let originalLanguage: string;

  beforeEach(() => {
    originalLanguage = navigator.language;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it('中文环境返回中文文案', async () => {
    const { t } = await loadI18n('zh-CN');

    expect(t('common.export')).toBe('导出');
  });

  it('非中文环境回退英文', async () => {
    const { t } = await loadI18n('en-US');

    expect(t('common.export')).toBe('Export');
  });

  it('zh 前缀（含地区与大小写）都识别为中文', async () => {
    const { t } = await loadI18n('zh-Hant-TW');

    expect(t('common.export')).toBe('导出');
  });

  it('替换参数占位符', async () => {
    const { t } = await loadI18n('zh-CN');

    expect(t('common.itemsCount', { count: 3 })).toBe('会话列表（3 条）');
  });

  it('参数缺失时保留占位符原文', async () => {
    const { t } = await loadI18n('zh-CN');

    expect(t('common.itemsCount')).toBe('会话列表（{count} 条）');
  });

  it('未定义的 key 原样返回，便于定位缺失文案', async () => {
    const { t } = await loadI18n('zh-CN');

    expect(t('not.exist.key')).toBe('not.exist.key');
  });

  it('当前语言缺失但英文存在时回退英文', async () => {
    vi.resetModules();
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
    const locales = await import('./locales.ts');
    const backup = locales.messages['zh-CN']['common.export'];
    delete locales.messages['zh-CN']['common.export'];

    try {
      const { t } = await import('./index.ts');
      expect(t('common.export')).toBe('Export');
    }
    finally {
      locales.messages['zh-CN']['common.export'] = backup;
    }
  });
});

describe('getDateLocale', () => {
  let originalLanguage: string;

  beforeEach(() => {
    originalLanguage = navigator.language;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it('中文环境返回 zh-CN', async () => {
    const { getDateLocale } = await loadI18n('zh-CN');

    expect(getDateLocale()).toBe('zh-CN');
  });

  it('非中文环境返回 en-US', async () => {
    const { getDateLocale } = await loadI18n('de-DE');

    expect(getDateLocale()).toBe('en-US');
  });
});

describe('i18nPopulate', () => {
  let originalLanguage: string;

  beforeEach(() => {
    originalLanguage = navigator.language;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it('按 data-i18n 填充文本，忽略无该属性的元素', async () => {
    const { i18nPopulate } = await loadI18n('zh-CN');
    const root = document.createElement('div');
    root.innerHTML = '<span data-i18n="common.export"></span><span id="plain"></span>';

    i18nPopulate(root);

    expect(root.querySelector('[data-i18n]')?.textContent).toBe('导出');
    expect(root.querySelector('#plain')?.textContent).toBe('');
  });

  it('data-i18n 为空字符串时不做处理', async () => {
    const { i18nPopulate } = await loadI18n('zh-CN');
    const root = document.createElement('div');
    root.innerHTML = '<span data-i18n="">keep</span>';

    i18nPopulate(root);

    expect(root.querySelector('span')?.textContent).toBe('keep');
  });

  it('navigator 不存在时回退英文（background / service worker 场景）', async () => {
    vi.resetModules();
    const originalNavigator = globalThis.navigator;
    // @ts-expect-error 模拟无 navigator 的运行环境
    delete globalThis.navigator;

    try {
      const { t } = await import('./index.ts');
      expect(t('common.export')).toBe('Export');
    }
    finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });
});
