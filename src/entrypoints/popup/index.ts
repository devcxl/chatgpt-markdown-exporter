import { t, i18nPopulate, getDateLocale } from '../../i18n';
import type { Project } from '../../shared/chatgpt-types';
import type { ConversationListResponse } from '../../shared/messages';

interface ConversationItem {
  id: string;
  title: string;
  create_time: number;
  update_time?: number;
}

interface State {
  conversations: ConversationItem[];
  projects: Project[];
  /** '' = 全部会话 */
  selectedProjectId: string;
  /** 项目模式下的翻页游标；null = 没有更多 */
  cursor: string | null;
  /** 项目列表加载失败时的可读错误；不影响批量导出 */
  projectsError: string;
  selectedIds: Set<string>;
  isLoading: boolean;
  isBusy: boolean;
  contentReady: boolean;
  hasMore: boolean;
}

const state: State = {
  conversations: [],
  projects: [],
  selectedProjectId: '',
  cursor: null,
  projectsError: '',
  selectedIds: new Set(),
  isLoading: false,
  isBusy: false,
  contentReady: false,
  hasMore: true,
};

const statusEl = el<HTMLParagraphElement>('[data-role=\'status\']');
const listEl = el<HTMLDivElement>('[data-role=\'conversation-list\']');
const refreshBtn = el<HTMLButtonElement>('[data-role=\'refresh\']');
const sectionTitleEl = el<HTMLSpanElement>('[data-role=\'section-title\']');
const selectAllBtn = el<HTMLButtonElement>('[data-role=\'select-all\']');
const clearSelectionBtn = el<HTMLButtonElement>('[data-role=\'clear-selection\']');
const exportBtn = el<HTMLButtonElement>('[data-role=\'export-selected\']');
const frontmatterInput = el<HTMLInputElement>('[data-role=\'frontmatter\']');
const timestampsInput = el<HTMLInputElement>('[data-role=\'timestamps\']');
const projectSelect = el<HTMLSelectElement>('[data-role=\'project\']');
const timestamp24hInput = el<HTMLInputElement>('[data-role=\'timestamp24h\']');
const fenceInput = el<HTMLInputElement>('[data-role=\'fence\']');

const exportLabelEl = el<HTMLSpanElement>('[data-role=\'export-selected-label\']');

refreshBtn.addEventListener('click', () => {
  void loadConversations();
});
projectSelect.addEventListener('change', () => {
  state.selectedProjectId = projectSelect.value;
  // 切换项目/切回全部会话都必须清空选择，否则会把上一个来源的会话一起导出
  state.selectedIds.clear();
  state.cursor = null;
  void loadConversations();
});
selectAllBtn.addEventListener('click', () => setAllSelections(true));
clearSelectionBtn.addEventListener('click', () => setAllSelections(false));
exportBtn.addEventListener('click', () => {
  void exportSelected();
});

listEl.addEventListener('scroll', () => {
  if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 100 && state.hasMore && !state.isLoading) {
    void loadMore();
  }
}, { passive: true });

// 事件委托：勾选状态同步到 selectedIds，防止 render() 重建列表后丢失
listEl.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;

  if (target.type !== 'checkbox') {
    return;
  }

  const chatId = target.dataset.chatId;

  if (!chatId) {
    return;
  }

  if (target.checked) {
    state.selectedIds.add(chatId);
  }
  else {
    state.selectedIds.delete(chatId);
  }

  updateControls();
});

i18nPopulate(document.body);
void init();

/** 首屏与翻页的页大小；与 background 无关，只决定一次拉多少条 */
const PAGE_SIZE = 20;

type ListQuery = {
  projectId?: string;
  offset?: number;
  limit?: number;
  cursor?: string;
};

async function requestConversationPage(query: ListQuery): Promise<ConversationListResponse> {
  if (query.projectId) {
    // 项目会话端点是 cursor 分页，offset/limit 不适用
    return browser.runtime.sendMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      projectId: query.projectId,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  }

  return browser.runtime.sendMessage({
    type: 'REQUEST_CONVERSATION_LIST',
    offset: query.offset,
    limit: query.limit,
  });
}

/* 项目列表失败只影响下拉（只剩「全部会话」），批量导出照常可用；
 * 但错误必须让用户看见，否则「下拉里没有我的项目」无从判断原因。 */
async function loadProjects(): Promise<void> {
  try {
    const result = await browser.runtime.sendMessage({ type: 'REQUEST_PROJECT_LIST' }) as ConversationListResponse;

    if (result?.ok && result.projects) {
      state.projects = result.projects;
      state.projectsError = '';
    }
    else {
      state.projectsError = result?.error ?? t('popup.projectsUnavailable');
    }
  }
  catch (error) {
    state.projectsError = error instanceof Error
      ? error.message
      : t('popup.projectsUnavailable');
  }

  renderProjects();
}

