export type SupportedLocale = 'zh-CN' | 'en';

export type LocaleMessages = Record<string, string>;

export type I18nMessages = Record<SupportedLocale, LocaleMessages>;
