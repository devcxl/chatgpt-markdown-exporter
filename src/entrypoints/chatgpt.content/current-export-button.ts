import { t } from '../../i18n';

/* 页内「导出当前对话」入口。
 *
 * 契约（ADR 2026-11-24-inline-entry-floating-button）：按钮是**一等浮层**，
 * 直接挂在 document.body 下，不再寻找 ChatGPT 头部的插入点。
 *
 * 历史：这一处曾按 `[data-app-shell-header-obstacle]` 与 `#conversation-header-actions`
 * 做三级挂载（插槽 → 旧版头部 → 浮层），并在 2026-09、2026-10 各因改版修一次。
 * 2026-11-24 实测发现两级锚点同时归零，按钮一直在走浮层兜底 —— 也就是说
 * 寄宿策略的全部代码在生产里都是死路径，还带着一个 MutationObserver。
 * 因此整体删除，只保留浮层这一种形态：位置固定，不随宿主结构变化。
 *
 * 不再需要的东西（有意不留兼容层）：锚点常量、findToolbarTarget、几何避让、
 * 观察器、浮层标记属性。它们没有消费者，留着只会腐化。 */

const CURRENT_EXPORT_BUTTON_ID = 'cgpt-export-current-button';
const CURRENT_EXPORT_BUTTON_STYLE_ID = 'cgpt-export-current-button-style';

/* 浮层与宿主内容之间保留的边距。右下角是对话页相对空闲的区域：
 * composer 居中、右侧没有常驻控件，比早年试过的右上角安全得多。 */
const FLOATING_OFFSET = 16;

/* 样式自包含注入：新版页面的按钮样式来自 CSS Modules，旧版工具类
 * （btn-ghost、text-token-*）已失效。颜色优先取宿主 CSS 变量，附带回退值；
 * 因为脱离宿主布局，背景与投影必须自带，否则会与正文叠在一起。 */
const BUTTON_STYLES = `
#${CURRENT_EXPORT_BUTTON_ID} {
  position: fixed;
  right: ${FLOATING_OFFSET}px;
  bottom: ${FLOATING_OFFSET}px;
  z-index: 2147483000;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--color-border-light, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: var(--color-surface-elevated, Canvas);
  color: var(--color-text-toolbar-action, inherit);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  font-family: inherit;
  font-size: 14px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
}
#${CURRENT_EXPORT_BUTTON_ID}:hover {
  /* 浮层悬停不能用半透明底色：正文会透出来。改为在自带底色上叠一层淡色渐变，
     保持surface 不透明的同时给出悬停反馈。 */
  background-image: linear-gradient(
    var(--color-primary-ghost-hover, rgba(128, 128, 128, 0.15)),
    var(--color-primary-ghost-hover, rgba(128, 128, 128, 0.15))
  );
}
#${CURRENT_EXPORT_BUTTON_ID}:focus-visible {
  outline: 2px solid var(--color-ring, currentColor);
  outline-offset: 1px;
}
#${CURRENT_EXPORT_BUTTON_ID} svg {
  flex: none;
}
@media (max-width: 639px) {
  #${CURRENT_EXPORT_BUTTON_ID} {
    display: none;
  }
}
`;

/**
 * 挂载页内导出按钮。幂等：已存在则不再重复创建，样式缺失时补注入。
 *
 * 样式与按钮分开校验：宿主重置 head（或开发期 HMR）可能只丢样式，
 * 此时按钮仍在，只查按钮会导致按钮"裸奔"成无定位的默认按钮。
 *
 * 页面内的 SPA 路由切换不会重建 body，按钮因此天然跨页面存活，
 * 既不需要观察器，也不需要重新收敛。
 */
export function mountCurrentExportButton(
  onExport: () => void,
): void {
  injectButtonStyles();

  if (document.getElementById(CURRENT_EXPORT_BUTTON_ID)) {
    return;
  }

  const button = createButton();
  button.addEventListener('click', (event) => {
    // 只接受用户真实点击，忽略脚本派发的合成事件
    if (!event.isTrusted) {
      return;
    }

    onExport();
  });

  document.body.appendChild(button);
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
  if (document.getElementById(CURRENT_EXPORT_BUTTON_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = CURRENT_EXPORT_BUTTON_STYLE_ID;
  style.textContent = BUTTON_STYLES;
  document.head.appendChild(style);
}
