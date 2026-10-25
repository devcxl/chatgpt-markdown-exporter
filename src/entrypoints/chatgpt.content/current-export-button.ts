import { t } from '../../i18n';

/* 导出按钮的挂载策略。
 *
 * ChatGPT 的应用外壳头部把按钮组渲染成两层，两层同处一个网格单元（grid-column/row
 * 都是 1）里叠放：
 *
 *   [data-app-shell-header-obstacle]        ← display: grid
 *   ├── div.invisible ...                   ← 隐藏的「测量层」，给 View Transitions 做快照
 *   │   └── [data-app-shell-header-slot-content] .gap-toolbar-action
 *   └── div.relative ...                    ← 可见层
 *       └── [data-app-shell-header-slot-content] .gap-toolbar-action
 *
 * 但页面里有多个 obstacle，左侧边栏也有同样的 slot-content 结构（详见
 * TOOLBAR_OBSTACLE_SELECTOR 处的真实尺寸说明）。因此定位分三级：
 *   1. 右侧「更多 / 分享」工具栏 —— 唯一的正确挂载点
 *   2. 旧版对话头部 #conversation-header-actions（灰度期兜底）
 *   3. 浮层：按 header 几何位置 fixed 定位，不寄生在宿主 DOM 里
 *      —— 连 header 都定位不到时贴右上角，保证功能永不消失
 *
 * 第 3 级是「契约」而非「尽力而为」：无论 OpenAI 怎么重构头部，
 * 用户至少还能点击导出。 */

const CURRENT_EXPORT_BUTTON_ID = 'cgpt-export-current-button';
const CURRENT_EXPORT_BUTTON_STYLE_ID = 'cgpt-export-current-button-style';
const CURRENT_EXPORT_FALLBACK_ATTR = 'data-cgpt-export-fallback';

/* 挂载点：右侧「更多 … 分享」工具栏。
 *
 * 2026-10 真机（Chrome 155，chatgpt.com/c/...）实测头部有 3 个 obstacle：
 *
 *   obstacle[0] 左侧边栏  [0,0,340,52]   含 data-app-shell-header-slot-content
 *   obstacle[1] 右侧工具栏 [772,8,266,36] 只含 class ms-auto + gap-toolbar-action
 *   obstacle[2] 空壳     [1046,0,0,52]   含 data-app-shell-header-slot-content
 *
 * 旧实现按 obstacle+slot-content 取「第一个可见的」，永远命中左侧边栏，
 * 按钮被侧边栏 logo 完全盖住（elementsFromPoint 只命中 logo 的 svg），
 * 视觉上就表现为「右上角只有分享，没有导出」。真实 DOM 里其实已经挂上了。
 *
 * 而且右侧工具栏根本没有 slot-content 属性 —— 它和左侧边栏是两个不同的
 * 组件。所以定位必须换个语义：找「带 ms-auto 且自身就是 gap-toolbar-action
 * 容器」的那个 obstacle，它才是「更多 / 分享」所在的右侧按钮带。
 *
 * 不用中英文 aria-label（如「分享」）做锚点：那会随界面语言失效。
 * ms-auto 是布局意图（把这组推到右边），gap-toolbar-action 是按钮带语义。 */
const TOOLBAR_OBSTACLE_SELECTOR = '[data-app-shell-header-obstacle="true"]';
const TOOLBAR_LAYOUT_CLASS = 'ms-auto';
const TOOLBAR_GROUP_CLASS = 'gap-toolbar-action';

/* 旧版对话头部（灰度期兜底路径） */
const LEGACY_HEADER_SELECTOR = '#conversation-header-actions';
const TITLEBAR_SELECTOR = 'header, [data-app-shell-main-titlebar], [data-app-shell-titlebar="true"]';

/* 浮层与宿主元素之间需要保留的最小间隙，以及找不到空洞时贴在 header 下方的边距 */
const FALLBACK_GAP = 8;
const FALLBACK_TOP_FALLBACK = 8;

/* 参与「避让计算」的交互元素。范围收窄到 header 内部即可：真机实测 header 内
 * 只有约 9 个交互元素（全文档 142 个），连同几何读取的代价可以忽略。 */
const HEADER_INTERACTIVE_SELECTOR = 'button, a[href], [role="button"], input, select, textarea';

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

/* checkVisibility 的选项名在实现史上换过两轮，必须同时传两套名字：
 *
 *   Chrome 105+ / Firefox 106-121   checkOpacity / checkVisibilityCSS
 *   Chrome 121+ / Firefox 122+      opacityProperty / visibilityProperty
 *
 * 字典里未定义的成员会被静默忽略，所以两套一起传对两边都正确。
 * 只传新名字是 2026-10 的真实故障：Firefox 106-121 会忽略 visibilityProperty，
 * 只剩 opacity 检查生效，于是「visibility: hidden 的测量层」被判定为可见，
 * 按钮又挂回隐藏层 —— Chrome 因为 105 就支持新名字而不受影响。 */
const CHECK_VISIBILITY_OPTIONS = {
  opacityProperty: true,
  visibilityProperty: true,
  checkOpacity: true,
  checkVisibilityCSS: true,
} as const;

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
    return element.checkVisibility(CHECK_VISIBILITY_OPTIONS);
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

/**
 * 找出右侧「更多 … 分享」工具栏：带 ms-auto 布局、自身即 gap-toolbar-action 容器、
 * 且真正可见的 obstacle。
 *
 * 真机实测该元素总有且仅有一个（对话页、首页、分享页均成立），
 * 但页面切换期间可能有多个候选，因此按「有按钮的优先」选出确定的那一个。
 */
