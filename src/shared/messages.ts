import type { NamedTextFile } from "./files";

export type PingExporterPanelMessage = {
  type: "PING_EXPORTER_PANEL";
};

export type DownloadMarkdownMessage = {
  type: "DOWNLOAD_MARKDOWN";
  file: NamedTextFile;
  saveAs?: boolean;
};

export type DownloadZipMessage = {
  type: "DOWNLOAD_ZIP";
  filename: string;
  files: NamedTextFile[];
  saveAs?: boolean;
};

export type RequestConversationListMessage = {
  type: "REQUEST_CONVERSATION_LIST";
};

export type RequestExportConversationsMessage = {
  type: "REQUEST_EXPORT_CONVERSATIONS";
  chatIds: string[];
  includeFrontmatter: boolean;
  includeTimestamps: boolean;
  timestamp24h: boolean;
};

/** Content script 向 background 报到 */
export type ContentScriptReadyMessage = {
  type: "CONTENT_SCRIPT_READY";
};

export type RuntimeMessage =
  | PingExporterPanelMessage
  | ContentScriptReadyMessage
  | DownloadMarkdownMessage
  | DownloadZipMessage
  | RequestConversationListMessage
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
  }>;
};

export function isContentScriptReadyMessage(
  value: unknown
): value is ContentScriptReadyMessage {
  return isObject(value) && value.type === "CONTENT_SCRIPT_READY";
}

export function isPingExporterPanelMessage(
  value: unknown
): value is PingExporterPanelMessage {
  return isObject(value) && value.type === "PING_EXPORTER_PANEL";
}

export function isDownloadMessage(
  value: unknown
): value is DownloadMarkdownMessage | DownloadZipMessage {
  return isObject(value)
    && (value.type === "DOWNLOAD_MARKDOWN" || value.type === "DOWNLOAD_ZIP");
}

export function isRequestConversationListMessage(
  value: unknown
): value is RequestConversationListMessage {
  return isObject(value) && value.type === "REQUEST_CONVERSATION_LIST";
}

export function isRequestExportConversationsMessage(
  value: unknown
): value is RequestExportConversationsMessage {
  return isObject(value)
    && value.type === "REQUEST_EXPORT_CONVERSATIONS"
    && Array.isArray((value as RequestExportConversationsMessage).chatIds);
}

export function isNamedTextFile(value: unknown): value is NamedTextFile {
  return typeof value === "object"
    && value !== null
    && "filename" in value
    && typeof value.filename === "string"
    && "content" in value
    && typeof value.content === "string";
}

function isObject(value: unknown): value is { type?: string } {
  return typeof value === "object" && value !== null;
}
