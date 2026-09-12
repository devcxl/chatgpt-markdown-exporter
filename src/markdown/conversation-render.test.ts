import { describe, it, expect } from 'vitest';
import { t } from '../i18n';
import type {
  ConversationContent,
  ConversationNode,
  ConversationNodeMessage,
  ConversationResult,
} from '../shared/chatgpt-types';
import { conversationToMarkdown } from './conversation-to-markdown.ts';

/* 本文件覆盖 conversation-to-markdown 的渲染分支（内容类型 → Markdown 片段）。
 * frontmatter 统计字段由 conversation-to-markdown.test.ts 覆盖，二者互补。 */

const options = {
  includeFrontmatter: false,
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
    id: `${role}-${Math.random().toString(36).slice(2, 8)}`,
    author: { role },
    content,
    recipient: 'all',
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

/** 去掉标题行，只保留消息正文 */
function bodyOf(conversation: ConversationResult): string {
  const output = conversationToMarkdown(conversation, options, metadata);
  return output.slice(output.indexOf('\n\n') + 2);
}

function renderOne(message: ConversationNodeMessage): string {
  return bodyOf(createConversation([message]));
}

/* ------------------------------------------------------------------ */
/*  内容类型渲染                                                       */
/* ------------------------------------------------------------------ */

describe('内容类型 → Markdown', () => {
  it('text 类型的多个 part 以换行连接', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['a', 'b'] }));

    expect(body).toContain('a\nb');
  });

  it('text 类型 parts 缺失时输出空正文（该消息被跳过）', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: undefined as unknown as string[] }));

    expect(body.trim()).toBe('');
  });

  it('code 类型渲染为带语言无关的围栏代码块', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'code', text: 'const a = 1;' }));

    expect(body).toContain(t('markdown.codeLabel'));
    expect(body).toContain('```\nconst a = 1;\n```');
  });

  it('execution_output 无图时渲染 Result 代码块', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'execution_output', text: '42' }, {
      metadata: { aggregate_result: { messages: [] } },
    }));

    expect(body).toContain(t('markdown.resultLabel'));
    expect(body).toContain('```\n42\n```');
  });

  it('execution_output 带图时只渲染图片引用', () => {
    const body = renderOne(createMessage('tool', { content_type: 'execution_output', text: '' }, {
      metadata: {
        aggregate_result: {
          messages: [{ message_type: 'image', image_url: 'assets/a.png' }],
        },
      },
    }));

    expect(body).toContain('![image](assets/a.png)');
    expect(body).not.toContain(t('markdown.resultLabel'));
  });

  it('tether_quote 渲染为引用块', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'tether_quote',
      title: '引用标题',
      text: '引用正文',
    }));

    expect(body).toContain('> 引用标题');
  });

  it('tether_quote 仅有 text 时用 text', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'tether_quote',
      text: '只有正文',
    }));

    expect(body).toContain('> 只有正文');
  });

  it('tether_browsing_display 渲染来源链接列表', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'tether_browsing_display' }, {
      metadata: {
        _cite_metadata: {
          metadata_list: [
            { title: '来源一', url: 'https://a.example' },
            { title: '来源二', url: 'https://b.example' },
          ],
        },
      },
    }));

    expect(body).toContain('> [来源一](https://a.example)');
    expect(body).toContain('> [来源二](https://b.example)');
  });

  it('tether_browsing_display 无元数据时不输出内容', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'tether_browsing_display' }));

    expect(body.trim()).toBe('');
  });

  it('tether_browsing_display 元数据为空数组时不输出内容', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'tether_browsing_display' }, {
      metadata: { _cite_metadata: { metadata_list: [] } },
    }));

    expect(body.trim()).toBe('');
  });

  it('未知 content_type 输出占位提示而不是丢弃消息', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'totally_new_type' }));

    expect(body).toContain('totally_new_type');
  });
});

/* ------------------------------------------------------------------ */
/*  multimodal_text                                                   */
/* ------------------------------------------------------------------ */

