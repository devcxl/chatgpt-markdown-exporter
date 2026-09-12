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
