import { type AnnotationCommand, manageAnnotationMode } from "./annotationOverlay.js";
import {
  type AuditDiffPayload,
  type AuditDiffValue,
  clickSelectorFrameFn,
  createAuditDiff,
  describeFileAttachFailure,
  detectBrowserKind,
  isShareableTabUrl,
  normalizeUploadFiles,
  originForUrl,
  personalDataMutationIntent,
  raisePermittedBrowserTab,
  richClipboardPayloadLabel,
} from "./backgroundLogic.js";
import {
  type BrowserBookmarkTreeNode,
  type BrowserDownloadDelta,
  type BrowserDownloadItem,
  type BrowserReadingListEntry,
  type BrowserReadingListQueryInfo,
  type BrowserTab,
  browserAdapter,
} from "./browserAdapter.js";
import {
  normalizeAppliedGatewayWebSocketUrl,
  normalizeGatewayWebSocketUrl,
  resolveStoredGatewayWebSocketUrl,
} from "./gatewayEndpoint.js";
import { GatewayWebSocketConnection } from "./gatewayWebSocketConnection.js";
import type {
  AnnotationAction,
  ApprovalDecision,
  ApprovalMethod,
  ApprovalRequest,
  ApprovalToBackground,
  BackgroundToApproval,
  BackgroundToOffscreen,
  BackgroundToPopup,
  ConsoleEntry,
  ExtensionSettings,
  ExtToGateway,
  GatewayCommand,
  OffscreenStartResult,
  OffscreenStopResult,
  OperationMethod,
  PopupToBackground,
  TabAccessMode,
} from "./types.js";

declare const __ABG_WS_URL__: string;

const browser = browserAdapter;
const DEFAULT_GATEWAY_WEBSOCKET_URL = normalizeGatewayWebSocketUrl(__ABG_WS_URL__);
const VERSION = "0.4.5";
const ALL_URLS_ORIGINS = ["<all_urls>"];
const BOOKMARKS_PERMISSION = "bookmarks" as chrome.runtime.ManifestPermissions;
const READING_LIST_PERMISSION = "readingList" as unknown as chrome.runtime.ManifestPermissions;
const HEARTBEAT_PERIOD_MIN = 0.5; // 30s — Chrome 117+ minimum, anything lower is silently dropped
const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_WINDOW_FALLBACK_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + 2_000;
const EVAL_DEFAULT_MAX_BYTES = 64 * 1024;
const EVAL_HARD_MAX_BYTES = 256 * 1024;
const DEFAULT_SETTINGS: ExtensionSettings = {
  operationsRequireApproval: true,
  evalEnabled: false,
  trustedAutomationEnabled: false,
  profileLabel: "",
  gatewayWebSocketUrl: DEFAULT_GATEWAY_WEBSOCKET_URL,
  allTabsAccessEnabled: false,
  bookmarksAccessEnabled: false,
  readingListAccessEnabled: false,
  personalDataMutationsEnabled: false,
};
const OPERATION_METHODS: ReadonlySet<GatewayCommand["method"]> = new Set([
  "click_selector",
  "click_described",
  "click_at",
  "click_ref",
  "dblclick_selector",
  "focus_selector",
  "hover_selector",
  "select_option",
  "set_checked",
  "fill",
  "paste",
  "paste_rich",
  "clear",
  "replace_dom",
  "upload_file",
  "type_text",
  "key_press",
  "key_down",
  "key_up",
  "keyboard_insert_text",
  "exec_command",
  "navigate",
  "sandbox_action",
  "scroll",
  "scroll_into_view",
  "dialog_action",
  "drag",
]);

type PermittedTab = {
  url: string;
  title: string;
  origin: string;
  permittedAt: number;
  expiresAt?: number;
  accessMode: TabAccessMode;
};

type OperationCommand = GatewayCommand & { method: OperationMethod };

type OperationDescriptor = {
  intent: string;
  run: () => Promise<unknown>;
};

type NetworkEntry = {
  requestId: string;
  method: string;
  url: string;
  type?: string;
  ts: string;
  startTime: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  durationMs?: number;
  encodedDataLength?: number;
  errorText?: string;
};

type PendingDialog = {
  type: string;
  message: string;
  defaultPrompt?: string;
  url?: string;
  openedAt: number;
};

type DownloadStatus = "in_progress" | "complete" | "interrupted";

type DownloadRecord = {
  id: string;
  tabId: number;
  guid?: string;
  browserDownloadId?: number;
  url: string;
  finalUrl?: string;
  referrer?: string;
  suggestedFilename?: string;
  filename?: string;
  mime?: string;
  status: DownloadStatus;
  error?: string;
  bytesReceived?: number;
  totalBytes?: number;
  fileSize?: number;
  exists?: boolean;
  startedAt: string;
  endedAt?: string;
  updatedAt: number;
};

type Point = { x: number; y: number };

type ApprovalResolution = {
  decision: ApprovalDecision;
  message: string;
  // Present only for record_start approvals: the tabCapture stream ID minted
  // inside the "Allow" click gesture.
  streamId?: string;
};

type RecordingSession = {
  recordingId: string;
  tabId: number;
  mic: boolean;
  mime: string;
  startedAt: number;
};

type PendingApproval = {
  request: ApprovalRequest;
  resolve: (resolution: ApprovalResolution) => void;
  timeoutId: number;
  windowId?: number;
};

type RuntimeMessage = PopupToBackground | ApprovalToBackground;
type RuntimeResponse = BackgroundToPopup | BackgroundToApproval;

class GatewayError extends Error {
  readonly code: string;
  readonly matchCount?: number;

  constructor(code: string, message: string, matchCount?: number) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.matchCount = matchCount;
  }
}

const permittedTabs = new Map<number, PermittedTab>();
const consoleBuffers = new Map<number, ConsoleEntry[]>();
const networkBuffers = new Map<number, NetworkEntry[]>();
const activeNetworkRequests = new Map<number, Set<string>>();
const pendingDialogs = new Map<number, PendingDialog>();
const downloadsByTab = new Map<number, DownloadRecord[]>();
const downloadIdToTab = new Map<number, number>();
const downloadGuidToTab = new Map<string, number>();
const snapshotRefCache = new Map<number, Map<string, SnapshotRefTarget>>();
const attachedTabs = new Set<number>();
const streamingTabs = new Set<number>();
const pendingApprovals = new Map<string, PendingApproval>();
let recordingSession: RecordingSession | null = null;

let extensionId: string | null = null;
let wsConnected = false;
const gatewayWebSocketConnection = new GatewayWebSocketConnection({
  endpoint: DEFAULT_GATEWAY_WEBSOCKET_URL,
  createSocket: (endpoint) => new WebSocket(endpoint),
  onConnectionChange: (connected) => {
    wsConnected = connected;
  },
  onOpen: async () => {
    const { profileLabel } = await getSettings();
    sendWS({
      type: "hello",
      extensionId: extensionId ?? "?",
      version: VERSION,
      profileLabel: profileLabel || undefined,
      browserKind: await detectCurrentBrowserKind(),
    });
    await reconcileAllTabsAccess({ emit: false });
    for (const [tabId, permittedTab] of permittedTabs) {
      sendTabPermitted(tabId, permittedTab);
    }
  },
  onMessage: (event) => {
    try {
      const command = JSON.parse(event.data) as GatewayCommand;
      handleGatewayCommand(command);
    } catch (error) {
      console.warn("[ABG] WS message parse error", error);
    }
  },
  onWarning: (message, error) => {
    console.warn(message, error);
  },
});

// ---------- Bootstrap ----------

(async () => {
  extensionId = await getOrCreateExtensionId();
  const settings = await ensureSettingsStored();
  gatewayWebSocketConnection.setEndpoint(settings.gatewayWebSocketUrl);
  await restoreState();
  await reconcileAllTabsAccess();
  ensureWS();
})();

browser.runtime.onInstalled.addListener(async () => {
  extensionId = await getOrCreateExtensionId();
  await ensureSettingsStored();
});

browser.runtime.onStartup.addListener(async () => {
  extensionId = await getOrCreateExtensionId();
  const settings = await ensureSettingsStored();
  gatewayWebSocketConnection.setEndpoint(settings.gatewayWebSocketUrl);
  await restoreState();
  await reconcileAllTabsAccess();
  ensureWS();
});

// Keep service worker warm
browser.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_PERIOD_MIN });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") {
    ensureWS();
  }
});

// ---------- Identity ----------

async function getOrCreateExtensionId(): Promise<string> {
  const stored = await browser.storage.local.get("extensionId");
  if (typeof stored.extensionId === "string") return stored.extensionId;
  const id = crypto.randomUUID();
  await browser.storage.local.set({ extensionId: id });
  return id;
}

// ---------- Persistent settings ----------

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get([
    "operationsRequireApproval",
    "evalEnabled",
    "trustedAutomationEnabled",
    "profileLabel",
    "gatewayWebSocketUrl",
    "allTabsAccessEnabled",
    "bookmarksAccessEnabled",
    "readingListAccessEnabled",
    "personalDataMutationsEnabled",
  ]);
  const operationsRequireApproval =
    typeof stored.operationsRequireApproval === "boolean"
      ? stored.operationsRequireApproval
      : DEFAULT_SETTINGS.operationsRequireApproval;
  const evalEnabled =
    typeof stored.evalEnabled === "boolean" ? stored.evalEnabled : DEFAULT_SETTINGS.evalEnabled;
  const trustedAutomationEnabled =
    typeof stored.trustedAutomationEnabled === "boolean"
      ? stored.trustedAutomationEnabled
      : DEFAULT_SETTINGS.trustedAutomationEnabled;
  const profileLabel =
    typeof stored.profileLabel === "string" ? stored.profileLabel : DEFAULT_SETTINGS.profileLabel;
  const gatewayWebSocketUrl = resolveStoredGatewayWebSocketUrl(
    stored.gatewayWebSocketUrl,
    DEFAULT_SETTINGS.gatewayWebSocketUrl,
  );
  const allTabsAccessEnabled =
    typeof stored.allTabsAccessEnabled === "boolean"
      ? stored.allTabsAccessEnabled
      : DEFAULT_SETTINGS.allTabsAccessEnabled;
  const bookmarksAccessEnabled =
    typeof stored.bookmarksAccessEnabled === "boolean"
      ? stored.bookmarksAccessEnabled
      : DEFAULT_SETTINGS.bookmarksAccessEnabled;
  const readingListAccessEnabled =
    typeof stored.readingListAccessEnabled === "boolean"
      ? stored.readingListAccessEnabled
      : DEFAULT_SETTINGS.readingListAccessEnabled;
  const personalDataMutationsEnabled =
    typeof stored.personalDataMutationsEnabled === "boolean"
      ? stored.personalDataMutationsEnabled
      : DEFAULT_SETTINGS.personalDataMutationsEnabled;
  if (
    typeof stored.operationsRequireApproval !== "boolean" ||
    typeof stored.evalEnabled !== "boolean" ||
    typeof stored.trustedAutomationEnabled !== "boolean" ||
    typeof stored.profileLabel !== "string" ||
    gatewayWebSocketUrl.shouldPersist ||
    typeof stored.allTabsAccessEnabled !== "boolean" ||
    typeof stored.bookmarksAccessEnabled !== "boolean" ||
    typeof stored.readingListAccessEnabled !== "boolean" ||
    typeof stored.personalDataMutationsEnabled !== "boolean"
  ) {
    await browser.storage.local.set({
      operationsRequireApproval,
      evalEnabled,
      trustedAutomationEnabled,
      profileLabel,
      gatewayWebSocketUrl: gatewayWebSocketUrl.url,
      allTabsAccessEnabled,
      bookmarksAccessEnabled,
      readingListAccessEnabled,
      personalDataMutationsEnabled,
    });
  }
  return {
    operationsRequireApproval,
    evalEnabled,
    trustedAutomationEnabled,
    profileLabel,
    gatewayWebSocketUrl: gatewayWebSocketUrl.url,
    allTabsAccessEnabled,
    bookmarksAccessEnabled,
    readingListAccessEnabled,
    personalDataMutationsEnabled,
  };
}

async function ensureSettingsStored(): Promise<ExtensionSettings> {
  return await getSettings();
}

async function setOperationsRequireApproval(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, operationsRequireApproval: value };
  await browser.storage.local.set(settings);
  return settings;
}

async function setEvalEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, evalEnabled: value };
  await browser.storage.local.set(settings);
  return settings;
}

async function setTrustedAutomationEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, trustedAutomationEnabled: value };
  await browser.storage.local.set(settings);
  return settings;
}

async function setProfileLabel(value: string): Promise<ExtensionSettings> {
  const current = await getSettings();
  const trimmed = value.trim();
  const settings: ExtensionSettings = { ...current, profileLabel: trimmed };
  await browser.storage.local.set(settings);
  // Re-introduce ourselves to the Gateway with the new label
  if (extensionId) {
    sendWS({
      type: "hello",
      extensionId,
      version: VERSION,
      profileLabel: trimmed || undefined,
      browserKind: await detectCurrentBrowserKind(),
    });
  }
  return settings;
}

async function setGatewayWebSocketUrl(value: string): Promise<ExtensionSettings> {
  const normalizedUrl = normalizeAppliedGatewayWebSocketUrl(
    value,
    DEFAULT_SETTINGS.gatewayWebSocketUrl,
  );
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, gatewayWebSocketUrl: normalizedUrl };
  await browser.storage.local.set(settings);
  gatewayWebSocketConnection.reconnect(normalizedUrl);
  return settings;
}

async function setAllTabsAccessEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  if (value && !(await hasAllUrlsPermission())) {
    throw new GatewayError(
      "all_tabs_permission_required",
      "Chrome has not granted ABG optional access to all sites in this profile.",
    );
  }
  const settings: ExtensionSettings = { ...current, allTabsAccessEnabled: value };
  await browser.storage.local.set(settings);
  if (value) {
    await syncAllTabsAccess({ emit: true });
  } else {
    await revokeAllTabsEntries("all_tabs_disabled");
  }
  return settings;
}

async function setBookmarksAccessEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  if (value) {
    ensureBookmarksSupported();
    if (!(await hasBookmarksPermission())) {
      throw new GatewayError(
        "bookmarks_permission_required",
        "Chrome has not granted ABG optional access to bookmarks in this profile.",
      );
    }
  }
  const settings: ExtensionSettings = { ...current, bookmarksAccessEnabled: value };
  await browser.storage.local.set(settings);
  return settings;
}

async function setReadingListAccessEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  if (value) {
    ensureReadingListSupported();
    if (!(await hasReadingListPermission())) {
      throw new GatewayError(
        "reading_list_permission_required",
        "Chrome has not granted ABG optional access to Reading List in this profile.",
      );
    }
  }
  const settings: ExtensionSettings = { ...current, readingListAccessEnabled: value };
  await browser.storage.local.set(settings);
  return settings;
}

async function hasAllUrlsPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: ALL_URLS_ORIGINS });
  } catch {
    return false;
  }
}

async function hasBookmarksPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [BOOKMARKS_PERMISSION] });
  } catch {
    return false;
  }
}

async function hasReadingListPermission(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ permissions: [READING_LIST_PERMISSION] });
  } catch {
    return false;
  }
}

async function isAllTabsAccessActive(): Promise<boolean> {
  const settings = await getSettings();
  return settings.allTabsAccessEnabled && (await hasAllUrlsPermission());
}

async function isBookmarksAccessActive(): Promise<boolean> {
  const settings = await getSettings();
  return settings.bookmarksAccessEnabled && (await hasBookmarksPermission());
}

async function isReadingListAccessActive(): Promise<boolean> {
  const settings = await getSettings();
  return settings.readingListAccessEnabled && (await hasReadingListPermission());
}

async function isIncognitoAccessAllowed(): Promise<boolean> {
  try {
    return await browser.extension.isAllowedIncognitoAccess();
  } catch {
    return false;
  }
}

type BraveNavigator = Navigator & {
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
};

async function detectCurrentBrowserKind(): Promise<string> {
  if (browser.kind === "firefox") return "firefox";
  const brave = (navigator as BraveNavigator).brave;
  if (typeof brave?.isBrave === "function") {
    try {
      if (await brave.isBrave()) return "brave";
    } catch {
      // Fall through to UA checks; browser kind is only a UI label.
    }
  }
  return detectBrowserKind(navigator.userAgent);
}

// ---------- State persistence (session: cleared on browser restart) ----------

async function saveState(): Promise<void> {
  const obj: Record<string, PermittedTab> = {};
  for (const [k, v] of permittedTabs) obj[String(k)] = v;
  await browser.storage.session.set({ permittedTabs: obj });
}

async function restoreState(): Promise<void> {
  const stored = await browser.storage.session.get("permittedTabs");
  const obj = stored.permittedTabs as Record<string, PermittedTab> | undefined;
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    permittedTabs.set(Number(k), { ...v, accessMode: v.accessMode ?? "manual" });
  }
}

// ---------- WebSocket ----------

function ensureWS(): void {
  gatewayWebSocketConnection.ensureConnected();
}

function sendWS(msg: ExtToGateway): void {
  gatewayWebSocketConnection.send(JSON.stringify(msg));
}

function emitStreamEvent(tabId: number, event: Record<string, unknown>): void {
  if (!streamingTabs.has(tabId)) return;
  sendWS({
    type: "runtime_event",
    tabId,
    event: {
      ...event,
      ts: new Date().toISOString(),
    },
  });
}

// ---------- Tab permission ----------

function sendTabPermitted(tabId: number, tab: PermittedTab): void {
  sendWS({
    type: "tab_permitted",
    tabId,
    url: tab.url,
    title: tab.title,
    origin: tab.origin,
    expiresAt: tab.expiresAt ? new Date(tab.expiresAt).toISOString() : undefined,
    accessMode: tab.accessMode,
  });
}

function sendTabUpdated(tabId: number, tab: PermittedTab): void {
  sendWS({
    type: "tab_updated",
    tabId,
    url: tab.url,
    title: tab.title,
    origin: tab.origin,
    accessMode: tab.accessMode,
  });
}

async function reconcileAllTabsAccess(options: { emit?: boolean } = {}): Promise<void> {
  const settings = await getSettings();
  if (!settings.allTabsAccessEnabled) {
    await revokeAllTabsEntries("all_tabs_disabled");
    return;
  }
  if (!(await hasAllUrlsPermission())) {
    await revokeAllTabsEntries("all_tabs_permission_missing");
    return;
  }
  await syncAllTabsAccess(options);
}

async function syncAllTabsAccess(
  options: { emit?: boolean } = {},
): Promise<{ shareableTabCount: number; skippedTabCount: number }> {
  const emit = options.emit ?? true;
  const tabs = await browser.tabs.query({});
  const shareableTabIds = new Set<number>();
  let skippedTabCount = 0;

  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !isShareableTabUrl(tab.url)) {
      skippedTabCount += 1;
      continue;
    }
    shareableTabIds.add(tab.id);
    await upsertAllTabsEntry(tab, emit);
  }

  const staleAllTabs = Array.from(permittedTabs.entries())
    .filter(([tabId, tab]) => tab.accessMode === "all_tabs" && !shareableTabIds.has(tabId))
    .map(([tabId]) => tabId);
  for (const tabId of staleAllTabs) {
    await revokeTab(tabId, "all_tabs_not_shareable");
  }

  await saveState();
  return { shareableTabCount: shareableTabIds.size, skippedTabCount };
}

async function allTabsAccessState(): Promise<{
  permissionGranted: boolean;
  active: boolean;
  shareableTabCount: number;
  skippedTabCount: number;
}> {
  const [settings, permissionGranted, tabs] = await Promise.all([
    getSettings(),
    hasAllUrlsPermission(),
    browser.tabs.query({}).catch(() => [] as BrowserTab[]),
  ]);
  let shareableTabCount = 0;
  let skippedTabCount = 0;
  for (const tab of tabs) {
    if (typeof tab.id === "number" && isShareableTabUrl(tab.url)) shareableTabCount += 1;
    else skippedTabCount += 1;
  }
  return {
    permissionGranted,
    active: settings.allTabsAccessEnabled && permissionGranted,
    shareableTabCount,
    skippedTabCount,
  };
}

async function personalDataAccessState(): Promise<{
  bookmarks: { permissionGranted: boolean; active: boolean; supported: boolean };
  readingList: { permissionGranted: boolean; active: boolean; supported: boolean };
}> {
  const [settings, bookmarksPermissionGranted, readingListPermissionGranted] = await Promise.all([
    getSettings(),
    hasBookmarksPermission(),
    hasReadingListPermission(),
  ]);
  return {
    bookmarks: {
      permissionGranted: bookmarksPermissionGranted,
      active: settings.bookmarksAccessEnabled && bookmarksPermissionGranted,
      supported: !!browser.bookmarks,
    },
    readingList: {
      permissionGranted: readingListPermissionGranted,
      active: settings.readingListAccessEnabled && readingListPermissionGranted,
      supported: !!browser.readingList,
    },
  };
}

async function upsertAllTabsEntry(tab: BrowserTab, emit: boolean): Promise<void> {
  if (typeof tab.id !== "number" || !isShareableTabUrl(tab.url)) return;
  const tabId = tab.id;
  const url = tab.url;
  const origin = originForUrl(url);
  const title = tab.title ?? "";
  const existing = permittedTabs.get(tabId);

  if (existing?.accessMode === "manual" && existing.origin === origin) {
    existing.url = url;
    existing.title = title;
    permittedTabs.set(tabId, existing);
    if (emit) sendTabUpdated(tabId, existing);
    await updateBadge(tabId);
    return;
  }

  if (existing?.accessMode === "manual") {
    sendWS({ type: "tab_revoked", tabId, reason: "manual_origin_changed_during_all_tabs" });
  }

  const entry: PermittedTab = {
    url,
    title,
    origin,
    permittedAt: existing?.permittedAt ?? Date.now(),
    accessMode: "all_tabs",
  };
  permittedTabs.set(tabId, entry);

  if (emit) {
    if (existing?.accessMode === "all_tabs") sendTabUpdated(tabId, entry);
    else sendTabPermitted(tabId, entry);
  }
  await updateBadge(tabId);
}

async function revokeAllTabsEntries(reason: string): Promise<void> {
  const tabIds = Array.from(permittedTabs.entries())
    .filter(([, tab]) => tab.accessMode === "all_tabs")
    .map(([tabId]) => tabId);
  for (const tabId of tabIds) {
    await revokeTab(tabId, reason);
  }
}

async function permitTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url) throw new Error("tab has no URL");
  if (tab.incognito && !(await isIncognitoAccessAllowed())) {
    throw new GatewayError(
      "incognito_access_disabled",
      `Chrome has not allowed Agent Browser Gateway to run in incognito windows. Open chrome://extensions/?id=${browser.runtime.id} and enable "Allow in incognito".`,
    );
  }
  const url = tab.url;
  const origin = originForUrl(url);
  const title = tab.title ?? "";
  const entry: PermittedTab = {
    url,
    title,
    origin,
    permittedAt: Date.now(),
    accessMode: "manual",
  };
  permittedTabs.set(tabId, entry);
  await saveState();
  sendTabPermitted(tabId, entry);
  await attachDebugger(tabId);
  await updateBadge(tabId);
}

async function revokeTab(tabId: number, reason: string): Promise<void> {
  if (!permittedTabs.has(tabId)) return;
  permittedTabs.delete(tabId);
  consoleBuffers.delete(tabId);
  networkBuffers.delete(tabId);
  pendingDialogs.delete(tabId);
  downloadsByTab.delete(tabId);
  for (const [downloadId, mappedTabId] of downloadIdToTab) {
    if (mappedTabId === tabId) downloadIdToTab.delete(downloadId);
  }
  for (const [guid, mappedTabId] of downloadGuidToTab) {
    if (mappedTabId === tabId) downloadGuidToTab.delete(guid);
  }
  streamingTabs.delete(tabId);
  stopRecordingForTab(tabId);
  await saveState();
  sendWS({ type: "tab_revoked", tabId, reason });
  await detachDebugger(tabId);
  await updateBadge(tabId);
}

async function updateBadge(tabId: number): Promise<void> {
  const tab = permittedTabs.get(tabId);
  const isRecording = recordingSession?.tabId === tabId;
  try {
    await browser.action.setBadgeText({
      tabId,
      text: isRecording ? "REC" : tab ? (tab.accessMode === "all_tabs" ? "ALL" : "ON") : "",
    });
    if (isRecording) {
      await browser.action.setBadgeBackgroundColor({ tabId, color: "#ff3b30" });
    } else if (tab) {
      await browser.action.setBadgeBackgroundColor({
        tabId,
        color: tab.accessMode === "all_tabs" ? "#0a84ff" : "#34c759",
      });
    }
  } catch {}
}

// ---------- Tab lifecycle hooks ----------

