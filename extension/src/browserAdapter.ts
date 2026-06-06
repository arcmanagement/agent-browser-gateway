export type BrowserKind = "chrome";

export type BrowserTab = chrome.tabs.Tab;
export type BrowserDownloadDelta = chrome.downloads.DownloadDelta;
export type BrowserDownloadItem = chrome.downloads.DownloadItem;

export type BrowserAdapter = {
  readonly kind: BrowserKind;
  readonly action: Pick<typeof chrome.action, "setBadgeBackgroundColor" | "setBadgeText">;
  readonly alarms: Pick<typeof chrome.alarms, "create" | "onAlarm">;
  readonly debugger: Pick<
    typeof chrome.debugger,
    "attach" | "detach" | "onDetach" | "onEvent" | "sendCommand"
  >;
  readonly downloads: Pick<typeof chrome.downloads, "onChanged" | "onCreated" | "search">;
  readonly extension: Pick<typeof chrome.extension, "isAllowedIncognitoAccess">;
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
};

export const chromeBrowserAdapter: BrowserAdapter = {
  kind: "chrome",
  get action() {
    return chrome.action;
  },
  get alarms() {
    return chrome.alarms;
  },
  get debugger() {
    return chrome.debugger;
  },
  get downloads() {
    return chrome.downloads;
  },
  get extension() {
    return chrome.extension;
  },
  get permissions() {
    return chrome.permissions;
  },
  get runtime() {
    return chrome.runtime;
  },
  get scripting() {
    return chrome.scripting;
  },
  get storage() {
    return chrome.storage;
  },
  get tabs() {
    return chrome.tabs;
  },
  get windows() {
    return chrome.windows;
  },
};

export const browserAdapter: BrowserAdapter = chromeBrowserAdapter;
