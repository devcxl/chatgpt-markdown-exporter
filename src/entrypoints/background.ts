import { t } from '../i18n';
import { dedupeNamedFiles, sanitizeDownloadPath } from '../shared/files';
import {
  isContentScriptReadyMessage,
  isDownloadMessage,
  isNamedTextFile,
  isNamedZipEntry,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type DownloadMarkdownMessage,
  type DownloadZipMessage,
  type RequestConversationListMessage,
  type RuntimeResponse,
} from '../shared/messages';
import { buildZipBlobFromEntries } from '../shared/zip';
import type { NamedZipEntry } from '../shared/files';

const MAX_ZIP_FILES = 100;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 12 * 1024 * 1024;
const CHATGPT_TAB_URL_PATTERNS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
] as const;
const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

export default defineBackground(() => {
  const readyTabs = new Set<number>();

  browser.tabs.onRemoved.addListener((tabId: number) => {
    readyTabs.delete(tabId);
  });

  browser.runtime.onInstalled.addListener(() => {
    void ensureExporterOnOpenTabs();
  });

  browser.runtime.onMessage.addListener((message: unknown, sender: { tab?: { id?: number } }) => {
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

    // 下载是异步的，必须把真实结果（成功/失败）返回给调用方，
    // 否则大小超限、下载被拒等错误会被静默吞掉，调用方误报成功。
    return handleDownloadMessage(message).catch(error => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  });

  async function handleDownloadMessage(message: DownloadMarkdownMessage | DownloadZipMessage): Promise<RuntimeResponse> {
    if (message.type === 'DOWNLOAD_MARKDOWN') {
      if (!isNamedTextFile(message.file)) {
        throw new Error(t('background.invalidDownloadParams'));
      }

      await downloadTextFile(message.file.filename, message.file.content, message.saveAs);
      return { ok: true };
    }

    if (!Array.isArray(message.files) || message.files.some(file => !isNamedZipEntry(file))) {
      throw new Error(t('background.invalidZipParams'));
    }

    await downloadZipFile(message.filename, message.files as NamedZipEntry[], message.saveAs);
    return { ok: true };
  }

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

    for (let i = 0; i < 30; i++) {
      if (readyTabs.has(tabId)) {
        return true;
      }

      try {
        await browser.tabs.sendMessage(tabId, { type: 'PING_EXPORTER_PANEL' });
        readyTabs.add(tabId);
        return true;
      }
      catch {
        // content script 尚未就绪，继续等待
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

        if (await ensureTabReady(tab.id)) {
          return;
        }

        // 安装/更新前已打开的标签页没有 content script，PING 永远失败，
        // 需要主动注入（manifest 静态注入只对之后加载的页面生效）。
        // 路径对应 WXT 打包产物：src/entrypoints/chatgpt.content → content-scripts/chatgpt.js
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['/content-scripts/chatgpt.js'],
          });
          readyTabs.add(tab.id);
        }
        catch (injectError) {
          console.error('注入导出脚本失败', injectError);
        }
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
    files: NamedZipEntry[],
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
      if (file.data) {
        totalBytes += estimateBase64Size(file.data);
      }
      else {
        const size = new TextEncoder().encode(file.content).length;
        totalBytes += size;
        ensureTextSize(file.content, MAX_TEXT_BYTES, t('background.fileTooLargeNested', { filename: file.filename }));
      }
    }

    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error(t('background.contentTooLarge'));
    }

    const blob = buildZipBlobFromEntries(dedupeNamedFiles(files));

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

  function estimateBase64Size(base64: string): number {
    const comma = base64.indexOf(',');
    const data = comma >= 0 ? base64.slice(comma + 1) : base64;

    return Math.ceil(data.length * 0.75);
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

      const handleChanged = (delta: { id: number; state?: { current?: string } }) => {
        if (delta.id !== downloadId) {
          return;
        }

        if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
          cleanup();
        }
      };

      browser.downloads.onChanged.addListener(handleChanged);

      // 兜底超时：仅用于防止事件丢失时泄漏 Object URL。
      // 下载完成/中断时 handleChanged 会提前清理，正常情况不会等到超时。
      window.setTimeout(cleanup, 5 * 60_000);
    });
  }
});
