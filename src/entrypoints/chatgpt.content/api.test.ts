import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ApiConversations } from '../../shared/chatgpt-types';

/* api.ts 直接对接 ChatGPT 后端，测试重点是：
 * 1) 会话级 token / 团队 accountId 缓存与 401 失效重试
 * 2) 分享页（__share__ 前缀）走页面内 DOM 数据而不是 /conversation API
 * 3) fetchAllConversations 的分页与提前终止条件 */

function setUrl(href: string): void {
  const url = new URL(href);
  vi.stubGlobal('location', {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
  });
}

async function loadApi() {
  vi.resetModules();
  return import('./api.ts');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const sessionResponse = () => jsonResponse({ accessToken: 'token-1' });

function conversationsResponse(items: ApiConversations['items'], total: number | null = null): Response {
  return jsonResponse({
    has_missing_conversations: false,
    items,
    limit: items.length,
    offset: 0,
    total,
  } satisfies ApiConversations);
}

function conversationItem(id: string) {
  return { id, title: `title-${id}`, create_time: 1 };
}

describe('getCurrentChatId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('普通会话页返回原始 id', async () => {
    setUrl('https://chatgpt.com/c/abc-123');
    const { getCurrentChatId } = await loadApi();

    expect(getCurrentChatId()).toBe('abc-123');
  });

  it('分享页添加 __share__ 前缀以区分数据来源', async () => {
    setUrl('https://chatgpt.com/share/share-1');
    const { getCurrentChatId } = await loadApi();

    expect(getCurrentChatId()).toBe('__share__share-1');
  });

  it('非会话页面抛出可读错误', async () => {
    setUrl('https://chatgpt.com/');
    const { getCurrentChatId } = await loadApi();

    expect(() => getCurrentChatId()).toThrow();
  });
});

describe('fetchApi', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('附带 Bearer token 与 credentials', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/api/auth/session') ? sessionResponse() : jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    await fetchApi('/conversation/abc');

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/conversation/abc');
    expect(init.credentials).toBe('include');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-1');
    expect((init.headers as Headers).get('X-Authorization')).toBe('Bearer token-1');
  });

  it('非 ChatGPT 域名抛出不支持的错误', async () => {
    setUrl('https://example.com/c/abc');
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/x')).rejects.toThrow();
  });

  it('拿不到 accessToken 时报错（session 非 2xx）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/x')).rejects.toThrow();
  });

  it('session 中缺少 accessToken 时报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/x')).rejects.toThrow();
  });

  it('存在 _account cookie 时查询并带上团队 accountId', async () => {
    document.cookie = '_account=ws-1';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      if (url.includes('/accounts/check')) {
        return jsonResponse({ accounts: { 'ws-1': { account: { account_id: 'acct-9' } } } });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    await fetchApi('/conversation/abc');

    const [, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Chatgpt-Account-Id')).toBe('acct-9');
  });

  it('accounts/check 非 2xx 时不带 accountId，但仍可请求', async () => {
    document.cookie = '_account=ws-1';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      if (url.includes('/accounts/check')) return new Response('', { status: 403 });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    const result = await fetchApi<{ ok: boolean }>('/conversation/abc');

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect((init.headers as Headers).get('Chatgpt-Account-Id')).toBeNull();
  });

  it('401 时清除缓存并重试一次（成功）', async () => {
    let apiCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      apiCalls += 1;
      return apiCalls === 1 ? new Response('', { status: 401 }) : jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    expect(await fetchApi<{ ok: boolean }>('/conversation/abc')).toEqual({ ok: true });
    expect(apiCalls).toBe(2);
  });

  it('401 重试仍失败时抛出错误（不无限重试）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/api/auth/session') ? sessionResponse() : new Response('', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/conversation/abc')).rejects.toThrow();
  });

  it('非 2xx 时抛出带响应正文的错误信息', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return new Response('  detailed   failure  ', { status: 500, statusText: 'Server Error' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/conversation/abc')).rejects.toThrow(/detailed failure/);
  });

  it('错误正文为空时不追加 detail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return new Response('', { status: 404, statusText: 'Not Found' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchApi } = await loadApi();

    await expect(fetchApi('/conversation/abc')).rejects.toThrow(/Not Found/);
  });
});

