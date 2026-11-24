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

/** 取出唯一匹配的请求 URL，用于断言端点参数 */
function findRequestUrl(
  fetchMock: ReturnType<typeof vi.fn>,
  matcher: string | RegExp,
): URL {
  const call = fetchMock.mock.calls
    .map(call => String(call[0]))
    .find(url => (typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url)));

  if (!call) {
    throw new Error(`未请求匹配 ${String(matcher)} 的端点`);
  }

  return new URL(call);
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

/* ------------------------------------------------------------------ */
/*  项目（snorlax gizmo）侧                                             */
/* ------------------------------------------------------------------ */

/* 端点与字段事实见 research/project-api 分支的
 * docs/research/project-gizmo-api.md，以及 docs/dev/specs/project-export.md §2。 */

function sidebarProject(id: string, name?: string) {
  return {
    gizmo: {
      gizmo: {
        id,
        display: name === undefined ? undefined : { name },
        gizmo_type: 'snorlax',
      },
      conversations: { items: [], cursor: null },
    },
  };
}

describe('toEpochSeconds', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('数字按秒原样返回，小数向下取整', async () => {
    setUrl('https://chatgpt.com/c/abc');
    const { toEpochSeconds } = await loadApi();

    expect(toEpochSeconds(1700000000)).toBe(1700000000);
    expect(toEpochSeconds(1761765938.749404)).toBe(1761765938);
  });

  it('ISO 8601 字符串转为秒', async () => {
    setUrl('https://chatgpt.com/c/abc');
    const { toEpochSeconds } = await loadApi();

    // 字面量来自独立换算，避免与实现用同一个表达式自证
    expect(toEpochSeconds('2025-07-23T17:14:27.231284Z')).toBe(1753290867);
  });

  it('无法解析的值返回 0 而不是 NaN', async () => {
    setUrl('https://chatgpt.com/c/abc');
    const { toEpochSeconds } = await loadApi();

    expect(toEpochSeconds('not-a-date')).toBe(0);
    expect(toEpochSeconds(undefined)).toBe(0);
    expect(toEpochSeconds(null)).toBe(0);
  });
});

describe('fetchProjects', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubSidebar(pages: Array<{ items: unknown[]; cursor?: string | null }>) {
    let page = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      const body = pages[Math.min(page, pages.length - 1)];
      page += 1;
      return jsonResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function sidebarUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
    return findRequestUrl(fetchMock, '/gizmos/snorlax/sidebar');
  }

  it('解包 gizmo.gizmo 双层嵌套', async () => {
    stubSidebar([{ items: [sidebarProject('g-p-aaa', '研究')], cursor: null }]);
    const { fetchProjects } = await loadApi();

    expect(await fetchProjects()).toEqual([{ id: 'g-p-aaa', name: '研究' }]);
  });

  it('兼容只有一层 gizmo 的形态', async () => {
    stubSidebar([{ items: [{ gizmo: { id: 'g-p-bbb', display: { name: '单层' } } }], cursor: null }]);
    const { fetchProjects } = await loadApi();

    expect(await fetchProjects()).toEqual([{ id: 'g-p-bbb', name: '单层' }]);
  });

  it('过滤非 g-p- 前缀的项（自定义 GPT 混入）', async () => {
    stubSidebar([{
      items: [sidebarProject('g-p-ccc', 'A'), sidebarProject('g-zzz', 'GPT'), sidebarProject('nonsense', 'X')],
      cursor: null,
    }]);
    const { fetchProjects } = await loadApi();

    expect((await fetchProjects()).map(p => p.id)).toEqual(['g-p-ccc']);
  });

  it('display.name 为空或缺失时回退项目 id', async () => {
    stubSidebar([{
      items: [sidebarProject('g-p-ddd', ''), sidebarProject('g-p-eee')],
      cursor: null,
    }]);
    const { fetchProjects } = await loadApi();

    expect(await fetchProjects()).toEqual([
      { id: 'g-p-ddd', name: 'g-p-ddd' },
      { id: 'g-p-eee', name: 'g-p-eee' },
    ]);
  });

  it('按 cursor 翻页并在 null 时终止', async () => {
    const fetchMock = stubSidebar([
      { items: [sidebarProject('g-p-a')], cursor: 'p2' },
      { items: [sidebarProject('g-p-b')], cursor: null },
    ]);
    const { fetchProjects } = await loadApi();

    expect((await fetchProjects()).map(p => p.id)).toEqual(['g-p-a', 'g-p-b']);
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/gizmos/snorlax/sidebar'))).toHaveLength(2);
  });

  it('首页请求不带 cursor（服务端对 cursor=0 返回 500）', async () => {
    const fetchMock = stubSidebar([{ items: [], cursor: null }]);
    const { fetchProjects } = await loadApi();

    await fetchProjects();

    const url = sidebarUrl(fetchMock);

    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('后续页才带服务端下发的 cursor', async () => {
    const fetchMock = stubSidebar([
      { items: [sidebarProject('g-p-a')], cursor: 'opaque-cursor' },
      { items: [sidebarProject('g-p-b')], cursor: null },
    ]);
    const { fetchProjects } = await loadApi();

    await fetchProjects();

    const sidebarCalls = fetchMock.mock.calls
      .map(call => String(call[0]))
      .filter(url => url.includes('/gizmos/snorlax/sidebar'))
      .map(url => new URL(url));

    expect(sidebarCalls).toHaveLength(2);
    expect(sidebarCalls[1].searchParams.get('cursor')).toBe('opaque-cursor');
  });

  it('不传 limit 只返回 5 条，因此请求必须显式带上 limit 与 owned_only', async () => {
    const fetchMock = stubSidebar([{ items: [], cursor: null }]);
    const { fetchProjects } = await loadApi();

    await fetchProjects();

    const url = sidebarUrl(fetchMock);

    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('owned_only')).toBe('true');
    // 内嵌会话会显著放大响应体，且不足以构成完整列表
    expect(url.searchParams.get('conversations_per_gizmo')).toBe('0');
  });

  it('没有 gizmo 字段的项被丢弃', async () => {
    stubSidebar([{ items: [{}, { gizmo: null }, sidebarProject('g-p-ok', 'OK')], cursor: null }]);
    const { fetchProjects } = await loadApi();

    expect((await fetchProjects()).map(p => p.id)).toEqual(['g-p-ok']);
  });

  it('服务端重复下发同一个 cursor 时终止，不会无限请求', async () => {
    const fetchMock = stubSidebar([
      { items: [sidebarProject('g-p-x')], cursor: 'same' },
      { items: [sidebarProject('g-p-y')], cursor: 'same' },
    ]);
    const { fetchProjects } = await loadApi();

    expect((await fetchProjects()).map(p => p.id)).toEqual(['g-p-x', 'g-p-y']);
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/gizmos/snorlax/sidebar')))
      .toHaveLength(2);
  });

  it('重复出现的项目只保留一次（翻页边界重叠）', async () => {
    stubSidebar([
      { items: [sidebarProject('g-p-dup', 'D')], cursor: 'p2' },
      { items: [sidebarProject('g-p-dup', 'D')], cursor: null },
    ]);
    const { fetchProjects } = await loadApi();

    expect((await fetchProjects()).map(p => p.id)).toEqual(['g-p-dup']);
  });
});

