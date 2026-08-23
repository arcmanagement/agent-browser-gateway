import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const resourceRoot = new URL("../ios/ABGCompanion/ABGSafariExtension/Resources/", import.meta.url);

test("Safari manifest keeps access user-scoped", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", resourceRoot), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions.includes("nativeMessaging"), true);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.equal(manifest.background.persistent, false);
  assert.equal(manifest.background.service_worker, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("Safari sharing updates without a site-wide permission request", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted"].map((id) => [id, {
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

test("Safari touch sharing preserves a visible background error", async () => {
  const source = await readFile(new URL("popup.js", resourceRoot), "utf8");
  const elements = Object.fromEntries(
    ["title", "detail", "action", "connection", "trusted"].map((id) => [id, {
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

test("Safari tab bridge keeps the background active from the shared page", async () => {
  const source = await readFile(new URL("bridge.js", resourceRoot), "utf8");

  assert.match(source, /api\.runtime\.connect/);
  assert.match(source, /type: "heartbeat"/);
  assert.match(source, /setInterval\(sendHeartbeat, 5000\)/);
  assert.doesNotMatch(source, /new WebSocket/);
  assert.doesNotMatch(source, /createElement\("iframe"\)/);
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
  const nativeHandlers = new Set(["frames", "screenshot", "raise_tab", "revoke", "approval_decide"]);
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
  assert.equal(isolated.__abgApprovalTest.decideApproval({ params: { approvalId: "approval-1", decision: "allow", decidedBy: "iphone" } }).applied, true);
  assert.equal(forwarded[0].command.id, "command-1");
  assert.equal(sent.some((message) => message.type === "approval_resolved"), true);

  isolated.__abgApprovalTest.requestApproval(
    { id: "command-2", method: "click_selector", params: { tabId: 7, selector: "#save" } },
    { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-1" },
  );
  isolated.__abgApprovalTest.sharedTabs.set(7, { tabId: 7, origin: "https://example.com", bridgeToken: "bridge-2" });
  const stale = isolated.__abgApprovalTest.decideApproval({ params: { approvalId: "approval-1", decision: "allow", decidedBy: "iphone" } });
  assert.equal(stale.applied, false);
  assert.equal(sent.some((message) => message.error?.code === "stale_approval"), true);
});
