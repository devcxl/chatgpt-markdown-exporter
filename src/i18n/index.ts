import { i18n } from '#i18n';

/* 统一的 i18n 门面。
 *
 * 文案的唯一来源是 src/locales/*.json；@wxt-dev/i18n 模块在构建时把它们
 * 生成为标准的 _locales/<locale>/messages.json，代码侧通过 i18n.t() 读取。
 * 因此 manifest 的 __MSG_* 与界面文案共用同一份文件，不再有两套机制。
 *
 * 与旧实现（手写 src/i18n/locales.ts + 自查 getUILanguage）的差异：
 * - 语言选择交给浏览器：browser.i18n 按扩展的 _locales 目录与浏览器 UI 语言匹配，
 *   Chrome 与 Firefox 行为一致，不需要我们自己判断 zh 前缀。
 * - key 中的点号由模块内部展平为下划线（Chrome 的 message name 只允许
 *   [A-Za-z0-9_]），调用处仍写 'common.export' 这种可读形式。
 * - 支持 {name} 命名占位符，缺失的占位符保持原样。
 */

export type TranslationParams = Record<string, string | number>;

/**
 * 取翻译。key 由类型系统约束（见 .wxt/i18n/structure.d.ts），
 * 拼错会在 typecheck 阶段报错。
 */
export function t(key: string, params?: TranslationParams): string {
  return params ? i18n.t(key as never, params as never) : i18n.t(key as never);
}

/**
 * 日期/时间格式化用的 locale。
 *
 * @wxt-dev/i18n 只负责文案，不提供 Intl locale，因此这里单独取浏览器 UI 语言。
 * 返回值直接喂给 toLocaleString / toLocaleTimeString。
 */
export function getDateLocale(): string {
  const lang = getBrowserUiLanguage();

  // Firefox 在部分情况下返回不带地区的 'zh'，Intl 能接受，但显式补全更稳定
  if (lang?.toLowerCase() === 'zh') {
    return 'zh-CN';
  }

  return lang || 'en-US';
}

/**
 * 把 DOM 中带 data-i18n 属性的元素填入对应文案。
 * popup 的静态 HTML 用它做首屏本地化。
 */
export function i18nPopulate(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');

    if (key) {
      el.textContent = t(key);
    }
  });
}

function getBrowserUiLanguage(): string | undefined {
  try {
    if (typeof browser === 'undefined') {
      return undefined;
    }

    return browser.i18n.getUILanguage();
  }
  catch {
    // 非扩展环境（如单元测试）可能没有实现 browser.i18n，回退到 navigator.language。
    return globalThis.navigator?.language;
  }
}
