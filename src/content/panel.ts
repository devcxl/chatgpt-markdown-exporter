import browser from "webextension-polyfill";
import { fetchAllConversations, fetchConversation, getCurrentChatId } from "./api";
import { processConversation } from "./process-conversation";
import type { ApiConversationItem } from "./types";
import { conversationToMarkdown, type MarkdownOptions } from "../markdown/conversation-to-markdown";
import {
  buildCurrentMarkdownFilename,
  buildMarkdownFilename,
  buildZipFilename
} from "../shared/files";
import type { RuntimeResponse } from "../shared/messages";

const HOST_ID = "cgpt-exporter-host";
const CURRENT_EXPORT_BUTTON_ID = "cgpt-export-current-button";
const HEADER_ACTIONS_SELECTOR = "#conversation-header-actions";
const MAX_CONVERSATIONS = 100;
let panelController: PanelController | null = null;

type StatusTone = "muted" | "success" | "warning" | "error";

type PanelController = {
  toggle(): void;
  open(): void;
  close(): void;
};

type PanelState = {
  isOpen: boolean;
  isBusy: boolean;
  isLoadingList: boolean;
  hasLoadedList: boolean;
  conversations: ApiConversationItem[];
  currentExportButton: HTMLButtonElement;
  panel: HTMLDivElement;
  statusEl: HTMLParagraphElement;
  conversationListEl: HTMLDivElement;
  refreshButton: HTMLButtonElement;
  selectAllButton: HTMLButtonElement;
  clearSelectionButton: HTMLButtonElement;
  exportSelectedButton: HTMLButtonElement;
  frontmatterInput: HTMLInputElement;
  timestampsInput: HTMLInputElement;
  timestamp24hInput: HTMLInputElement;
};

