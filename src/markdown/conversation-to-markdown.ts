import { t, getDateLocale } from '../i18n';
import { countLines, countWords } from './stats';
import { resolveProjectName } from '../shared/files';
import type {
  Citation,
  ContentReference,
  ConversationNodeMessage,
  ConversationResult,
  Project,
} from '../shared/chatgpt-types';

export type MarkdownOptions = {
  includeFrontmatter: boolean;
  includeTimestamps: boolean;
  timestamp24h: boolean;
  /** 每条消息渲染为围栏代码块（取代 `---` + `## 角色`）。见 ADR 2026-11-24-fenced-message-format */
  fenceMessages: boolean;
};

export type MarkdownMetadata = {
  sourceUrl?: string;
  exportedAt?: string;
  /** 项目导出时写入 frontmatter，普通导出不出现这两个字段 */
  project?: Project;
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
        ...projectFrontmatter(metadata.project),
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

/** 项目导出才有的两个字段；普通导出返回空数组，保证旧输出逐字节不变 */
function projectFrontmatter(project?: MarkdownMetadata['project']): string[] {
  if (!project) {
    return [];
  }

  return [
    `project: ${yamlString(resolveProjectName(project))}`,
    `project_id: ${yamlString(project.id)}`,
  ];
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

      const body = transformContent(message).trim();

      if (!body) return null;

      messageCount += 1;

      return options.fenceMessages
        ? renderFencedBlock(author, timestamp, body)
        : renderSectionBlock(author, timestamp, body);
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

function renderSectionBlock(author: string, timestamp: string, body: string): string {
  return [
    '---',
    `## ${author}`,
    timestamp ? `> ${timestamp}` : '',
    body,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* 围栏消息块：整条消息（含角色名与时间）作为一个代码块。
 *
 * info string 固定为 `text` 而不是角色名 —— 中文角色名作 info string 会让
 * highlight.js 落到自动侦测并把正文误染成随机语言，Python-Markdown 系遇到
 * 带空格的作者名（`Plugin (name)`）还会把整块打散成段落。
 * 详见 ADR 2026-11-24-fenced-message-format 与 research/fence-info-string。
 *
 * 外层围栏长度按正文最长连续反引号 + 1，避免正文里的 ``` 提前闭合外层。 */
function renderFencedBlock(author: string, timestamp: string, body: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  const header = timestamp ? `${author} · ${timestamp}` : author;

  return `${fence}text\n${header}\n\n${body}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;

  for (const char of text) {
    if (char === '`') {
      current += 1;
      longest = Math.max(longest, current);
      continue;
    }

    current = 0;
  }

  return longest;
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
  // 先把代码块/行内代码替换为占位符，避免误替换其中的 \[ \] \\( \\) 字面量
  const codeFragments: string[] = [];

  const protectedText = input
    .replace(/```[\s\S]*?(?:```|$)/g, (match) => {
      codeFragments.push(match);
      return `\u0000CODE${codeFragments.length - 1}\u0000`;
    })
    .replace(/`[^`\n]*`/g, (match) => {
      codeFragments.push(match);
      return `\u0000CODE${codeFragments.length - 1}\u0000`;
    });

  const converted = protectedText
    .replace(/^\\\[(.+)\\\]$/gm, '$$$$ $1 $$$$')
    .replace(/\\\[/g, '$')
    .replace(/\\\]/g, '$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');

  return converted.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeFragments[Number(index)]);
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