describe('multimodal_text 渲染', () => {
  it('字符串分段按正文输出', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: ['普通文本'],
    }));

    expect(body).toContain('普通文本');
  });

  it('image_asset_pointer 渲染为图片引用', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'assets/x.png' }],
    }));

    expect(body).toContain('![image](assets/x.png)');
  });

  it('audio_transcription 渲染为音频标记加文本', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: [{ content_type: 'audio_transcription', text: '转写内容' }],
    }));

    expect(body).toContain(`[${t('markdown.audioLabel')}] 转写内容`);
  });

  it('带 asset_pointer 的附件优先用 name / filename / file_name', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: [
        { content_type: 'file', asset_pointer: 'assets/1.pdf', name: 'report.pdf' },
        { content_type: 'file', asset_pointer: 'assets/2.pdf', filename: 'second.pdf' },
        { content_type: 'file', asset_pointer: 'assets/3.pdf', file_name: 'third.pdf' },
      ],
    }));

    expect(body).toContain('[report.pdf](assets/1.pdf)');
    expect(body).toContain('[second.pdf](assets/2.pdf)');
    expect(body).toContain('[third.pdf](assets/3.pdf)');
  });

  it('带 asset_pointer 但无名称时回退 attachment', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: [{ content_type: 'file', asset_pointer: 'assets/x.bin' }],
    }));

    expect(body).toContain('[attachment](assets/x.bin)');
  });

  it('既无 asset_pointer 也无已知类型时输出不支持提示', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'multimodal_text',
      parts: [{ content_type: 'mystery_part' }],
    }));

    expect(body).toContain(t('markdown.unsupportedMultimodal', { type: 'mystery_part' }));
  });
});

/* ------------------------------------------------------------------ */
/*  引用 / 脚注 / 公式                                                 */
/* ------------------------------------------------------------------ */

describe('content_references 替换', () => {
  const base = 'see ￼ for details';

  it('grouped_webpages 替换为带附加来源的链接', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: [base] }, {
      metadata: {
        content_references: [{
          type: 'grouped_webpages',
          matched_text: '￼',
          items: [{
            title: '主来源',
            url: 'https://main.example',
            attribution: 'main.example',
            supporting_websites: [{
              title: '附加来源',
              url: 'https://extra.example',
              attribution: 'extra.example',
            }],
          }],
        }],
      },
    }));

    expect(body).toContain('[main.example](https://main.example)');
    expect(body).toContain('[extra.example](https://extra.example)');
  });

  it('grouped_webpages 无 items 时替换为 alt 文本', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: [base] }, {
      metadata: {
        content_references: [{
          type: 'grouped_webpages',
          matched_text: '￼',
          alt: '替代文本',
        }],
      },
    }));

    expect(body).toContain('替代文本');
  });

  it('其他类型替换为 alt 文本', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: [base] }, {
      metadata: {
        content_references: [{
          type: 'sources_footnote_marker',
          matched_text: '￼',
          alt: '角标',
        }],
      },
    }));

    expect(body).toContain('角标');
  });

  it('matched_text 缺失的引用被忽略', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['原文'] }, {
      metadata: {
        content_references: [{ type: 'grouped_webpages', alt: '不应出现' }],
      },
    }));

    expect(body).toContain('原文');
    expect(body).not.toContain('不应出现');
  });

  it('长 matched_text 优先替换，避免短串抢先匹配', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['ab'] }, {
      metadata: {
        content_references: [
          { type: 'other', matched_text: 'a', alt: 'A' },
          { type: 'other', matched_text: 'ab', alt: 'AB' },
        ],
      },
    }));

    expect(body).toContain('AB');
  });

  it('sources_footnote 类型跳过替换（由脚注处理）', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['正文 ￼'] }, {
      metadata: {
        content_references: [{
          type: 'sources_footnote',
          matched_text: '￼',
          alt: '不应出现',
        }],
      },
    }));

    expect(body).toContain('正文 ￼');
  });

  it('全角空格与特殊连字符在匹配前做归一化', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['a b'] }, {
      metadata: {
        content_references: [{ type: 'other', matched_text: 'a\u00a0b', alt: '命中' }],
      },
    }));

    expect(body).toContain('命中');
  });
});

