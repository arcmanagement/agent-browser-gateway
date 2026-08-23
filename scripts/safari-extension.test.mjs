import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const resourceRoot = new URL("../ios/ABGCompanion/ABGSafariExtension/Resources/", import.meta.url);
const iconRoot = new URL("../extension/public/icons/", import.meta.url);
const projectSpec = new URL("../ios/ABGCompanion/project.yml", import.meta.url);

test("Safari manifest keeps access user-scoped", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", resourceRoot), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes("nativeMessaging"), true);
  assert.equal(manifest.permissions.includes("cookies"), true);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.equal(manifest.background.persistent, false);
  assert.equal(manifest.background.service_worker, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.deepEqual(manifest.icons, {
    16: "icons/16.png",
    48: "icons/48.png",
    128: "icons/128.png",
  });
  assert.deepEqual(manifest.action.default_icon, manifest.icons);

  for (const filename of Object.values(manifest.icons)) {
    const icon = await readFile(new URL(filename.replace("icons/", ""), iconRoot));
    assert.equal(icon.length > 0, true);
  }
  assert.match(await readFile(projectSpec, "utf8"), /path: \.\.\/\.\.\/extension\/public\/icons/);
});

test("Safari cookie inspection keeps script-visible cookies when the native API returns none", async () => {
  const source = await readFile(new URL("bridge.js", resourceRoot), "utf8");

  assert.match(source, /cookieResult\.cookies\.length > 0 \|\| result\.cookies\.length === 0/);
  assert.match(source, /script_visible_fallback_with_explicit_site_permission/);
});

test("Safari sharing updates without a site-wide permission request", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted", "cookies", "readingList", "frames"].map((id) => [id, {
      disabled: id === "action",
      checked: false,
      textContent: "",
      classList: { toggle() {} },
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    }]),
  );
  let shared = false;
  const messages = [];
  const browser = {
    tabs: { query: async () => [{ id: 7, title: "Docs", url: "https://example.com" }] },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "get_state") {
          return {
            paired: true,
            gatewayLabel: "Mac Gateway",
            shared,
            connected: false,
            connectionError: null,
          };
        }
        if (message.type === "share_tab") shared = true;
        return { ok: true };
      },
    },
  };
  const context = {
    browser,
    document: { getElementById: (id) => elements[id] },
    Promise,
  };

  vm.runInNewContext(source, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));
  elements.action.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.some((message) => message.type === "share_tab"), true);
  assert.equal(messages.find((message) => message.type === "share_tab").tab.url, "https://example.com");
  assert.equal(elements.action.textContent, "Stop sharing");
});

test("Safari stop sharing updates the button when the active tab disappears during refresh", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted", "cookies", "readingList", "frames"].map((id) => [id, {
      disabled: id === "action",
      checked: false,
      textContent: "",
      classList: { toggle() {} },
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    }]),
  );
  let shared = true;
  let queryCount = 0;
  const messages = [];
  const browser = {
    tabs: {
      query: async () => {
        queryCount += 1;
        return queryCount === 1
          ? [{ id: 7, title: "Docs", url: "https://example.com" }]
          : [];
      },
    },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "get_state") {
          return {
            paired: true,
            gatewayLabel: "Mac Gateway",
            shared,
            connected: shared,
            connectionError: null,
          };
        }
        if (message.type === "revoke_tab") shared = false;
        return { ok: true };
      },
    },
  };
  const context = {
    browser,
    document: { getElementById: (id) => elements[id] },
    Date,
    Promise,
  };

  vm.runInNewContext(source, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.action.textContent, "Stop sharing");

  elements.action.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.filter((message) => message.type === "revoke_tab").length, 1);
  assert.equal(elements.action.textContent, "Share this tab");
});

