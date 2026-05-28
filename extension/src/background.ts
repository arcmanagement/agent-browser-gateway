import { type AnnotationCommand, manageAnnotationMode } from "./annotationOverlay.js";
import type {
  AnnotationAction,
  ApprovalDecision,
  ApprovalMethod,
  ApprovalRequest,
  ApprovalToBackground,
  BackgroundToApproval,
  BackgroundToPopup,
  ConsoleEntry,
  ExtensionSettings,
  ExtToGateway,
  GatewayCommand,
  OperationMethod,
  PopupToBackground,
  TabAccessMode,
} from "./types.js";

const WS_URL = "ws://127.0.0.1:8765/ws";
const VERSION = "0.3.10";
const ALL_URLS_ORIGINS = ["<all_urls>"];
const HEARTBEAT_PERIOD_MIN = 0.5; // 30s — Chrome 117+ minimum, anything lower is silently dropped
const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_WINDOW_FALLBACK_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + 2_000;
const EVAL_DEFAULT_MAX_BYTES = 64 * 1024;
const EVAL_HARD_MAX_BYTES = 256 * 1024;
const DEFAULT_SETTINGS: ExtensionSettings = {
  operationsRequireApproval: true,
  evalEnabled: false,
  profileLabel: "",
  allTabsAccessEnabled: false,
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
  "clear",
  "replace_dom",
  "upload_file",
  "type_text",
  "key_press",
  "key_down",
  "key_up",
  "keyboard_insert_text",
  "navigate",
  "scroll",
  "scroll_into_view",
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

type Point = { x: number; y: number };

type ApprovalResolution = {
  decision: ApprovalDecision;
  message: string;
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

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

const permittedTabs = new Map<number, PermittedTab>();
const consoleBuffers = new Map<number, ConsoleEntry[]>();
const networkBuffers = new Map<number, NetworkEntry[]>();
const activeNetworkRequests = new Map<number, Set<string>>();
const snapshotRefCache = new Map<number, Map<string, string>>();
const attachedTabs = new Set<number>();
const streamingTabs = new Set<number>();
const pendingApprovals = new Map<string, PendingApproval>();

let extensionId: string | null = null;
let ws: WebSocket | null = null;
let wsConnected = false;
let reconnectTimer: number | null = null;

// ---------- Bootstrap ----------

(async () => {
  extensionId = await getOrCreateExtensionId();
  await ensureSettingsStored();
  await restoreState();
  await reconcileAllTabsAccess();
  ensureWS();
})();

chrome.runtime.onInstalled.addListener(async () => {
  extensionId = await getOrCreateExtensionId();
  await ensureSettingsStored();
});

chrome.runtime.onStartup.addListener(async () => {
  extensionId = await getOrCreateExtensionId();
  await ensureSettingsStored();
  await restoreState();
  await reconcileAllTabsAccess();
  ensureWS();
});

// Keep service worker warm
chrome.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_PERIOD_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") {
    ensureWS();
  }
});

// ---------- Identity ----------

async function getOrCreateExtensionId(): Promise<string> {
  const stored = await chrome.storage.local.get("extensionId");
  if (typeof stored.extensionId === "string") return stored.extensionId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ extensionId: id });
  return id;
}

// ---------- Persistent settings ----------

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get([
    "operationsRequireApproval",
    "evalEnabled",
    "profileLabel",
    "allTabsAccessEnabled",
  ]);
  const operationsRequireApproval =
    typeof stored.operationsRequireApproval === "boolean"
      ? stored.operationsRequireApproval
      : DEFAULT_SETTINGS.operationsRequireApproval;
  const evalEnabled =
    typeof stored.evalEnabled === "boolean" ? stored.evalEnabled : DEFAULT_SETTINGS.evalEnabled;
  const profileLabel =
    typeof stored.profileLabel === "string" ? stored.profileLabel : DEFAULT_SETTINGS.profileLabel;
  const allTabsAccessEnabled =
    typeof stored.allTabsAccessEnabled === "boolean"
      ? stored.allTabsAccessEnabled
      : DEFAULT_SETTINGS.allTabsAccessEnabled;
  if (
    typeof stored.operationsRequireApproval !== "boolean" ||
    typeof stored.evalEnabled !== "boolean" ||
    typeof stored.profileLabel !== "string" ||
    typeof stored.allTabsAccessEnabled !== "boolean"
  ) {
    await chrome.storage.local.set({
      operationsRequireApproval,
      evalEnabled,
      profileLabel,
      allTabsAccessEnabled,
    });
  }
  return { operationsRequireApproval, evalEnabled, profileLabel, allTabsAccessEnabled };
}

async function ensureSettingsStored(): Promise<void> {
  await getSettings();
}

async function setOperationsRequireApproval(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, operationsRequireApproval: value };
  await chrome.storage.local.set(settings);
  return settings;
}

async function setEvalEnabled(value: boolean): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings: ExtensionSettings = { ...current, evalEnabled: value };
  await chrome.storage.local.set(settings);
  return settings;
}

async function setProfileLabel(value: string): Promise<ExtensionSettings> {
  const current = await getSettings();
  const trimmed = value.trim();
  const settings: ExtensionSettings = { ...current, profileLabel: trimmed };
  await chrome.storage.local.set(settings);
  // Re-introduce ourselves to the Gateway with the new label
  if (extensionId) {
    sendWS({
      type: "hello",
      extensionId,
      version: VERSION,
      profileLabel: trimmed || undefined,
      browserKind: detectBrowserKind(),
    });
  }
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
  await chrome.storage.local.set(settings);
  if (value) {
    await syncAllTabsAccess({ emit: true });
  } else {
    await revokeAllTabsEntries("all_tabs_disabled");
  }
  return settings;
}