browser.tabs.onCreated.addListener(async (tab) => {
  if ((await isAllTabsAccessActive()) && isShareableTabUrl(tab.url)) {
    await upsertAllTabsEntry(tab, true);
    await saveState();
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const currentUrl = tab.url ?? changeInfo.url;
  if ((await isAllTabsAccessActive()) && isShareableTabUrl(currentUrl)) {
    await upsertAllTabsEntry({ ...tab, id: tabId, url: currentUrl }, true);
    await saveState();
    return;
  }

  if (!permittedTabs.has(tabId)) return;
  const old = permittedTabs.get(tabId);
  if (!old) return;
  if (old.accessMode === "all_tabs") {
    await revokeTab(tabId, "all_tabs_not_shareable");
    return;
  }
  if (changeInfo.url) {
    let newOrigin = "";
    try {
      newOrigin = new URL(changeInfo.url).origin;
    } catch {}
    if (newOrigin && newOrigin !== old.origin) {
      await revokeTab(tabId, "origin_changed");
      return;
    }
    old.url = changeInfo.url;
    if (tab.title) old.title = tab.title;
    permittedTabs.set(tabId, old);
    await saveState();
    sendTabUpdated(tabId, old);
  } else if (changeInfo.title) {
    old.title = changeInfo.title;
    permittedTabs.set(tabId, old);
    await saveState();
    sendTabUpdated(tabId, old);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  if (permittedTabs.has(tabId)) {
    permittedTabs.delete(tabId);
    consoleBuffers.delete(tabId);
    networkBuffers.delete(tabId);
    pendingDialogs.delete(tabId);
    downloadsByTab.delete(tabId);
    for (const [downloadId, mappedTabId] of downloadIdToTab) {
      if (mappedTabId === tabId) downloadIdToTab.delete(downloadId);
    }
    for (const [guid, mappedTabId] of downloadGuidToTab) {
      if (mappedTabId === tabId) downloadGuidToTab.delete(guid);
    }
    streamingTabs.delete(tabId);
    stopRecordingForTab(tabId);
    await saveState();
    sendWS({ type: "tab_closed", tabId });
    await detachDebugger(tabId);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadge(tabId);
});

browser.windows.onRemoved.addListener((windowId) => {
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.windowId === windowId) {
      finalizeApproval(approvalId, {
        decision: "deny",
        message: "Operation denied because the approval window was closed.",
      });
      break;
    }
  }
});

// ---------- Debugger (for screenshot + console) ----------

async function attachDebugger(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return;
  try {
    await browser.debugger.attach({ tabId }, "1.3");
    await browser.debugger.sendCommand({ tabId }, "Runtime.enable");
    await browser.debugger.sendCommand({ tabId }, "Network.enable");
    await browser.debugger.sendCommand({ tabId }, "Page.enable");
    attachedTabs.add(tabId);
  } catch (e) {
    console.warn("[ABG] debugger.attach failed", e);
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;
  try {
    await browser.debugger.detach({ tabId });
  } catch {}
  attachedTabs.delete(tabId);
}

browser.debugger.onEvent.addListener((source, method, params) => {
  if (!source.tabId) return;
  if (method === "Runtime.consoleAPICalled") {
    const p = params as {
      type: string;
      args: { type: string; value?: unknown; description?: string }[];
    };
    const text = p.args
      .map((a) =>
        a.value !== undefined
          ? typeof a.value === "string"
            ? a.value
            : JSON.stringify(a.value)
          : (a.description ?? a.type),
      )
      .join(" ");
    const buf = consoleBuffers.get(source.tabId) ?? [];
    buf.push({ ts: Date.now(), level: p.type, text });
    while (buf.length > 200) buf.shift();
    consoleBuffers.set(source.tabId, buf);
    emitStreamEvent(source.tabId, { kind: "console", level: p.type, text });
  } else if (method === "Runtime.exceptionThrown") {
    const ex = (
      params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
    ).exceptionDetails;
    if (!ex) return;
    const text = ex.exception?.description ?? ex.text ?? "(unknown exception)";
    const buf = consoleBuffers.get(source.tabId) ?? [];
    buf.push({ ts: Date.now(), level: "error", text });
    while (buf.length > 200) buf.shift();
    consoleBuffers.set(source.tabId, buf);
    emitStreamEvent(source.tabId, { kind: "console", level: "error", text });
  } else if (method === "Page.javascriptDialogOpening") {
    const p = params as {
      url?: string;
      message?: string;
      type?: string;
      defaultPrompt?: string;
    };
    const dialog: PendingDialog = {
      type: p.type ?? "unknown",
      message: p.message ?? "",
      defaultPrompt: p.defaultPrompt,
      url: p.url,
      openedAt: Date.now(),
    };
    pendingDialogs.set(source.tabId, dialog);
    emitStreamEvent(source.tabId, {
      kind: "dialog",
      phase: "opening",
      dialog: publicDialogState(source.tabId).dialog,
    });
  } else if (method === "Page.javascriptDialogClosed") {
    const dialog = pendingDialogs.get(source.tabId);
    pendingDialogs.delete(source.tabId);
    emitStreamEvent(source.tabId, {
      kind: "dialog",
      phase: "closed",
      dialog: dialog ? publicDialog(dialog) : undefined,
    });
  } else if (method === "Page.downloadWillBegin") {
    const p = params as {
      guid?: string;
      url?: string;
      suggestedFilename?: string;
    };
    if (p.guid && p.url) {
      const record = upsertTabDownload(source.tabId, {
        id: p.guid,
        guid: p.guid,
        tabId: source.tabId,
        url: p.url,
        suggestedFilename: p.suggestedFilename,
        status: "in_progress",
        startedAt: new Date().toISOString(),
        updatedAt: Date.now(),
      });
      downloadGuidToTab.set(p.guid, source.tabId);
      emitStreamEvent(source.tabId, {
        kind: "download",
        phase: "started",
        download: publicDownload(record),
      });
    }
  } else if (method === "Page.downloadProgress") {
    const p = params as {
      guid?: string;
      state?: "inProgress" | "completed" | "canceled";
      totalBytes?: number;
      receivedBytes?: number;
    };
    const tabId = p.guid ? downloadGuidToTab.get(p.guid) : undefined;
    if (p.guid && tabId) {
      const status: DownloadStatus =
        p.state === "completed"
          ? "complete"
          : p.state === "canceled"
            ? "interrupted"
            : "in_progress";
      const record = upsertTabDownload(tabId, {
        id: p.guid,
        guid: p.guid,
        tabId,
        url: "",
        status,
        bytesReceived: p.receivedBytes,
        totalBytes: p.totalBytes,
        startedAt: new Date().toISOString(),
        endedAt: status === "in_progress" ? undefined : new Date().toISOString(),
        updatedAt: Date.now(),
        error: p.state === "canceled" ? "CANCELED" : undefined,
      });
      emitStreamEvent(tabId, {
        kind: "download",
        phase: status === "in_progress" ? "progress" : status,
        download: publicDownload(record),
      });
    }
  } else if (method === "Network.requestWillBeSent") {
    const p = params as {
      requestId: string;
      timestamp: number;
      wallTime?: number;
      type?: string;
      request: { method: string; url: string };
    };
    const buf = networkBuffers.get(source.tabId) ?? [];
    const active = activeNetworkRequests.get(source.tabId) ?? new Set<string>();
    active.add(p.requestId);
    activeNetworkRequests.set(source.tabId, active);
    buf.push({
      requestId: p.requestId,
      method: p.request.method,
      url: p.request.url,
      type: p.type?.toLowerCase(),
      ts: new Date((p.wallTime ?? Date.now() / 1000) * 1000).toISOString(),
      startTime: p.timestamp,
    });
    emitStreamEvent(source.tabId, {
      kind: "network",
      phase: "request",
      requestId: p.requestId,
      method: p.request.method,
      url: p.request.url,
      resourceType: p.type?.toLowerCase(),
    });
    while (buf.length > 200) buf.shift();
    networkBuffers.set(source.tabId, buf);
  } else if (method === "Network.responseReceived") {
    const p = params as {
      requestId: string;
      type?: string;
      response: { status: number; statusText?: string; mimeType?: string; url?: string };
    };
    const entry = findNetworkEntry(source.tabId, p.requestId);
    if (entry) {
      entry.type = p.type?.toLowerCase() ?? entry.type;
      entry.status = p.response.status;
      entry.statusText = p.response.statusText;
      entry.mimeType = p.response.mimeType;
      if (p.response.url) entry.url = p.response.url;
    }
    emitStreamEvent(source.tabId, {
      kind: "network",
      phase: "response",
      requestId: p.requestId,
      status: p.response.status,
      url: p.response.url,
      resourceType: p.type?.toLowerCase(),
    });
  } else if (method === "Network.loadingFinished") {
    const p = params as { requestId: string; timestamp: number; encodedDataLength?: number };
    activeNetworkRequests.get(source.tabId)?.delete(p.requestId);
    const entry = findNetworkEntry(source.tabId, p.requestId);
    if (entry) {
      entry.durationMs = Math.max(0, Math.round((p.timestamp - entry.startTime) * 1000));
      entry.encodedDataLength = p.encodedDataLength;
    }
    emitStreamEvent(source.tabId, {
      kind: "network",
      phase: "finished",
      requestId: p.requestId,
      encodedDataLength: p.encodedDataLength,
    });
  } else if (method === "Network.loadingFailed") {
    const p = params as { requestId: string; timestamp: number; errorText?: string };
    activeNetworkRequests.get(source.tabId)?.delete(p.requestId);
    const entry = findNetworkEntry(source.tabId, p.requestId);
    if (entry) {
      entry.durationMs = Math.max(0, Math.round((p.timestamp - entry.startTime) * 1000));
      entry.errorText = p.errorText;
    }
    emitStreamEvent(source.tabId, {
      kind: "network",
      phase: "failed",
      requestId: p.requestId,
      errorText: p.errorText,
    });
  }
});

browser.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

browser.downloads.onCreated.addListener((item) => {
  void handleDownloadCreated(item);
});

browser.downloads.onChanged.addListener((delta) => {
  void handleDownloadChanged(delta);
});

function upsertTabDownload(tabId: number, patch: DownloadRecord): DownloadRecord {
  const records = downloadsByTab.get(tabId) ?? [];
  const existing = records.find(
    (record) =>
      (patch.guid && record.guid === patch.guid) ||
      (patch.browserDownloadId !== undefined &&
        record.browserDownloadId === patch.browserDownloadId) ||
      record.id === patch.id,
  );
  const merged: DownloadRecord = existing
    ? {
        ...existing,
        ...patch,
        url: patch.url || existing.url,
        startedAt: existing.startedAt || patch.startedAt,
        updatedAt: Date.now(),
      }
    : { ...patch, updatedAt: Date.now() };
  if (!existing) records.push(merged);
  else records[records.indexOf(existing)] = merged;
  records.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  while (records.length > 50) records.shift();
  downloadsByTab.set(tabId, records);
  if (merged.browserDownloadId !== undefined) downloadIdToTab.set(merged.browserDownloadId, tabId);
  if (merged.guid) downloadGuidToTab.set(merged.guid, tabId);
  return merged;
}

function resolveDownloadTab(item: BrowserDownloadItem): number | undefined {
  const mapped = downloadIdToTab.get(item.id);
  if (mapped !== undefined) return mapped;
  for (const [tabId, records] of downloadsByTab) {
    const match = records
      .slice()
      .reverse()
      .find(
        (record) =>
          !record.browserDownloadId && (record.url === item.url || record.url === item.finalUrl),
      );
    if (match) return tabId;
  }
  if (item.referrer) {
    for (const [tabId, tab] of permittedTabs) {
      if (tab.url === item.referrer || originForUrl(tab.url) === originForUrl(item.referrer)) {
        return tabId;
      }
    }
  }
  return undefined;
}

function recordFromDownloadItem(
  item: BrowserDownloadItem,
  tabId: number,
  existingId?: string,
): DownloadRecord {
  return {
    id: existingId ?? `download-${item.id}`,
    tabId,
    browserDownloadId: item.id,
    url: item.url,
    finalUrl: item.finalUrl,
    referrer: item.referrer,
    suggestedFilename: item.filename ? item.filename.split(/[\\/]/).pop() : undefined,
    filename: item.filename,
    mime: item.mime,
    status: item.state,
    error: item.error,
    bytesReceived: item.bytesReceived,
    totalBytes: item.totalBytes,
    fileSize: item.fileSize,
    exists: item.exists,
    startedAt: item.startTime,
    endedAt: item.endTime,
    updatedAt: Date.now(),
  };
}

async function handleDownloadCreated(item: BrowserDownloadItem): Promise<void> {
  const tabId = resolveDownloadTab(item);
  if (tabId === undefined || !permittedTabs.has(tabId)) return;
  const existing = (downloadsByTab.get(tabId) ?? [])
    .slice()
    .reverse()
    .find(
      (record) =>
        !record.browserDownloadId && (record.url === item.url || record.url === item.finalUrl),
    );
  const record = upsertTabDownload(tabId, recordFromDownloadItem(item, tabId, existing?.id));
  emitStreamEvent(tabId, {
    kind: "download",
    phase: "created",
    download: publicDownload(record),
  });
}

async function handleDownloadChanged(delta: BrowserDownloadDelta): Promise<void> {
  let tabId = downloadIdToTab.get(delta.id);
  let item: BrowserDownloadItem | undefined;
  if (tabId === undefined) {
    const found = await browser.downloads.search({ id: delta.id });
    item = found[0];
    if (!item) return;
    tabId = resolveDownloadTab(item);
  }
  if (tabId === undefined || !permittedTabs.has(tabId)) return;
  item = item ?? (await browser.downloads.search({ id: delta.id }))[0];
  if (!item) return;
  const existing = (downloadsByTab.get(tabId) ?? []).find(
    (record) => record.browserDownloadId === delta.id,
  );
  const record = upsertTabDownload(tabId, recordFromDownloadItem(item, tabId, existing?.id));
  emitStreamEvent(tabId, {
    kind: "download",
    phase: record.status === "in_progress" ? "progress" : record.status,
    download: publicDownload(record),
  });
}

function findNetworkEntry(tabId: number, requestId: string): NetworkEntry | undefined {
  const buf = networkBuffers.get(tabId);
  if (!buf) return undefined;
  for (let i = buf.length - 1; i >= 0; i--) {
    const entry = buf[i];
    if (entry?.requestId === requestId) return entry;
  }
  return undefined;
}

// ---------- Gateway -> Extension commands ----------

async function handleGatewayCommand(cmd: GatewayCommand): Promise<void> {
  const tabId = cmd.params?.tabId;
  try {
    if (cmd.method === "bookmarks_list") {
      reply(cmd.id, await listBookmarks(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_search") {
      reply(cmd.id, await searchBookmarks(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_get") {
      reply(cmd.id, await getBookmark(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_open") {
      reply(cmd.id, await openBookmark(cmd.params ?? {}));
    } else if (cmd.method === "reading_list_list") {
      reply(cmd.id, await listReadingList(cmd.params ?? {}));
    } else if (cmd.method === "reading_list_search") {
      reply(cmd.id, await searchReadingList(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_create") {
      reply(cmd.id, await createBookmark(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_update") {
      reply(cmd.id, await updateBookmark(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_move") {
      reply(cmd.id, await moveBookmark(cmd.params ?? {}));
    } else if (cmd.method === "bookmarks_remove") {
      reply(cmd.id, await removeBookmark(cmd.params ?? {}));
    } else if (cmd.method === "reading_list_add") {
      reply(cmd.id, await addReadingListEntry(cmd.params ?? {}));
    } else if (cmd.method === "reading_list_update") {
      reply(cmd.id, await updateReadingListEntry(cmd.params ?? {}));
    } else if (cmd.method === "reading_list_remove") {
      reply(cmd.id, await removeReadingListEntry(cmd.params ?? {}));
    } else if (cmd.method === "raise_tab") {
      if (!tabId) throw new Error("tab not permitted");
      reply(cmd.id, await raisePermittedBrowserTab(browser, permittedTabs, tabId));
    } else if (cmd.method === "frames") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await listFrames(tabId));
    } else if (cmd.method === "read_dom") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await readDom(tabId, cmd.params?.selector, readFrameParam(cmd.params));
      reply(cmd.id, result);
    } else if (cmd.method === "get_dom") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await getDomValue(tabId, cmd.params ?? {}));
    } else if (cmd.method === "predicate") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await getPredicate(tabId, cmd.params ?? {}));
    } else if (cmd.method === "find") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await runFindCommand(tabId, cmd.params ?? {}));
    } else if (cmd.method === "snapshot") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await snapshotTab(tabId, cmd.params ?? {}));
    } else if (cmd.method === "screenshot") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await screenshot(tabId, cmd.params?.clip);
      reply(cmd.id, result);
    } else if (cmd.method === "pdf") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await printPagePDF(tabId));
    } else if (cmd.method === "console") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      await attachDebugger(tabId);
      const logs = consoleBuffers.get(tabId) ?? [];
      reply(cmd.id, { logs });
    } else if (cmd.method === "table") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await extractTables(tabId, cmd.params?.selector, readFrameParam(cmd.params)));
    } else if (cmd.method === "describe") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await describeElements(tabId, cmd.params ?? {}));
    } else if (cmd.method === "network_log") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await getNetworkLog(tabId, cmd.params ?? {}));
    } else if (cmd.method === "har_export") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await exportHAR(tabId, cmd.params ?? {}));
    } else if (cmd.method === "state_inspect") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await inspectState(tabId, cmd.params ?? {}));
    } else if (cmd.method === "framework_inspect") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await inspectFramework(tabId, cmd.params ?? {}));
    } else if (cmd.method === "download_state") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      await attachDebugger(tabId);
      reply(cmd.id, await getDownloadState(tabId, cmd.params ?? {}));
    } else if (cmd.method === "wait_for") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await waitFor(tabId, cmd.params ?? {}));
    } else if (cmd.method === "eval_script") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await runApprovedEval(tabId, cmd.params ?? {}));
    } else if (cmd.method === "annotation_mode") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      await attachDebugger(tabId);
      reply(cmd.id, await manageAnnotationMode(tabId, readAnnotationCommand(cmd.params)));
    } else if (cmd.method === "validate_editable") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await validateEditable(tabId, cmd.params ?? {}));
    } else if (cmd.method === "stream_control") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await setRuntimeStream(tabId, cmd.params?.enabled === true));
    } else if (cmd.method === "dialog_state") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      await attachDebugger(tabId);
      reply(cmd.id, publicDialogState(tabId));
    } else if (cmd.method === "revoke") {
      if (!tabId) throw new Error("tabId required");
      await revokeTab(tabId, "gateway_revoke");
      reply(cmd.id, { ok: true });
    } else if (cmd.method === "record_start") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await recordStart(tabId, cmd.params ?? {}));
    } else if (cmd.method === "record_stop") {
      reply(cmd.id, await recordStop(cmd.params ?? {}));
    } else if (cmd.method === "record_status") {
      reply(cmd.id, recordStatus());
    } else if (isOperationCommand(cmd)) {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await runApprovedOperation(cmd, tabId));
    } else {
      replyError(cmd.id, "unknown_method", String(cmd.method));
    }
  } catch (e) {
    if (e instanceof GatewayError) {
      replyError(cmd.id, e.code, e.message, e.matchCount);
    } else {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("Cannot access a chrome-extension:// URL")) {
        // A third-party extension iframe (typically a password manager's inline
        // menu) is attached to the page; Chrome refuses debugger access to the
        // whole tab until it goes away, and ABG cannot dismiss it because the
        // dismissal itself would need a blocked command.
        replyError(
          cmd.id,
          "blocked_by_extension_frame",
          "A third-party extension iframe (for example a password manager inline menu) is open in this tab, and Chrome blocks debugger commands for the whole tab until the user dismisses it (click elsewhere or press Escape). The dispatched action may still have executed. For identity-like forms, filling via eval with native value setters avoids focusing the field and never triggers the menu.",
        );
      } else {
        replyError(cmd.id, "command_failed", message);
      }
    }
  }
}

function ensureBookmarksSupported(): void {
  if (!browser.bookmarks) {
    throw new GatewayError(
      "bookmarks_unsupported",
      "This browser extension target does not expose the chrome.bookmarks API.",
    );
  }
}

function ensureReadingListSupported(): void {
  if (!browser.readingList) {
    throw new GatewayError(
      "reading_list_unsupported",
      "This browser extension target does not expose the chrome.readingList API. Chrome documents the API for Chrome 120+; other Chromium browsers may omit it.",
    );
  }
}

async function requireBookmarksAccess(): Promise<NonNullable<typeof browser.bookmarks>> {
  const api = browser.bookmarks;
  if (!api) {
    throw new GatewayError(
      "bookmarks_unsupported",
      "This browser extension target does not expose the chrome.bookmarks API.",
    );
  }
  if (!(await isBookmarksAccessActive())) {
    throw new GatewayError(
      "bookmarks_permission_required",
      "Bookmark inspection requires the separate bookmarks permission. Enable Bookmarks access in the ABG extension popup.",
    );
  }
  return api;
}

async function requireReadingListAccess(): Promise<NonNullable<typeof browser.readingList>> {
  const api = browser.readingList;
  if (!api) {
    throw new GatewayError(
      "reading_list_unsupported",
      "This browser extension target does not expose the chrome.readingList API. Chrome documents the API for Chrome 120+; other Chromium browsers may omit it.",
    );
  }
  if (!(await isReadingListAccessActive())) {
    throw new GatewayError(
      "reading_list_permission_required",
      "Reading List inspection requires the separate Reading List permission. Enable Reading List access in the ABG extension popup.",
    );
  }
  return api;
}

function isBookmarkNode(value: unknown): value is BrowserBookmarkTreeNode {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function bookmarkPath(parents: string[], title: string): string {
  return [...parents, title].filter(Boolean).join(" / ");
}

function publicBookmarkNode(
  node: BrowserBookmarkTreeNode,
  parents: string[] = [],
): Record<string, unknown> {
  const isFolder = !node.url;
  const output: Record<string, unknown> = {
    id: node.id,
    title: node.title,
    type: isFolder ? "folder" : "bookmark",
    path: bookmarkPath(parents, node.title),
  };
  if (node.url) output.url = node.url;
  if (node.parentId) output.parentId = node.parentId;
  if (typeof node.index === "number") output.index = node.index;
  if (typeof node.dateAdded === "number") output.dateAdded = node.dateAdded;
  if (typeof node.dateGroupModified === "number") {
    output.dateGroupModified = node.dateGroupModified;
  }
  const dateLastUsed = (node as BrowserBookmarkTreeNode & { dateLastUsed?: number }).dateLastUsed;
  if (typeof dateLastUsed === "number") output.dateLastUsed = dateLastUsed;
  const children = node.children ?? [];
  if (children.length > 0) {
    output.children = children.map((child) => publicBookmarkNode(child, [...parents, node.title]));
  }
  return output;
}

function flattenBookmarkNodes(
  nodes: BrowserBookmarkTreeNode[],
  parents: string[] = [],
  includeFolders = false,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (includeFolders || node.url) rows.push(publicBookmarkNode(node, parents));
    if (node.children) {
      rows.push(...flattenBookmarkNodes(node.children, [...parents, node.title], includeFolders));
    }
  }
  return rows;
}

function findBookmarkNode(
  nodes: BrowserBookmarkTreeNode[],
  id: string,
  parents: string[] = [],
): { node: BrowserBookmarkTreeNode; parents: string[] } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parents };
    if (node.children) {
      const found = findBookmarkNode(node.children, id, [...parents, node.title]);
      if (found) return found;
    }
  }
  return null;
}

function readLimit(params: GatewayCommand["params"], fallback: number, maximum: number): number {
  const limit = params?.limit;
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(limit)));
}

async function listBookmarks(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const includeFolders = params?.includeFolders === true;
  const tree = await api.getTree();
  const rows = flattenBookmarkNodes(tree, [], includeFolders).slice(
    0,
    readLimit(params, 100, 1000),
  );
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "bookmarks",
    count: rows.length,
    bookmarks: rows,
  };
}

async function searchBookmarks(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const query = typeof params?.query === "string" ? params.query.trim() : "";
  if (!query) throw new GatewayError("bad_params", "query is required");
  const needle = query.toLowerCase();
  const tree = await api.getTree();
  const rows = flattenBookmarkNodes(tree, [], params?.includeFolders === true)
    .filter((node) => {
      const title = typeof node.title === "string" ? node.title : "";
      const url = typeof node.url === "string" ? node.url : "";
      return title.toLowerCase().includes(needle) || url.toLowerCase().includes(needle);
    })
    .slice(0, readLimit(params, 50, 500));
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "bookmarks",
    queryBytes: query.length,
    count: rows.length,
    bookmarks: rows,
  };
}

async function getBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const id = typeof params?.bookmarkId === "string" ? params.bookmarkId : "";
  if (!id) throw new GatewayError("bad_params", "bookmarkId is required");
  const found = findBookmarkNode(await api.getTree(), id);
  if (!found) throw new GatewayError("bookmark_not_found", `Bookmark not found: ${id}`);
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "bookmarks",
    bookmark: publicBookmarkNode(found.node, found.parents),
  };
}

async function openBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const id = typeof params?.bookmarkId === "string" ? params.bookmarkId : "";
  if (!id) throw new GatewayError("bad_params", "bookmarkId is required");
  const node = (await api.get(id)).find(isBookmarkNode);
  if (!node) throw new GatewayError("bookmark_not_found", `Bookmark not found: ${id}`);
  if (!node.url) throw new GatewayError("bookmark_is_folder", "Cannot open a bookmark folder.");
  const tab = await browser.tabs.create({ url: node.url, active: true });
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "bookmarks",
    opened: true,
    bookmarkId: id,
    tabId: tab.id,
    title: node.title,
  };
}

function publicReadingListEntry(entry: BrowserReadingListEntry): Record<string, unknown> {
  return {
    title: entry.title,
    url: entry.url,
    hasBeenRead: entry.hasBeenRead,
    creationTime: entry.creationTime,
    lastUpdateTime: entry.lastUpdateTime,
  };
}

async function listReadingList(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireReadingListAccess();
  const query: BrowserReadingListQueryInfo = {};
  if (typeof params?.hasBeenRead === "boolean") query.hasBeenRead = params.hasBeenRead;
  const entries = (await api.query(query))
    .map(publicReadingListEntry)
    .slice(0, readLimit(params, 100, 1000));
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "readingList",
    count: entries.length,
    entries,
  };
}