function renderProjects(): void {
  const options: HTMLOptionElement[] = [new Option(t('popup.allConversations'), '')];

  for (const project of state.projects) {
    options.push(new Option(project.name, project.id));
  }

  projectSelect.setAttribute('aria-label', t('popup.projectLabel'));
  projectSelect.replaceChildren(...options);
  projectSelect.value = state.selectedProjectId;
  projectSelect.disabled = state.isBusy || state.projects.length === 0;
}

async function init(): Promise<void> {
  setStatus(t('popup.connecting'));

  // 先拿项目列表：失败也要在状态栏说明原因，否则「下拉里没有我的项目」无从判断
  await loadProjects();
  await loadConversations();
}

/* 请求代次：切换项目/刷新时，仍在飞行中的旧请求其结果必须被丢弃，
 * 否则会出现「列表是旧项目的、projectId 是新的」这种串台。 */
let loadGeneration = 0;

async function loadConversations(): Promise<void> {
  const generation = ++loadGeneration;

  state.isLoading = true;
  state.conversations = [];
  state.selectedIds.clear();
  state.cursor = null;
  state.hasMore = true;
  updateControls();
  render();
  setStatus(t('popup.loadingList'));
  sectionTitleEl.textContent = t('common.loading');

  try {
    const result = await requestConversationPage({
      offset: 0,
      limit: PAGE_SIZE,
      projectId: state.selectedProjectId || undefined,
    });

    if (generation !== loadGeneration) {
      return;
    }

    if (!result?.ok) {
      setStatus(result?.error ?? t('popup.connectionFailed'), 'error');
      return;
    }

    state.contentReady = true;
    state.conversations = result.conversations ?? [];
    applyPaging(result, state.conversations.length);
    syncSectionTitle();

    if (state.conversations.length === 0) {
      setStatus(t('common.noConversations'), 'warning');
    }
    else if (state.projectsError) {
      // 会话能正常导出，但项目下拉不可用，用户需要知道原因
      setStatus(state.projectsError, 'error');
    }
    else {
      setStatus(t('popup.loadedCount', { count: state.conversations.length }), 'success');
    }
  }
  catch (error) {
    if (generation !== loadGeneration) {
      return;
    }

    // sendMessage 在 background 未就绪时会 reject，
    // 不捕获则弹窗会永久停留在「正在连接⋯」，也没有重试入口
    setStatus(t('popup.loadFailedWithError', { error: error instanceof Error ? error.message : String(error) }), 'error');
  }
  finally {
    if (generation === loadGeneration) {
      state.isLoading = false;
      updateControls();
      render();
    }
  }
}

async function loadMore(): Promise<void> {
  if (state.isLoading || !state.hasMore) {
    return;
  }

  const generation = loadGeneration;
  state.isLoading = true;
  setStatus(t('popup.loadingList'));

  try {
    const result = await requestConversationPage(
      state.selectedProjectId
        ? { projectId: state.selectedProjectId, cursor: state.cursor ?? undefined }
        : { offset: state.conversations.length, limit: PAGE_SIZE },
    );

    if (generation !== loadGeneration) {
      return;
    }

    if (!result?.ok) {
      setStatus(result?.error ?? t('popup.loadFailed'), 'error');
      return;
    }

    state.conversations = [...state.conversations, ...(result.conversations ?? [])];
    applyPaging(result, (result.conversations ?? []).length);
    syncSectionTitle();
    setStatus(t('popup.loadedCount', { count: state.conversations.length }), 'success');
  }
  catch (error) {
    setStatus(t('popup.loadFailedWithError', { error: error instanceof Error ? error.message : String(error) }), 'error');
  }
  finally {
    if (generation === loadGeneration) {
      state.isLoading = false;
      updateControls();
      render();
    }
  }
}

/* 两种来源的分页语义不同：普通列表按条数判断还有没有下一页，
 * 项目会话端点是 cursor 分页，只看服务端有没有给下一个游标。 */
function applyPaging(result: ConversationListResponse, pageSize: number): void {
  if (state.selectedProjectId) {
    state.cursor = result.cursor ?? null;
    state.hasMore = state.cursor !== null;
    return;
  }

  state.hasMore = pageSize >= PAGE_SIZE;
}

function syncSectionTitle(): void {
  sectionTitleEl.textContent = state.hasMore
    ? t('common.itemsCount', { count: state.conversations.length })
    : t('popup.loadedCount', { count: state.conversations.length });
}

