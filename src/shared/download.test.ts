import { describe, it, expect } from 'vitest';
import { buildDownloadMessage } from './download.ts';
import { isDownloadMessage, isNamedTextFile, isNamedZipEntry } from './messages.ts';

describe('buildDownloadMessage', () => {
  it('单个会话且无二进制资源时直接下载 .md', () => {
    const message = buildDownloadMessage(
      [{ filename: 'ChatGPT/2026-07-31-Hello.md', content: '# Hello' }],
      'chatgpt-export.zip',
    );

    expect(message).toEqual({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: '2026-07-31-Hello.md', content: '# Hello' },
      saveAs: true,
    });
  });

  it('当前会话（ZIP 内为平铺路径）直接下载时文件名保持不变', () => {
    const message = buildDownloadMessage(
      [{ filename: 'Hello.md', content: '# Hello' }],
      'chatgpt-Hello.zip',
    );

    expect(message).toEqual({
      type: 'DOWNLOAD_MARKDOWN',
      file: { filename: 'Hello.md', content: '# Hello' },
      saveAs: true,
    });
  });

  it('单个会话含图片时仍打包 ZIP', () => {
    const files = [
      { filename: 'ChatGPT/Hello.md', content: '![image](assets/a.png)' },
      { filename: 'ChatGPT/assets/a.png', content: '', data: 'data:image/png;base64,AAAA' },
    ];

    expect(buildDownloadMessage(files, 'chatgpt-export.zip')).toEqual({
      type: 'DOWNLOAD_ZIP',
      filename: 'chatgpt-export.zip',
      files,
      saveAs: true,
    });
  });

  it('多个会话时仍打包 ZIP', () => {
    const files = [
      { filename: 'ChatGPT/a.md', content: 'a' },
      { filename: 'ChatGPT/b.md', content: 'b' },
    ];

    expect(buildDownloadMessage(files, 'chatgpt-export.zip')).toEqual({
      type: 'DOWNLOAD_ZIP',
      filename: 'chatgpt-export.zip',
      files,
      saveAs: true,
    });
  });

  it('data 为空字符串也算二进制资源，仍打包 ZIP', () => {
    const files = [{ filename: 'ChatGPT/a.md', content: 'a', data: '' }];

    expect(buildDownloadMessage(files, 'chatgpt-export.zip').type).toBe('DOWNLOAD_ZIP');
  });

  it('无文件时返回 ZIP 消息，由 background 统一报错', () => {
    expect(buildDownloadMessage([], 'chatgpt-export.zip')).toEqual({
      type: 'DOWNLOAD_ZIP',
      filename: 'chatgpt-export.zip',
      files: [],
      saveAs: true,
    });
  });

  it('saveAs 透传', () => {
    const message = buildDownloadMessage(
      [{ filename: 'a.md', content: 'a' }],
      'chatgpt-export.zip',
      false,
    );

    expect(message.saveAs).toBe(false);
  });

  // background 只认 isDownloadMessage，且分别用 isNamedTextFile / isNamedZipEntry 校验载荷，
  // 这里锁死跨模块契约，避免改消息结构后 background 静默拒绝下载。
  it('生成的消息能通过 background 的校验', () => {
    const markdown = buildDownloadMessage(
      [{ filename: 'ChatGPT/Hello.md', content: '# Hello' }],
      'chatgpt-export.zip',
    );
    const zip = buildDownloadMessage(
      [
        { filename: 'ChatGPT/Hello.md', content: '# Hello' },
        { filename: 'ChatGPT/assets/a.png', content: '', data: 'data:image/png;base64,AAAA' },
      ],
      'chatgpt-export.zip',
    );

    expect(isDownloadMessage(markdown)).toBe(true);
    expect(markdown.type === 'DOWNLOAD_MARKDOWN' && isNamedTextFile(markdown.file)).toBe(true);
    expect(isDownloadMessage(zip)).toBe(true);
    expect(zip.type === 'DOWNLOAD_ZIP' && zip.files.every(isNamedZipEntry)).toBe(true);
  });
});
