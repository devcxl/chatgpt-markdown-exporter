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
  /* 项目导出必须保留目录层级与 ZIP 文件名：单个会话时拍平成 .md 会把
   * `<项目名>/` 目录整个丢掉，产物与「导出整个项目」的语义不符。 */
  forceZip = false,
): DownloadMarkdownMessage | DownloadZipMessage {
  const [only] = files;

  if (!forceZip && files.length === 1 && only.data === undefined) {
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
