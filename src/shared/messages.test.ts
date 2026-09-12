import { describe, it, expect } from 'vitest';
import {
  isContentScriptReadyMessage,
  isDownloadMessage,
  isNamedTextFile,
  isNamedZipEntry,
  isPingExporterPanelMessage,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
} from './messages.ts';

/* 这些类型守卫是 content script / background / popup 三个上下文之间的消息边界，
 * 一旦放宽会直接执行到非法载荷，因此逐条锁定。 */

describe('isContentScriptReadyMessage', () => {
  it('识别报到消息', () => {
    expect(isContentScriptReadyMessage({ type: 'CONTENT_SCRIPT_READY' })).toBe(true);
  });

  it('拒绝其他类型与非对象', () => {
    expect(isContentScriptReadyMessage({ type: 'OTHER' })).toBe(false);
    expect(isContentScriptReadyMessage(null)).toBe(false);
    expect(isContentScriptReadyMessage('CONTENT_SCRIPT_READY')).toBe(false);
  });
});

describe('isPingExporterPanelMessage', () => {
  it('识别 PING', () => {
    expect(isPingExporterPanelMessage({ type: 'PING_EXPORTER_PANEL' })).toBe(true);
  });

  it('拒绝其他类型', () => {
    expect(isPingExporterPanelMessage({ type: 'DOWNLOAD_ZIP' })).toBe(false);
    expect(isPingExporterPanelMessage(undefined)).toBe(false);
  });
});

describe('isDownloadMessage', () => {
  it('接受两种下载消息', () => {
    expect(isDownloadMessage({ type: 'DOWNLOAD_MARKDOWN' })).toBe(true);
    expect(isDownloadMessage({ type: 'DOWNLOAD_ZIP' })).toBe(true);
  });

  it('拒绝非下载消息', () => {
    expect(isDownloadMessage({ type: 'REQUEST_CONVERSATION_LIST' })).toBe(false);
    expect(isDownloadMessage([])).toBe(false);
  });
});

describe('isRequestConversationListMessage', () => {
  it('识别列表请求', () => {
    expect(isRequestConversationListMessage({ type: 'REQUEST_CONVERSATION_LIST' })).toBe(true);
  });

  it('拒绝其他类型', () => {
    expect(isRequestConversationListMessage({ type: 'REQUEST_EXPORT_CONVERSATIONS' })).toBe(false);
  });
});

describe('isRequestExportConversationsMessage', () => {
  it('识别带 chatIds 数组的导出请求', () => {
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['a'],
    })).toBe(true);
  });

  it('缺少 chatIds 或非数组时拒绝', () => {
    expect(isRequestExportConversationsMessage({ type: 'REQUEST_EXPORT_CONVERSATIONS' })).toBe(false);
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: 'a',
    })).toBe(false);
  });
});

describe('isNamedTextFile', () => {
  it('接受 filename + content 字符串', () => {
    expect(isNamedTextFile({ filename: 'a.md', content: '' })).toBe(true);
  });

  it('拒绝缺字段或类型错误', () => {
    expect(isNamedTextFile({ filename: 'a.md' })).toBe(false);
    expect(isNamedTextFile({ filename: 1, content: 'x' })).toBe(false);
    expect(isNamedTextFile({ filename: 'a.md', content: 1 })).toBe(false);
    expect(isNamedTextFile(null)).toBe(false);
  });
});

describe('isNamedZipEntry', () => {
  it('接受纯文本条目', () => {
    expect(isNamedZipEntry({ filename: 'a.md', content: 'x' })).toBe(true);
  });

  it('接受带二进制数据的条目', () => {
    expect(isNamedZipEntry({ filename: 'a.png', content: '', data: 'base64' })).toBe(true);
  });

  it('拒绝 filename / content 非字符串', () => {
    expect(isNamedZipEntry({ filename: 1, content: 'x' })).toBe(false);
    expect(isNamedZipEntry({ filename: 'a.md', content: null })).toBe(false);
  });

  it('data 可以是 undefined，但不能是其他类型', () => {
    expect(isNamedZipEntry({ filename: 'a.md', content: 'x', data: undefined })).toBe(true);
    expect(isNamedZipEntry({ filename: 'a.md', content: 'x', data: 42 })).toBe(false);
  });

  it('拒绝非对象', () => {
    expect(isNamedZipEntry(null)).toBe(false);
    expect(isNamedZipEntry('a.md')).toBe(false);
  });
});
