const api = globalThis.browser ?? globalThis.chrome;
const NATIVE_APP_ID = "jp.co.arcm.AgentBrowserGateway";
const sharedTabs = new Map();
const tabPorts = new Map();
const pendingApprovals = new Map();
const frameMaps = new Map();

const APPROVAL_METHODS = new Set([
  "click_selector", "click_described", "click_at", "click_ref", "dblclick_selector",
  "focus_selector", "hover_selector", "select_option", "set_checked", "fill", "paste",
  "clear", "replace_dom", "type_text", "key_press",
  "key_down", "key_up", "keyboard_insert_text", "exec_command", "navigate",
  "scroll", "scroll_into_view", "drag", "eval_script",
  "upload_file",
]);

let nativeConfig = null;
let socket = null;
let authenticated = false;
let extensionId = null;
let reconnectTimer = null;
let lastConnectionError = null;

function sharedTabStorage() {
  return api.storage?.session ?? api.storage?.local ?? null;
}

async function bridgeCapabilities(tabId) {
  const response = await api.tabs.sendMessage(tabId, { type: "get_bridge_state" });
  return response?.tab?.capabilities || {};
}

async function updateBridgeCapabilities(tabId, changes) {
  const response = await api.tabs.sendMessage(tabId, { type: "set_bridge_capabilities", changes });
  if (!response?.ok) throw new Error(response?.error || "Tab capability could not be changed.");
  const current = sharedTabs.get(tabId);
  if (current && response.tab) {
    sharedTabs.set(tabId, response.tab);
    await persistSharedTabs().catch(() => undefined);
  }
  return response.tab?.capabilities || {};
}

async function trustedAutomationEnabled(tabId) {
  return (await bridgeCapabilities(tabId)).trustedAutomationEnabled === true;
}

function permissionPattern(origin) {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

async function cookieAccessEnabled(tabId) {
  return (await bridgeCapabilities(tabId)).cookieAccessEnabled === true;
}

async function setCookieAccess(tabId, enabled) {
  await updateBridgeCapabilities(tabId, { cookieAccessEnabled: enabled });
}

async function grantedFrameOrigins(tabId) {
  const capabilities = await bridgeCapabilities(tabId);
  return Array.isArray(capabilities.frameAccessOrigins) ? capabilities.frameAccessOrigins : [];
}

async function grantFrameOrigins(tabId, origins) {
  const current = new Set(await grantedFrameOrigins(tabId));
  for (const origin of origins) current.add(origin);
  await updateBridgeCapabilities(tabId, { frameAccessOrigins: [...current].sort() });
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

function requestApproval(command, tab, nativeMessage = null) {
  const approvalId = crypto.randomUUID();
  const createdAt = Date.now();
  const timeoutMs = 60000;
  const timer = setTimeout(() => {
    rejectPendingApproval(approvalId, "approval_timeout", "Operation denied because approval timed out.");
  }, timeoutMs + 2000);
  pendingApprovals.set(approvalId, { command, tabId: tab.tabId, origin: tab.origin, bridgeToken: tab.bridgeToken, nativeMessage, timer });
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
      requestId: nativeMessage ? command.id : undefined,
      nativeAction: nativeMessage ? { kind: nativeMessage.type, url: nativeMessage.url, title: nativeMessage.title } : undefined,
    },
  });
}

async function decideApproval(message) {
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
    if (pending.nativeMessage) {
      try {
        const result = await sendNativeMessage(pending.nativeMessage);
        if (!result?.ok) throw new Error(result?.error || "Native operation failed.");
        send({ type: "response", id: pending.command.id, result });
      } catch (error) {
        send({ type: "response", id: pending.command.id, error: { code: "native_operation_failed", message: error.message || String(error) } });
      }
      send({ type: "approval_resolved", approvalId, decision, decidedBy });
      return { applied: true };
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

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function decryptFileCommand(command) {
  const encryptedFiles = command.params?.encryptedFiles;
  if (!Array.isArray(encryptedFiles)) return command;
  if (!nativeConfig?.sessionToken) throw new Error("The paired file-transfer key is unavailable.");
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`abg-ios-file-transfer-v1:${nativeConfig.sessionToken}`),
  );
  const key = await crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, ["decrypt"]);
  const files = [];
  for (const item of encryptedFiles) {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64(item.nonceBase64) },
      key,
      decodeBase64(item.sealedBase64),
    );
    files.push({
      name: item.name,
      type: item.type || "application/octet-stream",
      size: item.size,
      sha256: item.sha256,
      dataBase64: encodeBase64(new Uint8Array(plaintext)),
    });
  }
  return { ...command, params: { ...command.params, encryptedFiles: undefined, files } };
}

