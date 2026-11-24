import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountCurrentExportButton } from './current-export-button.ts';

/* 页内入口的契约（ADR 2026-11-24 / spec inline-entry-floating-button）：
 *
 * 按钮是一等浮层，直接挂在 body 下，不再寻找宿主头部的插入点。
 * 因此这里断言的全是与宿主 DOM 结构无关的不变量：
 * 位置、幂等、样式注入、点击语义，以及「不注册观察器」。
 *
 * 不要再写依赖 ChatGPT 头部结构（obstacle / slot-content / aria-label）的用例 ——
 * 那类锚点在 2026-11 已整体消失，围绕它们写的测试只会随页面改版腐烂。 */

const BUTTON_ID = 'cgpt-export-current-button';
const BUTTON_STYLE_ID = 'cgpt-export-current-button-style';

function button(): HTMLButtonElement | null {
  return document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
}

describe('mountCurrentExportButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById(BUTTON_STYLE_ID)?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('把按钮直接挂到 body 下', () => {
    mountCurrentExportButton(() => {});

    expect(button()).not.toBeNull();
    expect(button()?.id).toBe(BUTTON_ID);
    expect(button()?.parentElement).toBe(document.body);
  });

  it('按钮带可访问名称与可见文案', () => {
    mountCurrentExportButton(() => {});

    expect(button()?.getAttribute('aria-label')).toBeTruthy();
    expect(button()?.textContent?.trim()).not.toBe('');
  });

  it('重复挂载不创建第二个按钮', () => {
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});

    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it('注入唯一的自包含样式，并把按钮定位到右下角', () => {
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});

    const styles = document.querySelectorAll(`#${BUTTON_STYLE_ID}`);

    expect(styles).toHaveLength(1);
    expect(styles[0].parentElement).toBe(document.head);

    const css = styles[0].textContent ?? '';

    expect(css).toContain('position: fixed');
    // 只校验「用 px 钉在右下角」，不重复断言具体数值，避免与源码常量成为两处真相
    expect(css).toMatch(/right:\s*\d+px/);
    expect(css).toMatch(/bottom:\s*\d+px/);
  });

  it('样式节点被宿主清掉后，重新挂载会补注入', () => {
    mountCurrentExportButton(() => {});

    document.getElementById(BUTTON_STYLE_ID)?.remove();

    mountCurrentExportButton(() => {});

    expect(document.querySelectorAll(`#${BUTTON_STYLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it('不注册 MutationObserver（位置固定后无需收敛）', () => {
    const observed: MutationObserver[] = [];

    class RecordingObserver extends MutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observed.push(this);
      }
    }

    vi.stubGlobal('MutationObserver', RecordingObserver);

    mountCurrentExportButton(() => {});

    expect(observed).toHaveLength(0);
  });

  it('宿主 DOM 变化后按钮仍在 body 下、父节点不变', () => {
    mountCurrentExportButton(() => {});

    const element = button();

    // 模拟页面重建内容区：按钮不参与，也不应被搬走
    document.body.appendChild(document.createElement('header'));
    document.body.appendChild(document.createElement('main'));

    expect(element?.parentElement).toBe(document.body);
  });

  it('点击按钮触发导出回调', () => {
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

    expect(captured).toHaveLength(1);

    captured[0]({ isTrusted: true } as Event);

    expect(onExport).toHaveBeenCalledOnce();

    // 点击不应引发任何重排：按钮仍在 body 下，且没有产生第二个按钮
    expect(button()?.parentElement).toBe(document.body);
    expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
  });

  it('非用户触发的点击被忽略（isTrusted 为 false）', () => {
    const onExport = vi.fn();

    mountCurrentExportButton(onExport);
    button()?.click();

    expect(onExport).not.toHaveBeenCalled();
  });
});
