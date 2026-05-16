import browser from 'webextension-polyfill';
import { t } from '../i18n';
import { mountCurrentExportButton } from './current-export-button';
import { fetchAllConversations, fetchConversations, fetchConversation, getCurrentChatId } from './api';
import { processConversation } from './process-conversation';
import { conversationToMarkdown, type MarkdownOptions } from '../markdown/conversation-to-markdown';
import { buildCurrentMarkdownFilename, buildCurrentZipFilename, buildMarkdownFilename, buildZipFilename } from '../shared/files';
import {
  isPingExporterPanelMessage,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type RuntimeResponse,
} from '../shared/messages';
import { resolveImagesAsFileRefs, type ImageFileEntry } from './images';
import { showToast } from './toast';

browser.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }).catch(() => {
  // background 可能尚未就绪，不影响页面功能
});

try {
  mountCurrentExportButton(handleExportCurrentConversation);
}
catch (error) {
  console.error('挂载导出按钮失败', error);
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isPingExporterPanelMessage(message)) {
    return { ok: true };
  }

  if (isRequestConversationListMessage(message)) {
    return handleConversationList(message.offset, message.limit);
  }

  if (isRequestExportConversationsMessage(message)) {
    return handleExportConversations(
      message.chatIds,
      {
        includeFrontmatter: message.includeFrontmatter,
        includeTimestamps: message.includeTimestamps,
        timestamp24h: message.timestamp24h,
      },
    );
  }

  return undefined;
});

async function handleConversationList(
  offset?: number,
  limit?: number,
): Promise<ConversationListResponse> {
  try {
    if (offset != null && limit != null) {
      const result = await fetchConversations(offset, limit);
      return {
        ok: true,
        conversations: result.items,
        total: result.total,
      };
    }

    const conversations = await fetchAllConversations(100);
    return { ok: true, conversations };
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleExportConversations(
  chatIds: string[],
  options: MarkdownOptions,
): Promise<RuntimeResponse> {
  const files: Array<{ filename: string; content: string; data?: string }> = [];
  const failed: string[] = [];

  for (const chatId of chatIds) {
    try {
      const rawConversation = await fetchConversation(chatId);
      const imageEntries: ImageFileEntry[] = [];

      try {
        await resolveImagesAsFileRefs(rawConversation, imageEntries, 'ChatGPT/');
      }
      catch {
        showToast(`图片解析失败：${chatId}`, 'info');
      }

      const conversation = processConversation(rawConversation);
      const markdown = conversationToMarkdown(conversation, options, {
        sourceUrl: `${location.origin}/c/${conversation.id}`,
      });

      files.push({
        filename: buildMarkdownFilename(conversation.title, conversation.id),
        content: markdown,
      });

      for (const img of imageEntries) {
        files.push({ filename: img.filename, content: '', data: img.data });
      }
    }
    catch (error) {
      failed.push(`${chatId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 80));
  }

  if (files.length === 0) {
    const errMsg = failed[0] ?? t('panel.batchExportFailed');
    showToast(`批量导出失败：${errMsg}`, 'error');
    return { ok: false, error: errMsg };
  }

  const response = await browser.runtime.sendMessage({
    type: 'DOWNLOAD_ZIP',
    filename: buildZipFilename(),
    files,
    saveAs: true,
  }) as RuntimeResponse;

  if (!response?.ok) {
    showToast(`批量导出失败：${response?.error ?? t('panel.zipDownloadFailed')}`, 'error');
    return { ok: false, error: response?.error ?? t('panel.zipDownloadFailed') };
  }

  if (failed.length > 0) {
    showToast(`批量导出完成，${failed.length} 个会话导出失败`, 'info');
  }
  else {
    showToast(`批量导出完成，共 ${chatIds.length} 个会话`, 'success');
  }

  return { ok: true };
}

async function handleExportCurrentConversation(): Promise<void> {
  try {
    const chatId = getCurrentChatId();
    const rawConversation = await fetchConversation(chatId);
    const imageEntries: ImageFileEntry[] = [];

    try {
      await resolveImagesAsFileRefs(rawConversation, imageEntries);
    }
    catch {
      showToast('图片解析失败，将以纯文本方式导出', 'info');
    }

    const conversation = processConversation(rawConversation);
    const markdown = conversationToMarkdown(
      conversation,
      { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true },
      {
        sourceUrl: chatId.startsWith('__share__')
          ? location.href
          : `${location.origin}/c/${conversation.id}`,
      },
    );

    const title = getCurrentConversationTitle(conversation.title);
    const files: Array<{ filename: string; content: string; data?: string }> = [];

    files.push({
      filename: buildCurrentMarkdownFilename(title, conversation.id),
      content: markdown,
    });

    for (const img of imageEntries) {
      files.push({ filename: img.filename, content: '', data: img.data });
    }

    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      filename: buildCurrentZipFilename(title, conversation.id),
      files,
      saveAs: true,
    }) as RuntimeResponse;

    if (!response?.ok) {
      showToast(`导出失败：${response?.error || '未知错误'}`, 'error');
    }
    else {
      showToast('导出成功', 'success');
    }
  }
  catch (error) {
    showToast(`导出失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
  }
}

function getCurrentConversationTitle(fallbackTitle: string): string {
  const title = document.title
    .replace(/\s*[-|·]\s*ChatGPT\s*$/i, '')
    .trim();

  if (title && !/^chatgpt$/i.test(title)) {
    return title;
  }

  return fallbackTitle.trim() || t('markdown.fallbackTitle');
}
