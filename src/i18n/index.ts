import type { SupportedLocale } from './types';
import { messages } from './locales';

const currentLocale: SupportedLocale = detectLocale();

export function t(key: string, params?: Record<string, string | number>): string {
  const msg = messages[currentLocale]?.[key] ?? messages['en'][key];

  if (!msg) {
    return key;
  }

  if (params) {
    return msg.replace(/\{(\w+)\}/g, (_match, param) => String(params[param] ?? `{${param}}`));
  }

  return msg;
}

export function getDateLocale(): string {
  return currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function i18nPopulate(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');

    if (key) {
      el.textContent = t(key);
    }
  });
}

function detectLocale(): SupportedLocale {
  const lang = getBrowserUiLanguage() ?? globalThis.navigator?.language ?? 'en';

  if (lang.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
}

function getBrowserUiLanguage(): string | undefined {
  try {
    if (typeof browser === 'undefined') {
      return undefined;
    }

    return browser.i18n.getUILanguage();
  }
  catch {
    // 非扩展测试环境可能没有实现 browser.i18n，回退到 navigator.language。
    return undefined;
  }
}
