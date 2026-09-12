import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* 扩展的 manifest 本地化容易在重构中被静默破坏，且损坏表现很隐蔽：
 * 产物缺失 _locales 时 __MSG_ 占位符不会被替换，扩展名会变成空字符串。
 * 这里直接校验源文件层面的契约（产物断言见 npm script 之外的构建校验）。 */

const root = process.cwd();
const localesDir = resolve(root, 'public/_locales');
const wxtConfig = readFileSync(resolve(root, 'wxt.config.ts'), 'utf-8');
const popupHtml = readFileSync(resolve(root, 'src/entrypoints/popup/index.html'), 'utf-8');

function readLocale(locale: string): Record<string, { message: string }> {
  return JSON.parse(readFileSync(resolve(localesDir, locale, 'messages.json'), 'utf-8'));
}

/** 从 wxt.config.ts 的 manifest 段中提取 __MSG_ 引用 */
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
  it('_locales 位于 public/ 下（WXT 只复制 publicDir 内的文件到产物）', () => {
    // 历史上 _locales 曾放在仓库根目录，导致打包产物缺失该目录、
    // __MSG_ 占位符全部解析为空字符串。
    expect(existsSync(localesDir)).toBe(true);
    expect(existsSync(resolve(root, '_locales'))).toBe(false);
  });

  it('声明了 default_locale（有 _locales 时 Chrome 强制要求，否则报 Extension is invalid）', () => {
    expect(wxtConfig).toMatch(/default_locale:\s*'([a-zA-Z_]+)'/);
  });

  it('default_locale 指向的目录真实存在，且与 Chrome 目录命名一致', () => {
    const locale = wxtConfig.match(/default_locale:\s*'([a-zA-Z_]+)'/)?.[1];

    expect(locale).toBeTruthy();
    expect(existsSync(resolve(localesDir, locale!))).toBe(true);
  });

  it('每个 locale 目录都提供 messages.json（仅含默认 locale 的目录是无效的）', () => {
    const locales = readdirSync(localesDir);

    expect(locales.length).toBeGreaterThan(0);

    for (const locale of locales) {
      expect(existsSync(resolve(localesDir, locale, 'messages.json'))).toBe(true);
    }
  });

  it('manifest / popup.html 中的每个 __MSG_ 引用都能在所有 locale 中解析', () => {
    const refs = manifestMessageRefs();

    expect(refs.length).toBeGreaterThan(0);

    for (const locale of readdirSync(localesDir)) {
      const messages = readLocale(locale);

      for (const key of refs) {
        expect(Object.keys(messages), `${locale} 缺少 ${key}`).toContain(key);
        expect(messages[key].message).toBeTruthy();
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
    const en = readLocale('en');
    const zh = readLocale('zh_CN');

    expect(zh.extName.message).not.toBe(en.extName.message);
    expect(zh.extDescription.message).not.toBe(en.extDescription.message);
  });
});