test("Safari stop sharing does not roll back when its background response is lost", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted", "cookies", "readingList", "frames"].map((id) => [id, {
      disabled: id === "action",
      checked: false,
      textContent: "",
      classList: { toggle() {} },
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    }]),
  );
  let revokeRequested = false;
  const browser = {
    tabs: {
      query: async () => [{ id: 7, title: "Docs", url: "https://example.com" }],
    },
    runtime: {
      sendMessage: async (message) => {
        if (message.type === "get_state") {
          return {
            paired: true,
            gatewayLabel: "Mac Gateway",
            shared: true,
            connected: true,
            connectionError: null,
          };
        }
        if (message.type === "revoke_tab") {
          revokeRequested = true;
          await new Promise((resolve) => setImmediate(resolve));
          throw new Error("The background response was lost");
        }
        return { ok: true };
      },
    },
  };
  const context = {
    browser,
    document: { getElementById: (id) => elements[id] },
    Date,
    Promise,
  };

  vm.runInNewContext(source, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.action.textContent, "Stop sharing");

  elements.action.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(revokeRequested, true);
  assert.equal(elements.action.textContent, "Share this tab");
  assert.equal(elements.action.disabled, false);
});

test("Safari touch sharing preserves a visible background error", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted", "cookies", "readingList", "frames"].map((id) => [id, {
      disabled: id === "action",
      checked: false,
      textContent: "",
      classList: { toggle() {} },
      listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
    }]),
  );
  const messages = [];
  const browser = {
    tabs: { query: async () => [{ id: 9, title: "Docs", url: "https://example.com" }] },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "get_state") {
          return {
            paired: true,
            gatewayLabel: "Mac Gateway",
            shared: false,
            connected: false,
            connectionError: null,
          };
        }
        throw new Error("background unavailable");
      },
    },
  };
  const context = {
    browser,
    document: { getElementById: (id) => elements[id] },
    Date,
    Promise,
  };

  vm.runInNewContext(source, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));
  let prevented = false;
  elements.action.listeners.touchend({ preventDefault() { prevented = true; } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prevented, true);
  assert.equal(messages.filter((message) => message.type === "share_tab").length, 1);
  assert.equal(elements.connection.textContent, "Share failed");
  assert.equal(elements.detail.textContent, "background unavailable");
  assert.equal(elements.action.disabled, false);
});

test("Safari sharing persists before it installs the tab bridge", async () => {
  const source = await readFile(new URL("background.js", resourceRoot), "utf8");
  const injections = [];
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      sendNativeMessage: async () => ({
        ok: true,
        paired: true,
        deviceId: "d1",
        gatewayLabel: "Mac Gateway",
        gatewayBaseUrl: "http://192.0.2.1:8767",
        websocketUrl: "ws://192.0.2.1:8767/browser",
        sessionToken: "tok",
      }),
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async (value) => { persisted = value; },
        remove: async () => {},
        clear: async () => {},
      },
    },
    tabs: {
      get: () => new Promise(() => {}),
      sendMessage: async () => ({ ok: true }),
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    scripting: {
      executeScript: async (options) => { injections.push(options); },
    },
  };
  let persisted = null;
  const crypto = { getRandomValues: (bytes) => bytes.fill(7) };
  const context = { browser, crypto, URL, URLSearchParams, Uint8Array };
  vm.runInNewContext(
    `${source}\nglobalThis.__abgTest = { shareTab, sharedTabs };`,
    context,
    { filename: "background.js" },
  );

  const completed = await Promise.race([
    context.__abgTest.shareTab(7, {
      id: 7,
      url: "https://example.com/docs",
      title: "Docs",
    }).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);

  assert.equal(completed, true);
  assert.equal(context.__abgTest.sharedTabs.has(7), true);
  assert.equal(persisted.sharedTabs[0].tabId, 7);
  assert.equal(persisted.sharedTabs[0].bridgeToken, "07".repeat(16));
  assert.equal(injections.length, 1);
  assert.equal(injections[0].target.tabId, 7);
  assert.deepEqual(Array.from(injections[0].files), ["page-commands.js", "bridge.js"]);
});

