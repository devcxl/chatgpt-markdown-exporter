import type { NamedTextFile, NamedZipEntry } from './files';

export type PingExporterPanelMessage = {
  type: 'PING_EXPORTER_PANEL';
};

export type DownloadMarkdownMessage = {
  type: 'DOWNLOAD_MARKDOWN';
  file: NamedTextFile;
  saveAs?: boolean;
};

export type DownloadZipMessage = {
  type: 'DOWNLOAD_ZIP';
  filename: string;
  files: NamedZipEntry[];
  saveAs?: boolean;
};

export type RequestConversationListMessage = {
  type: 'REQUEST_CONVERSATION_LIST';
  offset?: number;
  limit?: number;
  /** 存在则改走项目会话端点（`/gizmos/{id}/conversations`），偏移分页不适用 */
  projectId?: string;
  /** 项目会话端点是 cursor 分页；首屏留空，后续带上一页返回的不透明字符串 */
  cursor?: string;
};

export type RequestProjectListMessage = {
  type: 'REQUEST_PROJECT_LIST';
};

export type RequestExportConversationsMessage = {
  type: 'REQUEST_EXPORT_CONVERSATIONS';
  chatIds: string[];
  includeFrontmatter: boolean;
  includeTimestamps: boolean;
  timestamp24h: boolean;
  /** 每条消息渲染为围栏代码块，取代 `---` + `## 角色` */
  fenceMessages: boolean;
  /** 项目导出：产物按项目建目录，并在 frontmatter 写入项目字段 */
  project?: {
    id: string;
    name: string;
  };
};

/** Content script 向 background 报到 */
export type ContentScriptReadyMessage = {
  type: 'CONTENT_SCRIPT_READY';
};

export type RuntimeMessage =
  | PingExporterPanelMessage
  | ContentScriptReadyMessage
  | DownloadMarkdownMessage
  | DownloadZipMessage
  | RequestConversationListMessage
  | RequestProjectListMessage
  | RequestExportConversationsMessage;

export type RuntimeResponse = {
  ok: boolean;
  error?: string;
};

export type ConversationListResponse = {
  ok: boolean;
  error?: string;
  conversations?: Array<{
    id: string;
    title: string;
    create_time: number;
    update_time?: number;
    gizmo_id?: string | null;
  }>;
  total?: number | null;
  /** 项目模式下的下一页游标；null 表示没有更多 */
  cursor?: string | null;
  /** 仅项目列表请求会填充 */
  projects?: Array<{ id: string; name: string }>;
};

export function isContentScriptReadyMessage(
  value: unknown,
): value is ContentScriptReadyMessage {
  return isObject(value) && value.type === 'CONTENT_SCRIPT_READY';
}

export function isPingExporterPanelMessage(
  value: unknown,
): value is PingExporterPanelMessage {
  return isObject(value) && value.type === 'PING_EXPORTER_PANEL';
}

export function isDownloadMessage(
  value: unknown,
): value is DownloadMarkdownMessage | DownloadZipMessage {
  return isObject(value)
    && (value.type === 'DOWNLOAD_MARKDOWN' || value.type === 'DOWNLOAD_ZIP');
}

export function isRequestConversationListMessage(
  value: unknown,
): value is RequestConversationListMessage {
  if (!isObject(value) || value.type !== 'REQUEST_CONVERSATION_LIST') {
    return false;
  }

  const message = value as RequestConversationListMessage;

  // 可选字段一旦出现就必须是对的类型：它们会被直接拼进请求 URL
  if (message.projectId !== undefined && typeof message.projectId !== 'string') {
    return false;
  }

  if (message.cursor !== undefined && typeof message.cursor !== 'string') {
    return false;
  }

  return true;
}

export function isRequestProjectListMessage(
  value: unknown,
): value is RequestProjectListMessage {
  return isObject(value) && value.type === 'REQUEST_PROJECT_LIST';
}

export function isRequestExportConversationsMessage(
  value: unknown,
): value is RequestExportConversationsMessage {
  if (!isObject(value)
    || value.type !== 'REQUEST_EXPORT_CONVERSATIONS'
    || !Array.isArray((value as RequestExportConversationsMessage).chatIds)) {
    return false;
  }

  const project = (value as RequestExportConversationsMessage).project;

  if (project === undefined) {
    return true;
  }

  // 项目上下文会决定产物目录与 frontmatter，字段残缺必须在这里拦住
  return typeof project === 'object'
    && project !== null
    && typeof project.id === 'string'
    && typeof project.name === 'string';
}

export function isNamedTextFile(value: unknown): value is NamedTextFile {
  return typeof value === 'object'
    && value !== null
    && 'filename' in value
    && typeof value.filename === 'string'
    && 'content' in value
    && typeof value.content === 'string';
}

export function isNamedZipEntry(value: unknown): value is NamedZipEntry {
  if (typeof value !== 'object' || value === null) return false;
  if (typeof (value as Record<string, unknown>).filename !== 'string') return false;
  if (typeof (value as Record<string, unknown>).content !== 'string') return false;

  const data = (value as Record<string, unknown>).data;

  if (data !== undefined && typeof data !== 'string') return false;

  return true;
}

function isObject(value: unknown): value is { type?: string } {
  return typeof value === 'object' && value !== null;
}
