import { fakeBrowser } from '@webext-core/fake-browser';

// 测试环境补齐 WXT 自动导入与浏览器 API：
// - defineBackground / defineContentScript 由 WXT 在构建时注入
// - browser 使用官方 @webext-core/fake-browser（wxt 的依赖，支持 spy/reset）
globalThis.defineBackground = (fn: unknown) => fn;
globalThis.defineContentScript = (options: unknown) => options;
globalThis.browser = fakeBrowser;

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
