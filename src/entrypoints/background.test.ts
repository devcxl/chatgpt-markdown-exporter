import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';

/* background 是消息路由与下载的唯一出口，测试重点是：
 * 1) 下载参数（url / filename / saveAs / conflictAction）与大小限制
 * 2) 下载失败必须回传 {ok:false}，不能静默成功
 * 3) popup 请求经 tabs.sendMessage 转发，异常转成 {ok:false}
 * 4) 安装时对已打开标签页的注入兜底
 *
 * fake-browser 事件对象暴露 trigger()，可直接触发 onInstalled / onRemoved；
 * downloads.download 未实现，必须按用例赋值。 */

type BackgroundModule = { default: () => void };

async function loadBackground(userAgent?: string): Promise<BackgroundModule> {
  vi.resetModules();

  if (userAgent) {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  }

  const module = await import('./background.ts');

  return module as unknown as BackgroundModule;
}

type DownloadChangeListener = (delta: { id: number; state?: { current?: string } }) => void;

let downloadChangeListeners: DownloadChangeListener[] = [];

/** 启动 background 并返回给 downloads.download 注入的 spy */
function start(downloadResult: number | (() => Promise<number>) = 1) {
  const download = vi.fn(
    typeof downloadResult === 'function'
      ? downloadResult
      : async () => downloadResult,
  );

  fakeBrowser.downloads.download = download as never;

  // fake-browser 未实现 downloads.onChanged（addListener 会抛错），
  // 且其 trigger() 不会派发到 background 注册的监听器，
  // 因此自行接管监听列表，以便断言 Object URL 是否被回收。
  downloadChangeListeners = [];
  const onChanged = fakeBrowser.downloads.onChanged as unknown as {
    addListener: (listener: DownloadChangeListener) => void;
    removeListener: (listener: DownloadChangeListener) => void;
    hasListeners: () => boolean;
  };

  onChanged.addListener = (listener) => {
    downloadChangeListeners.push(listener);
  };
  onChanged.removeListener = (listener) => {
    downloadChangeListeners = downloadChangeListeners.filter(item => item !== listener);
  };
  onChanged.hasListeners = () => downloadChangeListeners.length > 0;

  return download;
}

/** 模拟浏览器完成下载，触发 background 注册的 onChanged 监听 */
function emitDownloadChanged(delta: { id: number; state?: { current?: string } }): void {
  for (const listener of [...downloadChangeListeners]) {
    listener(delta);
  }
}

