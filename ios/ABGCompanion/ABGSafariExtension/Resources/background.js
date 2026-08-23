const api = globalThis.browser ?? globalThis.chrome;
const NATIVE_APP_ID = "jp.co.arcm.AgentBrowserGateway";
const sharedTabs = new Map();
const tabPorts = new Map();
const pendingApprovals = new Map();

const APPROVAL_METHODS = new Set([
  "click_selector", "click_described", "click_at", "click_ref", "dblclick_selector",
  "focus_selector", "hover_selector", "select_option", "set_checked", "fill", "paste",
  "clear", "replace_dom", "type_text", "key_press",
  "key_down", "key_up", "keyboard_insert_text", "exec_command", "navigate",
  "scroll", "scroll_into_view", "drag", "eval_script",
]);

let nativeConfig = null;
let socket = null;
let authenticated = false;
let extensionId = null;
let reconnectTimer = null;
let lastConnectionError = null;

function sharedTabStorage() {
  return api.storage?.local ?? api.storage?.session ?? null;
}

async function trustedAutomationEnabled() {
  const storage = sharedTabStorage();
  if (!storage) return false;
  const stored = await storage.get("trustedAutomationEnabled");
  return stored.trustedAutomationEnabled === true;
}

function commandNeedsApproval(command) {
  if (APPROVAL_METHODS.has(command.method)) return true;
  return command.method === "find" && ![undefined, "inspect", "text"].includes(command.params?.action);
}

function approvalIntent(command) {
  const target = command.params?.selector || command.params?.ref || command.params?.url || command.params?.key || "the shared tab";
  return `Run ${command.method} on ${String(target).slice(0, 180)}.`;
}

function rejectPendingApproval(approvalId, code, message, decidedBy = "timeout") {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  send({ type: "response", id: pending.command.id, error: { code, message } });
  send({ type: "approval_resolved", approvalId, decision: code === "user_denied" ? "deny" : "timeout", decidedBy });
  return true;
}

function requestApproval(command, tab) {
  const approvalId = crypto.randomUUID();
  const createdAt = Date.now();
  const timeoutMs = 60000;
  const timer = setTimeout(() => {
    rejectPendingApproval(approvalId, "approval_timeout", "Operation denied because approval timed out.");
  }, timeoutMs + 2000);
  pendingApprovals.set(approvalId, { command, tabId: tab.tabId, origin: tab.origin, bridgeToken: tab.bridgeToken, timer });
  send({
    type: "approval_pending",
    approval: {
      approvalId,
      method: command.method,
      intent: approvalIntent(command),
      tabId: tab.tabId,
      origin: tab.origin,
      createdAt,
      timeoutMs,
      scriptPreview: command.method === "eval_script" ? String(command.params?.script || "").slice(0, 500) : undefined,
    },
  });
}

function decideApproval(message) {
  const approvalId = message.params?.approvalId;
  const decision = message.params?.decision;
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return { applied: false, reason: "approval_already_decided" };
  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  const decidedBy = message.params?.decidedBy || "companion";
  if (decision === "allow") {
    const currentTab = sharedTabs.get(pending.tabId);
    if (!currentTab || currentTab.origin !== pending.origin || currentTab.bridgeToken !== pending.bridgeToken) {
      send({ type: "response", id: pending.command.id, error: { code: "stale_approval", message: "The shared tab changed before approval arrived." } });
      send({ type: "approval_resolved", approvalId, decision: "deny", decidedBy: "share_changed" });
      return { applied: false, reason: "approval_expired" };
    }
    const port = tabPorts.get(pending.tabId);
    if (!port) {
      send({ type: "response", id: pending.command.id, error: { code: "tab_not_permitted", message: "Tab is not shared." } });
      return { applied: false, reason: "extension_unreachable" };
    }
    port.postMessage({ type: "command", command: pending.command });
  } else {
    send({ type: "response", id: pending.command.id, error: { code: "user_denied", message: "Operation denied on iPhone." } });
  }
  send({ type: "approval_resolved", approvalId, decision, decidedBy });
  return { applied: true };
}

function bridgeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadSharedTabs() {
  const storage = sharedTabStorage();
  if (!storage) return;
  const stored = await storage.get("sharedTabs");
  for (const item of Array.isArray(stored.sharedTabs) ? stored.sharedTabs : []) {
    if (Number.isInteger(item.tabId)) {
      sharedTabs.set(item.tabId, {
        ...item,
        bridgeToken: typeof item.bridgeToken === "string" ? item.bridgeToken : bridgeToken(),
      });
    }
  }
}

async function persistSharedTabs() {
  const storage = sharedTabStorage();
  if (storage) await storage.set({ sharedTabs: [...sharedTabs.values()] });
}

function sendNativeMessage(message) {
  const sender = api.runtime?.sendNativeMessage;
  if (!sender) return Promise.reject(new Error("Native messaging is unavailable."));
  try {
    const result = sender.call(api.runtime, NATIVE_APP_ID, message);
    if (result?.then) return result;
  } catch (firstError) {
    try {
      const result = sender.call(api.runtime, message);
      if (result?.then) return result;
    } catch {
      return Promise.reject(firstError);
    }
  }
  return new Promise((resolve, reject) => {
    sender.call(api.runtime, NATIVE_APP_ID, message, (response) => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function loadNativeConfig() {
  const response = await sendNativeMessage({ type: "get_gateway_session" });
  if (!response?.ok || !response.paired) {
    nativeConfig = null;
    return null;
  }
  nativeConfig = response;
  return response;
}

async function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const config = nativeConfig ?? (await loadNativeConfig());
  if (!config || sharedTabs.size === 0 || tabPorts.size === 0) return;

  authenticated = false;
  extensionId = null;
  lastConnectionError = null;
  const candidate = new WebSocket(config.websocketUrl);
  socket = candidate;
  candidate.addEventListener("open", () => {
    if (socket !== candidate) return;
    candidate.send(JSON.stringify({
      type: "authenticate",
      deviceId: config.deviceId,
      sessionToken: config.sessionToken,
    }));
  });
  candidate.addEventListener("message", (event) => {
    if (socket !== candidate) return;
    handleGatewayMessage(event.data).catch(() => undefined);
  });
  candidate.addEventListener("close", () => handleSocketClose(candidate));
  candidate.addEventListener("error", () => handleSocketClose(candidate));
}

function handleSocketClose(candidate) {
  if (socket !== candidate) return;
  socket = null;
  authenticated = false;
  extensionId = null;
  if (sharedTabs.size > 0 && tabPorts.size > 0 && reconnectTimer === null) {
    const delay = lastConnectionError === "scope_missing" ? 15000 : 3000;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSocket().catch(() => undefined);
    }, delay);
  }
}

function send(message) {
  if (!authenticated || socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function sendPermitted(tab) {
  send({
    type: "tab_permitted",
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    origin: tab.origin,
    accessMode: "manual",
  });
}

async function handleGatewayMessage(raw) {
  const message = JSON.parse(String(raw));
  if (message.type === "auth_result") {
    if (!message.ok || typeof message.extensionId !== "string") {
      lastConnectionError = message.error || "authentication_failed";
      nativeConfig = null;
      socket?.close();
      return;
    }
    authenticated = true;
    extensionId = message.extensionId;
    send({
      type: "hello",
      extensionId,
      version: api.runtime.getManifest().version,
      profileLabel: "iPhone Safari",
      browserKind: "safari-ios",
    });
    for (const tab of sharedTabs.values()) {
      if (tabPorts.has(tab.tabId)) sendPermitted(tab);
    }
    return;
  }
  if (!authenticated || typeof message.id !== "string") return;
  if (message.method === "approval_decide") {
    send({ type: "response", id: message.id, result: decideApproval(message) });
    return;
  }
  const tabId = message.params?.tabId;
  const port = tabPorts.get(tabId);
  if (!port) {
    send({
      type: "response",
      id: message.id,
      error: { code: "tab_not_permitted", message: "Tab is not shared." },
    });
    return;
  }
  if (commandNeedsApproval(message) && !(await trustedAutomationEnabled())) {
    requestApproval(message, sharedTabs.get(tabId));
    return;
  }
  port.postMessage({ type: "command", command: message });
}

async function activeTabRecord(tabId, providedTab = null) {
  const tab = providedTab?.id === tabId ? providedTab : await api.tabs.get(tabId);
  const url = tab.url || "";
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS tabs can be shared.");
  }
  return {
    tabId,
    url,
    title: tab.title || url,
    origin: parsed.origin,
    bridgeToken: bridgeToken(),
  };
}

async function installBridge(tab) {
  const config = nativeConfig ?? (await loadNativeConfig());
  if (!config) throw new Error("Pair this iPhone with the Mac Gateway first.");
  await api.scripting.executeScript({
    target: { tabId: tab.tabId },
    files: ["page-commands.js", "bridge.js"],
  });
  const response = await api.tabs.sendMessage(tab.tabId, {
    type: "start_bridge",
    config,
    tab,
  });
  if (!response?.ok) throw new Error(response?.error || "Safari could not start the tab bridge.");
}

async function removeBridge(tabId) {
  await api.tabs.sendMessage(tabId, { type: "stop_bridge" });
}

async function shareTab(tabId, providedTab = null) {
  const config = nativeConfig ?? (await loadNativeConfig());
  if (!config) throw new Error("Pair this iPhone with the Mac Gateway first.");

  for (const existingTabId of [...sharedTabs.keys()]) {
    if (existingTabId !== tabId) await removeBridge(existingTabId).catch(() => undefined);
  }
  sharedTabs.clear();

  const tab = await activeTabRecord(tabId, providedTab);
  sharedTabs.set(tabId, tab);
  await persistSharedTabs();
  await installBridge(tab);
}

async function revokeTab(tabId) {
  if (!sharedTabs.has(tabId)) return;
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.tabId === tabId) {
      rejectPendingApproval(approvalId, "tab_not_permitted", "The tab share was revoked before approval arrived.", "share_revoked");
    }
  }
  send({ type: "tab_revoked", tabId, reason: "user_revoke" });
  sharedTabs.delete(tabId);
  await persistSharedTabs();
  await removeBridge(tabId).catch(() => undefined);
  tabPorts.delete(tabId);
  if (sharedTabs.size === 0 && socket) {
    const current = socket;
    socket = null;
    authenticated = false;
    extensionId = null;
    current.close();
  }
}

