import { describe, it, expect } from 'vitest';
import {
  buildCurrentMarkdownFilename,
  buildCurrentZipFilename,
  buildMarkdownFilename,
  buildZipFilename,
  dedupeNamedFiles,
  sanitizeDownloadPath,
} from './files.ts';

/* ------------------------------------------------------------------ */
/*  Filename builders                                                 */
/* ------------------------------------------------------------------ */

describe('buildMarkdownFilename', () => {
  it('批量导出带日期前缀与 ChatGPT/ 目录', () => {
    expect(
      buildMarkdownFilename('Hello World', 'chat-1', new Date('2026-07-31T10:00:00Z')),
    ).toBe('ChatGPT/2026-07-31-Hello World.md');
  });

  it('标题为空时回退到 chatId', () => {
    expect(
      buildMarkdownFilename('   ', 'chat-1', new Date('2026-07-31T10:00:00Z')),
    ).toBe('ChatGPT/2026-07-31-chat-1.md');
  });

  it('清理非法文件名字符', () => {
    expect(
      buildMarkdownFilename('a/b:c*d?', 'chat-1', new Date('2026-01-02T00:00:00Z')),
    ).toBe('ChatGPT/2026-01-02-abcd.md');
  });
});

describe('buildCurrentMarkdownFilename / buildCurrentZipFilename', () => {
  it('当前会话 Markdown 无目录前缀', () => {
    expect(buildCurrentMarkdownFilename('Hello', 'chat-1')).toBe('Hello.md');
  });

  it('当前会话 ZIP 带 chatgpt- 前缀', () => {
    expect(buildCurrentZipFilename('Hello', 'chat-1')).toBe('chatgpt-Hello.zip');
  });

  it('标题为空时均回退到 chatId', () => {
    expect(buildCurrentMarkdownFilename('', 'chat-1')).toBe('chat-1.md');
    expect(buildCurrentZipFilename('', 'chat-1')).toBe('chatgpt-chat-1.zip');
  });
});

describe('buildZipFilename', () => {
  it('非法时间字符替换为 -', () => {
    expect(buildZipFilename(new Date('2026-07-31T12:34:56.789Z')))
      .toBe('chatgpt-export-2026-07-31T12-34-56-789Z.zip');
  });
});

/* ------------------------------------------------------------------ */
/*  sanitizeDownloadPath                                              */
/* ------------------------------------------------------------------ */

describe('sanitizeDownloadPath', () => {
  it('逐段清理并保留目录结构', () => {
    expect(sanitizeDownloadPath('ChatGPT/a:b/c*d.md')).toBe('ChatGPT/ab/cd.md');
  });

  it('丢弃空段（连续斜杠 / 首尾斜杠）', () => {
    expect(sanitizeDownloadPath('/ChatGPT//a.md/')).toBe('ChatGPT/a.md');
  });

  it('全部段都为空时回退默认值', () => {
    expect(sanitizeDownloadPath('///')).toBe('download.txt');
  });

  it('自定义回退值', () => {
    expect(sanitizeDownloadPath('', 'conversation.md')).toBe('conversation.md');
  });
});

/* ------------------------------------------------------------------ */
/*  dedupeNamedFiles                                                  */
/* ------------------------------------------------------------------ */

describe('dedupeNamedFiles', () => {
  it('无重名时保持原样并清理路径', () => {
    expect(dedupeNamedFiles([{ filename: 'ChatGPT/a.md' }]))
      .toEqual([{ filename: 'ChatGPT/a.md' }]);
  });

  it('重名时按 (2) (3) 递增，保留扩展名', () => {
    const result = dedupeNamedFiles([
      { filename: 'ChatGPT/a.md' },
      { filename: 'ChatGPT/a.md' },
      { filename: 'ChatGPT/a.md' },
    ]);

    expect(result.map(f => f.filename)).toEqual([
      'ChatGPT/a.md',
      'ChatGPT/a (2).md',
      'ChatGPT/a (3).md',
    ]);
  });

  it('无扩展名时后缀追加在末尾', () => {
    const result = dedupeNamedFiles([
      { filename: 'ChatGPT/noext' },
      { filename: 'ChatGPT/noext' },
    ]);

    expect(result.map(f => f.filename)).toEqual(['ChatGPT/noext', 'ChatGPT/noext (2)']);
  });

  it('目录名中的点不视为扩展名', () => {
    const result = dedupeNamedFiles([
      { filename: 'ChatGPT/a.b/c' },
      { filename: 'ChatGPT/a.b/c' },
    ]);

    expect(result.map(f => f.filename)).toEqual(['ChatGPT/a.b/c', 'ChatGPT/a.b/c (2)']);
  });

  it('清理后变成空文件名时回退 conversation.md，并参与去重', () => {
    const result = dedupeNamedFiles([
      { filename: '???' },
      { filename: '???' },
    ]);

    expect(result.map(f => f.filename)).toEqual(['conversation.md', 'conversation (2).md']);
  });

  it('保留条目其余字段', () => {
    const result = dedupeNamedFiles([
      { filename: 'a.md', content: 'x', data: 'base64' },
    ]);

    expect(result[0]).toEqual({ filename: 'a.md', content: 'x', data: 'base64' });
  });
});