async function exportSelected(): Promise<void> {
  if (state.isBusy) {
    return;
  }

  const project = state.projects.find(item => item.id === state.selectedProjectId);

  state.isBusy = true;
  updateControls();

  try {
    // 项目模式是「导出整个项目」：先把还没翻到的页拉完，
    // 否则只导出滚动加载出来的那一部分，产物看起来完整其实缺页。
    const chatIds = project
      ? await collectProjectChatIds(project)
      : getSelectedIds();

    if (chatIds.length === 0) {
      setStatus(t('popup.selectAtLeastOne'), 'warning');
      return;
    }

    setStatus(t('popup.exportingCount', { count: chatIds.length }));

    const result = await browser.runtime.sendMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds,
      includeFrontmatter: frontmatterInput.checked,
      includeTimestamps: timestampsInput.checked,
      timestamp24h: timestamp24hInput.checked,
      fenceMessages: fenceInput.checked,
      ...(project ? { project } : {}),
    }) as { ok: boolean; error?: string };

    if (result?.ok) {
      setStatus(t('popup.exportedCount', { count: chatIds.length }), 'success');
    }
    else {
      setStatus(result?.error ?? t('popup.exportFailed'), 'error');
    }
  }
  catch (error) {
    setStatus(t('popup.exportFailedWithError', { error: error instanceof Error ? error.message : String(error) }), 'error');
  }
  finally {
    state.isBusy = false;
    updateControls();
  }
}

/* 项目会话是 cursor 分页的，导出前必须把剩余页拉完。
 * 已加载的部分直接复用，避免重复请求第一页。 */
async function collectProjectChatIds(project: Project): Promise<string[]> {
  const ids = state.conversations.map(item => item.id);
  let cursor = state.cursor;

  while (cursor) {
    const page = await requestConversationPage({ projectId: project.id, cursor });

    if (!page?.ok) {
      throw new Error(page?.error ?? t('popup.loadFailed'));
    }

    for (const item of page.conversations ?? []) {
      ids.push(item.id);
    }

    cursor = page.cursor ?? null;
  }

  return ids;
}

function setAllSelections(checked: boolean): void {
  for (const checkbox of listEl.querySelectorAll<HTMLInputElement>('input[type=\'checkbox\']')) {
    checkbox.checked = checked;

    const chatId = checkbox.dataset.chatId;

    if (!chatId) {
      continue;
    }

    if (checked) {
      state.selectedIds.add(chatId);
    }
    else {
      state.selectedIds.delete(chatId);
    }
  }

  updateControls();
}

function getSelectedIds(): string[] {
  // 按列表顺序返回，避免 Set 插入顺序与展示顺序不一致
  return state.conversations
    .filter(conversation => state.selectedIds.has(conversation.id))
    .map(conversation => conversation.id);
}

function render(): void {
  listEl.replaceChildren();

  if (state.isLoading && state.conversations.length === 0) {
    listEl.appendChild(createPlaceholder(t('popup.loadingList')));
    return;
  }

  if (state.conversations.length === 0) {
    listEl.appendChild(createPlaceholder(t('popup.clickToLoad')));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const conversation of state.conversations) {
    const row = document.createElement('label');
    row.className = 'conversation-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.chatId = conversation.id;
    checkbox.checked = state.selectedIds.has(conversation.id);

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

  if (state.isLoading && state.hasMore) {
    listEl.appendChild(createPlaceholder(t('common.loadMore')));
  }
}

function updateControls(): void {
  // 刷新按钮始终可用（作为初始化失败后的重试入口）
  refreshBtn.disabled = state.isBusy || state.isLoading;

  const ready = state.contentReady && state.conversations.length > 0;

  projectSelect.disabled = state.isBusy || state.projects.length === 0;
  selectAllBtn.disabled = state.isBusy || !ready;
  clearSelectionBtn.disabled = state.isBusy || !ready;
  exportBtn.disabled = state.isBusy || !ready;

  if (state.selectedProjectId) {
    // 还有未加载的页时不能报出「N 个会话」，否则与实际导出数量不符
    exportLabelEl.textContent = state.hasMore
      ? t('popup.exportProject')
      : t('popup.exportProjectCount', { count: state.conversations.length });
    return;
  }

  // 只选 1 个会话时，无图片等二进制资源会直接下载 .md，文案不能再声称导出 ZIP
  const single = state.selectedIds.size === 1;

  exportLabelEl.textContent = t(single ? 'common.exportSelectedSingle' : 'common.exportSelectedZip');
}

function setStatus(text: string, tone: 'muted' | 'success' | 'warning' | 'error' = 'muted'): void {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function createPlaceholder(text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.textContent = text;
  return div;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) {
    return t('common.noTimeInfo');
  }

  return new Date(timestamp * 1000).toLocaleString(getDateLocale(), {
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