describe('citations 脚注', () => {
  it('命中引用时替换角标并追加脚注定义', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['结论〖1†(source)〗'],
    }, {
      metadata: {
        citations: [{
          metadata: {
            extra: { cited_message_idx: 1, evidence_text: 'evidence' },
            title: '标题',
            url: 'https://source.example',
          },
        }],
      },
    }));

    expect(body).toContain('[^1]');
    expect(body).toContain('[^1]: [标题](https://source.example)');
  });

  it('命中引用但没有 URL 时只输出标题', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['结论〖1†(source)〗'],
    }, {
      metadata: {
        citations: [{
          metadata: {
            extra: { cited_message_idx: 1, evidence_text: 'evidence' },
            title: '无链接标题',
          },
        }],
      },
    }));

    expect(body).toContain('[^1]: 无链接标题');
  });

  it('引用没有 title 时使用 No title 占位', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['结论〖1†(source)〗'],
    }, {
      metadata: {
        citations: [{ metadata: { extra: { cited_message_idx: 1, evidence_text: 'e' } } }],
      },
    }));

    expect(body).toContain('No title');
  });

  it('找不到对应 citation 时保留原始角标', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['结论〖9†(missing)〗'],
    }, {
      metadata: {
        citations: [{
          metadata: { extra: { cited_message_idx: 1, evidence_text: 'e' }, title: 'T' },
        }],
      },
    }));

    expect(body).toContain('〖9†(missing)〗');
  });

  it('重复引用同一编号时脚注只输出一次', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['一〖1†(a)〗 二〖1†(b)〗'],
    }, {
      metadata: {
        citations: [{
          metadata: {
            extra: { cited_message_idx: 1, evidence_text: 'e' },
            title: 'T',
            url: 'https://s.example',
          },
        }],
      },
    }));

    const definitions = body.match(/\[\^1\]:/g) ?? [];
    expect(definitions).toHaveLength(1);
  });

  it('citations 为空数组时不改动正文', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['结论〖1†(source)〗'],
    }, { metadata: { citations: [] } }));

    expect(body).toContain('〖1†(source)〗');
  });
});

describe('数学公式归一化', () => {
  it('行间公式 \\[...\\] 转为 $$ 包裹', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['\\[x^2\\]'],
    }));

    expect(body).toContain('$$ x^2 $$');
  });

  it('行内公式 \\(..\\) 转为 $ 包裹', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['\\(y\\)'],
    }));

    expect(body).toContain('$y$');
  });

  it('代码块内的公式字面量保持原样', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['```\n\\(not math\\)\n```'],
    }));

    expect(body).toContain('\\(not math\\)');
  });

  it('行内代码内的公式字面量保持原样', () => {
    const body = renderOne(createMessage('assistant', {
      content_type: 'text',
      parts: ['`\\(also not math\\)`'],
    }));

    expect(body).toContain('`\\(also not math\\)`');
  });

  it('user 消息不做数学与引用转换', () => {
    const body = renderOne(createMessage('user', {
      content_type: 'text',
      parts: ['\\(keep\\)'],
    }));

    expect(body).toContain('\\(keep\\)');
  });
});

/* ------------------------------------------------------------------ */
/*  消息级过滤与排版                                                   */
/* ------------------------------------------------------------------ */