async function enumerateFrameOrigins(tabId) {
  const [result] = await api.scripting.executeScript({
    target: { tabId },
    func: () => {
      const pattern = (value) => {
        const url = new URL(value, location.href);
        return `${url.protocol}//${url.hostname}/*`;
      };
      const topPattern = pattern(location.href);
      return [...document.querySelectorAll("iframe[src],frame[src]")]
        .map((frame) => {
          try { return pattern(frame.src); } catch { return null; }
        })
        .filter((origin, index, all) => origin && origin !== topPattern && all.indexOf(origin) === index);
    },
  });
  return Array.isArray(result?.result) ? result.result : [];
}

async function refreshFrameMap(tabId) {
  await api.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["page-commands.js"] });
  const results = await api.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => ({ url: location.href, title: document.title, origin: location.origin }),
  });
  const ordered = [...results].sort((a, b) => a.frameId - b.frameId);
  const map = new Map();
  const frames = ordered.map((entry, index) => {
    const ref = entry.frameId === 0 ? "@top" : `@f${index}`;
    map.set(ref, entry.frameId);
    return { ref, frameId: entry.frameId, ...entry.result, accessible: true };
  });
  frameMaps.set(tabId, map);
  return { count: frames.length, frames };
}

async function runFrameCommand(tabId, frameRef, method, params) {
  let map = frameMaps.get(tabId);
  if (!map?.has(frameRef)) {
    await refreshFrameMap(tabId);
    map = frameMaps.get(tabId);
  }
  const frameId = map?.get(frameRef);
  if (!Number.isInteger(frameId)) throw new Error(`Frame ${frameRef} was not found or its site permission is missing.`);
  await api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["page-commands.js"] });
  const [result] = await api.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: async (commandMethod, commandParams) => {
      const handler = globalThis.__abgSafariPageCommands?.handlers?.[commandMethod];
      if (!handler) throw new Error(`Unknown frame command: ${commandMethod}`);
      return handler({ ...commandParams, frame: "@top" });
    },
    args: [method, params],
  });
  return result?.result;
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
  if (!storage) return;
  await storage.remove("sharedTabs");
  await storage.set({ sharedTabs: [...sharedTabs.values()] });
}

