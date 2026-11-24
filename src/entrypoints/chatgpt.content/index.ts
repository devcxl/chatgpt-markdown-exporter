import { t } from '../../i18n';
import { mountCurrentExportButton } from './current-export-button';
import {
  fetchAllConversations,
  fetchConversations,
  fetchConversation,
  fetchProjectConversations,
  fetchProjects,
  getCurrentChatId,
} from './api';
import { processConversation } from './process-conversation';
import { conversationToMarkdown, type MarkdownOptions } from '../../markdown/conversation-to-markdown';
import {
  buildCurrentMarkdownFilename,
  buildCurrentZipFilename,
  buildMarkdownFilename,
  buildProjectMarkdownFilename,
  buildProjectZipFilename,
  buildZipFilename,
  projectDirectoryName,
} from '../../shared/files';
import type { Project } from '../../shared/chatgpt-types';
import { buildDownloadMessage } from '../../shared/download';
import {
  isPingExporterPanelMessage,
  isRequestProjectListMessage,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  type ConversationListResponse,
  type RuntimeResponse,
} from '../../shared/messages';
import { resolveImagesAsFileRefs, type ImageFileEntry } from './images';
import { showToast } from './toast';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',
  main() {
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
        return handleConversationList(
          message.offset,
          message.limit,
          message.projectId,
          message.cursor,
        );
      }

      if (isRequestProjectListMessage(message)) {
        return handleProjectList();
      }

      if (isRequestExportConversationsMessage(message)) {
        return handleExportConversations(
          message.chatIds,
          {
            includeFrontmatter: message.includeFrontmatter,
            includeTimestamps: message.includeTimestamps,
            timestamp24h: message.timestamp24h,
            fenceMessages: message.fenceMessages,
          },
          message.project,
        );
      }

      return undefined;
    });

    async function handleProjectList(): Promise<ConversationListResponse> {
      try {
        return { ok: true, projects: await fetchProjects() };
      }
      catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async function handleConversationList(
      offset?: number,
      limit?: number,
      projectId?: string,
      cursor?: string,
    ): Promise<ConversationListResponse> {
      try {
        if (projectId) {
          const page = await fetchProjectConversations(projectId, cursor);

          return { ok: true, conversations: page.items, cursor: page.cursor };
        }

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
      project?: Project,
    ): Promise<RuntimeResponse> {
      // 项目导出时 Markdown 与 assets/ 都落在 <项目名>/ 下，两者必须用同一个目录名
      const assetPrefix = project ? `${projectDirectoryName(project)}/` : 'ChatGPT/';
      const files: Array<{ filename: string; content: string; data?: string }> = [];
      const failed: string[] = [];

      for (const chatId of chatIds) {
        try {
          const rawConversation = await fetchConversation(chatId);
          const imageEntries: ImageFileEntry[] = [];

          try {
            await resolveImagesAsFileRefs(rawConversation, imageEntries, assetPrefix);
          }
          catch {
            showToast(`图片解析失败：${chatId}`, 'info');
          }

          const conversation = processConversation(rawConversation);
          const markdown = conversationToMarkdown(conversation, options, {
            sourceUrl: `${location.origin}/c/${conversation.id}`,
            ...(project ? { project } : {}),
          });

          files.push({
            filename: project
              ? buildProjectMarkdownFilename(project, conversation.title, conversation.id)
              : buildMarkdownFilename(conversation.title, conversation.id),
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

      const response = await browser.runtime.sendMessage(
        buildDownloadMessage(
          files,
          project ? buildProjectZipFilename(project) : buildZipFilename(),
          true,
          Boolean(project),
        ),
      ) as RuntimeResponse;

      if (!response?.ok) {
        showToast(`批量导出失败：${response?.error ?? t('panel.downloadFailed')}`, 'error');
        return { ok: false, error: response?.error ?? t('panel.downloadFailed') };
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
          { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true, fenceMessages: false },
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

        const response = await browser.runtime.sendMessage(
          buildDownloadMessage(
            files,
            buildCurrentZipFilename(title, conversation.id),
            true,
          ),
        ) as RuntimeResponse;

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
  },
});
