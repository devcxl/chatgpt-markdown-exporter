import sanitizeFilename from 'sanitize-filename';
import type { Project } from './chatgpt-types';

export type NamedTextFile = {
  filename: string;
  content: string;
};

export type NamedZipEntry = {
  filename: string;
  content: string; // 文本内容（.md 文件）
  data?: string; // base64 编码的二进制数据（图片等）
};

export function buildMarkdownFilename(
  title: string,
  chatId: string,
  date = new Date(),
): string {
  return markdownPath('ChatGPT', title, chatId, date);
}

/**
 * 项目导出：ZIP 内按项目名建一层目录，Markdown 与 `assets/` 同层。
 *
 * 目录名不能是空串，否则会退化成 ZIP 根目录、与其它导出物混在一起；
 * 因此项目名为空（或清洗后为空）时回退项目 id。
 */
export function buildProjectMarkdownFilename(
  project: Project,
  title: string,
  chatId: string,
  date = new Date(),
): string {
  return markdownPath(projectDirectoryName(project), title, chatId, date);
}

/** 项目 ZIP 文件名，与项目目录同名以便一眼对应 */
export function buildProjectZipFilename(project: Project, date = new Date()): string {
  return `chatgpt-project-${projectDirectoryName(project)}-${fileStamp(date)}.zip`;
}

/**
 * 项目名的人类可读形态：去空白后为空则回退项目 id。
 *
 * 产物目录、ZIP 名与 frontmatter 的 `project` 字段共用这一条规则 ——
 * 否则「目录叫 g-p-xxx、frontmatter 里是空串」这种自相矛盾的产物就会出现。
 */
export function resolveProjectName(project: Project): string {
  return project.name.trim() || project.id;
}

/** 项目目录名：在人类可读名之上再做文件名清洗（`a/b:c` → `abc`） */
export function projectDirectoryName(project: Project): string {
  return sanitizeFilename(resolveProjectName(project)).trim() || project.id;
}

export function buildCurrentMarkdownFilename(title: string, chatId: string): string {
  const safeTitle = sanitizeFilename(title).trim();
  return `${safeTitle || chatId}.md`;
}

export function buildCurrentZipFilename(title: string, chatId: string): string {
  const safeTitle = sanitizeFilename(title).trim();
  return `chatgpt-${safeTitle || chatId}.zip`;
}

export function buildZipFilename(date = new Date()): string {
  return `chatgpt-export-${fileStamp(date)}.zip`;
}

export function sanitizeDownloadPath(
  input: string,
  fallback = 'download.txt',
): string {
  const segments = input
    .split('/')
    .map(segment => sanitizeFilename(segment).trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return fallback;
  }

  return segments.join('/');
}

export function dedupeNamedFiles<T extends { filename: string }>(files: T[]): T[] {
  const used = new Set<string>();

  return files.map((file) => {
    const safeFilename = sanitizeDownloadPath(file.filename, 'conversation.md');
    const uniqueFilename = buildUniqueFilename(safeFilename, used);
    used.add(uniqueFilename);

    return {
      ...file,
      filename: uniqueFilename,
    };
  });
}

function buildUniqueFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    return filename;
  }

  const { base, ext } = splitFilename(filename);

  let index = 2;
  let candidate = `${base} (${index})${ext}`;

  while (used.has(candidate)) {
    index += 1;
    candidate = `${base} (${index})${ext}`;
  }

  return candidate;
}

function splitFilename(filename: string): { base: string; ext: string } {
  const slashIndex = filename.lastIndexOf('/');
  const dotIndex = filename.lastIndexOf('.');

  if (dotIndex <= slashIndex) {
    return {
      base: filename,
      ext: '',
    };
  }

  return {
    base: filename.slice(0, dotIndex),
    ext: filename.slice(dotIndex),
  };
}

function markdownPath(
  directory: string,
  title: string,
  chatId: string,
  date: Date,
): string {
  const safeTitle = sanitizeFilename(title).trim();
  const datePrefix = date.toISOString().slice(0, 10);

  return `${directory}/${datePrefix}-${safeTitle || chatId}.md`;
}

/** ZIP 文件名的统一时间戳格式（冒号与点在文件名里非法） */
function fileStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
