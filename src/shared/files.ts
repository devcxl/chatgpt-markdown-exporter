import sanitizeFilename from 'sanitize-filename';

export type NamedTextFile = {
  filename: string;
  content: string;
};

export function buildMarkdownFilename(
  title: string,
  chatId: string,
  date = new Date(),
): string {
  const safeTitle = sanitizeFilename(title).trim();
  const datePrefix = date.toISOString().slice(0, 10);

  return `ChatGPT/${datePrefix}-${safeTitle || chatId}.md`;
}

export function buildCurrentMarkdownFilename(title: string, chatId: string): string {
  const safeTitle = sanitizeFilename(title).trim();
  return `${safeTitle || chatId}.md`;
}

export function buildZipFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `chatgpt-export-${stamp}.zip`;
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
