import { describe, it, expect } from 'vitest';
import { buildZipBuffer, type ZipFileEntry } from './zip-core.ts';
import { buildZipBlob } from './zip.ts';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createTextFile(path: string, content: string, mtime = new Date(2024, 0, 1)): ZipFileEntry {
  return { path, content: new TextEncoder().encode(content), mtime };
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian = true): number {
  return new DataView(bytes.buffer).getUint32(offset, littleEndian);
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian = true): number {
  return new DataView(bytes.buffer).getUint16(offset, littleEndian);
}

/* ------------------------------------------------------------------ */
/*  ZIP constants                                                     */
/* ------------------------------------------------------------------ */

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

/* ------------------------------------------------------------------ */
/*  Tests — buildZipBuffer                                            */
/* ------------------------------------------------------------------ */

describe('buildZipBuffer', () => {
  it('produces a valid ZIP with one file', () => {
    const files = [createTextFile('hello.txt', 'Hello, World!')];
    const buf = new Uint8Array(buildZipBuffer(files));

    // Should start with a local file header
    expect(readUint32(buf, 0)).toBe(LOCAL_FILE_HEADER_SIG);
  });

  it('contains the correct file content', () => {
    const content = 'Hello, ZIP!';
    const files = [createTextFile('test.txt', content)];
    const buf = new Uint8Array(buildZipBuffer(files));

    // Parse local file header
    const fileNameLen = readUint16(buf, 26);
    const extraFieldLen = readUint16(buf, 28);
    const headerSize = 30 + fileNameLen + extraFieldLen;
    const storedContent = new TextDecoder().decode(buf.slice(headerSize, headerSize + content.length));

    expect(storedContent).toBe(content);
  });

  it('stores multiple files', () => {
    const files: ZipFileEntry[] = [
      createTextFile('a.txt', 'AAA'),
      createTextFile('b.txt', 'BBB'),
    ];
    const buf = new Uint8Array(buildZipBuffer(files));

    // Two local file headers
    expect(readUint32(buf, 0)).toBe(LOCAL_FILE_HEADER_SIG);

    // Find second local header after first file
    const nameLen1 = readUint16(buf, 26);
    const headerEnd1 = 30 + nameLen1 + readUint16(buf, 28) + 3;
    expect(readUint32(buf, headerEnd1)).toBe(LOCAL_FILE_HEADER_SIG);
  });

  it('has a correct central directory at the end', () => {
    const files = [createTextFile('f.txt', 'data')];
    const buf = new Uint8Array(buildZipBuffer(files));

    // End of central directory signature must exist within last 22+65536 bytes
    const eocdOffset = buf.length - 22;
    expect(readUint32(buf, eocdOffset)).toBe(END_OF_CENTRAL_DIR_SIG);
  });

  it('end of central directory has correct entry count', () => {
    const files: ZipFileEntry[] = [
      createTextFile('x.txt', '1'),
      createTextFile('y.txt', '2'),
      createTextFile('z.txt', '3'),
    ];
    const buf = new Uint8Array(buildZipBuffer(files));

    const eocdOffset = buf.length - 22;
    const entryCount = readUint16(buf, eocdOffset + 8);

    expect(entryCount).toBe(3);
  });

  it('central directory offset points to a valid header', () => {
    const files = [createTextFile('test.txt', 'content')];
    const buf = new Uint8Array(buildZipBuffer(files));

    const eocdOffset = buf.length - 22;
    const cdOffset = readUint32(buf, eocdOffset + 16);
    expect(readUint32(buf, cdOffset)).toBe(CENTRAL_DIR_HEADER_SIG);
  });

  it('handles empty content', () => {
    const files = [createTextFile('empty.txt', '')];
    const buf = new Uint8Array(buildZipBuffer(files));

    expect(readUint32(buf, 0)).toBe(LOCAL_FILE_HEADER_SIG);
    const storedSize = readUint32(buf, 22); // compressed size in local header
    expect(storedSize).toBe(0);
  });

  it('handles files with unicode filenames', () => {
    const files = [createTextFile('中文/文件.txt', 'data')];
    const buf = new Uint8Array(buildZipBuffer(files));

    expect(readUint32(buf, 0)).toBe(LOCAL_FILE_HEADER_SIG);
    const fileNameLen = readUint16(buf, 26);
    const fileNameBytes = buf.slice(30, 30 + fileNameLen);
    const fileName = new TextDecoder().decode(fileNameBytes);

    expect(fileName).toBe('中文/文件.txt');
  });

  it('produces a ZIP that can be extracted by system unzip', async () => {
    const files: ZipFileEntry[] = [
      createTextFile('greeting.txt', 'Hello'),
      createTextFile('nested/sub/file.txt', 'World'),
    ];
    const buf = buildZipBuffer(files);

    // Write to temp file and verify with unzip -t
    const { writeFile, unlink } = await import('node:fs/promises');
    const tmpPath = `/tmp/test-zip-core-${Date.now()}.zip`;

    try {
      await writeFile(tmpPath, Buffer.from(buf));

      const { execSync } = await import('node:child_process');
      const output = execSync(`unzip -t "${tmpPath}"`, { encoding: 'utf8' });

      expect(output).toContain('No errors detected');
    }
    finally {
      await unlink(tmpPath).catch(() => {});
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Tests — buildZipBlob (browser wrapper)                            */
/* ------------------------------------------------------------------ */

describe('buildZipBlob', () => {
  it('returns a Blob with application/zip type', () => {
    const blob = buildZipBlob([{ filename: 'f.txt', content: 'data' }]);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
  });

  it('produces a non-empty blob', () => {
    const blob = buildZipBlob([{ filename: 'f.txt', content: 'x' }]);

    expect(blob.size).toBeGreaterThan(0);
  });
});
