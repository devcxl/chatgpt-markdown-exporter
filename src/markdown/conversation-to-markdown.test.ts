import { describe, it, expect } from 'vitest';
import { t } from '../i18n';
import type {
  ConversationContent,
  ConversationNode,
  ConversationNodeMessage,
  ConversationResult,
} from '../shared/chatgpt-types';
import { conversationToMarkdown, type MarkdownOptions } from './conversation-to-markdown.ts';
import { countLines, countWords } from './stats.ts';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const baseOptions: MarkdownOptions = {
  includeFrontmatter: true,
  includeTimestamps: false,
  timestamp24h: true,
};

const metadata = {
  sourceUrl: 'https://chatgpt.com/c/test-conversation',
  exportedAt: '2026-01-01T00:00:00.000Z',
};

function createMessage(
  role: ConversationNodeMessage['author']['role'],
  content: ConversationContent,
  overrides: Partial<ConversationNodeMessage> = {},
): ConversationNodeMessage {
  return {
    id: `${role}-message`,
    author: { role, name: role === 'tool' ? 'test' : undefined },
    content,
    recipient: role === 'system' ? 'system' : 'all',
    metadata: {},
    ...overrides,
  };
}

function createConversation(messages: ConversationNodeMessage[]): ConversationResult {
  return {
    id: 'test-conversation',
    title: 'Test Conversation',
    model: 'gpt-4',
    modelSlug: 'gpt-4',
    createTime: 0,
    updateTime: 0,
    conversationNodes: messages.map(
      (message): ConversationNode => ({ id: message.id, children: [], message }),
    ),
  };
}

function createToolImageMessage(): ConversationNodeMessage {
  return createMessage('tool', { content_type: 'execution_output', text: '' }, {
    metadata: {
      aggregate_result: {
        messages: [{ message_type: 'image', image_url: 'https://example.com/img.png' }],
      },
    },
  });
}

/** 主 fixture：user + assistant + system（应被过滤）+ tool 带图（应计入） */
function createFixture(): ConversationResult {
  return createConversation([
    createMessage('user', { content_type: 'text', parts: ['Hello world'] }),
    createMessage('assistant', { content_type: 'text', parts: ['你好世界'] }),
    createMessage('system', { content_type: 'text', parts: ['system message'] }),
    createToolImageMessage(),
  ]);
}

const authorChatGPT = t('markdown.authorChatGPT');
const authorUser = t('markdown.authorUser');
const authorPlugin = t('markdown.authorPlugin');

/** 主 fixture 的正文（normalize 后无 4+ 连续换行，与原始一致） */
const expectedBody = [
  '---',
  `## ${authorUser}`,
  'Hello world',
  '---',
  `## ${authorChatGPT}`,
  '你好世界',
  '---',
  `## ${authorPlugin} (test)`,
  '![image](https://example.com/img.png)',
].join('\n\n');

/** 提取 frontmatter 字段（不含 --- 分隔行） */
function extractFrontmatter(output: string): Record<string, string> {
  const lines = output.split('\n');
  const fields: Record<string, string> = {};
  const end = lines.indexOf('---', 1);
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(':');
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

/** 提取 frontmatter 之后的正文（即统计对象，不含 # title 行） */
function extractBody(output: string): string {
  const bodyStart = output.indexOf('# ');
  return output.slice(output.indexOf('\n', bodyStart) + 1).replace(/^\n/, '');
}

/* ------------------------------------------------------------------ */
/*  Tests — frontmatter stats fields                                  */
/* ------------------------------------------------------------------ */

describe('conversationToMarkdown frontmatter stats', () => {
  it('adds word_count / line_count / message_count matching the body', () => {
    const output = conversationToMarkdown(createFixture(), baseOptions, metadata);
    const fields = extractFrontmatter(output);

    expect(fields).toMatchObject({
      word_count: String(countWords(expectedBody)),
      line_count: String(countLines(expectedBody)),
      message_count: '3',
    });
  });

  it('message_count equals the number of rendered message blocks (---)', () => {
    const output = conversationToMarkdown(createFixture(), baseOptions, metadata);
    const blockCount = (extractBody(output).match(/^---$/gm) ?? []).length;

    expect(blockCount).toBe(3);
    expect(Number(extractFrontmatter(output).message_count)).toBe(blockCount);
  });

  it('excludes system messages from message_count', () => {
    const conversation = createConversation([
      createMessage('user', { content_type: 'text', parts: ['Hello'] }),
      createMessage('system', { content_type: 'text', parts: ['system message'] }),
      createMessage('assistant', { content_type: 'text', parts: ['Hi'] }),
    ]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);

    expect(extractFrontmatter(output).message_count).toBe('2');
  });

  it('includes tool messages rendered with an image', () => {
    const conversation = createConversation([createToolImageMessage()]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);
    const fields = extractFrontmatter(output);

    expect(fields.message_count).toBe('1');
    expect(extractBody(output)).toContain('![image](https://example.com/img.png)');
  });

  it('excludes messages with an empty body (empty tether_browsing_display)', () => {
    const conversation = createConversation([
      createMessage('user', { content_type: 'text', parts: ['Hello'] }),
      createMessage('assistant', { content_type: 'tether_browsing_display' }),
    ]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);

    expect(extractFrontmatter(output).message_count).toBe('1');
  });

  it('outputs nothing stat-related and stays byte-identical when includeFrontmatter is false', () => {
    const output = conversationToMarkdown(
      createFixture(),
      { ...baseOptions, includeFrontmatter: false },
      metadata,
    );

    expect(output).toBe(`# Test Conversation\n\n${expectedBody}\n`);
    expect(output).not.toContain('word_count');
    expect(output).not.toContain('line_count');
    expect(output).not.toContain('message_count');
  });
});

/* ------------------------------------------------------------------ */
/*  Tests — counting across locales                                    */
/* ------------------------------------------------------------------ */

describe('conversationToMarkdown word counting', () => {
  it('counts a pure-Chinese conversation', () => {
    const conversation = createConversation([
      createMessage('user', { content_type: 'text', parts: ['你好世界'] }),
      createMessage('assistant', { content_type: 'text', parts: ['谢谢'] }),
    ]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);
    const body = extractBody(output);

    expect(extractFrontmatter(output).word_count).toBe(String(countWords(body)));
    expect(extractFrontmatter(output).line_count).toBe(String(countLines(body)));
  });

  it('counts a pure-English conversation', () => {
    const conversation = createConversation([
      createMessage('user', { content_type: 'text', parts: ['Hello world'] }),
      createMessage('assistant', { content_type: 'text', parts: ['Good morning'] }),
    ]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);
    const body = extractBody(output);

    expect(extractFrontmatter(output).word_count).toBe(String(countWords(body)));
    expect(extractFrontmatter(output).line_count).toBe(String(countLines(body)));
  });

  it('counts a mixed Chinese-English conversation', () => {
    const conversation = createConversation([
      createMessage('user', { content_type: 'text', parts: ['Hello世界'] }),
      createMessage('assistant', { content_type: 'text', parts: ['好的，let me check'] }),
    ]);
    const output = conversationToMarkdown(conversation, baseOptions, metadata);
    const body = extractBody(output);

    expect(extractFrontmatter(output).word_count).toBe(String(countWords(body)));
    expect(extractFrontmatter(output).line_count).toBe(String(countLines(body)));
  });
});