async function hasAllUrlsPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: ALL_URLS_ORIGINS });
  } catch {
    return false;
  }
}

async function isAllTabsAccessActive(): Promise<boolean> {
  const settings = await getSettings();
  return settings.allTabsAccessEnabled && (await hasAllUrlsPermission());
}

async function isIncognitoAccessAllowed(): Promise<boolean> {
  try {
    return await chrome.extension.isAllowedIncognitoAccess();
  } catch {
    return false;
  }
}

function detectBrowserKind(): string {
  // Lightweight UA sniff. We send this purely as a label for the Gateway UI;
  // it is not used for any security decision.
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Brave/.test(ua)) return "brave";
  if (/Chrome\//.test(ua)) return "chrome";
  return "browser";
}

// ---------- State persistence (session: cleared on browser restart) ----------

async function saveState(): Promise<void> {
  const obj: Record<string, PermittedTab> = {};
  for (const [k, v] of permittedTabs) obj[String(k)] = v;
  await chrome.storage.session.set({ permittedTabs: obj });
}

async function restoreState(): Promise<void> {
  const stored = await chrome.storage.session.get("permittedTabs");
  const obj = stored.permittedTabs as Record<string, PermittedTab> | undefined;
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    permittedTabs.set(Number(k), { ...v, accessMode: v.accessMode ?? "manual" });
  }
}

// ---------- WebSocket ----------

function ensureWS(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn("[ABG] WS construct failed", e);
    scheduleReconnect();
    return;
  }
  ws.addEventListener("open", async () => {
    wsConnected = true;
    const { profileLabel } = await getSettings();
    sendWS({
      type: "hello",
      extensionId: extensionId ?? "?",
      version: VERSION,
      profileLabel: profileLabel || undefined,
      browserKind: detectBrowserKind(),
    });
    await reconcileAllTabsAccess({ emit: false });
    // Re-send all currently permitted tabs so Gateway is in sync
    for (const [tabId, p] of permittedTabs) {
      sendTabPermitted(tabId, p);
    }
  });
  ws.addEventListener("message", (ev) => {
    try {
      const cmd = JSON.parse(ev.data) as GatewayCommand;
      handleGatewayCommand(cmd);
    } catch (e) {
      console.warn("[ABG] WS message parse error", e);
    }
  });
  ws.addEventListener("close", () => {
    wsConnected = false;
    ws = null;
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    wsConnected = false;
    try {
      ws?.close();
    } catch {}
    ws = null;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureWS();
  }, 3000) as unknown as number;
}

function sendWS(msg: ExtToGateway): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
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

function isShareableTabUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

function originForUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
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
  const tabs = await chrome.tabs.query({});
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
    chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]),
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

async function upsertAllTabsEntry(tab: chrome.tabs.Tab, emit: boolean): Promise<void> {
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
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("tab has no URL");
  if (tab.incognito && !(await isIncognitoAccessAllowed())) {
    throw new GatewayError(
      "incognito_access_disabled",
      `Chrome has not allowed Agent Browser Gateway to run in incognito windows. Open chrome://extensions/?id=${chrome.runtime.id} and enable "Allow in incognito".`,
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
  streamingTabs.delete(tabId);
  await saveState();
  sendWS({ type: "tab_revoked", tabId, reason });
  await detachDebugger(tabId);
  await updateBadge(tabId);
}

async function updateBadge(tabId: number): Promise<void> {
  const tab = permittedTabs.get(tabId);
  try {
    await chrome.action.setBadgeText({
      tabId,
      text: tab ? (tab.accessMode === "all_tabs" ? "ALL" : "ON") : "",
    });
    if (tab) {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: tab.accessMode === "all_tabs" ? "#0a84ff" : "#34c759",
      });
    }
  } catch {}
}

// ---------- Tab lifecycle hooks ----------