describe('fetchProjectConversations', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/c/abc-123');
    document.cookie = '_account=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubProjectPage(body: unknown) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/session')) return sessionResponse();
      return jsonResponse(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function projectUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
    return findRequestUrl(fetchMock, /\/gizmos\/[^/]+\/conversations/);
  }

  it('从 cursor=0 起、limit 固定 50（超过 50 服务端返回 422）', async () => {
    const fetchMock = stubProjectPage({ items: [], cursor: null });
    const { fetchProjectConversations } = await loadApi();

    await fetchProjectConversations('g-p-aaa');

    const url = projectUrl(fetchMock);

    expect(url.pathname).toContain('/gizmos/g-p-aaa/conversations');
    expect(url.searchParams.get('cursor')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('50');
  });

  it('把 ISO 字符串时间归一化为 epoch 秒', async () => {
    stubProjectPage({
      items: [{
        id: 'c1',
        title: 'T',
        create_time: '2025-07-23T17:14:27.231284Z',
        update_time: '2025-08-17T20:49:57.087149Z',
        gizmo_id: 'g-p-aaa',
      }],
      cursor: null,
    });
    const { fetchProjectConversations } = await loadApi();

    const page = await fetchProjectConversations('g-p-aaa');

    expect(page.items[0]).toMatchObject({
      id: 'c1',
      title: 'T',
      create_time: 1753290867,
      update_time: 1755463797,
      gizmo_id: 'g-p-aaa',
    });
  });

  it('缺 update_time 时不补字段，缺 gizmo_id 时补 null', async () => {
    stubProjectPage({
      items: [{ id: 'c1', title: 'T', create_time: '2025-07-23T17:14:27Z' }],
      cursor: null,
    });
    const { fetchProjectConversations } = await loadApi();

    const page = await fetchProjectConversations('g-p-aaa');

    expect(page.items[0].update_time).toBeUndefined();
    expect(page.items[0].gizmo_id).toBeNull();
  });

  it('透传服务端 cursor 供下一页使用，末页为 null', async () => {
    stubProjectPage({ items: [], cursor: 'next-1' });
    const { fetchProjectConversations } = await loadApi();

    expect((await fetchProjectConversations('g-p-aaa', 'prev-1')).cursor).toBe('next-1');
  });

  it('上一次的 cursor 原样带进请求', async () => {
    const fetchMock = stubProjectPage({ items: [], cursor: null });
    const { fetchProjectConversations } = await loadApi();

    await fetchProjectConversations('g-p-aaa', 'abc');

    expect(projectUrl(fetchMock).searchParams.get('cursor')).toBe('abc');
  });

  it('空串 cursor 归一为 null（调用方按 null 判断末页）', async () => {
    stubProjectPage({ items: [], cursor: '' });
    const { fetchProjectConversations } = await loadApi();

    const page = await fetchProjectConversations('g-p-aaa');

    expect(page.cursor).toBeNull();
  });

  it('响应缺 items 时按空列表处理', async () => {
    stubProjectPage({});
    const { fetchProjectConversations } = await loadApi();

    const page = await fetchProjectConversations('g-p-aaa');

    expect(page.items).toEqual([]);
    expect(page.cursor).toBeNull();
  });
});
