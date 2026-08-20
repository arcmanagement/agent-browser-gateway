export type BrowserKind = "chrome" | "firefox";

export type BrowserTab = chrome.tabs.Tab;
export type BrowserDownloadDelta = chrome.downloads.DownloadDelta;
export type BrowserDownloadItem = chrome.downloads.DownloadItem;
export type BrowserBookmarkTreeNode = chrome.bookmarks.BookmarkTreeNode;
export type BrowserReadingListEntry = {
  title: string;
  url: string;
  hasBeenRead: boolean;
  creationTime: number;
  lastUpdateTime: number;
};

export type BrowserReadingListQueryInfo = {
  title?: string;
  url?: string;
  hasBeenRead?: boolean;
};

type BrowserReadingListAPI = {
  query(info: BrowserReadingListQueryInfo): Promise<BrowserReadingListEntry[]>;
};

declare const __ABG_BROWSER_TARGET__: BrowserKind | undefined;

type BrowserEvent<TListener extends (...args: never[]) => unknown> = {
  addListener(listener: TListener): void;
  removeListener(listener: TListener): void;
  hasListener(listener: TListener): boolean;
  hasListeners(): boolean;
};

export type BrowserAdapter = {
  readonly kind: BrowserKind;
  readonly supportsDebugger: boolean;
  readonly supportsVisibleTabCapture: boolean;
  readonly action: Pick<typeof chrome.action, "setBadgeBackgroundColor" | "setBadgeText">;
  readonly alarms: Pick<typeof chrome.alarms, "create" | "onAlarm">;
  readonly debugger: Pick<
    typeof chrome.debugger,
    "attach" | "detach" | "onDetach" | "onEvent" | "sendCommand"
  >;
  readonly downloads: Pick<typeof chrome.downloads, "onChanged" | "onCreated" | "search">;
  readonly bookmarks?: Pick<
    typeof chrome.bookmarks,
    "get" | "getChildren" | "getRecent" | "getSubTree" | "getTree" | "search"
  >;
  readonly extension: Pick<
    typeof chrome.extension,
    "isAllowedFileSchemeAccess" | "isAllowedIncognitoAccess"
  >;
  readonly permissions: Pick<typeof chrome.permissions, "contains" | "remove" | "request">;
  readonly runtime: Pick<
    typeof chrome.runtime,
    "getURL" | "id" | "onInstalled" | "onMessage" | "onStartup" | "sendMessage"
  >;
  readonly scripting: Pick<typeof chrome.scripting, "executeScript">;
  readonly storage: {
    readonly local: chrome.storage.StorageArea;
    readonly session: chrome.storage.StorageArea;
  };
  readonly tabs: Pick<
    typeof chrome.tabs,
    | "captureVisibleTab"
    | "create"
    | "get"
    | "onActivated"
    | "onCreated"
    | "onRemoved"
    | "onUpdated"
    | "query"
    | "remove"
    | "update"
  >;
  readonly windows: Pick<typeof chrome.windows, "create" | "onRemoved" | "remove">;
  readonly readingList?: BrowserReadingListAPI;
};

type RuntimeBrowser = typeof chrome & {
  browser?: never;
  readingList?: BrowserReadingListAPI;
};

function runtimeBrowser(): RuntimeBrowser {
  const globals = globalThis as typeof globalThis & {
    browser?: RuntimeBrowser;
    chrome?: RuntimeBrowser;
  };
  const api = globals.browser ?? globals.chrome;
  if (!api) {
    throw new Error("No WebExtension browser API is available.");
  }
  return api;
}

function configuredKind(): BrowserKind {
  return typeof __ABG_BROWSER_TARGET__ === "string" ? __ABG_BROWSER_TARGET__ : "chrome";
}

function noopEvent<TListener extends (...args: never[]) => unknown>(): BrowserEvent<TListener> {
  return {
    addListener() {},
    removeListener() {},
    hasListener() {
      return false;
    },
    hasListeners() {
      return false;
    },
  };
}

