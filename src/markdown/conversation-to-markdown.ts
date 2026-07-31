import { t, getDateLocale } from '../i18n';
import { countLines, countWords } from './stats';
import type {
  Citation,
  ContentReference,
  ConversationNodeMessage,
  ConversationResult,
} from '../shared/chatgpt-types';

export type MarkdownOptions = {
  includeFrontmatter: boolean;
  includeTimestamps: boolean;
  timestamp24h: boolean;
};

export type MarkdownMetadata = {
  sourceUrl?: string;
  exportedAt?: string;
};

export function conversationToMarkdown(
  conversation: ConversationResult,
  options: MarkdownOptions,
  metadata: MarkdownMetadata = {},
): string {
  const source = metadata.sourceUrl ?? `${location.origin}/c/${conversation.id}`;
  const exportedAt = metadata.exportedAt ?? new Date().toISOString();

  const { content, messageCount } = renderContent(conversation, options);
  const normalizedContent = normalizeLineBreaks(content);

  const frontmatter = options.includeFrontmatter
    ? [
        '---',
        `title: ${yamlString(conversation.title)}`,
        `source: ${yamlString(source)}`,
        `model: ${yamlString(conversation.model)}`,
        `model_slug: ${yamlString(conversation.modelSlug)}`,
        `create_time: ${yamlString(toIso(conversation.createTime))}`,
        `update_time: ${yamlString(toIso(conversation.updateTime))}`,
        `exported_at: ${yamlString(exportedAt)}`,
        `author: ${yamlString(t('markdown.authorChatGPT'))}`,
        `word_count: ${countWords(normalizedContent)}`,
        `line_count: ${countLines(normalizedContent)}`,
        `message_count: ${messageCount}`,
        '---',
        '',
      ].join('\n')
    : '';

  return `${frontmatter}# ${conversation.title}\n\n${normalizedContent}\n`;
}

function renderContent(
  conversation: ConversationResult,
  options: MarkdownOptions,
): { content: string; messageCount: number } {
  let messageCount = 0;
  const blocks = conversation.conversationNodes
    .map((node) => {
      const message = node.message;
      if (!message?.content) return null;

      if (shouldSkipMessage(message)) return null;

      const author = transformAuthor(message.author);
      const timestamp = buildTimestamp(message, options);

      const body = transformContent(message);

      if (!body.trim()) return null;

      messageCount += 1;

      return renderMessageBlock(author, timestamp, body.trim());
    })
    .filter(Boolean);
  return { content: blocks.join('\n\n'), messageCount };
}

function shouldSkipMessage(message: ConversationNodeMessage): boolean {
  const contentType = message.content.content_type;

  if (message.metadata?.is_visually_hidden_from_conversation) return true;
  if (contentType === 'thoughts') return true;
  if (contentType === 'reasoning_recap') return true;

  if (message.recipient !== 'all') {
    return true;
  }

  if (message.author.role === 'tool') {
    return contentType !== 'multimodal_text'
      && !(contentType === 'execution_output'
        && message.metadata?.aggregate_result?.messages?.some(x => x.message_type === 'image'));
  }

  return false;
}

function transformAuthor(author: ConversationNodeMessage['author']): string {
  switch (author.role) {
    case 'assistant':
      return t('markdown.authorChatGPT');
    case 'user':
      return t('markdown.authorUser');
    case 'tool':
      return `${t('markdown.authorPlugin')}${author.name ? ` (${author.name})` : ''}`;
    default:
      return author.role;
  }
}