function sendNativeMessage(message) {
  const sender = api.runtime?.sendNativeMessage;
  if (!sender) return Promise.reject(new Error("Native messaging is unavailable."));
  if (globalThis.browser) {
    try {
      return Promise.resolve(sender.call(api.runtime, NATIVE_APP_ID, message));
    } catch (error) {
      return Promise.reject(error);
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

function cookiesForURL(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const accept = finish(resolve);
    const fail = finish(reject);
    const timer = setTimeout(() => fail(new Error("Safari did not return cookies within 5 seconds.")), 5000);
    try {
      const result = api.cookies.getAll({ url }, (cookies) => {
        const error = api.runtime?.lastError;
        if (error) fail(new Error(error.message));
        else accept(cookies || []);
      });
      if (result?.then) result.then((cookies) => accept(cookies || []), fail);
      else if (Array.isArray(result)) accept(result);
    } catch (error) {
      fail(error);
    }
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
    send({ type: "response", id: message.id, result: await decideApproval(message) });
    return;
  }
  if (message.method === "reading_list_add") {
    let approvalTab = null;
    for (const tab of sharedTabs.values()) {
      const capabilities = await bridgeCapabilities(tab.tabId).catch(() => ({}));
      if (capabilities.readingListEnabled === true) {
        approvalTab = tab;
        break;
      }
    }
    if (!approvalTab) {
      send({ type: "response", id: message.id, error: { code: "permission_required", message: "Enable Reading List in one shared iPhone tab." } });
      return;
    }
    const nativeMessage = { type: "reading_list_add", url: message.params?.url, title: message.params?.title };
    requestApproval(message, approvalTab, nativeMessage);
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
  let prepared;
  try {
    prepared = message.method === "upload_file" ? await decryptFileCommand(message) : message;
  } catch (error) {
    send({ type: "response", id: message.id, error: { code: "file_transfer_failed", message: error.message || String(error) } });
    return;
  }
  if (commandNeedsApproval(prepared) && !(await trustedAutomationEnabled(tabId))) {
    requestApproval(prepared, sharedTabs.get(tabId));
    return;
  }
  port.postMessage({ type: "command", command: prepared });
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
    capabilities: {
      trustedAutomationEnabled: false,
      cookieAccessEnabled: false,
      readingListEnabled: false,
      frameAccessOrigins: [],
    },
  };
}

async function recoverSharedTab(tabId) {
  if (sharedTabs.has(tabId)) return sharedTabs.get(tabId);
  try {
    const response = await api.tabs.sendMessage(tabId, { type: "get_bridge_state" });
    if (!response?.active || response.tab?.tabId !== tabId || typeof response.tab?.bridgeToken !== "string") return null;
    const current = await activeTabRecord(tabId);
    if (current.origin !== response.tab.origin) return null;
    const restored = { ...current, ...response.tab, url: current.url, title: current.title };
    sharedTabs.set(tabId, restored);
    await persistSharedTabs().catch(() => undefined);
    await installBridge(restored);
    return restored;
  } catch {
    return null;
  }
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
  void removeBridge(tabId).catch(() => undefined);
  tabPorts.delete(tabId);
  if (sharedTabs.size === 0 && socket) {
    const current = socket;
    socket = null;
    authenticated = false;
    extensionId = null;
    current.close();
  }
}

const initialization = (async () => {
  await loadSharedTabs();
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
})().catch(() => undefined);

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "get_state") {
    return (async () => {
      await initialization;
      const config = nativeConfig ?? (await loadNativeConfig().catch(() => null));
      const tab = sharedTabs.get(message.tabId) || await recoverSharedTab(message.tabId);
      const capabilities = tab ? await bridgeCapabilities(message.tabId).catch(() => tab.capabilities || {}) : {};
      const frameOrigins = tab ? await enumerateFrameOrigins(message.tabId).catch(() => []) : [];
      const grantedFrames = new Set(Array.isArray(capabilities.frameAccessOrigins) ? capabilities.frameAccessOrigins : []);
      const missingFrameOrigins = frameOrigins.filter((origin) => !grantedFrames.has(origin));
      return {
        ok: true,
        paired: Boolean(config),
        gatewayLabel: config?.gatewayLabel || null,
        shared: Boolean(tab),
        connected: Boolean(tab && tabPorts.has(message.tabId) && authenticated),
        connectionError: lastConnectionError,
        trustedAutomationEnabled: capabilities.trustedAutomationEnabled === true,
        cookieAccessEnabled: capabilities.cookieAccessEnabled === true,
        readingListEnabled: capabilities.readingListEnabled === true,
        sitePermissionPattern: tab ? permissionPattern(tab.origin) : null,
        missingFrameOrigins,
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
    return updateBridgeCapabilities(message.tabId, { trustedAutomationEnabled: message.enabled === true }).then(() => ({ ok: true }));
  }
  if (message?.type === "set_cookie_access") {
    return initialization.then(async () => {
      const tab = sharedTabs.get(message.tabId) || await recoverSharedTab(message.tabId);
      if (!tab) throw new Error("Tab is not shared.");
      await setCookieAccess(message.tabId, message.enabled === true);
      return { ok: true };
    }).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }
  if (message?.type === "set_reading_list_access") {
    return updateBridgeCapabilities(message.tabId, { readingListEnabled: message.enabled === true }).then(() => ({ ok: true }));
  }
  if (message?.type === "refresh_frame_access") {
    return refreshFrameMap(message.tabId).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }
  if (message?.type === "grant_frame_access") {
    return grantFrameOrigins(message.tabId, Array.isArray(message.origins) ? message.origins : []).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message || String(error) }));
  }
  if (message?.type === "enumerate_frames") {
    return refreshFrameMap(message.tabId);
  }
  if (message?.type === "frame_command") {
    return runFrameCommand(message.tabId, message.frame, message.method, message.params || {});
  }
  if (message?.type === "get_cookies") {
    return initialization.then(async () => {
      try {
        const tab = sharedTabs.get(message.tabId);
        if (!tab || message.origin !== tab.origin) throw Object.assign(new Error("Tab is not shared for cookie access."), { code: "tab_not_permitted" });
        if (!(await cookieAccessEnabled(message.tabId))) throw Object.assign(new Error("Cookie access is not enabled for this site."), { code: "permission_required" });
        const cookies = await cookiesForURL(tab.url);
        return { ok: true, cookies: cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: cookie.expirationDate })) };
      } catch (error) {
        return { ok: false, error: { code: error.code || "cookie_access_failed", message: error.message || String(error) } };
      }
    });
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
    if (authenticated) sendPermitted(tab);
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