function unsupportedDebugger(): BrowserAdapter["debugger"] {
  const unavailable = async () => {
    throw new Error("The browser debugger API is not available in this target.");
  };
  return {
    attach: unavailable,
    detach: unavailable,
    sendCommand: unavailable,
    onDetach: noopEvent() as BrowserAdapter["debugger"]["onDetach"],
    onEvent: noopEvent() as BrowserAdapter["debugger"]["onEvent"],
  };
}

function extensionAccessApi(api: RuntimeBrowser): BrowserAdapter["extension"] {
  const extensionApi = api.extension as Partial<BrowserAdapter["extension"]> | undefined;
  return {
    isAllowedFileSchemeAccess:
      typeof extensionApi?.isAllowedFileSchemeAccess === "function"
        ? () => extensionApi.isAllowedFileSchemeAccess?.() ?? Promise.resolve(true)
        : async () => true,
    isAllowedIncognitoAccess:
      typeof extensionApi?.isAllowedIncognitoAccess === "function"
        ? () => extensionApi.isAllowedIncognitoAccess?.() ?? Promise.resolve(true)
        : async () => true,
  };
}

function createBrowserAdapter(kind: BrowserKind, api: RuntimeBrowser): BrowserAdapter {
  const debuggerApi = api.debugger ?? unsupportedDebugger();
  const extensionApi = extensionAccessApi(api);
  return {
    kind,
    supportsDebugger: !!api.debugger,
    supportsVisibleTabCapture: typeof api.tabs?.captureVisibleTab === "function",
    get action() {
      return api.action;
    },
    get alarms() {
      return api.alarms;
    },
    get debugger() {
      return debuggerApi;
    },
    get downloads() {
      return api.downloads;
    },
    get bookmarks() {
      return api.bookmarks;
    },
    get extension() {
      return extensionApi;
    },
    get permissions() {
      return api.permissions;
    },
    get runtime() {
      return api.runtime;
    },
    get scripting() {
      return api.scripting;
    },
    get storage() {
      return api.storage;
    },
    get tabs() {
      return api.tabs;
    },
    get windows() {
      return api.windows;
    },
    get readingList() {
      return api.readingList;
    },
  };
}

function createLazyBrowserAdapter(kind: BrowserKind): BrowserAdapter {
  return {
    get kind() {
      return kind;
    },
    get supportsDebugger() {
      return !!runtimeBrowser().debugger;
    },
    get supportsVisibleTabCapture() {
      return typeof runtimeBrowser().tabs?.captureVisibleTab === "function";
    },
    get action() {
      return runtimeBrowser().action;
    },
    get alarms() {
      return runtimeBrowser().alarms;
    },
    get debugger() {
      return runtimeBrowser().debugger ?? unsupportedDebugger();
    },
    get downloads() {
      return runtimeBrowser().downloads;
    },
    get bookmarks() {
      return runtimeBrowser().bookmarks;
    },
    get extension() {
      return extensionAccessApi(runtimeBrowser());
    },
    get permissions() {
      return runtimeBrowser().permissions;
    },
    get runtime() {
      return runtimeBrowser().runtime;
    },
    get scripting() {
      return runtimeBrowser().scripting;
    },
    get storage() {
      return runtimeBrowser().storage;
    },
    get tabs() {
      return runtimeBrowser().tabs;
    },
    get windows() {
      return runtimeBrowser().windows;
    },
    get readingList() {
      return runtimeBrowser().readingList;
    },
  };
}

export const chromeBrowserAdapter: BrowserAdapter = createLazyBrowserAdapter("chrome");

export const browserAdapter: BrowserAdapter = createLazyBrowserAdapter(configuredKind());

/* c8 ignore next 3 */
export function createTestBrowserAdapter(kind: BrowserKind, api: unknown): BrowserAdapter {
  return createBrowserAdapter(kind, api as RuntimeBrowser);
}