chrome.tabs.onCreated.addListener(async (tab) => {
  if ((await isAllTabsAccessActive()) && isShareableTabUrl(tab.url)) {
    await upsertAllTabsEntry(tab, true);
    await saveState();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (permittedTabs.has(tabId)) {
    permittedTabs.delete(tabId);
    consoleBuffers.delete(tabId);
    networkBuffers.delete(tabId);
    streamingTabs.delete(tabId);
    await saveState();
    sendWS({ type: "tab_closed", tabId });
    await detachDebugger(tabId);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateBadge(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
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
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    attachedTabs.add(tabId);
  } catch (e) {
    console.warn("[ABG] debugger.attach failed", e);
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
  attachedTabs.delete(tabId);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
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

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

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
    if (cmd.method === "read_dom") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await readDom(tabId, cmd.params?.selector);
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
      reply(cmd.id, await extractTables(tabId, cmd.params?.selector));
    } else if (cmd.method === "describe") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await describeElements(tabId, cmd.params ?? {}));
    } else if (cmd.method === "network_log") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await getNetworkLog(tabId, cmd.params ?? {}));
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
    } else if (cmd.method === "revoke") {
      if (!tabId) throw new Error("tabId required");
      await revokeTab(tabId, "gateway_revoke");
      reply(cmd.id, { ok: true });
    } else if (isOperationCommand(cmd)) {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await runApprovedOperation(cmd, tabId));
    } else {
      replyError(cmd.id, "unknown_method", String(cmd.method));
    }
  } catch (e) {
    if (e instanceof GatewayError) {
      replyError(cmd.id, e.code, e.message);
    } else {
      replyError(cmd.id, "command_failed", e instanceof Error ? e.message : String(e));
    }
  }
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
  if (cmd.method === "click_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Click the element matching selector ${quoteForIntent(selector)}.`,
      run: () => clickSelector(tabId, selector),
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
      intent: `Double-click the element matching selector ${quoteForIntent(selector)}.`,
      run: () => doubleClickSelector(tabId, selector),
    };
  }
  if (cmd.method === "focus_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Focus the element matching selector ${quoteForIntent(selector)} without clicking it.`,
      run: () => focusElement(tabId, selector),
    };
  }
  if (cmd.method === "hover_selector") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Move the mouse over the element matching selector ${quoteForIntent(selector)}.`,
      run: () => hoverSelector(tabId, selector),
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
      intent: `Select an option in ${quoteForIntent(selector)}.`,
      run: () => selectOption(tabId, selector, { value, label }),
    };
  }
  if (cmd.method === "set_checked") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    const checked = cmd.params?.checked;
    if (typeof checked !== "boolean") throw new Error("checked boolean required");
    return {
      intent: `${checked ? "Check" : "Uncheck"} the input matching selector ${quoteForIntent(selector)} if needed.`,
      run: () => setChecked(tabId, selector, checked),
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
    return {
      intent: dryRun
        ? `Preview editable replacement for selector ${quoteForIntent(selector)}.`
        : `Fill ${quoteForIntent(value)} into the editable target matching selector ${quoteForIntent(selector)}.`,
      run: () => fillField(tabId, selector, value, dryRun),
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
      intent: `Paste ${new TextEncoder().encode(value).byteLength} bytes into the editable element matching selector ${quoteForIntent(selector)}.`,
      run: () => pasteText(tabId, selector, value),
    };
  }
  if (cmd.method === "clear") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Clear the editable element matching selector ${quoteForIntent(selector)}.`,
      run: () => clearEditable(tabId, selector),
    };
  }
  if (cmd.method === "replace_dom") {
    const selector = cmd.params?.selector;
    const html = cmd.params?.html;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    if (typeof html !== "string" || html.length === 0) throw new Error("html required");
    return {
      intent: `Replace the element matching selector ${quoteForIntent(selector)} with provided HTML.`,
      run: () => replaceDom(tabId, selector, html),
    };
  }
  if (cmd.method === "upload_file") {
    const selector = cmd.params?.selector;
    const file = cmd.params?.file;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    if (typeof file !== "string" || file.length === 0) throw new Error("file required");
    return {
      intent: `Attach local file ${quoteForIntent(file)} to file input ${quoteForIntent(selector)}.`,
      run: () => uploadFile(tabId, selector, file),
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
        await chrome.tabs.update(tabId, { url });
        return { ok: true, note: "navigation may revoke permission if origin changes" };
      },
    };
  }
  if (cmd.method === "drag") {
    const from = readDragPoint(cmd.params, "from");
    const to = readDragPoint(cmd.params, "to");
    const steps =
      typeof cmd.params?.steps === "number" ? Math.max(1, Math.min(100, cmd.params.steps)) : 12;
    return {
      intent: `Drag from ${describeDragPoint(from)} to ${describeDragPoint(to)}.`,
      run: () => drag(tabId, from, to, steps),
    };
  }
  if (cmd.method === "scroll_into_view") {
    const selector = cmd.params?.selector;
    if (typeof selector !== "string" || selector.length === 0) throw new Error("selector required");
    return {
      intent: `Scroll the element matching selector ${quoteForIntent(selector)} into view.`,
      run: () => scrollElementIntoView(tabId, selector),
    };
  }
  const deltaX = cmd.params?.deltaX ?? 0;
  const deltaY = cmd.params?.deltaY ?? 0;
  if (typeof deltaX !== "number" || typeof deltaY !== "number") {
    throw new Error("deltaX and deltaY must be numbers");
  }
  const atX = typeof cmd.params?.atX === "number" ? cmd.params.atX : undefined;
  const atY = typeof cmd.params?.atY === "number" ? cmd.params.atY : undefined;
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
    const approvalUrl = new URL(chrome.runtime.getURL("approval.html"));
    approvalUrl.searchParams.set("id", request.id);
    const approvalWindow = await chrome.windows.create({
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
    const tab = await chrome.tabs.get(tabId);
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
    chrome.windows.remove(pending.windowId).catch(() => {});
  }
  pending.resolve(resolution);
  return true;
}

