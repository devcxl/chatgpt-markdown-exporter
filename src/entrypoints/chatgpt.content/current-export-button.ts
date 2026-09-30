import { t } from '../../i18n';

/* 新版应用外壳头部：
 * [data-app-shell-main-titlebar] 整条标题栏是 pointer-events: none，
 * 只有 [data-app-shell-header-obstacle] 下 .pointer-events-auto 内的
 * .gap-toolbar-action 才是「分享 / 更多」按钮组，按钮挂到这里才可点击。
 * 旧版 #conversation-header-actions 在灰度期仍可能存在，作为兜底保留，
 * 待旧版结构完全下线后可删除。 */
const HEADER_ACTIONS_SELECTORS = [
  '[data-app-shell-header-obstacle="true"] .gap-toolbar-action',
  '#conversation-header-actions',
];

const CURRENT_EXPORT_BUTTON_ID = 'cgpt-export-current-button';
const CURRENT_EXPORT_BUTTON_STYLE_ID = 'cgpt-export-current-button-style';

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
@media (max-width: 639px) {
  #${CURRENT_EXPORT_BUTTON_ID} {
    display: none;
  }
}
`;

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
  attachToHeader(button);
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

function findHeaderActions(): HTMLElement | null {
  for (const selector of HEADER_ACTIONS_SELECTORS) {
    const actions = document.querySelector<HTMLElement>(selector);

    if (actions) {
      return actions;
    }
  }

  return null;
}

function attachToHeader(button: HTMLButtonElement): void {
  const actions = findHeaderActions();

  if (!actions) {
    return;
  }

  if (button.parentElement !== actions) {
    actions.appendChild(button);
  }
}

function observeHeader(button: HTMLButtonElement): void {
  const observer = new MutationObserver(() => {
    attachToHeader(button);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.setTimeout(() => {
    attachToHeader(button);
  }, 0);
}
