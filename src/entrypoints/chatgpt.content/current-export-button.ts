import { t } from '../../i18n';

/* 导出按钮的挂载策略。
 *
 * 背景（2026-10 回归）：ChatGPT 的应用外壳头部把同一个按钮组渲染成两层，
 * 两层都放在同一网格单元（grid-column/row 都是 1）里叠放：
 *
 *   [data-app-shell-header-obstacle]        ← display: grid
 *   ├── div.invisible ...                   ← 隐藏的「测量层」，给 View Transitions 做快照
 *   │   └── [data-app-shell-header-slot-content] .gap-toolbar-action
 *   └── div.relative ...                    ← 可见层
 *       └── [data-app-shell-header-slot-content] .gap-toolbar-action
 *
 * 旧实现用 querySelector 取首个匹配，必然命中前面那个隐藏层，按钮挂上去后
 * visibility: hidden，表现为「按钮消失」。
 *
 * 因此这里不再假设「第一个匹配就是对的」，而是分两级降级：
 *   1. 原生插槽：候选里挑第一个真正可见的（尽力争取最佳观感）
 *   2. 浮动兜底：按 header 的几何位置 fixed 定位，不寄生在宿主 DOM 里
 *      —— 连 header 都定位不到时贴右上角，保证功能永不消失
 *
 * 第 2 级是「契约」而非「尽力而为」：无论 OpenAI 怎么重构头部，
 * 用户至少还能点击导出。 */

const CURRENT_EXPORT_BUTTON_ID = 'cgpt-export-current-button';
const CURRENT_EXPORT_BUTTON_STYLE_ID = 'cgpt-export-current-button-style';
const CURRENT_EXPORT_FALLBACK_ATTR = 'data-cgpt-export-fallback';

/* 语义属性优先：.gap-toolbar-action 只是样式类名，改版就可能消失；
 * data-app-shell-header-slot-content 描述的是「插槽内容」这一结构事实。 */
const SLOT_SELECTORS = [
  '[data-app-shell-header-obstacle="true"] [data-app-shell-header-slot-content="true"]',
  '[data-app-shell-header-slot-content="true"].gap-toolbar-action',
] as const;

const LEGACY_HEADER_SELECTOR = '#conversation-header-actions';
const TITLEBAR_SELECTOR = 'header, [data-app-shell-main-titlebar], [data-app-shell-titlebar="true"]';

/* 浮动兜底与原生插槽的间距预算：浮层需要避开右侧「分享/更多」按钮组 */
const FALLBACK_RIGHT_INSET = 12;
const FALLBACK_TOP_FALLBACK = 8;

/* 新版页面的按钮样式来自 CSS Modules，旧版工具类（btn-ghost、text-token-*）
 * 已失效，因此按钮样式自包含注入；颜色优先取宿主 CSS 变量，附带回退值。 */
const BUTTON_STYLES = `
#${CURRENT_EXPORT_BUTTON_ID} {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-toolbar-action, inherit);
  font-family: inherit;
  font-size: 14px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
}
#${CURRENT_EXPORT_BUTTON_ID}:hover {
  background: var(--color-primary-ghost-hover, rgba(128, 128, 128, 0.15));
}
#${CURRENT_EXPORT_BUTTON_ID}:focus-visible {
  outline: 2px solid var(--color-ring, currentColor);
  outline-offset: 1px;
}
#${CURRENT_EXPORT_BUTTON_ID} svg {
  flex: none;
}
/* 脱离宿主头部时的兜底外观：需要自己的背景，否则会与页面内容重叠 */
#${CURRENT_EXPORT_BUTTON_ID}[${CURRENT_EXPORT_FALLBACK_ATTR}="true"] {
  position: fixed;
  z-index: 2147483000;
  background: var(--color-surface-elevated, Canvas);
  border: 1px solid var(--color-border-light, rgba(128, 128, 128, 0.3));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
@media (max-width: 639px) {
  #${CURRENT_EXPORT_BUTTON_ID} {
    display: none;
  }
}
`;

export type MountTarget = 'slot' | 'floating';

export type MountResult = {
  target: MountTarget;
  /** 本次调用是否真的移动了按钮（观察器据此判断是否需要继续收敛） */
  moved: boolean;
};

/**
 * 元素是否真正可见。优先用 checkVisibility（能感知祖先链上的
 * visibility/display/content-visibility/opacity），不可用时回退到
 * 逐级向上检查 computedStyle。
 *
 * 生产环境（Chrome/Firefox 105+）都有 checkVisibility；
 * jsdom 没有实现，回退路径同时承担测试可覆盖的职责。
 */
export function isElementVisible(element: Element): boolean {
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true, checkOpacity: true });
  }

  return isVisibleByComputedStyle(element);
}

function isVisibleByComputedStyle(element: Element): boolean {
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const style = window.getComputedStyle(current);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.opacity !== '' && Number(style.opacity) === 0) return false;

    current = current.parentElement;
  }

  return true;
}

