/**
 * Shared ZIP store-only format core.
 * Platform-agnostic: no Blob, no Buffer, no Node.js APIs.
 *
 * Both `src/shared/zip.ts` (browser runtime) and
 * `scripts/package.mjs` (build-time packaging) import from here.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_VERSION_MADE_BY_UNIX = 0x0314;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_EXTERNAL_FILE_ATTRIBUTES = 0o100644 << 16;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ZipFileEntry {
  path: string;
  content: Uint8Array;
  mtime: Date;
}

/* ------------------------------------------------------------------ */
/*  CRC32                                                             */
/* ------------------------------------------------------------------ */

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? (value >>> 1) ^ 0xedb88320
        : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/*  DOS timestamp helpers                                             */
/* ------------------------------------------------------------------ */

function toDosTime(date: Date): number {
  return (date.getHours() << 11)
    | (date.getMinutes() << 5)
    | Math.floor(date.getSeconds() / 2);
}

function toDosDate(date: Date): number {
  const year = Math.max(date.getFullYear(), 1980);

  return ((year - 1980) << 9)
    | ((date.getMonth() + 1) << 5)
    | date.getDate();
}

/* ------------------------------------------------------------------ */
/*  Byte buffer helper                                                */
/* ------------------------------------------------------------------ */

function createByteBuffer(length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);

  return {
    bytes,
    view: new DataView(bytes.buffer),
  };
}

/* ------------------------------------------------------------------ */
/*  ZIP entry headers                                                 */
/* ------------------------------------------------------------------ */

function createLocalFileHeader(
  fileNameBytes: Uint8Array,
  contentLength: number,
  crc32: number,
  dosTime: number,
  dosDate: number,
): Uint8Array {
  const { bytes, view } = createByteBuffer(30 + fileNameBytes.length);

  view.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, contentLength, true);
  view.setUint32(22, contentLength, true);
  view.setUint16(26, fileNameBytes.length, true);
  view.setUint16(28, 0, true);
  bytes.set(fileNameBytes, 30);

  return bytes;
}

function createCentralDirectoryHeader(
  fileNameBytes: Uint8Array,
  contentLength: number,
  crc32: number,
  dosTime: number,
  dosDate: number,
  localHeaderOffset: number,
): Uint8Array {
  const { bytes, view } = createByteBuffer(46 + fileNameBytes.length);

  view.setUint32(0, ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION_MADE_BY_UNIX, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc32, true);
  view.setUint32(20, contentLength, true);
  view.setUint32(24, contentLength, true);
  view.setUint16(28, fileNameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, ZIP_EXTERNAL_FILE_ATTRIBUTES, true);
  view.setUint32(42, localHeaderOffset, true);
  bytes.set(fileNameBytes, 46);

  return bytes;
}

function createEndOfCentralDirectoryRecord(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  ensureZipEntrySize(entryCount, 0xffff, 'ZIP 文件数量超过格式限制。');
  ensureZipEntrySize(centralDirectorySize, 0xffffffff, 'ZIP 目录过大。');
  ensureZipEntrySize(centralDirectoryOffset, 0xffffffff, 'ZIP 内容过大。');

  const { bytes, view } = createByteBuffer(22);

  view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return bytes;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export function buildZipBuffer(files: ZipFileEntry[]): ArrayBuffer {
  const localParts: Uint8Array[] = [];
  const centralDirectoryParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const encoder = new TextEncoder();
    const fileNameBytes = encoder.encode(file.path);
    const contentBytes = file.content;

    ensureZipEntrySize(fileNameBytes.length, 0xffff, `ZIP 文件名过长：${file.path}`);
    ensureZipEntrySize(contentBytes.length, 0xffffffff, `ZIP 文件过大：${file.path}`);

    const crc32 = computeCrc32(contentBytes);
    const dosTime = toDosTime(file.mtime);
    const dosDate = toDosDate(file.mtime);
    const localHeader = createLocalFileHeader(fileNameBytes, contentBytes.length, crc32, dosTime, dosDate);
    const centralDirectoryHeader = createCentralDirectoryHeader(
      fileNameBytes,
      contentBytes.length,
      crc32,
      dosTime,
      dosDate,
      localOffset,
    );

    localParts.push(localHeader, contentBytes);
    centralDirectoryParts.push(centralDirectoryHeader);
    localOffset += localHeader.length + contentBytes.length;
  }

  const centralDirectorySize = sumByteLength(centralDirectoryParts);
  const endOfCentralDirectory = createEndOfCentralDirectoryRecord(
    files.length,
    centralDirectorySize,
    localOffset,
  );
  return concatByteArrays([
    ...localParts,
    ...centralDirectoryParts,
    endOfCentralDirectory,
  ]);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

function sumByteLength(parts: Uint8Array[]): number {
  return parts.reduce((total, part) => total + part.length, 0);
}

function concatByteArrays(parts: Uint8Array[]): ArrayBuffer {
  const totalLength = sumByteLength(parts);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result.buffer;
}

function ensureZipEntrySize(value: number, limit: number, message: string): void {
  if (value > limit) {
    throw new Error(message);
  }
}
