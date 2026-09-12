import { describe, it, expect } from 'vitest';
import { buildZipBlob, buildZipBlobFromEntries } from './zip.ts';

/* buildZipBlob / buildZipBlobFromEntries 是 background 唯一使用的 ZIP 入口，
 * 这里只验证「Blob 形态 + 内容确实进了压缩包」，字节级格式由 zip-core.test.ts 覆盖。 */

function readText(buffer: ArrayBuffer): string {
  return new TextDecoder('latin1').decode(new Uint8Array(buffer));
}

describe('buildZipBlob', () => {
  it('返回 application/zip 类型的 Blob', () => {
    const blob = buildZipBlob([{ filename: 'a.txt', content: 'hello' }]);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
  });

  it('写入文件名与文本内容', async () => {
    const blob = buildZipBlob([{ filename: 'ChatGPT/a.md', content: 'hello world' }]);
    const text = readText(await blob.arrayBuffer());

    expect(text).toContain('ChatGPT/a.md');
    expect(text).toContain('hello world');
  });

  it('空文件列表仍产出合法 ZIP（EOFC 记录）', async () => {
    const blob = buildZipBlob([]);
    const text = readText(await blob.arrayBuffer());

    expect(text.startsWith('PK')).toBe(true);
  });
});

describe('buildZipBlobFromEntries', () => {
  it('文本与二进制条目一起打包', async () => {
    const blob = buildZipBlobFromEntries([
      { filename: 'a.md', content: 'markdown body' },
      { filename: 'assets/a.png', content: '', data: 'aGk=' },
    ]);
    const text = readText(await blob.arrayBuffer());

    expect(text).toContain('a.md');
    expect(text).toContain('markdown body');
    expect(text).toContain('assets/a.png');
    // base64('hi') 解出的原始字节应出现在压缩包内（无压缩存储）
    expect(text).toContain('hi');
  });

  it('data 带 data URL 前缀时只取逗号后的部分', async () => {
    const blob = buildZipBlobFromEntries([
      { filename: 'a.png', content: '', data: 'data:image/png;base64,aGk=' },
    ]);
    const text = readText(await blob.arrayBuffer());

    expect(text).toContain('hi');
    expect(text).not.toContain('image/png');
  });

  it('data 为纯 base64（无前缀）时同样正常解码', async () => {
    const blob = buildZipBlobFromEntries([
      { filename: 'a.png', content: '', data: 'aGk=' },
    ]);

    expect(readText(await blob.arrayBuffer())).toContain('hi');
  });

  it('data 优先于 content（二进制条目 content 为空串）', async () => {
    const blob = buildZipBlobFromEntries([
      { filename: 'a.bin', content: 'ignored-text', data: 'aGk=' },
    ]);
    const text = readText(await blob.arrayBuffer());

    expect(text).toContain('hi');
  });
});
