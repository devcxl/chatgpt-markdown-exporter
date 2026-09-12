import type { NamedTextFile, NamedZipEntry } from './files';
import type { DownloadMarkdownMessage, DownloadZipMessage } from './messages';

/**
 * 决定下载形式：
 * - 单个会话且没有图片等二进制资源 → 直接下载 .md，用户无需为单个文件解压
 * - 多个会话或含二进制资源 → 打包成一个 ZIP
 */
export function buildDownloadMessage(
  files: NamedZipEntry[],
  zipFilename: string,
  saveAs = true,
): DownloadMarkdownMessage | DownloadZipMessage {
  const [only] = files;

  if (files.length === 1 && only.data === undefined) {
    return {
      type: 'DOWNLOAD_MARKDOWN',
      file: {
        filename: basename(only.filename),
        content: only.content,
      } satisfies NamedTextFile,
      saveAs,
    };
  }

  return {
    type: 'DOWNLOAD_ZIP',
    filename: zipFilename,
    files,
    saveAs,
  };
}

/** 单文件下载时去掉 ZIP 内的目录层级（ChatGPT/标题.md → 标题.md） */
function basename(filename: string): string {
  return filename.slice(filename.lastIndexOf('/') + 1);
}
