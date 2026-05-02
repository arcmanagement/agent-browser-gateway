import type {
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
const VERSION = "0.1.2";
const HEARTBEAT_PERIOD_MIN = 0.5; // 30s — Chrome 117+ minimum, anything lower is silently dropped
const APPROVAL_TIMEOUT_MS = 60_000;
const APPROVAL_WINDOW_FALLBACK_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + 2_000;
const DEFAULT_SETTINGS: ExtensionSettings = {
  operationsRequireApproval: true,
  profileLabel: "",
};
const OPERATION_METHODS: ReadonlySet<GatewayCommand["method"]> = new Set([
  "click_selector",
  "click_at",
  "fill",
  "type_text",
  "key_press",
  "navigate",
  "scroll",
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
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attachedTabs.delete(source.tabId);
});

// ---------- Gateway -> Extension commands ----------

async function handleGatewayCommand(cmd: GatewayCommand): Promise<void> {
  const tabId = cmd.params?.tabId;
  try {
    if (cmd.method === "read_dom") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await readDom(tabId, cmd.params?.selector, cmd.params?.asMarkdown ?? false);
      reply(cmd.id, result);
    } else if (cmd.method === "screenshot") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const result = await screenshot(tabId, cmd.params?.clip);
      reply(cmd.id, result);
    } else if (cmd.method === "console") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      const logs = consoleBuffers.get(tabId) ?? [];
      reply(cmd.id, { logs });
    } else if (cmd.method === "wait_for") {
      if (!tabId || !permittedTabs.has(tabId)) throw new Error("tab not permitted");
      reply(cmd.id, await waitFor(tabId, cmd.params ?? {}));
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
  const deltaX = cmd.params?.deltaX ?? 0;
  const deltaY = cmd.params?.deltaY ?? 0;
  if (typeof deltaX !== "number" || typeof deltaY !== "number") {
    throw new Error("deltaX and deltaY must be numbers");
  }
  const atX = typeof cmd.params?.atX === "number" ? cmd.params.atX : undefined;
  const atY = typeof cmd.params?.atY === "number" ? cmd.params.atY : undefined;
  const where = atX !== undefined && atY !== undefined ? `at (${atX}, ${atY})` : "at viewport center";
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

async function readDom(
  tabId: number,
  selector: string | undefined,
  asMarkdown: boolean,
): Promise<DomReadResult> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null, wantMarkdown: boolean) => {
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

      const base = {
        url: location.href,
        title: document.title,
        origin: location.origin,
        selector: sel ?? undefined,
        found: sel ? true : undefined,
        text,
      };

      if (wantMarkdown) {
        // Run the HTML→Markdown conversion in page context (DOMParser is unavailable in
        // the extension service worker). The function is duplicated here intentionally
        // because chrome.scripting.executeScript serialises func into the page world.
        const walk = (node: Node): string => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
          if (node.nodeType !== Node.ELEMENT_NODE) return "";
          const el = node as Element;
          const tag = el.tagName.toLowerCase();
          const childMd = (sep = "") =>
            Array.from(el.childNodes)
              .map((c) => walk(c))
              .join(sep);
          switch (tag) {
            case "h1":
              return `\n# ${childMd().trim()}\n\n`;
            case "h2":
              return `\n## ${childMd().trim()}\n\n`;
            case "h3":
              return `\n### ${childMd().trim()}\n\n`;
            case "h4":
              return `\n#### ${childMd().trim()}\n\n`;
            case "h5":
              return `\n##### ${childMd().trim()}\n\n`;
            case "h6":
              return `\n###### ${childMd().trim()}\n\n`;
            case "p":
              return `\n${childMd().trim()}\n\n`;
            case "br":
              return "\n";
            case "strong":
            case "b":
              return `**${childMd().trim()}**`;
            case "em":
            case "i":
              return `_${childMd().trim()}_`;
            case "code":
              return `\`${childMd().trim()}\``;
            case "pre":
              return `\n\`\`\`\n${childMd().trim()}\n\`\`\`\n\n`;
            case "a": {
              const href = el.getAttribute("href") ?? "";
              const txt = childMd().trim() || href;
              return href ? `[${txt}](${href})` : txt;
            }
            case "img": {
              const alt = el.getAttribute("alt") ?? "";
              const src = el.getAttribute("src") ?? "";
              return src ? `![${alt}](${src})` : alt;
            }
            case "ul":
              return `\n${Array.from(el.children)
                .map((li) => `- ${walk(li).trim()}`)
                .join("\n")}\n\n`;
            case "ol":
              return `\n${Array.from(el.children)
                .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
                .join("\n")}\n\n`;
            case "li":
              return childMd();
            case "blockquote":
              return `\n${childMd()
                .trim()
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}\n\n`;
            case "hr":
              return "\n---\n\n";
            case "script":
            case "style":
            case "noscript":
            case "svg":
              return "";
            default:
              return childMd();
          }
        };
        const markdown = walk(target)
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return { ...base, markdown } as const;
      }
      return { ...base, html: (target as Element).outerHTML } as const;
    },
    args: [selector ?? null, asMarkdown],
  });
  const raw = res?.result as DomReadResult | undefined;
  return raw ?? { url: "", title: "", origin: "", text: "" };
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
    const layout = (await chrome.debugger.sendCommand(
      { tabId },
      "Page.getLayoutMetrics",
    )) as { cssVisualViewport?: { clientWidth: number; clientHeight: number } };
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
    return {
      type: "state",
      permitted: permittedTabs.has(msg.tabId),
      wsConnected,
      sharedTabs,
      settings: await getSettings(),
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