const initialization = loadSharedTabs().then(async () => {
  for (const [tabId, current] of [...sharedTabs.entries()]) {
    try {
      const next = await activeTabRecord(tabId);
      if (next.origin !== current.origin) {
        sharedTabs.delete(tabId);
        continue;
      }
      const restored = { ...next, bridgeToken: current.bridgeToken };
      sharedTabs.set(tabId, restored);
      await installBridge(restored);
    } catch {
      sharedTabs.delete(tabId);
    }
  }
  await persistSharedTabs();
}).catch(() => undefined);

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "get_state") {
    return (async () => {
      await initialization;
      const config = nativeConfig ?? (await loadNativeConfig().catch(() => null));
      const tab = sharedTabs.get(message.tabId);
      return {
        ok: true,
        paired: Boolean(config),
        gatewayLabel: config?.gatewayLabel || null,
        shared: Boolean(tab),
        connected: Boolean(tab && tabPorts.has(message.tabId) && authenticated),
        connectionError: lastConnectionError,
        trustedAutomationEnabled: await trustedAutomationEnabled(),
      };
    })();
  }
  if (message?.type === "share_tab") {
    return initialization.then(() => shareTab(message.tabId, message.tab)).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }
  if (message?.type === "revoke_tab") {
    return initialization.then(() => revokeTab(message.tabId)).then(() => ({ ok: true }));
  }
  if (message?.type === "set_trusted_automation") {
    const storage = sharedTabStorage();
    return (storage ? storage.set({ trustedAutomationEnabled: message.enabled === true }) : Promise.resolve()).then(() => ({ ok: true }));
  }
  if (message?.type === "capture_visible") {
    return api.tabs.get(message.tabId).then(async (tab) => {
      if (!tab.active) throw new Error("Open the shared tab before taking its screenshot.");
      return { dataUrl: await api.tabs.captureVisibleTab(tab.windowId, { format: "png" }) };
    });
  }
  if (message?.type === "raise_bridge_tab") {
    return api.tabs.update(message.tabId, { active: true }).then(() => ({ ok: true }));
  }
  if (message?.type === "revoke_bridge_tab") {
    return initialization.then(() => revokeTab(message.tabId)).then(() => ({ ok: true }));
  }
  return undefined;
});

