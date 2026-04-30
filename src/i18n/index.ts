import type { SupportedLocale } from './types';
import { messages } from './locales';

let currentLocale: SupportedLocale = detectLocale();

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

export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export function getDateLocale(): string {
  return currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function localeFromNavigator(): SupportedLocale {
  return detectLocale();
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
  const lang = globalThis.navigator?.language ?? 'en';

  if (lang.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
}
