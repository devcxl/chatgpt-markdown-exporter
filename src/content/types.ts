// src/content/types.ts

export type AuthorRole = "system" | "assistant" | "user" | "tool";

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
      content_type: "text";
      parts: string[];
    }
  | {
      content_type: "code";
      language?: string;
      text: string;
    }
  | {
      content_type: "execution_output";
      text: string;
    }
  | {
      content_type: "multimodal_text";
      parts: Array<string | MultimodalPart>;
    }
  | {
      content_type: "tether_quote";
      title?: string;
      text?: string;
      url?: string;
      domain?: string;
    }
  | {
      content_type: "tether_browsing_display";
      result?: string;
      summary?: string;
    }
  | {
      content_type: "thoughts";
      thoughts?: unknown[];
    }
  | {
      content_type: "reasoning_recap";
      content?: string;
    }
  | {
      content_type: "model_editable_context" | "user_editable_context";
      [key: string]: unknown;
    }
  | {
      content_type: string;
      [key: string]: unknown;
    };

export type MultimodalPart =
  | {
      content_type: "image_asset_pointer";
      asset_pointer: string;
    }
  | {
      content_type: "audio_transcription";
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
      message_type: "image" | string;
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
