import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mountCurrentExportButton,
  isElementVisible,
  isExternalMutation,
  reconcileButtonPosition,
} from './current-export-button.ts';

/* 页面头部按钮由 ChatGPT 前端动态渲染，可能晚于 content script 执行，
 * 因此重点是：挂载、重复挂载去重、头部重建后重新挂载、点击回调。
 *
 * 2026-10 回归：ChatGPT 把同一个按钮组渲染成「隐藏测量层 + 可见层」双层叠放，
 * 旧实现用首个匹配挂到了隐藏层。下面的 fixture 必须保持双层结构，
 * 否则这个回归不会被覆盖。 */

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

function createSlotContent(): HTMLElement {
  const content = document.createElement('div');
  content.dataset.appShellHeaderSlotContent = 'true';
  content.className = 'inline-flex h-full items-center gap-toolbar-action';
  return content;
}

/** 隐藏的「测量层」：与可见层同处一个网格单元，用于 View Transitions 快照 */
function mountHiddenMeasurementLayer(obstacle: HTMLElement): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pointer-events-none invisible col-start-1 row-start-1';

  // 真实页面靠 Tailwind 的 .invisible 生效，但 jsdom 不加载任何 CSS，
  // 只写 class 会让这一层在测试里仍然「可见」，回归就测不出来了。
  layer.style.visibility = 'hidden';
  layer.style.pointerEvents = 'none';

  const content = createSlotContent();
  layer.appendChild(content);
  obstacle.appendChild(layer);

  return content;
}

/** 可见层：真实可点击的那一层 */
function mountVisibleLayer(obstacle: HTMLElement): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pointer-events-none relative col-start-1 row-start-1';

  const content = createSlotContent();
  layer.appendChild(content);
  obstacle.appendChild(layer);

  return content;
}

/**
 * 复刻 2026-10 的真实头部：obstacle 是 grid，隐藏层在 DOM 顺序上排在可见层之前。
 * 隐藏层故意先插入，才能暴露「取首个匹配」的 bug。
 */
