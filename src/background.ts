import browser from 'webextension-polyfill';
import { dedupeNamedFiles, sanitizeDownloadPath } from './shared/files';
import {
  isContentScriptReadyMessage,
  isDownloadMessage,
  isNamedTextFile,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type RuntimeResponse,
} from './shared/messages';
import { buildZipBlob } from './shared/zip';

const MAX_ZIP_FILES = 100;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 12 * 1024 * 1024;
const CHATGPT_TAB_URL_PATTERNS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
] as const;
const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

// 已就绪的内容脚本标签页集合
const readyTabs = new Set<number>();

// 监听标签页关闭
browser.tabs.onRemoved.addListener((tabId) => {
  readyTabs.delete(tabId);
});

browser.runtime.onInstalled.addListener(() => {
  void ensureExporterOnOpenTabs();
});

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
  // Content script 报到
  if (isContentScriptReadyMessage(message)) {
    if (sender.tab?.id != null) {
      readyTabs.add(sender.tab.id);
    }
    return undefined;
  }

  // Popup 请求会话列表
  if (isRequestConversationListMessage(message)) {
    return handlePopupConversationListRequest();
  }

  // Popup 请求导出
  if (isRequestExportConversationsMessage(message)) {
    return handlePopupExportRequest(message);
  }

  // 下载请求（来自 content script）
  if (!isDownloadMessage(message)) {
    return undefined;
  }

  try {
    if (message.type === 'DOWNLOAD_MARKDOWN') {
      if (!isNamedTextFile(message.file)) {
        throw new Error('无效的下载参数。');
      }

      void downloadTextFile(message.file.filename, message.file.content, message.saveAs);
      return { ok: true };
    }

    if (!Array.isArray(message.files) || message.files.some(file => !isNamedTextFile(file))) {
      throw new Error('无效的 ZIP 下载参数。');
    }

    void downloadZipFile(message.filename, message.files, message.saveAs);
    return { ok: true };
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

async function handlePopupConversationListRequest(): Promise<ConversationListResponse> {
  const tabId = await findChatGPTTabId();

  if (tabId === null) {
    return { ok: false, error: '未找到 ChatGPT 标签页，请先打开 chatgpt.com。' };
  }

  // 等待 content script 就绪（必要时注入）
  const ok = await ensureTabReady(tabId);

  if (!ok) {
    return { ok: false, error: '未能连接到 ChatGPT 页面，请刷新后重试。' };
  }

  try {
    return await browser.tabs.sendMessage(tabId, { type: 'REQUEST_CONVERSATION_LIST' }) as ConversationListResponse;
  }
  catch (error) {
    return { ok: false, error: `通信失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

async function handlePopupExportRequest(
  request: { chatIds: string[]; includeFrontmatter: boolean; includeTimestamps: boolean; timestamp24h: boolean },
): Promise<RuntimeResponse> {
  const tabId = await findChatGPTTabId();

  if (tabId === null) {
    return { ok: false, error: '未找到 ChatGPT 标签页，请先打开 chatgpt.com。' };
  }

  const ok = await ensureTabReady(tabId);

  if (!ok) {
    return { ok: false, error: '未能连接到 ChatGPT 页面，请刷新后重试。' };
  }

  try {
    return await browser.tabs.sendMessage(tabId, {
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: request.chatIds,
      includeFrontmatter: request.includeFrontmatter,
      includeTimestamps: request.includeTimestamps,
      timestamp24h: request.timestamp24h,
    }) as RuntimeResponse;
  }
  catch (error) {
    return { ok: false, error: `通信失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

async function findChatGPTTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
    url: [...CHATGPT_TAB_URL_PATTERNS],
  });

  if (tabs[0]?.id != null) {
    return tabs[0].id;
  }

  // 降级：查找所有窗口
  const allTabs = await browser.tabs.query({
    url: [...CHATGPT_TAB_URL_PATTERNS],
  });

  if (allTabs[0]?.id != null) {
    return allTabs[0].id;
  }

  return null;
}

async function ensureTabReady(tabId: number): Promise<boolean> {
  // 已报到 — 直接返回
  if (readyTabs.has(tabId)) {
    return true;
  }

  // 尝试注入 content script
  let injected = false;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content/index.js'],
    });
    injected = true;
  }
  catch {
    // scripting 失败，尝试 tabs 降级
  }

  if (!injected) {
    try {
      await browser.tabs.executeScript(tabId, {
        file: '/content/index.js',
      });
      injected = true;
    }
    catch {
      return false;
    }
  }

  // 等待 content script 报到（最多 3 秒）
  for (let i = 0; i < 30; i++) {
    if (readyTabs.has(tabId)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

async function ensureExporterOnOpenTabs(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({
      url: [...CHATGPT_TAB_URL_PATTERNS],
    });

    await Promise.all(tabs.map(async (tab) => {
      if (!tab.id) {
        return;
      }

      await ensureTabReady(tab.id);
    }));
  }
  catch (error) {
    console.error('为已打开页面注入导出按钮失败', error);
  }
}

async function downloadTextFile(
  filename: string,
  content: string,
  saveAs = true,
): Promise<void> {
  ensureTextSize(content, MAX_TEXT_BYTES, '单个 Markdown 文件过大，已拒绝下载。');

  const blob = new Blob([content], {
    type: 'text/markdown;charset=utf-8',
  });

  await downloadBlob(blob, filename, saveAs);
}

async function downloadZipFile(
  filename: string,
  files: Array<{ filename: string; content: string }>,
  saveAs = true,
): Promise<void> {
  if (files.length === 0) {
    throw new Error('没有可下载的文件。');
  }

  if (files.length > MAX_ZIP_FILES) {
    throw new Error(`单次最多只能导出 ${MAX_ZIP_FILES} 个会话。`);
  }

  let totalBytes = 0;

  for (const file of files) {
    const size = new TextEncoder().encode(file.content).length;
    totalBytes += size;
    ensureTextSize(file.content, MAX_TEXT_BYTES, `文件过大：${file.filename}`);
  }

  if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
    throw new Error('导出内容总量过大，请缩小批量范围后重试。');
  }

  const blob = buildZipBlob(dedupeNamedFiles(files));

  await downloadBlob(blob, filename, saveAs);
}