function resolutionForDecision(decision: ApprovalDecision): ApprovalResolution {
  if (decision === "allow") {
    return {
      decision,
      message: "Operation approved.",
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

function reply(id: string, result: unknown): void {
  sendWS({ type: "response", id, result });
}

function replyError(id: string, code: string, message: string): void {
  sendWS({ type: "response", id, error: { code, message } });
}

type DomReadResult = {
  url: string;
  title: string;
  origin: string;
  selector?: string;
  text: string;
  html?: string;
  markdown?: string;
  found?: boolean;
};

async function readDom(tabId: number, selector: string | undefined): Promise<DomReadResult> {
  await attachDebugger(tabId);
  const pageFn = (sel: string | null) => {
    const root: Element | null = sel ? document.querySelector(sel) : document.documentElement;
    if (sel && !root) {
      return {
        url: location.href,
        title: document.title,
        origin: location.origin,
        selector: sel,
        found: false,
        text: "",
      } as const;
    }
    const target = root ?? document.documentElement;
    const isElementWithInnerText = (el: unknown): el is HTMLElement =>
      typeof (el as HTMLElement).innerText === "string";
    const text = isElementWithInnerText(target) ? target.innerText : (target.textContent ?? "");
    return {
      url: location.href,
      title: document.title,
      origin: location.origin,
      selector: sel ?? undefined,
      found: sel ? true : undefined,
      text,
      html: (target as Element).outerHTML,
    } as const;
  };

  const expression = `(${pageFn.toString()})(${JSON.stringify(selector ?? null)})`;
  const res = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: { value?: DomReadResult };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  if (res.exceptionDetails) {
    throw new Error(
      `read_dom failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
    );
  }
  return res.result?.value ?? { url: "", title: "", origin: "", text: "" };
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
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (
      getter: string,
      sel: string | undefined,
      attrName: string | undefined,
      styleProps: string[] | undefined,
    ) => {
      const selected = sel ? Array.from(document.querySelectorAll(sel)) : [];
      const first = selected[0] as HTMLElement | undefined;
      const textOf = (el: Element): string =>
        ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
      const boxOf = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const base = {
        kind: getter,
        selector: sel,
        url: location.href,
        title: document.title,
      };
      if (getter === "title") return { ...base, value: document.title };
      if (getter === "url") return { ...base, value: location.href };
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
    },
    args: [kind, selector, name, props],
  });
  return res?.result ?? { kind, selector, found: false };
}

async function getPredicate(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{ kind: string; selector?: string; found: boolean; value: boolean }> {
  const kind = typeof params.kind === "string" ? params.kind : "";
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (predicate: string, sel: string | undefined) => {
      const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
      const base = { kind: predicate, selector: sel, found: !!el };
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
    },
    args: [kind, selector],
  });
  return res?.result ?? { kind, selector, found: false, value: false };
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
  const [res] = await chrome.scripting.executeScript({
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
  const allMatches = await findSemanticMatches(tabId, { locator, query, role, exact, limit });
  const matches = applyFindIndexModifier(allMatches, indexModifier, index);
  if (action === "inspect") {
    return {
      locator,
      query,
      role,
      exact,
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
    `Run find action ${quoteForIntent(action)} on ${quoteForIntent(first.selector)}.`,
  );

  if (action === "click")
    return { action, match: first, result: await clickSelector(tabId, first.selector) };
  if (action === "fill") {
    const value = typeof params.value === "string" ? params.value : "";
    return { action, match: first, result: await fillField(tabId, first.selector, value, false) };
  }
  if (action === "type") {
    const value = typeof params.value === "string" ? params.value : "";
    await focusElement(tabId, first.selector);
    return { action, match: first, result: await typeText(tabId, value) };
  }
  if (action === "hover")
    return { action, match: first, result: await hoverSelector(tabId, first.selector) };
  if (action === "focus")
    return { action, match: first, result: await focusElement(tabId, first.selector) };
  if (action === "check")
    return { action, match: first, result: await setChecked(tabId, first.selector, true) };
  if (action === "uncheck")
    return { action, match: first, result: await setChecked(tabId, first.selector, false) };
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
  params: { locator: string; query: string; role?: string; exact: boolean; limit: number },
): Promise<FindMatch[]> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts: {
      locator: string;
      query: string;
      role?: string;
      exact: boolean;
      limit: number;
    }) => {
      type LocalMatch = {
        index: number;
        selector: string;
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
        if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) {
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
            if (document.querySelectorAll(selector).length === 1) return selector;
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
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const pushMatch = (matches: LocalMatch[], el: Element): void => {
        if (matches.some((match) => document.querySelector(match.selector) === el)) return;
        matches.push({
          index: matches.length,
          selector: selectorFor(el),
          tag: el.tagName.toLowerCase(),
          role: roleOf(el),
          text: textOf(el),
          value: (el as HTMLInputElement).value,
          box: boxOf(el),
        });
      };

      const matches: LocalMatch[] = [];
      if (opts.locator === "css") {
        for (const el of Array.from(document.querySelectorAll(opts.query))) {
          pushMatch(matches, el);
          if (matches.length >= opts.limit) break;
        }
        return matches;
      }
      if (opts.locator === "label") {
        for (const label of Array.from(document.querySelectorAll("label"))) {
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
        document.querySelectorAll(
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
    args: [params],
  });
  return (res?.result ?? []) as FindMatch[];
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
  const depth = typeof params.depth === "number" ? Math.max(1, Math.min(12, params.depth)) : 5;
  const interactiveOnly = params.interactiveOnly === true;
  const compact = params.compact === true;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts: {
      selector?: string;
      depth: number;
      interactiveOnly: boolean;
      compact: boolean;
    }) => {
      type SnapshotElement = {
        ref: string;
        role: string;
        name: string;
        text: string;
        selector: string;
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
        if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) {
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
            if (document.querySelectorAll(selector).length === 1) return selector;
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
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const root = opts.selector ? document.querySelector(opts.selector) : document.body;
      if (!root) {
        return {
          url: location.href,
          title: document.title,
          selector: opts.selector,
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
      const candidates = Array.from(root.querySelectorAll(query));
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
          box: boxOf(el),
          interactive,
        });
        if (elements.length >= 250) break;
      }
      return {
        url: location.href,
        title: document.title,
        selector: opts.selector,
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
    args: [{ selector, depth, interactiveOnly, compact }],
  });
  const result = res?.result as
    | { refMap?: Record<string, string>; elements?: unknown[] }
    | undefined;
  const refMap = new Map<string, string>();
  for (const [ref, resolvedSelector] of Object.entries(result?.refMap ?? {})) {
    refMap.set(ref, resolvedSelector);
  }
  snapshotRefCache.set(tabId, refMap);
  if (result && "refMap" in result) {
    delete result.refMap;
  }
  return result ?? { found: false, elements: [] };
}

async function clickSnapshotRef(tabId: number, ref: string): Promise<unknown> {
  const selector = snapshotRefCache.get(tabId)?.get(ref);
  if (!selector) {
    throw new GatewayError("snapshot_ref_not_found", `snapshot ref not found or stale: ${ref}`);
  }
  return clickSelector(tabId, selector);
}

async function screenshot(
  tabId: number,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<{ dataUrl: string }> {
  await attachDebugger(tabId);
  const params: Record<string, unknown> = { format: "png" };
  if (clip) {
    params.clip = { ...clip, scale: 1 };
  }
  const result = (await chrome.debugger.sendCommand(
    { tabId },
    "Page.captureScreenshot",
    params,
  )) as {
    data: string;
  };
  return { dataUrl: `data:image/png;base64,${result.data}` };
}

async function printPagePDF(
  tabId: number,
): Promise<{ dataUrl: string; url: string; title: string }> {
  await attachDebugger(tabId);
  const tab = await chrome.tabs.get(tabId);
  const result = (await chrome.debugger.sendCommand({ tabId }, "Page.printToPDF", {
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
  await chrome.scripting.executeScript({
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
            chrome.runtime.sendMessage({
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
): Promise<{
  url: string;
  title: string;
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
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel?: string) => {
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
      const root = sel ? document.querySelector(sel) : document;
      const tableElements =
        root instanceof HTMLTableElement
          ? [root]
          : Array.from((root ?? document).querySelectorAll("table"));
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
          headers.length > 0 &&
          rows.length > 0 &&
          rows[0]?.join("\u0000") === headers.join("\u0000")
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
        url: location.href,
        title: document.title,
        selector: sel,
        tables,
        userMessage:
          tables.length === 0
            ? "table が見つかりませんでした。`abg read --selector` または `abg screenshot` で画面構造を確認してください。"
            : undefined,
        nextCommand:
          tables.length === 0 ? 'abg read <tab> --selector "main" --format markdown' : undefined,
      };
    },
    args: [selector],
  });
  return res?.result ?? { url: "", title: "", selector, tables: [] };
}

async function describeElements(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<{
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: unknown[];
}> {
  const all = params.all === true;
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(500, params.limit)) : 80;
  const kindFilter = typeof params.kind === "string" ? params.kind.toLowerCase() : undefined;
  const grid = typeof params.grid === "string" ? params.grid : undefined;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts: { all: boolean; limit: number; kindFilter?: string; grid?: string }) => {
      const cssEscape = (value: string): string => {
        const escaper = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } })
          .CSS?.escape;
        return escaper ? escaper(value) : value.replace(/["\\]/g, "\\$&");
      };
      const trimText = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 160);
      const selectorFor = (el: Element): string => {
        if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) {
          return `#${cssEscape(el.id)}`;
        }
        for (const attr of ["data-testid", "data-test", "name", "aria-label"]) {
          const value = el.getAttribute(attr);
          if (value) {
            const selector = `${el.tagName.toLowerCase()}[${attr}="${cssEscape(value)}"]`;
            if (document.querySelectorAll(selector).length === 1) return selector;
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
        rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
      const candidates = Array.from(
        document.querySelectorAll(
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
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          selector: selectorFor(el),
        });
        if (elements.length >= opts.limit) break;
      }
      const match = opts.grid?.match(/^(\d+)x(\d+)$/i);
      if (match) {
        const cols = Math.max(1, Math.min(50, Number(match[1])));
        const rows = Math.max(1, Math.min(50, Number(match[2])));
        const cellW = innerWidth / cols;
        const cellH = innerHeight / rows;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            elements.push({
              id: elements.length,
              kind: "grid-cell",
              text: `r${row + 1}c${col + 1}`,
              bbox: {
                x: Math.round(col * cellW),
                y: Math.round(row * cellH),
                w: Math.round(cellW),
                h: Math.round(cellH),
              },
            });
          }
        }
      }
      return {
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        elements,
      };
    },
    args: [{ all, limit, kindFilter, grid }],
  });
  return res?.result ?? { url: "", title: "", viewport: { width: 0, height: 0 }, elements: [] };
}

