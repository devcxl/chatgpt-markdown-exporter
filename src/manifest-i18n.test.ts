import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* 扩展的 manifest 本地化容易在重构中被静默破坏，且损坏表现很隐蔽：
 * 产物缺失 _locales 时 __MSG_ 占位符不会被替换，扩展名会变成空字符串。
 *
 * 统一 i18n 后，文案源是 src/locales/*.json（唯一来源），
 * @wxt-dev/i18n 模块在构建时把它生成到产物 _locales/<locale>/messages.json。
 * public/_locales 已删除 —— 保留它反而会与模块生成的文件互相覆盖。 */

const root = process.cwd();
const localesSrc = resolve(root, 'src/locales');
const wxtConfig = readFileSync(resolve(root, 'wxt.config.ts'), 'utf-8');
const popupHtml = readFileSync(resolve(root, 'src/entrypoints/popup/index.html'), 'utf-8');

function readLocaleFile(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(localesSrc, `${locale}.json`), 'utf-8'));
}

/** 展平嵌套文案，得到 Chrome message name → 文案 */
function flatten(locale: string): Record<string, string> {
  const out: Record<string, string> = {};

  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(obj)) {
      const name = prefix ? `${prefix}_${key}` : key;

      if (typeof value === 'object' && value !== null) {
        walk(value as Record<string, unknown>, name);
      }
      else {
        out[name] = String(value);
      }
    }
  };

  walk(readLocaleFile(locale), '');
  return out;
}

/** 从 wxt.config.ts 与 popup.html 中提取 __MSG_ 引用 */
function manifestMessageRefs(): string[] {
  const refs = new Set<string>();

  for (const match of wxtConfig.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    refs.add(match[1]);
  }

  for (const match of popupHtml.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    refs.add(match[1]);
  }

  return [...refs];
}

describe('扩展 manifest 本地化契约', () => {
  it('文案源位于 src/locales（@wxt-dev/i18n 模块的默认扫描目录）', () => {
    // 模块从 srcDir 下的 locales/ 读取；放到别处会导致「Required localization
    // file does not exist」而直接构建失败。
    expect(existsSync(localesSrc)).toBe(true);
  });

  it('不再保留 public/_locales（会与模块生成的产物互相覆盖）', () => {
    expect(existsSync(resolve(root, 'public/_locales'))).toBe(false);
  });

  it('声明了 default_locale（有 _locales 时 Chrome 强制要求，否则报 Extension is invalid）', () => {
    expect(wxtConfig).toMatch(/default_locale:\s*'([a-zA-Z_]+)'/);
  });

  it('注册了 @wxt-dev/i18n 模块（负责生成产物 _locales）', () => {
    expect(wxtConfig).toMatch(/@wxt-dev\/i18n\/module/);
  });

  it('default_locale 指向的文案源真实存在，且与 Chrome 目录命名一致', () => {
    const locale = wxtConfig.match(/default_locale:\s*'([a-zA-Z_]+)'/)?.[1];

    expect(locale).toBeTruthy();
    expect(existsSync(resolve(localesSrc, `${locale}.json`))).toBe(true);
  });

  it('每个 locale 源文件都能解析出至少一条文案', () => {
    const files = readdirSync(localesSrc).filter(name => name.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(Object.keys(flatten(file.replace(/\.json$/, ''))).length).toBeGreaterThan(0);
    }
  });

  it('manifest / popup.html 中的每个 __MSG_ 引用都能在所有 locale 中解析', () => {
    const refs = manifestMessageRefs();

    expect(refs.length).toBeGreaterThan(0);

    for (const file of readdirSync(localesSrc).filter(name => name.endsWith('.json'))) {
      const messages = flatten(file.replace(/\.json$/, ''));

      for (const key of refs) {
        expect(Object.keys(messages), `${file} 缺少 ${key}`).toContain(key);
        expect(messages[key]).toBeTruthy();
      }
    }
  });

  it('名称/描述/工具栏标题使用 __MSG_ 占位符而非硬编码文案', () => {
    expect(wxtConfig).toContain('name: \'__MSG_extName__\'');
    expect(wxtConfig).toContain('description: \'__MSG_extDescription__\'');
    expect(wxtConfig).toContain('default_title: \'__MSG_extDefaultTitle__\'');
  });

  it('popup.html 的 <title> 也使用占位符（WXT 用它生成 action.default_title）', () => {
    // WXT 会读取 popup 入口 HTML 的 <title> 覆盖 manifest 的 default_title，
    // 若这里写死文案，工具栏提示语将不再本地化。
    expect(popupHtml).toMatch(/<title>__MSG_extDefaultTitle__<\/title>/);
  });

  it('中文 locale 提供与英文不同的译文（否则本地化形同虚设）', () => {
    const en = flatten('en');
    const zh = flatten('zh_CN');

    expect(zh.extName).not.toBe(en.extName);
    expect(zh.extDescription).not.toBe(en.extDescription);
  });
});
