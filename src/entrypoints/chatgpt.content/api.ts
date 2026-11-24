import { t } from '../../i18n';
import { fetchShareConversationFromPage, getChatIdFromUrl, isSharePage } from './page';
import type {
  ApiConversation,
  ApiConversationItem,
  ApiConversations,
  ApiProject,
  ApiProjectConversationItem,
  ApiProjectConversations,
  ApiProjectSidebar,
  ApiProjectSidebarItem,
  Project,
} from '../../shared/chatgpt-types';

const API_MAPPING: Record<string, string> = {
  'https://chat.openai.com': 'https://chat.openai.com/backend-api',
  'https://chatgpt.com': 'https://chatgpt.com/backend-api',
};

type ApiAccountsCheck = {
  accounts?: Record<string, { account?: { account_id?: string | null } | null }>;
};

let accessTokenPromise: Promise<string | null> | null = null;
let teamAccountIdPromise: Promise<string | null> | null = null;

function getBaseUrl(): string {
  return location.origin;
}

function getApiUrl(): string {
  const apiUrl = API_MAPPING[getBaseUrl()];

  if (!apiUrl) {
    throw new Error(t('api.unsupportedOrigin', { origin: getBaseUrl() }));
  }

  return apiUrl;
}

function getCookie(key: string): string {
  return document.cookie
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${key}=`))
    ?.split('=')
    .slice(1)
    .join('=') ?? '';
}

function resetApiCache(): void {
  accessTokenPromise = null;
  teamAccountIdPromise = null;
}

async function fetchSessionAccessToken(): Promise<string | null> {
  const response = await fetch(`${getBaseUrl()}/api/auth/session`, {
    credentials: 'include',
  });

  if (!response.ok) {
    return null;
  }

  const session = await response.json() as { accessToken?: string | null };
  return session.accessToken ?? null;
}

async function getAccessToken(): Promise<string> {
  if (!accessTokenPromise) {
    accessTokenPromise = fetchSessionAccessToken();
  }

  try {
    const sessionToken = await accessTokenPromise;

    if (sessionToken) {
      return sessionToken;
    }

    throw new Error(t('api.accessTokenFailed'));
  }
  catch (error) {
    accessTokenPromise = null;
    throw error;
  }
}

async function getTeamAccountId(accessToken: string): Promise<string | null> {
  if (!teamAccountIdPromise) {
    teamAccountIdPromise = (async () => {
      const workspaceId = getCookie('_account');

      if (!workspaceId) {
        return null;
      }

      const response = await fetch(`${getApiUrl()}/accounts/check/v4-2023-04-27`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const result = await response.json() as ApiAccountsCheck;
      return result.accounts?.[workspaceId]?.account?.account_id ?? null;
    })();
  }

  return teamAccountIdPromise;
}

export async function fetchApi<T>(
  path: string,
  init: RequestInit = {},
  retryUnauthorized = true,
): Promise<T> {
  const accessToken = await getAccessToken();
  const accountId = await getTeamAccountId(accessToken);
  const headers = new Headers(init.headers);

  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Authorization', `Bearer ${accessToken}`);

  if (accountId) {
    headers.set('Chatgpt-Account-Id', accountId);
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status === 401 && retryUnauthorized) {
    resetApiCache();
    return fetchApi<T>(path, init, false);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(
      t('api.apiRequestFailed', {
        status: String(response.status),
        statusText: response.statusText,
        detail: detail ? ` - ${detail}` : '',
      }),
    );
  }

  return response.json() as Promise<T>;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const detail = await response.text();
    return detail.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  catch {
    return '';
  }
}

export function getCurrentChatId(): string {
  const chatId = getChatIdFromUrl();

  if (!chatId) {
    throw new Error(t('api.noChatId'));
  }

  return isSharePage() ? `__share__${chatId}` : chatId;
}

export async function fetchConversation(chatId = getCurrentChatId()): Promise<ApiConversation & { id: string }> {
  if (chatId.startsWith('__share__')) {
    const id = chatId.replace('__share__', '');
    const shareConversation = await fetchShareConversationFromPage();

    if (!shareConversation) {
      throw new Error(t('api.sharePageReadFailed'));
    }

    return {
      id,
      ...(shareConversation as ApiConversation),
    };
  }

  const conversation = await fetchApi<ApiConversation>(`/conversation/${chatId}`);

  return {
    id: chatId,
    ...conversation,
  };
}

export async function fetchConversations(
  offset = 0,
  limit = 100,
): Promise<ApiConversations> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  return fetchApi<ApiConversations>(`/conversations?${params.toString()}`);
}

export async function fetchAllConversations(
  maxConversations = 100,
  onBatch?: (items: ApiConversationItem[]) => void,
): Promise<ApiConversationItem[]> {
  const items: ApiConversationItem[] = [];
  const limit = Math.min(100, maxConversations);

  for (let offset = 0; items.length < maxConversations; offset += limit) {
    const result = await fetchConversations(offset, limit);
    const batch = result.items.slice(0, maxConversations - items.length);

    if (batch.length === 0) {
      break;
    }

    items.push(...batch);
    onBatch?.(batch);

    if (result.items.length < limit) {
      break;
    }

    if (typeof result.total === 'number' && items.length >= result.total) {
      break;
    }
  }

  return items;
}

/* ---- 项目（snorlax gizmo） ---- */

/* sidebar 不传 limit 只返回 5 条；项目会话端点的 limit 上限是 50（超过返回 422），
 * 因此两个分页参数都是「显式写上」而不是依赖服务端默认值。 */
const PROJECTS_PAGE_LIMIT = 50;
const PROJECT_CONVERSATIONS_PAGE_LIMIT = 50;

export type ProjectConversationPage = {
  items: ApiConversationItem[];
  /** null = 没有下一页 */
  cursor: string | null;
};

/**
 * 把两种时间表示统一成 epoch 秒：
 * 主会话列表是数字（可能带小数），项目会话列表是 ISO 8601 字符串。
 * 无法解析时返回 0，让调用方走「无时间信息」分支，而不是把 NaN 传下去。
 */
export function toEpochSeconds(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.floor(value) : 0;
  }

  if (typeof value === 'string' && value) {
    const milliseconds = Date.parse(value);

    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : 0;
  }

  return 0;
}

/**
 * 拉取全部项目。cursor 分页，`cursor` 为 null/缺失时结束。
 *
 * 响应存在双层嵌套（`items[].gizmo.gizmo`）与单层（`items[].gizmo`）两种形态，
 * 且可能混入自定义 GPT —— 一律按 `g-p-` 前缀过滤，不依赖 `gizmo_type`
 * （该字段在会话对象上存在 `null` 与 `"snorlax"` 两种说法）。
 */
export async function fetchProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  // 首页必须不带 cursor：服务端会把它当不透明游标解码，`cursor=0` 直接返回 500
  let cursor: string | null = null;

  for (;;) {
    const page = await fetchProjectSidebarPage(cursor);
    const items = page.items ?? [];

    for (const item of items) {
      const project = unwrapProject(item);

      if (!project?.id?.startsWith('g-p-') || seenIds.has(project.id)) {
        continue;
      }

      seenIds.add(project.id);
      projects.push({
        id: project.id,
        name: project.display?.name?.trim() || project.id,
      });
    }

    // cursor 重复出现说明服务端没有推进，继续跟只会无限请求同一页
    if (!page.cursor || seenCursors.has(page.cursor) || items.length === 0) {
      break;
    }

    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  return projects;
}

async function fetchProjectSidebarPage(cursor: string | null): Promise<ApiProjectSidebar> {
  const params = new URLSearchParams({
    owned_only: 'true',
    /* 内嵌会话只会给最近 5 条，不构成完整列表，还会显著放大响应体。
     * 反过来，带上这个参数时响应是双层 `items[].gizmo.gizmo`，
     * 不带时是单层 `items[].gizmo` —— 所以解包必须两种都认。 */
    conversations_per_gizmo: '0',
    limit: String(PROJECTS_PAGE_LIMIT),
  });

  if (cursor) {
    params.set('cursor', cursor);
  }

  return fetchApi<ApiProjectSidebar>(`/gizmos/snorlax/sidebar?${params.toString()}`);
}

/**
 * 拉取某个项目的一页会话。
 *
 * 注意 `/conversations?gizmo_id=` 会被服务端**静默忽略**（返回全局列表且不报错），
 * 因此必须走这个专用端点。limit 固定 50；翻页由调用方带着 `cursor` 驱动。
 */
export async function fetchProjectConversations(
  projectId: string,
  cursor?: string | null,
): Promise<ProjectConversationPage> {
  /* 参数形状照抄 ChatGPT 前端自己发的请求（2026-11-25 从 Network 面板取到）：
   *   /gizmos/{id}/conversations?limit=5&owned_only=false
   * 两条都不能改：
   * - 首页不带 cursor —— 与 sidebar 同一类问题，`cursor=0` 会被当游标解码
   * - `owned_only=false` —— 缺省或 true 时实测返回空列表（items: []） */
  const params = new URLSearchParams({
    limit: String(PROJECT_CONVERSATIONS_PAGE_LIMIT),
    owned_only: 'false',
  });

  if (cursor) {
    params.set('cursor', cursor);
  }

  const page = await fetchApi<ApiProjectConversations>(
    `/gizmos/${encodeURIComponent(projectId)}/conversations?${params.toString()}`,
  );

  return {
    items: (page.items ?? []).map(normalizeProjectConversation),
    // 空串也算末页：调用方按 `cursor === null` 判断是否还有下一页
    cursor: page.cursor || null,
  };
}

function unwrapProject(item: ApiProjectSidebarItem): ApiProject | null {
  const nested = item.gizmo?.gizmo;

  if (nested?.id) {
    return nested;
  }

  const single = item.gizmo;

  return single?.id ? { id: single.id, display: single.display } : null;
}

function normalizeProjectConversation(
  item: ApiProjectConversationItem,
): ApiConversationItem {
  return {
    id: item.id,
    title: item.title,
    create_time: toEpochSeconds(item.create_time),
    // update_time 是可选项：缺失就不补字段。补 0 会被当成「有时间但为 0 秒」
    // 而非「没有时间」，调用方用 `?? create_time` 兜底即可。
    // create_time 则必须给出数值，0 已由展示层处理成「无时间信息」。
    ...(item.update_time == null
      ? {}
      : { update_time: toEpochSeconds(item.update_time) }),
    gizmo_id: item.gizmo_id ?? null,
  };
}
