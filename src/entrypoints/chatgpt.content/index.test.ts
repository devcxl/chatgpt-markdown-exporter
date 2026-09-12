import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import type { ApiConversation } from '../../shared/chatgpt-types';

/* content script 是导出流程的编排层，测试重点是消息处理与两条导出路径：
 * - REQUEST_CONVERSATION_LIST：分页与全量拉取
 * - REQUEST_EXPORT_CONVERSATIONS：逐会话导出、部分失败容错、下载消息形态
 * - 当前会话导出：标题回退、分享页 sourceUrl
 *
 * 这里 mock 掉 api / images / markdown 边界，只验证编排逻辑与用户可见提示。 */

const mocks = vi.hoisted(() => ({
  fetchConversation: vi.fn(),
  fetchConversations: vi.fn(),
  fetchAllConversations: vi.fn(),
  getCurrentChatId: vi.fn(),
  resolveImagesAsFileRefs: vi.fn(),
  showToast: vi.fn(),
  mountCurrentExportButton: vi.fn(),
  conversationToMarkdown: vi.fn(),
  processConversation: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchConversation: mocks.fetchConversation,
  fetchConversations: mocks.fetchConversations,
  fetchAllConversations: mocks.fetchAllConversations,
  getCurrentChatId: mocks.getCurrentChatId,
}));

vi.mock('./images', () => ({
  resolveImagesAsFileRefs: mocks.resolveImagesAsFileRefs,
}));

vi.mock('./toast', () => ({
  showToast: mocks.showToast,
}));

vi.mock('./current-export-button', () => ({
  mountCurrentExportButton: mocks.mountCurrentExportButton,
}));

vi.mock('../../markdown/conversation-to-markdown', () => ({
  conversationToMarkdown: mocks.conversationToMarkdown,
}));

vi.mock('./process-conversation', () => ({
  processConversation: mocks.processConversation,
}));

type ContentHandler = (message: unknown) => unknown;

/** 加载 content script 并返回它注册的 onMessage 处理器 */
async function loadContentScript(): Promise<ContentHandler> {
  vi.resetModules();

  const module = await import('./index.ts');
  const definition = module.default as unknown as { main: () => void };
  definition.main();

  return async (message: unknown) => {
    // fake-browser 的 trigger 把每个监听器的返回值收集成数组
    const results = await fakeBrowser.runtime.onMessage.trigger(message, { id: 'test' });
    return results[0];
  };
}

function conversation(id = 'chat-1', title = 'Title'): ApiConversation & { id: string } {
  return {
    id,
    title,
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    current_node: 'n1',
    mapping: {},
  };
}

const processed = {
  id: 'chat-1',
  title: 'Title',
  model: 'gpt-4',
  modelSlug: 'gpt-4',
  createTime: 1_700_000_000,
  updateTime: 1_700_000_100,
  conversationNodes: [],
};

describe('content script 消息处理', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    mocks.mountCurrentExportButton.mockImplementation(() => {});
    mocks.processConversation.mockReturnValue(processed);
    mocks.conversationToMarkdown.mockReturnValue('# Title\n\nbody');
    mocks.resolveImagesAsFileRefs.mockResolvedValue(undefined);
    mocks.getCurrentChatId.mockReturnValue('chat-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PING 直接返回 ok', async () => {
    const handle = await loadContentScript();

    expect(await handle({ type: 'PING_EXPORTER_PANEL' })).toEqual({ ok: true });
  });

  it('未知消息返回 undefined', async () => {
    const handle = await loadContentScript();

    expect(await handle({ type: 'UNKNOWN' })).toBeUndefined();
  });

  it('启动时向 background 报到', async () => {
    const send = vi.fn(async () => undefined);
    fakeBrowser.runtime.sendMessage = send as never;

    await loadContentScript();

    expect(send).toHaveBeenCalledWith({ type: 'CONTENT_SCRIPT_READY' });
  });

  it('报到失败不影响脚本其余功能', async () => {
    fakeBrowser.runtime.sendMessage = (async () => {
      throw new Error('background not ready');
    }) as never;

    await expect(loadContentScript()).resolves.toBeTypeOf('function');
  });

  it('挂载按钮抛错时只记录日志', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.mountCurrentExportButton.mockImplementationOnce(() => {
      throw new Error('mount failed');
    });

    await loadContentScript();

    expect(consoleError).toHaveBeenCalled();
  });

  it('带 offset/limit 的列表请求走分页接口', async () => {
    mocks.fetchConversations.mockResolvedValue({ items: [{ id: 'a' }], total: 5 });
    const handle = await loadContentScript();

    const response = await handle({ type: 'REQUEST_CONVERSATION_LIST', offset: 0, limit: 20 });

    expect(mocks.fetchConversations).toHaveBeenCalledWith(0, 20);
    expect(response).toEqual({ ok: true, conversations: [{ id: 'a' }], total: 5 });
  });

  it('不带分页参数的列表请求拉取全量（默认上限 100）', async () => {
    mocks.fetchAllConversations.mockResolvedValue([{ id: 'a' }]);
    const handle = await loadContentScript();

    const response = await handle({ type: 'REQUEST_CONVERSATION_LIST' });

    expect(mocks.fetchAllConversations).toHaveBeenCalledWith(100);
    expect(response).toEqual({ ok: true, conversations: [{ id: 'a' }] });
  });

  it('列表请求失败时返回 ok:false 与错误信息', async () => {
    mocks.fetchConversations.mockRejectedValue(new Error('api down'));
    const handle = await loadContentScript();

    const response = await handle({ type: 'REQUEST_CONVERSATION_LIST', offset: 0, limit: 20 });

    expect(response).toEqual({ ok: false, error: 'api down' });
  });

  it('列表请求抛出非 Error 时也能返回错误', async () => {
    mocks.fetchConversations.mockRejectedValue('字符串错误');
    const handle = await loadContentScript();

    const response = await handle({ type: 'REQUEST_CONVERSATION_LIST', offset: 0, limit: 20 });

    expect(response).toEqual({ ok: false, error: '字符串错误' });
  });
});

