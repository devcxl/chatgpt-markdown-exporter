import { describe, it, expect } from 'vitest';
import type { ApiConversation, ConversationNode, ConversationNodeMessage } from '../../shared/chatgpt-types';
import { processConversation } from './process-conversation.ts';

/* processConversation 把 ChatGPT 原始 mapping 转成线性消息序列。重点：
 * 1) 从 current_node 沿 parent 回溯并输出正序
 * 2) 过滤 system / *_editable_context 节点
 * 3) 连续 assistant 分段消息合并（流式回答）
 * 4) 模型名映射
 *
 * 注意：真实 mapping 顶层存在一个无 message 的合成根节点（parent 缺省），
 * 回溯在遇到 parent 缺省的节点时终止，因此夹具必须包含它，否则首条消息会被丢掉。 */

const SYNTHETIC_ROOT = 'client-created-root';

function node(
  id: string,
  parent: string | undefined,
  message?: ConversationNodeMessage,
): ConversationNode {
  return { id, parent, children: [], message };
}

function createRoot(): ConversationNode {
  return node(SYNTHETIC_ROOT, undefined);
}

function message(
  overrides: Partial<ConversationNodeMessage> & { role?: ConversationNodeMessage['author']['role'] } = {},
): ConversationNodeMessage {
  const { role = 'assistant', ...rest } = overrides;

  return {
    id: 'm',
    author: { role },
    recipient: 'all',
    content: { content_type: 'text', parts: ['hello'] },
    ...rest,
  };
}

function apiConversation(
  nodes: ConversationNode[],
  current?: string,
): ApiConversation & { id: string } {
  const all = [createRoot(), ...nodes];

  // 真实数据的 children 与 parent 一致，用 parent 反推，避免夹具与生产数据形态不一致
  // （例如「回退到叶子节点」依赖 children 为空来判断叶子）。
  for (const item of all) {
    item.children = all
      .filter(candidate => candidate.parent === item.id)
      .map(candidate => candidate.id);
  }

  return {
    id: 'chat-1',
    title: 'Test Chat',
    create_time: 1700000000,
    update_time: 1700000100,
    current_node: current ?? all[all.length - 1].id,
    mapping: Object.fromEntries(all.map(n => [n.id, n])),
  };
}

function userMessage(text: string): ConversationNodeMessage {
  return message({ role: 'user', content: { content_type: 'text', parts: [text] } });
}

function assistantMessage(text: string): ConversationNodeMessage {
  return message({ content: { content_type: 'text', parts: [text] } });
}

describe('processConversation 消息提取', () => {
  it('沿 parent 回溯并输出正序消息', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
      node('a1', 'u1', assistantMessage('答')),
    ]));

    expect(result.conversationNodes.map(n => n.id)).toEqual(['u1', 'a1']);
  });

  it('只取当前分支，忽略其他分支的节点', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
      node('a-old', 'u1', assistantMessage('旧回答')),
      node('a-new', 'u1', assistantMessage('新回答')),
    ], 'a-new'));

    expect(result.conversationNodes.map(n => n.id)).toEqual(['u1', 'a-new']);
  });

  it('current_node 为空时回退到叶子节点', () => {
    const conversation = apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
      node('a1', 'u1', assistantMessage('答')),
    ]);
    conversation.current_node = '';

    expect(processConversation(conversation).conversationNodes.map(n => n.id))
      .toEqual(['u1', 'a1']);
  });

  it('既无 current_node 也无叶子节点时抛出错误', () => {
    const conversation: ApiConversation & { id: string } = {
      id: 'chat-1',
      title: 'T',
      create_time: 0,
      update_time: 0,
      current_node: '',
      mapping: { only: { id: 'only', children: ['child'] } },
    };

    expect(() => processConversation(conversation)).toThrow();
  });

  it('过滤 system 与 editable_context 节点', () => {
    const result = processConversation(apiConversation([
      node('sys', SYNTHETIC_ROOT, message({ role: 'system' })),
      node('ctx', 'sys', message({ content: { content_type: 'user_editable_context' } })),
      node('mctx', 'ctx', message({ content: { content_type: 'model_editable_context' } })),
      node('u1', 'mctx', userMessage('问')),
    ]));

    expect(result.conversationNodes.map(n => n.id)).toEqual(['u1']);
  });

  it('parent 指向不存在的节点时停止回溯，不抛异常', () => {
    const result = processConversation(apiConversation([
      node('orphan', 'ghost', userMessage('孤儿')),
    ]));

    expect(result.conversationNodes.map(n => n.id)).toEqual(['orphan']);
  });

  it('节点无 message 时也参与回溯（合成根节点被跳过）', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
    ]));

    expect(result.conversationNodes).toHaveLength(1);
  });
});

