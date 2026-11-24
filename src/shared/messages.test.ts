import { describe, it, expect } from 'vitest';
import {
  isContentScriptReadyMessage,
  isDownloadMessage,
  isNamedTextFile,
  isNamedZipEntry,
  isPingExporterPanelMessage,
  isRequestConversationListMessage,
  isRequestExportConversationsMessage,
  isRequestProjectListMessage,
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

describe('isRequestProjectListMessage', () => {
  it('识别项目列表请求', () => {
    expect(isRequestProjectListMessage({ type: 'REQUEST_PROJECT_LIST' })).toBe(true);
  });

  it('拒绝其他类型与非对象', () => {
    expect(isRequestProjectListMessage({ type: 'REQUEST_CONVERSATION_LIST' })).toBe(false);
    expect(isRequestProjectListMessage(null)).toBe(false);
    expect(isRequestProjectListMessage('REQUEST_PROJECT_LIST')).toBe(false);
  });
});

describe('项目维度的列表与导出请求', () => {
  it('列表请求可以带 projectId 与 cursor', () => {
    expect(isRequestConversationListMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      projectId: 'g-p-aaa',
      cursor: 'opaque',
    })).toBe(true);

    // 首屏不带 cursor 也合法
    expect(isRequestConversationListMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      projectId: 'g-p-aaa',
    })).toBe(true);
  });

  it('导出请求可以带 project 上下文', () => {
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['c1'],
      project: { id: 'g-p-aaa', name: 'P' },
    })).toBe(true);
  });

  it('列表请求的 projectId / cursor 类型不对时被拒绝', () => {
    expect(isRequestConversationListMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      projectId: 123,
    })).toBe(false);
    expect(isRequestConversationListMessage({
      type: 'REQUEST_CONVERSATION_LIST',
      cursor: { bad: true },
    })).toBe(false);
  });

  it('导出请求的 project 字段残缺时被拒绝', () => {
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['c1'],
      project: { id: 'g-p-aaa' },
    })).toBe(false);
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      chatIds: ['c1'],
      project: 'g-p-aaa',
    })).toBe(false);
  });

  it('导出请求缺 chatIds 时仍被拒绝（即使带了 project）', () => {
    expect(isRequestExportConversationsMessage({
      type: 'REQUEST_EXPORT_CONVERSATIONS',
      project: { id: 'g-p-aaa', name: 'P' },
    })).toBe(false);
  });
});