async function approvePersonalDataMutation(intent: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.personalDataMutationsEnabled) {
    throw new GatewayError(
      "personal_data_mutations_disabled",
      "Bookmark and Reading List mutations are disabled. Enable them in the ABG extension popup first.",
    );
  }
  // Mutations always require per-operation approval; the operationsRequireApproval
  // opt-out does not apply to browser-owned personal data writes.
  const resolution = await requestOperationApproval("personal_data_mutation", -1, intent);
  if (resolution.decision !== "allow") {
    throw new GatewayError("user_denied", resolution.message);
  }
}

function personalDataMutationResult(
  permission: "bookmarks" | "readingList",
  mutation: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission,
    mutation,
    ...extra,
  };
}

async function createBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const title = typeof params?.title === "string" ? params.title : "";
  const url = typeof params?.url === "string" ? params.url : undefined;
  const parentId = typeof params?.parentId === "string" ? params.parentId : undefined;
  if (!title && !url) throw new GatewayError("bad_params", "title or url required");
  await approvePersonalDataMutation(
    personalDataMutationIntent("bookmark_create", { title, url, parentId }),
  );
  const node = await api.create({ title, url, parentId });
  return personalDataMutationResult("bookmarks", "create", { bookmark: publicBookmarkNode(node) });
}

async function updateBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const id = typeof params?.bookmarkId === "string" ? params.bookmarkId : undefined;
  if (!id) throw new GatewayError("bad_params", "bookmarkId required");
  const title = typeof params?.title === "string" ? params.title : undefined;
  const url = typeof params?.url === "string" ? params.url : undefined;
  if (title === undefined && url === undefined) {
    throw new GatewayError("bad_params", "title or url required");
  }
  const [existing] = await api.get(id);
  if (!existing) throw new GatewayError("not_found", `no bookmark with id ${id}`);
  await approvePersonalDataMutation(
    personalDataMutationIntent("bookmark_update", { title: existing.title, url, id }),
  );
  const node = await api.update(id, { title, url });
  return personalDataMutationResult("bookmarks", "update", { bookmark: publicBookmarkNode(node) });
}

async function moveBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const id = typeof params?.bookmarkId === "string" ? params.bookmarkId : undefined;
  if (!id) throw new GatewayError("bad_params", "bookmarkId required");
  const parentId = typeof params?.parentId === "string" ? params.parentId : undefined;
  const index = typeof params?.index === "number" ? params.index : undefined;
  if (parentId === undefined && index === undefined) {
    throw new GatewayError("bad_params", "parentId or index required");
  }
  const [existing] = await api.get(id);
  if (!existing) throw new GatewayError("not_found", `no bookmark with id ${id}`);
  await approvePersonalDataMutation(
    personalDataMutationIntent("bookmark_move", { title: existing.title, id, parentId }),
  );
  const node = await api.move(id, { parentId, index });
  return personalDataMutationResult("bookmarks", "move", { bookmark: publicBookmarkNode(node) });
}

async function removeBookmark(params: GatewayCommand["params"]): Promise<Record<string, unknown>> {
  const api = await requireBookmarksAccess();
  const id = typeof params?.bookmarkId === "string" ? params.bookmarkId : undefined;
  if (!id) throw new GatewayError("bad_params", "bookmarkId required");
  const [existing] = await api.get(id);
  if (!existing) throw new GatewayError("not_found", `no bookmark with id ${id}`);
  if (!existing.url) {
    // bookmarks.remove would only delete an empty folder, and recursive folder
    // deletion is deliberately not offered: a single approval must not be able
    // to erase a whole bookmark subtree.
    throw new GatewayError(
      "folder_removal_not_supported",
      "Deleting bookmark folders through ABG is not supported. Delete individual bookmarks instead.",
    );
  }
  await approvePersonalDataMutation(
    personalDataMutationIntent("bookmark_remove", { title: existing.title, id }),
  );
  await api.remove(id);
  return personalDataMutationResult("bookmarks", "remove", { removedId: id });
}

async function addReadingListEntry(
  params: GatewayCommand["params"],
): Promise<Record<string, unknown>> {
  const api = await requireReadingListAccess();
  const title = typeof params?.title === "string" ? params.title : undefined;
  const url = typeof params?.url === "string" ? params.url : undefined;
  if (!title || !url) throw new GatewayError("bad_params", "title and url required");
  await approvePersonalDataMutation(personalDataMutationIntent("reading_list_add", { title, url }));
  await api.addEntry({ title, url, hasBeenRead: params?.hasBeenRead === true });
  return personalDataMutationResult("readingList", "add", { url });
}

async function updateReadingListEntry(
  params: GatewayCommand["params"],
): Promise<Record<string, unknown>> {
  const api = await requireReadingListAccess();
  const url = typeof params?.url === "string" ? params.url : undefined;
  if (!url) throw new GatewayError("bad_params", "url required");
  const title = typeof params?.title === "string" ? params.title : undefined;
  const hasBeenRead = typeof params?.hasBeenRead === "boolean" ? params.hasBeenRead : undefined;
  if (title === undefined && hasBeenRead === undefined) {
    throw new GatewayError("bad_params", "title or hasBeenRead required");
  }
  await approvePersonalDataMutation(
    personalDataMutationIntent("reading_list_update", { title, url }),
  );
  await api.updateEntry({ url, title, hasBeenRead });
  return personalDataMutationResult("readingList", "update", { url });
}

async function removeReadingListEntry(
  params: GatewayCommand["params"],
): Promise<Record<string, unknown>> {
  const api = await requireReadingListAccess();
  const url = typeof params?.url === "string" ? params.url : undefined;
  if (!url) throw new GatewayError("bad_params", "url required");
  await approvePersonalDataMutation(personalDataMutationIntent("reading_list_remove", { url }));
  await api.removeEntry({ url });
  return personalDataMutationResult("readingList", "remove", { url });
}

async function searchReadingList(
  params: GatewayCommand["params"],
): Promise<Record<string, unknown>> {
  const api = await requireReadingListAccess();
  const queryText = typeof params?.query === "string" ? params.query.trim() : "";
  if (!queryText) throw new GatewayError("bad_params", "query is required");
  const all = await api.query({});
  const needle = queryText.toLowerCase();
  const entries = all
    .filter(
      (entry) =>
        entry.title.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle),
    )
    .map(publicReadingListEntry)
    .slice(0, readLimit(params, 50, 500));
  return {
    ok: true,
    boundary: "browser_owned_personal_data",
    permission: "readingList",
    queryBytes: queryText.length,
    count: entries.length,
    entries,
  };
}

function isOperationCommand(cmd: GatewayCommand): cmd is OperationCommand {
  return OPERATION_METHODS.has(cmd.method);
}

async function runApprovedOperation(cmd: OperationCommand, tabId: number): Promise<unknown> {
  const operation = buildOperation(cmd, tabId);
  await requireOperationApproval(cmd.method, tabId, operation.intent);
  return operation.run();
}

function buildOperation(cmd: OperationCommand, tabId: number): OperationDescriptor {
  const frame = readFrameParam(cmd.params);
  if (cmd.method === "click_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Click the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => clickSelector(tabId, selector, frame),
    };
  }
  if (cmd.method === "click_at") {
    const x = cmd.params?.x;
    const y = cmd.params?.y;
    if (typeof x !== "number" || typeof y !== "number") throw new Error("x and y required");
    return {
      intent: `Click at page coordinates (${x}, ${y}).`,
      run: () => clickAt(tabId, x, y),
    };
  }
  if (cmd.method === "click_ref") {
    const ref = cmd.params?.ref;
    if (typeof ref !== "string" || ref.length === 0) throw new Error("ref required");
    return {
      intent: `Click snapshot ref ${quoteForIntent(ref)}.`,
      run: () => clickSnapshotRef(tabId, ref),
    };
  }
  if (cmd.method === "click_described") {
    const id = cmd.params?.id;
    if (typeof id !== "number") throw new Error("id required");
    return {
      intent: `Click the element with describe id ${id}.`,
      run: () => clickDescribedElement(tabId, id, cmd.params ?? {}),
    };
  }
  if (cmd.method === "dblclick_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Double-click the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => doubleClickSelector(tabId, selector, frame),
    };
  }
  if (cmd.method === "focus_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Focus the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)} without clicking it.`,
      run: () => focusElement(tabId, selector, frame),
    };
  }
  if (cmd.method === "hover_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Move the mouse over the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => hoverSelector(tabId, selector, frame),
    };
  }
  if (cmd.method === "select_option") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    const value = typeof cmd.params?.value === "string" ? cmd.params.value : undefined;
    const label = typeof cmd.params?.label === "string" ? cmd.params.label : undefined;
    if ((value === undefined) === (label === undefined)) {
      throw new Error("exactly one of value or label required");
    }
    return {
      intent: `Select an option in ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => selectOption(tabId, selector, { value, label }, frame),
    };
  }
  if (cmd.method === "set_checked") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    const checked = cmd.params?.checked;
    if (typeof checked !== "boolean") throw new Error("checked boolean required");
    return {
      intent: `${checked ? "Check" : "Uncheck"} the input matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)} if needed.`,
      run: () => setChecked(tabId, selector, checked, frame),
    };
  }
  if (cmd.method === "fill") {
    const selector = cmd.params?.selector;
    const rawValue = cmd.params?.value;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    if (rawValue !== undefined && typeof rawValue !== "string") {
      throw new Error("value must be a string");
    }
    const value = rawValue ?? "";
    const dryRun = cmd.params?.dryRun === true;
    const auditDiff = cmd.params?.auditDiff === true;
    const auditDiffExcerptChars = cmd.params?.auditDiffExcerptChars;
    return {
      intent: dryRun
        ? `Preview editable replacement for selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`
        : auditDiff
          ? `Fill ${new TextEncoder().encode(value).byteLength} bytes into the editable target matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)} and capture a redacted audit diff.`
          : `Fill ${quoteForIntent(value)} into the editable target matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () =>
        fillField(tabId, selector, value, dryRun, frame, {
          auditDiff,
          auditDiffExcerptChars,
        }),
    };
  }
  if (cmd.method === "paste") {
    const selector = cmd.params?.selector;
    const rawValue = cmd.params?.value;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    if (rawValue !== undefined && typeof rawValue !== "string") {
      throw new Error("value must be a string");
    }
    const value = rawValue ?? "";
    return {
      intent: `Paste ${new TextEncoder().encode(value).byteLength} bytes into the editable element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => pasteText(tabId, selector, value, frame),
    };
  }
  if (cmd.method === "paste_rich") {
    const selector = typeof cmd.params?.selector === "string" ? cmd.params.selector : undefined;
    if (cmd.params?.selector !== undefined && (!selector || selector.length === 0)) {
      throw new Error("selector must be a non-empty string");
    }
    const mime = typeof cmd.params?.mime === "string" ? cmd.params.mime : undefined;
    const contentBytes =
      typeof cmd.params?.contentBytes === "number" ? cmd.params.contentBytes : undefined;
    const target = selector
      ? `the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}`
      : "the currently focused target";
    return {
      intent: `Paste${richClipboardPayloadLabel(mime, contentBytes)} into ${target}.`,
      run: () => pasteRichClipboard(tabId, selector, frame),
    };
  }
  if (cmd.method === "clear") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Clear the editable element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => clearEditable(tabId, selector, frame),
    };
  }
  if (cmd.method === "replace_dom") {
    const selector = cmd.params?.selector;
    const html = cmd.params?.html;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    if (typeof html !== "string" || html.length === 0) throw new Error("html required");
    return {
      intent: `Replace the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)} with provided HTML.`,
      run: () => replaceDom(tabId, selector, html, frame),
    };
  }
  if (cmd.method === "upload_file") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    const files = normalizeUploadFiles(cmd.params ?? {});
    const firstFile = files[0] ?? "";
    const fileIntent =
      files.length === 1
        ? `local file ${quoteForIntent(firstFile)}`
        : `${files.length} local files (${quoteForIntent(firstFile)}, ...)`;
    return {
      intent: `Attach ${fileIntent} to file input ${quoteForIntent(selector)}${frameIntentSuffix(frame)}.`,
      run: () => uploadFile(tabId, selector, files, frame),
    };
  }
  if (cmd.method === "type_text") {
    const text = cmd.params?.text;
    if (typeof text !== "string") throw new Error("text required");
    return {
      intent: `Type ${quoteForIntent(text)} into the focused element.`,
      run: () => typeText(tabId, text),
    };
  }
  if (cmd.method === "keyboard_insert_text") {
    const text = cmd.params?.text;
    if (typeof text !== "string") throw new Error("text required");
    return {
      intent: `Insert ${new TextEncoder().encode(text).byteLength} bytes into the focused element without key events.`,
      run: () => keyboardInsertText(tabId, text),
    };
  }
  if (cmd.method === "exec_command") {
    const command = cmd.params?.command;
    if (!isAllowedExecCommand(command)) {
      throw new GatewayError(
        "unsupported_exec_command",
        `unsupported execCommand: ${String(command ?? "")}`,
      );
    }
    const rawValue = cmd.params?.value;
    if (rawValue !== undefined && typeof rawValue !== "string") {
      throw new Error("value must be a string");
    }
    const value = rawValue;
    const valueBytes = value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
    return {
      intent: `Run document.execCommand(${command}) against the focused element with ${valueBytes} value bytes.`,
      run: () => execCommand(tabId, command, value),
    };
  }
  if (cmd.method === "key_press") {
    const key = cmd.params?.key;
    if (typeof key !== "string" || key.length === 0) throw new Error("key required");
    const code = typeof cmd.params?.code === "string" ? cmd.params.code : undefined;
    const modifiers = Array.isArray(cmd.params?.modifiers)
      ? cmd.params.modifiers.filter((modifier): modifier is string => typeof modifier === "string")
      : [];
    const chord = [...modifiers, key].join("+");
    return {
      intent: `Press ${quoteForIntent(chord)}.`,
      run: () => keyPress(tabId, key, code, modifiers),
    };
  }
  if (cmd.method === "key_down" || cmd.method === "key_up") {
    const key = cmd.params?.key;
    if (typeof key !== "string" || key.length === 0) throw new Error("key required");
    const code = typeof cmd.params?.code === "string" ? cmd.params.code : undefined;
    const modifiers = Array.isArray(cmd.params?.modifiers)
      ? cmd.params.modifiers.filter((modifier): modifier is string => typeof modifier === "string")
      : [];
    const chord = [...modifiers, key].join("+");
    const phase = cmd.method === "key_down" ? "down" : "up";
    return {
      intent: `Dispatch key ${phase} for ${quoteForIntent(chord)}.`,
      run: () =>
        keyEdge(tabId, cmd.method === "key_down" ? "keyDown" : "keyUp", key, code, modifiers),
    };
  }
  if (cmd.method === "navigate") {
    const url = cmd.params?.url;
    if (typeof url !== "string" || url.length === 0) throw new Error("url required");
    return {
      intent: `Navigate this tab to ${quoteForIntent(url)}.`,
      run: async () => {
        await browser.tabs.update(tabId, { url });
        return { ok: true, note: "navigation may revoke permission if origin changes" };
      },
    };
  }
  if (cmd.method === "sandbox_action") {
    const action = typeof cmd.params?.action === "string" ? cmd.params.action : "";
    if (action === "viewport") {
      const width = cmd.params?.width;
      const height = cmd.params?.height;
      if (typeof width !== "number" || typeof height !== "number") {
        throw new Error("width and height required");
      }
      const mobile = cmd.params?.mobile === true;
      return {
        intent: `Set sandbox viewport to ${width}x${height}${mobile ? " mobile" : ""}.`,
        run: () => sandboxSetViewport(tabId, cmd.params ?? {}),
      };
    }
    if (action === "viewport-clear") {
      return {
        intent: "Clear sandbox viewport emulation.",
        run: () => sandboxClearViewport(tabId),
      };
    }
    if (action === "storage-set" || action === "storage-delete") {
      const storageKind = normalizeSandboxStorageKind(cmd.params?.storageKind);
      const key = cmd.params?.storageKey;
      if (typeof key !== "string" || key.length === 0) throw new Error("storage key required");
      const value = typeof cmd.params?.value === "string" ? cmd.params.value : "";
      if (action === "storage-set" && typeof cmd.params?.value !== "string") {
        throw new Error("value required");
      }
      return {
        intent:
          action === "storage-set"
            ? `Set ${storageKind} key ${quoteForIntent(key)} to ${new TextEncoder().encode(value).byteLength} bytes in the sandbox profile.`
            : `Delete ${storageKind} key ${quoteForIntent(key)} from the sandbox profile.`,
        run: () =>
          sandboxStorage(tabId, storageKind, key, action === "storage-set" ? value : undefined),
      };
    }
    if (action === "tab-create") {
      const url = cmd.params?.url;
      if (typeof url !== "string" || url.length === 0) throw new Error("url required");
      return {
        intent: `Create a new sandbox tab for ${quoteForIntent(url)}.`,
        run: () => sandboxCreateTab(tabId, url),
      };
    }
    if (action === "tab-close") {
      const targetTabId = cmd.params?.targetTabId ?? tabId;
      if (typeof targetTabId !== "number") throw new Error("targetTabId must be a number");
      return {
        intent: `Close sandbox tab ${targetTabId}.`,
        run: () => sandboxCloseTab(targetTabId),
      };
    }
    throw new GatewayError(
      "bad_sandbox_action",
      "sandbox action must be viewport, viewport-clear, storage-set, storage-delete, tab-create, or tab-close",
    );
  }
  if (cmd.method === "drag") {
    const from = readDragPoint(cmd.params, "from");
    const to = readDragPoint(cmd.params, "to");
    const steps =
      typeof cmd.params?.steps === "number" ? Math.max(1, Math.min(100, cmd.params.steps)) : 12;
    return {
      intent: `Drag from ${describeDragPoint(from)} to ${describeDragPoint(to)}${frameIntentSuffix(frame)}.`,
      run: () => drag(tabId, from, to, steps),
    };
  }
  if (cmd.method === "scroll_into_view") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Scroll the element matching selector ${quoteForIntent(selector)}${frameIntentSuffix(frame)} into view.`,
      run: () => scrollElementIntoView(tabId, selector, frame),
    };
  }
  if (cmd.method === "dialog_action") {
    const action = typeof cmd.params?.action === "string" ? cmd.params.action : "";
    if (action !== "accept" && action !== "dismiss") {
      throw new Error("dialog action must be accept or dismiss");
    }
    const dialog = pendingDialogs.get(tabId);
    if (!dialog) {
      throw new GatewayError("no_dialog_pending", "no JavaScript dialog is pending for this tab");
    }
    const promptText =
      typeof cmd.params?.promptText === "string" ? cmd.params.promptText : undefined;
    const promptSuffix =
      promptText === undefined
        ? ""
        : ` with ${new TextEncoder().encode(promptText).byteLength} prompt bytes`;
    return {
      intent: `${action === "accept" ? "Accept" : "Dismiss"} ${dialog.type} dialog${promptSuffix}: ${quoteForIntent(dialog.message)}`,
      run: () => runDialogAction(tabId, cmd.params ?? {}),
    };
  }
  const deltaX = cmd.params?.deltaX ?? 0;
  const deltaY = cmd.params?.deltaY ?? 0;
  if (typeof deltaX !== "number" || typeof deltaY !== "number") {
    throw new Error("deltaX and deltaY must be numbers");
  }
  const atX = typeof cmd.params?.atX === "number" ? cmd.params.atX : undefined;
  const atY = typeof cmd.params?.atY === "number" ? cmd.params.atY : undefined;
  const selector = typeof cmd.params?.selector === "string" ? cmd.params.selector : undefined;
  const steps =
    typeof cmd.params?.steps === "number" ? Math.max(1, Math.min(100, cmd.params.steps)) : 1;
  if (selector !== undefined) {
    return {
      intent: `Scroll the element matching selector ${quoteForIntent(selector)} by (Δx=${deltaX}, Δy=${deltaY})${frameIntentSuffix(frame)}.`,
      run: () => scrollElement(tabId, selector, deltaX, deltaY, steps, frame),
    };
  }
  const where =
    atX !== undefined && atY !== undefined ? `at (${atX}, ${atY})` : "at viewport center";
  return {
    intent: `Scroll this tab by (Δx=${deltaX}, Δy=${deltaY}) ${where}.`,
    run: () => scrollTab(tabId, deltaX, deltaY, atX, atY),
  };
}

function quoteForIntent(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const shortValue = normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
  return `"${shortValue}"`;
}

function truncateText(value: string | undefined, limit = 500): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function publicDialog(dialog: PendingDialog): Record<string, unknown> {
  const encoder = new TextEncoder();
  return {
    type: dialog.type,
    message: truncateText(dialog.message),
    messageBytes: encoder.encode(dialog.message).byteLength,
    defaultPrompt: truncateText(dialog.defaultPrompt),
    defaultPromptBytes:
      dialog.defaultPrompt === undefined
        ? undefined
        : encoder.encode(dialog.defaultPrompt).byteLength,
    url: dialog.url,
    openedAt: new Date(dialog.openedAt).toISOString(),
  };
}

function publicDialogState(tabId: number): Record<string, unknown> {
  const dialog = pendingDialogs.get(tabId);
  return dialog ? { pending: true, dialog: publicDialog(dialog) } : { pending: false };
}

function publicDownload(record: DownloadRecord): Record<string, unknown> {
  const pathAvailable = record.status === "complete" && !!record.filename;
  return {
    id: record.id,
    browserDownloadId: record.browserDownloadId,
    guid: record.guid,
    tabId: record.tabId,
    url: record.url,
    finalUrl: record.finalUrl,
    referrer: record.referrer,
    suggestedFilename: record.suggestedFilename,
    filename: record.filename,
    pathAvailable,
    unavailableReason: pathAvailable
      ? undefined
      : record.status === "complete"
        ? "chrome_download_path_unavailable"
        : "download_not_complete",
    mime: record.mime,
    status: record.status,
    error: record.error,
    bytesReceived: record.bytesReceived,
    totalBytes: record.totalBytes,
    fileSize: record.fileSize,
    exists: record.exists,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  };
}

function downloadState(tabId: number): Record<string, unknown> {
  const downloads = (downloadsByTab.get(tabId) ?? []).map(publicDownload);
  return {
    ok: true,
    count: downloads.length,
    latest: downloads.at(-1),
    downloads,
  };
}

async function getDownloadState(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  if (params.wait !== true) return downloadState(tabId);
  const timeoutMs =
    typeof params.timeoutMs === "number"
      ? Math.max(1, Math.min(300_000, params.timeoutMs))
      : 30_000;
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const latest = (downloadsByTab.get(tabId) ?? []).at(-1);
    if (latest && latest.status !== "in_progress") {
      return {
        ok: latest.status === "complete",
        mode: "wait",
        elapsedMs: Date.now() - started,
        latest: publicDownload(latest),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    ok: false,
    error: "timeout",
    mode: "wait",
    timeoutMs,
    latest: (downloadsByTab.get(tabId) ?? []).at(-1)
      ? publicDownload((downloadsByTab.get(tabId) ?? []).at(-1) as DownloadRecord)
      : undefined,
  };
}

async function runDialogAction(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  const action = typeof params.action === "string" ? params.action : "";
  if (action !== "accept" && action !== "dismiss") {
    throw new GatewayError("bad_dialog_action", "dialog action must be accept or dismiss");
  }
  const dialog = pendingDialogs.get(tabId);
  if (!dialog) {
    throw new GatewayError("no_dialog_pending", "no JavaScript dialog is pending for this tab");
  }
  await attachDebugger(tabId);
  const promptText = typeof params.promptText === "string" ? params.promptText : undefined;
  const commandParams: Record<string, unknown> = { accept: action === "accept" };
  if (action === "accept" && promptText !== undefined) commandParams.promptText = promptText;
  await browser.debugger.sendCommand({ tabId }, "Page.handleJavaScriptDialog", commandParams);
  pendingDialogs.delete(tabId);
  return {
    ok: true,
    action,
    accepted: action === "accept",
    promptTextBytes:
      promptText === undefined ? undefined : new TextEncoder().encode(promptText).byteLength,
    dialog: publicDialog(dialog),
  };
}

function globMatch(pattern: string, text: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(text);
}

async function requireOperationApproval(
  method: OperationMethod,
  tabId: number,
  intent: string,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.operationsRequireApproval) return;

  const resolution = await requestOperationApproval(method, tabId, intent);
  if (resolution.decision !== "allow") {
    throw new GatewayError("user_denied", resolution.message);
  }
}

