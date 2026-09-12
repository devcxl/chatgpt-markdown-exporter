import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountCurrentExportButton } from './current-export-button.ts';

/* 页面头部按钮由 ChatGPT 前端动态渲染，可能晚于 content script 执行，
 * 因此重点是：挂载、重复挂载去重、头部重建后重新挂载、点击回调。 */

const BUTTON_ID = 'cgpt-export-current-button';

/* mountCurrentExportButton 内部注册的 MutationObserver 不会 disconnect
 * （生产中每个页面只 mount 一次，无需清理）。测试里必须自行收集并断开，
 * 否则上一个用例的 observer 会把旧按钮重新挂回新头部。 */
let observers: MutationObserver[] = [];

function trackObservers(): void {
  const Native = globalThis.MutationObserver;

  class TrackedObserver extends Native {
    constructor(callback: MutationCallback) {
      super(callback);
      observers.push(this);
    }
  }

  vi.stubGlobal('MutationObserver', TrackedObserver);
}

function mountHeader(): HTMLElement {
  const header = document.createElement('div');
  header.id = 'conversation-header-actions';
  document.body.appendChild(header);
  return header;
}

function button(): HTMLButtonElement | null {
  return document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
}

describe('mountCurrentExportButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    observers = [];
    trackObservers();
  });

  afterEach(() => {
    for (const observer of observers) {
      observer.disconnect();
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('把按钮挂载到对话头部操作区', async () => {
    mountHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()).toBeTruthy();
    expect(button()?.parentElement?.id).toBe('conversation-header-actions');
  });

  it('头部尚未渲染时不抛错，也不产生游离按钮', () => {
    expect(() => mountCurrentExportButton(() => {})).not.toThrow();
    expect(document.body.contains(button())).toBe(false);
  });

  it('重复挂载不创建第二个按钮', async () => {
    mountHeader();
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it('点击按钮触发导出回调', async () => {
    mountHeader();
    const onExport = vi.fn();

    // jsdom 的 Event.isTrusted 是实例上不可配置的属性（恒为 false），
    // 无法用真实事件模拟，改为捕获注册的 click 监听器后以可信事件直接调用。
    const captured: Array<(event: Event) => void> = [];
    const originalAdd = HTMLButtonElement.prototype.addEventListener;

    vi.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(
      function (this: HTMLButtonElement, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
        if (type === 'click') captured.push(listener as (event: Event) => void);
        originalAdd.call(this, type, listener, options);
      },
    );

    mountCurrentExportButton(onExport);
    await Promise.resolve();

    expect(captured).toHaveLength(1);
    captured[0]({ isTrusted: true } as Event);

    expect(onExport).toHaveBeenCalledOnce();
  });

  it('非用户触发的点击被忽略（isTrusted 为 false）', async () => {
    mountHeader();
    const onExport = vi.fn();
    mountCurrentExportButton(onExport);
    await Promise.resolve();

    button()?.click();

    expect(onExport).not.toHaveBeenCalled();
  });

  it('头部被整体替换后按钮重新挂载', async () => {
    mountHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    // ChatGPT 重建头部
    document.body.innerHTML = '';
    mountHeader();

    await vi.waitFor(() => {
      expect(button()?.parentElement?.id).toBe('conversation-header-actions');
    });
  });

  it('按钮带可访问名称', async () => {
    mountHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()?.getAttribute('aria-label')).toBeTruthy();
    expect(button()?.textContent?.trim()).not.toBe('');
  });
});
