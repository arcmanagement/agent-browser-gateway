import { type AnnotationCommand, manageAnnotationMode } from "./annotationOverlay.js";
import type {
  AnnotationAction,
  ApprovalDecision,
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
} from "./types.js";

const WS_URL = "ws://127.0.0.1:8765/ws";
const VERSION = "0.3.2";
const HEARTBEAT_PERIOD_MIN = 0.5; // 30s — Chrome 117+ minimum, anything lower is silently dropped
const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_WINDOW_FALLBACK_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + 2_000;
const DEFAULT_SETTINGS: ExtensionSettings = {
  operationsRequireApproval: true,
  profileLabel: "",
};
const OPERATION_METHODS: ReadonlySet<GatewayCommand["method"]> = new Set([
  "click_selector",
  "click_described",
  "click_at",
  "fill",
  "replace_dom",
  "upload_file",
  "type_text",
  "key_press",
  "navigate",
  "scroll",
  "drag",
]);

type PermittedTab = {
  url: string;
  title: string;
  origin: string;
  permittedAt: number;
  expiresAt?: number;
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
const attachedTabs = new Set<number>();
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
  const stored = await chrome.storage.local.get(["operationsRequireApproval", "profileLabel"]);
  const operationsRequireApproval =
    typeof stored.operationsRequireApproval === "boolean"
      ? stored.operationsRequireApproval
      : DEFAULT_SETTINGS.operationsRequireApproval;
  const profileLabel =
    typeof stored.profileLabel === "string" ? stored.profileLabel : DEFAULT_SETTINGS.profileLabel;
  if (
    typeof stored.operationsRequireApproval !== "boolean" ||
    typeof stored.profileLabel !== "string"
  ) {
    await chrome.storage.local.set({ operationsRequireApproval, profileLabel });
  }
  return { operationsRequireApproval, profileLabel };
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
    permittedTabs.set(Number(k), v);
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
    // Re-send all currently permitted tabs so Gateway is in sync
    for (const [tabId, p] of permittedTabs) {
      sendWS({
        type: "tab_permitted",
        tabId,
        url: p.url,
        title: p.title,
        origin: p.origin,
        expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : undefined,
      });
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

// ---------- Tab permission ----------

async function permitTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("tab has no URL");
  const url = tab.url;
  const origin = new URL(url).origin;
  const title = tab.title ?? "";
  const entry: PermittedTab = {
    url,
    title,
    origin,
    permittedAt: Date.now(),
  };
  permittedTabs.set(tabId, entry);
  await saveState();
  sendWS({ type: "tab_permitted", tabId, url, title, origin });
  await attachDebugger(tabId);
  await updateBadge(tabId);
}

async function revokeTab(tabId: number, reason: string): Promise<void> {
  if (!permittedTabs.has(tabId)) return;
  permittedTabs.delete(tabId);
  consoleBuffers.delete(tabId);
  networkBuffers.delete(tabId);
  await saveState();
  sendWS({ type: "tab_revoked", tabId, reason });
  await detachDebugger(tabId);
  await updateBadge(tabId);
}

async function updateBadge(tabId: number): Promise<void> {
  const isPermitted = permittedTabs.has(tabId);
  try {
    await chrome.action.setBadgeText({ tabId, text: isPermitted ? "ON" : "" });
    if (isPermitted) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#34c759" });
    }
  } catch {}
}

