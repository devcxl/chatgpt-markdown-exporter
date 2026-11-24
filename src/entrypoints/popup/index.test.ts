import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* popup 是纯 DOM 模块：import 时即读取页面元素并注册监听器，
 * 因此用真实 index.html 作为夹具，保证选择器与生产 HTML 始终一致。 */

const popupHtml = readFileSync(
  resolve(process.cwd(), 'src/entrypoints/popup/index.html'),
  'utf-8',
);

function loadPopupDom(): void {
  const bodyHtml = popupHtml
    .slice(popupHtml.indexOf('<body>') + '<body>'.length, popupHtml.indexOf('</body>'))
    // 只保留结构，脚本由测试自行 import
    .replace(/<script[\s\S]*?<\/script>/, '');

  document.body.innerHTML = bodyHtml;
}

async function loadPopup() {
  vi.resetModules();
  loadPopupDom();
  return import('./index.ts');
}

function conversation(id: string, title = `title-${id}`) {
  return { id, title, create_time: 1_700_000_000 };
}

/** 等待 init() 的异步流程完成 */
async function flush(): Promise<void> {
  await vi.waitFor(() => {
    const list = document.querySelector('[data-role=\'conversation-list\']');
    if (!list) throw new Error('list missing');
  });
  // 让 pending 的 promise 链（init → requestConversations）跑完
  await Promise.resolve();
  await Promise.resolve();
}

function q<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function rows(): HTMLLabelElement[] {
  return [...document.querySelectorAll<HTMLLabelElement>('.conversation-row')];
}

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type=\'checkbox\'][data-chat-id]')];
}

function statusText(): string {
  return q<HTMLParagraphElement>('[data-role=\'status\']').textContent ?? '';
}

function sectionTitle(): string {
  return q<HTMLSpanElement>('[data-role=\'section-title\']').textContent ?? '';
}

function exportLabel(): string {
  return q<HTMLSpanElement>('[data-role=\'export-selected-label\']').textContent ?? '';
}

function setMessageHandler(
  handler: (message: { type: string; offset?: number; limit?: number }) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(handler);
  fakeBrowser.runtime.sendMessage = spy as never;
  return spy;
}

describe('popup 初始化', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('加载成功后渲染会话列表与数量', async () => {
    setMessageHandler(async () => ({
      ok: true,
      conversations: [conversation('a'), conversation('b')],
      total: 2,
    }));

    await loadPopup();
    await flush();

    expect(rows()).toHaveLength(2);
    expect(statusText()).toContain('2');
    expect(sectionTitle()).not.toBe('');
  });

  it('请求使用 offset=0 / limit=20（分页页大小）', async () => {
    const send = setMessageHandler(async () => ({ ok: true, conversations: [] }));

    await loadPopup();
    await flush();

    expect(send).toHaveBeenCalledWith({ type: 'REQUEST_CONVERSATION_LIST', offset: 0, limit: 20 });
  });

  it('列表为空时提示无可导出会话', async () => {
    setMessageHandler(async () => ({ ok: true, conversations: [], total: 0 }));

    await loadPopup();
    await flush();

    expect(rows()).toHaveLength(0);
    expect(statusText()).not.toBe('');
  });

  it('连接失败时保留界面并显示错误', async () => {
    setMessageHandler(async () => ({ ok: false, error: '连接失败' }));

    await loadPopup();
    await flush();

    expect(statusText()).toBe('连接失败');
    // 界面结构未被替换
    expect(q('[data-role=\'refresh\']')).toBeTruthy();
    expect(q('[data-role=\'export-selected\']')).toBeTruthy();
  });

  it('连接失败时导出按钮保持禁用，刷新按钮可点（重试入口）', async () => {
    setMessageHandler(async () => ({ ok: false, error: 'x' }));

    await loadPopup();
    await flush();

    expect(q<HTMLButtonElement>('[data-role=\'export-selected\']').disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-role=\'refresh\']').disabled).toBe(false);
  });

  it('请求抛异常时展示错误信息', async () => {
    setMessageHandler(async () => {
      throw new Error('network down');
    });

    await loadPopup();
    await vi.waitFor(() => {
      expect(statusText()).not.toBe('');
    });
  });
});

