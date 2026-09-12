// src/content/page.ts

export function getChatIdFromUrl(): string | null {
  const match = location.pathname.match(
    /^\/(?:share|c|g\/[a-z0-9-]+\/c)\/([a-z0-9-]+)/i,
  );

  return match?.[1] ?? null;
}

export function isSharePage(): boolean {
  // 包含 /share/<id>/continue（分享页的「继续对话」），
  // 这类页面同样是分享数据，走 /conversation API 会 404。
  return location.pathname.startsWith('/share');
}

export async function fetchShareConversationFromPage(): Promise<unknown | null> {
  const response = await fetch(location.href, {
    credentials: 'include',
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const nextData = doc.querySelector('#__NEXT_DATA__')?.textContent;

  if (nextData) {
    const parsed = JSON.parse(nextData) as {
      props?: { pageProps?: { serverResponse?: { data?: unknown } } };
    };

    return parsed.props?.pageProps?.serverResponse?.data ?? null;
  }

  const remixContext = extractAssignedJson(html, 'window.__remixContext');

  if (!remixContext) {
    return null;
  }

  const parsed = JSON.parse(remixContext) as {
    state?: {
      loaderData?: {
        [key: string]: {
          serverResponse?: {
            data?: unknown;
          };
        };
      };
    };
  };

  return parsed.state?.loaderData?.['routes/share.$shareId.($action)']?.serverResponse?.data ?? null;
}

function extractAssignedJson(source: string, variableName: string): string | null {
  const startIndex = source.indexOf(variableName);

  if (startIndex === -1) {
    return null;
  }

  const objectStart = source.indexOf('{', startIndex);

  if (objectStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    }
    else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}