// ---------- Tab lifecycle hooks ----------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!permittedTabs.has(tabId)) return;
  const old = permittedTabs.get(tabId);
  if (!old) return;
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
    sendWS({ type: "tab_updated", tabId, url: old.url, title: old.title, origin: old.origin });
  } else if (changeInfo.title) {
    old.title = changeInfo.title;
    permittedTabs.set(tabId, old);
    await saveState();
    sendWS({ type: "tab_updated", tabId, url: old.url, title: old.title, origin: old.origin });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (permittedTabs.has(tabId)) {
    permittedTabs.delete(tabId);
    consoleBuffers.delete(tabId);
    networkBuffers.delete(tabId);
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
  } else if (method === "Network.requestWillBeSent") {
    const p = params as {
      requestId: string;
      timestamp: number;
      wallTime?: number;
      type?: string;
      request: { method: string; url: string };
    };
    const buf = networkBuffers.get(source.tabId) ?? [];
    buf.push({
      requestId: p.requestId,
      method: p.request.method,
      url: p.request.url,
      type: p.type?.toLowerCase(),
      ts: new Date((p.wallTime ?? Date.now() / 1000) * 1000).toISOString(),
      startTime: p.timestamp,
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
  } else if (method === "Network.loadingFinished") {
    const p = params as { requestId: string; timestamp: number; encodedDataLength?: number };
    const entry = findNetworkEntry(source.tabId, p.requestId);
    if (entry) {
      entry.durationMs = Math.max(0, Math.round((p.timestamp - entry.startTime) * 1000));
      entry.encodedDataLength = p.encodedDataLength;
    }
  } else if (method === "Network.loadingFailed") {
    const p = params as { requestId: string; timestamp: number; errorText?: string };
    const entry = findNetworkEntry(source.tabId, p.requestId);
    if (entry) {
      entry.durationMs = Math.max(0, Math.round((p.timestamp - entry.startTime) * 1000));
      entry.errorText = p.errorText;
    }
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
    } else if (cmd.method === "screenshot") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await screenshot(tabId, cmd.params?.clip);
      reply(cmd.id, result);
    } else if (cmd.method === "console") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
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
    } else if (cmd.method === "annotation_mode") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await manageAnnotationMode(tabId, readAnnotationCommand(cmd.params)));
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
  if (cmd.method === "click_described") {
    const id = cmd.params?.id;
    if (typeof id !== "number") throw new Error("id required");
    return {
      intent: `Click the element with describe id ${id}.`,
      run: () => clickDescribedElement(tabId, id, cmd.params ?? {}),
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
    return {
      intent: `Fill ${quoteForIntent(value)} into the field matching selector ${quoteForIntent(selector)}.`,
      run: () => fillField(tabId, selector, value),
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
  method: OperationMethod,
  tabId: number,
  intent: string,
): Promise<ApprovalResolution> {
  const request: ApprovalRequest = {
    id: crypto.randomUUID(),
    method,
    intent,
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
      width: 380,
      height: 220,
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

async function fillField(
  tabId: number,
  selector: string,
  value: string,
): Promise<{ found: boolean }> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return { found: false } as const;
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true } as const;
    },
    args: [selector, value],
  });
  return res?.result ?? { found: false };
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

type WaitParams = NonNullable<GatewayCommand["params"]>;
type WaitResult =
  | { ok: true; mode: "sleep"; ms: number }
  | { ok: true; mode: "selector"; found: boolean; elapsedMs: number; selector: string }
  | { ok: false; error: "timeout"; selector: string; timeoutMs: number };

async function waitFor(tabId: number, params: WaitParams): Promise<WaitResult> {
  const sleepMs = typeof params.sleepMs === "number" ? params.sleepMs : undefined;
  if (sleepMs !== undefined) {
    await new Promise((r) => setTimeout(r, Math.max(0, sleepMs)));
    return { ok: true, mode: "sleep", ms: sleepMs };
  }
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  if (!selector) throw new Error("wait_for needs --selector or --ms");
  const hidden = params.hidden === true;
  const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 10_000;
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
  return { ok: false, error: "timeout", selector, timeoutMs };
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

// ---------- Popup messaging ----------

chrome.runtime.onMessage.addListener((rawMsg: unknown, _sender, sendResponse) => {
  (async () => {
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
    const sharedTabs: { tabId: number; title: string; url: string }[] = [];
    for (const [tabId, p] of permittedTabs) {
      sharedTabs.push({ tabId, title: p.title, url: p.url });
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
      sharedTabs,
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
  if (msg.type === "set_profile_label") {
    await setProfileLabel(msg.value);
    return { type: "ok" };
  }
  if (msg.type === "annotation_action") {
    if (!permittedTabs.has(msg.tabId)) {
      return { type: "error", message: "tab is not shared with ABG" };
    }
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
  if (rawMsg.type === "set_profile_label" && typeof rawMsg.value === "string") {
    return { type: "set_profile_label", value: rawMsg.value };
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