test("Safari keeps each explicitly shared tab available", async () => {
  const source = await readFile(new URL("background.js", resourceRoot), "utf8");
  const tabs = new Map([
    [7, { id: 7, url: "https://example.com/one", title: "One" }],
    [8, { id: 8, url: "https://example.net/two", title: "Two" }],
  ]);
  let persisted = null;
  let connectListener = null;
  const gatewayMessages = [];
  const gatewaySocket = {
    readyState: 1,
    send(payload) { gatewayMessages.push(JSON.parse(payload)); },
  };
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener(listener) { connectListener = listener; } },
      sendNativeMessage: async () => ({
        ok: true,
        paired: true,
        deviceId: "d1",
        gatewayLabel: "Mac Gateway",
        websocketUrl: "ws://192.0.2.1:8767/browser",
        sessionToken: "tok",
      }),
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async (value) => { persisted = value; },
        remove: async () => {},
        clear: async () => {},
      },
    },
    tabs: {
      get: async (tabId) => tabs.get(tabId),
      sendMessage: async () => ({ ok: true }),
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    scripting: { executeScript: async () => {} },
  };
  const context = {
    browser,
    crypto: { getRandomValues: (bytes) => bytes.fill(7) },
    URL,
    URLSearchParams,
    Uint8Array,
    WebSocket: { OPEN: 1, CONNECTING: 0 },
  };
  context.__gatewaySocket = gatewaySocket;
  vm.runInNewContext(
    `${source}\nglobalThis.__abgMultiTabTest = { shareTab, sharedTabs, activate() { socket = globalThis.__gatewaySocket; authenticated = true; } };`,
    context,
    { filename: "background.js" },
  );

  await context.__abgMultiTabTest.shareTab(7, tabs.get(7));
  await context.__abgMultiTabTest.shareTab(8, tabs.get(8));

  assert.equal([...context.__abgMultiTabTest.sharedTabs.keys()].join(","), "7,8");
  assert.equal(persisted.sharedTabs.map((tab) => tab.tabId).join(","), "7,8");

  context.__abgMultiTabTest.activate();
  const secondTab = context.__abgMultiTabTest.sharedTabs.get(8);
  const port = {
    name: `abg-tab:8:${secondTab.bridgeToken}`,
    sender: { tab: { id: 8 } },
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
    disconnect() {},
  };
  connectListener(port);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(gatewayMessages.some((message) => message.type === "tab_permitted" && message.tabId === 8), true);
});

test("Safari revoke resolves without waiting for the page bridge to disconnect", async () => {
  const source = await readFile(new URL("background.js", resourceRoot), "utf8");
  const tab = { id: 7, url: "https://example.com/one", title: "One" };
  let stopRequested = false;
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      sendNativeMessage: async () => ({
        ok: true,
        paired: true,
        deviceId: "d1",
        gatewayLabel: "Mac Gateway",
        websocketUrl: "ws://192.0.2.1:8767/browser",
        sessionToken: "tok",
      }),
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
        clear: async () => {},
      },
    },
    tabs: {
      get: async () => tab,
      sendMessage: async (_tabId, message) => {
        if (message.type === "stop_bridge") {
          stopRequested = true;
          return new Promise(() => {});
        }
        return { ok: true };
      },
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    scripting: { executeScript: async () => {} },
  };
  const context = {
    browser,
    crypto: { getRandomValues: (bytes) => bytes.fill(7) },
    URL,
    URLSearchParams,
    Uint8Array,
    WebSocket: { OPEN: 1, CONNECTING: 0 },
  };
  vm.runInNewContext(
    `${source}\nglobalThis.__abgRevokeTest = { shareTab, revokeTab };`,
    context,
    { filename: "background.js" },
  );

  await context.__abgRevokeTest.shareTab(7, tab);
  const outcome = await Promise.race([
    context.__abgRevokeTest.revokeTab(7).then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timed_out"), 50)),
  ]);

  assert.equal(stopRequested, true);
  assert.equal(outcome, "resolved");
});

test("Safari tab bridge keeps the background active from the shared page", async () => {
  const source = await readFile(new URL("bridge.js", resourceRoot), "utf8");

  assert.match(source, /api\.runtime\.connect/);
  assert.match(source, /type: "heartbeat"/);
  assert.match(source, /setInterval\(sendHeartbeat, 5000\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pageshow/);
  assert.doesNotMatch(source, /new WebSocket/);
  assert.doesNotMatch(source, /createElement\("iframe"\)/);
});

test("Safari native messages are sent once through the Promise API", async () => {
  const source = await readFile(new URL("background.js", resourceRoot), "utf8");
  const messages = [];
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      sendNativeMessage: async (_applicationId, message) => {
        messages.push(message);
        return { ok: true, settings: {} };
      },
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
  };
  const context = {
    browser,
    crypto: { getRandomValues: (bytes) => bytes.fill(1) },
    URL,
    URLSearchParams,
    Uint8Array,
  };
  vm.runInNewContext(
    `${source}\nglobalThis.__abgNativeMessageTest = { sendNativeMessage };`,
    context,
    { filename: "background.js" },
  );

  await context.__abgNativeMessageTest.sendNativeMessage({ type: "get_gateway_session" });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "get_gateway_session");
});

