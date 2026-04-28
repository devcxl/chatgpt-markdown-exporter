import browser from 'webextension-polyfill';

interface ConversationItem {
  id: string;
  title: string;
  create_time: number;
  update_time?: number;
}

interface State {
  conversations: ConversationItem[];
  isLoading: boolean;
  isBusy: boolean;
  contentReady: boolean;
}

const state: State = {
  conversations: [],
  isLoading: false,
  isBusy: false,
  contentReady: false,
};

const statusEl = el<HTMLParagraphElement>('[data-role=\'status\']');
const listEl = el<HTMLDivElement>('[data-role=\'conversation-list\']');
const refreshBtn = el<HTMLButtonElement>('[data-role=\'refresh\']');
const selectAllBtn = el<HTMLButtonElement>('[data-role=\'select-all\']');
const clearSelectionBtn = el<HTMLButtonElement>('[data-role=\'clear-selection\']');
const exportBtn = el<HTMLButtonElement>('[data-role=\'export-selected\']');
const frontmatterInput = el<HTMLInputElement>('[data-role=\'frontmatter\']');
const timestampsInput = el<HTMLInputElement>('[data-role=\'timestamps\']');
const timestamp24hInput = el<HTMLInputElement>('[data-role=\'timestamp24h\']');

refreshBtn.addEventListener('click', () => {
  void loadConversations();
});
selectAllBtn.addEventListener('click', () => setAllSelections(true));
clearSelectionBtn.addEventListener('click', () => setAllSelections(false));
exportBtn.addEventListener('click', () => {
  void exportSelected();
});

void init();

async function init(): Promise<void> {
  setStatus('正在连接…');

  const result = await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' }) as {
    ok: boolean;
    error?: string;
    conversations?: ConversationItem[];
  };

  if (!result?.ok) {
    showError(result?.error ?? '连接失败，请确认当前在 ChatGPT 页面。');
    return;
  }

  state.contentReady = true;
  state.conversations = result.conversations ?? [];

  updateControls();
  render();

  if (state.conversations.length === 0) {
    setStatus('没有可导出的会话。', 'warning');
  }
  else {
    setStatus(`会话列表已加载，共 ${state.conversations.length} 条。`, 'success');
  }
}

async function loadConversations(): Promise<void> {
  if (state.isLoading) {
    return;
  }

  state.isLoading = true;
  state.conversations = [];
  updateControls();
  render();

  setStatus('正在加载会话列表…');

  try {
    const result = await browser.runtime.sendMessage({ type: 'REQUEST_CONVERSATION_LIST' }) as {
      ok: boolean;
      error?: string;
      conversations?: ConversationItem[];
    };

    if (!result?.ok) {
      setStatus(result?.error ?? '加载失败。', 'error');
      return;
    }

    state.conversations = result.conversations ?? [];

    if (state.conversations.length === 0) {
      setStatus('没有可导出的会话。', 'warning');
    }
    else {
      setStatus(`会话列表已加载，共 ${state.conversations.length} 条。`, 'success');
    }
  }
  catch (error) {
    setStatus(`加载失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  finally {
    state.isLoading = false;
    updateControls();
    render();
  }
}

async function exportSelected(): Promise<void> {
  if (state.isBusy) {
    return;
  }

  const selectedIds = getSelectedIds();

  if (selectedIds.length === 0) {
    setStatus('请先至少选择一个会话。', 'warning');
    return;
  }

  state.isBusy = true;
  updateControls();
  setStatus(`正在导出 ${selectedIds.length} 个会话…`);

  try {
    const result = await browser.runtime.sendMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: selectedIds,
      includeFrontmatter: frontmatterInput.checked,
      includeTimestamps: timestampsInput.checked,
      timestamp24h: timestamp24hInput.checked,
    }) as { ok: boolean; error?: string };

    if (result?.ok) {
      setStatus(`已导出 ${selectedIds.length} 个会话。`, 'success');
    }
    else {
      setStatus(result?.error ?? '导出失败。', 'error');
    }
  }
  catch (error) {
    setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
  finally {
    state.isBusy = false;
    updateControls();
  }
}

function setAllSelections(checked: boolean): void {
  for (const checkbox of listEl.querySelectorAll<HTMLInputElement>('input[type=\'checkbox\']')) {
    checkbox.checked = checked;
  }
}

function getSelectedIds(): string[] {
  return Array.from(
    listEl.querySelectorAll<HTMLInputElement>('input[type=\'checkbox\']:checked'),
  )
    .map(cb => cb.dataset.chatId)
    .filter((v): v is string => Boolean(v));
}

function render(): void {
  listEl.replaceChildren();

  if (state.isLoading && state.conversations.length === 0) {
    listEl.appendChild(createPlaceholder('正在加载会话列表…'));
    return;
  }

  if (state.conversations.length === 0) {
    listEl.appendChild(createPlaceholder('点击「加载 / 刷新」获取会话列表。'));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const conversation of state.conversations) {
    const row = document.createElement('label');
    row.className = 'conversation-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.chatId = conversation.id;

    const textWrap = document.createElement('span');
    textWrap.className = 'conversation-text';

    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = conversation.title || conversation.id;

    const meta = document.createElement('span');
    meta.className = 'conversation-meta';
    meta.textContent = formatDate(conversation.update_time ?? conversation.create_time);

    textWrap.append(title, meta);
    row.append(checkbox, textWrap);
    fragment.appendChild(row);
  }

  listEl.appendChild(fragment);
}

function updateControls(): void {
  const disabled = state.isBusy || !state.contentReady;

  refreshBtn.disabled = disabled || state.isLoading;
  selectAllBtn.disabled = disabled || state.conversations.length === 0;
  clearSelectionBtn.disabled = disabled || state.conversations.length === 0;
  exportBtn.disabled = disabled || state.conversations.length === 0;
}

function setStatus(text: string, tone: 'muted' | 'success' | 'warning' | 'error' = 'muted'): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function showError(text: string): void {
  const root = document.querySelector('.root');

  if (!root) {
    return;
  }

  root.innerHTML = `<div class="error-banner">${text}</div>`;
}

function createPlaceholder(text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.textContent = text;
  return div;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) {
    return '无时间信息';
  }

  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function el<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}
