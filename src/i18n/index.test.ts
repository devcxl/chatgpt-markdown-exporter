import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDateLocale, i18nPopulate } from './index.ts';

/* 统一 i18n 后，语言选择由 browser.i18n 负责（按 _locales 目录与浏览器 UI 语言匹配），
 * 不再由我们判断 zh 前缀。因此测试重点从「语言分支」转到：
 * 1) 门面是否把参数正确透传给 i18n.t（含命名占位符）
 * 2) 文案源（src/locales/*.json）与产出的 _locales 是否自洽
 *
 * fake-browser 的 i18n.getMessage 默认抛错，所以这里用真实生成的 messages.json
 * 打桩，行为与浏览器一致（含 $1/$2 位置替换与未知 key 返回空串）。 */

const root = process.cwd();

type Messages = Record<string, { message: string }>;

/** 把嵌套的文案源展平成 Chrome message name（点号 → 下划线） */
function readLocale(locale: string): Messages {
  const nested = JSON.parse(readFileSync(resolve(root, 'src/locales', `${locale}.json`), 'utf-8'));
  const out: Messages = {};

  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      const name = prefix ? `${prefix}_${key}` : key;

      if (typeof value === 'object' && value !== null) {
        walk(value as Record<string, unknown>, name);
      }
      else {
        out[name] = { message: String(value) };
      }
    }
  };

  walk(nested, '');
  return out;
}

/** 用真实生成的 messages.json 构造一份本地翻译表 */
function lookup(locale: string, key: string, params?: Record<string, string | number>): string {
  const raw = readLocale(locale)[key.replaceAll('.', '_')]?.message ?? '';

  if (!params) {
    return raw;
  }

  return raw.replace(/\{(\w+)\}/g, (_m, name) => String(params[name] ?? `{${name}}`));
}

describe('t', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('英文文案来自生成的 _locales（与浏览器读取的一致）', () => {
    expect(lookup('en', 'common.export')).toBe('Export');
  });

  it('中文文案来自生成的 _locales', () => {
    expect(lookup('zh_CN', 'common.export')).toBe('导出');
  });

  it('替换命名占位符', () => {
    expect(lookup('zh_CN', 'common.itemsCount', { count: 3 })).toBe('会话列表（3 条）');
  });

  it('不带参数时保留占位符原文', () => {
    expect(lookup('zh_CN', 'common.itemsCount')).toBe('会话列表（{count} 条）');
  });

  it('key 中的点号在 _locales 里对应下划线', () => {
    expect(readLocale('en').common_export).toBeTruthy();
    expect(readLocale('en')['common.export']).toBeUndefined();
  });
});

describe('文案源（src/locales）', () => {
  it('中英文 key 集合完全一致', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );

    const en = flatten(JSON.parse(readFileSync(resolve(root, 'src/locales/en.json'), 'utf-8')));
    const zh = flatten(JSON.parse(readFileSync(resolve(root, 'src/locales/zh_CN.json'), 'utf-8')));

    expect(zh.sort()).toEqual(en.sort());
  });

  it('每种语言的同一条文案都不为空', () => {
    for (const locale of ['en', 'zh_CN']) {
      const raw = JSON.parse(readFileSync(resolve(root, `src/locales/${locale}.json`), 'utf-8'));
      const flatten = (obj: Record<string, unknown>): Array<[string, unknown]> =>
        Object.entries(obj).flatMap(([k, v]) =>
          typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>) : [[k, v]],
        );

      for (const [key, value] of flatten(raw)) {
        expect(String(value).trim(), `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('manifest 引用的 __MSG_* 都能在文案源中解析', () => {
    const wxtConfig = readFileSync(resolve(root, 'wxt.config.ts'), 'utf-8');
    const popupHtml = readFileSync(resolve(root, 'src/entrypoints/popup/index.html'), 'utf-8');
    const refs = new Set<string>();

    for (const source of [wxtConfig, popupHtml]) {
      for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
        refs.add(match[1]);
      }
    }

    expect(refs.size).toBeGreaterThan(0);

    for (const locale of ['en', 'zh_CN']) {
      const messages = JSON.parse(readFileSync(resolve(root, `src/locales/${locale}.json`), 'utf-8'));

      for (const key of refs) {
        expect(messages[key], `${locale} 缺少 ${key}`).toBeTruthy();
      }
    }
  });
});

describe('getDateLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('使用浏览器 UI 语言', () => {
    vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue('ja-JP');

    expect(getDateLocale()).toBe('ja-JP');
  });

  it('zh 补全为 zh-CN（Intl 对裸 zh 的默认值不稳定）', () => {
    vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue('zh');

    expect(getDateLocale()).toBe('zh-CN');
  });

  it('取不到时回退 en-US', () => {
    vi.spyOn(browser.i18n, 'getUILanguage').mockReturnValue('');

    expect(getDateLocale()).toBe('en-US');
  });
});

describe('i18nPopulate', () => {
  beforeEach(() => {
    vi.spyOn(browser.i18n, 'getMessage').mockImplementation((key: string) =>
      lookup('zh_CN', key),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按 data-i18n 填充文本，忽略无该属性的元素', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-i18n="common.export"></span><span id="plain"></span>';

    i18nPopulate(root);

    expect(root.querySelector('[data-i18n]')?.textContent).toBe('导出');
    expect(root.querySelector('#plain')?.textContent).toBe('');
  });

  it('data-i18n 为空字符串时不做处理', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-i18n="">keep</span>';

    i18nPopulate(root);

    expect(root.querySelector('span')?.textContent).toBe('keep');
  });
});

describe('浏览器 API 不可用时的降级', () => {
  let originalLanguage: string;

  beforeEach(() => {
    originalLanguage = navigator.language;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it('getUILanguage 抛错时回退 navigator.language', () => {
    vi.spyOn(browser.i18n, 'getUILanguage').mockImplementation(() => {
      throw new Error('not implemented');
    });
    Object.defineProperty(navigator, 'language', { value: 'ko-KR', configurable: true });

    expect(getDateLocale()).toBe('ko-KR');
  });
});
