import browser from 'webextension-polyfill';
import { t } from './i18n';
import { dedupeNamedFiles, sanitizeDownloadPath } from './shared/files';
import {
  isContentScriptReadyMessage,
  isDownloadMessage,
  isNamedTextFile,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type RequestConversationListMessage,
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

browser.tabs.onRemoved.addListener((tabId) => {
  readyTabs.delete(tabId);
});

browser.runtime.onInstalled.addListener(() => {
  void ensureExporterOnOpenTabs();
});

browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
  if (isContentScriptReadyMessage(message)) {
    if (sender.tab?.id != null) {
      readyTabs.add(sender.tab.id);
    }
    return undefined;
  }

  if (isRequestConversationListMessage(message)) {
    return handlePopupConversationListRequest(message);
  }

  if (isRequestExportConversationsMessage(message)) {
    return handlePopupExportRequest(message);
  }

  if (!isDownloadMessage(message)) {
    return undefined;
  }

  try {
    if (message.type === 'DOWNLOAD_MARKDOWN') {
      if (!isNamedTextFile(message.file)) {
        throw new Error(t('background.invalidDownloadParams'));
      }

      void downloadTextFile(message.file.filename, message.file.content, message.saveAs);
      return { ok: true };
    }

    if (!Array.isArray(message.files) || message.files.some(file => !isNamedTextFile(file))) {
      throw new Error(t('background.invalidZipParams'));
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

async function handlePopupConversationListRequest(message: RequestConversationListMessage): Promise<ConversationListResponse> {
  const tabId = await findChatGPTTabId();

  if (tabId === null) {
    return { ok: false, error: t('background.noChatGPTTab') };
  }

  const ok = await ensureTabReady(tabId);

  if (!ok) {
    return { ok: false, error: t('background.connectionFailedInit') };
  }

  try {
    return await browser.tabs.sendMessage(tabId, { type: 'REQUEST_CONVERSATION_LIST', offset: message.offset, limit: message.limit }) as ConversationListResponse;
  }
  catch (error) {
    return { ok: false, error: t('background.communicationFailed', { error: error instanceof Error ? error.message : String(error) }) };
  }
}

async function handlePopupExportRequest(
  request: { chatIds: string[]; includeFrontmatter: boolean; includeTimestamps: boolean; timestamp24h: boolean },
): Promise<RuntimeResponse> {
  const tabId = await findChatGPTTabId();

  if (tabId === null) {
    return { ok: false, error: t('background.noChatGPTTab') };
  }

  const ok = await ensureTabReady(tabId);

  if (!ok) {
    return { ok: false, error: t('background.connectionFailedInit') };
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
    return { ok: false, error: t('background.communicationFailed', { error: error instanceof Error ? error.message : String(error) }) };
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

  const allTabs = await browser.tabs.query({
    url: [...CHATGPT_TAB_URL_PATTERNS],
  });

  if (allTabs[0]?.id != null) {
    return allTabs[0].id;
  }

  return null;
}

async function ensureTabReady(tabId: number): Promise<boolean> {
  if (readyTabs.has(tabId)) {
    return true;
  }

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
  ensureTextSize(content, MAX_TEXT_BYTES, t('background.fileTooLarge'));

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
    throw new Error(t('background.noFiles'));
  }

  if (files.length > MAX_ZIP_FILES) {
    throw new Error(t('background.tooManyFiles', { max: MAX_ZIP_FILES }));
  }

  let totalBytes = 0;

  for (const file of files) {
    const size = new TextEncoder().encode(file.content).length;
    totalBytes += size;
    ensureTextSize(file.content, MAX_TEXT_BYTES, t('background.fileTooLargeNested', { filename: file.filename }));
  }

  if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
    throw new Error(t('background.contentTooLarge'));
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