function mountAppShellHeader(): { hiddenSlot: HTMLElement; visibleSlot: HTMLElement } {
  const titlebar = document.createElement('div');
  titlebar.dataset.appShellMainTitlebar = 'true';

  const obstacle = document.createElement('div');
  obstacle.dataset.appShellHeaderObstacle = 'true';
  obstacle.style.display = 'grid';

  const hiddenSlot = mountHiddenMeasurementLayer(obstacle);
  const visibleSlot = mountVisibleLayer(obstacle);

  titlebar.appendChild(obstacle);
  document.body.appendChild(titlebar);

  return { hiddenSlot, visibleSlot };
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

/** 让挂载后的 microtask 收敛 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

  it('把按钮挂载到可见层，而不是前面的隐藏测量层', async () => {
    const { hiddenSlot, visibleSlot } = mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    expect(button()?.parentElement).toBe(visibleSlot);
    expect(button()?.parentElement).not.toBe(hiddenSlot);
  });

  it('挂载后按钮确实可见（回归：曾挂在 visibility: hidden 的祖先下）', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    expect(isElementVisible(button() as HTMLElement)).toBe(true);
  });

  it('只有隐藏层、没有可见层时降级为浮动按钮，不挂在隐藏层里', async () => {
    const titlebar = document.createElement('div');
    const obstacle = document.createElement('div');
    obstacle.dataset.appShellHeaderObstacle = 'true';

    const hiddenSlot = mountHiddenMeasurementLayer(obstacle);
    titlebar.appendChild(obstacle);
    document.body.appendChild(titlebar);

    mountCurrentExportButton(() => {});
    await settle();

    expect(button()?.parentElement).not.toBe(hiddenSlot);
    expect(button()?.parentElement).toBe(document.body);
    expect(button()?.getAttribute('data-cgpt-export-fallback')).toBe('true');
    expect(isElementVisible(button() as HTMLElement)).toBe(true);
  });

  it('浮动兜底时带上定位样式与水平位置', async () => {
    mountCurrentExportButton(() => {});
    await settle();

    const style = document.getElementById(BUTTON_STYLE_ID)?.textContent ?? '';

    expect(button()?.getAttribute('data-cgpt-export-fallback')).toBe('true');
    // 用 left 定位而非 right：right 无法表达「避开右侧按钮组」的落点
    expect(button()?.style.left).not.toBe('');
    expect(style).toContain('position: fixed');
  });

  it('可见层出现后，浮动按钮自动回到插槽并清除浮层样式', async () => {
    mountCurrentExportButton(() => {});
    await settle();
    expect(button()?.getAttribute('data-cgpt-export-fallback')).toBe('true');

    const { visibleSlot } = mountAppShellHeader();
    await vi.waitFor(() => {
      expect(button()?.parentElement).toBe(visibleSlot);
    });

    expect(button()?.hasAttribute('data-cgpt-export-fallback')).toBe(false);
    expect(button()?.style.top).toBe('');
    expect(button()?.style.right).toBe('');
  });

  it('新版头部缺失时挂载到旧版头部', async () => {
    const header = mountLegacyHeader();
    mountCurrentExportButton(() => {});
    await settle();

    expect(button()?.parentElement).toBe(header);
  });

  it('新旧头部同时存在时优先新版可见层', async () => {
    mountLegacyHeader();
    const { visibleSlot } = mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    expect(button()?.parentElement).toBe(visibleSlot);
  });

  it('头部尚未渲染时不抛错，按钮走浮动兜底而不是游离丢失', async () => {
    expect(() => mountCurrentExportButton(() => {})).not.toThrow();
    await settle();

    // L3 契约：任何情况下按钮都必须存在于文档中，且可点击
    expect(document.body.contains(button())).toBe(true);
    expect(isElementVisible(button() as HTMLElement)).toBe(true);
  });

  it('重复挂载不创建第二个按钮', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    mountCurrentExportButton(() => {});
    await settle();

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
    await settle();

    expect(captured).toHaveLength(1);
    captured[0]({ isTrusted: true } as Event);

    expect(onExport).toHaveBeenCalledOnce();
  });

  it('非用户触发的点击被忽略（isTrusted 为 false）', async () => {
    mountAppShellHeader();
    const onExport = vi.fn();
    mountCurrentExportButton(onExport);
    await settle();

    button()?.click();

    expect(onExport).not.toHaveBeenCalled();
  });

  it('头部被整体替换后按钮重新挂载到新的可见层', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    // ChatGPT 重建头部
    document.body.innerHTML = '';
    const { visibleSlot } = mountAppShellHeader();

    await vi.waitFor(() => {
      expect(button()?.parentElement).toBe(visibleSlot);
    });
  });

  it('按钮带可访问名称', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    expect(button()?.getAttribute('aria-label')).toBeTruthy();
    expect(button()?.textContent?.trim()).not.toBe('');
  });
});

describe('reconcileButtonPosition', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    observers = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('幂等：已经位于最优点时不再移动', async () => {
    const { visibleSlot } = mountAppShellHeader();
    const element = document.createElement('button');

    const first = reconcileButtonPosition(element);
    const second = reconcileButtonPosition(element);

    expect(first).toEqual({ target: 'slot', moved: true });
    expect(second).toEqual({ target: 'slot', moved: false });
    expect(element.parentElement).toBe(visibleSlot);
  });

  it('宿主反复抖动时不会产生自激移动', async () => {
    mountAppShellHeader();
    mountCurrentExportButton(() => {});
    await settle();

    const element = button() as HTMLButtonElement;

    // 收敛之后，连续重复收敛都不应再移动按钮
    const results = Array.from({ length: 5 }, () => reconcileButtonPosition(element));

    expect(results.every(result => result.moved === false)).toBe(true);
  });
});

describe('isElementVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('普通元素可见', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);

    expect(isElementVisible(element)).toBe(true);
  });

  it('祖先 visibility: hidden 时判定为不可见', () => {
    const hidden = document.createElement('div');
    hidden.style.visibility = 'hidden';

    const child = document.createElement('div');
    hidden.appendChild(child);
    document.body.appendChild(hidden);

    expect(isElementVisible(child)).toBe(false);
  });

  it('display: none 判定为不可见', () => {
    const element = document.createElement('div');
    element.style.display = 'none';
    document.body.appendChild(element);

    expect(isElementVisible(element)).toBe(false);
  });

  /* 回归（2026-10，Firefox 专属）：checkVisibility 的选项名有两代。
   * 旧实现只传新名字 visibilityProperty/opacityProperty，而这两个名字
   * Firefox 122+ 才认；Firefox 106-121 只认 checkVisibilityCSS/checkOpacity，
   * 未识别的成员被静默忽略，结果只剩 opacity 检查，隐藏层被判为可见，
   * 按钮又挂回隐藏测量层。
   *
   * 下面的 stub 按 Gecko 的真实语义实现（只认一套名字），
   * 并断言两代参数名都被实际传入。 */
  describe('checkVisibility 选项名兼容两代实现', () => {
    type Options = Record<string, boolean>;

    /** 按指定代数实现 checkVisibility：只认该代的名字，其余忽略 */
    function stubCheckVisibility(
      element: Element,
      generation: 'legacy' | 'current',
      isHidden: boolean,
    ): Options[] {
      const received: Options[] = [];

      Object.defineProperty(element, 'checkVisibility', {
        configurable: true,
        value: (options: Options = {}) => {
          received.push(options);

          const checked = generation === 'legacy'
            ? options.checkVisibilityCSS === true
            : options.visibilityProperty === true;

          // 没开启 visibility 检查时无法发现 visibility: hidden
          return checked ? !isHidden : true;
        },
      });

      return received;
    }

    for (const generation of ['legacy', 'current'] as const) {
      it(`${generation} 代参数名下依然能识别隐藏层`, () => {
        const hidden = document.createElement('div');
        hidden.style.visibility = 'hidden';

        const child = document.createElement('div');
        hidden.appendChild(child);
        document.body.appendChild(hidden);

        const received = stubCheckVisibility(child, generation, true);

        expect(isElementVisible(child)).toBe(false);
        expect(received).toHaveLength(1);
        expect(received[0].checkVisibilityCSS ?? received[0].visibilityProperty).toBe(true);
      });
    }

    it('同一次调用里同时传入两代参数名（不允许只传新名字）', () => {
      const element = document.createElement('div');
      document.body.appendChild(element);

      const received = stubCheckVisibility(element, 'current', false);

      isElementVisible(element);

      expect(received[0]).toMatchObject({
        visibilityProperty: true,
        opacityProperty: true,
        checkVisibilityCSS: true,
        checkOpacity: true,
      });
    });
  });
});