export function mountExportPanel(): PanelController {
  if (panelController) {
    return panelController;
  }

  const existingHost = document.getElementById(HOST_ID);

  if (existingHost) {
    return {
      toggle() {
        // 防止重复注入后的重复控制器干扰
      },
      open() {
        // 防止重复注入后的重复控制器干扰
      },
      close() {
        // 防止重复注入后的重复控制器干扰
      }
    };
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.right = "20px";
  host.style.bottom = "20px";
  host.style.zIndex = "2147483647";

  const currentExportButton = createCurrentExportButton();
  mountCurrentExportButton(currentExportButton);
  observeHeaderActions(currentExportButton);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = PANEL_STYLE;
  shadow.appendChild(style);

  const root = document.createElement("div");
  root.className = "root";
  shadow.appendChild(root);

  const panel = document.createElement("div");
  panel.className = "panel hidden";
  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="panel-title">ChatGPT Exporter</div>
        <div class="panel-subtitle">批量导出面板</div>
      </div>
      <button class="icon-button" type="button" data-role="close" aria-label="关闭">×</button>
    </div>
    <section class="section">
      <label class="checkbox-row"><input data-role="frontmatter" type="checkbox" checked />包含 YAML frontmatter</label>
      <label class="checkbox-row"><input data-role="timestamps" type="checkbox" />包含消息时间</label>
      <label class="checkbox-row"><input data-role="timestamp24h" type="checkbox" checked />使用 24 小时制</label>
    </section>
    <section class="section">
      <div class="section-header">
        <span>批量导出（最近 ${MAX_CONVERSATIONS} 条）</span>
        <button class="secondary-button small" type="button" data-role="refresh">加载 / 刷新</button>
      </div>
      <div class="toolbar">
        <button class="secondary-button small" type="button" data-role="select-all">全选</button>
        <button class="secondary-button small" type="button" data-role="clear-selection">清空</button>
      </div>
      <div class="conversation-list" data-role="conversation-list"></div>
      <button class="primary-button" type="button" data-role="export-selected">导出所选为 ZIP</button>
    </section>
    <p class="status" data-role="status">点击扩展图标打开批量导出列表。</p>
  `;
  root.appendChild(panel);

  (document.body ?? document.documentElement).appendChild(host);

  const state: PanelState = {
    isOpen: false,
    isBusy: false,
    isLoadingList: false,
    hasLoadedList: false,
    conversations: [],
    currentExportButton,
    panel,
    statusEl: queryRequired<HTMLParagraphElement>(panel, "[data-role='status']"),
    conversationListEl: queryRequired<HTMLDivElement>(panel, "[data-role='conversation-list']"),
    refreshButton: queryRequired<HTMLButtonElement>(panel, "[data-role='refresh']"),
    selectAllButton: queryRequired<HTMLButtonElement>(panel, "[data-role='select-all']"),
    clearSelectionButton: queryRequired<HTMLButtonElement>(panel, "[data-role='clear-selection']"),
    exportSelectedButton: queryRequired<HTMLButtonElement>(panel, "[data-role='export-selected']"),
    frontmatterInput: queryRequired<HTMLInputElement>(panel, "[data-role='frontmatter']"),
    timestampsInput: queryRequired<HTMLInputElement>(panel, "[data-role='timestamps']"),
    timestamp24hInput: queryRequired<HTMLInputElement>(panel, "[data-role='timestamp24h']")
  };

  const controller: PanelController = {
    toggle() {
      if (state.isOpen) {
        closePanel(state);
        return;
      }

      void openPanel(state);
    },
    open() {
      void openPanel(state);
    },
    close() {
      closePanel(state);
    }
  };

  panelController = controller;

  addTrustedClickListener(currentExportButton, () => {
    void exportCurrentConversation(state);
  });
  addTrustedClickListener(queryRequired<HTMLButtonElement>(panel, "[data-role='close']"), () => controller.close());
  addTrustedClickListener(state.refreshButton, () => {
    void loadConversationList(state, true);
  });
  addTrustedClickListener(state.selectAllButton, () => {
    setAllSelections(state, true);
  });
  addTrustedClickListener(state.clearSelectionButton, () => {
    setAllSelections(state, false);
  });
  addTrustedClickListener(state.exportSelectedButton, () => {
    void exportSelectedConversations(state);
  });

  renderConversationList(state);

  return controller;
}

async function openPanel(state: PanelState): Promise<void> {
  state.isOpen = true;
  state.panel.classList.remove("hidden");

  if (!state.hasLoadedList && !state.isLoadingList) {
    await loadConversationList(state, false);
  }
}

function closePanel(state: PanelState): void {
  state.isOpen = false;
  state.panel.classList.add("hidden");
}

async function exportCurrentConversation(state: PanelState): Promise<void> {
  await withBusy(state, async () => {
    setStatus(state, "正在导出当前会话…");

    const chatId = getCurrentChatId();
    const rawConversation = await fetchConversation(chatId);
    const conversation = processConversation(rawConversation);
    const markdown = conversationToMarkdown(
      conversation,
      getMarkdownOptions(state),
      {
        sourceUrl: chatId.startsWith("__share__")
          ? location.href
          : `${location.origin}/c/${conversation.id}`
      }
    );

    const response = await browser.runtime.sendMessage({
      type: "DOWNLOAD_MARKDOWN",
      file: {
        filename: buildCurrentMarkdownFilename(
          getCurrentConversationTitle(conversation.title),
          conversation.id
        ),
        content: markdown
      },
      saveAs: true
    }) as RuntimeResponse;

    if (!response?.ok) {
      throw new Error(response?.error ?? "下载失败。");
    }

    setStatus(state, "当前会话已导出。", "success");
  });
}

async function loadConversationList(state: PanelState, forceReload: boolean): Promise<void> {
  if (state.isLoadingList) {
    return;
  }

  state.isLoadingList = true;

  if (forceReload) {
    state.conversations = [];
    state.hasLoadedList = false;
  }

  updateControls(state);
  renderConversationList(state);
  setStatus(state, `正在加载最近 ${MAX_CONVERSATIONS} 条会话…`);

  try {
    const loaded: ApiConversationItem[] = [];

    const conversations = await fetchAllConversations(MAX_CONVERSATIONS, (batch) => {
      loaded.push(...batch);
      state.conversations = [...loaded];
      renderConversationList(state);
      setStatus(state, `已加载 ${loaded.length} 条会话…`);
    });

    state.conversations = conversations;
    state.hasLoadedList = true;
    renderConversationList(state);

    if (conversations.length === 0) {
      setStatus(state, "没有可导出的会话。", "warning");
    } else {
      setStatus(state, `会话列表已加载，共 ${conversations.length} 条。`, "success");
    }
  } catch (error) {
    setStatus(state, formatError(error), "error");
  } finally {
    state.isLoadingList = false;
    updateControls(state);
    renderConversationList(state);
  }
}

async function exportSelectedConversations(state: PanelState): Promise<void> {
  await withBusy(state, async () => {
    const selectedIds = getSelectedConversationIds(state);

    if (selectedIds.length === 0) {
      throw new Error("请先至少选择一个会话。");
    }

    const files: Array<{ filename: string; content: string }> = [];
    const failed: string[] = [];

    for (const [index, chatId] of selectedIds.entries()) {
      setStatus(state, `正在导出 ${index + 1}/${selectedIds.length}…`);

      try {
        const rawConversation = await fetchConversation(chatId);
        const conversation = processConversation(rawConversation);
        const markdown = conversationToMarkdown(
          conversation,
          getMarkdownOptions(state),
          {
            sourceUrl: `${location.origin}/c/${conversation.id}`
          }
        );

        files.push({
          filename: buildMarkdownFilename(conversation.title, conversation.id),
          content: markdown
        });
      } catch (error) {
        failed.push(`${chatId}: ${formatError(error)}`);
      }

      await delay(80);
    }

    if (files.length === 0) {
      throw new Error(failed[0] ?? "批量导出失败。");
    }

    const response = await browser.runtime.sendMessage({
      type: "DOWNLOAD_ZIP",
      filename: buildZipFilename(),
      files,
      saveAs: true
    }) as RuntimeResponse;

    if (!response?.ok) {
      throw new Error(response?.error ?? "ZIP 下载失败。");
    }

    if (failed.length > 0) {
      console.error("部分会话导出失败", failed);
      setStatus(
        state,
        `已导出 ${files.length} 个会话，失败 ${failed.length} 个。失败详情已输出到控制台。`,
        "warning"
      );
      return;
    }

    setStatus(state, `已导出 ${files.length} 个会话。`, "success");
  });
}

async function withBusy(state: PanelState, action: () => Promise<void>): Promise<void> {
  if (state.isBusy) {
    return;
  }

  state.isBusy = true;
  updateControls(state);

  try {
    await action();
  } catch (error) {
    setStatus(state, formatError(error), "error");
  } finally {
    state.isBusy = false;
    updateControls(state);
  }
}

function renderConversationList(state: PanelState): void {
  state.conversationListEl.replaceChildren();

  if (state.isLoadingList && state.conversations.length === 0) {
    state.conversationListEl.appendChild(createPlaceholder("正在加载会话列表…"));
    return;
  }

  if (state.conversations.length === 0) {
    state.conversationListEl.appendChild(createPlaceholder("点击“加载 / 刷新”后显示会话列表。"));
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const conversation of state.conversations) {
    const row = document.createElement("label");
    row.className = "conversation-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.chatId = conversation.id;

    const textWrap = document.createElement("span");
    textWrap.className = "conversation-text";

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title || conversation.id;

    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    meta.textContent = formatConversationDate(conversation.update_time ?? conversation.create_time);

    textWrap.append(title, meta);
    row.append(checkbox, textWrap);
    fragment.appendChild(row);
  }

  state.conversationListEl.appendChild(fragment);
}

function setAllSelections(state: PanelState, checked: boolean): void {
  for (const checkbox of state.conversationListEl.querySelectorAll<HTMLInputElement>("input[type='checkbox']")) {
    checkbox.checked = checked;
  }
}

function getSelectedConversationIds(state: PanelState): string[] {
  return Array.from(
    state.conversationListEl.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked")
  )
    .map((checkbox) => checkbox.dataset.chatId)
    .filter((value): value is string => Boolean(value));
}

function getMarkdownOptions(state: PanelState): MarkdownOptions {
  return {
    includeFrontmatter: state.frontmatterInput.checked,
    includeTimestamps: state.timestampsInput.checked,
    timestamp24h: state.timestamp24hInput.checked
  };
}

function setStatus(state: PanelState, text: string, tone: StatusTone = "muted"): void {
  state.statusEl.textContent = text;
  state.statusEl.dataset.tone = tone;
}

function updateControls(state: PanelState): void {
  const disabled = state.isBusy;

  state.currentExportButton.disabled = disabled;
  state.refreshButton.disabled = disabled || state.isLoadingList;
  state.selectAllButton.disabled = disabled || state.conversations.length === 0;
  state.clearSelectionButton.disabled = disabled || state.conversations.length === 0;
  state.exportSelectedButton.disabled = disabled || state.conversations.length === 0;
}

function createCurrentExportButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = CURRENT_EXPORT_BUTTON_ID;
  button.type = "button";
  button.className = "btn relative group-focus-within/dialog:focus-visible:[outline-width:1.5px] group-focus-within/dialog:focus-visible:[outline-offset:2.5px] group-focus-within/dialog:focus-visible:[outline-style:solid] group-focus-within/dialog:focus-visible:[outline-color:var(--text-primary)] btn-ghost text-token-text-primary hover:bg-token-surface-hover keyboard-focused:bg-token-surface-hover rounded-lg max-sm:hidden";
  button.setAttribute("aria-label", "导出当前会话 Markdown");
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

function mountCurrentExportButton(button: HTMLButtonElement): void {
  const actions = document.querySelector<HTMLElement>(HEADER_ACTIONS_SELECTOR);

  if (!actions) {
    return;
  }

  if (button.parentElement !== actions) {
    actions.appendChild(button);
  }
}

function observeHeaderActions(button: HTMLButtonElement): void {
  const observer = new MutationObserver(() => {
    mountCurrentExportButton(button);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.setTimeout(() => {
    mountCurrentExportButton(button);
  }, 0);
}

function queryRequired<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function addTrustedClickListener(
  element: HTMLButtonElement,
  handler: () => void
): void {
  element.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }

    handler();
  });
}

function createPlaceholder(text: string): HTMLDivElement {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = text;
  return placeholder;
}

function formatConversationDate(timestamp?: number): string {
  if (!timestamp) {
    return "无时间信息";
  }

  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getCurrentConversationTitle(fallbackTitle: string): string {
  const title = document.title
    .replace(/\s*[-|·]\s*ChatGPT\s*$/i, "")
    .trim();

  if (title && !/^chatgpt$/i.test(title)) {
    return title;
  }

  return fallbackTitle.trim() || "ChatGPT Conversation";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const PANEL_STYLE = `
  :host {
    all: initial;
  }

  * {
    box-sizing: border-box;
  }

  .root {
    position: relative;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .panel {
    position: absolute;
    right: 0;
    bottom: 52px;
    width: 380px;
    max-height: min(72vh, 720px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.98);
    color: #0f172a;
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.2);
    backdrop-filter: blur(10px);
  }

  .hidden {
    display: none;
  }

  .panel-header,
  .section-header,
  .toolbar,
  .conversation-row {
    display: flex;
    align-items: center;
  }

  .panel-header,
  .section-header {
    justify-content: space-between;
    gap: 12px;
  }

  .panel-title {
    font-size: 15px;
    font-weight: 700;
  }

  .panel-subtitle {
    margin-top: 2px;
    font-size: 12px;
    color: #64748b;
  }

  .icon-button,
  .secondary-button,
  .primary-button {
    border: none;
    cursor: pointer;
    transition: opacity 0.2s ease;
  }

  .icon-button:disabled,
  .secondary-button:disabled,
  .primary-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .icon-button {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: #e2e8f0;
    color: #0f172a;
    font-size: 18px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 2px;
  }

  .checkbox-row,
  .conversation-row {
    gap: 10px;
    font-size: 13px;
    color: #1e293b;
  }

  .checkbox-row input,
  .conversation-row input {
    margin: 0;
  }

  .toolbar {
    gap: 8px;
    flex-wrap: wrap;
  }

  .secondary-button,
  .primary-button {
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13px;
  }

  .secondary-button {
    background: #e2e8f0;
    color: #0f172a;
  }

  .secondary-button.small {
    padding: 7px 10px;
    font-size: 12px;
  }

  .primary-button {
    background: #111827;
    color: #fff;
  }

  .conversation-list {
    min-height: 120px;
    max-height: 300px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
  }

  .conversation-row {
    align-items: flex-start;
    padding: 4px 2px;
  }

  .conversation-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .conversation-title {
    font-size: 13px;
    line-height: 1.35;
    word-break: break-word;
  }

  .conversation-meta,
  .placeholder,
  .status {
    font-size: 12px;
    color: #64748b;
  }

  .placeholder {
    padding: 12px 6px;
  }

  .status {
    margin: 0;
    min-height: 18px;
    line-height: 1.4;
  }

  .status[data-tone="success"] {
    color: #047857;
  }

  .status[data-tone="warning"] {
    color: #b45309;
  }

  .status[data-tone="error"] {
    color: #b91c1c;
  }
`;