/** 取出 downloads.download 首次调用的参数（mock 参数类型未知，集中在此处断言） */
function firstDownloadOptions(download: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (download.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
}

/** onInstalled 事件的触发参数 */
function installedDetails(): { reason: 'install'; temporary: boolean } {
  return { reason: 'install', temporary: false };
}

describe('background 下载消息', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('DOWNLOAD_MARKDOWN 成功时返回 ok，并使用 data URL 与 uniquify', async () => {
    const download = start(1);
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'ChatGPT/a.md', content: 'hello' },
    });

    expect(response).toEqual({ ok: true });
    expect(download).toHaveBeenCalledOnce();

    const options = firstDownloadOptions(download) as {
      url: string;
      filename: string;
      saveAs: boolean;
      conflictAction: string;
    };

    expect(options.url.startsWith('data:text/markdown;charset=utf-8;base64,')).toBe(true);
    expect(Buffer.from(options.url.split(',')[1], 'base64').toString()).toBe('hello');
    expect(options.filename).toBe('ChatGPT/a.md');
    expect(options.saveAs).toBe(true);
    expect(options.conflictAction).toBe('uniquify');
  });

  it('DOWNLOAD_MARKDOWN 参数非法时返回 ok:false 而不是 reject', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md' },
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('内容超过 8MB 时拒绝下载', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x'.repeat(8 * 1024 * 1024 + 1) },
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('浏览器拒绝下载时把错误回传给调用方', async () => {
    start(async () => {
      throw new Error('download rejected');
    });
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x' },
    });

    expect(response).toEqual({ ok: false, error: 'download rejected' });
  });

  it('DOWNLOAD_ZIP 参数非法时返回 ok:false', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: 'not-an-array',
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('DOWNLOAD_ZIP 条目非法时返回 ok:false', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: [{ filename: 'a.md', content: 1 }],
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('ZIP 文件列表为空时拒绝下载', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: [],
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('ZIP 文件数超过 100 时拒绝', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: Array.from({ length: 101 }, (_, index) => ({
        filename: `a-${index}.md`,
        content: 'x',
      })),
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('ZIP 内单个文本文件超过 8MB 时拒绝', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: [{ filename: 'big.md', content: 'x'.repeat(8 * 1024 * 1024 + 1) }],
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('ZIP 总大小超过 12MB 时拒绝（含 base64 资源估算）', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: [{
        filename: 'a.png',
        content: '',
        // base64 长度 × 0.75 ≈ 15MB，超过 12MB 上限
        data: `data:image/png;base64,${'A'.repeat(20 * 1024 * 1024)}`,
      }],
    });

    expect(response).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it('ZIP 解出的 base64 估算大小不含 data URL 前缀', async () => {
    const download = start();
    (await loadBackground()).default();

    // 前缀本身不计入估算，13MB base64 → 约 9.75MB，应当通过
    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a.zip',
      files: [{
        filename: 'a.bin',
        content: '',
        data: `data:application/octet-stream;base64,${'A'.repeat(13 * 1024 * 1024)}`,
      }],
    });

    expect(response).toEqual({ ok: true });
    expect(download).toHaveBeenCalledOnce();
  });

  it('ZIP 下载成功时打包为压缩包并清理文件名', async () => {
    const download = start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: 'a:b.zip',
      files: [{ filename: 'ChatGPT/a.md', content: 'hello' }],
    });

    expect(response).toEqual({ ok: true });
    const options = firstDownloadOptions(download) as { filename: string; url: string };

    expect(options.filename).toBe('ab.zip');
    expect(options.url.startsWith('data:application/zip;base64,')).toBe(true);
  });

  it('Firefox 使用 blob URL，并在下载完成通知到达后回收 Object URL', async () => {
    const download = start(7);
    (await loadBackground('Mozilla/5.0 Firefox/120.0')).default();

    // Firefox 路径需要等下载完成事件才返回（对象 URL 必须等下载结束才能释放）
    const pending = browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x' },
    });

    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());

    const options = firstDownloadOptions(download) as { url: string };
    expect(options.url.startsWith('blob:')).toBe(true);
    expect(downloadChangeListeners).toHaveLength(1);

    emitDownloadChanged({ id: 7, state: { current: 'complete' } });

    await expect(pending).resolves.toEqual({ ok: true });
    // 清理后监听器被移除，避免泄漏
    expect(downloadChangeListeners).toHaveLength(0);
  });

  it('Firefox 下载被中断时同样回收并返回成功（浏览器已接管文件）', async () => {
    const download = start(9);
    (await loadBackground('Mozilla/5.0 Firefox/120.0')).default();

    const pending = browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x' },
    });

    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    emitDownloadChanged({ id: 9, state: { current: 'interrupted' } });

    await expect(pending).resolves.toEqual({ ok: true });
    expect(downloadChangeListeners).toHaveLength(0);
  });

  it('Firefox 其他下载 ID 的通知不影响当前下载', async () => {
    const download = start(11);
    (await loadBackground('Mozilla/5.0 Firefox/120.0')).default();

    const pending = browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x' },
    });

    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    emitDownloadChanged({ id: 999, state: { current: 'complete' } });
    emitDownloadChanged({ id: 11, state: { current: 'complete' } });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('Firefox 下载被拒时同样回收 blob URL 并回传错误', async () => {
    start(async () => {
      throw new Error('rejected');
    });
    (await loadBackground('Mozilla/5.0 Firefox/120.0')).default();

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'a.md', content: 'x' },
    });

    expect(response).toEqual({ ok: false, error: 'rejected' });
  });

  it('非下载类消息不产生响应', async () => {
    start();
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({ type: 'SOME_OTHER_MESSAGE' });

    expect(response).toBeUndefined();
  });
});