async function requestOperationApproval(
  method: ApprovalMethod,
  tabId: number,
  intent: string,
  script?: string,
): Promise<ApprovalResolution> {
  const request: ApprovalRequest = {
    id: crypto.randomUUID(),
    method,
    intent,
    script,
    tab: await getApprovalTab(tabId),
    createdAt: Date.now(),
    timeoutMs: APPROVAL_TIMEOUT_MS,
  };

  let resolveApproval: (resolution: ApprovalResolution) => void = () => {};
  const approvalPromise = new Promise<ApprovalResolution>((resolve) => {
    resolveApproval = resolve;
  });

  const timeoutId = setTimeout(() => {
    finalizeApproval(
      request.id,
      {
        decision: "timeout",
        message: "Operation denied because approval timed out.",
      },
      true,
    );
  }, APPROVAL_WINDOW_FALLBACK_TIMEOUT_MS) as unknown as number;

  const pending: PendingApproval = {
    request,
    resolve: resolveApproval,
    timeoutId,
  };
  pendingApprovals.set(request.id, pending);

  try {
    const approvalUrl = new URL(browser.runtime.getURL("approval.html"));
    approvalUrl.searchParams.set("id", request.id);
    const approvalWindow = await browser.windows.create({
      type: "popup",
      url: approvalUrl.href,
      width: script === undefined ? 380 : 520,
      height: script === undefined ? 240 : 420,
    });
    if (typeof approvalWindow.id === "number") {
      pending.windowId = approvalWindow.id;
    }
  } catch (e) {
    finalizeApproval(request.id, {
      decision: "deny",
      message: `Operation denied because the approval window could not open: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }

  return approvalPromise;
}

async function getApprovalTab(
  tabId: number,
): Promise<{ tabId: number; title: string; url: string }> {
  const permitted = permittedTabs.get(tabId);
  try {
    const tab = await browser.tabs.get(tabId);
    return {
      tabId,
      title: tab.title ?? permitted?.title ?? "",
      url: tab.url ?? permitted?.url ?? "",
    };
  } catch {
    return {
      tabId,
      title: permitted?.title ?? "",
      url: permitted?.url ?? "",
    };
  }
}

function finalizeApproval(
  approvalId: string,
  resolution: ApprovalResolution,
  closeWindow = false,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  clearTimeout(pending.timeoutId);
  if (closeWindow && pending.windowId !== undefined) {
    browser.windows.remove(pending.windowId).catch(() => {});
  }
  pending.resolve(resolution);
  return true;
}

function resolutionForDecision(decision: ApprovalDecision, streamId?: string): ApprovalResolution {
  if (decision === "allow") {
    return {
      decision,
      message: "Operation approved.",
      streamId,
    };
  }
  if (decision === "timeout") {
    return {
      decision,
      message: "Operation denied because approval timed out.",
    };
  }
  return {
    decision,
    message: "Operation denied by user.",
  };
}

// ---------- Recording (tab video + audio) ----------
//
// Recording is always approval-gated regardless of operationsRequireApproval:
// it captures tab audio (and optionally the microphone / physical room), which
// is heavier than the per-tab read/operate model. The approval-window "Allow"
// click doubles as the user gesture that mints the tabCapture stream ID, so the
// CLI-driven start still satisfies Chrome's gesture requirement.

const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen: Promise<void> | null = null;

async function recordStart(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{ recordingId: string; tabId: number; mic: boolean; mime: string }> {
  if (recordingSession) {
    throw new GatewayError(
      "already_recording",
      `A recording is already active on tab ${recordingSession.tabId}. Stop it first.`,
    );
  }
  const recordingId = params.recordingId ?? crypto.randomUUID();
  const withMic = params.mic === true;
  const intent = withMic
    ? "Record this tab to a video file, capturing tab audio and the microphone (physical room)."
    : "Record this tab to a video file, capturing tab audio.";

  const approval = await requestOperationApproval("record_start", tabId, intent);
  if (approval.decision !== "allow") {
    throw new GatewayError("user_denied", approval.message);
  }
  if (!approval.streamId) {
    throw new GatewayError(
      "no_capture_stream",
      "Approval did not yield a tab capture stream (the Allow click must mint it).",
    );
  }

  await ensureOffscreenDocument();
  const start = (await sendToOffscreen({
    target: "abg-offscreen",
    cmd: "start",
    recordingId,
    streamId: approval.streamId,
    withMic,
    timesliceMs: typeof params.timesliceMs === "number" ? params.timesliceMs : undefined,
  })) as OffscreenStartResult | undefined;
  if (!start?.ok) {
    throw new GatewayError("record_start_failed", start?.error ?? "offscreen recorder failed");
  }

  recordingSession = {
    recordingId,
    tabId,
    mic: start.micUsed === true,
    mime: start.mime ?? "video/webm",
    startedAt: Date.now(),
  };
  await updateBadge(tabId);
  return {
    recordingId,
    tabId,
    mic: recordingSession.mic,
    mime: recordingSession.mime,
  };
}

async function recordStop(
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{ ok: true; recordingId: string; tabId: number }> {
  const session = recordingSession;
  if (!session) {
    throw new GatewayError("not_recording", "No recording is active.");
  }
  if (params.recordingId && params.recordingId !== session.recordingId) {
    throw new GatewayError(
      "recording_mismatch",
      "recordingId does not match the active recording.",
    );
  }
  const stop = (await sendToOffscreen({
    target: "abg-offscreen",
    cmd: "stop",
    recordingId: session.recordingId,
  })) as OffscreenStopResult | undefined;
  if (!stop?.ok) {
    throw new GatewayError(
      "record_stop_failed",
      stop?.error ?? "offscreen recorder failed to stop",
    );
  }
  // The offscreen streams its trailing chunk(s) then a record_stopped event,
  // which the Gateway uses to finalize the webm file. The session is cleared
  // when that event is forwarded (handleOffscreenEvent).
  return { ok: true, recordingId: session.recordingId, tabId: session.tabId };
}

function recordStatus(): {
  recording: boolean;
  recordingId?: string;
  tabId?: number;
  mic?: boolean;
  mime?: string;
  startedAt?: number;
} {
  if (!recordingSession) return { recording: false };
  return {
    recording: true,
    recordingId: recordingSession.recordingId,
    tabId: recordingSession.tabId,
    mic: recordingSession.mic,
    mime: recordingSession.mime,
    startedAt: recordingSession.startedAt,
  };
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = (chrome as unknown as { offscreen?: typeof chrome.offscreen }).offscreen;
  if (!offscreen) throw new GatewayError("offscreen_unavailable", "offscreen API unavailable");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
        justification: "Record a shared tab (video + audio) to a local file.",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function sendToOffscreen(msg: BackgroundToOffscreen): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

function handleOffscreenEvent(rawMsg: Record<string, unknown>): void {
  const type = rawMsg.type;
  const recordingId = typeof rawMsg.recordingId === "string" ? rawMsg.recordingId : "";
  if (!recordingId) return;
  if (type === "abg_offscreen_chunk") {
    sendWS({
      type: "record_chunk",
      recordingId,
      seq: typeof rawMsg.seq === "number" ? rawMsg.seq : 0,
      dataBase64: typeof rawMsg.dataBase64 === "string" ? rawMsg.dataBase64 : "",
    });
    return;
  }
  if (type === "abg_offscreen_stopped") {
    sendWS({
      type: "record_stopped",
      recordingId,
      durationMs: typeof rawMsg.durationMs === "number" ? rawMsg.durationMs : 0,
      mime: typeof rawMsg.mime === "string" ? rawMsg.mime : "video/webm",
      micUsed: rawMsg.micUsed === true,
      chunkCount: typeof rawMsg.chunkCount === "number" ? rawMsg.chunkCount : 0,
    });
    void finishRecordingSession(recordingId);
    return;
  }
  if (type === "abg_offscreen_error") {
    sendWS({
      type: "record_failed",
      recordingId,
      error: typeof rawMsg.error === "string" ? rawMsg.error : "recording failed",
    });
    void finishRecordingSession(recordingId);
  }
}

async function finishRecordingSession(recordingId: string): Promise<void> {
  if (recordingSession?.recordingId !== recordingId) return;
  const tabId = recordingSession.tabId;
  recordingSession = null;
  await updateBadge(tabId);
}

// Best-effort: when a recording tab is revoked or closed, tell the offscreen to
// stop so the Gateway can finalize the file. The offscreen also self-stops when
// the tab's capture track ends, so this is belt-and-suspenders.
function stopRecordingForTab(tabId: number): void {
  if (recordingSession?.tabId !== tabId) return;
  void sendToOffscreen({
    target: "abg-offscreen",
    cmd: "stop",
    recordingId: recordingSession.recordingId,
  }).catch(() => {});
}

function reply(id: string, result: unknown): void {
  sendWS({ type: "response", id, result });
}

function replyError(id: string, code: string, message: string, matchCount?: number): void {
  sendWS({
    type: "response",
    id,
    error: matchCount === undefined ? { code, message } : { code, message, matchCount },
  });
}

type DomReadResult = {
  url: string;
  title: string;
  origin: string;
  selector?: string;
  frame?: FrameDescriptor;
  text: string;
  html?: string;
  markdown?: string;
  found?: boolean;
};

type FrameDescriptor = {
  ref: string;
  parentRef?: string;
  selector: string;
  name: string;
  title: string;
  url: string;
  src: string;
  origin: string;
  sameOrigin: boolean;
  accessible: boolean;
  childCount: number;
  depth: number;
  lineage: string[];
};

type FrameContext = {
  doc: Document;
  win: Window;
  frame?: FrameDescriptor;
  offsetX: number;
  offsetY: number;
  /** Deep query across open shadow roots (light DOM first, document order per root). */
  query(selector: string, root?: ParentNode): Element | null;
  queryAll(selector: string, root?: ParentNode): Element[];
};

type FrameScriptError = {
  __abgFrameError: true;
  code: string;
  message: string;
  matchCount?: number;
};

type SnapshotRefTarget = { selector: string; frame?: string };

function readFrameParam(params: GatewayCommand["params"] | undefined): string | undefined {
  return typeof params?.frame === "string" && params.frame.length > 0 ? params.frame : undefined;
}

function frameIntentSuffix(frame: string | undefined): string {
  return frame ? ` inside frame ${quoteForIntent(frame)}` : "";
}

function createFrameApiSource(): string {
  return `() => {
    const fail = (code, message) => {
      const err = new Error(message);
      err.code = code;
      throw err;
    };
    const cssEscape = (value) => {
      const escaper = globalThis.CSS && globalThis.CSS.escape;
      return escaper ? escaper(value) : String(value).replace(/["\\\\]/g, "\\\\$&");
    };
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const selectorFor = (el, rootDocument) => {
      if (el.id) {
        const idSelector = "#" + cssEscape(el.id);
        if (rootDocument.querySelectorAll(idSelector).length === 1) return idSelector;
      }
      for (const attr of ["data-testid", "data-test", "name", "aria-label", "title", "src"]) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const selector = el.tagName.toLowerCase() + "[" + attr + "=\\"" + cssEscape(value) + "\\"]";
        if (rootDocument.querySelectorAll(selector).length === 1) return selector;
      }
      const parts = [];
      let current = el;
      while (current && parts.length < 5) {
        const parent = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        const nth = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + nth + ")" : tag);
        current = parent;
      }
      return parts.join(" > ");
    };
    const publicFrame = (item) => ({
      ref: item.ref,
      parentRef: item.parentRef || undefined,
      selector: item.selector,
      name: item.name,
      title: item.title,
      url: item.url,
      src: item.src,
      origin: item.origin,
      sameOrigin: item.sameOrigin,
      accessible: item.accessible,
      childCount: item.childCount,
      depth: item.depth,
      lineage: item.lineage,
    });
    const collectFrames = () => {
      const items = [];
      const collect = (doc, parentRef, offsetX, offsetY, lineage) => {
        const frames = Array.from(doc.querySelectorAll("iframe, frame"));
        for (const element of frames) {
          const rect = element.getBoundingClientRect();
          const ref = "@f" + (items.length + 1);
          const src = element.getAttribute("src") || "";
          let childDoc = null;
          let childWin = null;
          let accessible = false;
          let sameOrigin = false;
          let childCount = 0;
          let url = element.src || src || "about:blank";
          let title = element.getAttribute("title") || "";
          let origin = "";
          try {
            childWin = element.contentWindow;
            childDoc = element.contentDocument || (childWin && childWin.document);
            if (childDoc && childWin) {
              accessible = true;
              sameOrigin = true;
              url = childWin.location.href;
              title = childDoc.title || title;
              origin = childWin.location.origin;
              childCount = childDoc.querySelectorAll("iframe, frame").length;
            }
          } catch (_error) {
            childDoc = null;
            childWin = null;
          }
          const nextLineage = lineage.concat(ref);
          const item = {
            ref,
            parentRef,
            selector: selectorFor(element, doc),
            name: element.getAttribute("name") || "",
            title,
            url,
            src,
            origin,
            sameOrigin,
            accessible,
            childCount,
            depth: lineage.length,
            lineage: nextLineage,
            element,
            doc: childDoc,
            win: childWin,
            offsetX: offsetX + rect.left,
            offsetY: offsetY + rect.top,
          };
          items.push(item);
          if (accessible && childDoc) collect(childDoc, ref, item.offsetX, item.offsetY, nextLineage);
        }
      };
      collect(document, undefined, 0, 0, []);
      return items;
    };
    const deepQueryAll = (root, selector) => {
      const out = [];
      const visit = (node) => {
        if (!node || !node.querySelectorAll) return;
        for (const el of node.querySelectorAll(selector)) out.push(el);
        for (const el of node.querySelectorAll("*")) {
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      };
      visit(root);
      return out;
    };
    const withQueries = (ctx) => {
      ctx.queryAll = (selector, root) => deepQueryAll(root || ctx.doc, selector);
      ctx.query = (selector, root) => ctx.queryAll(selector, root)[0] || null;
      return ctx;
    };
    return {
      listFrames: () => collectFrames().map(publicFrame),
      resolve: (target) => {
        if (!target) {
          return withQueries({ doc: document, win: window, frame: undefined, offsetX: 0, offsetY: 0 });
        }
        const frames = collectFrames();
        let found = null;
        if (/^@f\\d+$/.test(target)) {
          found = frames[Number(target.slice(2)) - 1] || null;
        } else {
          const topElement = document.querySelector(target);
          if (topElement) found = frames.find((item) => item.element === topElement) || null;
        }
        if (!found) {
          fail("frame_not_found", "frame not found: " + target);
        }
        if (!found.accessible || !found.doc || !found.win) {
          fail(
            "frame_not_accessible",
            "frame is not same-origin or is not accessible for selector targeting: " + target,
          );
        }
        return withQueries({
          doc: found.doc,
          win: found.win,
          frame: publicFrame(found),
          offsetX: found.offsetX,
          offsetY: found.offsetY,
        });
      },
      normalize,
    };
  }`;
}

async function evaluatePageExpression<T>(tabId: number, expression: string): Promise<T> {
  if (!browser.supportsDebugger) {
    return evaluatePageExpressionWithScripting<T>(tabId, expression);
  }

  await attachDebugger(tabId);
  const res = (await browser.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: { value?: T | FrameScriptError };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  if (res.exceptionDetails) {
    throw new Error(
      `frame script failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
    );
  }
  const value = res.result?.value;
  if (
    value &&
    typeof value === "object" &&
    "__abgFrameError" in value &&
    (value as FrameScriptError).__abgFrameError
  ) {
    const err = value as FrameScriptError;
    throw new GatewayError(err.code, err.message, err.matchCount);
  }
  return value as T;
}

async function evaluatePageExpressionWithScripting<T>(
  tabId: number,
  expression: string,
): Promise<T> {
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: (source: string) => {
      try {
        // biome-ignore lint/security/noGlobalEval: Firefox evaluates ABG-owned frame scripts for the shared tab fallback.
        return { ok: true, value: globalThis.eval(source) };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    args: [expression],
  });
  const payload = res?.result as
    | { ok: true; value?: T | FrameScriptError }
    | { ok: false; message?: string }
    | undefined;
  if (!payload) {
    throw new Error("script injection returned no result");
  }
  if (!payload.ok) {
    throw new Error(`frame script failed: ${payload.message ?? "unknown error"}`);
  }
  const value = payload.value;
  if (
    value &&
    typeof value === "object" &&
    "__abgFrameError" in value &&
    (value as FrameScriptError).__abgFrameError
  ) {
    const err = value as FrameScriptError;
    throw new GatewayError(err.code, err.message, err.matchCount);
  }
  return value as T;
}

async function runFrameScript<T, Args>(
  tabId: number,
  frame: string | undefined,
  args: Args,
  pageFn: (ctx: FrameContext, args: Args) => T,
): Promise<T> {
  const expression = `(() => {
    const __abgFrameTarget = ${JSON.stringify(frame ?? null)};
    const __abgArgs = ${JSON.stringify(args ?? null)};
    const __abgCreateFrameApi = ${createFrameApiSource()};
    const __abgPageFn = ${pageFn.toString()};
    try {
      const __abgApi = __abgCreateFrameApi();
      return __abgPageFn(__abgApi.resolve(__abgFrameTarget), __abgArgs);
    } catch (error) {
      const frameError = {
        __abgFrameError: true,
        code: error && error.code ? error.code : "frame_script_failed",
        message: error && error.message ? error.message : String(error),
      };
      if (error && typeof error.matchCount === "number") {
        frameError.matchCount = error.matchCount;
      }
      return frameError;
    }
  })()`;
  return evaluatePageExpression<T>(tabId, expression);
}

async function listFrames(
  tabId: number,
): Promise<{ url: string; title: string; count: number; frames: FrameDescriptor[] }> {
  const expression = `(() => {
    const __abgCreateFrameApi = ${createFrameApiSource()};
    const __abgApi = __abgCreateFrameApi();
    const frames = __abgApi.listFrames();
    return { url: location.href, title: document.title, count: frames.length, frames };
  })()`;
  return evaluatePageExpression(tabId, expression);
}

async function readDom(
  tabId: number,
  selector: string | undefined,
  frame: string | undefined,
): Promise<DomReadResult> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const sel = opts.selector;
    const root: Element | null = sel ? ctx.query(sel) : ctx.doc.documentElement;
    if (sel && !root) {
      return {
        url: ctx.win.location.href,
        title: ctx.doc.title,
        origin: ctx.win.location.origin,
        selector: sel,
        frame: ctx.frame,
        found: false,
        text: "",
      } as const;
    }
    const target = root ?? document.documentElement;
    const isElementWithInnerText = (el: unknown): el is HTMLElement =>
      typeof (el as HTMLElement).innerText === "string";
    const text = isElementWithInnerText(target) ? target.innerText : (target.textContent ?? "");
    return {
      url: ctx.win.location.href,
      title: ctx.doc.title,
      origin: ctx.win.location.origin,
      selector: sel ?? undefined,
      frame: ctx.frame,
      found: sel ? true : undefined,
      text,
      html: (target as Element).outerHTML,
    } as const;
  });
}

async function getDomValue(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  const kind = typeof params.kind === "string" ? params.kind : "";
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const name = typeof params.name === "string" ? params.name : undefined;
  const props = Array.isArray(params.props)
    ? params.props.filter((prop): prop is string => typeof prop === "string")
    : undefined;
  const frame = readFrameParam(params);
  return runFrameScript(tabId, frame, { kind, selector, name, props }, (ctx, opts) => {
    const getter = opts.kind;
    const sel = opts.selector;
    const attrName = opts.name;
    const styleProps = opts.props;
    const selected = sel ? ctx.queryAll(sel) : [];
    const first = selected[0] as HTMLElement | undefined;
    const textOf = (el: Element): string =>
      ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    const boxOf = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(ctx.offsetX + rect.left),
        y: Math.round(ctx.offsetY + rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const base = {
      kind: getter,
      selector: sel,
      frame: ctx.frame,
      url: ctx.win.location.href,
      title: ctx.doc.title,
    };
    if (getter === "title") return { ...base, value: ctx.doc.title };
    if (getter === "url") return { ...base, value: ctx.win.location.href };
    if (!sel) return { ...base, found: false, error: "selector_required" };
    if (getter === "count") return { ...base, value: selected.length };
    if (!first) return { ...base, found: false };
    if (getter === "text") return { ...base, found: true, value: textOf(first) };
    if (getter === "html") return { ...base, found: true, value: first.outerHTML };
    if (getter === "value") {
      let value: string | string[] | boolean | null = null;
      if (first instanceof HTMLInputElement) {
        value = first.type === "checkbox" || first.type === "radio" ? first.checked : first.value;
      } else if (first instanceof HTMLTextAreaElement) {
        value = first.value;
      } else if (first instanceof HTMLSelectElement) {
        value = Array.from(first.selectedOptions).map((option) => option.value);
      }
      return { ...base, found: true, value };
    }
    if (getter === "editable-value") {
      let editableText = "";
      let kind = "unsupported";
      let source = "none";
      if (first instanceof HTMLInputElement) {
        editableText = first.value;
        kind = "input";
        source = "value";
      } else if (first instanceof HTMLTextAreaElement) {
        editableText = first.value;
        kind = "textarea";
        source = "value";
      } else if (first.isContentEditable) {
        editableText = first.innerText || first.textContent || "";
        kind = "contenteditable";
        source = "innerText";
      } else if (first.getAttribute("role") === "textbox") {
        editableText = first.innerText || first.textContent || "";
        kind = "role-textbox";
        source = "innerText";
      } else {
        return { ...base, found: true, editable: false, kind, error: "not_editable" };
      }
      const normalizedHtmlText = textOf(first);
      return {
        ...base,
        found: true,
        editable: true,
        kind,
        source,
        editableText,
        html: first.outerHTML,
        differsFromHtmlText: editableText.replace(/\s+/g, " ").trim() !== normalizedHtmlText,
      };
    }
    if (getter === "attr") {
      if (!attrName) return { ...base, found: true, error: "attr_name_required" };
      return { ...base, found: true, name: attrName, value: first.getAttribute(attrName) };
    }
    if (getter === "box") return { ...base, found: true, value: boxOf(first) };
    if (getter === "styles") {
      const computed = getComputedStyle(first);
      const keys = styleProps && styleProps.length > 0 ? styleProps : Array.from(computed).sort();
      const values: Record<string, string> = {};
      for (const key of keys) values[key] = computed.getPropertyValue(key);
      return { ...base, found: true, value: values };
    }
    return { ...base, found: false, error: "unknown_getter" };
  });
}

async function getPredicate(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{ kind: string; selector?: string; found: boolean; value: boolean }> {
  const kind = typeof params.kind === "string" ? params.kind : "";
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const frame = readFrameParam(params);
  return runFrameScript(tabId, frame, { kind, selector }, (ctx, opts) => {
    const predicate = opts.kind;
    const sel = opts.selector;
    const el = sel ? (ctx.query(sel) as HTMLElement | null) : null;
    const base = { kind: predicate, selector: sel, frame: ctx.frame, found: !!el };
    if (!el) return { ...base, value: false };
    const visible = (target: HTMLElement): boolean => {
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") !== 0
      );
    };
    if (predicate === "visible") return { ...base, value: visible(el) };
    if (predicate === "enabled") {
      const disabled =
        "disabled" in el && Boolean((el as HTMLButtonElement | HTMLInputElement).disabled);
      const ariaDisabled = el.getAttribute("aria-disabled") === "true";
      return { ...base, value: !disabled && !ariaDisabled };
    }
    if (predicate === "checked") {
      const value =
        el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true";
      return { ...base, value };
    }
    return { ...base, value: false };
  });
}

type ValidationIssue = {
  ruleId: string;
  severity: "error" | "warning";
  offset: number;
  line: number;
  column: number;
  context: string;
  message: string;
};

async function validateEditable(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const selection = params.selection === true;
  const rules = typeof params.rules === "string" ? params.rules : "html-attrs,shortcodes";
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: (sel: string | undefined, useSelection: boolean, ruleText: string) => {
      const readText = (): { found: boolean; source: string; text: string; html?: string } => {
        if (useSelection) {
          return {
            found: true,
            source: "selection",
            text: String(window.getSelection()?.toString() ?? ""),
          };
        }
        if (!sel) return { found: false, source: "selector", text: "" };
        const el = document.querySelector(sel) as
          | HTMLElement
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (!el) return { found: false, source: "selector", text: "" };
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          return { found: true, source: "value", text: el.value, html: el.outerHTML };
        }
        return {
          found: true,
          source:
            el.isContentEditable || el.getAttribute("role") === "textbox"
              ? "editableText"
              : "textContent",
          text: el.innerText || el.textContent || "",
          html: el.outerHTML,
        };
      };
      const locationOf = (text: string, offset: number) => {
        const prefix = text.slice(0, offset);
        const lines = prefix.split(/\n/);
        return { line: lines.length, column: (lines.at(-1) ?? "").length + 1 };
      };
      const contextOf = (text: string, offset: number): string =>
        text.slice(Math.max(0, offset - 40), Math.min(text.length, offset + 80));
      const scanQuotedAssignments = (text: string, ruleId: string) => {
        const issues: ValidationIssue[] = [];
        const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(['"])/g;
        let match = re.exec(text);
        while (match) {
          const quote = match[2] ?? "";
          const valueStart = re.lastIndex;
          let i = valueStart;
          let closed = false;
          while (i < text.length) {
            const ch = text[i];
            if (ch === "\\" && i + 1 < text.length) {
              i += 2;
              continue;
            }
            if (ch === quote) {
              closed = true;
              break;
            }
            if (ch === "\n" || ch === "]" || ch === ">") break;
            i += 1;
          }
          if (!closed) {
            const loc = locationOf(text, match.index);
            issues.push({
              ruleId,
              severity: "error",
              offset: match.index,
              line: loc.line,
              column: loc.column,
              context: contextOf(text, match.index),
              message: `Attribute ${match[1] ?? ""} starts with ${quote} but no matching quote was found before a boundary.`,
            });
          }
          match = re.exec(text);
        }
        return issues;
      };
      const source = readText();
      const enabledRules = new Set(
        ruleText
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      );
      const issues: ValidationIssue[] = [];
      if (enabledRules.has("html-attrs"))
        issues.push(
          ...scanQuotedAssignments(source.html ?? source.text, "html-attrs/unbalanced-quote"),
        );
      if (enabledRules.has("shortcodes"))
        issues.push(...scanQuotedAssignments(source.text, "shortcodes/unbalanced-quote"));
      return {
        ok: source.found && issues.every((issue) => issue.severity !== "error"),
        found: source.found,
        selector: sel,
        source: source.source,
        rules: Array.from(enabledRules),
        issueCount: issues.length,
        errorCount: issues.filter((issue) => issue.severity === "error").length,
        textLength: source.text.length,
        issues,
      };
    },
    args: [selector, selection, rules],
  });
  return res?.result ?? { ok: false, found: false, issues: [] };
}

