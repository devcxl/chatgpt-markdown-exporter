import { t } from '../../i18n';
import type {
  ApiConversation,
  ConversationNode,
  ConversationResult,
} from './types';

const MODEL_MAPPING: Record<string, string> = {
  'text-davinci-002-render-sha': 'GPT-3.5',
  'text-davinci-002-render-paid': 'GPT-3.5',
  'text-davinci-002-browse': 'GPT-3.5',
  'gpt-4': 'GPT-4',
  'gpt-4-browsing': 'GPT-4 (Browser)',
  'gpt-4o': 'GPT-4o',
  'gpt-5': 'GPT-5',
  'gpt-5-t-mini': 'GPT-5',
  'gpt-5-1-instant': 'GPT-5.1',
  'gpt-5-1-thinking': 'GPT-5.1',
  'gpt-5-2': 'GPT-5.2',
};

export function processConversation(
  conversation: ApiConversation & { id: string },
): ConversationResult {
  const title = conversation.title || t('process.fallbackTitle');
  const createTime = conversation.create_time;
  const updateTime = conversation.update_time;

  const { model, modelSlug } = extractModel(conversation.mapping);

  const startNodeId
    = conversation.current_node
      || Object.values(conversation.mapping).find(node => !node.children?.length)?.id;

  if (!startNodeId) {
    throw new Error(t('process.startNodeError'));
  }

  const conversationNodes = extractConversationResult(
    conversation.mapping,
    startNodeId,
  );

  return {
    id: conversation.id,
    title,
    model,
    modelSlug,
    createTime,
    updateTime,
    conversationNodes: mergeContinuationNodes(conversationNodes),
  };
}

function extractModel(mapping: Record<string, ConversationNode>) {
  const modelSlug
    = Object.values(mapping).find(node => node.message?.metadata?.model_slug)
      ?.message?.metadata?.model_slug ?? '';

  let model = '';

  if (modelSlug) {
    model
      = MODEL_MAPPING[modelSlug]
        ?? Object.keys(MODEL_MAPPING).find(key => modelSlug.startsWith(key))
        ?? modelSlug;
  }

  return {
    model,
    modelSlug,
  };
}

function extractConversationResult(
  mapping: Record<string, ConversationNode>,
  startNodeId: string,
): ConversationNode[] {
  const result: ConversationNode[] = [];

  let currentNodeId: string | undefined = startNodeId;

  while (currentNodeId) {
    const node: ConversationNode | undefined = mapping[currentNodeId];

    if (!node) break;
    if (node.parent === undefined) break;

    const contentType = node.message?.content?.content_type;
    const role = node.message?.author?.role;

    if (
      role !== 'system'
      && contentType !== 'model_editable_context'
      && contentType !== 'user_editable_context'
    ) {
      result.unshift(node);
    }

    currentNodeId = node.parent;
  }

  return result;
}

function mergeContinuationNodes(nodes: ConversationNode[]): ConversationNode[] {
  const result: ConversationNode[] = [];

  for (const node of nodes) {
    const prev = result[result.length - 1];

    if (
      prev?.message?.author.role === 'assistant'
      && node.message?.author.role === 'assistant'
      && prev.message.recipient === 'all'
      && node.message.recipient === 'all'
      && prev.message.content.content_type === 'text'
      && node.message.content.content_type === 'text'
    ) {
      const prevContent = prev.message.content as { parts: string[] };
      const nodeContent = node.message.content as { parts: string[] };
      const prevParts = prevContent.parts;
      const nodeParts = nodeContent.parts;

      if (typeof prevParts[prevParts.length - 1] === 'string'
        && typeof nodeParts[0] === 'string') {
        prevParts[prevParts.length - 1] += nodeParts[0];
        prevParts.push(...nodeParts.slice(1));
      }
    }
    else {
      result.push(node);
    }
  }

  return result;
}