async function getNetworkLog(
  tabId: number,
  params: NonNullable<GatewayCommand["params"]>,
): Promise<unknown> {
  await attachDebugger(tabId);
  if (params.body === true && typeof params.requestId === "string") {
    const result = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
      requestId: params.requestId,
    })) as { body: string; base64Encoded: boolean };
    return { requestId: params.requestId, ...result };
  }
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : undefined;
  const method = typeof params.method === "string" ? params.method.toUpperCase() : undefined;
  const statusMin = typeof params.statusMin === "number" ? params.statusMin : undefined;
  const typeSet =
    typeof params.type === "string"
      ? new Set(
          params.type
            .split(",")
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean),
        )
      : undefined;
  const limit = typeof params.limit === "number" ? Math.max(1, Math.min(200, params.limit)) : 100;
  const items = (networkBuffers.get(tabId) ?? [])
    .filter((entry) => {
      if (urlPattern && !globMatch(urlPattern, entry.url)) return false;
      if (method && entry.method.toUpperCase() !== method) return false;
      if (statusMin !== undefined && (entry.status ?? 0) < statusMin) return false;
      if (typeSet && entry.type && !typeSet.has(entry.type)) return false;
      if (typeSet && !entry.type) return false;
      return true;
    })
    .slice(-limit)
    .map(({ startTime: _startTime, ...entry }) => entry);
  return { requests: items };
}

