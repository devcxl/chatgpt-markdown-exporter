import { fetchApi } from './api';
import type { ApiConversation, ConversationNode } from '../../shared/chatgpt-types';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/gzip': 'gz',
  'application/x-rar-compressed': 'rar',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'application/octet-stream': 'bin',
};

export type ResolvedImage = {
  pointer: string;
  base64: string;
  mimeType: string;
};

export type ImageFileEntry = {
  filename: string;
  data: string;
};

async function fetchImageBlob(assetPointer: string): Promise<{ blob: Blob; mimeType: string }> {
  const pointer = assetPointer.replace('sediment://', '');
  const { download_url } = await fetchApi<{ download_url: string }>(
    `/files/${encodeURIComponent(pointer)}/download`,
  );
  const response = await fetch(download_url);
  const blob = await response.blob();
  const mimeType = blob.type || response.headers.get('content-type') || 'application/octet-stream';

  return { blob, mimeType };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function generateAssetFilename(mimeType: string, existing: Set<string>, prefix = ''): string {
  const ext = MIME_TO_EXT[mimeType]
    ?? MIME_TO_EXT[`${mimeType.split('/')[0]}/*`]
    ?? (Object.keys(MIME_TO_EXT).find(k => k.startsWith(mimeType.split(';')[0])) || 'bin');

  let filename: string;

  do {
    const uuid = crypto.randomUUID();
    filename = `${prefix}assets/${uuid}.${ext}`;
  } while (existing.has(filename));

  existing.add(filename);
  return filename;
}

function traverseAndReplace(
  conversation: ApiConversation,
  visitor: (node: NonNullable<ConversationNode['message']>) => void,
): void {
  for (const node of Object.values(conversation.mapping)) {
    const msg = node.message;
    if (!msg?.content) continue;
    visitor(msg);
  }
}

function isMultimodalText(content: unknown): content is { parts: Array<string | unknown> } {
  return typeof content === 'object' && content !== null
    && (content as Record<string, unknown>).content_type === 'multimodal_text'
    && Array.isArray((content as Record<string, unknown>).parts);
}

function scanConversationPointers(conversation: ApiConversation): string[] {
  const pointers = new Set<string>();

  traverseAndReplace(conversation, (msg) => {
    if (isMultimodalText(msg.content)) {
      for (const part of msg.content.parts) {
        if (typeof part === 'string') continue;

        const p = part as Record<string, unknown>;
        const ptr = p.asset_pointer as string | undefined;

        if (ptr?.startsWith('sediment://')) {
          pointers.add(ptr);
        }
      }
    }

    if (msg.metadata?.aggregate_result?.messages) {
      for (const img of msg.metadata.aggregate_result.messages) {
        if (img.message_type === 'image' && img.image_url?.startsWith('sediment://')) {
          pointers.add(img.image_url);
        }
      }
    }
  });

  return [...pointers];
}

export async function resolveImagesAsFileRefs(
  conversation: ApiConversation,
  imageEntries: ImageFileEntry[],
  prefix = '',
): Promise<void> {
  const pointers = scanConversationPointers(conversation);

  if (pointers.length === 0) return;

  const results = await downloadImages(pointers);
  const usedFilenames = new Set<string>();
  const pointerToFilename = new Map<string, string>();

  for (const [pointer, resolved] of results) {
    const filename = generateAssetFilename(resolved.mimeType, usedFilenames, prefix);
    pointerToFilename.set(pointer, filename);
    imageEntries.push({ filename, data: resolved.base64 });
  }

  traverseAndReplace(conversation, (msg) => {
    if (isMultimodalText(msg.content)) {
      for (const part of msg.content.parts) {
        if (typeof part === 'string') continue;

        const p = part as Record<string, unknown>;
        const ptr = p.asset_pointer as string | undefined;

        if (ptr) {
          const filename = pointerToFilename.get(ptr);
          if (filename) p.asset_pointer = filename;
        }
      }
    }

    if (msg.metadata?.aggregate_result?.messages) {
      for (const img of msg.metadata.aggregate_result.messages) {
        if (img.message_type === 'image') {
          const filename = pointerToFilename.get(img.image_url);
          if (filename) img.image_url = filename;
        }
      }
    }
  });
}

async function downloadImages(pointers: string[]): Promise<Map<string, ResolvedImage>> {
  const results = new Map<string, ResolvedImage>();

  const entries = await Promise.allSettled(
    pointers.map(async (pointer) => {
      const { blob, mimeType } = await fetchImageBlob(pointer);
      const base64 = await blobToBase64(blob);

      return { pointer, base64, mimeType } satisfies ResolvedImage;
    }),
  );

  for (const entry of entries) {
    if (entry.status === 'fulfilled') {
      results.set(entry.value.pointer, entry.value);
    }
    else {
      console.error('资源下载失败:', entry.reason);
    }
  }

  return results;
}