describe('isExternalMutation', () => {
  it('自身移动按钮产生的变更被判定为内部变更', async () => {
    document.body.innerHTML = '';
    const target = document.createElement('div');
    const element = document.createElement('button');
    document.body.append(target, element);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(document.body, { childList: true });

    target.appendChild(element);
    await Promise.resolve();

    observer.disconnect();

    expect(records.length).toBeGreaterThan(0);
    expect(records.some(record => isExternalMutation(record, element))).toBe(false);
  });

  it('宿主新增其他节点时判定为外部变更', async () => {
    document.body.innerHTML = '';
    const element = document.createElement('button');
    document.body.appendChild(element);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(document.body, { childList: true });

    document.body.appendChild(document.createElement('span'));
    await Promise.resolve();

    observer.disconnect();

    expect(records.some(record => isExternalMutation(record, element))).toBe(true);
  });
});

/* jsdom 不做布局，getBoundingClientRect 恒为 0。浮层避让依赖真实几何，
 * 因此这里显式打桩，复刻真机量到的 header 占用：
 * 左侧按钮组 [5..332]，右侧 [1279..1545]（更多/升级/关闭/分享），视口 1553。 */
describe('浮层避让 header 控件', () => {
  const VIEWPORT_WIDTH = 1553;
  const HEADER_HEIGHT = 52;
  const BUTTON_WIDTH = 80;

  type StubRect = { left: number; top: number; width: number; height: number };

  function stubRect(element: Element, rect: StubRect): void {
    const r = {
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => r,
    } as DOMRect;

    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(r);
  }

  function overlaps(left: number, width: number, zone: { left: number; right: number }): boolean {
    return left < zone.right && left + width > zone.left;
  }

  /**
   * 推导浮层的实际水平左边界。
   *
   * 不能用 style.left 直接判断：旧实现用 right 定位，style.left 为空，
   * Number.parseFloat 会得到 NaN，紧接着的 overlaps(NaN, …) 恒为 false，
   * 测试就会在「按钮压住分享」时依然通过（本项目曾出现过的假阳性）。
   * 因此两种定位方式都必须能算出一个具体坐标。
   */
  function resolveFloatingLeft(element: HTMLElement): number {
    const fromLeft = Number.parseFloat(element.style.left);

    if (Number.isFinite(fromLeft)) {
      return fromLeft;
    }

    const fromRight = Number.parseFloat(element.style.right);

    if (Number.isFinite(fromRight)) {
      // right 定位等价于「视口右边缘减去右边距再减去自身宽度」
      return VIEWPORT_WIDTH - fromRight - BUTTON_WIDTH;
    }

    throw new Error(`浮层缺少可解析的水平定位：left="${element.style.left}" right="${element.style.right}"`);
  }

  function mountHeaderWithControls(): {
    header: HTMLElement;
    hiddenSlot: HTMLElement;
    share: HTMLElement;
    rightZone: { left: number; right: number };
    leftZone: { left: number; right: number };
  } {
    const header = document.createElement('header');

    // 左侧按钮组
    const leftZone = { left: 5, right: 332 };
    const left = document.createElement('button');
    header.appendChild(left);
    stubRect(left, { left: leftZone.left, top: 8, width: leftZone.right - leftZone.left, height: 36 });

    // 右侧连续占用：更多 / 升级 / 关闭 / 分享
    const rightZone = { left: 1279, right: 1545 };
    const share = document.createElement('button');
    share.setAttribute('aria-label', '分享');
    header.appendChild(share);
    stubRect(share, { left: 1467, top: 8, width: 78, height: 36 });

    const more = document.createElement('button');
    header.appendChild(more);
    stubRect(more, { left: rightZone.left, top: 8, width: 104, height: 36 });

    // 只保留隐藏层 —— 强制走浮层兜底
    const obstacle = document.createElement('div');
    obstacle.dataset.appShellHeaderObstacle = 'true';
    const hiddenSlot = mountHiddenMeasurementLayer(obstacle);
    header.appendChild(obstacle);

    document.body.appendChild(header);
    stubRect(header, { left: 0, top: 0, width: VIEWPORT_WIDTH, height: HEADER_HEIGHT });

    return { header, hiddenSlot, share, rightZone, leftZone };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById(BUTTON_STYLE_ID)?.remove();
    observers = [];
    trackObservers();

    Object.defineProperty(window, 'innerWidth', {
      value: VIEWPORT_WIDTH,
      configurable: true,
      writable: true,
    });

    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(BUTTON_WIDTH);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32);
  });

  afterEach(() => {
    for (const observer of observers) {
      observer.disconnect();
    }

    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('浮层不遮挡右侧的「分享」按钮', async () => {
    const { rightZone } = mountHeaderWithControls();

    mountCurrentExportButton(() => {});
    await settle();

    const element = button() as HTMLButtonElement;

    expect(element.getAttribute('data-cgpt-export-fallback')).toBe('true');

    const left = resolveFloatingLeft(element);

    expect(overlaps(left, BUTTON_WIDTH, rightZone)).toBe(false);
  });

  it('浮层也不遮挡左侧按钮组', async () => {
    const { leftZone } = mountHeaderWithControls();

    mountCurrentExportButton(() => {});
    await settle();

    const element = button() as HTMLButtonElement;
    const left = resolveFloatingLeft(element);

    expect(overlaps(left, BUTTON_WIDTH, leftZone)).toBe(false);
  });

  it('带内有空位时落在 header 垂直中线附近', async () => {
    mountHeaderWithControls();

    mountCurrentExportButton(() => {});
    await settle();

    const element = button() as HTMLButtonElement;
    const top = Number.parseFloat(element.style.top);

    // header 高 52、按钮高 32 → 中线 (52-32)/2 = 10
    expect(top).toBe(10);
  });

  it('整条 header 塞满时退到 header 下方，而不是压在控件上', async () => {
    const header = document.createElement('header');

    // 从左到右完全占满，没有任何空洞
    const full = document.createElement('button');
    header.appendChild(full);
    stubRect(full, { left: 0, top: 0, width: VIEWPORT_WIDTH, height: HEADER_HEIGHT });

    const obstacle = document.createElement('div');
    obstacle.dataset.appShellHeaderObstacle = 'true';
    mountHiddenMeasurementLayer(obstacle);
    header.appendChild(obstacle);

    document.body.appendChild(header);
    stubRect(header, { left: 0, top: 0, width: VIEWPORT_WIDTH, height: HEADER_HEIGHT });

    mountCurrentExportButton(() => {});
    await settle();

    const element = button() as HTMLButtonElement;
    const top = Number.parseFloat(element.style.top);

    // header 底边 52 + 间隙 8 = 60
    expect(top).toBe(60);
  });
});