// ---------- Operation tools (v0.1.1) ----------

async function clickSelector(
  tabId: number,
  selector: string,
): Promise<{ found: boolean; tag?: string }> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { found: false } as const;
      el.click();
      return { found: true, tag: el.tagName } as const;
    },
    args: [selector],
  });
  return res?.result ?? { found: false };
}

async function clickAt(tabId: number, x: number, y: number): Promise<{ ok: true }> {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
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
): Promise<{ ok: true; selector: string; x: number; y: number }> {
  await attachDebugger(tabId);
  const point = await resolvePoint(tabId, { kind: "selector", selector });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
  for (const clickCount of [1, 2]) {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
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
): Promise<{ ok: true; selector: string; x: number; y: number }> {
  await attachDebugger(tabId);
  const point = await resolvePoint(tabId, { kind: "selector", selector });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
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
): Promise<{
  ok: boolean;
  found: boolean;
  selectedValues?: string[];
  selectedLabels?: string[];
  changed?: boolean;
}> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, value: string | undefined, label: string | undefined) => {
      const select = document.querySelector(sel) as HTMLSelectElement | null;
      if (!select) return { ok: false, found: false } as const;
      if (!(select instanceof HTMLSelectElement)) {
        return { ok: false, found: true, error: "not_select" } as const;
      }
      const before = Array.from(select.selectedOptions).map((option) => option.value);
      const options = Array.from(select.options);
      const option = options.find((candidate) =>
        value !== undefined
          ? candidate.value === value
          : candidate.textContent?.replace(/\s+/g, " ").trim() === label,
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
      } as const;
    },
    args: [selector, choice.value, choice.label],
  });
  return res?.result ?? { ok: false, found: false };
}

async function setChecked(
  tabId: number,
  selector: string,
  checked: boolean,
): Promise<{
  ok: boolean;
  found: boolean;
  type?: string;
  before?: boolean;
  after?: boolean;
  changed?: boolean;
  error?: string;
}> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, desired: boolean) => {
      const input = document.querySelector(sel) as HTMLInputElement | null;
      if (!input) return { ok: false, found: false } as const;
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, found: true, error: "not_input" } as const;
      }
      const type = input.type.toLowerCase();
      if (type !== "checkbox" && type !== "radio") {
        return { ok: false, found: true, type, error: "not_checkable" } as const;
      }
      const before = input.checked;
      if (before !== desired) {
        input.checked = desired;
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
      } as const;
    },
    args: [selector, checked],
  });
  return res?.result ?? { ok: false, found: false };
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

type DragPoint = { kind: "selector"; selector: string } | { kind: "coords"; x: number; y: number };

function readDragPoint(
  params: GatewayCommand["params"] | undefined,
  prefix: "from" | "to",
): DragPoint {
  const selector = prefix === "from" ? params?.fromSelector : params?.toSelector;
  if (typeof selector === "string" && selector.length > 0) return { kind: "selector", selector };
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
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    args: [point.selector],
  });
  if (!res?.result)
    throw new GatewayError("selector_not_found", `selector not found: ${point.selector}`);
  return res.result;
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
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: fromPoint.x,
    y: fromPoint.y,
    button: "none",
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
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
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "left",
      buttons: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
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
};

async function fillField(
  tabId: number,
  selector: string,
  value: string,
  dryRun: boolean,
): Promise<FillResult> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, val: string, previewOnly: boolean) => {
      type LocalKind = "input" | "textarea" | "contenteditable" | "role-textbox" | "unsupported";
      const el = document.querySelector(sel) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLElement
        | null;
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
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      const kind = kindOf(el);
      if (kind === "unsupported") {
        return { ok: false, found: true, kind, replacementLength: val.length } as const;
      }

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
        return {
          ok: true,
          found: true,
          kind,
          beforeLength,
          afterLength: el.value.length,
          replacementLength: val.length,
          strategy: "valueSetter",
        } as const;
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
        return {
          ok: true,
          found: true,
          kind,
          beforeLength,
          afterLength: currentText(el).length,
          replacementLength: val.length,
          strategy: "textContentFallback",
        } as const;
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertReplacementText",
          data: val,
        }),
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        ok: true,
        found: true,
        kind,
        beforeLength,
        afterLength: currentText(el).length,
        replacementLength: val.length,
        strategy: "selectionReplacement",
      } as const;
    },
    args: [selector, value, dryRun],
  });
  return res?.result ?? { ok: false, found: false };
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