describe('background popup 转发', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('没有 ChatGPT 标签页时返回错误', async () => {
    fakeBrowser.tabs.query = (async () => []) as never;
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });

    expect(response).toMatchObject({ ok: false });
  });

  it('有标签页时把列表请求转发给 content script', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
    const send = vi.fn(async () => ({ ok: true, conversations: [] }));
    fakeBrowser.tabs.sendMessage = send as never;
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      offset: 0,
      limit: 20,
    });

    expect(response).toEqual({ ok: true, conversations: [] });
    expect(send).toHaveBeenCalledWith(3, {
      type: 'REQUEST_CONVERSATION_LIST',
      offset: 0,
      limit: 20,
    });
  });

  it('content script 未就绪（PING 超时）时返回连接失败', async () => {
    vi.useFakeTimers();

    try {
      fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
      fakeBrowser.tabs.sendMessage = (async () => {
        throw new Error('no receiver');
      }) as never;
      (await loadBackground()).default();

      const pending = browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });
      await vi.advanceTimersByTimeAsync(30 * 100);
      const response = await pending;

      expect(response).toMatchObject({ ok: false });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('转发异常时返回通信失败错误', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
    let calls = 0;
    fakeBrowser.tabs.sendMessage = (async () => {
      calls += 1;
      // 第一次是 PING 探活，之后业务转发失败
      if (calls === 1) return { ok: true };
      throw new Error('boom');
    }) as never;
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });

    expect(response).toMatchObject({ ok: false });
  });

  it('导出请求转发 chatIds 与选项', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
    const send = vi.fn(async () => ({ ok: true }));
    fakeBrowser.tabs.sendMessage = send as never;
    (await loadBackground()).default();

    const response = await browser.runtime.sendMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['a', 'b'],
      includeFrontmatter: true,
      includeTimestamps: false,
      timestamp24h: true,
    });

    expect(response).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(3, {
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['a', 'b'],
      includeFrontmatter: true,
      includeTimestamps: false,
      timestamp24h: true,
    });
  });

  it('已有就绪记录的标签页跳过 PING 探活', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
    const send = vi.fn(async () => ({ ok: true, conversations: [] }));
    fakeBrowser.tabs.sendMessage = send as never;
    (await loadBackground()).default();

    // 先建立一次就绪记录
    await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });
    send.mockClear();

    await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });

    // 第二次不应再发 PING
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('标签页关闭后需要重新探活', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 3 }]) as never;
    const send = vi.fn(async () => ({ ok: true, conversations: [] }));
    fakeBrowser.tabs.sendMessage = send as never;
    (await loadBackground()).default();

    await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });
    fakeBrowser.tabs.onRemoved.trigger(3, { windowId: 1, isWindowClosing: false });
    send.mockClear();

    await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' });

    expect(send).toHaveBeenCalled();
  });
});

describe('background 安装时注入', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('content script 已就绪时不重复注入', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 5 }]) as never;
    fakeBrowser.tabs.sendMessage = (async () => ({ ok: true })) as never;
    const inject = vi.fn(async () => []);
    fakeBrowser.scripting.executeScript = inject as never;
    (await loadBackground()).default();

    await fakeBrowser.runtime.onInstalled.trigger(installedDetails());

    expect(inject).not.toHaveBeenCalled();
  });

  it('探活失败时注入 content script', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 5 }]) as never;
    fakeBrowser.tabs.sendMessage = (async () => {
      throw new Error('no receiver');
    }) as never;
    const inject = vi.fn(async () => []);
    fakeBrowser.scripting.executeScript = inject as never;
    (await loadBackground()).default();

    const triggered = fakeBrowser.runtime.onInstalled.trigger(installedDetails());

    await vi.waitFor(() => {
      expect(inject).toHaveBeenCalledWith({
        target: { tabId: 5 },
        files: ['/content-scripts/chatgpt.js'],
      });
    }, { timeout: 5000 });

    await triggered;
  }, 15_000);

  it('注入失败只记录日志，不影响后续标签页', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: 5 }, { id: 6 }]) as never;
    fakeBrowser.tabs.sendMessage = (async () => {
      throw new Error('no receiver');
    }) as never;
    const inject = vi.fn(async ({ target }: { target: { tabId: number } }) => {
      if (target.tabId === 5) throw new Error('cannot inject');
      return [];
    });
    fakeBrowser.scripting.executeScript = inject as never;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    (await loadBackground()).default();

    const triggered = fakeBrowser.runtime.onInstalled.trigger(installedDetails());

    await vi.waitFor(() => {
      expect(inject).toHaveBeenCalledTimes(2);
    }, { timeout: 5000 });

    await triggered;
    expect(consoleError).toHaveBeenCalled();
  }, 15_000);

  it('标签页没有 id 时跳过', async () => {
    fakeBrowser.tabs.query = (async () => [{ id: undefined }]) as never;
    const inject = vi.fn(async () => []);
    fakeBrowser.scripting.executeScript = inject as never;
    (await loadBackground()).default();

    await fakeBrowser.runtime.onInstalled.trigger(installedDetails());

    expect(inject).not.toHaveBeenCalled();
  });

  it('查询标签页本身失败时不抛异常', async () => {
    fakeBrowser.tabs.query = (async () => {
      throw new Error('tabs unavailable');
    }) as never;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    (await loadBackground()).default();

    await expect(async () => {
      await fakeBrowser.runtime.onInstalled.trigger(installedDetails());
    }).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });
});