api.runtime.onConnect.addListener((port) => {
  if (typeof port.name !== "string" || !port.name.startsWith("abg-tab:")) return;
  initialization.then(() => {
    const [, tabIdText, token] = port.name.split(":");
    const tabId = Number(tabIdText);
    const tab = sharedTabs.get(tabId);
    if (!tab || tab.bridgeToken !== token || port.sender?.tab?.id !== tabId) {
      port.disconnect();
      return;
    }

    tabPorts.get(tabId)?.disconnect();
    tabPorts.set(tabId, port);
    port.onMessage.addListener((message) => {
      if (message?.type === "heartbeat") {
        if (message.origin !== tab.origin) {
          revokeTab(tabId).catch(() => undefined);
          return;
        }
        const next = {
          ...tab,
          url: message.url || tab.url,
          title: message.title || tab.title,
        };
        sharedTabs.set(tabId, next);
        persistSharedTabs().catch(() => undefined);
        send({
          type: "tab_updated",
          tabId,
          url: next.url,
          title: next.title,
          origin: next.origin,
          accessMode: "manual",
        });
        ensureSocket().catch(() => undefined);
        return;
      }
      if (message?.type === "response" && typeof message.id === "string") {
        send({
          type: "response",
          id: message.id,
          result: message.result,
          error: message.error,
        });
      }
      if (message?.type === "runtime_event") {
        send({ type: "runtime_event", tabId, event: message.event });
      }
    });
    port.onDisconnect.addListener(() => {
      if (tabPorts.get(tabId) === port) tabPorts.delete(tabId);
    });
    ensureSocket().catch(() => undefined);
  }).catch(() => port.disconnect());
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await initialization;
  const current = sharedTabs.get(tabId);
  if (!current) return;

  if (changeInfo.url) {
    let nextOrigin;
    try { nextOrigin = new URL(changeInfo.url).origin; } catch { nextOrigin = ""; }
    if (!nextOrigin || nextOrigin !== current.origin) {
      await revokeTab(tabId);
      return;
    }
    sharedTabs.set(tabId, {
      ...current,
      url: changeInfo.url,
      title: tab.title || changeInfo.url,
    });
    await persistSharedTabs();
    const next = sharedTabs.get(tabId);
    send({
      type: "tab_updated",
      tabId,
      url: next.url,
      title: next.title,
      origin: next.origin,
      accessMode: "manual",
    });
  }

  if (changeInfo.status === "complete") {
    await installBridge(sharedTabs.get(tabId)).catch(() => undefined);
  }
});

api.tabs.onRemoved.addListener(async (tabId) => {
  await initialization;
  if (!sharedTabs.has(tabId)) return;
  send({ type: "tab_closed", tabId });
  sharedTabs.delete(tabId);
  tabPorts.delete(tabId);
  await persistSharedTabs();
});