async function pasteText(tabId: number, selector: string, value: string): Promise<PasteResult> {
  const focusResult = await focusEditableElement(tabId, selector);
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
    await focusEditableElement(tabId, selector);
  }
  await dispatchPasteShortcut(tabId);
  let pasted = await editableTextIncludes(tabId, selector, value);
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

  await insertTextWithExecCommand(tabId, selector, value);
  pasted = await editableTextIncludes(tabId, selector, value);
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

  await dispatchClipboardPasteEvent(tabId, selector, value);
  pasted = await editableTextIncludes(tabId, selector, value);
  return {
    ok: true,
    found: true,
    focused: true,
    pasted,
    viaClipboardFallback,
    pasteStrategy: pasted ? "clipboardEvent" : null,
  };
}

async function clearEditable(tabId: number, selector: string): Promise<ClearResult> {
  const focusResult = await focusEditableElement(tabId, selector);
  if (!focusResult.found || !focusResult.focused) {
    return {
      ok: false,
      found: focusResult.found,
      focused: focusResult.focused,
      cleared: false,
      clearStrategy: null,
    };
  }

  await clearWithExecCommand(tabId, selector);
  if (await editableTextEmpty(tabId, selector)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "execCommand",
    };
  }

  await clearWithSelectionRange(tabId, selector);
  if (await editableTextEmpty(tabId, selector)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "selectionRange",
    };
  }

  await clearWithSyntheticInput(tabId, selector);
  if (await editableTextEmpty(tabId, selector)) {
    return {
      ok: true,
      found: true,
      focused: true,
      cleared: true,
      clearStrategy: "syntheticInput",
    };
  }

  await dispatchSelectAllBackspaceShortcut(tabId);
  const cleared = await editableTextEmpty(tabId, selector);
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
): Promise<{ found: boolean; focused: boolean; tag?: string; activeTag?: string }> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { found: false, focused: false } as const;
      el.focus({ preventScroll: true });
      const active = document.activeElement;
      return {
        found: true,
        focused: active === el || el.contains(active),
        tag: el.tagName.toLowerCase(),
        activeTag: active?.tagName.toLowerCase(),
      } as const;
    },
    args: [selector],
  });
  return res?.result ?? { found: false, focused: false };
}

async function focusEditableElement(
  tabId: number,
  selector: string,
): Promise<{ found: boolean; focused: boolean }> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
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
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return {
        found: true,
        focused: document.activeElement === el || el.contains(document.activeElement),
      } as const;
    },
    args: [selector],
  });
  return res?.result ?? { found: false, focused: false };
}

async function clearWithExecCommand(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      el.focus({ preventScroll: true });
      document.execCommand("selectAll");
      document.execCommand("delete");
    },
    args: [selector],
  });
}

async function clearWithSelectionRange(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as
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
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand("delete");
    },
    args: [selector],
  });
}

async function clearWithSyntheticInput(tabId: number, selector: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as
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
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
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
    },
    args: [selector],
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
  const [res] = await chrome.scripting.executeScript({
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
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: 0,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
    modifiers: 0,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
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
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: modifierKey,
    code: modifierCode,
    windowsVirtualKeyCode: modifierVirtualKey,
    nativeVirtualKeyCode: modifierVirtualKey,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: modifierMask,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
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
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
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
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand("insertText", false, val);
    },
    args: [selector, value],
  });
}

async function dispatchClipboardPasteEvent(
  tabId: number,
  selector: string,
  value: string,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      el.focus({ preventScroll: true });
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", val);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      el.dispatchEvent(event);
    },
    args: [selector, value],
  });
}

async function editableTextIncludes(
  tabId: number,
  selector: string,
  value: string,
): Promise<boolean> {
  if (value.length === 0) return true;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const text = await readEditableText(tabId, selector).catch(() => "");
    if (text.includes(value)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function editableTextEmpty(tabId: number, selector: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const text = await readEditableText(tabId, selector).catch(() => "");
    if (text.trim().length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function readEditableText(tabId: number, selector: string): Promise<string> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLElement
        | null;
      if (!el) return "";
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
      return el.textContent ?? "";
    },
    args: [selector],
  });
  return res?.result ?? "";
}

async function replaceDom(
  tabId: number,
  selector: string,
  html: string,
): Promise<{ found: boolean; inserted: number; selector: string }> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, markup: string) => {
      const target = document.querySelector(sel);
      if (!target) return { found: false, inserted: 0, selector: sel } as const;
      const template = document.createElement("template");
      template.innerHTML = markup.trim();
      const nodes = Array.from(template.content.childNodes);
      if (nodes.length === 0) return { found: false, inserted: 0, selector: sel } as const;
      target.replaceWith(...nodes);
      return { found: true, inserted: nodes.length, selector: sel } as const;
    },
    args: [selector, html],
  });
  return res?.result ?? { found: false, inserted: 0, selector };
}

