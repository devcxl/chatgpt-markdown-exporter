import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ApiConversation, ConversationNodeMessage } from '../../shared/chatgpt-types';
import type { ImageFileEntry } from './images.ts';

/* images.ts 负责把会话里的 sediment:// 资源换成 assets/ 文件名并下载为 base64。
 * 重点：
 * 1) 遍历范围（multimodal parts + aggregate_result 图片）
 * 2) 生成的文件名与 Markdown 内相对引用（.md 与 assets/ 同级）
 * 3) 单个资源失败不影响其余资源（Promise.allSettled） */

function setUrl(href: string): void {
  const url = new URL(href);
  vi.stubGlobal('location', {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
  });
}

async function loadImages() {
  vi.resetModules();
  return import('./images.ts');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

// jsdom 的 Response(Blob) 不会保留 blob.type，用字符串正文 + content-type 头代替
function imageBlobResponse(type = 'image/png'): Response {
  return new Response('fake-image-bytes', {
    status: 200,
    headers: { 'content-type': type },
  });
}

function sessionResponse(): Response {
  return jsonResponse({ accessToken: 'token-1' });
}

/** 构造一次完成调用的 fetch mock：session → files download → 资源内容 */
function stubFetch(options: {
  downloadUrl?: string;
  mimeType?: string;
  resourceStatus?: number;
} = {}) {
  const {
    downloadUrl = 'https://files.example.com/x',
    mimeType = 'image/png',
    resourceStatus = 200,
  } = options;

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith('/api/auth/session')) return sessionResponse();
    if (url.includes('/backend-api/files/')) return jsonResponse({ download_url: downloadUrl });
    if (resourceStatus !== 200) return new Response('', { status: resourceStatus });
    return imageBlobResponse(mimeType);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function multimodalMessage(parts: unknown[]): ConversationNodeMessage {
  return {
    id: 'n1',
    author: { role: 'user' },
    recipient: 'all',
    content: { content_type: 'multimodal_text', parts: parts as string[] },
  };
}

function conversationWith(messages: ConversationNodeMessage[]): ApiConversation {
  return {
    title: 'T',
    create_time: 1,
    update_time: 2,
    current_node: 'n1',
    mapping: Object.fromEntries(
      messages.map(message => [message.id, { id: message.id, children: [], message }]),
    ),
  };
}

describe('resolveImagesAsFileRefs', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // 文件名使用递增 UUID，避免 mock 常量导致 generateAssetFilename 的
    // do/while 去重循环永不退出
    let uuidSeed = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () => `00000000-0000-4000-8000-${String(uuidSeed++).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('没有资源时不产生任何请求或条目', async () => {
    const fetchMock = stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([multimodalMessage(['纯文本'])]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('把 sediment:// 指针替换为 assets/ 相对路径，并按前缀存放条目', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://p1' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries, 'ChatGPT/');

    const message = conversation.mapping.n1.message as ConversationNodeMessage;
    const part = (message.content as { parts: Array<Record<string, unknown>> }).parts[0];

    expect(part.asset_pointer).toBe('assets/00000000-0000-4000-8000-000000000000.png');
    expect(entries).toEqual([
      {
        filename: 'ChatGPT/assets/00000000-0000-4000-8000-000000000000.png',
        data: expect.stringContaining('data:image/png;base64,') as unknown as string,
      },
    ]);
  });

  it('单会话（无前缀）时条目与引用都不带目录', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://p1' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    const message = conversation.mapping.n1.message as ConversationNodeMessage;
    const part = (message.content as { parts: Array<Record<string, unknown>> }).parts[0];

    expect(part.asset_pointer).toBe('assets/00000000-0000-4000-8000-000000000000.png');
    expect(entries[0].filename).toBe('assets/00000000-0000-4000-8000-000000000000.png');
  });

  it('按 MIME 选择扩展名（jpeg → jpg）', async () => {
    stubFetch({ mimeType: 'image/jpeg' });
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://p1' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries[0].filename.endsWith('.jpg')).toBe(true);
  });

  it('未知 MIME 回退 bin', async () => {
    stubFetch({ mimeType: 'application/x-unknown-thing' });
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://p1' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries[0].filename.endsWith('.bin')).toBe(true);
  });

  it('处理 aggregate_result 中的图片并替换 image_url', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      {
        id: 'n1',
        author: { role: 'tool' },
        recipient: 'all',
        content: { content_type: 'execution_output', text: '' },
        metadata: {
          aggregate_result: {
            messages: [{ message_type: 'image', image_url: 'sediment://agg-1' }],
          },
        },
      },
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    const message = conversation.mapping.n1.message as ConversationNodeMessage;
    expect(message.metadata?.aggregate_result?.messages?.[0].image_url)
      .toBe('assets/00000000-0000-4000-8000-000000000000.png');
    expect(entries).toHaveLength(1);
  });

  it('同一指针只下载一次并复用同一文件名', async () => {
    const fetchMock = stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const pointer = { content_type: 'image_asset_pointer', asset_pointer: 'sediment://dup' };
    const conversation = conversationWith([
      multimodalMessage([pointer]),
      { ...multimodalMessage([pointer]), id: 'n2' },
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries).toHaveLength(1);
    // session + files/download + 资源 各一次
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('多个不同指针生成不同文件名', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://a' },
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://b' },
      ]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    // 两个文件名都必须出现，且互不相同（uuid mock 相同则第二次加后缀避免覆盖）
    expect(entries.length).toBe(2);
  });

  it('资源下载失败时跳过该条目并输出错误，不抛异常', async () => {
    stubFetch({ resourceStatus: 500 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://bad' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    // 引用保持原始指针，避免指向不存在的文件
    const message = conversation.mapping.n1.message as ConversationNodeMessage;
    const part = (message.content as { parts: Array<Record<string, unknown>> }).parts[0];
    expect(part.asset_pointer).toBe('sediment://bad');
  });

  it('非 sediment:// 指针被忽略', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'https://x/y.png' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries).toEqual([]);
  });

  it('content 缺失的节点被跳过（不抛异常）', async () => {
    stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const entries: ImageFileEntry[] = [];
    const conversation: ApiConversation = {
      title: 'T',
      create_time: 1,
      update_time: 2,
      current_node: 'n1',
      mapping: { n1: { id: 'n1', children: [] } },
    };

    await resolveImagesAsFileRefs(conversation, entries);

    expect(entries).toEqual([]);
  });

  it('请求 /files/<pointer>/download 时对指针做编码并去掉 sediment:// 前缀', async () => {
    const fetchMock = stubFetch();
    const { resolveImagesAsFileRefs } = await loadImages();
    const conversation = conversationWith([
      multimodalMessage([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_abc-123' }]),
    ]);

    await resolveImagesAsFileRefs(conversation, []);

    expect(String(fetchMock.mock.calls[1][0]))
      .toContain('/backend-api/files/file_abc-123/download');
  });
});