type FindMatch = {
  index: number;
  selector: string;
  frame?: FrameDescriptor;
  tag: string;
  role: string;
  text: string;
  value?: string;
  box: { x: number; y: number; width: number; height: number };
};

async function runFindCommand(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  const locator = typeof params.locator === "string" ? params.locator : "";
  const query = typeof params.query === "string" ? params.query : "";
  const role = typeof params.role === "string" ? params.role : undefined;
  const indexModifier = typeof params.indexModifier === "string" ? params.indexModifier : undefined;
  const index = typeof params.index === "number" ? params.index : undefined;
  const action = typeof params.action === "string" ? params.action : "inspect";
  const exact = params.exact === true;
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(100, params.limit)) : 20;
  const frame = readFrameParam(params);
  const allMatches = await findSemanticMatches(tabId, {
    locator,
    query,
    role,
    exact,
    limit,
    frame,
  });
  const matches = applyFindIndexModifier(allMatches, indexModifier, index);
  if (action === "inspect") {
    return {
      locator,
      query,
      role,
      exact,
      frame,
      indexModifier,
      index,
      totalCount: allMatches.length,
      count: matches.length,
      matches,
    };
  }
  const first = matches[0];
  if (!first) return { ok: false, locator, query, role, action, count: 0, matches: [] };
  if (action === "text") {
    return { ok: true, locator, query, role, action, match: first, value: first.text };
  }

  await requireOperationApproval(
    "find" as OperationMethod,
    tabId,
    `Run find action ${quoteForIntent(action)} on ${quoteForIntent(first.selector)}${frameIntentSuffix(frame)}.`,
  );

  if (action === "click")
    return { action, match: first, result: await clickSelector(tabId, first.selector, frame) };
  if (action === "fill") {
    const value = typeof params.value === "string" ? params.value : "";
    return {
      action,
      match: first,
      result: await fillField(tabId, first.selector, value, false, frame),
    };
  }
  if (action === "type") {
    const value = typeof params.value === "string" ? params.value : "";
    await focusElement(tabId, first.selector, frame);
    return { action, match: first, result: await typeText(tabId, value) };
  }
  if (action === "hover")
    return { action, match: first, result: await hoverSelector(tabId, first.selector, frame) };
  if (action === "focus")
    return { action, match: first, result: await focusElement(tabId, first.selector, frame) };
  if (action === "check")
    return { action, match: first, result: await setChecked(tabId, first.selector, true, frame) };
  if (action === "uncheck")
    return { action, match: first, result: await setChecked(tabId, first.selector, false, frame) };
  return {
    ok: false,
    error: "unsupported_find_action",
    action,
    supportedActions: [
      "inspect",
      "text",
      "click",
      "fill",
      "type",
      "hover",
      "focus",
      "check",
      "uncheck",
    ],
  };
}

async function findSemanticMatches(
  tabId: number,
  params: {
    locator: string;
    query: string;
    role?: string;
    exact: boolean;
    limit: number;
    frame?: string;
  },
): Promise<FindMatch[]> {
  return runFrameScript(
    tabId,
    params.frame,
    params,
    (
      ctx,
      opts: {
        locator: string;
        query: string;
        role?: string;
        exact: boolean;
        limit: number;
      },
    ) => {
      type LocalMatch = {
        index: number;
        selector: string;
        frame?: FrameDescriptor;
        tag: string;
        role: string;
        text: string;
        value?: string;
        box: { x: number; y: number; width: number; height: number };
      };
      const cssEscape = (value: string): string => {
        const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
          .CSS?.escape;
        return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
      };
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const matchesText = (value: string): boolean => {
        const left = normalize(value);
        const right = normalize(opts.query);
        return opts.exact ? left === right : left.toLowerCase().includes(right.toLowerCase());
      };
      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit.toLowerCase();
        const tag = el.tagName.toLowerCase();
        if (tag === "a" && (el as HTMLAnchorElement).href) return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "img") return "img";
        if (tag === "input") {
          const type = ((el as HTMLInputElement).type || "text").toLowerCase();
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "submit" || type === "button") return "button";
          return "textbox";
        }
        return "generic";
      };
      const textOf = (el: Element): string => {
        const input = el as HTMLInputElement;
        return normalize(
          el.getAttribute("aria-label") ||
            el.getAttribute("alt") ||
            el.getAttribute("title") ||
            input.placeholder ||
            input.value ||
            (el as HTMLElement).innerText ||
            el.textContent,
        );
      };
      const selectorFor = (el: Element): string => {
        if (el.id && ctx.queryAll(`#${cssEscape(el.id)}`).length === 1) {
          return `#${cssEscape(el.id)}`;
        }
        for (const attr of [
          "data-testid",
          "data-test",
          "name",
          "aria-label",
          "placeholder",
          "title",
          "alt",
        ]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `${el.tagName.toLowerCase()}[${attr}="${cssEscape(value)}"]`;
            if (ctx.queryAll(selector).length === 1) return selector;
          }
        }
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && parts.length < 5) {
          const parent: Element | null = current.parentElement;
          const tag = current.tagName.toLowerCase();
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current?.tagName,
          );
          const nth = siblings.indexOf(current) + 1;
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
          current = parent;
        }
        return parts.join(" > ");
      };
      const boxOf = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(ctx.offsetX + rect.left),
          y: Math.round(ctx.offsetY + rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const pushMatch = (matches: LocalMatch[], el: Element): void => {
        if (matches.some((match) => ctx.query(match.selector) === el)) return;
        matches.push({
          index: matches.length,
          selector: selectorFor(el),
          frame: ctx.frame,
          tag: el.tagName.toLowerCase(),
          role: roleOf(el),
          text: textOf(el),
          value: (el as HTMLInputElement).value,
          box: boxOf(el),
        });
      };

      const matches: LocalMatch[] = [];
      if (opts.locator === "css") {
        for (const el of ctx.queryAll(opts.query)) {
          pushMatch(matches, el);
          if (matches.length >= opts.limit) break;
        }
        return matches;
      }
      if (opts.locator === "label") {
        for (const label of ctx.queryAll("label") as HTMLLabelElement[]) {
          if (!matchesText(label.textContent ?? "")) continue;
          const control =
            label.control ??
            label.querySelector("input, textarea, select, [contenteditable='true']");
          if (control) pushMatch(matches, control);
          if (matches.length >= opts.limit) break;
        }
        return matches;
      }

      const candidates = Array.from(
        ctx.queryAll(
          [
            "a[href]",
            "button",
            "input",
            "textarea",
            "select",
            "img",
            "[role]",
            "[aria-label]",
            "[placeholder]",
            "[title]",
            "[data-testid]",
            "[data-test]",
            "[contenteditable='true']",
          ].join(","),
        ),
      );
      for (const el of candidates) {
        if (opts.locator === "role") {
          if (opts.role && roleOf(el) !== opts.role.toLowerCase()) continue;
          if (opts.query && !matchesText(textOf(el))) continue;
        } else if (opts.locator === "text") {
          if (!matchesText(textOf(el))) continue;
        } else if (opts.locator === "placeholder") {
          if (!matchesText(el.getAttribute("placeholder") ?? "")) continue;
        } else if (opts.locator === "alt") {
          if (!matchesText(el.getAttribute("alt") ?? "")) continue;
        } else if (opts.locator === "title") {
          if (!matchesText(el.getAttribute("title") ?? "")) continue;
        } else if (opts.locator === "testid") {
          if (!matchesText(el.getAttribute("data-testid") ?? el.getAttribute("data-test") ?? ""))
            continue;
        } else {
          continue;
        }
        pushMatch(matches, el);
        if (matches.length >= opts.limit) break;
      }
      return matches;
    },
  );
}

function applyFindIndexModifier(
  matches: FindMatch[],
  modifier: string | undefined,
  index: number | undefined,
): FindMatch[] {
  if (modifier === "first") return matches.slice(0, 1);
  if (modifier === "last")
    return matches.length > 0 ? [matches[matches.length - 1] as FindMatch] : [];
  if (modifier === "nth") {
    const resolvedIndex = index ?? 0;
    return matches[resolvedIndex] ? [matches[resolvedIndex] as FindMatch] : [];
  }
  return matches;
}

async function snapshotTab(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const frame = readFrameParam(params);
  const depth = typeof params.depth === "number" ? Math.max(1, Math.min(12, params.depth)) : 5;
  const interactiveOnly = params.interactiveOnly === true;
  const compact = params.compact === true;
  const result = await runFrameScript(
    tabId,
    frame,
    { selector, depth, interactiveOnly, compact },
    (
      ctx,
      opts: {
        selector?: string;
        depth: number;
        interactiveOnly: boolean;
        compact: boolean;
      },
    ) => {
      type SnapshotElement = {
        ref: string;
        role: string;
        name: string;
        text: string;
        selector: string;
        frame?: FrameDescriptor;
        box: { x: number; y: number; width: number; height: number };
        interactive: boolean;
      };
      const cssEscape = (value: string): string => {
        const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
          .CSS?.escape;
        return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
      };
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit.toLowerCase();
        const tag = el.tagName.toLowerCase();
        if (tag === "a" && (el as HTMLAnchorElement).href) return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "img") return "img";
        if (tag === "input") {
          const type = ((el as HTMLInputElement).type || "text").toLowerCase();
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "submit" || type === "button") return "button";
          return "textbox";
        }
        return "generic";
      };
      const selectorFor = (el: Element): string => {
        if (el.id && ctx.queryAll(`#${cssEscape(el.id)}`).length === 1) {
          return `#${cssEscape(el.id)}`;
        }
        for (const attr of [
          "data-testid",
          "data-test",
          "name",
          "aria-label",
          "placeholder",
          "title",
          "alt",
        ]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `${el.tagName.toLowerCase()}[${attr}="${cssEscape(value)}"]`;
            if (ctx.queryAll(selector).length === 1) return selector;
          }
        }
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && parts.length < opts.depth) {
          const parent: Element | null = current.parentElement;
          const tag = current.tagName.toLowerCase();
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current?.tagName,
          );
          const nth = siblings.indexOf(current) + 1;
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
          current = parent;
        }
        return parts.join(" > ");
      };
      const nameOf = (el: Element): string => {
        const input = el as HTMLInputElement;
        return normalize(
          el.getAttribute("aria-label") ||
            el.getAttribute("alt") ||
            el.getAttribute("title") ||
            input.placeholder ||
            input.value ||
            (el as HTMLElement).innerText ||
            el.textContent,
        );
      };
      const isInteractive = (el: Element): boolean => {
        const role = roleOf(el);
        return (
          ["button", "link", "textbox", "checkbox", "radio", "combobox"].includes(role) ||
          el.hasAttribute("onclick") ||
          el.hasAttribute("tabindex") ||
          (el as HTMLElement).isContentEditable
        );
      };
      const boxOf = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(ctx.offsetX + rect.left),
          y: Math.round(ctx.offsetY + rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const root = opts.selector ? ctx.query(opts.selector) : ctx.doc.body;
      if (!root) {
        return {
          url: ctx.win.location.href,
          title: ctx.doc.title,
          selector: opts.selector,
          frame: ctx.frame,
          found: false,
          elements: [],
        };
      }
      const query = [
        "a[href]",
        "button",
        "input",
        "textarea",
        "select",
        "img",
        "[role]",
        "[aria-label]",
        "[title]",
        "[data-testid]",
        "[data-test]",
        "[contenteditable='true']",
      ].join(",");
      const elements: SnapshotElement[] = [];
      const candidates = ctx.queryAll(query, root as ParentNode);
      if (root instanceof Element && root.matches(query)) candidates.unshift(root);
      for (const el of candidates) {
        const interactive = isInteractive(el);
        if (opts.interactiveOnly && !interactive) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        elements.push({
          ref: `@e${elements.length + 1}`,
          role: roleOf(el),
          name: nameOf(el),
          text: normalize((el as HTMLElement).innerText || el.textContent),
          selector: selectorFor(el),
          frame: ctx.frame,
          box: boxOf(el),
          interactive,
        });
        if (elements.length >= 250) break;
      }
      return {
        url: ctx.win.location.href,
        title: ctx.doc.title,
        selector: opts.selector,
        frame: ctx.frame,
        found: true,
        generatedAt: new Date().toISOString(),
        elements: opts.compact
          ? elements.map(
              ({ selector: _selector, interactive: _interactive, ...element }) => element,
            )
          : elements,
        refMap: Object.fromEntries(elements.map((element) => [element.ref, element.selector])),
      };
    },
  );
  const typedResult = result as
    | { refMap?: Record<string, string>; frame?: FrameDescriptor; elements?: unknown[] }
    | undefined;
  const refMap = new Map<string, SnapshotRefTarget>();
  for (const [ref, resolvedSelector] of Object.entries(typedResult?.refMap ?? {})) {
    refMap.set(ref, { selector: resolvedSelector, frame });
  }
  snapshotRefCache.set(tabId, refMap);
  if (typedResult && "refMap" in typedResult) {
    delete typedResult.refMap;
  }
  return typedResult ?? { found: false, elements: [] };
}

async function clickSnapshotRef(tabId: number, ref: string): Promise<unknown> {
  const target = snapshotRefCache.get(tabId)?.get(ref);
  if (!target) {
    throw new GatewayError("snapshot_ref_not_found", `snapshot ref not found or stale: ${ref}`);
  }
  return clickSelector(tabId, target.selector, target.frame);
}

type ScreenshotResult = {
  dataUrl: string;
  cssViewport?: { width: number; height: number };
  imageSize?: { width: number; height: number };
  scale?: number;
};

async function screenshot(
  tabId: number,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<ScreenshotResult> {
  if (!browser.supportsDebugger) {
    return screenshotWithVisibleTabCapture(tabId, clip);
  }

  await attachDebugger(tabId);
  // Full captures previously omitted the clip, so Chrome picked the scale from
  // the device pixel ratio and consecutive captures of the same viewport could
  // come back at different sizes. Deriving an explicit CSS-pixel clip with
  // scale 1 makes image pixels equal CSS pixels on every capture, so
  // screenshot-derived coordinates feed straight into click --x/--y.
  const layout = (await browser.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics")) as {
    cssVisualViewport?: {
      clientWidth: number;
      clientHeight: number;
      pageX: number;
      pageY: number;
    };
  };
  const viewport = layout.cssVisualViewport;
  const effectiveClip =
    clip ??
    (viewport
      ? {
          x: viewport.pageX,
          y: viewport.pageY,
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        }
      : undefined);
  const params: Record<string, unknown> = { format: "png" };
  if (effectiveClip) {
    params.clip = { ...effectiveClip, scale: 1 };
  }
  const result = (await browser.debugger.sendCommand(
    { tabId },
    "Page.captureScreenshot",
    params,
  )) as {
    data: string;
  };
  const output: ScreenshotResult = { dataUrl: `data:image/png;base64,${result.data}` };
  if (viewport) {
    output.cssViewport = { width: viewport.clientWidth, height: viewport.clientHeight };
  }
  if (effectiveClip) {
    output.imageSize = {
      width: Math.round(effectiveClip.width),
      height: Math.round(effectiveClip.height),
    };
    output.scale = 1;
  }
  return output;
}

async function screenshotWithVisibleTabCapture(
  tabId: number,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<{ dataUrl: string }> {
  if (clip) {
    throw new GatewayError(
      "unsupported_on_firefox_mvp",
      "Firefox screenshot MVP does not support clip.",
    );
  }
  if (!browser.supportsVisibleTabCapture) {
    throw new GatewayError(
      "unsupported_on_firefox_mvp",
      "This browser target does not support screenshot capture.",
    );
  }

  const tab = await browser.tabs.get(tabId);
  const windowId = tab.windowId;
  const activeTabs =
    typeof windowId === "number"
      ? await browser.tabs.query({ active: true, windowId })
      : ([] as BrowserTab[]);
  const previousActive = activeTabs.find((item) => typeof item.id === "number");
  const shouldRestore =
    previousActive?.id !== undefined && previousActive.id !== tabId && typeof windowId === "number";

  if (typeof windowId === "number" && tab.active !== true) {
    await browser.tabs.update(tabId, { active: true });
  }

  try {
    const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
    return { dataUrl };
  } finally {
    if (shouldRestore && previousActive.id !== undefined) {
      await browser.tabs.update(previousActive.id, { active: true }).catch(() => undefined);
    }
  }
}

async function printPagePDF(
  tabId: number,
): Promise<{ dataUrl: string; url: string; title: string }> {
  await attachDebugger(tabId);
  const tab = await browser.tabs.get(tabId);
  const result = (await browser.debugger.sendCommand({ tabId }, "Page.printToPDF", {
    printBackground: true,
  })) as { data: string };
  return {
    dataUrl: `data:application/pdf;base64,${result.data}`,
    url: tab.url ?? "",
    title: tab.title ?? "",
  };
}

async function setRuntimeStream(
  tabId: number,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean; tabId: number }> {
  if (enabled) {
    streamingTabs.add(tabId);
    await attachDebugger(tabId);
    await installDomMutationStream(tabId);
  } else {
    streamingTabs.delete(tabId);
  }
  return { ok: true, enabled, tabId };
}

async function installDomMutationStream(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const key = "__abgRuntimeStreamInstalled";
      const win = window as unknown as Record<string, unknown>;
      if (win[key]) return;
      win[key] = true;
      let pending = 0;
      const observer = new MutationObserver((mutations) => {
        pending += mutations.length;
        if (pending === mutations.length) {
          setTimeout(() => {
            const count = pending;
            pending = 0;
            browser.runtime.sendMessage({
              type: "stream_dom_mutation",
              count,
              url: location.href,
              title: document.title,
            });
          }, 100);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        attributes: true,
        characterData: true,
        subtree: true,
      });
    },
  });
}

async function extractTables(
  tabId: number,
  selector: string | undefined,
  frame?: string,
): Promise<{
  url: string;
  title: string;
  frame?: FrameDescriptor;
  selector?: string;
  tables: {
    index: number;
    selector: string;
    caption?: string;
    headers: string[];
    rows: string[][];
    rowCount: number;
    columnCount: number;
  }[];
  userMessage?: string;
  nextCommand?: string;
}> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const sel = opts.selector;
    const textOf = (el: Element | null): string =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const cssEscape = (value: string): string => {
      const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
        .CSS?.escape;
      return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
    };
    const selectorFor = (el: Element): string => {
      if (el.id) return `#${cssEscape(el.id)}`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        const parent: Element | null = current.parentElement;
        const currentTag = current.tagName;
        const tag = currentTag.toLowerCase();
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const siblings = Array.from(parent.children).filter(
          (child): child is Element => child instanceof Element && child.tagName === currentTag,
        );
        const nth = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
        current = parent;
      }
      return parts.join(" > ");
    };
    const root = (sel ? ctx.query(sel) : ctx.doc) as Document | Element | null;
    const tableElements: HTMLTableElement[] =
      root instanceof HTMLTableElement
        ? [root]
        : Array.from((root ?? ctx.doc).querySelectorAll("table"));
    const chosen = tableElements
      .map((table, index) => ({ table, index, score: table.querySelectorAll("tr").length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, sel ? 20 : 5);
    const tables = chosen.map(({ table, index }) => {
      const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.children)
          .filter((cell) => cell instanceof HTMLTableCellElement)
          .map((cell) => textOf(cell)),
      );
      const explicitHeaders = Array.from(table.querySelectorAll("thead th")).map((th) =>
        textOf(th),
      );
      const firstHeaderRow = Array.from(table.querySelectorAll("tr")).find((tr) =>
        tr.querySelector("th"),
      );
      const headers =
        explicitHeaders.length > 0
          ? explicitHeaders
          : firstHeaderRow
            ? Array.from(firstHeaderRow.children)
                .filter((cell) => cell instanceof HTMLTableCellElement)
                .map((cell) => textOf(cell))
            : [];
      const dataRows =
        headers.length > 0 && rows.length > 0 && rows[0]?.join("\u0000") === headers.join("\u0000")
          ? rows.slice(1)
          : rows;
      return {
        index,
        selector: selectorFor(table),
        caption: textOf(table.querySelector("caption")) || undefined,
        headers,
        rows: dataRows,
        rowCount: dataRows.length,
        columnCount: Math.max(headers.length, ...dataRows.map((row) => row.length), 0),
      };
    });
    return {
      url: ctx.win.location.href,
      title: ctx.doc.title,
      frame: ctx.frame,
      selector: sel,
      tables,
      userMessage:
        tables.length === 0
          ? "table が見つかりませんでした。`abg read --selector` または `abg screenshot` で画面構造を確認してください。"
          : undefined,
      nextCommand:
        tables.length === 0 ? 'abg read <tab> --selector "main" --format markdown' : undefined,
    };
  });
}

async function describeElements(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{
  url: string;
  title: string;
  frame?: FrameDescriptor;
  viewport: { width: number; height: number };
  elements: unknown[];
}> {
  const all = params.all === true;
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(500, params.limit)) : 80;
  const kindFilter = typeof params.kind === "string" ? params.kind.toLowerCase() : undefined;
  const grid = typeof params.grid === "string" ? params.grid : undefined;
  const frame = readFrameParam(params);
  return runFrameScript(
    tabId,
    frame,
    { all, limit, kindFilter, grid },
    (ctx, opts: { all: boolean; limit: number; kindFilter?: string; grid?: string }) => {
      const cssEscape = (value: string): string => {
        const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
          .CSS?.escape;
        return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
      };
      const trimText = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 160);
      const selectorFor = (el: Element): string => {
        if (el.id && ctx.queryAll(`#${cssEscape(el.id)}`).length === 1) {
          return `#${cssEscape(el.id)}`;
        }
        for (const attr of ["data-testid", "data-test", "name", "aria-label"]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `${el.tagName.toLowerCase()}[${attr}="${cssEscape(value)}"]`;
            if (ctx.queryAll(selector).length === 1) return selector;
          }
        }
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
          const parent: Element | null = current.parentElement;
          const currentTag = current.tagName;
          const tag = currentTag.toLowerCase();
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = Array.from(parent.children).filter(
            (child): child is Element => child instanceof Element && child.tagName === currentTag,
          );
          const nth = siblings.indexOf(current) + 1;
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
          current = parent;
        }
        return parts.join(" > ");
      };
      const kindOf = (el: Element): string => {
        const role = el.getAttribute("role")?.toLowerCase();
        const tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button" || role === "button") return "button";
        if (tag === "input") return (el as HTMLInputElement).type || "input";
        if (tag === "textarea" || tag === "select") return tag;
        if (role === "link") return "link";
        return "clickable";
      };
      const isVisible = (el: Element, rect: DOMRect): boolean => {
        const style = getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") !== 0
        );
      };
      const inViewport = (rect: DOMRect): boolean =>
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= ctx.win.innerHeight &&
        rect.left <= ctx.win.innerWidth;
      const candidates = Array.from(
        ctx.queryAll(
          [
            "a[href]",
            "button",
            "input",
            "textarea",
            "select",
            "summary",
            "[role='button']",
            "[role='link']",
            "[onclick]",
            "[tabindex]:not([tabindex='-1'])",
            "[contenteditable='true']",
          ].join(","),
        ),
      );
      const elements: Record<string, unknown>[] = [];
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const kind = kindOf(el);
        if (opts.kindFilter && kind !== opts.kindFilter) continue;
        if (!isVisible(el, rect) || (!opts.all && !inViewport(rect))) continue;
        const html = el as HTMLElement;
        const text = trimText(
          el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (html.innerText ?? "") ||
            (el as HTMLInputElement).value ||
            (el as HTMLInputElement).placeholder ||
            "",
        );
        elements.push({
          id: elements.length,
          kind,
          text,
          bbox: {
            x: Math.round(ctx.offsetX + rect.left),
            y: Math.round(ctx.offsetY + rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          selector: selectorFor(el),
          frame: ctx.frame,
        });
        if (elements.length >= opts.limit) break;
      }
      const match = opts.grid?.match(/^(\d+)x(\d+)$/i);
      if (match) {
        const cols = Math.max(1, Math.min(50, Number(match[1])));
        const rows = Math.max(1, Math.min(50, Number(match[2])));
        const cellW = ctx.win.innerWidth / cols;
        const cellH = ctx.win.innerHeight / rows;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            elements.push({
              id: elements.length,
              kind: "grid-cell",
              text: `r${row + 1}c${col + 1}`,
              bbox: {
                x: Math.round(ctx.offsetX + col * cellW),
                y: Math.round(ctx.offsetY + row * cellH),
                w: Math.round(cellW),
                h: Math.round(cellH),
              },
              frame: ctx.frame,
            });
          }
        }
      }
      return {
        url: ctx.win.location.href,
        title: ctx.doc.title,
        frame: ctx.frame,
        viewport: { width: ctx.win.innerWidth, height: ctx.win.innerHeight },
        elements,
      };
    },
  );
}