async function uploadFile(
  tabId: number,
  selector: string,
  file: string,
): Promise<{ ok: true; selector: string; files: number }> {
  await attachDebugger(tabId);
  const documentNode = (await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument", {
    depth: -1,
    pierce: true,
  })) as { root: { nodeId: number } };
  const queryResult = (await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector,
  })) as { nodeId: number };
  if (!queryResult.nodeId) {
    throw new GatewayError("selector_not_found", `selector not found: ${selector}`);
  }
  const described = (await chrome.debugger.sendCommand({ tabId }, "DOM.describeNode", {
    nodeId: queryResult.nodeId,
  })) as { node: { nodeName: string; attributes?: string[] } };
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
  await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
    nodeId: queryResult.nodeId,
    files: [file],
  });
  const [res] = await chrome.scripting.executeScript({
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
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: ch,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "char",
      text: ch,
      unmodifiedText: ch,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
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
  await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
  return { ok: true, insertedBytes: new TextEncoder().encode(text).byteLength };
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
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base,
  });
  if (resolvedKey.length === 1) {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "char",
      text: resolvedKey,
      ...base,
    });
  }
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
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
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
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
  const text = typeof params.text === "string" ? params.text : undefined;
  if (text !== undefined) {
    return waitUntil(tabId, "text", timeoutMs, async () => {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (needle: string) =>
          (document.body?.innerText ?? document.documentElement.innerText ?? "").includes(needle),
        args: [text],
      });
      return res?.result === true;
    });
  }
  const urlPattern = typeof params.urlPattern === "string" ? params.urlPattern : undefined;
  if (urlPattern !== undefined) {
    return waitUntil(tabId, "url", timeoutMs, async () => {
      const tab = await chrome.tabs.get(tabId);
      return globMatch(urlPattern, tab.url ?? "");
    });
  }
  const loadState = typeof params.loadState === "string" ? params.loadState : undefined;
  if (loadState !== undefined) {
    await attachDebugger(tabId);
    return waitUntil(
      tabId,
      "load",
      timeoutMs,
      async () => {
        if (loadState === "networkidle") return (activeNetworkRequests.get(tabId)?.size ?? 0) === 0;
        const [res] = await chrome.scripting.executeScript({
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
    await attachDebugger(tabId);
    return waitUntil(tabId, "predicate", timeoutMs, async () => {
      const res = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: `Boolean(${predicate})`,
        returnByValue: true,
      })) as { result?: { value?: boolean }; exceptionDetails?: unknown };
      return !res.exceptionDetails && res.result?.value === true;
    });
  }
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  if (!selector) throw new Error("wait_for needs --selector or --ms");
  const hidden = params.hidden === true;
  const pollMs = 200;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";
        return visible;
      },
      args: [selector],
    });
    const visible = (res?.result ?? false) as boolean;
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
    mode: "per-call";
    approver: "local_extension_user";
    approvedAt: string;
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
  if (params.approve !== true) {
    throw new GatewayError("approval_required", "abg eval requires --approve on every call.");
  }
  const script = typeof params.script === "string" ? params.script : "";
  if (script.trim().length === 0) throw new Error("script required");
  const maxBytes =
    typeof params.maxBytes === "number"
      ? Math.max(1, Math.min(EVAL_HARD_MAX_BYTES, Math.floor(params.maxBytes)))
      : EVAL_DEFAULT_MAX_BYTES;

  const approval = await requestOperationApproval(
    "eval_script",
    tabId,
    `Run approved JavaScript eval (${new TextEncoder().encode(script).byteLength} bytes).`,
    script,
  );
  if (approval.decision !== "allow") {
    throw new GatewayError("user_denied", approval.message);
  }

  await attachDebugger(tabId);
  const expression = `(${evalPageFunction.toString()})(${JSON.stringify(script)}, ${maxBytes})`;
  const res = (await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
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
  const tab = await chrome.tabs.get(tabId);
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
      mode: "per-call",
      approver: "local_extension_user",
      approvedAt: new Date().toISOString(),
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
    const layout = (await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics")) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number };
    };
    const vp = layout.cssVisualViewport ?? { clientWidth: 800, clientHeight: 600 };
    cursorX = cursorX ?? vp.clientWidth / 2;
    cursorY = cursorY ?? vp.clientHeight / 2;
  }
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: cursorX,
    y: cursorY,
    deltaX,
    deltaY,
  });
  return { ok: true, deltaX, deltaY, x: cursorX, y: cursorY };
}

async function scrollElementIntoView(
  tabId: number,
  selector: string,
): Promise<{
  ok: boolean;
  found: boolean;
  selector: string;
  box?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { ok: false, found: false, selector: sel } as const;
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
        rect.top <= innerHeight &&
        rect.left <= innerWidth;
      return {
        ok: true,
        found: true,
        selector: sel,
        box: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visible,
      } as const;
    },
    args: [selector],
  });
  return res?.result ?? { ok: false, found: false, selector };
}

// ---------- Popup messaging ----------

chrome.runtime.onMessage.addListener((rawMsg: unknown, sender, sendResponse) => {
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
      chrome.tabs.get(msg.tabId).catch(() => undefined),
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
  if (msg.type === "set_profile_label") {
    await setProfileLabel(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "set_all_tabs_access") {
    await setAllTabsAccessEnabled(msg.value);
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
  const resolved = finalizeApproval(msg.approvalId, resolutionForDecision(msg.decision));
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
  if (rawMsg.type === "set_profile_label" && typeof rawMsg.value === "string") {
    return { type: "set_profile_label", value: rawMsg.value };
  }
  if (rawMsg.type === "set_all_tabs_access" && typeof rawMsg.value === "boolean") {
    return { type: "set_all_tabs_access", value: rawMsg.value };
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
