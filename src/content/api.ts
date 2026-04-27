import { fetchShareConversationFromPage, getChatIdFromUrl, isSharePage } from "./page";
import type {
  ApiConversation,
  ApiConversationItem,
  ApiConversations
} from "./types";

const API_MAPPING: Record<string, string> = {
  "https://chat.openai.com": "https://chat.openai.com/backend-api",
  "https://chatgpt.com": "https://chatgpt.com/backend-api"
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
    throw new Error(`Unsupported ChatGPT origin: ${getBaseUrl()}`);
  }

  return apiUrl;
}

function getCookie(key: string): string {
  return document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${key}=`))
    ?.split("=")
    .slice(1)
    .join("=") ?? "";
}

function resetApiCache(): void {
  accessTokenPromise = null;
  teamAccountIdPromise = null;
}

async function fetchSessionAccessToken(): Promise<string | null> {
  const response = await fetch(`${getBaseUrl()}/api/auth/session`, {
    credentials: "include"
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

    throw new Error("获取 ChatGPT 访问令牌失败，请确认你已登录并且页面已加载完成。");
  } catch (error) {
    accessTokenPromise = null;
    throw error;
  }
}

async function getTeamAccountId(accessToken: string): Promise<string | null> {
  if (!teamAccountIdPromise) {
    teamAccountIdPromise = (async () => {
      const workspaceId = getCookie("_account");

      if (!workspaceId) {
        return null;
      }

      const response = await fetch(`${getApiUrl()}/accounts/check/v4-2023-04-27`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Authorization": `Bearer ${accessToken}`
        }
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

async function fetchApi<T>(
  path: string,
  init: RequestInit = {},
  retryUnauthorized = true
): Promise<T> {
  const accessToken = await getAccessToken();
  const accountId = await getTeamAccountId(accessToken);
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("X-Authorization", `Bearer ${accessToken}`);

  if (accountId) {
    headers.set("Chatgpt-Account-Id", accountId);
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers
  });

  if (response.status === 401 && retryUnauthorized) {
    resetApiCache();
    return fetchApi<T>(path, init, false);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(
      `ChatGPT API 请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`
    );
  }

  return response.json() as Promise<T>;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const detail = await response.text();
    return detail.replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return "";
  }
}

export function getCurrentChatId(): string {
  const chatId = getChatIdFromUrl();

  if (!chatId) {
    throw new Error("当前页面没有会话 ID，请先打开一个 ChatGPT 会话。");
  }

  return isSharePage() ? `__share__${chatId}` : chatId;
}

export async function fetchConversation(chatId = getCurrentChatId()): Promise<ApiConversation & { id: string }> {
  if (chatId.startsWith("__share__")) {
    const id = chatId.replace("__share__", "");
    const shareConversation = await fetchShareConversationFromPage();

    if (!shareConversation) {
      throw new Error("读取分享页会话数据失败，请刷新页面后重试。");
    }

    return {
      id,
      ...(shareConversation as ApiConversation)
    };
  }

  const conversation = await fetchApi<ApiConversation>(`/conversation/${chatId}`);

  return {
    id: chatId,
    ...conversation
  };
}

export async function fetchConversations(
  offset = 0,
  limit = 100
): Promise<ApiConversations> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit)
  });

  return fetchApi<ApiConversations>(`/conversations?${params.toString()}`);
}

export async function fetchAllConversations(
  maxConversations = 100,
  onBatch?: (items: ApiConversationItem[]) => void
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

    if (typeof result.total === "number" && items.length >= result.total) {
      break;
    }
  }

  return items;
}