async function getNetworkLog(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  await attachDebugger(tabId);
  if (params.wait === true) {
    return waitForNetworkResponse(tabId, params);
  }
  if (params.body === true && typeof params.requestId === "string") {
    return {
      requestId: params.requestId,
      body: await getResponseBodyPreview(tabId, params.requestId, readNetworkBodyMaxBytes(params)),
    };
  }
  const filters = readNetworkFilters(params);
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(200, params.limit)) : 100;
  const items = (networkBuffers.get(tabId) ?? [])
    .filter((entry) => networkEntryMatches(entry, filters))
    .slice(-limit)
    .map(publicNetworkEntry);
  return { requests: items };
}

async function exportHAR(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  await attachDebugger(tabId);
  const filters = readNetworkFilters(params);
  const limit = readHARLimit(params);
  const buffered = networkBuffers.get(tabId) ?? [];
  const entries = buffered.filter((entry) => networkEntryMatches(entry, filters)).slice(-limit);
  const tab = permittedTabs.get(tabId);
  const generatedAt = new Date().toISOString();
  const pageId = `abg-tab-${tabId}`;
  const redaction = {
    mode: "metadata_only",
    cookies: "omitted",
    authorizationHeaders: "omitted",
    requestHeaders: "omitted",
    requestBodies: "omitted",
    responseBodies: "omitted",
    responseHeaders: "content-type only when available",
  };
  const har = {
    log: {
      version: "1.2",
      creator: {
        name: "Agent Browser Gateway",
        version: VERSION,
        comment: "ABG exports a metadata-only HAR by default.",
      },
      pages: [
        {
          startedDateTime: tab ? new Date(tab.permittedAt).toISOString() : generatedAt,
          id: pageId,
          title: tab?.title ?? "",
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
          comment: "Shared tab HAR snapshot generated locally by ABG.",
        },
      ],
      entries: entries.map((entry) => networkEntryToHAR(entry, pageId)),
      _abg: {
        generatedAt,
        tabId,
        sourceUrl: tab?.url ?? "",
        sourceTitle: tab?.title ?? "",
        exportMode: "one_shot",
        entryLimit: limit,
        totalBuffered: buffered.length,
        includedEntries: entries.length,
        filters: publicNetworkFilters(filters),
        redaction,
        payloadPolicy: "Request and response bodies are never embedded in this export.",
        storage:
          "Caller-chosen local path or ABG temporary directory; no ABG-operated cloud service.",
      },
    },
  };
  return {
    ok: true,
    mode: "one_shot",
    har,
    entryCount: entries.length,
    totalBuffered: buffered.length,
    limit,
    redaction: "metadata_only",
    filters: publicNetworkFilters(filters),
    outputPath: params.outputPath,
    byteSizeEstimate: new TextEncoder().encode(JSON.stringify(har)).byteLength,
    generatedAt,
  };
}

async function inspectState(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  await attachDebugger(tabId);
  const kind = normalizeStateKind(params.kind);
  const includeValues = params.includeValues === true;
  const limit = readStateLimit(params);
  const tab = permittedTabs.get(tabId);
  const result: Record<string, unknown> = {
    tabId,
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    origin: tab?.origin ?? "",
    kind,
    includeValues,
    redaction: includeValues ? "explicit_values" : "values_redacted",
    writeOperations: "not_supported",
  };
  if (kind === "cookies" || kind === "all") {
    result.cookies = await inspectCookies(tabId, tab?.url, params, includeValues, limit);
  }
  if (kind === "local-storage" || kind === "session-storage" || kind === "all") {
    const storage = await inspectWebStorage(tabId, params, includeValues, limit);
    if (kind === "local-storage" || kind === "all") {
      result.localStorage = storage.localStorage;
    }
    if (kind === "session-storage" || kind === "all") {
      result.sessionStorage = storage.sessionStorage;
    }
  }
  return result;
}

function normalizeStateKind(
  value: unknown,
): "cookies" | "local-storage" | "session-storage" | "all" {
  if (value === "cookie") return "cookies";
  if (value === "localStorage" || value === "local-storage") return "local-storage";
  if (value === "sessionStorage" || value === "session-storage") return "session-storage";
  if (value === "all" || value === undefined || value === null || value === "") return "all";
  throw new GatewayError(
    "bad_state_kind",
    "state kind must be cookies, local-storage, session-storage, or all",
  );
}

function readStateLimit(params: NonNullable<GatewayCommand["params"]>): number {
  return typeof params.limit === "number" ? Math.max(1, Math.min(500, params.limit)) : 200;
}

async function inspectCookies(
  tabId: number,
  rawUrl: string | undefined,
  params: NonNullable<GatewayCommand["params"]>,
  includeValues: boolean,
  limit: number,
): Promise<Record<string, unknown>> {
  if (!rawUrl) return { available: false, error: "tab URL unavailable", count: 0, cookies: [] };
  const namePattern = typeof params.name === "string" ? params.name : undefined;
  try {
    const result = (await browser.debugger.sendCommand({ tabId }, "Network.getCookies", {
      urls: [rawUrl],
    })) as {
      cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        size?: number;
        httpOnly?: boolean;
        secure?: boolean;
        session?: boolean;
        sameSite?: string;
        priority?: string;
      }>;
    };
    const matched = (result.cookies ?? []).filter(
      (cookie) => !namePattern || globMatch(namePattern, cookie.name),
    );
    const filtered = matched.slice(0, limit);
    return {
      available: true,
      count: filtered.length,
      totalMatches: matched.length,
      limited: matched.length > filtered.length,
      filter: namePattern,
      cookies: filtered.map((cookie) => publicCookie(cookie, includeValues)),
    };
  } catch (error) {
    return {
      available: false,
      count: 0,
      cookies: [],
      filter: namePattern,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function publicCookie(
  cookie: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    size?: number;
    httpOnly?: boolean;
    secure?: boolean;
    session?: boolean;
    sameSite?: string;
    priority?: string;
  },
  includeValues: boolean,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    size: cookie.size,
    valueBytes: new TextEncoder().encode(cookie.value).byteLength,
    valueRedacted: !includeValues,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: cookie.session,
    sameSite: cookie.sameSite,
    priority: cookie.priority,
  };
  if (includeValues) item.value = cookie.value;
  return item;
}

async function inspectWebStorage(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
  includeValues: boolean,
  limit: number,
): Promise<{
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
}> {
  const keyPattern = typeof params.storageKey === "string" ? params.storageKey : undefined;
  return runFrameScript(
    tabId,
    undefined,
    { includeValues, limit, keyPattern },
    (
      ctx,
      opts: { includeValues: boolean; limit: number; keyPattern?: string },
    ): { localStorage: Record<string, unknown>; sessionStorage: Record<string, unknown> } => {
      const matches = (pattern: string | undefined, value: string): boolean => {
        if (!pattern) return true;
        const escaped = pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".");
        return new RegExp(`^${escaped}$`, "i").test(value);
      };
      const read = (
        label: "localStorage" | "sessionStorage",
        storage: Storage,
      ): Record<string, unknown> => {
        try {
          const entries: Record<string, unknown>[] = [];
          const total = storage.length;
          let totalMatches = 0;
          for (let index = 0; index < total; index++) {
            const key = storage.key(index);
            if (!key || !matches(opts.keyPattern, key)) continue;
            totalMatches += 1;
            if (entries.length >= opts.limit) continue;
            const value = storage.getItem(key) ?? "";
            const item: Record<string, unknown> = {
              key,
              valueBytes: new TextEncoder().encode(value).byteLength,
              valueRedacted: !opts.includeValues,
            };
            if (opts.includeValues) item.value = value;
            entries.push(item);
          }
          return {
            available: true,
            origin: ctx.win.location.origin,
            count: entries.length,
            totalKeys: total,
            totalMatches,
            limited: totalMatches > entries.length,
            filter: opts.keyPattern,
            entries,
          };
        } catch (error) {
          return {
            available: false,
            count: 0,
            entries: [],
            error: error instanceof Error ? error.message : String(error),
            kind: label,
          };
        }
      };
      return {
        localStorage: read("localStorage", ctx.win.localStorage),
        sessionStorage: read("sessionStorage", ctx.win.sessionStorage),
      };
    },
  );
}

async function inspectFramework(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  const kind = normalizeFrameworkKind(params.kind);
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(500, params.limit)) : 80;
  const depth = typeof params.depth === "number" ? Math.max(1, Math.min(10, params.depth)) : 4;
  return runFrameScript(
    tabId,
    undefined,
    { kind, limit, depth },
    (
      ctx,
      opts: { kind: "react" | "web-vitals" | "spa" | "all"; limit: number; depth: number },
    ): Record<string, unknown> => {
      const win = ctx.win as Window & {
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
          renderers?:
            | Map<number, Record<string, unknown>>
            | Record<string, Record<string, unknown>>;
          getFiberRoots?: (rendererId: number) => Set<Record<string, unknown>>;
        };
        navigation?: {
          currentEntry?: Record<string, unknown>;
          entries?: () => Record<string, unknown>[];
        };
      };
      const toNumber = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
      const jsonish = (value: unknown): Record<string, unknown> => {
        if (!value || typeof value !== "object") return {};
        const dict = value as Record<string, unknown>;
        return {
          name: typeof dict.name === "string" ? dict.name : undefined,
          entryType: typeof dict.entryType === "string" ? dict.entryType : undefined,
          startTime: toNumber(dict.startTime),
          duration: toNumber(dict.duration),
          url: typeof dict.url === "string" ? dict.url : undefined,
          key: typeof dict.key === "string" ? dict.key : undefined,
          id: typeof dict.id === "string" ? dict.id : undefined,
          index: toNumber(dict.index),
          sameDocument: typeof dict.sameDocument === "boolean" ? dict.sameDocument : undefined,
        };
      };
      const detectReactMarkers = (): Record<string, unknown> => {
        let fiberMarkers = 0;
        let propsMarkers = 0;
        const elements = ctx.queryAll("*").slice(0, 5000);
        for (const element of elements) {
          const names = Object.getOwnPropertyNames(element);
          if (names.some((name) => name.startsWith("__reactFiber$"))) fiberMarkers += 1;
          if (names.some((name) => name.startsWith("__reactProps$"))) propsMarkers += 1;
          if (fiberMarkers + propsMarkers >= opts.limit) break;
        }
        return { inspectedElements: elements.length, fiberMarkers, propsMarkers };
      };
      const typeName = (type: unknown): string => {
        if (typeof type === "string") return type;
        if (typeof type === "function") {
          const fn = type as { displayName?: string; name?: string };
          return fn.displayName || fn.name || "Anonymous";
        }
        if (type && typeof type === "object") {
          const dict = type as Record<string, unknown>;
          if (typeof dict.displayName === "string") return dict.displayName;
          const nested = dict.type as { displayName?: string; name?: string } | undefined;
          if (nested?.displayName || nested?.name)
            return nested.displayName || nested.name || "Anonymous";
          const render = dict.render as { displayName?: string; name?: string } | undefined;
          if (render?.displayName || render?.name)
            return render.displayName || render.name || "Anonymous";
        }
        return "Unknown";
      };
      const reactRendererEntries = (): Array<[number, Record<string, unknown>]> => {
        const renderers = win.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers;
        if (!renderers) return [];
        if (renderers instanceof Map) return Array.from(renderers.entries());
        return Object.entries(renderers).map(([key, value]) => [Number(key), value]);
      };
      const inspectReact = (): Record<string, unknown> => {
        const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        const markerSummary = detectReactMarkers();
        if (!hook || typeof hook.getFiberRoots !== "function") {
          return {
            available: false,
            reason: "React DevTools global hook with getFiberRoots is not available",
            markerSummary,
            mutationPolicy: "read-only; no component mutation or framework patching",
          };
        }
        const renderers = reactRendererEntries();
        const roots: Record<string, unknown>[] = [];
        let nodeCount = 0;
        const seen = new Set<object>();
        const fiberName = (fiber: Record<string, unknown>): string =>
          typeName(fiber.elementType ?? fiber.type);
        const fiberKind = (fiber: Record<string, unknown>): string =>
          typeof fiber.type === "string" ? "host" : "component";
        const propNames = (fiber: Record<string, unknown>): string[] => {
          const props = fiber.memoizedProps;
          if (!props || typeof props !== "object") return [];
          return Object.keys(props as Record<string, unknown>)
            .filter((name) => name !== "children")
            .slice(0, 20);
        };
        const walk = (
          fiber: Record<string, unknown> | undefined,
          currentDepth: number,
          nodes: Record<string, unknown>[],
          parentId?: number,
        ): void => {
          if (!fiber || nodeCount >= opts.limit || currentDepth > opts.depth) return;
          if (seen.has(fiber)) return;
          seen.add(fiber);
          const id = nodes.length;
          nodeCount += 1;
          nodes.push({
            id,
            parentId,
            depth: currentDepth,
            name: fiberName(fiber),
            kind: fiberKind(fiber),
            propNames: propNames(fiber),
          });
          walk(fiber.child as Record<string, unknown> | undefined, currentDepth + 1, nodes, id);
          walk(fiber.sibling as Record<string, unknown> | undefined, currentDepth, nodes, parentId);
        };
        for (const [rendererId, renderer] of renderers) {
          if (roots.length >= 10 || nodeCount >= opts.limit) break;
          const fiberRoots = Array.from(hook.getFiberRoots(rendererId) ?? []).slice(0, 10);
          for (const root of fiberRoots) {
            const current = (root.current ?? root) as Record<string, unknown>;
            const nodes: Record<string, unknown>[] = [];
            walk(current, 0, nodes);
            roots.push({
              rendererId,
              rendererPackageName: renderer.rendererPackageName,
              version: renderer.version,
              nodeCount: nodes.length,
              depthLimit: opts.depth,
              nodes,
            });
            if (nodeCount >= opts.limit) break;
          }
        }
        return {
          available: true,
          rendererCount: renderers.length,
          rootCount: roots.length,
          nodeLimit: opts.limit,
          markerSummary,
          roots,
          mutationPolicy: "read-only; props are represented by names only",
        };
      };
      const inspectWebVitals = (): Record<string, unknown> => {
        const perf = ctx.win.performance;
        const observerCtor = (
          ctx.win as unknown as {
            PerformanceObserver?: { supportedEntryTypes?: string[] };
          }
        ).PerformanceObserver;
        const supported =
          (observerCtor as unknown as { supportedEntryTypes?: string[] } | undefined)
            ?.supportedEntryTypes ?? [];
        const entries = (type: string): Record<string, unknown>[] => {
          try {
            return perf
              .getEntriesByType(type)
              .slice(-opts.limit)
              .map((entry) => jsonish(entry));
          } catch {
            return [];
          }
        };
        const layoutShiftEntries = (() => {
          try {
            return perf.getEntriesByType("layout-shift") as unknown as Array<
              Record<string, unknown>
            >;
          } catch {
            return [];
          }
        })();
        const cls = layoutShiftEntries
          .filter((entry) => entry.hadRecentInput !== true)
          .reduce((sum, entry) => sum + (typeof entry.value === "number" ? entry.value : 0), 0);
        const eventEntries = (() => {
          try {
            return perf.getEntriesByType("event") as unknown as Array<Record<string, unknown>>;
          } catch {
            return [];
          }
        })();
        const inpCandidate = eventEntries.reduce<Record<string, unknown> | undefined>(
          (best, entry) =>
            !best || (toNumber(entry.duration) ?? 0) > (toNumber(best.duration) ?? 0)
              ? entry
              : best,
          undefined,
        );
        return {
          available: true,
          supportedEntryTypes: supported,
          navigation: entries("navigation"),
          paint: entries("paint"),
          largestContentfulPaint: entries("largest-contentful-paint").at(-1),
          cumulativeLayoutShift: Number(cls.toFixed(4)),
          interactionToNextPaintCandidate: inpCandidate ? jsonish(inpCandidate) : undefined,
          metricPolicy:
            "Snapshot only; no third-party analytics or ABG-operated telemetry endpoint.",
        };
      };
      const inspectSpa = (): Record<string, unknown> => {
        const nav = win.navigation;
        const entries =
          typeof nav?.entries === "function" ? nav.entries().slice(-opts.limit).map(jsonish) : [];
        return {
          url: ctx.win.location.href,
          referrer: ctx.doc.referrer,
          historyLength: ctx.win.history.length,
          navigationApiAvailable: !!nav,
          currentEntry: nav?.currentEntry ? jsonish(nav.currentEntry) : undefined,
          entries,
          pushStateEvents:
            entries.length > 0
              ? "Reported through the browser Navigation API"
              : "No Navigation API entries available without pre-page-load instrumentation",
        };
      };
      return {
        url: ctx.win.location.href,
        title: ctx.doc.title,
        kind: opts.kind,
        constraints: [
          "Uses browser-exposed runtime hooks only.",
          "Does not inject framework patches, mutate components, or install telemetry.",
          "Missing hooks return explicit unavailable results.",
        ],
        react: opts.kind === "react" || opts.kind === "all" ? inspectReact() : undefined,
        webVitals:
          opts.kind === "web-vitals" || opts.kind === "all" ? inspectWebVitals() : undefined,
        spa: opts.kind === "spa" || opts.kind === "all" ? inspectSpa() : undefined,
      };
    },
  );
}

function normalizeFrameworkKind(value: unknown): "react" | "web-vitals" | "spa" | "all" {
  if (value === "react") return "react";
  if (value === "web-vitals" || value === "vitals") return "web-vitals";
  if (value === "spa" || value === "navigation") return "spa";
  if (value === "all" || value === undefined || value === null || value === "") return "all";
  throw new GatewayError(
    "bad_framework_kind",
    "framework kind must be react, web-vitals, spa, or all",
  );
}

type NetworkFilters = {
  urlPattern?: string;
  urlRegex?: string;
  method?: string;
  statusMin?: number;
  statusMax?: number;
  typeSet?: Set<string>;
};

function readNetworkFilters(params: NonNullable<GatewayCommand["params"]>): NetworkFilters {
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : undefined;
  const urlRegex = typeof params.urlRegex === "string" ? params.urlRegex : undefined;
  const method = typeof params.method === "string" ? params.method.toUpperCase() : undefined;
  const statusMin = typeof params.statusMin === "number" ? params.statusMin : undefined;
  const statusMax = typeof params.statusMax === "number" ? params.statusMax : undefined;
  const typeSet =
    typeof params.type === "string"
      ? new Set(
          params.type
            .split(",")
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean),
        )
      : undefined;
  return { urlPattern, urlRegex, method, statusMin, statusMax, typeSet };
}

function readHARLimit(params: NonNullable<GatewayCommand["params"]>): number {
  return typeof params.limit === "number" ? Math.max(1, Math.min(1000, params.limit)) : 200;
}

function publicNetworkFilters(filters: NetworkFilters): Record<string, unknown> {
  return {
    urlPattern: filters.urlPattern,
    urlRegex: filters.urlRegex,
    method: filters.method,
    statusMin: filters.statusMin,
    statusMax: filters.statusMax,
    types: filters.typeSet ? Array.from(filters.typeSet) : undefined,
  };
}

function networkEntryMatches(
  entry: NetworkEntry,
  filters: NetworkFilters,
  requireResponse = false,
): boolean {
  if (filters.urlPattern && !globMatch(filters.urlPattern, entry.url)) return false;
  if (filters.urlRegex && !new RegExp(filters.urlRegex).test(entry.url)) return false;
  if (filters.method && entry.method.toUpperCase() !== filters.method) return false;
  if (filters.statusMin !== undefined && (entry.status ?? 0) < filters.statusMin) return false;
  if (filters.statusMax !== undefined && (entry.status ?? 0) > filters.statusMax) return false;
  if (filters.typeSet && entry.type && !filters.typeSet.has(entry.type)) return false;
  if (filters.typeSet && !entry.type) return false;
  if (requireResponse) return entry.status !== undefined || entry.errorText !== undefined;
  return true;
}

function publicNetworkEntry(entry: NetworkEntry): Record<string, unknown> {
  const { startTime: _startTime, ...publicEntry } = entry;
  return publicEntry;
}

function networkEntryToHAR(entry: NetworkEntry, pageId: string): Record<string, unknown> {
  const time = entry.durationMs ?? 0;
  const responseSize = entry.encodedDataLength ?? -1;
  const content: Record<string, unknown> = {
    size: responseSize,
    mimeType: entry.mimeType ?? "",
    comment: "Response body omitted by ABG metadata-only HAR redaction.",
  };
  return {
    pageref: pageId,
    startedDateTime: entry.ts,
    time,
    request: {
      method: entry.method,
      url: entry.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: [],
      queryString: queryStringPairs(entry.url),
      headersSize: -1,
      bodySize: 0,
      comment: "Request headers, cookies, authorization data, and body omitted by ABG redaction.",
    },
    response: {
      status: entry.status ?? 0,
      statusText: entry.statusText ?? (entry.errorText ? "Failed" : ""),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: entry.mimeType ? [{ name: "content-type", value: entry.mimeType }] : [],
      content,
      redirectURL: "",
      headersSize: -1,
      bodySize: responseSize,
      comment: "Sensitive response headers and body omitted by ABG redaction.",
    },
    cache: {},
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      send: 0,
      wait: time,
      receive: 0,
      ssl: -1,
    },
    comment: entry.errorText
      ? `Network failed: ${entry.errorText}`
      : "Metadata-only ABG HAR entry.",
  };
}

function queryStringPairs(rawUrl: string): Array<{ name: string; value: string }> {
  try {
    const url = new URL(rawUrl);
    return Array.from(url.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function readNetworkBodyMaxBytes(params: NonNullable<GatewayCommand["params"]>): number {
  return typeof params.maxBytes === "number"
    ? Math.max(0, Math.min(262_144, params.maxBytes))
    : 16_384;
}

async function getResponseBodyPreview(
  tabId: number,
  requestId: string,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const result = (await browser.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
    requestId,
  })) as { body: string; base64Encoded: boolean };
  const bytes = new TextEncoder().encode(result.body);
  const truncated = bytes.length > maxBytes;
  const preview = result.base64Encoded
    ? result.body.slice(0, maxBytes)
    : new TextDecoder().decode(bytes.slice(0, maxBytes));
  return {
    value: preview,
    base64Encoded: result.base64Encoded,
    encodedBytes: bytes.length,
    maxBytes,
    truncated,
  };
}

async function waitForNetworkResponse(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  const filters = readNetworkFilters(params);
  const timeoutMs =
    typeof params.timeoutMs === "number"
      ? Math.max(1, Math.min(300_000, params.timeoutMs))
      : 30_000;
  const body = params.body === true;
  const maxBytes = readNetworkBodyMaxBytes(params);
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const match = (networkBuffers.get(tabId) ?? [])
      .slice()
      .reverse()
      .find((entry) => networkEntryMatches(entry, filters, true));
    if (match) {
      const response: Record<string, unknown> = publicNetworkEntry(match);
      if (body && match.requestId && match.status !== undefined) {
        try {
          response.body = await getResponseBodyPreview(tabId, match.requestId, maxBytes);
        } catch (error) {
          response.bodyError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        ok: true,
        mode: "wait_for_response",
        elapsedMs: Date.now() - started,
        response,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    ok: false,
    error: "timeout",
    mode: "wait_for_response",
    timeoutMs,
    filters: {
      urlPattern: filters.urlPattern,
      urlRegex: filters.urlRegex,
      method: filters.method,
      statusMin: filters.statusMin,
      statusMax: filters.statusMax,
      types: filters.typeSet ? Array.from(filters.typeSet) : undefined,
    },
  };
}

// ---------- Operation tools (v0.1.1) ----------

function normalizeSandboxStorageKind(value: unknown): "local-storage" | "session-storage" {
  if (value === "localStorage" || value === "local-storage") return "local-storage";
  if (value === "sessionStorage" || value === "session-storage") return "session-storage";
  throw new GatewayError(
    "bad_storage_kind",
    "storage kind must be local-storage or session-storage",
  );
}

async function sandboxSetViewport(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<Record<string, unknown>> {
  const width = typeof params.width === "number" ? Math.max(1, Math.min(4096, params.width)) : 0;
  const height = typeof params.height === "number" ? Math.max(1, Math.min(4096, params.height)) : 0;
  if (width <= 0 || height <= 0) {
    throw new GatewayError("bad_viewport", "width and height must be positive numbers");
  }
  const deviceScaleFactor =
    typeof params.deviceScaleFactor === "number"
      ? Math.max(0.1, Math.min(5, params.deviceScaleFactor))
      : 1;
  const mobile = params.mobile === true;
  await attachDebugger(tabId);
  await browser.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile,
  });
  return { ok: true, action: "viewport", width, height, deviceScaleFactor, mobile };
}

async function sandboxClearViewport(tabId: number): Promise<Record<string, unknown>> {
  await attachDebugger(tabId);
  await browser.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride");
  return { ok: true, action: "viewport-clear" };
}

async function sandboxStorage(
  tabId: number,
  storageKind: "local-storage" | "session-storage",
  key: string,
  value: string | undefined,
): Promise<Record<string, unknown>> {
  return runFrameScript(
    tabId,
    undefined,
    { storageKind, key, value },
    (
      ctx,
      opts: { storageKind: "local-storage" | "session-storage"; key: string; value?: string },
    ): Record<string, unknown> => {
      const storage =
        opts.storageKind === "local-storage" ? ctx.win.localStorage : ctx.win.sessionStorage;
      if (opts.value === undefined) {
        const existed = storage.getItem(opts.key) !== null;
        storage.removeItem(opts.key);
        return {
          ok: true,
          action: "storage-delete",
          storageKind: opts.storageKind,
          key: opts.key,
          existed,
        };
      }
      storage.setItem(opts.key, opts.value);
      return {
        ok: true,
        action: "storage-set",
        storageKind: opts.storageKind,
        key: opts.key,
        valueBytes: new TextEncoder().encode(opts.value).byteLength,
      };
    },
  );
}

async function sandboxCreateTab(tabId: number, url: string): Promise<Record<string, unknown>> {
  const source = await browser.tabs.get(tabId);
  const created = await browser.tabs.create({ url, windowId: source.windowId, active: true });
  return { ok: true, action: "tab-create", tabId: created.id, url: created.url ?? url };
}

async function sandboxCloseTab(targetTabId: number): Promise<Record<string, unknown>> {
  const target = permittedTabs.get(targetTabId);
  if (target?.accessMode !== "all_tabs") {
    throw new GatewayError(
      "sandbox_tab_required",
      "tab-close is limited to tabs shared through sandbox all-tabs mode",
    );
  }
  await browser.tabs.remove(targetTabId);
  return { ok: true, action: "tab-close", targetTabId };
}

async function clickSelector(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{ found: boolean; tag?: string }> {
  return runFrameScript(tabId, frame, { selector }, clickSelectorFrameFn);
}

async function clickAt(tabId: number, x: number, y: number): Promise<{ ok: true }> {
  await attachDebugger(tabId);
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  return { ok: true };
}

async function doubleClickSelector(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{ ok: true; selector: string; x: number; y: number }> {
  await attachDebugger(tabId);
  const point = await resolvePoint(tabId, { kind: "selector", selector, frame });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
  for (const clickCount of [1, 2]) {
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount,
    });
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount,
    });
  }
  return { ok: true, selector, x: point.x, y: point.y };
}