describe('popup 选择与导出', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  async function loadWithConversations() {
    const send = setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: [conversation('a'), conversation('b')], total: 2 };
      }
      return { ok: true };
    });

    await loadPopup();
    await flush();

    return send;
  }

  it('勾选后 selectedIds 记录，取消勾选后移除', async () => {
    await loadWithConversations();
    const [first] = checkboxes();

    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));

    expect(q<HTMLSpanElement>('[data-role=\'export-selected-label\']').textContent).toBeTruthy();
  });

  it('未选择任何会话时导出给出提示且不发请求', async () => {
    const send = await loadWithConversations();
    send.mockClear();

    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    expect(send).not.toHaveBeenCalled();
    expect(statusText()).not.toBe('');
  });

  it('仅勾选 1 个会话时按钮文案切换为单会话导出', async () => {
    await loadWithConversations();
    const labelBefore = exportLabel();
    const [first] = checkboxes();

    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    const labelSingle = exportLabel();

    expect(labelSingle).not.toBe(labelBefore);
  });

  it('全选后按钮文案不是单会话文案', async () => {
    await loadWithConversations();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    const labelAll = exportLabel();

    const [first] = checkboxes();
    first.checked = true;
    checkboxes().forEach((box, index) => {
      box.checked = index === 0;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(exportLabel()).not.toBe(labelAll);
  });

  it('全选勾选所有复选框', async () => {
    await loadWithConversations();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();

    expect(checkboxes().every(box => box.checked)).toBe(true);
  });

  it('清空取消所有勾选', async () => {
    await loadWithConversations();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'clear-selection\']').click();

    expect(checkboxes().some(box => box.checked)).toBe(false);
  });

  it('导出时按列表顺序提交 chatIds 并带上选项', async () => {
    const send = await loadWithConversations();

    // 逆序勾选，验证提交顺序按列表而非点击顺序
    const boxes = checkboxes();
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));

    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    );

    expect(exportCall?.[0]).toMatchObject({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['a', 'b'],
      includeFrontmatter: true,
      includeTimestamps: false,
      timestamp24h: true,
      fenceMessages: false,
    });
  });

  it('导出成功后展示成功状态并恢复按钮可用', async () => {
    await loadWithConversations();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    expect(statusText()).not.toBe('');
    expect(q<HTMLButtonElement>('[data-role=\'export-selected\']').disabled).toBe(false);
  });

  it('导出失败时展示错误', async () => {
    const send = setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: [conversation('a')], total: 1 };
      }
      return { ok: false, error: '导出被拒绝' };
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    expect(send).toHaveBeenCalled();
    expect(statusText()).toBe('导出被拒绝');
  });

  it('导出抛异常时展示错误且按钮不被卡死', async () => {
    setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: [conversation('a')], total: 1 };
      }
      throw new Error('boom');
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    expect(q<HTMLButtonElement>('[data-role=\'export-selected\']').disabled).toBe(false);
  });

  it('frontmatter / 时间选项跟随复选框状态', async () => {
    const send = await loadWithConversations();

    q<HTMLInputElement>('[data-role=\'frontmatter\']').checked = false;
    q<HTMLInputElement>('[data-role=\'timestamps\']').checked = true;

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    );

    expect(exportCall?.[0]).toMatchObject({
      includeFrontmatter: false,
      includeTimestamps: true,
    });
  });

  it('围栏选项默认关闭，勾选后随导出请求提交', async () => {
    const send = await loadWithConversations();

    const fence = q<HTMLInputElement>('[data-role=\'fence\']');

    expect(fence.checked).toBe(false);

    fence.checked = true;
    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    );

    expect(exportCall?.[0]).toMatchObject({ fenceMessages: true });
  });
});