describe('消息过滤与排版', () => {
  it('过滤 visually_hidden / thoughts / reasoning_recap', () => {
    const body = bodyOf(createConversation([
      createMessage('assistant', { content_type: 'text', parts: ['可见'] }),
      createMessage('assistant', { content_type: 'text', parts: ['隐藏'] }, {
        metadata: { is_visually_hidden_from_conversation: true },
      }),
      createMessage('assistant', { content_type: 'thoughts', thoughts: [] }),
      createMessage('assistant', { content_type: 'reasoning_recap', content: 'recap' }),
    ]));

    expect(body).toContain('可见');
    expect(body).not.toContain('隐藏');
    expect(body).not.toContain('recap');
  });

  it('过滤 recipient 非 all 的消息（如浏览器工具中间态）', () => {
    const body = bodyOf(createConversation([
      createMessage('assistant', { content_type: 'text', parts: ['最终回答'] }, { recipient: 'all' }),
      createMessage('assistant', { content_type: 'text', parts: ['中间态'] }, { recipient: 'browser' }),
    ]));

    expect(body).toContain('最终回答');
    expect(body).not.toContain('中间态');
  });

  it('tool 消息仅在带图或多模态时渲染', () => {
    const body = bodyOf(createConversation([
      createMessage('tool', { content_type: 'text', parts: ['工具文本'] }, { recipient: 'all' }),
      createMessage('tool', { content_type: 'execution_output', text: '纯文本输出' }, { recipient: 'all' }),
    ]));

    expect(body).not.toContain('工具文本');
    expect(body).not.toContain('纯文本输出');
  });

  it('tool 消息带图片时渲染', () => {
    const body = bodyOf(createConversation([
      createMessage('tool', { content_type: 'execution_output', text: '' }, {
        recipient: 'all',
        metadata: {
          aggregate_result: { messages: [{ message_type: 'image', image_url: 'assets/t.png' }] },
        },
      }),
    ]));

    expect(body).toContain('![image](assets/t.png)');
  });

  it('无 message 或内容为空白的节点不产生消息块', () => {
    const conversation = createConversation([
      createMessage('assistant', { content_type: 'text', parts: ['   '] }),
    ]);
    conversation.conversationNodes.push({ id: 'empty', children: [] });

    const output = conversationToMarkdown(conversation, options, metadata);

    expect(output).not.toContain('## ');
  });

  it('tool 作者名带括号后缀，无 name 时只输出角色名', () => {
    const withName = bodyOf(createConversation([
      createMessage('tool', { content_type: 'multimodal_text', parts: ['x'] }, {
        author: { role: 'tool', name: 'python' },
      }),
    ]));
    const withoutName = bodyOf(createConversation([
      createMessage('tool', { content_type: 'multimodal_text', parts: ['x'] }, {
        author: { role: 'tool' },
      }),
    ]));

    expect(withName).toContain(`${t('markdown.authorPlugin')} (python)`);
    expect(withoutName).toContain(`## ${t('markdown.authorPlugin')}\n`);
  });

  it('时间戳开关关闭时不输出引用行', () => {
    const body = renderOne(createMessage('assistant', { content_type: 'text', parts: ['x'] }, {
      create_time: 1700000000,
    }));

    expect(body).not.toContain('> ');
  });

  it('时间戳开启时输出时间行', () => {
    const output = conversationToMarkdown(
      createConversation([
        createMessage('assistant', { content_type: 'text', parts: ['x'] }, { create_time: 1700000000 }),
      ]),
      { includeFrontmatter: false, includeTimestamps: true, timestamp24h: true },
      metadata,
    );

    expect(output).toMatch(/> \d{2}:\d{2}/);
  });

  it('开启时间戳但消息无 create_time 时不输出时间行', () => {
    const output = conversationToMarkdown(
      createConversation([
        createMessage('assistant', { content_type: 'text', parts: ['x'] }),
      ]),
      { includeFrontmatter: false, includeTimestamps: true, timestamp24h: true },
      metadata,
    );

    expect(output).not.toContain('> ');
  });

  it('12 小时制时间戳带 AM/PM', () => {
    const output = conversationToMarkdown(
      createConversation([
        createMessage('assistant', { content_type: 'text', parts: ['x'] }, { create_time: 1700000000 }),
      ]),
      { includeFrontmatter: false, includeTimestamps: true, timestamp24h: false },
      metadata,
    );

    expect(output).toMatch(/AM|PM/i);
  });

  it('连续空行被压缩为最多两个空行', () => {
    const output = conversationToMarkdown(
      createConversation([
        createMessage('assistant', { content_type: 'text', parts: ['a\n\n\n\n\nb'] }),
      ]),
      options,
      metadata,
    );

    expect(output).not.toMatch(/\n{4,}/);
  });

  it('CRLF 被归一化为 LF', () => {
    const output = conversationToMarkdown(
      createConversation([
        createMessage('assistant', { content_type: 'text', parts: ['a\r\nb'] }),
      ]),
      options,
      metadata,
    );

    expect(output).not.toContain('\r');
  });
});

/* ------------------------------------------------------------------ */
/*  Frontmatter                                                        */
/* ------------------------------------------------------------------ */

describe('frontmatter', () => {
  const conversation = createConversation([
    createMessage('user', { content_type: 'text', parts: ['hi'] }),
  ]);

  it('包含 frontmatter 时输出 YAML 头与字段', () => {
    const output = conversationToMarkdown(
      conversation,
      { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true },
      metadata,
    );

    expect(output.startsWith('---\n')).toBe(true);
    expect(output).toContain('title: "Test Conversation"');
    expect(output).toContain('source: "https://chatgpt.com/c/test-conversation"');
    expect(output).toContain('exported_at: "2026-01-01T00:00:00.000Z"');
  });

  it('不包含 frontmatter 时直接以标题开头', () => {
    const output = conversationToMarkdown(conversation, options, metadata);

    expect(output.startsWith('# Test Conversation')).toBe(true);
    expect(output).not.toContain('---\ntitle:');
  });

  it('createTime 为 0 时时间字段输出空串', () => {
    const output = conversationToMarkdown(
      conversation,
      { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true },
      metadata,
    );

    expect(output).toContain('create_time: ""');
  });

  it('未传 metadata 时使用默认 sourceUrl 与当前时间', () => {
    const output = conversationToMarkdown(
      conversation,
      { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true },
    );

    expect(output).toContain('/c/test-conversation');
    expect(output).toMatch(/exported_at: "\d{4}-\d{2}-\d{2}T/);
  });

  it('标题中的引号被 YAML 转义', () => {
    const tricky = { ...conversation, title: 'a "quoted" title' };
    const output = conversationToMarkdown(
      tricky,
      { includeFrontmatter: true, includeTimestamps: false, timestamp24h: true },
      metadata,
    );

    expect(output).toContain('title: "a \\"quoted\\" title"');
  });
});