async function hoverSelector(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{ ok: true; selector: string; x: number; y: number }> {
  await attachDebugger(tabId);
  const point = await resolvePoint(tabId, { kind: "selector", selector, frame });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
  return { ok: true, selector, x: point.x, y: point.y };
}

async function selectOption(
  tabId: number,
  selector: string,
  choice: { value?: string; label?: string },
  frame?: string,
): Promise<{
  ok: boolean;
  found: boolean;
  selectedValues?: string[];
  selectedLabels?: string[];
  changed?: boolean;
}> {
  return runFrameScript(
    tabId,
    frame,
    { selector, value: choice.value, label: choice.label },
    (ctx, opts) => {
      const select = ctx.query(opts.selector) as HTMLSelectElement | null;
      if (!select) return { ok: false, found: false } as const;
      if (!(select instanceof HTMLSelectElement)) {
        return { ok: false, found: true, error: "not_select" } as const;
      }
      const before = Array.from(select.selectedOptions).map((option) => option.value);
      const options = Array.from(select.options);
      const option = options.find((candidate) =>
        opts.value !== undefined
          ? candidate.value === opts.value
          : candidate.textContent?.replace(/\s+/g, " ").trim() === opts.label,
      );
      if (!option) {
        return {
          ok: false,
          found: true,
          error: "option_not_found",
          selectedValues: before,
        } as const;
      }
      for (const candidate of options) {
        candidate.selected = candidate === option;
      }
      const after = Array.from(select.selectedOptions).map((selected) => selected.value);
      const changed = before.join("\u0000") !== after.join("\u0000");
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return {
        ok: true,
        found: true,
        changed,
        selectedValues: after,
        selectedLabels: Array.from(select.selectedOptions).map((selected) =>
          (selected.textContent ?? "").replace(/\s+/g, " ").trim(),
        ),
        frame: ctx.frame,
      } as const;
    },
  );
}

async function setChecked(
  tabId: number,
  selector: string,
  checked: boolean,
  frame?: string,
): Promise<{
  ok: boolean;
  found: boolean;
  type?: string;
  before?: boolean;
  after?: boolean;
  changed?: boolean;
  error?: string;
}> {
  return runFrameScript(tabId, frame, { selector, checked }, (ctx, opts) => {
    const input = ctx.query(opts.selector) as HTMLInputElement | null;
    if (!input) return { ok: false, found: false } as const;
    if (!(input instanceof HTMLInputElement)) {
      return { ok: false, found: true, error: "not_input" } as const;
    }
    const type = input.type.toLowerCase();
    if (type !== "checkbox" && type !== "radio") {
      return { ok: false, found: true, type, error: "not_checkable" } as const;
    }
    const before = input.checked;
    if (before !== opts.checked) {
      input.checked = opts.checked;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return {
      ok: true,
      found: true,
      type,
      before,
      after: input.checked,
      changed: before !== input.checked,
      frame: ctx.frame,
    } as const;
  });
}

async function clickDescribedElement(
  tabId: number,
  id: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{ ok: true; id: number; x: number; y: number } | { ok: false; id: number }> {
  const described = await describeElements(tabId, {
    tabId,
    all: params.all,
    grid: params.grid,
    frame: readFrameParam(params),
    limit: typeof params.limit === "number" ? Math.max(params.limit, id + 1) : Math.max(80, id + 1),
  });
  const elements = described.elements as {
    id: number;
    bbox?: { x: number; y: number; w: number; h: number };
  }[];
  const target = elements.find((element) => element.id === id);
  if (!target?.bbox) return { ok: false, id };
  const x = target.bbox.x + target.bbox.w / 2;
  const y = target.bbox.y + target.bbox.h / 2;
  await clickAt(tabId, x, y);
  return { ok: true, id, x, y };
}

type DragPoint =
  | { kind: "selector"; selector: string; frame?: string }
  | { kind: "coords"; x: number; y: number };

function readDragPoint(
  params: GatewayCommand["params"] | undefined,
  prefix: "from" | "to",
): DragPoint {
  const selector = prefix === "from" ? params?.fromSelector : params?.toSelector;
  const frame = readFrameParam(params);
  if (typeof selector === "string" && selector.length > 0)
    return { kind: "selector", selector, frame };
  const x = prefix === "from" ? params?.fromX : params?.toX;
  const y = prefix === "from" ? params?.fromY : params?.toY;
  if (typeof x === "number" && typeof y === "number") return { kind: "coords", x, y };
  throw new Error(`${prefix} selector or coordinates required`);
}

function describeDragPoint(point: DragPoint): string {
  return point.kind === "selector"
    ? `selector ${quoteForIntent(point.selector)}`
    : `(${point.x}, ${point.y})`;
}

async function resolvePoint(tabId: number, point: DragPoint): Promise<Point> {
  if (point.kind === "coords") return { x: point.x, y: point.y };
  const result = await runFrameScript(
    tabId,
    point.frame,
    { selector: point.selector },
    (ctx, opts) => {
      const el = ctx.query(opts.selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: ctx.offsetX + rect.left + rect.width / 2,
        y: ctx.offsetY + rect.top + rect.height / 2,
      };
    },
  );
  if (!result)
    throw new GatewayError("selector_not_found", `selector not found: ${point.selector}`);
  return result;
}

async function drag(
  tabId: number,
  from: DragPoint,
  to: DragPoint,
  steps: number,
): Promise<{ ok: true; from: Point; to: Point; steps: number }> {
  await attachDebugger(tabId);
  const fromPoint = await resolvePoint(tabId, from);
  const toPoint = await resolvePoint(tabId, to);
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: fromPoint.x,
    y: fromPoint.y,
    button: "none",
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: fromPoint.x,
    y: fromPoint.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromPoint.x + (toPoint.x - fromPoint.x) * t;
    const y = fromPoint.y + (toPoint.y - fromPoint.y) * t;
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "left",
      buttons: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: toPoint.x,
    y: toPoint.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return { ok: true, from: fromPoint, to: toPoint, steps };
}

type EditableKind = "input" | "textarea" | "contenteditable" | "role-textbox" | "unsupported";

type FillResult = {
  ok: boolean;
  found: boolean;
  kind?: EditableKind;
  dryRun?: boolean;
  beforeLength?: number;
  afterLength?: number;
  replacementLength?: number;
  strategy?: "valueSetter" | "selectionReplacement" | "textContentFallback" | "preview";
  auditDiff?: AuditDiffPayload;
};

type FillAuditDiffSource = {
  before: AuditDiffValue;
  after: AuditDiffValue;
};

type FillFrameResult = Omit<FillResult, "auditDiff"> & {
  auditDiffSource?: FillAuditDiffSource;
};

async function fillField(
  tabId: number,
  selector: string,
  value: string,
  dryRun: boolean,
  frame?: string,
  options: { auditDiff?: boolean; auditDiffExcerptChars?: number } = {},
): Promise<FillResult> {
  const frameResult = await runFrameScript<
    FillFrameResult,
    {
      selector: string;
      value: string;
      dryRun: boolean;
      auditDiff: boolean;
    }
  >(
    tabId,
    frame,
    { selector, value, dryRun, auditDiff: options.auditDiff === true },
    (ctx, opts) => {
      const sel = opts.selector;
      const val = opts.value;
      const previewOnly = opts.dryRun === true;
      type LocalKind = "input" | "textarea" | "contenteditable" | "role-textbox" | "unsupported";
      type LocalAuditValue = { text: string; html?: string };
      const el = ctx.query(sel) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      if (!el) return { ok: false, found: false } as const;

      const kindOf = (target: Element): LocalKind => {
        if (target instanceof HTMLInputElement) return "input";
        if (target instanceof HTMLTextAreaElement) return "textarea";
        if ((target as HTMLElement).isContentEditable) return "contenteditable";
        if (target.getAttribute("role") === "textbox") return "role-textbox";
        return "unsupported";
      };
      const currentText = (target: typeof el): string => {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return target.value;
        }
        return target.textContent ?? "";
      };
      const currentSnapshot = (target: typeof el): LocalAuditValue => {
        const text = currentText(target);
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return { text };
        }
        return { text, html: target.innerHTML };
      };
      const dispatchReplacementEvents = (
        target: Element,
        text: string,
        inputType: string,
      ): void => {
        const beforeInput = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data: text,
        });
        target.dispatchEvent(beforeInput);
        target.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType,
            data: text,
          }),
        );
        target.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const selectEditableContents = (target: HTMLElement): void => {
        target.focus({ preventScroll: true });
        const range = ctx.doc.createRange();
        range.selectNodeContents(target);
        const selection = ctx.win.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      const kind = kindOf(el);
      if (kind === "unsupported") {
        return { ok: false, found: true, kind, replacementLength: val.length } as const;
      }

      const beforeSnapshot =
        opts.auditDiff === true && !previewOnly ? currentSnapshot(el) : undefined;
      const withAuditDiff = <T extends Record<string, unknown>>(result: T) => {
        if (!beforeSnapshot) return result;
        return {
          ...result,
          auditDiffSource: {
            before: beforeSnapshot,
            after: currentSnapshot(el),
          },
        };
      };

      const beforeLength = currentText(el).length;
      if (previewOnly) {
        return {
          ok: true,
          found: true,
          kind,
          dryRun: true,
          beforeLength,
          replacementLength: val.length,
          strategy: "preview",
          frame: ctx.frame,
        } as const;
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto =
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(0, el.value.length);
        } catch {
          // Some input types do not expose text selection.
        }
        el.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertReplacementText",
            data: val,
          }),
        );
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertReplacementText",
            data: val,
          }),
        );
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return withAuditDiff({
          ok: true,
          found: true,
          kind,
          beforeLength,
          afterLength: el.value.length,
          replacementLength: val.length,
          strategy: "valueSetter",
          frame: ctx.frame,
        } as const);
      }

      selectEditableContents(el);
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertReplacementText",
          data: val,
        }),
      );
      const inserted = document.execCommand("insertText", false, val);
      if (!inserted || currentText(el) !== val) {
        el.textContent = val;
        dispatchReplacementEvents(el, val, "insertReplacementText");
        return withAuditDiff({
          ok: true,
          found: true,
          kind,
          beforeLength,
          afterLength: currentText(el).length,
          replacementLength: val.length,
          strategy: "textContentFallback",
          frame: ctx.frame,
        } as const);
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertReplacementText",
          data: val,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return withAuditDiff({
        ok: true,
        found: true,
        kind,
        beforeLength,
        afterLength: currentText(el).length,
        replacementLength: val.length,
        strategy: "selectionReplacement",
        frame: ctx.frame,
      } as const);
    },
  );

  const { auditDiffSource, ...result } = frameResult;
  if (!auditDiffSource) return result;
  return {
    ...result,
    auditDiff: createAuditDiff(auditDiffSource.before, auditDiffSource.after, {
      excerptChars: options.auditDiffExcerptChars,
    }),
  };
}

type PasteResult = {
  ok: boolean;
  found: boolean;
  focused: boolean;
  pasted: boolean;
  viaClipboardFallback: boolean;
  pasteStrategy: "native" | "execCommand" | "clipboardEvent" | null;
};

type ClearResult = {
  ok: boolean;
  found: boolean;
  focused: boolean;
  cleared: boolean;
  clearStrategy: "execCommand" | "selectionRange" | "syntheticInput" | "keyboardShortcut" | null;
};

async function pasteText(
  tabId: number,
  selector: string,
  value: string,
  frame?: string,
): Promise<PasteResult> {
  const focusResult = await focusEditableElement(tabId, selector, frame);
  if (!focusResult.found || !focusResult.focused) {
    return {
      ok: false,
      found: focusResult.found,
      focused: focusResult.focused,
      pasted: false,
      viaClipboardFallback: false,
      pasteStrategy: null,
    };
  }
  const viaClipboardFallback = await writeClipboardText(tabId, value);
  if (viaClipboardFallback) {
    await focusEditableElement(tabId, selector, frame);
  }
  await dispatchPasteShortcut(tabId);
  let pasted = await editableTextIncludes(tabId, selector, value, frame);
  if (pasted) {
    return {
      ok: true,
      found: true,
      focused: true,
      pasted,
      viaClipboardFallback,
      pasteStrategy: "native",
    };
  }

  await insertTextWithExecCommand(tabId, selector, value, frame);
  pasted = await editableTextIncludes(tabId, selector, value, frame);
  if (pasted) {
    return {
      ok: true,
      found: true,
      focused: true,
      pasted,
      viaClipboardFallback,
      pasteStrategy: "execCommand",
    };
  }

  await dispatchClipboardPasteEvent(tabId, selector, value, frame);
  pasted = await editableTextIncludes(tabId, selector, value, frame);
  return {
    ok: true,
    found: true,
    focused: true,
    pasted,
    viaClipboardFallback,
    pasteStrategy: pasted ? "clipboardEvent" : null,
  };
}

async function pasteRichClipboard(
  tabId: number,
  selector?: string,
  frame?: string,
): Promise<{ ok: boolean; found?: boolean; focused?: boolean; tag?: string; activeTag?: string }> {
  if (selector) {
    const focusResult = await focusElement(tabId, selector, frame);
    if (!focusResult.found || !focusResult.focused) {
      return {
        ok: false,
        found: focusResult.found,
        focused: focusResult.focused,
        tag: focusResult.tag,
        activeTag: focusResult.activeTag,
      };
    }
    await dispatchPasteShortcut(tabId);
    return { ok: true, ...focusResult };
  }

  await dispatchPasteShortcut(tabId);
  return { ok: true };
}

async function clearEditable(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<ClearResult> {
  const focusResult = await focusEditableElement(tabId, selector, frame);
  if (!focusResult.found || !focusResult.focused) {
    return {
      ok: false,
      found: focusResult.found,
      focused: focusResult.focused,
      cleared: false,
      clearStrategy: null,
    };
  }

  await clearWithExecCommand(tabId, selector, frame);
  if (await editableTextEmpty(tabId, selector, frame)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "execCommand",
    };
  }

  await clearWithSelectionRange(tabId, selector, frame);
  if (await editableTextEmpty(tabId, selector, frame)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "selectionRange",
    };
  }

  await clearWithSyntheticInput(tabId, selector, frame);
  if (await editableTextEmpty(tabId, selector, frame)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "syntheticInput",
    };
  }

  await dispatchSelectAllBackspaceShortcut(tabId);
  const cleared = await editableTextEmpty(tabId, selector, frame);
  return {
    ok: true,
    found: true,
    focused: true,
    cleared,
    clearStrategy: cleared ? "keyboardShortcut" : null,
  };
}

async function focusElement(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{ found: boolean; focused: boolean; tag?: string; activeTag?: string }> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return { found: false, focused: false } as const;
    el.focus({ preventScroll: true });
    const active = ctx.doc.activeElement;
    return {
      found: true,
      focused: active === el || el.contains(active),
      tag: el.tagName.toLowerCase(),
      activeTag: active?.tagName.toLowerCase(),
      frame: ctx.frame,
    } as const;
  });
}

async function focusEditableElement(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{ found: boolean; focused: boolean }> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return { found: false, focused: false } as const;
    const editable =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el.isContentEditable ||
      el.getAttribute("role") === "textbox";
    if (!editable) return { found: false, focused: false } as const;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // Some input types do not expose text selection.
      }
    } else if (el.isContentEditable) {
      const range = ctx.doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = ctx.win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return {
      found: true,
      focused: ctx.doc.activeElement === el || el.contains(ctx.doc.activeElement),
    } as const;
  });
}

async function clearWithExecCommand(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<void> {
  await runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    ctx.doc.execCommand("selectAll");
    ctx.doc.execCommand("delete");
  });
}

async function clearWithSelectionRange(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<void> {
  await runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLElement
      | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        // Some input types do not expose text selection.
      }
    } else if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      const range = ctx.doc.createRange();
      range.selectNodeContents(el);
      const selection = ctx.win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    ctx.doc.execCommand("delete");
  });
}

async function clearWithSyntheticInput(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<void> {
  await runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLElement
      | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        // Some input types do not expose text selection.
      }
    } else if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      const range = ctx.doc.createRange();
      range.selectNodeContents(el);
      const selection = ctx.win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContent",
      data: null,
    });
    const canceled = !el.dispatchEvent(beforeInput);
    if (!canceled && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, "");
      else el.value = "";
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function writeClipboardText(tabId: number, value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return false;
    }
  } catch {
    // Fall back to a page-scoped copy operation below.
  }
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: (text: string) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.documentElement.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    },
    args: [value],
  });
  if (!res?.result) {
    throw new GatewayError("clipboard_write_failed", "failed to write text to the clipboard");
  }
  return true;
}

async function dispatchSelectAllBackspaceShortcut(tabId: number): Promise<void> {
  await attachDebugger(tabId);
  const isMac = /Mac/i.test(navigator.platform);
  const modifierKey = isMac ? "Meta" : "Control";
  const modifierCode = isMac ? "MetaLeft" : "ControlLeft";
  const modifierMask = isMac ? 4 : 2;
  const modifierVirtualKey = isMac ? 91 : 17;
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: modifierMask,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierMask,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierMask,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: 0,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
    modifiers: 0,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
    modifiers: 0,
  });
}

async function dispatchPasteShortcut(tabId: number): Promise<void> {
  await attachDebugger(tabId);
  const isMac = /Mac/i.test(navigator.platform);
  const modifierKey = isMac ? "Meta" : "Control";
  const modifierCode = isMac ? "MetaLeft" : "ControlLeft";
  const modifierMask = isMac ? 4 : 2;
  const modifierVirtualKey = isMac ? 91 : 17;
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: modifierMask,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: modifierMask,
    // Synthesized modifier+V alone never reaches the browser's accelerator
    // handling, so no paste event with clipboard data ever fires; the editing
    // command makes the renderer perform the actual paste.
    commands: ["paste"],
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: modifierMask,
  });
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: 0,
  });
}

async function insertTextWithExecCommand(
  tabId: number,
  selector: string,
  value: string,
  frame?: string,
): Promise<void> {
  await runFrameScript(tabId, frame, { selector, value }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // Some input types do not expose text selection.
      }
    } else if (el.isContentEditable) {
      const range = ctx.doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = ctx.win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    ctx.doc.execCommand("insertText", false, opts.value);
  });
}

async function dispatchClipboardPasteEvent(
  tabId: number,
  selector: string,
  value: string,
  frame?: string,
): Promise<void> {
  await runFrameScript(tabId, frame, { selector, value }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", opts.value);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    el.dispatchEvent(event);
  });
}

async function editableTextIncludes(
  tabId: number,
  selector: string,
  value: string,
  frame?: string,
): Promise<boolean> {
  if (value.length === 0) return true;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const text = await readEditableText(tabId, selector, frame).catch(() => "");
    if (text.includes(value)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function editableTextEmpty(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const text = await readEditableText(tabId, selector, frame).catch(() => "");
    if (text.trim().length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function readEditableText(tabId: number, selector: string, frame?: string): Promise<string> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLElement
      | null;
    if (!el) return "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return el.textContent ?? "";
  });
}

async function replaceDom(
  tabId: number,
  selector: string,
  html: string,
  frame?: string,
): Promise<{ found: boolean; inserted: number; selector: string }> {
  return runFrameScript(tabId, frame, { selector, html }, (ctx, opts) => {
    const target = ctx.query(opts.selector);
    if (!target) return { found: false, inserted: 0, selector: opts.selector } as const;
    const template = ctx.doc.createElement("template");
    template.innerHTML = opts.html.trim();
    const nodes = Array.from(template.content.childNodes);
    if (nodes.length === 0) return { found: false, inserted: 0, selector: opts.selector } as const;
    target.replaceWith(...nodes);
    return {
      found: true,
      inserted: nodes.length,
      selector: opts.selector,
      frame: ctx.frame,
    } as const;
  });
}

async function uploadFile(
  tabId: number,
  selector: string,
  files: string[],
  frame?: string,
): Promise<{ ok: true; selector: string; files: number }> {
  if (frame) {
    throw new GatewayError(
      "unsupported_frame_upload",
      "upload currently supports top-document input[type=file] only; use a top-document selector or file a frame upload follow-up",
    );
  }
  if (!(await browser.extension.isAllowedFileSchemeAccess())) {
    const failure = describeFileAttachFailure("Not allowed");
    throw new GatewayError(failure.code, failure.message);
  }
  await attachDebugger(tabId);
  const documentNode = (await browser.debugger.sendCommand({ tabId }, "DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as { root: { nodeId: number } };
  const queryResult = (await browser.debugger.sendCommand({ tabId }, "DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector,
  })) as { nodeId: number };
  if (!queryResult.nodeId) {
    throw new GatewayError("selector_not_found", `selector not found: ${selector}`);
  }
  const described = (await browser.debugger.sendCommand({ tabId }, "DOM.describeNode", {
    nodeId: queryResult.nodeId,
  })) as { node: { nodeName: string; attributes?: string[]; backendNodeId?: number } };
  const attrs = described.node.attributes ?? [];
  const attrMap = new Map<string, string>();
  for (let i = 0; i < attrs.length; i += 2) {
    const key = attrs[i];
    const value = attrs[i + 1];
    if (key !== undefined && value !== undefined) attrMap.set(key.toLowerCase(), value);
  }
  if (
    described.node.nodeName.toLowerCase() !== "input" ||
    attrMap.get("type")?.toLowerCase() !== "file"
  ) {
    throw new GatewayError("not_file_input", "selector does not point to input[type=file]");
  }
  if (files.length > 1 && attrMap.get("multiple") === undefined) {
    throw new GatewayError(
      "single_file_input",
      `selector points to a single-file input but ${files.length} files were given; the input needs the "multiple" attribute to accept more than one file`,
    );
  }
  // Prefer backendNodeId: it stays valid across the getDocument/querySelector
  // round-trip, whereas a plain nodeId can be invalidated by DOM mutation
  // between calls — a common source of "Not allowed" from setFileInputFiles.
  const backendNodeId = described.node.backendNodeId;
  const target = backendNodeId !== undefined ? { backendNodeId } : { nodeId: queryResult.nodeId };
  try {
    await browser.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
      ...target,
      files,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const failure = describeFileAttachFailure(detail);
    throw new GatewayError(failure.code, failure.message);
  }
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return { files: 0 };
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { files: el.files?.length ?? 0 };
    },
    args: [selector],
  });
  return { ok: true, selector, files: res?.result?.files ?? 0 };
}

async function typeText(tabId: number, text: string): Promise<{ ok: true }> {
  await attachDebugger(tabId);
  // Send keyDown (no text → fires DOM keydown without inserting char, this is what
  // wakes apps like Sheets into "user is typing" mode), then char (inserts the char
  // exactly once), then keyUp (fires DOM keyup).
  // Including text on keyDown causes double-insertion on Sheets/Docs.
  for (const ch of text) {
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: ch,
    });
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "char",
      text: ch,
      unmodifiedText: ch,
    });
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: ch,
    });
  }
  return { ok: true };
}

async function keyboardInsertText(
  tabId: number,
  text: string,
): Promise<{ ok: true; insertedBytes: number }> {
  await attachDebugger(tabId);
  await browser.debugger.sendCommand({ tabId }, "Input.insertText", { text });
  return { ok: true, insertedBytes: new TextEncoder().encode(text).byteLength };
}

const EXEC_COMMAND_ALLOWLIST = new Set(["insertText", "delete", "selectAll", "undo", "redo"]);
type ExecCommandName = "insertText" | "delete" | "selectAll" | "undo" | "redo";

function isAllowedExecCommand(value: unknown): value is ExecCommandName {
  return typeof value === "string" && EXEC_COMMAND_ALLOWLIST.has(value);
}

type ExecCommandResult = {
  ok: boolean;
  command: ExecCommandName;
  valueBytes: number;
  activeElement?: string;
};

