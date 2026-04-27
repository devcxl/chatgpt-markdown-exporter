// Type declarations for browser extension APIs

interface ChromeRuntime {
  getURL(path: string): string;
  onMessage: {
    addListener(callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

interface ChromeDownloads {
  download(options: { url: string; filename: string; saveAs?: boolean; conflictAction?: string }): Promise<number>;
}

interface ChromeTabs {
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
  query(query: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; active?: boolean }>>;
}

interface ChromeAPI {
  runtime: ChromeRuntime;
  downloads?: ChromeDownloads;
  tabs?: ChromeTabs;
}

declare const chrome: ChromeAPI;
declare const browser: ChromeAPI;