describe('fetchConversation', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('普通会话补齐 id 字段', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return jsonResponse({ title: 'T' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchConversation } = await loadApi();

    expect(await fetchConversation('abc-123')).toMatchObject({ id: 'abc-123', title: 'T' });
  });

  it('未传 chatId 时使用当前页面 id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return jsonResponse({ title: 'T' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchConversation } = await loadApi();

    expect(await fetchConversation()).toMatchObject({ id: 'abc-123' });
  });

  it('分享页从页面 DOM 读取数据并剥掉 __share__ 前缀', async () => {
    setUrl('https://chatgpt.com/share/share-1');
    const shareData = { title: 'Shared', mapping: {} };
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify({ props: { pageProps: { serverResponse: { data: shareData } } } })
    }</script></body></html>`;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));
    const { fetchConversation } = await loadApi();

    expect(await fetchConversation('__share__share-1')).toMatchObject({
      id: 'share-1',
      title: 'Shared',
    });
  });

  it('分享页数据缺失时抛出错误', async () => {
    setUrl('https://chatgpt.com/share/share-1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200 })));
    const { fetchConversation } = await loadApi();

    await expect(fetchConversation('__share__share-1')).rejects.toThrow();
  });
});

describe('fetchConversations', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubSession(items: ApiConversations['items'], total: number | null = null) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return conversationsResponse(items, total);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('拼接 offset / limit 查询参数', async () => {
    const fetchMock = stubSession([conversationItem('a')]);
    const { fetchConversations } = await loadApi();

    await fetchConversations(20, 10);

    expect(String(fetchMock.mock.calls[1][0]))
      .toBe('https://chatgpt.com/backend-api/conversations?offset=20&limit=10');
  });

  it('使用默认参数 offset=0 / limit=100', async () => {
    const fetchMock = stubSession([conversationItem('a')]);
    const { fetchConversations } = await loadApi();

    await fetchConversations();

    expect(String(fetchMock.mock.calls[1][0]))
      .toBe('https://chatgpt.com/backend-api/conversations?offset=0&limit=100');
  });
});

describe('fetchAllConversations', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 2000 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubPages(pages: ApiConversations['items'][], total: number | null = null) {
    let call = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      const items = pages[Math.min(call, pages.length - 1)] ?? [];
      call += 1;
      return conversationsResponse(items, total);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('返回不足一页时立即结束', async () => {
    stubPages([[conversationItem('a'), conversationItem('b')]]);
    const { fetchAllConversations } = await loadApi();

    expect(await fetchAllConversations(100)).toHaveLength(2);
  });

  it('满页时继续请求下一页并累加结果', async () => {
    stubPages([
      Array.from({ length: 100 }, (_, index) => conversationItem(`a-${index}`)),
      [conversationItem('b-0')],
    ]);
    const { fetchAllConversations } = await loadApi();

    const items = await fetchAllConversations(200);

    expect(items).toHaveLength(101);
    expect(items[100].id).toBe('b-0');
  });

  it('达到 maxConversations 时截断', async () => {
    stubPages([Array.from({ length: 100 }, (_, index) => conversationItem(`a-${index}`))]);
    const { fetchAllConversations } = await loadApi();

    expect(await fetchAllConversations(50)).toHaveLength(50);
  });

  it('按 total 提前结束，不请求多余页', async () => {
    const fetchMock = stubPages(
      [Array.from({ length: 100 }, (_, index) => conversationItem(`a-${index}`))],
      100,
    );
    const { fetchAllConversations } = await loadApi();

    const items = await fetchAllConversations(500);

    expect(items).toHaveLength(100);
    // 一次 session + 一次 conversations
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('返回空页时结束，避免死循环', async () => {
    stubPages([[]]);
    const { fetchAllConversations } = await loadApi();

    expect(await fetchAllConversations(100)).toEqual([]);
  });

  it('onBatch 回调按批次触发', async () => {
    stubPages([
      Array.from({ length: 100 }, (_, index) => conversationItem(`a-${index}`)),
      [conversationItem('b-0')],
    ]);
    const { fetchAllConversations } = await loadApi();
    const batches: number[] = [];

    await fetchAllConversations(200, items => batches.push(items.length));

    expect(batches).toEqual([100, 1]);
  });
});
