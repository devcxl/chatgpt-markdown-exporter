import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountCurrentExportButton } from './current-export-button.ts';

/* 页面头部按钮由 ChatGPT 前端动态渲染，可能晚于 content script 执行，
 * 因此重点是：挂载、重复挂载去重、头部重建后重新挂载、点击回调。
 * 新版头部结构由 mountAppShellHeader 模拟（取自真实页面）。 */

const BUTTON_ID = 'cgpt-export-current-button';
const BUTTON_STYLE_ID = 'cgpt-export-current-button-style';

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

/** 新版应用外壳头部，返回「分享 / 更多」按钮所在的 .gap-toolbar-action */
function mountAppShellHeader(): HTMLElement {
  const titlebar = document.createElement('div');
  titlebar.dataset.appShellMainTitlebar = 'true';

  const obstacle = document.createElement('div');
  obstacle.dataset.appShellHeaderObstacle = 'true';

  const pointerEvents = document.createElement('div');
  pointerEvents.className = 'pointer-events-auto';

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-toolbar-action';

  pointerEvents.appendChild(actions);
  obstacle.appendChild(pointerEvents);
  titlebar.appendChild(obstacle);
  document.body.appendChild(titlebar);

  return actions;
}

/** 旧版对话头部（灰度期兜底路径） */
function mountLegacyHeader(): HTMLElement {
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
    document.getElementById(BUTTON_STYLE_ID)?.remove();
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

  it('把按钮挂载到新版头部可点击的按钮组', async () => {
    const actions = mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()?.parentElement).toBe(actions);
    // 标题栏本身 pointer-events: none，必须位于 pointer-events-auto 内才可点击
    expect(actions.closest('.pointer-events-auto')).toBeTruthy();
  });

  it('新版头部缺失时挂载到旧版头部', async () => {
    const header = mountLegacyHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()?.parentElement).toBe(header);
  });

  it('新旧头部同时存在时优先新版', async () => {
    mountLegacyHeader();
    const actions = mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()?.parentElement).toBe(actions);
  });

  it('头部尚未渲染时不抛错，也不产生游离按钮', () => {
    expect(() => mountCurrentExportButton(() => {})).not.toThrow();
    expect(document.body.contains(button())).toBe(false);
  });

  it('重复挂载不创建第二个按钮', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it('注入了自包含按钮样式', () => {
    mountCurrentExportButton(() => {});

    const style = document.getElementById(BUTTON_STYLE_ID)?.textContent ?? '';

    expect(style).toContain(`#${BUTTON_ID}`);
    // 标题栏 pointer-events: none，样式里必须显式放开，避免按钮不可点击
    expect(style).toContain('pointer-events: auto');
  });

  it('点击按钮触发导出回调', async () => {
    mountAppShellHeader();
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
    mountAppShellHeader();
    const onExport = vi.fn();
    mountCurrentExportButton(onExport);
    await Promise.resolve();

    button()?.click();

    expect(onExport).not.toHaveBeenCalled();
  });

  it('头部被整体替换后按钮重新挂载', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    // ChatGPT 重建头部
    document.body.innerHTML = '';
    const actions = mountAppShellHeader();

    await vi.waitFor(() => {
      expect(button()?.parentElement).toBe(actions);
    });
  });

  it('按钮带可访问名称', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await Promise.resolve();

    expect(button()?.getAttribute('aria-label')).toBeTruthy();
    expect(button()?.textContent?.trim()).not.toBe('');
  });
});