function findSlotTarget(): HTMLElement | null {
  for (const selector of SLOT_SELECTORS) {
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      if (isElementVisible(candidate)) {
        return candidate;
      }
    }
  }

  const legacy = document.querySelector<HTMLElement>(LEGACY_HEADER_SELECTOR);

  if (legacy && isElementVisible(legacy)) {
    return legacy;
  }

  return null;
}

/** 让浮层对齐 header 的垂直中线与右侧边界；拿不到 header 时贴右上角。 */
function positionFloating(button: HTMLElement): void {
  const header = document.querySelector<HTMLElement>(TITLEBAR_SELECTOR);
  const rect = header?.getBoundingClientRect();

  if (rect && rect.height > 0) {
    const top = Math.round(rect.top + (rect.height - button.offsetHeight) / 2);

    button.style.top = `${Math.max(top, 0)}px`;
    button.style.right = `${FALLBACK_RIGHT_INSET}px`;
    return;
  }

  button.style.top = `${FALLBACK_TOP_FALLBACK}px`;
  button.style.right = `${FALLBACK_RIGHT_INSET}px`;
}

function attachTo(button: HTMLButtonElement, target: HTMLElement | null): MountResult {
  if (target) {
    const moved = button.parentElement !== target;

    if (moved) {
      target.appendChild(button);
    }

    // 从浮层模式回到插槽模式时，必须清掉浮层的定位与外观
    if (button.hasAttribute(CURRENT_EXPORT_FALLBACK_ATTR)) {
      button.removeAttribute(CURRENT_EXPORT_FALLBACK_ATTR);
      button.style.top = '';
      button.style.right = '';
    }

    return { target: 'slot', moved };
  }

  // 兜底：不寄生在宿主头部里，而是固定在视口上，按 header 几何位置对齐
  const moved = button.parentElement !== document.body;

  if (moved) {
    document.body.appendChild(button);
  }

  button.setAttribute(CURRENT_EXPORT_FALLBACK_ATTR, 'true');
  positionFloating(button);

  return { target: 'floating', moved };
}

/** 幂等：把按钮收敛到当前最优落点。返回本次是否发生移动。 */
export function reconcileButtonPosition(button: HTMLButtonElement): MountResult {
  return attachTo(button, findSlotTarget());
}

export function mountCurrentExportButton(
  onExport: () => void,
): void {
  if (document.getElementById(CURRENT_EXPORT_BUTTON_ID)) {
    return;
  }

  const button = createButton();
  button.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }

    onExport();
  });

  injectButtonStyles();
  reconcileButtonPosition(button);
  observeHeader(button);
}

function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = CURRENT_EXPORT_BUTTON_ID;
  button.type = 'button';
  button.setAttribute('aria-label', t('panel.exportCurrentMd'));
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M10 3v8m0 0 3-3m-3 3-3-3M4.75 13.75v1.5A1.75 1.75 0 0 0 6.5 17h7A1.75 1.75 0 0 0 15.25 15.25v-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    ${t('common.export')}
  `;
  return button;
}

function injectButtonStyles(): void {
  const style = document.createElement('style');
  style.id = CURRENT_EXPORT_BUTTON_STYLE_ID;
  style.textContent = BUTTON_STYLES;
  document.head.appendChild(style);
}

/* 观察器只负责「头部重建后重新收敛」，必须满足两条不变量，否则会自激：
 *
 *   1. 忽略由我们自身移动按钮产生的变更 —— 否则 appendChild 触发 observer，
 *      observer 又 appendChild，形成死循环（2026-10 真机实测：1.5s 内 4 次变更，
 *      按钮被反复拽回隐藏层）。
 *   2. 用 microtask 合并同一轮内的多次变更，而不是每个 mutation 都跑一遍。 */
function observeHeader(button: HTMLButtonElement): void {
  let scheduled = false;

  const schedule = (): void => {
    if (scheduled) return;

    scheduled = true;

    queueMicrotask(() => {
      scheduled = false;

      // 页面可能已经在导航或测试环境已销毁；此时没有可收敛的 DOM
      if (typeof document === 'undefined') {
        return;
      }

      reconcileButtonPosition(button);
    });
  };

  const observer = new MutationObserver((records) => {
    if (records.some(record => isExternalMutation(record, button))) {
      schedule();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // 视图尺寸变化会让浮层位置失效（header 高度/宽度变了），需要重新对齐
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
}

/** 判断一条变更是否来自宿主页面，而非我们自己移动按钮造成。 */
export function isExternalMutation(record: MutationRecord, button: HTMLButtonElement): boolean {
  const touchesButton = (node: Node): boolean =>
    node === button || button.contains(node);

  for (const node of record.addedNodes) {
    if (!touchesButton(node)) return true;
  }

  for (const node of record.removedNodes) {
    if (!touchesButton(node)) return true;
  }

  return false;
}