function renderMessageBlock(author: string, timestamp: string, body: string): string {
  return [
    '---',
    `## ${author}`,
    timestamp ? `> ${timestamp}` : '',
    body,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildTimestamp(
  message: ConversationNodeMessage,
  options: MarkdownOptions,
): string {
  if (!options.includeTimestamps || !message.create_time) return '';

  const date = new Date(message.create_time * 1000);

  return date.toLocaleTimeString(getDateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !options.timestamp24h,
  });
}

function transformContent(message: ConversationNodeMessage): string {
  const { content, metadata } = message;

  const postProcess = (input: string) => {
    let output = input;

    if (message.author.role === 'assistant') {
      output = transformContentReferences(output, metadata?.content_references);
      output = transformFootnotes(output, metadata?.citations);
      output = normalizeMath(output);
    }

    return output;
  };

  switch (content.content_type) {
    case 'text': {
      const parts = (content as { parts: string[] }).parts;
      return postProcess(parts?.join('\n') ?? '');
    }

    case 'code':
      return [
        t('markdown.codeLabel'),
        '```',
        content.text ?? '',
        '```',
      ].join('\n');

    case 'execution_output': {
      const images = metadata?.aggregate_result?.messages
        ?.filter(x => x.message_type === 'image')
        ?.map(x => `![image](${x.image_url})`)
        ?.join('\n');

      if (images) return images;

      return postProcess([
        `${t('markdown.resultLabel')}`,
        '```',
        content.text ?? '',
        '```',
      ].join('\n'));
    }

    case 'tether_quote':
      return postProcess(`> ${content.title || content.text || ''}`);

    case 'tether_browsing_display': {
      const list = metadata?._cite_metadata?.metadata_list;

      if (Array.isArray(list) && list.length > 0) {
        return postProcess(
          list.map(({ title, url }) => `> [${title}](${url})`).join('\n'),
        );
      }

      return '';
    }

    case 'multimodal_text': {
      const parts = (content as { parts: Array<string | unknown> }).parts;
      return parts
        ?.map((part) => {
          if (typeof part === 'string') return postProcess(part);

          const partObj = part as Record<string, unknown>;
          const content_type = partObj.content_type as string;
          const assetPointer = partObj.asset_pointer as string | undefined;
          const text = partObj.text as string | undefined;

          if (content_type === 'image_asset_pointer') {
            return `![image](${assetPointer})`;
          }

          if (content_type === 'audio_transcription') {
            return `[${t('markdown.audioLabel')}] ${text}`;
          }

          if (assetPointer) {
            const name = (partObj.name || partObj.filename || partObj.file_name || 'attachment') as string;
            return `[${name}](${assetPointer})`;
          }

          return t('markdown.unsupportedMultimodal', { type: content_type });
        })
        .filter(Boolean)
        .join('\n') ?? '';
    }

    default:
      return t('markdown.unsupportedContent', { type: content.content_type });
  }
}

function transformContentReferences(
  input: string,
  refs?: ContentReference[],
): string {
  if (!refs?.length) return input;

  let output = normalizeUnicode(input);

  const sortedRefs = [...refs].sort(
    (a, b) => (b.matched_text?.length ?? 0) - (a.matched_text?.length ?? 0),
  );

  for (const ref of sortedRefs) {
    if (!ref.matched_text) continue;

    const matchedText = normalizeUnicode(ref.matched_text);

    if (ref.type === 'grouped_webpages') {
      const item = ref.items?.[0];

      if (!item) {
        output = output.replaceAll(matchedText, ref.alt ?? '');
        continue;
      }

      const links: string[] = [
        `[${escapeMarkdownInline(item.attribution || item.title)}](${item.url})`,
      ];

      for (const supporting of item.supporting_websites ?? []) {
        links.push(
          `[${escapeMarkdownInline(supporting.attribution || supporting.title)}](${supporting.url})`,
        );
      }

      output = output.replaceAll(matchedText, `(${links.join(', ')})`);
      continue;
    }

    if (ref.type === 'sources_footnote') {
      continue;
    }

    output = output.replaceAll(matchedText, ref.alt ?? '');
  }

  return output;
}

function transformFootnotes(
  input: string,
  citations?: Citation[],
): string {
  if (!citations?.length) return input;

  const footNoteMarkRegex = /〖(\d+)†\((.+?)\)〗/g;
  const used = new Map<number, string>();

  const output = input.replace(footNoteMarkRegex, (match, citeIndexRaw) => {
    const citeIndex = Number(citeIndexRaw);
    const citation = citations.find(
      x => x.metadata?.extra?.cited_message_idx === citeIndex,
    );

    if (!citation) return match;

    const title = citation.metadata?.title ?? 'No title';
    const url = citation.metadata?.url;

    used.set(
      citeIndex,
      url
        ? `[^${citeIndex}]: [${escapeMarkdownInline(title)}](${url})`
        : `[^${citeIndex}]: ${title}`,
    );

    return `[^${citeIndex}]`;
  });

  if (used.size === 0) return output;

  return `${output}\n\n${Array.from(used.values()).join('\n')}`;
}

function normalizeMath(input: string): string {
  return input
    .replace(/^\\\[(.+)\\\]$/gm, '$$$$ $1 $$$$')
    .replace(/\\\[/g, '$')
    .replace(/\\\]/g, '$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
}

function yamlString(input: string): string {
  return JSON.stringify(input ?? '');
}

function toIso(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toISOString();
}

function normalizeLineBreaks(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
}

function normalizeUnicode(input: string): string {
  return input
    .replaceAll(/[   ⁠]/gu, ' ')
    .replaceAll(/[‐-―−]/gu, '-');
}

function escapeMarkdownInline(input: string): string {
  return input.replace(/([\[\]])/g, '\\$1');
}
