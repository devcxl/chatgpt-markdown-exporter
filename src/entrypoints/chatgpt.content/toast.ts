type ToastType = 'success' | 'error' | 'info';

const TOAST_STYLES: Record<ToastType, { bg: string; icon: string }> = {
  success: {
    bg: '#16a34a',
    icon: `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M16.25 6.25L8.75 13.75L3.75 8.75" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  error: {
    bg: '#dc2626',
    icon: `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 6.25V11.25M10 13.75H10.008" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z" stroke="white" stroke-width="1.5"/></svg>`,
  },
  info: {
    bg: '#2563eb',
    icon: `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 9.375V13.75M10 6.25H10.008" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z" stroke="white" stroke-width="1.5"/></svg>`,
  },
};

export function showToast(message: string, type: ToastType = 'info'): void {
  const container = ensureContainer();
  const style = TOAST_STYLES[type];
  const toast = document.createElement('div');
  const id = `cgpt-toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  toast.id = id;
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;background:${style.bg};color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.25);max-width:360px;word-break:break-word;">
      ${style.icon}
      <span>${escapeHtml(message)}</span>
    </div>
  `;

  toast.style.cssText = 'opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;pointer-events:none;';

  container.appendChild(toast);

  void toast.offsetHeight; // 触发 reflow
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';

    window.setTimeout(() => {
      toast.remove();
    }, 200);
  }, 3500);
}

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container && document.contains(container)) {
    return container;
  }

  container = document.createElement('div');
  container.id = 'cgpt-toast-container';
  container.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';

  document.body.appendChild(container);
  return container;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