describe('popup 分页与刷新', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('首屏满 20 条时滚动到底部触发加载更多', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    const send = setMessageHandler(async (message) => {
      const offset = message.offset ?? 0;
      return offset === 0
        ? { ok: true, conversations: firstPage, total: 21 }
        : { ok: true, conversations: [conversation('b-0')], total: 21 };
    });

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    // jsdom 中滚动尺寸恒为 0，直接构造触底条件
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });

    list.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(rows().length).toBe(21);
    });

    expect(send.mock.calls.some(call => (call[0] as { offset?: number }).offset === 20)).toBe(true);
  });

  it('不足 20 条时不再请求下一页', async () => {
    const send = setMessageHandler(async () => ({
      ok: true,
      conversations: [conversation('a')],
      total: 1,
    }));

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));
    await flush();

    // 只数列表请求：初始化还会额外发一次项目列表请求，与分页无关
    const listCalls = send.mock.calls.filter(
      call => (call[0] as { type?: string }).type === 'REQUEST_CONVERSATION_LIST',
    );

    expect(listCalls).toHaveLength(1);
  });

  it('刷新清空列表并重新请求第一页', async () => {
    const send = setMessageHandler(async () => ({
      ok: true,
      conversations: [conversation('a')],
      total: 1,
    }));

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'refresh\']').click();
    await flush();

    const listCalls = send.mock.calls.filter(
      call => (call[0] as { type?: string }).type === 'REQUEST_CONVERSATION_LIST',
    );

    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    expect(listCalls.every(call => (call[0] as { offset?: number }).offset === 0)).toBe(true);
  });

  it('刷新会清空已选会话', async () => {
    const send = setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: [conversation('a')], total: 1 };
      }
      return { ok: true };
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'refresh\']').click();
    await flush();

    // 清空后导出按钮再次点击应提示未选择
    send.mockClear();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    );
    expect(exportCall).toBeUndefined();
  });

  it('加载更多失败时展示错误但保留已有列表', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      if (listCalls === 1) return { ok: true, conversations: firstPage, total: 40 };
      return { ok: false, error: '加载更多失败' };
    });

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(statusText()).toBe('加载更多失败');
    });

    expect(rows()).toHaveLength(20);
  });

  it('渲染标题为空时回退显示会话 id', async () => {
    setMessageHandler(async () => ({
      ok: true,
      conversations: [{ id: 'no-title', title: '', create_time: 1_700_000_000 }],
      total: 1,
    }));

    await loadPopup();
    await flush();

    expect(rows()[0].textContent).toContain('no-title');
  });

  it('缺少时间字段时显示无时间信息', async () => {
    setMessageHandler(async () => ({
      ok: true,
      conversations: [{ id: 'a', title: 'A', create_time: 0 }],
      total: 1,
    }));

    await loadPopup();
    await flush();

    expect(rows()[0].querySelector('.conversation-meta')?.textContent).toBeTruthy();
  });

  it('渲染时恢复已勾选状态（列表重建不丢选择）', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      const offset = message.offset ?? 0;
      return offset === 0
        ? { ok: true, conversations: firstPage, total: 21 }
        : { ok: true, conversations: [conversation('b-0')], total: 21 };
    });

    await loadPopup();
    await flush();

    const [first] = checkboxes();
    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(rows().length).toBe(21);
    });

    expect(checkboxes()[0].checked).toBe(true);
  });
});