export function findToolbarTarget(): HTMLElement | null {
  const candidates: HTMLElement[] = [];

  for (const obstacle of document.querySelectorAll<HTMLElement>(TOOLBAR_OBSTACLE_SELECTOR)) {
    const classes = obstacle.classList;

    if (!classes.contains(TOOLBAR_LAYOUT_CLASS) || !classes.contains(TOOLBAR_GROUP_CLASS)) {
      continue;
    }

    if (!isElementVisible(obstacle)) {
      continue;
    }

    candidates.push(obstacle);
  }

  if (candidates.length === 0) {
    return null;
  }

  // 含交互按钮的那个才是真实工具栏；空壳（宽度为 0）排在后面
  const withButtons = candidates.find(candidate => candidate.querySelector('button') !== null);

  return withButtons ?? candidates[0];
}

/**
 * 决定按钮挂到哪里：优先右侧「更多 / 分享」工具栏，其次旧版头部。
 * 都找不到时返回 null，由 attachTo 降级为浮层，保证功能不消失。
 */
function findMountTarget(): HTMLElement | null {
  const toolbar = findToolbarTarget();

  if (toolbar) {
    return toolbar;
  }

  const legacy = document.querySelector<HTMLElement>(LEGACY_HEADER_SELECTOR);

  if (legacy && isElementVisible(legacy)) {
    return legacy;
  }

  return null;
}

/**
 * 浮层定位。
 *
 * 不能简单地「贴右边缘」：真机实测 header 右侧从 x=1279 到 1545 被
 * 「更多 / 升级订阅 / 关闭升级提醒 / 分享」连续占满，右边界距视口只剩 8px，
 * 任何贴右定位都会压住「分享」按钮。
 *
 * 因此按 header 带内的真实占用区间做空洞检测，优先放到最靠右且放得下的空位；
 * 只有整条带都塞满时，才退到 header 下方（此时至少不遮挡 header 控件）。
 */
function positionFloating(button: HTMLElement): void {
  const header = document.querySelector<HTMLElement>(TITLEBAR_SELECTOR);
  const rect = header?.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const width = getButtonWidth(button);

  if (!header || !rect || rect.height <= 0 || viewportWidth <= 0) {
    // 拿不到 header 几何信息：贴视口右上角，保证功能可用
    button.style.top = `${FALLBACK_TOP_FALLBACK}px`;
    button.style.left = `${Math.max(viewportWidth - width - FALLBACK_GAP, 0)}px`;
    button.style.removeProperty('right');
    return;
  }

  const height = getButtonHeight(button);
  const centerTop = Math.round(rect.top + (rect.height - height) / 2);
  const occupied = collectHeaderOccupancy(header, button);
  const slot = findRightmostGap(occupied, rect.left, rect.right, width, FALLBACK_GAP);

  if (slot !== null) {
    // 带内有空位：垂直居中于 header
    button.style.top = `${Math.max(centerTop, 0)}px`;
    button.style.left = `${slot}px`;
    button.style.removeProperty('right');
    return;
  }

  // 整条带都塞满：退到 header 下方，避免遮挡任何 header 控件
  button.style.top = `${Math.round(rect.bottom + FALLBACK_GAP)}px`;
  button.style.left = `${Math.max(rect.right - width - FALLBACK_GAP, FALLBACK_GAP)}px`;
  button.style.removeProperty('right');
}

/* jsdom 与尚未完成布局时 offsetWidth 为 0，需要有兜底宽度才能参与空洞计算 */
function getButtonWidth(button: HTMLElement): number {
  return button.offsetWidth || 80;
}

function getButtonHeight(button: HTMLElement): number {
  return button.offsetHeight || 32;
}

/** 收集 header 带内交互元素的水平占用区间（已合并相邻区间） */
function collectHeaderOccupancy(
  header: HTMLElement,
  button: HTMLElement,
): Array<{ left: number; right: number }> {
  const intervals: Array<{ left: number; right: number }> = [];

  for (const element of header.querySelectorAll<HTMLElement>(HEADER_INTERACTIVE_SELECTOR)) {
    // 自己不参与避让，否则会把浮层从当前位置挤走
    if (element === button || button.contains(element) || element.contains(button)) {
      continue;
    }

    const rect = element.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) continue;
    if (!isElementVisible(element)) continue;

    intervals.push({ left: rect.left, right: rect.right });
  }

  intervals.sort((a, b) => a.left - b.left);

  const merged: Array<{ left: number; right: number }> = [];

  for (const interval of intervals) {
    const last = merged[merged.length - 1];

    if (last && interval.left <= last.right + FALLBACK_GAP) {
      last.right = Math.max(last.right, interval.right);
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

/**
 * 在 [minLeft, maxRight] 内找最靠右、宽度不小于 width 的空洞，返回其左边界坐标。
 * 放不下时返回 null。
 */
function findRightmostGap(
  occupied: Array<{ left: number; right: number }>,
  minLeft: number,
  maxRight: number,
  width: number,
  gap: number,
): number | null {
  let cursor = maxRight;

  // 从右往左扫描：第一个能放下 width 的空洞就是最靠右的选择
  for (let index = occupied.length - 1; index >= 0; index -= 1) {
    const interval = occupied[index];

    if (cursor - width >= interval.right + gap) {
      return Math.max(cursor - width, minLeft);
    }

    cursor = Math.min(cursor, interval.left - gap);
  }

  const leftmost = cursor - width;

  return leftmost >= minLeft ? leftmost : null;
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
      button.style.left = '';
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
  return attachTo(button, findMountTarget());
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