async function execCommand(
  tabId: number,
  command: ExecCommandName,
  value?: string,
): Promise<ExecCommandResult> {
  const valueBytes = value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (commandName: ExecCommandName, commandValue: string | undefined) => {
      const allowed = ["insertText", "delete", "selectAll", "undo", "redo"];
      if (!allowed.includes(commandName)) {
        return {
          ok: false,
          command: commandName,
          valueBytes: 0,
        };
      }
      const active = document.activeElement;
      const activeElement = active ? active.tagName.toLowerCase() : undefined;
      const ok =
        commandValue === undefined
          ? document.execCommand(commandName)
          : document.execCommand(commandName, false, commandValue);
      return {
        ok,
        command: commandName,
        valueBytes:
          commandValue === undefined ? 0 : new TextEncoder().encode(commandValue).byteLength,
        activeElement,
      };
    },
    args: [command, value],
  });
  return res?.result ?? { ok: false, command, valueBytes };
}

const KEY_CODE_MAP: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  " ": "Space",
  Space: "Space",
};

function modifiersToBitmask(modifiers: string[]): number {
  let mask = 0;
  for (const m of modifiers) {
    const lc = m.toLowerCase();
    if (lc === "alt") mask |= 1;
    else if (lc === "ctrl") mask |= 2;
    else if (lc === "cmd" || lc === "meta") mask |= 4;
    else if (lc === "shift") mask |= 8;
  }
  return mask;
}

async function keyPress(
  tabId: number,
  key: string,
  code: string | undefined,
  modifiers: string[],
): Promise<{ ok: true }> {
  await attachDebugger(tabId);
  const mods = modifiersToBitmask(modifiers);
  const resolvedCode =
    code ?? KEY_CODE_MAP[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const resolvedKey = key === "Space" ? " " : key;
  const base = { key: resolvedKey, code: resolvedCode, modifiers: mods };
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base,
  });
  if (resolvedKey.length === 1) {
    await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "char",
      text: resolvedKey,
      ...base,
    });
  }
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    ...base,
  });
  return { ok: true };
}

async function keyEdge(
  tabId: number,
  type: "keyDown" | "keyUp",
  key: string,
  code: string | undefined,
  modifiers: string[],
): Promise<{ ok: true; type: "keyDown" | "keyUp" }> {
  await attachDebugger(tabId);
  const mods = modifiersToBitmask(modifiers);
  const resolvedCode =
    code ?? KEY_CODE_MAP[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const resolvedKey = key === "Space" ? " " : key;
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type,
    key: resolvedKey,
    code: resolvedCode,
    modifiers: mods,
  });
  return { ok: true, type };
}

type WaitParams = NonNullable<GatewayCommand["params"]>;
type WaitResult =
  | { ok: true; mode: "sleep"; ms: number }
  | { ok: true; mode: "selector"; found: boolean; elapsedMs: number; selector: string }
  | { ok: true; mode: "text" | "url" | "load" | "predicate"; elapsedMs: number }
  | { ok: false; error: "timeout"; mode: string; timeoutMs: number };

async function waitFor(tabId: number, params: WaitParams): Promise<WaitResult> {
  const sleepMs = typeof params.sleepMs === "number" ? params.sleepMs : undefined;
  if (sleepMs !== undefined) {
    await new Promise((r) => setTimeout(r, Math.max(0, sleepMs)));
    return { ok: true, mode: "sleep", ms: sleepMs };
  }
  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 10_000;
  const frame = readFrameParam(params);
  const text = typeof params.text === "string" ? params.text : undefined;
  if (text !== undefined) {
    return waitUntil(tabId, "text", timeoutMs, async () => {
      return runFrameScript(tabId, frame, { text }, (ctx, opts) =>
        (ctx.doc.body?.innerText ?? ctx.doc.documentElement.innerText ?? "").includes(opts.text),
      );
    });
  }
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : undefined;
  if (urlPattern !== undefined) {
    return waitUntil(tabId, "url", timeoutMs, async () => {
      const tab = await browser.tabs.get(tabId);
      return globMatch(urlPattern, tab.url ?? "");
    });
  }
  const loadState = typeof params.loadState === "string" ? params.loadState : undefined;
  if (loadState !== undefined) {
    if (!["networkidle", "load", "domcontentloaded"].includes(loadState)) {
      throw new GatewayError(
        "bad_params",
        "loadState must be one of networkidle, load, or domcontentloaded",
      );
    }
    await attachDebugger(tabId);
    return waitUntil(
      tabId,
      "load",
      timeoutMs,
      async () => {
        if (loadState === "networkidle") return (activeNetworkRequests.get(tabId)?.size ?? 0) === 0;
        const [res] = await browser.scripting.executeScript({
          target: { tabId },
          func: (state: string) => {
            if (state === "domcontentloaded")
              return document.readyState === "interactive" || document.readyState === "complete";
            return document.readyState === "complete";
          },
          args: [loadState],
        });
        return res?.result === true;
      },
      loadState === "networkidle" ? 500 : 0,
    );
  }
  const predicate = typeof params.predicate === "string" ? params.predicate : undefined;
  if (predicate !== undefined) {
    return waitUntil(tabId, "predicate", timeoutMs, async () => {
      return runFrameScript(tabId, frame, { predicate }, (ctx, opts) => {
        const evaluate = (ctx.win as unknown as { eval: (source: string) => unknown }).eval;
        return Boolean(evaluate.call(ctx.win, opts.predicate));
      }).catch(() => false);
    });
  }
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  if (!selector) throw new Error("wait_for needs --selector or --ms");
  const hidden = params.hidden === true;
  const pollMs = 200;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = await runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
      const el = ctx.query(opts.selector) as HTMLElement | null;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
      return visible;
    });
    const matches = hidden ? !visible : visible;
    if (matches) {
      return {
        ok: true,
        mode: "selector",
        found: true,
        elapsedMs: Date.now() - start,
        selector,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: "timeout", mode: "selector", timeoutMs };
}

async function waitUntil(
  _tabId: number,
  mode: "text" | "url" | "load" | "predicate",
  timeoutMs: number,
  predicate: () => Promise<boolean>,
  stableMs = 0,
): Promise<WaitResult> {
  const pollMs = 200;
  const start = Date.now();
  let stableSince: number | null = null;
  while (Date.now() - start < timeoutMs) {
    const matches = await predicate();
    if (matches) {
      if (stableMs === 0) return { ok: true, mode, elapsedMs: Date.now() - start };
      stableSince = stableSince ?? Date.now();
      if (Date.now() - stableSince >= stableMs) {
        return { ok: true, mode, elapsedMs: Date.now() - start };
      }
    } else {
      stableSince = null;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: "timeout", mode, timeoutMs };
}

type EvalResult = {
  ok: boolean;
  tabId: number;
  url: string;
  title: string;
  value?: unknown;
  error?: string;
  message?: string;
  resultSummary: {
    type: string;
    jsonBytes: number;
    maxBytes: number;
    truncated: boolean;
  };
  approval: {
    mode: "per-call" | "trusted-automation";
    approver: "local_extension_user";
    approvedAt: string;
    popup: "shown" | "skipped";
  };
};

async function runApprovedEval(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<EvalResult> {
  const settings = await getSettings();
  if (!settings.evalEnabled) {
    throw new GatewayError(
      "eval_disabled",
      "Approved JavaScript eval is disabled. Enable it in the ABG extension popup before running abg eval.",
    );
  }
  const script = typeof params.script === "string" ? params.script : "";
  if (script.trim().length === 0) throw new Error("script required");
  const maxBytes =
    typeof params.maxBytes === "number"
      ? Math.max(1, Math.min(EVAL_HARD_MAX_BYTES, Math.floor(params.maxBytes)))
      : EVAL_DEFAULT_MAX_BYTES;

  const approvalMode = settings.trustedAutomationEnabled ? "trusted-automation" : "per-call";
  const approvalPopup = settings.trustedAutomationEnabled ? "skipped" : "shown";
  if (!settings.trustedAutomationEnabled) {
    if (params.approve !== true) {
      throw new GatewayError(
        "approval_required",
        "abg eval requires --approve unless Trusted automation / AutoMode is enabled in the ABG extension popup.",
      );
    }
    const approval = await requestOperationApproval(
      "eval_script",
      tabId,
      `Run approved JavaScript eval (${new TextEncoder().encode(script).byteLength} bytes).`,
      script,
    );
    if (approval.decision !== "allow") {
      throw new GatewayError("user_denied", approval.message);
    }
  }

  await attachDebugger(tabId);
  const expression = `(${evalPageFunction.toString()})(${JSON.stringify(script)}, ${maxBytes})`;
  const res = (await browser.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as {
    result?: { value?: Omit<EvalResult, "tabId" | "url" | "title" | "approval"> };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  if (res.exceptionDetails) {
    throw new GatewayError(
      "eval_failed",
      res.exceptionDetails.exception?.description ?? res.exceptionDetails.text,
    );
  }
  const tab = await browser.tabs.get(tabId);
  const value = res.result?.value;
  if (!value) {
    throw new GatewayError("eval_failed", "eval returned no result");
  }
  return {
    ...value,
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
    approval: {
      mode: approvalMode,
      approver: "local_extension_user",
      approvedAt: new Date().toISOString(),
      popup: approvalPopup,
    },
  };
}

function evalPageFunction(source: string, maxBytes: number) {
  const typeOf = (value: unknown): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof Node !== "undefined" && value instanceof Node) return "dom-node";
    return typeof value;
  };

  const seen = new WeakSet<object>();
  const sanitize = (value: unknown, depth: number): unknown => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "undefined") return { __abgType: "undefined" };
    if (typeof value === "bigint") return { __abgType: "bigint", value: String(value) };
    if (typeof value === "symbol") return { __abgType: "symbol", value: String(value) };
    if (typeof value === "function") {
      const candidate = value as { name?: string };
      return { __abgType: "function", name: candidate.name ?? "" };
    }
    if (typeof Node !== "undefined" && value instanceof Node) {
      const element = value instanceof Element ? value : undefined;
      return {
        __abgType: "dom-node",
        nodeType: value.nodeType,
        nodeName: value.nodeName,
        id: element?.id || undefined,
        className: element?.className || undefined,
        text: value.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
      };
    }
    if (typeof value !== "object" || value === null) return String(value);
    if (seen.has(value)) return { __abgType: "circular" };
    seen.add(value);
    if (depth >= 6) return { __abgType: "max-depth", type: typeOf(value) };
    if (Array.isArray(value)) {
      const items = value.slice(0, 100).map((item) => sanitize(item, depth + 1));
      if (value.length > items.length) {
        items.push({ __abgType: "truncated-items", omitted: value.length - items.length });
      }
      return items;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys.slice(0, 100)) {
      try {
        out[key] = sanitize((value as Record<string, unknown>)[key], depth + 1);
      } catch (e) {
        out[key] = {
          __abgType: "property-error",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }
    if (keys.length > 100) out.__abgTruncatedKeys = keys.length - 100;
    return out;
  };

  const run = async (): Promise<unknown> => {
    try {
      // biome-ignore lint/security/noGlobalEval: this is the explicit, user-approved eval escape hatch.
      const globalEval = globalThis.eval;
      return await globalEval(source);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as (
        body: string,
      ) => () => Promise<unknown>;
      try {
        return await AsyncFunction(`"use strict";\nreturn (${source});`)();
      } catch (expressionError) {
        if (!(expressionError instanceof SyntaxError)) throw expressionError;
      }
      return await AsyncFunction(`"use strict";\n${source}`)();
    }
  };

  return run().then((value) => {
    const sanitized = sanitize(value, 0);
    const json = JSON.stringify(sanitized);
    const jsonBytes = new TextEncoder().encode(json).byteLength;
    const summary = {
      type: typeOf(value),
      jsonBytes,
      maxBytes,
      truncated: jsonBytes > maxBytes,
    };
    if (jsonBytes > maxBytes) {
      return {
        ok: false,
        error: "result_too_large",
        message: `Eval result is ${jsonBytes} bytes, which exceeds the ${maxBytes} byte cap.`,
        resultSummary: summary,
      };
    }
    return {
      ok: true,
      value: sanitized,
      resultSummary: summary,
    };
  });
}

async function scrollTab(
  tabId: number,
  deltaX: number,
  deltaY: number,
  atX?: number,
  atY?: number,
): Promise<{ ok: true; deltaX: number; deltaY: number; x: number; y: number }> {
  await attachDebugger(tabId);
  let cursorX = atX;
  let cursorY = atY;
  if (cursorX === undefined || cursorY === undefined) {
    const layout = (await browser.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics")) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number };
    };
    const vp = layout.cssVisualViewport ?? { clientWidth: 800, clientHeight: 600 };
    cursorX = cursorX ?? vp.clientWidth / 2;
    cursorY = cursorY ?? vp.clientHeight / 2;
  }
  await browser.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: cursorX,
    y: cursorY,
    deltaX,
    deltaY,
  });
  return { ok: true, deltaX, deltaY, x: cursorX, y: cursorY };
}

async function scrollElement(
  tabId: number,
  selector: string,
  deltaX: number,
  deltaY: number,
  steps: number,
  frame?: string,
): Promise<{
  ok: boolean;
  found: boolean;
  selector: string;
  deltaX: number;
  deltaY: number;
  steps: number;
  moved?: boolean;
  movedX?: number;
  movedY?: number;
  scrolledVia?: "self" | "descendant" | "ancestor" | "none";
  warning?: string;
  scrollLeft?: number;
  scrollTop?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  clientWidth?: number;
  clientHeight?: number;
}> {
  return runFrameScript(tabId, frame, { selector, deltaX, deltaY, steps }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) {
      return {
        ok: false,
        found: false,
        selector: opts.selector,
        deltaX: opts.deltaX,
        deltaY: opts.deltaY,
        steps: opts.steps,
      } as const;
    }
    const tryScroll = (node: Element): { movedX: number; movedY: number } => {
      const beforeLeft = node.scrollLeft;
      const beforeTop = node.scrollTop;
      for (let i = 0; i < opts.steps; i += 1) {
        node.scrollBy({ left: opts.deltaX, top: opts.deltaY, behavior: "auto" });
      }
      return { movedX: node.scrollLeft - beforeLeft, movedY: node.scrollTop - beforeTop };
    };
    // Custom scroller UIs (virtualized lists, scrollbar-hider wrappers) often match
    // a selector whose own scrollBy is a no-op. Measure the movement, and when the
    // matched element does not move, retry on its most scrollable descendant, then
    // on ancestors, so the reported movement reflects what the user actually sees.
    let target: Element = el;
    let via: "self" | "descendant" | "ancestor" = "self";
    let moved = tryScroll(el);
    const wantsMovement = opts.deltaX !== 0 || opts.deltaY !== 0;
    if (moved.movedX === 0 && moved.movedY === 0 && wantsMovement) {
      let best: Element | null = null;
      let bestOverflow = 0;
      const walk = (node: Element, depth: number): void => {
        if (depth > 8) return;
        for (const child of Array.from(node.children)) {
          const overflow =
            Math.max(0, child.scrollHeight - child.clientHeight) +
            Math.max(0, child.scrollWidth - child.clientWidth);
          if (overflow > bestOverflow) {
            best = child;
            bestOverflow = overflow;
          }
          walk(child, depth + 1);
        }
      };
      walk(el, 0);
      if (best) {
        const attempt = tryScroll(best);
        if (attempt.movedX !== 0 || attempt.movedY !== 0) {
          moved = attempt;
          target = best;
          via = "descendant";
        }
      }
      if (moved.movedX === 0 && moved.movedY === 0) {
        let parent = el.parentElement;
        while (parent) {
          const attempt = tryScroll(parent);
          if (attempt.movedX !== 0 || attempt.movedY !== 0) {
            moved = attempt;
            target = parent;
            via = "ancestor";
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    const didMove = moved.movedX !== 0 || moved.movedY !== 0;
    const result: {
      ok: boolean;
      found: boolean;
      selector: string;
      deltaX: number;
      deltaY: number;
      steps: number;
      moved: boolean;
      movedX: number;
      movedY: number;
      scrolledVia: "self" | "descendant" | "ancestor" | "none";
      warning?: string;
      scrollLeft: number;
      scrollTop: number;
      scrollWidth: number;
      scrollHeight: number;
      clientWidth: number;
      clientHeight: number;
    } = {
      ok: true,
      found: true,
      selector: opts.selector,
      deltaX: opts.deltaX,
      deltaY: opts.deltaY,
      steps: opts.steps,
      moved: didMove,
      movedX: moved.movedX,
      movedY: moved.movedY,
      scrolledVia: didMove ? via : "none",
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
      scrollWidth: target.scrollWidth,
      scrollHeight: target.scrollHeight,
      clientWidth: target.clientWidth,
      clientHeight: target.clientHeight,
    };
    if (!didMove && wantsMovement) {
      result.warning =
        "selector matched but nothing scrolled; the target may own a custom wheel handler — try coordinate scroll (--at-x/--at-y inside the pane) or a more specific scroller selector";
    }
    return result;
  });
}

async function scrollElementIntoView(
  tabId: number,
  selector: string,
  frame?: string,
): Promise<{
  ok: boolean;
  found: boolean;
  selector: string;
  box?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}> {
  return runFrameScript(tabId, frame, { selector }, (ctx, opts) => {
    const el = ctx.query(opts.selector) as HTMLElement | null;
    if (!el) return { ok: false, found: false, selector: opts.selector } as const;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= ctx.win.innerHeight &&
      rect.left <= ctx.win.innerWidth;
    return {
      ok: true,
      found: true,
      selector: opts.selector,
      frame: ctx.frame,
      box: {
        x: Math.round(ctx.offsetX + rect.left),
        y: Math.round(ctx.offsetY + rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      visible,
    } as const;
  });
}

// ---------- Popup messaging ----------

browser.runtime.onMessage.addListener((rawMsg: unknown, sender, sendResponse) => {
  (async () => {
    if (isRecord(rawMsg) && rawMsg.type === "stream_dom_mutation" && sender.tab?.id) {
      emitStreamEvent(sender.tab.id, {
        kind: "dom_mutation",
        count: typeof rawMsg.count === "number" ? rawMsg.count : 0,
        url: typeof rawMsg.url === "string" ? rawMsg.url : undefined,
        title: typeof rawMsg.title === "string" ? rawMsg.title : undefined,
      });
      sendResponse({ type: "ok" });
      return;
    }
    if (
      isRecord(rawMsg) &&
      typeof rawMsg.type === "string" &&
      rawMsg.type.startsWith("abg_offscreen_")
    ) {
      handleOffscreenEvent(rawMsg);
      sendResponse({ type: "ok" });
      return;
    }
    const msg = parseRuntimeMessage(rawMsg);
    if (!msg) {
      const reply: RuntimeResponse = { type: "error", message: "unknown message" };
      sendResponse(reply);
      return;
    }
    sendResponse(await handleRuntimeMessage(msg));
  })().catch((e) => {
    const reply: RuntimeResponse = {
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    };
    sendResponse(reply);
  });
  return true; // async response
});

async function handleRuntimeMessage(msg: RuntimeMessage): Promise<RuntimeResponse> {
  if (msg.type === "get_state") {
    await reconcileAllTabsAccess();
    const [activeTab, incognitoAccessAllowed, allTabsAccess] = await Promise.all([
      browser.tabs.get(msg.tabId).catch(() => undefined),
      isIncognitoAccessAllowed(),
      allTabsAccessState(),
    ]);
    const sharedTabs: { tabId: number; title: string; url: string; accessMode: TabAccessMode }[] =
      [];
    for (const [tabId, p] of permittedTabs) {
      sharedTabs.push({ tabId, title: p.title, url: p.url, accessMode: p.accessMode });
    }
    const annotationState = permittedTabs.has(msg.tabId)
      ? await manageAnnotationMode(msg.tabId, { action: "list" }).catch(() => ({
          ok: true as const,
          enabled: false,
          count: 0,
          annotations: [],
        }))
      : { ok: true as const, enabled: false, count: 0, annotations: [] };
    return {
      type: "state",
      permitted: permittedTabs.has(msg.tabId),
      wsConnected,
      activeTab: {
        incognito: activeTab?.incognito === true,
        incognitoAccessAllowed,
      },
      sharedTabs,
      allTabsAccess,
      personalDataAccess: await personalDataAccessState(),
      settings: await getSettings(),
      annotationState: {
        enabled: annotationState.enabled,
        count: annotationState.count,
      },
    };
  }
  if (msg.type === "permit") {
    await permitTab(msg.tabId);
    return { type: "ok" };
  }
  if (msg.type === "revoke") {
    await revokeTab(msg.tabId, "user_revoked");
    return { type: "ok" };
  }
  if (msg.type === "set_operations_require_approval") {
    await setOperationsRequireApproval(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_eval_enabled") {
    await setEvalEnabled(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_trusted_automation_enabled") {
    await setTrustedAutomationEnabled(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_profile_label") {
    await setProfileLabel(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_gateway_websocket_url") {
    await setGatewayWebSocketUrl(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_all_tabs_access") {
    await setAllTabsAccessEnabled(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_bookmarks_access") {
    await setBookmarksAccessEnabled(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_reading_list_access") {
    await setReadingListAccessEnabled(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_personal_data_mutations") {
    const current = await getSettings();
    await browser.storage.local.set({ ...current, personalDataMutationsEnabled: msg.value });
    return { type: "ok" };
  }
  if (msg.type === "annotation_action") {
    if (!permittedTabs.has(msg.tabId)) {
      return { type: "error", message: "tab is not shared with ABG" };
    }
    await attachDebugger(msg.tabId);
    await manageAnnotationMode(msg.tabId, { action: msg.action });
    return { type: "ok" };
  }
  if (msg.type === "get_approval_request") {
    const pending = pendingApprovals.get(msg.approvalId);
    if (!pending) {
      return { type: "error", message: "approval request not found" };
    }
    return { type: "approval_request", request: pending.request };
  }
  const resolved = finalizeApproval(
    msg.approvalId,
    resolutionForDecision(msg.decision, msg.streamId),
  );
  if (!resolved) {
    return { type: "error", message: "approval request not found" };
  }
  return { type: "ok" };
}

function parseRuntimeMessage(rawMsg: unknown): RuntimeMessage | null {
  if (!isRecord(rawMsg) || typeof rawMsg.type !== "string") return null;
  if (rawMsg.type === "get_state" && typeof rawMsg.tabId === "number") {
    return { type: "get_state", tabId: rawMsg.tabId };
  }
  if (rawMsg.type === "permit" && typeof rawMsg.tabId === "number") {
    return { type: "permit", tabId: rawMsg.tabId };
  }
  if (rawMsg.type === "revoke" && typeof rawMsg.tabId === "number") {
    return { type: "revoke", tabId: rawMsg.tabId };
  }
  if (rawMsg.type === "set_operations_require_approval" && typeof rawMsg.value === "boolean") {
    return { type: "set_operations_require_approval", value: rawMsg.value };
  }
  if (rawMsg.type === "set_eval_enabled" && typeof rawMsg.value === "boolean") {
    return { type: "set_eval_enabled", value: rawMsg.value };
  }
  if (rawMsg.type === "set_trusted_automation_enabled" && typeof rawMsg.value === "boolean") {
    return { type: "set_trusted_automation_enabled", value: rawMsg.value };
  }
  if (rawMsg.type === "set_profile_label" && typeof rawMsg.value === "string") {
    return { type: "set_profile_label", value: rawMsg.value };
  }
  if (rawMsg.type === "set_gateway_websocket_url" && typeof rawMsg.value === "string") {
    return { type: "set_gateway_websocket_url", value: rawMsg.value };
  }
  if (rawMsg.type === "set_all_tabs_access" && typeof rawMsg.value === "boolean") {
    return { type: "set_all_tabs_access", value: rawMsg.value };
  }
  if (rawMsg.type === "set_bookmarks_access" && typeof rawMsg.value === "boolean") {
    return { type: "set_bookmarks_access", value: rawMsg.value };
  }
  if (rawMsg.type === "set_reading_list_access" && typeof rawMsg.value === "boolean") {
    return { type: "set_reading_list_access", value: rawMsg.value };
  }
  if (
    rawMsg.type === "annotation_action" &&
    typeof rawMsg.tabId === "number" &&
    isAnnotationAction(rawMsg.action)
  ) {
    return { type: "annotation_action", tabId: rawMsg.tabId, action: rawMsg.action };
  }
  if (rawMsg.type === "get_approval_request" && typeof rawMsg.approvalId === "string") {
    return { type: "get_approval_request", approvalId: rawMsg.approvalId };
  }
  if (
    rawMsg.type === "approval_decision" &&
    typeof rawMsg.approvalId === "string" &&
    isApprovalDecision(rawMsg.decision)
  ) {
    return {
      type: "approval_decision",
      approvalId: rawMsg.approvalId,
      decision: rawMsg.decision,
      streamId: typeof rawMsg.streamId === "string" ? rawMsg.streamId : undefined,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === "allow" || value === "deny" || value === "timeout";
}

function isAnnotationAction(value: unknown): value is AnnotationAction {
  return (
    value === "start" ||
    value === "stop" ||
    value === "clear" ||
    value === "list" ||
    value === "add_region" ||
    value === "add_selector"
  );
}

function readAnnotationCommand(params: GatewayCommand["params"] | undefined): AnnotationCommand {
  const action = isAnnotationAction(params?.action) ? params.action : "list";
  return {
    action,
    selector: typeof params?.selector === "string" ? params.selector : undefined,
    comment: typeof params?.comment === "string" ? params.comment : undefined,
    x: typeof params?.x === "number" ? params.x : undefined,
    y: typeof params?.y === "number" ? params.y : undefined,
    width: typeof params?.width === "number" ? params.width : undefined,
    height: typeof params?.height === "number" ? params.height : undefined,
  };
}