describe('processConversation 连续 assistant 合并', () => {
  it('合并连续 assistant 分段，上一段末尾与新段开头拼接', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
      node('a1', 'u1', message({ content: { content_type: 'text', parts: ['A1', 'A2'] } })),
      node('a2', 'a1', message({ content: { content_type: 'text', parts: ['B1', 'B2'] } })),
    ]));

    expect(result.conversationNodes).toHaveLength(2);
    const merged = result.conversationNodes[1].message?.content as { parts: string[] };
    // 流式回答被拆到多个节点时，新节点首段是上一段末尾的延续
    expect(merged.parts).toEqual(['A1', 'A2B1', 'B2']);
  });

  it('recipient 不是 all 时不合并', () => {
    const result = processConversation(apiConversation([
      node('a1', SYNTHETIC_ROOT, message({ content: { content_type: 'text', parts: ['A'] } })),
      node('a2', 'a1', message({ recipient: 'browser', content: { content_type: 'text', parts: ['B'] } })),
    ]));

    expect(result.conversationNodes).toHaveLength(2);
  });

  it('content_type 不同时不合并', () => {
    const result = processConversation(apiConversation([
      node('a1', SYNTHETIC_ROOT, message({ content: { content_type: 'text', parts: ['A'] } })),
      node('a2', 'a1', message({ content: { content_type: 'code', text: 'B' } })),
    ]));

    expect(result.conversationNodes).toHaveLength(2);
  });

  it('连续 user 消息不合并', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('一')),
      node('u2', 'u1', userMessage('二')),
    ]));

    expect(result.conversationNodes).toHaveLength(2);
  });

  it('分段不是字符串时不合并，保留两条消息', () => {
    const result = processConversation(apiConversation([
      node('a1', SYNTHETIC_ROOT, message({
        content: { content_type: 'text', parts: [{ weird: true }] as unknown as string[] },
      })),
      node('a2', 'a1', assistantMessage('B')),
    ]));

    expect(result.conversationNodes).toHaveLength(2);
  });
});

describe('processConversation 元数据', () => {
  it('输出 id / 标题 / 时间', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问')),
    ]));

    expect(result.id).toBe('chat-1');
    expect(result.title).toBe('Test Chat');
    expect(result.createTime).toBe(1700000000);
    expect(result.updateTime).toBe(1700000100);
  });

  it('标题为空时回退到默认标题', () => {
    const conversation = apiConversation([node('u1', SYNTHETIC_ROOT, userMessage('问'))]);
    conversation.title = '';

    expect(processConversation(conversation).title).not.toBe('');
    expect(processConversation(conversation).title).toBeTruthy();
  });

  it('多条 user / assistant 交替时保持顺序', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, userMessage('问一')),
      node('a1', 'u1', assistantMessage('答一')),
      node('u2', 'a1', userMessage('问二')),
      node('a2', 'u2', assistantMessage('答二')),
    ]));

    expect(result.conversationNodes.map(n => n.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });
});

describe('processConversation 模型名映射', () => {
  function withModelSlug(slug: string) {
    return processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, message({
        role: 'user',
        metadata: { model_slug: slug },
      })),
    ]));
  }

  it('命中映射表时返回可读名称', () => {
    expect(withModelSlug('gpt-4o').model).toBe('GPT-4o');
    expect(withModelSlug('gpt-5-1-thinking').model).toBe('GPT-5.1');
  });

  it('未直接命中但以某个 key 为前缀时按前缀匹配', () => {
    expect(withModelSlug('text-davinci-002-render-sha-preview').model).toBe('GPT-3.5');
  });

  it('映射表按声明顺序匹配，gpt-4 系列后缀优先落到 gpt-4', () => {
    expect(withModelSlug('gpt-4-browsing-2024').model).toBe('GPT-4');
  });

  it('未知 slug 原样返回，保留排查线索', () => {
    expect(withModelSlug('gpt-future-9000').model).toBe('gpt-future-9000');
  });

  it('modelSlug 始终保留原始值', () => {
    expect(withModelSlug('gpt-4o').modelSlug).toBe('gpt-4o');
  });

  it('没有 model_slug 时 model 与 modelSlug 均为空串', () => {
    const result = processConversation(apiConversation([
      node('u1', SYNTHETIC_ROOT, message({ role: 'user', metadata: {} })),
    ]));

    expect(result.model).toBe('');
    expect(result.modelSlug).toBe('');
  });
});
