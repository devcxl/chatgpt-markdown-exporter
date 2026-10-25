import { fakeBrowser } from '@webext-core/fake-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 测试环境补齐 WXT 自动导入与浏览器 API：
// - defineBackground / defineContentScript 由 WXT 在构建时注入
// - browser 使用官方 @webext-core/fake-browser（wxt 的依赖，支持 spy/reset）
globalThis.defineBackground = (fn: unknown) => fn;
globalThis.defineContentScript = (options: unknown) => options;
globalThis.browser = fakeBrowser;

/* i18n 统一后，界面文案通过 browser.i18n.getMessage 读取，
 * 而 fake-browser 的 i18n 实现是「直接抛错」的桩。
 * 这里按真实浏览器语义实现：读取构建产物 _locales 里的 messages.json，
 * 把 key 的点号展平为下划线，未知 key 返回空串（Chrome 与 Firefox 都如此）。 */
const defaultLocale = 'en';

function loadTestMessages(): Record<string, { message: string }> {
  // 直接读文案源（src/locales/*.json），避免依赖 wxt prepare 的产物
  const out: Record<string, { message: string }> = {};

  try {
    const nested = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src/locales', `${defaultLocale}.json`), 'utf-8'),
    );

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
  }
  catch {
    // 文案源缺失不应让所有测试挂掉
  }

  return out;
}

type I18nStub = {
  getMessage: (key: string, substitutions?: string | string[]) => string;
  getUILanguage: () => string;
  getAcceptLanguages?: () => Promise<string[]>;
};

const messages = loadTestMessages();
const i18nStub = fakeBrowser.i18n as unknown as I18nStub;

i18nStub.getMessage = (key: string, substitutions?: string | string[]): string => {
  const raw = messages[key.replaceAll('.', '_')]?.message;

  if (!raw) {
    return '';
  }

  if (substitutions === undefined) {
    return raw;
  }

  const list = Array.isArray(substitutions) ? substitutions : [substitutions];

  // Chrome 语义：$1..$9 按位置替换
  return raw.replace(/\$(\d)/g, (match, index) => {
    const value = list[Number(index) - 1];

    return value === undefined ? match : value;
  });
};

i18nStub.getUILanguage ??= () => defaultLocale;

// jsdom 未实现 Object URL，而 background 的 Firefox 下载路径依赖它
if (typeof URL.createObjectURL !== 'function') {
  let objectUrlId = 0;
  const objectUrls = new Set<string>();

  URL.createObjectURL = () => {
    const url = `blob:test/${objectUrlId++}`;
    objectUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    objectUrls.delete(url);
  };
}

// Node 22 下 fetch/Response 返回 Node 原生 Blob，而 jsdom 的 FileReader、
// createObjectURL 只认 jsdom 自己的 Blob，导致 readAsDataURL 报
// "parameter 1 is not of type 'Blob'"（Node 24 恰好兼容两者，因此仅在 CI 暴露）。
// 真实浏览器只有一个 Blob 实现，这里是测试环境的实现分裂，需要抹平。
const NativeBlob = globalThis.Blob;

if (typeof globalThis.Response === 'function') {
  const originalBlob = globalThis.Response.prototype.blob;

  globalThis.Response.prototype.blob = async function blob(): Promise<Blob> {
    const raw = await originalBlob.call(this);

    // 已是当前环境的 Blob 实现时直接复用，避免多一次拷贝
    if (raw instanceof NativeBlob) {
      return raw;
    }

    return new NativeBlob([await raw.arrayBuffer()], { type: raw.type });
  };
}