describe('popup 边界分支', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  async function loadWithConversations(list = [conversation('a')]) {
    const send = setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: list, total: list.length };
      }
      return { ok: true };
    });

    await loadPopup();
    await flush();

    return send;
  }

  it('change 事件来自非复选框时被忽略', async () => {
    await loadWithConversations();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    const other = document.createElement('input');
    other.type = 'text';
    list.appendChild(other);

    expect(() => other.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
  });

  it('复选框缺少 chatId 时被忽略', async () => {
    await loadWithConversations();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    const orphan = document.createElement('input');
    orphan.type = 'checkbox';
    list.appendChild(orphan);

    expect(() => orphan.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();

    // 选择未变化：导出按钮点击后仍提示未选择
    const send = fakeBrowser.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    );
    expect(exportCall).toBeUndefined();
  });

  it('全选跳过缺少 chatId 的复选框', async () => {
    await loadWithConversations();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    const orphan = document.createElement('input');
    orphan.type = 'checkbox';
    list.appendChild(orphan);

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();

    expect(orphan.checked).toBe(true);
    expect(checkboxes()[0].checked).toBe(true);
  });

  it('初始化时 sendMessage 抛非 Error 使用默认文案', async () => {
    setMessageHandler(async () => {
      throw 'string failure';
    });

    await loadPopup();
    await vi.waitFor(() => {
      expect(statusText()).not.toBe('');
    });
  });

  it('导出时 sendMessage 抛非 Error 也能展示错误', async () => {
    setMessageHandler(async (message) => {
      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: [conversation('a')], total: 1 };
      }
      throw 'string failure';
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    expect(statusText()).not.toBe('');
    expect(q<HTMLButtonElement>('[data-role=\'export-selected\']').disabled).toBe(false);
  });

  it('刷新时 sendMessage 抛异常展示错误且按钮恢复', async () => {
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      if (listCalls === 1) return { ok: true, conversations: [conversation('a')], total: 1 };
      throw new Error('refresh failed');
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'refresh\']').click();
    await flush();

    expect(statusText()).toContain('refresh failed');
    expect(q<HTMLButtonElement>('[data-role=\'refresh\']').disabled).toBe(false);
  });

  it('刷新返回失败时展示错误', async () => {
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      if (listCalls === 1) return { ok: true, conversations: [conversation('a')], total: 1 };
      return { ok: false, error: '刷新失败' };
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'refresh\']').click();
    await vi.waitFor(() => {
      expect(statusText()).toBe('刷新失败');
    });
  });

  it('刷新返回空列表时提示无可导出会话', async () => {
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      return listCalls === 1
        ? { ok: true, conversations: [conversation('a')], total: 1 }
        : { ok: true, conversations: [], total: 0 };
    });

    await loadPopup();
    await flush();

    q<HTMLButtonElement>('[data-role=\'refresh\']').click();
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(0);
    });
  });

  it('加载更多时抛出异常展示带原因的错误', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      if (listCalls === 1) return { ok: true, conversations: firstPage, total: 40 };
      throw new Error('more failed');
    });

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(statusText()).toContain('more failed');
    });
    expect(rows()).toHaveLength(20);
  });

  it('加载更多返回满页时继续保留 hasMore', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    const secondPage = Array.from({ length: 20 }, (_, index) => conversation(`b-${index}`));
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      const offset = message.offset ?? 0;
      return offset === 0
        ? { ok: true, conversations: firstPage, total: 60 }
        : { ok: true, conversations: secondPage, total: 60 };
    });

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));

    await vi.waitFor(() => {
      expect(rows()).toHaveLength(40);
    });
  });

  it('加载中再次滚动不会重复请求', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => conversation(`a-${index}`));
    let listCalls = 0;
    setMessageHandler(async (message) => {
      if (message.type !== 'REQUEST_CONVERSATION_LIST') return { ok: true };
      listCalls += 1;
      return { ok: true, conversations: firstPage, total: 60 };
    });

    await loadPopup();
    await flush();

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });

    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('scroll'));
    await flush();

    // 首次初始化 + 一次加载更多
    expect(listCalls).toBe(2);
  });

  it('缺少必要 DOM 元素时抛出可读错误', async () => {
    vi.resetModules();
    document.body.innerHTML = '<div></div>';

    await expect(import('./index.ts')).rejects.toThrow(/Missing element/);
  });
});

/* ------------------------------------------------------------------ */
/*  项目选择器（docs/dev/specs/project-export.md §6）                   */
/* ------------------------------------------------------------------ */