test("Safari exposes the requested iPhone capability bridges", async () => {
  const [background, bridge, commands, companionModel] = await Promise.all([
    readFile(new URL("background.js", resourceRoot), "utf8"),
    readFile(new URL("bridge.js", resourceRoot), "utf8"),
    readFile(new URL("page-commands.js", resourceRoot), "utf8"),
    readFile(new URL("../../ABGCompanion/CompanionModel.swift", resourceRoot), "utf8"),
  ]);

  assert.match(bridge, /captureFullPage/);
  assert.match(bridge, /cropScreenshot/);
  assert.match(background, /allFrames: true/);
  assert.match(background, /api\.cookies\.getAll/);
  assert.match(background, /AES-GCM/);
  assert.match(background, /requestId: nativeMessage \? command\.id/);
  assert.match(background, /nativeAction: nativeMessage \? \{ kind: nativeMessage\.type/);
  assert.match(commands, /upload_file: uploadFile/);
  assert.match(commands, /prompt\("Comment"/);
  assert.match(commands, /mode must be area, text, or select/);
  assert.match(commands, /handle\.addEventListener\("pointerdown", \(event\) => beginTransform\(event, true\)\)/);
  assert.match(commands, /item\.kind = "text"/);
  assert.match(companionModel, /SSReadingList\.supportsURL/);
  assert.match(companionModel, /readingList\.addItem/);
});

test("Safari classifies every Chrome extension command", async () => {
  const typeSource = await readFile(new URL("../extension/src/types.ts", import.meta.url), "utf8");
  const commandSource = await readFile(new URL("page-commands.js", resourceRoot), "utf8");
  const gatewayMethodBlock = typeSource.match(/export type GatewayMethod =([\s\S]*?)export type OperationMethod/);
  assert.ok(gatewayMethodBlock);
  const gatewayMethods = [...gatewayMethodBlock[1].matchAll(/\| "([^"]+)"/g)].map((match) => match[1]);
  const context = {};
  vm.runInNewContext(commandSource, context, { filename: "page-commands.js" });

  const commands = context.__abgSafariPageCommands;
  const nativeHandlers = new Set(["frames", "screenshot", "raise_tab", "revoke", "approval_decide", "reading_list_add"]);
  const classified = new Set([
    ...Object.keys(commands.handlers),
    ...Object.keys(commands.unsupportedReasons),
    ...nativeHandlers,
  ]);

  assert.deepEqual(gatewayMethods.filter((method) => !classified.has(method)), []);
  assert.deepEqual([...classified].filter((method) => !gatewayMethods.includes(method)), []);
});

test("Safari page commands click and edit shared-page controls", async () => {
  const source = await readFile(new URL("page-commands.js", resourceRoot), "utf8");
  class FakeEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
  }
  class FakeElement {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName;
      this.ownerDocument = ownerDocument;
      this.nodeType = 1;
      this.parentElement = null;
      this.children = [];
      this.attributes = new Map();
      this.events = [];
      this.value = "";
      this.type = "text";
      this.checked = false;
      this.textContent = "";
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    querySelectorAll() { return []; }
    dispatchEvent(event) { this.events.push(event.type); return true; }
    focus() { this.ownerDocument.activeElement = this; }
    click() { this.clicked = true; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }
  }
  class FakeInput extends FakeElement {}
  class FakeTextArea extends FakeElement {}
  class FakeSelect extends FakeElement {}
  const bySelector = new Map();
  const document = {
    title: "Fixture",
    activeElement: null,
    documentElement: null,
    body: { innerText: "" },
    querySelectorAll(selector) {
      if (selector === "iframe,frame") return [];
      if (selector === "*") return [...bySelector.values()];
      return bySelector.has(selector) ? [bySelector.get(selector)] : [];
    },
  };
  document.defaultView = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  document.documentElement = new FakeElement("HTML", document);
  const button = new FakeElement("BUTTON", document);
  const input = new FakeInput("INPUT", document);
  const checkbox = new FakeInput("INPUT", document);
  checkbox.type = "checkbox";
  bySelector.set("#save", button);
  bySelector.set("#name", input);
  bySelector.set("#enabled", checkbox);
  const storage = { length: 0, key() { return null; }, getItem() { return null; } };
  const context = {
    window: null,
    document,
    location: { href: "https://example.com/fixture", origin: "https://example.com", assign() {} },
    performance: { getEntriesByType: () => [] },
    localStorage: storage,
    sessionStorage: storage,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    MouseEvent: FakeEvent,
    Event: FakeEvent,
    DataTransfer: class {},
    ClipboardEvent: FakeEvent,
    DragEvent: FakeEvent,
    MutationObserver: class {},
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout,
  };
  context.window = { ...document.defaultView, location: context.location, innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0 };
  vm.runInNewContext(source, context, { filename: "page-commands.js" });
  const handlers = context.__abgSafariPageCommands.handlers;

  assert.equal(handlers.click_selector({ selector: "#save" }).found, true);
  assert.equal(button.clicked, true);
  assert.equal(handlers.fill({ selector: "#name", value: "Alice" }).ok, true);
  assert.equal(input.value, "Alice");
  assert.equal(input.events.includes("input"), true);
  assert.equal(handlers.set_checked({ selector: "#enabled", checked: true }).changed, true);
  assert.equal(checkbox.checked, true);
});

test("Safari actions require companion approval unless trusted automation is enabled", async () => {
  const source = await readFile(new URL("background.js", resourceRoot), "utf8");
  const sent = [];
  const forwarded = [];
  const socket = {
    readyState: 1,
    send(payload) { sent.push(JSON.parse(payload)); },
  };
  const browser = {
    runtime: {
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      sendNativeMessage: async () => ({ ok: false, paired: false }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: {
      get: async () => { throw new Error("missing"); },
      sendMessage: async () => ({ ok: true }),
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
    },
  };
  const context = {
    browser,
    crypto: { randomUUID: () => "approval-1", getRandomValues: (bytes) => bytes.fill(1) },
    URL,
    URLSearchParams,
    Uint8Array,
    WebSocket: { OPEN: 1, CONNECTING: 0 },
    setTimeout,
    clearTimeout,
  };
  const isolated = { ...context, __testSocket: socket };
  vm.runInNewContext(
    `${source}\nglobalThis.__abgApprovalTest = { requestApproval, decideApproval, pendingApprovals, tabPorts, sharedTabs, activate() { socket = globalThis.__testSocket; authenticated = true; } };`,
    isolated,
    { filename: "background.js" },
  );
  isolated.__abgApprovalTest.activate();
  isolated.__abgApprovalTest.tabPorts.set(7, { postMessage(message) { forwarded.push(message); } });
  isolated.__abgApprovalTest.sharedTabs.set(7, { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-1" });
  isolated.__abgApprovalTest.requestApproval(
    { id: "command-1", method: "fill", params: { tabId: 7, selector: "#name", value: "Alice" } },
    { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-1" },
  );

  assert.equal(sent[0].type, "approval_pending");
  assert.equal(sent[0].approval.method, "fill");
  assert.equal(forwarded.length, 0);
  assert.equal((await isolated.__abgApprovalTest.decideApproval({ params: { approvalId: "approval-1", decision: "allow", decidedBy: "iphone" } })).applied, true);
  assert.equal(forwarded[0].command.id, "command-1");
  assert.equal(sent.some((message) => message.type === "approval_resolved"), true);

  isolated.__abgApprovalTest.requestApproval(
    { id: "command-2", method: "click_selector", params: { tabId: 7, selector: "#save" } },
    { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-1" },
  );
  isolated.__abgApprovalTest.sharedTabs.set(7, { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-2" });
  const stale = await isolated.__abgApprovalTest.decideApproval({ params: { approvalId: "approval-1", decision: "allow", decidedBy: "iphone" } });
  assert.equal(stale.applied, false);
  assert.equal(sent.some((message) => message.error?.code === "stale_approval"), true);
});