async function downloadBlob(blob: Blob, filename: string, saveAs: boolean): Promise<void> {
  const safeFilename = sanitizeDownloadPath(filename, 'download.bin');
  const url = IS_FIREFOX
    ? URL.createObjectURL(blob)
    : await blobToDataUrl(blob);

  let downloadId: number | undefined;

  try {
    downloadId = await browser.downloads.download({
      url,
      filename: safeFilename,
      saveAs,
      conflictAction: 'uniquify',
    });
  }
  catch (error) {
    if (IS_FIREFOX) {
      URL.revokeObjectURL(url);
    }
    throw error;
  }

  if (!IS_FIREFOX) {
    return;
  }

  await revokeObjectUrlAfterDownload(url, downloadId);
}

function ensureTextSize(content: string, maxBytes: number, message: string): void {
  const bytes = new TextEncoder().encode(content).length;

  if (bytes > maxBytes) {
    throw new Error(message);
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

function revokeObjectUrlAfterDownload(url: string, downloadId: number): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = () => {
      browser.downloads.onChanged.removeListener(handleChanged);
      URL.revokeObjectURL(url);
      resolve();
    };

    const handleChanged = (delta: browser.Downloads.OnChangedDownloadDeltaType) => {
      if (delta.id !== downloadId) {
        return;
      }

      if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
        cleanup();
      }
    };

    browser.downloads.onChanged.addListener(handleChanged);

    window.setTimeout(cleanup, 60_000);
  });
}
