import { buildZipBuffer, type ZipFileEntry } from './zip-core';

export type ZipTextFile = {
  filename: string;
  content: string;
};

export function buildZipBlob(files: ZipTextFile[]): Blob {
  const encoder = new TextEncoder();

  const entries: ZipFileEntry[] = files.map(f => ({
    path: f.filename,
    content: encoder.encode(f.content),
    mtime: new Date(),
  }));

  const buffer = buildZipBuffer(entries);

  return new Blob([buffer], { type: 'application/zip' });
}
