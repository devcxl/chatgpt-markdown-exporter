import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* page.ts 全部依赖 location 与 DOMParser，用 stubGlobal 切换页面状态。
 * fetchShareConversationFromPage 覆盖 Next.js（__NEXT_DATA__）与 Remix（__remixContext）
 * 两条解析路径，它们是分享页导出的唯一数据来源。 */

const ORIGINAL_LOCATION = window.location;

function setUrl(href: string): void {
  const url = new URL(href);
  vi.stubGlobal('location', {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
  });
}

async function loadPage() {
  vi.resetModules();
  return import('./page.ts');
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

describe('getChatIdFromUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    void ORIGINAL_LOCATION;
  });

  it('解析 /c/<id>', async () => {
    setUrl('https://chatgpt.com/c/abc-123');
    const { getChatIdFromUrl } = await loadPage();

    expect(getChatIdFromUrl()).toBe('abc-123');
  });

  it('解析 /share/<id>', async () => {
    setUrl('https://chatgpt.com/share/share-1');
    const { getChatIdFromUrl } = await loadPage();

    expect(getChatIdFromUrl()).toBe('share-1');
  });

  it('解析带团队前缀的 /g/<workspace>/c/<id>', async () => {
    setUrl('https://chatgpt.com/g/my-team/c/team-chat-1');
    const { getChatIdFromUrl } = await loadPage();

    expect(getChatIdFromUrl()).toBe('team-chat-1');
  });

  it('非会话页面返回 null', async () => {
    setUrl('https://chatgpt.com/');
    const { getChatIdFromUrl } = await loadPage();

    expect(getChatIdFromUrl()).toBeNull();
  });

  it('带查询串 / 尾随路径时仍取到 id', async () => {
    setUrl('https://chatgpt.com/c/abc-123?model=gpt-4');
    const { getChatIdFromUrl } = await loadPage();

    expect(getChatIdFromUrl()).toBe('abc-123');
  });
});

describe('isSharePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    void ORIGINAL_LOCATION;
  });

  it('分享页返回 true', async () => {
    setUrl('https://chatgpt.com/share/share-1');
    const { isSharePage } = await loadPage();

    expect(isSharePage()).toBe(true);
  });

  it('分享页的「继续对话」也算分享页', async () => {
    setUrl('https://chatgpt.com/share/share-1/continue');
    const { isSharePage } = await loadPage();

    expect(isSharePage()).toBe(true);
  });

  it('普通会话页返回 false', async () => {
    setUrl('https://chatgpt.com/c/abc-123');
    const { isSharePage } = await loadPage();

    expect(isSharePage()).toBe(false);
  });
});

describe('fetchShareConversationFromPage', () => {
  beforeEach(() => {
    setUrl('https://chatgpt.com/share/share-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('解析 __NEXT_DATA__ 中的会话数据', async () => {
    const data = { title: 'From Next', mapping: {} };
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify({ props: { pageProps: { serverResponse: { data } } } })
    }</script></body></html>`;

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toEqual(data);
  });

  it('解析 Remix 的 __remixContext', async () => {
    const data = { title: 'From Remix', mapping: {} };
    const payload = {
      state: { loaderData: { 'routes/share.$shareId.($action)': { serverResponse: { data } } } },
    };
    const html = `<html><body><script>window.__remixContext = ${
      JSON.stringify(payload)
    };</script></body></html>`;

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toEqual(data);
  });

  it('__remixContext 内含字符串花括号时不误截断', async () => {
    const data = { title: 'Braces {in} string', mapping: {} };
    const payload = {
      marker: 'a } brace inside string',
      state: { loaderData: { 'routes/share.$shareId.($action)': { serverResponse: { data } } } },
    };
    const html = `<html><body><script>window.__remixContext = ${
      JSON.stringify(payload)
    };</script></body></html>`;

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toEqual(data);
  });

  it('响应非 2xx 时返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('两种数据源都缺失时返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html><body>nothing</body></html>')));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('__NEXT_DATA__ 中缺少 serverResponse 时返回 null', async () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify({ props: { pageProps: {} } })
    }</script></body></html>`;

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('__remixContext 存在但无对应 loaderData 时返回 null', async () => {
    const html = '<html><body><script>window.__remixContext = {"state":{"loaderData":{}}};</script></body></html>';

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('__remixContext 赋值后没有对象起始符时返回 null', async () => {
    const html = '<html><body><script>window.__remixContext = null;</script></body></html>';

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('__remixContext 花括号不闭合时返回 null', async () => {
    const html = '<html><body><script>window.__remixContext = {"state": {"loaderData": {</script></body></html>';

    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(html)));
    const { fetchShareConversationFromPage } = await loadPage();

    expect(await fetchShareConversationFromPage()).toBeNull();
  });

  it('以 credentials: include 请求当前页面', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<html></html>'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchShareConversationFromPage } = await loadPage();

    await fetchShareConversationFromPage();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/share/share-1',
      { credentials: 'include' },
    );
  });
});
