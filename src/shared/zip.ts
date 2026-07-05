import { buildZipBuffer, type ZipFileEntry } from './zip-core';

type ZipTextFile = {
  filename: string;
  content: string;
};

type ZipEntry = {
  filename: string;
  content: string; // 文本内容（.md 文件）
  data?: string; // base64 编码的二进制数据（图片等）
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64.split(',')[1] ?? base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function buildZipBlob(files: ZipTextFile[]): Blob {
  return buildZipFromChunks(files.map(f => ({ filename: f.filename, content: f.content })));
}

export function buildZipBlobFromEntries(files: ZipEntry[]): Blob {
  return buildZipFromChunks(files);
}

function buildZipFromChunks(files: ZipEntry[]): Blob {
  const encoder = new TextEncoder();

  const entries: ZipFileEntry[] = files.map((f) => {
    const content = f.data
      ? base64ToUint8Array(f.data)
      : encoder.encode(f.content);

    return {
      path: f.filename,
      content,
      mtime: new Date(),
    };
  });

  const buffer = buildZipBuffer(entries);

  return new Blob([buffer], { type: 'application/zip' });
}
