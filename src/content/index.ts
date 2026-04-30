import browser from 'webextension-polyfill';
import { t } from '../i18n';
import { mountCurrentExportButton } from './current-export-button';
import { fetchAllConversations, fetchConversation, getCurrentChatId } from './api';
import { processConversation } from './process-conversation';
import { conversationToMarkdown, type MarkdownOptions } from '../markdown/conversation-to-markdown';
import { buildCurrentMarkdownFilename, buildMarkdownFilename, buildZipFilename } from '../shared/files';
import {
  isPingExporterPanelMessage,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type RuntimeResponse,
} from '../shared/messages';

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
    return handleConversationList();
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

async function handleConversationList(): Promise<ConversationListResponse> {
  try {
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
  const files: Array<{ filename: string; content: string }> = [];
  const failed: string[] = [];

  for (const chatId of chatIds) {
    try {
      const rawConversation = await fetchConversation(chatId);
      const conversation = processConversation(rawConversation);
      const markdown = conversationToMarkdown(conversation, options, {
        sourceUrl: `${location.origin}/c/${conversation.id}`,
      });

      files.push({
        filename: buildMarkdownFilename(conversation.title, conversation.id),
        content: markdown,
      });
    }
    catch (error) {
      failed.push(`${chatId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 80));
  }

  if (files.length === 0) {
    return { ok: false, error: failed[0] ?? t('panel.batchExportFailed') };
  }

  const response = await browser.runtime.sendMessage({
    type: 'DOWNLOAD_ZIP',
    filename: buildZipFilename(),
    files,
    saveAs: true,
  }) as RuntimeResponse;

  if (!response?.ok) {
    return { ok: false, error: response?.error ?? t('panel.zipDownloadFailed') };
  }

  if (failed.length > 0) {
    console.error('部分会话导出失败', failed);
  }

  return { ok: true };
}

async function handleExportCurrentConversation(): Promise<void> {
  try {
    const chatId = getCurrentChatId();
    const rawConversation = await fetchConversation(chatId);
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
    const response = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MARKDOWN',
      file: {
        filename: buildCurrentMarkdownFilename(title, conversation.id),
        content: markdown,
      },
      saveAs: true,
    }) as RuntimeResponse;

    if (!response?.ok) {
      console.error('导出当前会话失败', response?.error);
    }
  }
  catch (error) {
    console.error('导出当前会话失败', error);
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