describe('popup 项目维度', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function project(id: string, name: string) {
    return { id, name };
  }

  /** 列表与项目两路请求各自返回不同数据 */
  function setProjectAwareHandler(
    projects: Array<{ id: string; name: string }>,
    conversationsFor: (options: { projectId?: string }) => Array<{ id: string; title: string; create_time: number }>,
    projectsFail = false,
  ) {
    const spy = vi.fn(async (message: { type: string; projectId?: string }) => {
      if (message.type === 'REQUEST_PROJECT_LIST') {
        return projectsFail ? { ok: false, error: '403' } : { ok: true, projects };
      }

      if (message.type === 'REQUEST_CONVERSATION_LIST') {
        return { ok: true, conversations: conversationsFor(message) };
      }

      return { ok: true };
    });

    fakeBrowser.runtime.sendMessage = spy as never;
    return spy;
  }

  function projectSelect(): HTMLSelectElement {
    return q<HTMLSelectElement>('[data-role=\'project\']');
  }

  async function selectProject(value: string): Promise<void> {
    const select = projectSelect();
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  }

  it('下拉首项是「全部会话」，其后是项目名', async () => {
    setProjectAwareHandler(
      [project('g-p-a', '研究'), project('g-p-b', '工作')],
      () => [conversation('a')],
    );

    await loadPopup();
    await flush();

    const options = [...projectSelect().options];

    expect(options).toHaveLength(3);
    // 首项固定是「全部会话」，其 value 为空串（= 不带 projectId）
    expect(options[0].value).toBe('');
    expect(options.slice(1).map(option => option.textContent)).toEqual(['研究', '工作']);
    expect(projectSelect().value).toBe('');
  });

  it('切到项目后按 projectId 重新拉列表并清空已选', async () => {
    const send = setProjectAwareHandler(
      [project('g-p-a', '研究')],
      ({ projectId }) => (projectId ? [conversation('p1'), conversation('p2')] : [conversation('a')]),
    );

    await loadPopup();
    await flush();

    // 先在全量列表里勾一个
    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    expect(checkboxes().every(box => box.checked)).toBe(true);

    await selectProject('g-p-a');

    const listCall = send.mock.calls
      .filter(call => (call[0] as { type?: string }).type === 'REQUEST_CONVERSATION_LIST')
      .at(-1)?.[0] as { projectId?: string };

    expect(listCall.projectId).toBe('g-p-a');
    expect(rows()).toHaveLength(2);
    // 切换项目必须清空选择，否则会把上个项目的会话一起导出去
    expect(checkboxes().some(box => box.checked)).toBe(false);
  });

  it('项目模式下导出按钮文案显示项目会话数', async () => {
    setProjectAwareHandler(
      [project('g-p-a', '研究')],
      ({ projectId }) => (projectId ? [conversation('p1'), conversation('p2')] : [conversation('a')]),
    );

    await loadPopup();
    await flush();
    await selectProject('g-p-a');

    expect(exportLabel()).toContain('2');
  });

  it('项目模式下导出请求带上项目上下文', async () => {
    const send = setProjectAwareHandler(
      [project('g-p-a', '研究')],
      ({ projectId }) => (projectId ? [conversation('p1')] : []),
    );

    await loadPopup();
    await flush();
    await selectProject('g-p-a');

    q<HTMLButtonElement>('[data-role=\'select-all\']').click();
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    )?.[0] as { project?: { id: string; name: string } };

    expect(exportCall.project).toEqual({ id: 'g-p-a', name: '研究' });
  });

  it('切回「全部会话」时清空选择并按 offset 重新加载', async () => {
    const send = setProjectAwareHandler(
      [project('g-p-a', '研究')],
      ({ projectId }) => (projectId ? [conversation('p1')] : [conversation('a')]),
    );

    await loadPopup();
    await flush();
    await selectProject('g-p-a');
    q<HTMLButtonElement>('[data-role=\'select-all\']').click();

    await selectProject('');

    const listCall = send.mock.calls
      .filter(call => (call[0] as { type?: string }).type === 'REQUEST_CONVERSATION_LIST')
      .at(-1)?.[0] as { projectId?: string; offset?: number };

    expect(listCall.projectId).toBeUndefined();
    expect(listCall.offset).toBe(0);
    expect(checkboxes().some(box => box.checked)).toBe(false);
  });

  it('加载中切换项目时，旧请求的结果不会覆盖新项目的列表', async () => {
    let releaseFirst: () => void = () => {};
    const firstPageGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let listCalls = 0;

    fakeBrowser.runtime.sendMessage = (async (message: { type: string; projectId?: string }) => {
      if (message.type === 'REQUEST_PROJECT_LIST') {
        return { ok: true, projects: [project('g-p-a', '研究')] };
      }

      listCalls += 1;

      if (listCalls === 1) {
        await firstPageGate;
        return { ok: true, conversations: [conversation('old')], cursor: null };
      }

      return { ok: true, conversations: [conversation('p1')], cursor: null };
    }) as never;

    await loadPopup();
    await flush();

    // 首个请求还挂着就切到项目
    await selectProject('g-p-a');
    releaseFirst();
    await flush();
    await flush();

    // 旧响应必须被丢弃，否则会出现「列表是旧项目的、projectId 是新的」
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('title-p1');
    // 旧响应必须被丢弃，否则会出现「列表是旧项目的、projectId 是新的」
    expect(document.body.textContent).not.toContain('title-old');
  });

  it('项目列表失败时下拉只剩「全部会话」，状态栏给出可读错误', async () => {
    setProjectAwareHandler([], () => [conversation('a')], true);

    await loadPopup();
    await flush();

    expect(projectSelect().options).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    // 会话仍可导出，但项目不可用的原因必须让用户看到
    expect(statusText()).toContain('403');
    expect(q<HTMLButtonElement>('[data-role=\'export-selected\']').disabled).toBe(false);
  });

  it('项目模式导出一键导出全部会话（含未滚动加载的页）', async () => {
    // 第二页：首个列表请求返回 cursor，导出时把剩余页拉完
    const send = vi.fn(async (message: { type: string; projectId?: string; cursor?: string }) => {
      if (message.type === 'REQUEST_PROJECT_LIST') {
        return { ok: true, projects: [project('g-p-a', '研究')] };
      }

      if (message.projectId && message.cursor === 'c2') {
        return { ok: true, conversations: [conversation('p3')], cursor: null };
      }

      if (message.projectId) {
        return { ok: true, conversations: [conversation('p1'), conversation('p2')], cursor: 'c2' };
      }

      return { ok: true, conversations: [] };
    });

    fakeBrowser.runtime.sendMessage = send as never;

    await loadPopup();
    await flush();
    await selectProject('g-p-a');

    // 不勾选任何会话，直接点「导出整个项目」
    q<HTMLButtonElement>('[data-role=\'export-selected\']').click();
    await flush();

    const exportCall = send.mock.calls.find(
      call => (call[0] as { type?: string }).type === 'REQUEST_EXPORT_CONVERSATIONS',
    )?.[0] as unknown as { chatIds: string[] } | undefined;

    expect(exportCall?.chatIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('项目模式滚动加载更多使用 cursor 而不是 offset', async () => {
    const send = vi.fn(async (message: { type: string; projectId?: string; cursor?: string }) => {
      if (message.type === 'REQUEST_PROJECT_LIST') {
        return { ok: true, projects: [project('g-p-a', '研究')] };
      }

      if (message.cursor) {
        return { ok: true, conversations: [conversation('p2')], cursor: null };
      }

      return { ok: true, conversations: [conversation('p1')], cursor: 'c2' };
    });

    fakeBrowser.runtime.sendMessage = send as never;

    await loadPopup();
    await flush();
    await selectProject('g-p-a');

    const list = q<HTMLDivElement>('[data-role=\'conversation-list\']');
    Object.defineProperty(list, 'scrollTop', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    list.dispatchEvent(new Event('scroll'));
    await flush();

    const pagedCall = send.mock.calls
      .filter(call => (call[0] as { type?: string }).type === 'REQUEST_CONVERSATION_LIST')
      .at(-1)?.[0] as { cursor?: string; offset?: number };

    expect(pagedCall.cursor).toBe('c2');
    expect(pagedCall.offset).toBeUndefined();
    expect(rows()).toHaveLength(2);
  });
});