describe('content script 批量导出', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    mocks.mountCurrentExportButton.mockImplementation(() => {});
    mocks.processConversation.mockReturnValue(processed);
    mocks.conversationToMarkdown.mockReturnValue('# Title\n\nbody');
    mocks.resolveImagesAsFileRefs.mockResolvedValue(undefined);
    mocks.fetchConversation.mockResolvedValue(conversation());
  });

  function stubDownload() {
    const send = vi.fn(async () => ({ ok: true }));
    fakeBrowser.runtime.sendMessage = send as never;
    return send;
  }

  function downloadMessage(send: ReturnType<typeof vi.fn>) {
    return send.mock.calls
      .map(call => call[0] as { type?: string })
      .find(message => message.type === 'DOWNLOAD_MARKDOWN' || message.type === 'DOWNLOAD_ZIP');
  }

  const exportOptions = {
    type: 'REQUEST_EXPORT_CONVERSATIONS',
    chatIds: ['chat-1'],
    includeFrontmatter: true,
    includeTimestamps: false,
    timestamp24h: true,
  };

  it('单个会话无图片时直接请求下载 Markdown', async () => {
    const send = stubDownload();
    const handle = await loadContentScript();

    const response = await handle(exportOptions);

    expect(response).toEqual({ ok: true });
    expect(downloadMessage(send)).toMatchObject({ type: 'DOWNLOAD_MARKDOWN' });
  });

  it('会话含图片时打包为 ZIP 并包含资源条目', async () => {
    mocks.resolveImagesAsFileRefs.mockImplementation(async (_conversation: unknown, entries: Array<{ filename: string; data: string }>) => {
      entries.push({ filename: 'ChatGPT/assets/x.png', data: 'data:image/png;base64,AAAA' });
    });
    const send = stubDownload();
    const handle = await loadContentScript();

    await handle(exportOptions);

    const message = downloadMessage(send) as { type: string; files?: unknown[] };
    expect(message.type).toBe('DOWNLOAD_ZIP');
    expect(message.files).toHaveLength(2);
  });

  it('多个会话时合并打包为 ZIP', async () => {
    const send = stubDownload();
    const handle = await loadContentScript();

    await handle({ ...exportOptions, chatIds: ['chat-1', 'chat-2'] });

    const message = downloadMessage(send) as { type: string; files?: unknown[] };
    expect(message.type).toBe('DOWNLOAD_ZIP');
    expect(message.files).toHaveLength(2);
  });

  it('图片解析失败时降级为纯文本并提示', async () => {
    mocks.resolveImagesAsFileRefs.mockRejectedValue(new Error('image fail'));
    const send = stubDownload();
    const handle = await loadContentScript();

    await handle(exportOptions);

    expect(mocks.showToast).toHaveBeenCalled();
    expect(downloadMessage(send)).toMatchObject({ type: 'DOWNLOAD_MARKDOWN' });
  });

  it('部分会话失败时仍导出成功的部分并提示失败数量', async () => {
    mocks.fetchConversation
      .mockResolvedValueOnce(conversation('chat-1'))
      .mockRejectedValueOnce(new Error('chat-2 failed'));
    const send = stubDownload();
    const handle = await loadContentScript();

    const response = await handle({ ...exportOptions, chatIds: ['chat-1', 'chat-2'] });

    expect(response).toEqual({ ok: true });
    expect(downloadMessage(send)).toMatchObject({ type: 'DOWNLOAD_MARKDOWN' });
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('1'),
      'info',
    );
  });

  it('全部会话失败时返回 ok:false 且不下载', async () => {
    mocks.fetchConversation.mockRejectedValue(new Error('all failed'));
    const send = stubDownload();
    const handle = await loadContentScript();

    const response = await handle(exportOptions);

    expect(response).toMatchObject({ ok: false });
    expect(downloadMessage(send)).toBeUndefined();
  });

  it('下载被拒绝时返回 ok:false 并提示', async () => {
    fakeBrowser.runtime.sendMessage = (async () => ({ ok: false, error: '配额不足' })) as never;
    const handle = await loadContentScript();

    const response = await handle(exportOptions);

    expect(response).toEqual({ ok: false, error: '配额不足' });
    expect(mocks.showToast).toHaveBeenCalled();
  });

  it('全部成功时提示成功', async () => {
    stubDownload();
    const handle = await loadContentScript();

    await handle(exportOptions);

    expect(mocks.showToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('导出的 Markdown 使用 ChatGPT/ 前缀文件名与会话 id 作为 sourceUrl', async () => {
    mocks.resolveImagesAsFileRefs.mockImplementation(async (_conversation: unknown, entries: Array<{ filename: string; content: string; data?: string }>) => {
      entries.push({ filename: 'ChatGPT/assets/x.png', content: '', data: 'AAAA' });
    });
    const send = stubDownload();
    const handle = await loadContentScript();

    await handle(exportOptions);

    const message = downloadMessage(send) as { files: Array<{ filename: string }> };
    const datePrefix = new Date().toISOString().slice(0, 10);

    expect(message.files[0].filename).toBe(`ChatGPT/${datePrefix}-Title.md`);
    expect(mocks.conversationToMarkdown).toHaveBeenCalledWith(
      processed,
      expect.anything(),
      { sourceUrl: 'http://localhost:3000/c/chat-1' },
    );
  });
});

describe('content script 当前会话导出', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    mocks.mountCurrentExportButton.mockImplementation(() => {});
    mocks.processConversation.mockReturnValue(processed);
    mocks.conversationToMarkdown.mockReturnValue('# Title\n\nbody');
    mocks.resolveImagesAsFileRefs.mockResolvedValue(undefined);
    mocks.fetchConversation.mockResolvedValue(conversation());
    mocks.getCurrentChatId.mockReturnValue('chat-1');
  });

  /** 从按钮挂载回调中取出「导出当前会话」函数并执行 */
  async function runCurrentExport() {
    const handle = await loadContentScript();
    void handle;

    const exportCurrent = mocks.mountCurrentExportButton.mock.calls[0][0] as () => Promise<void>;
    await exportCurrent();
  }

  function stubDownload(response: unknown = { ok: true }) {
    const send = vi.fn(async () => response);
    fakeBrowser.runtime.sendMessage = send as never;
    return send;
  }

  it('无图片时直接下载单文件 Markdown', async () => {
    const send = stubDownload();

    await runCurrentExport();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'DOWNLOAD_MARKDOWN' }));
  });

  it('含图片时下载 ZIP 且文件名带 chatgpt- 前缀', async () => {
    mocks.resolveImagesAsFileRefs.mockImplementation(async (_conversation: unknown, entries: Array<{ filename: string; content: string; data?: string }>) => {
      entries.push({ filename: 'assets/x.png', content: '', data: 'AAAA' });
    });
    const send = stubDownload();

    await runCurrentExport();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DOWNLOAD_ZIP',
      filename: expect.stringMatching(/^chatgpt-.*\.zip$/),
    }));
  });

  it('图片解析失败时降级为纯文本并提示', async () => {
    mocks.resolveImagesAsFileRefs.mockRejectedValue(new Error('fail'));
    stubDownload();

    await runCurrentExport();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('分享页使用当前页面 URL 作为 sourceUrl', async () => {
    mocks.getCurrentChatId.mockReturnValue('__share__share-1');
    stubDownload();

    await runCurrentExport();

    expect(mocks.conversationToMarkdown).toHaveBeenCalledWith(
      processed,
      expect.anything(),
      { sourceUrl: window.location.href },
    );
  });

  it('下载失败时提示错误', async () => {
    stubDownload({ ok: false, error: '下载失败原因' });

    await runCurrentExport();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('下载失败原因'), 'error');
  });

  it('导出流程抛错时提示错误', async () => {
    mocks.fetchConversation.mockRejectedValue(new Error('抓取失败'));
    stubDownload();

    await runCurrentExport();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('抓取失败'), 'error');
  });

  it('导出成功时提示成功', async () => {
    stubDownload();

    await runCurrentExport();

    expect(mocks.showToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('页面标题去掉 ChatGPT 后缀作为文件名', async () => {
    const originalTitle = document.title;
    document.title = '我的会话 - ChatGPT';
    mocks.resolveImagesAsFileRefs.mockImplementation(async (_conversation: unknown, entries: Array<{ filename: string; content: string; data?: string }>) => {
      entries.push({ filename: 'assets/x.png', content: '', data: 'AAAA' });
    });
    const send = stubDownload();

    try {
      await runCurrentExport();

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        filename: expect.stringContaining('我的会话'),
      }));
    }
    finally {
      document.title = originalTitle;
    }
  });

  it('页面标题为空时回退到会话标题', async () => {
    const originalTitle = document.title;
    document.title = 'ChatGPT';
    const send = stubDownload();

    try {
      await runCurrentExport();

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        file: expect.objectContaining({ filename: expect.stringContaining('Title') }),
      }));
    }
    finally {
      document.title = originalTitle;
    }
  });
});
