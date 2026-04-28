const HEADER_ACTIONS_SELECTOR = '#conversation-header-actions';
const CURRENT_EXPORT_BUTTON_ID = 'cgpt-export-current-button';

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

  attachToHeader(button);
  observeHeader(button);
}

function createButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = CURRENT_EXPORT_BUTTON_ID;
  button.type = 'button';
  button.className = 'btn relative group-focus-within/dialog:focus-visible:[outline-width:1.5px] group-focus-within/dialog:focus-visible:[outline-offset:2.5px] group-focus-within/dialog:focus-visible:[outline-style:solid] group-focus-within/dialog:focus-visible:[outline-color:var(--text-primary)] btn-ghost text-token-text-primary hover:bg-token-surface-hover keyboard-focused:bg-token-surface-hover rounded-lg max-sm:hidden';
  button.setAttribute('aria-label', '导出当前会话 Markdown');
  button.innerHTML = `
    <div class="flex w-full items-center justify-center gap-1.5">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-label="" class="-ms-0.5 icon" viewBox="0 0 20 20" fill="none">
        <path d="M10 3v8m0 0 3-3m-3 3-3-3M4.75 13.75v1.5A1.75 1.75 0 0 0 6.5 17h7A1.75 1.75 0 0 0 15.25 15.25v-1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      导出
    </div>
  `;
  return button;
}

function attachToHeader(button: HTMLButtonElement): void {
  const actions = document.querySelector<HTMLElement>(HEADER_ACTIONS_SELECTOR);

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
