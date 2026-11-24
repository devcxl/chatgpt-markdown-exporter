// src/content/types.ts

export type AuthorRole = 'system' | 'assistant' | 'user' | 'tool';

export interface ApiConversation {
  id?: string;
  conversation_id?: string;
  title: string;
  create_time: number;
  update_time: number;
  current_node: string;
  mapping: Record<string, ConversationNode>;
  moderation_results?: unknown[];
  safe_urls?: string[];
  is_archived?: boolean;
}

export interface ApiConversationItem {
  id: string;
  title: string;
  create_time: number;
  update_time?: number;
  /** null = 普通会话；`g-p-` = 项目会话；`g-`（非 g-p-）= 自定义 GPT 会话 */
  gizmo_id?: string | null;
}

/* ---- 项目（snorlax gizmo） ----
 * 端点与字段事实见 research/project-api 分支的 docs/research/project-gizmo-api.md。 */

/* 只声明实际读取的字段。完整响应形状（instructions / num_interactions /
 * gizmo_type / memory_* 等）见 research 文档，用不到就不进类型。 */
export interface ApiProject {
  id: string;
  display?: {
    name?: string;
    description?: string;
  } | null;
}

/** 项目下拉用的精简形态（跨 context 共享） */
export interface Project {
  id: string;
  name: string;
}

/** sidebar 的列表项：真实响应是 `items[].gizmo.gizmo`，部分来源只有一层 `items[].gizmo` */
export interface ApiProjectSidebarItem {
  gizmo?: {
    id?: string;
    gizmo?: ApiProject | null;
    display?: ApiProject['display'];
    conversations?: unknown;
  } | null;
}

export interface ApiProjectSidebar {
  items?: ApiProjectSidebarItem[];
  cursor?: string | null;
}

/** 项目会话列表项：时间字段是 **ISO 8601 字符串**（主列表是 epoch 秒） */
export interface ApiProjectConversationItem {
  id: string;
  title: string;
  create_time?: string | number;
  update_time?: string | number;
  gizmo_id?: string | null;
}

export interface ApiProjectConversations {
  items?: ApiProjectConversationItem[];
  cursor?: string | null;
}

export interface ApiConversations {
  has_missing_conversations: boolean;
  items: ApiConversationItem[];
  limit: number;
  offset: number;
  total: number | null;
  cursor?: string | null;
}

export interface ConversationNode {
  id: string;
  parent?: string;
  children: string[];
  message?: ConversationNodeMessage;
}

export interface ConversationNodeMessage {
  id: string;
  author: {
    role: AuthorRole;
    name?: string;
    metadata?: unknown;
  };
  content: ConversationContent;
  create_time?: number;
  update_time?: number;
  recipient: string;
  status?: string;
  end_turn?: boolean;
  weight?: number;
  metadata?: MessageMeta;
}

export type ConversationContent =
  | {
    content_type: 'text';
    parts: string[];
  }
  | {
    content_type: 'code';
    language?: string;
    text: string;
  }
  | {
    content_type: 'execution_output';
    text: string;
  }
  | {
    content_type: 'multimodal_text';
    parts: Array<string | MultimodalPart>;
  }
  | {
    content_type: 'tether_quote';
    title?: string;
    text?: string;
    url?: string;
    domain?: string;
  }
  | {
    content_type: 'tether_browsing_display';
    result?: string;
    summary?: string;
  }
  | {
    content_type: 'thoughts';
    thoughts?: unknown[];
  }
  | {
    content_type: 'reasoning_recap';
    content?: string;
  }
  | {
    content_type: 'model_editable_context' | 'user_editable_context';
    [key: string]: unknown;
  }
  | {
    content_type: string;
    [key: string]: unknown;
  };

export type MultimodalPart =
  | {
    content_type: 'image_asset_pointer';
    asset_pointer: string;
  }
  | {
    content_type: 'audio_transcription';
    text: string;
  }
  | {
    content_type: string;
    [key: string]: unknown;
  };

export interface MessageMeta {
  model_slug?: string;
  is_visually_hidden_from_conversation?: boolean;
  citations?: Citation[];
  content_references?: ContentReference[];
  _cite_metadata?: {
    metadata_list?: Array<{
      title: string;
      url: string;
      text?: string;
    }>;
  };
  aggregate_result?: {
    status?: string;
    messages?: Array<{
      image_url: string;
      message_type: 'image' | string;
      width?: number;
      height?: number;
    }>;
  };
}

export interface Citation {
  metadata?: {
    extra?: {
      cited_message_idx: number;
      evidence_text: string;
    };
    title?: string;
    url?: string;
    text?: string;
  };
}

export interface ContentReference {
  type: string;
  matched_text?: string;
  alt?: string;
  items?: Array<{
    title: string;
    url: string;
    attribution?: string;
    supporting_websites?: Array<{
      title: string;
      url: string;
      attribution?: string;
    }>;
  }>;
}

export interface ConversationResult {
  id: string;
  title: string;
  model: string;
  modelSlug: string;
  createTime: number;
  updateTime: number;
  conversationNodes: ConversationNode[];
}
