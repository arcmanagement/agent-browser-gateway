import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCloudWebSocketUrl } from "../src/gatewayEndpoint.js";
import type { ApprovalToBackground, BackgroundToPopup, PopupToBackground } from "../src/types.js";
import { type ChromeMock, createChromeEvent, createChromeMock } from "./chromeMock.js";

class Socket extends EventTarget {
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  listeners: [string, EventListenerOrEventListenerObject][] = [];
  dispose(): void {
    for (const [type, listener] of this.listeners) this.removeEventListener(type, listener);
    this.listeners = [];
  }
  constructor(readonly url: string) {
    super();
    Socket.instances.push(this);
  }
  addEventListener(type: string, callback: EventListenerOrEventListenerObject): void {
    this.listeners.push([type, callback]);
    super.addEventListener(type, callback);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}
function lastSocket(): Socket {
  const socket = Socket.instances.at(-1);
  if (!socket) throw new Error("Missing fixture socket.");
  return socket;
}
let mock: ChromeMock;
async function message(
  value: PopupToBackground | ApprovalToBackground,
  sender?: Record<string, unknown>,
): Promise<BackgroundToPopup> {
  return await new Promise((resolve) => {
    void mock.runtime.onMessage.dispatch(
      value,
      sender ?? { id: mock.runtime.id, url: mock.runtime.getURL("popup.html") },
      resolve as (response?: unknown) => void,
    );
  });
}
const fixtureRoute = `/ws/${"c".repeat(64)}`;
const fixtureCode = "a".repeat(43);
const state = () => message({ type: "get_state", tabId: 1 });
const configure = (
  cloudUrl = "https://gateway.example.test",
  code: string | undefined = fixtureCode,
) => message({ type: "set_connection_destination", destination: "cloud", cloudUrl, code });

describe("connection diagnostic integration", () => {
  async function diagnostics() {
    const response = await message({ type: "get_connection_diagnostics" });
    if (response.type !== "connection_diagnostics") throw new Error("Missing diagnostics");
    return response.events;
  }
  it("traces discovery, authentication and remote close without credentials or pages", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const socket = lastSocket();
    socket.open();
    socket.message({ type: "authenticated" });
    socket.close(4001);
    const events = await diagnostics();
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining([
        "worker_started",
        "discovery_started",
        "discovery_succeeded",
        "socket_connecting",
        "socket_open",
        "authentication_started",
        "authenticated",
        "socket_closed",
        "shares_cleared",
      ]),
    );
    expect(events.find((e) => e.event === "socket_closed" && e.closeCode === 4001)).toMatchObject({
      phase: "ready",
      destination: "cloud",
      sharedTabCount: 1,
      active: true,
    });
    for (const secret of [
      fixtureCode,
      fixtureRoute,
      "gateway.example.test",
      "page.example.test",
      '"Fixture"',
    ])
      expect(JSON.stringify(events)).not.toContain(secret);
  });
  it("identifies authentication timeout as a requested disconnect", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    lastSocket().open();
    await vi.advanceTimersByTimeAsync(10_001);
    const events = await diagnostics();
    expect(events.find((e) => e.event === "authentication_timeout")).toMatchObject({
      phase: "authenticating",
    });
    expect(events.find((e) => e.reason === "authentication_timeout")).toMatchObject({
      event: "disconnect_requested",
    });
  });
  it("records discovery HTTP failures before a socket can open", async () => {
    await configure();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("Denied secret", { status: 401 }));
    await message({ type: "permit", tabId: 1 });
    expect((await diagnostics()).find((e) => e.event === "discovery_failed")).toMatchObject({
      httpStatus: 401,
      active: true,
      aborted: false,
    });
  });
  it("keeps diagnostic history private to the extension popup", async () => {
    expect(
      await message(
        { type: "get_connection_diagnostics" },
        { id: mock.runtime.id, url: "https://page.example.test", tab: { id: 1 } },
      ),
    ).toMatchObject({ type: "error" });
  });
  it("attributes a delayed close to its original destination after switching to local", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const old = lastSocket();
    old.open();
    old.message({ type: "authenticated" });
    vi.spyOn(old, "close").mockImplementation(() => {
      old.readyState = 3;
    });
    await message({
      type: "set_connection_destination",
      destination: "local",
      cloudUrl: "https://gateway.example.test",
    });
    old.dispatchEvent(Object.assign(new Event("close"), { code: 1006, wasClean: false }));
    expect(
      (await diagnostics()).find((e) => e.event === "socket_closed" && e.closeCode === 1006),
    ).toMatchObject({ destination: "cloud", phase: "ready", active: false });
  });
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Socket.instances = [];
  mock = createChromeMock();
  Object.assign(mock.tabs, { onActivated: createChromeEvent() });
  mock.tabs.tabs.set(1, {
    id: 1,
    active: true,
    currentWindow: true,
    incognito: false,
    url: "https://page.example.test",
    title: "Fixture",
  });
  vi.stubGlobal("chrome", mock);
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("__ABG_WS_URL__", "ws://127.0.0.1:8765/ws");
  mock.permissions.contains.mockResolvedValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ path: fixtureRoute })),
  );
  await import("../src/background.js");
  await state();
});
afterEach(async () => {
  for (const socket of Socket.instances) {
    socket.dispose();
    socket.close();
  }
  await vi.advanceTimersByTimeAsync(1);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Cloud connection boundary", () => {
  it("requires fresh personal-data and automation consent when changing destinations", async () => {
    const optedIn = {
      operationsRequireApproval: false,
      evalEnabled: true,
      trustedAutomationEnabled: true,
      bookmarksAccessEnabled: true,
      readingListAccessEnabled: true,
      personalDataMutationsEnabled: true,
    };
    const safeDefaults = {
      operationsRequireApproval: true,
      evalEnabled: false,
      trustedAutomationEnabled: false,
      bookmarksAccessEnabled: false,
      readingListAccessEnabled: false,
      personalDataMutationsEnabled: false,
    };
    await mock.storage.local.set(optedIn);
    expect(await configure()).toEqual({ type: "ok" });
    expect(await mock.storage.local.get(Object.keys(safeDefaults))).toEqual(safeDefaults);
    await mock.storage.local.set(optedIn);
    expect(await configure()).toEqual({ type: "ok" });
    expect(await mock.storage.local.get(Object.keys(optedIn))).toEqual(optedIn);
    expect(await configure("https://other.example.test")).toEqual({ type: "ok" });
    expect(await mock.storage.local.get(Object.keys(safeDefaults))).toEqual(safeDefaults);
    await mock.storage.local.set(optedIn);
    expect(
      await message({ type: "set_connection_destination", destination: "local", cloudUrl: "" }),
    ).toEqual({ type: "ok" });
    expect(await mock.storage.local.get(Object.keys(safeDefaults))).toEqual(safeDefaults);
  });

  it("restores a saved login after browser restart without sharing tabs, and never mixes destinations", async () => {
    const a = {
      id: crypto.randomUUID(),
      name: "A",
      url: "wss://a.example.test/ws",
      code: fixtureCode,
    };
    const b = {
      id: crypto.randomUUID(),
      name: "B",
      url: "wss://b.example.test/ws",
      code: "b".repeat(43),
    };
    await mock.storage.local.set({ savedCloudConnections: [a, b] });
    expect(
      await message({
        type: "set_connection_destination",
        destination: "cloud",
        cloudUrl: a.url,
        savedId: a.id,
      }),
    ).toEqual({ type: "ok" });
    await mock.storage.session.clear();
    mock.runtime.onMessage.clear();
    mock.alarms.onAlarm.clear();
    vi.resetModules();
    await import("../src/background.js");
    const restored = await state();
    expect(restored).toMatchObject({
      type: "state",
      cloudCodeConfigured: true,
      sharedTabs: [],
      activeCloudConnectionId: a.id,
    });
    expect(JSON.stringify(restored)).not.toContain(fixtureCode);
    expect(JSON.stringify(restored)).not.toContain(b.code);
    expect(
      await message({
        type: "set_connection_destination",
        destination: "cloud",
        cloudUrl: b.url,
        savedId: a.id,
      }),
    ).toMatchObject({ type: "error" });
    expect(
      await message({
        type: "set_connection_destination",
        destination: "cloud",
        cloudUrl: b.url,
        savedId: b.id,
      }),
    ).toEqual({ type: "ok" });
    await message({ type: "permit", tabId: 1 });
    const socket = lastSocket();
    socket.open();
    expect(socket.sent[0]).toEqual({ type: "authenticate", token: b.code });
    expect(
      await message(
        { type: "delete_cloud_connection", id: b.id },
        { id: mock.runtime.id, url: "https://page.example.test/", tab: { id: 1 } },
      ),
    ).toMatchObject({ type: "error" });
    expect(await message({ type: "delete_cloud_connection", id: b.id })).toEqual({ type: "ok" });
    expect(await state()).toMatchObject({
      type: "state",
      cloudCodeConfigured: false,
      sharedTabs: [],
    });
    expect((await mock.storage.local.get("savedCloudConnections")).savedCloudConnections).toEqual([
      a,
    ]);
  });
  it("shares only web tabs in Cloud sandbox, rotates origin shares and revokes on disable", async () => {
    await configure();
    mock.tabs.tabs.set(2, {
      id: 2,
      active: false,
      currentWindow: true,
      incognito: false,
      url: "file:///tmp/private.html",
      title: "File",
    });
    expect(await message({ type: "set_all_tabs_access", value: true })).toEqual({ type: "ok" });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "tab_permitted")).toBe(true));
    expect(cloud.sent.filter((f) => f.type === "tab_permitted")).toMatchObject([
      { tabId: 1, accessMode: "all_tabs" },
    ]);
    const frameCount = cloud.sent.length;
    await state();
    await state();
    expect(cloud.sent).toHaveLength(frameCount);
    const newTab = {
      id: 3,
      active: false,
      currentWindow: true,
      incognito: false,
      url: "https://new.example.test/",
      title: "New",
    };
    mock.tabs.tabs.set(3, newTab);
    await mock.tabs.onCreated.dispatch(newTab);
    expect(cloud.sent.filter((f) => f.type === "tab_permitted").at(-1)).toMatchObject({
      tabId: 3,
      accessMode: "all_tabs",
    });
    const moved = { ...newTab, url: "https://other.example.test/" };
    mock.tabs.tabs.set(3, moved);
    await mock.tabs.onUpdated.dispatch(3, { url: moved.url }, moved);
    expect(cloud.sent.filter((f) => f.type === "tab_permitted").at(-1)).toMatchObject({
      tabId: 3,
      origin: "https://other.example.test",
    });
    await message({ type: "set_all_tabs_access", value: false });
    const current = await state();
    if (current.type === "state") expect(current.sharedTabs).toEqual([]);
    expect(cloud.sent.filter((f) => f.type === "tab_revoked").map((f) => f.tabId)).toEqual([1, 3]);
  });
  it("rejects sandbox controls on a manual share and rejects non-web Cloud tab creation", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "tab_permitted")).toBe(true));
    cloud.message({
      id: "manual-create",
      method: "sandbox_action",
      params: { tabId: 1, action: "tab-create", url: "https://new.example.test" },
    });
    await vi.waitFor(() =>
      expect(cloud.sent.find((f) => f.id === "manual-create")).toMatchObject({
        error: { code: "sandbox_profile_required" },
      }),
    );
    await message({ type: "revoke", tabId: 1 });
    await message({ type: "set_all_tabs_access", value: true });
    const sandbox = lastSocket();
    sandbox.open();
    sandbox.message({ type: "authenticated" });
    await vi.waitFor(() => expect(sandbox.sent.some((f) => f.type === "tab_permitted")).toBe(true));
    await mock.storage.local.set({ operationsRequireApproval: false });
    sandbox.message({
      id: "file-create",
      method: "sandbox_action",
      params: { tabId: 1, action: "tab-create", url: "file:///tmp/private.html" },
    });
    await vi.waitFor(() =>
      expect(sandbox.sent.find((f) => f.id === "file-create")).toMatchObject({
        error: { code: "cloud_tab_unsupported" },
      }),
    );
  });
  it("does not execute a pending sandbox operation after sandbox sharing is disabled", async () => {
    await configure();
    await message({ type: "set_all_tabs_access", value: true });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "tab_permitted")).toBe(true));
    cloud.message({
      id: "pending-create",
      method: "sandbox_action",
      params: { tabId: 1, action: "tab-create", url: "https://new.example.test" },
    });
    await vi.waitFor(() =>
      expect(cloud.sent.some((f) => f.type === "approval_pending")).toBe(true),
    );
    expect(mock.tabs.create).not.toHaveBeenCalled();
    const pending = cloud.sent.find((f) => f.type === "approval_pending")?.approval as {
      approvalId: string;
    };
    await message({ type: "set_all_tabs_access", value: false });
    expect(
      await message(
        { type: "approval_decision", approvalId: pending.approvalId, decision: "allow" },
        { id: mock.runtime.id, url: mock.runtime.getURL("approval.html") },
      ),
    ).toEqual({ type: "ok" });
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.tabs.create).not.toHaveBeenCalled();
  });
  it.each([
    fixtureCode,
    undefined,
  ])("starts Cloud sandbox OFF after worker or browser restart (code=%s)", async (code) => {
    for (const socket of Socket.instances) socket.close();
    await vi.advanceTimersByTimeAsync(1);
    vi.resetModules();
    mock = createChromeMock();
    Object.assign(mock.tabs, { onActivated: createChromeEvent() });
    mock.tabs.tabs.set(1, {
      id: 1,
      active: true,
      currentWindow: true,
      incognito: false,
      url: "https://page.example.test",
      title: "Fixture",
    });
    mock.permissions.contains.mockResolvedValue(true);
    await mock.storage.local.set({
      connectionDestination: "cloud",
      cloudWebSocketUrl: "wss://gateway.example.test/ws",
      allTabsAccessEnabled: true,
    });
    if (code) await mock.storage.session.set({ cloudConnectionCode: code });
    vi.stubGlobal("chrome", mock);
    const count = Socket.instances.length;
    await import("../src/background.js");
    const current = await state();
    if (current.type === "state") {
      expect(current.settings.allTabsAccessEnabled).toBe(false);
      expect(current.allTabsAccess.active).toBe(false);
      expect(current.sharedTabs).toEqual([]);
    }
    expect(Socket.instances).toHaveLength(count);
  });
  it.each([
    ["state_inspect", { kind: "cookie", includeValues: true }],
    ["get_dom", { kind: "value", selector: "textarea" }],
    ["get_dom", { kind: "editable-value", selector: "textarea" }],
    ["get_dom", { kind: "attr", name: "Value", selector: "input" }],
    ["network_log", { body: true }],
    ["describe", {}],
    ["find", { locator: "css", query: "input" }],
    ["snapshot", {}],
    ["validate_editable", { selector: "textarea" }],
  ])("Cloud %s skips read approval when operation approval is off", async (method, params) => {
    await configure();
    await message({ type: "set_operations_require_approval", value: false });
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "hello")).toBe(true));
    mock.debugger.sendCommand.mockResolvedValue({
      result: { value: { found: true, elements: [], matches: [] } },
      cookies: [],
    });
    cloud.message({ id: "read-no-approval", method, params: { ...params, tabId: 1 } });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.id === "read-no-approval")).toBe(true));
    expect(cloud.sent.find((f) => f.id === "read-no-approval")?.error).toBeUndefined();
    expect(cloud.sent.some((f) => f.type === "approval_pending")).toBe(false);
    expect(mock.windows.create).not.toHaveBeenCalled();
  });
  it.each([
    ["state_inspect", { kind: "cookie", includeValues: true }],
    ["get_dom", { kind: "value", selector: "input[type=password]" }],
    ["get_dom", { kind: "attr", name: "Value", selector: "input" }],
    ["network_log", { body: true }],
    ["describe", {}],
    ["find", { locator: "css", query: "input" }],
    ["snapshot", {}],
    ["validate_editable", { selector: "input" }],
    ["upload_file", { selector: "input[type=file]", files: ["/tmp/synthetic.txt"] }],
    ["read_dom", { _requireApproval: true }],
  ])("Cloud %s requests approval when operation approval is on", async (method, params) => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "hello")).toBe(true));
    expect(cloud.sent.find((f) => f.type === "hello")).toMatchObject({
      capabilities: ["cloud-browser-v2", "approval-policy-v1"],
    });
    const before = mock.debugger.sendCommand.mock.calls.length;
    cloud.message({ id: "sensitive", method, params: { ...params, tabId: 1 } });
    await vi.waitFor(() =>
      expect(cloud.sent.some((f) => f.type === "approval_pending")).toBe(true),
    );
    expect(cloud.sent.some((f) => f.id === "sensitive")).toBe(false);
    expect(mock.debugger.sendCommand.mock.calls.length).toBe(before);
    const pending = cloud.sent.find((f) => f.type === "approval_pending")?.approval as {
      approvalId: string;
    };
    await message(
      { type: "approval_decision", approvalId: pending.approvalId, decision: "deny" },
      { id: mock.runtime.id, url: mock.runtime.getURL("approval.html") },
    );
    await vi.waitFor(() =>
      expect(cloud.sent.find((f) => f.id === "sensitive")).toMatchObject({
        error: { code: "user_denied" },
      }),
    );
  });
  it.each([
    "password",
    "one-time-code",
  ])("Cloud DOM metadata and validation never expose %s control values", async (kind) => {
    const secret = "synthetic-credential-should-never-leave-page";
    class Input {
      tagName = "INPUT";
      type = kind === "password" ? "password" : "text";
      autocomplete = kind === "password" ? "current-password" : "section-login one-time-code";
      id = "credential";
      value = secret;
      placeholder = "";
      innerText = "";
      textContent = "";
      nodeType = 1;
      parentElement = null;
      getAttribute(name: string) {
        return name === "id" ? this.id : null;
      }
      hasAttribute() {
        return false;
      }
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
      }
      querySelectorAll() {
        return [];
      }
    }
    const input = new Input();
    const root = {
      querySelectorAll: (selector: string) =>
        selector === "*" || selector.includes("input") || selector === "#credential" ? [input] : [],
      children: [input],
    };
    const document = {
      ...root,
      body: root,
      documentElement: root,
      title: "Synthetic form",
      querySelector: () => input,
    };
    const window = {
      location: { href: "https://page.example.test", origin: "https://page.example.test" },
      innerWidth: 1000,
      innerHeight: 800,
    };
    mock.debugger.sendCommand.mockImplementation(async (...call: unknown[]) => {
      const [, method, params] = call;
      if (method !== "Runtime.evaluate") return {};
      const { expression } = params as { expression: string };
      return {
        result: {
          value: new Function(
            "document",
            "window",
            "Node",
            "Element",
            "HTMLElement",
            "HTMLInputElement",
            "HTMLTextAreaElement",
            "getComputedStyle",
            `return ${expression}`,
          )(document, window, { ELEMENT_NODE: 1 }, Input, Input, Input, class {}, () => ({
            visibility: "visible",
            display: "block",
            opacity: "1",
          })),
        },
      };
    });
    await configure();
    await message({ type: "set_operations_require_approval", value: false });
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "hello")).toBe(true));
    // Matching runs the actual injected expression against a React-style synced attribute.
    for (const selector of [
      'input[value^="synthetic"]',
      'input[VALUE^="synthetic"]',
      String.raw`input[\76 alue^="synthetic"]`,
      String.raw`input[va\lue^="synthetic"]`,
      "[*|value]",
      'input[type=password]:not([data-x="/*"])[value^="h"],z[data-y="*/"]',
      String.raw`input[type=password]:not(.a\/\*)[value^="h"],.b\*\/`,
    ]) {
      for (const [method, params] of [
        ["get_dom", { kind: "count", selector }],
        ["predicate", { kind: "visible", selector }],
        ["wait_for", { selector, timeoutMs: 1000 }],
        ["get_dom", { kind: "count", selector: "input", frame: selector }],
      ] as const) {
        const id = `oracle-${cloud.sent.length}`;
        cloud.message({ id, method, params: { ...params, tabId: 1 } });
        await vi.waitFor(() =>
          expect(cloud.sent.find((f) => f.id === id)).toMatchObject({
            error: { code: "credential_value_forbidden" },
          }),
        );
      }
    }
    for (const [method, params] of [
      ["describe", {}],
      ["find", { locator: "css", query: "input" }],
      ["snapshot", {}],
      ["validate_editable", { selector: "input" }],
    ] as const) {
      const id = `privacy-${method}`;
      cloud.message({ id, method, params: { ...params, tabId: 1 } });
      await vi.waitFor(() => expect(cloud.sent.some((f) => f.id === id)).toBe(true));
      expect(cloud.sent.some((f) => f.type === "approval_pending")).toBe(false);
      const response = cloud.sent.find((f) => f.id === id)!;
      expect(JSON.stringify(response)).not.toContain(secret);
      if (method === "validate_editable")
        expect(response).toMatchObject({ error: { code: "credential_value_forbidden" } });
      else expect(response.error).toBeUndefined();
    }
  });
  it("shows every upload path and preserves a recording expiry error", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some((f) => f.type === "hello")).toBe(true));
    const longPath = "/Users/fixture/Downloads/" + "./".repeat(100) + ".ssh/id_ed25519";
    cloud.message({
      id: "files",
      method: "upload_file",
      params: { tabId: 1, selector: "input", files: ["~/Downloads/a.pdf", longPath] },
    });
    await vi.waitFor(() =>
      expect(cloud.sent.some((f) => f.type === "approval_pending")).toBe(true),
    );
    const pending = cloud.sent.find((f) => f.type === "approval_pending")?.approval as {
      approvalId: string;
    };
    expect(JSON.stringify(pending)).toContain("~/Downloads/a.pdf");
    expect(JSON.stringify(pending)).toContain(longPath);
    await message(
      { type: "approval_decision", approvalId: pending.approvalId, decision: "deny" },
      { id: mock.runtime.id, url: mock.runtime.getURL("approval.html") },
    );
    cloud.message({
      id: "expired",
      method: "record_read",
      params: { tabId: 1, recordingId: "missing" },
    });
    await vi.waitFor(() =>
      expect(cloud.sent.find((f) => f.id === "expired")).toMatchObject({
        error: { code: "recording_unavailable" },
      }),
    );
  });
  it("discovers only on the configured host and keeps the code out of the URL", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("https://gateway.example.test/ws/connect");
    expect(String(url)).not.toContain(fixtureCode);
    expect(options).toMatchObject({
      credentials: "omit",
      redirect: "error",
      body: JSON.stringify({ token: fixtureCode }),
    });
    expect(lastSocket().url).toBe(`wss://gateway.example.test${fixtureRoute}`);
  });
  it("rejects discovery that tries to redirect the browser to another host", async () => {
    await configure();
    const count = Socket.instances.length;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ path: "wss://other.example.test/ws" }));
    await message({ type: "permit", tabId: 1 });
    expect(Socket.instances).toHaveLength(count);
    const current = await state();
    if (current.type === "state") {
      expect(current.sharedTabs).toEqual([]);
      expect(current.cloudConnectionFailed).toBe(true);
    }
  });
  it("does not send a code without access to the selected Cloud host", async () => {
    await configure();
    mock.permissions.contains.mockResolvedValue(false);
    await message({ type: "permit", tabId: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(mock.debugger.attach).not.toHaveBeenCalled();
  });
  it("drops delayed discovery after switching to Local", async () => {
    await configure();
    let complete: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const sharing = message({ type: "permit", tabId: 1 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await message({ type: "set_connection_destination", destination: "local", cloudUrl: "" });
    const count = Socket.instances.length;
    complete(Response.json({ path: fixtureRoute }));
    await sharing;
    expect(Socket.instances).toHaveLength(count);
    lastSocket().open();
    expect(lastSocket().sent.some((frame) => frame.type === "authenticate")).toBe(false);
    const current = await state();
    if (current.type === "state") expect(current.sharedTabs).toEqual([]);
  });
  it("waits for stored settings before heartbeat can connect after worker restart", async () => {
    for (const socket of Socket.instances) socket.close();
    vi.clearAllTimers();
    vi.resetModules();
    Socket.instances = [];
    mock = createChromeMock();
    mock.permissions.contains.mockResolvedValue(true);
    Object.assign(mock.tabs, { onActivated: createChromeEvent() });
    mock.tabs.tabs.set(1, {
      id: 1,
      active: true,
      currentWindow: true,
      incognito: false,
      url: "https://page.example.test",
      title: "Fixture",
    });
    await mock.storage.local.set({
      connectionDestination: "cloud",
      cloudWebSocketUrl: "wss://gateway.example.test/ws",
    });
    await mock.storage.session.set({ cloudConnectionCode: fixtureCode });
    let finishIdentity: (value: Record<string, unknown>) => void = () => {};
    mock.storage.local.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishIdentity = resolve;
        }),
    );
    vi.stubGlobal("chrome", mock);
    await import("../src/background.js");
    const heartbeat = mock.alarms.onAlarm.dispatch({ name: "heartbeat" });
    expect(Socket.instances).toHaveLength(0);
    finishIdentity({ extensionId: "fixture" });
    await heartbeat;
    await state();
    expect(Socket.instances).toHaveLength(0);
    await message({ type: "permit", tabId: 1 });
    for (const socket of Socket.instances) socket.open();
    expect(
      Socket.instances.every(
        (socket) => socket.url === `wss://gateway.example.test${fixtureRoute}`,
      ),
    ).toBe(true);
    expect(Socket.instances.flatMap((socket) => socket.sent)).toEqual([
      { type: "authenticate", token: fixtureCode },
    ]);
  });
  it("rejects a Cloud-ineligible tab without ending valid shares and bounds titles", async () => {
    await configure();
    mock.tabs.tabs.set(2, {
      id: 2,
      active: false,
      currentWindow: true,
      incognito: false,
      url: "file:///tmp/fixture.html",
      title: "File",
    });
    const tab = mock.tabs.tabs.get(1);
    if (!tab) throw new Error("missing fixture tab");
    tab.title = "x".repeat(2049);
    await message({ type: "permit", tabId: 1 });
    const cloud = Socket.instances.at(-1);
    if (!cloud) throw new Error("missing Cloud socket");
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() =>
      expect(cloud.sent.some((frame) => frame.type === "tab_permitted")).toBe(true),
    );
    const invalid = await message({ type: "permit", tabId: 2 });
    expect(invalid).toMatchObject({ type: "error", code: "cloud_tab_unsupported" });
    expect(cloud.sent.filter((frame) => frame.type === "tab_permitted")).toMatchObject([
      { tabId: 1, title: "x".repeat(2048) },
    ]);
    expect(cloud.readyState).toBe(1);
    const current = await state();
    if (current.type === "state") expect(current.sharedTabs.map((tab) => tab.tabId)).toEqual([1]);
    await mock.tabs.onUpdated.dispatch(1, { title: "y".repeat(2049) }, tab);
    expect(cloud.sent.filter((frame) => frame.type === "tab_updated").at(-1)).toMatchObject({
      title: "y".repeat(2048),
    });
  });
  it("can switch to Local despite an invalid draft Cloud URL", async () => {
    await configure();
    expect(
      await message({
        type: "set_connection_destination",
        destination: "local",
        cloudUrl: "http://invalid.example.test",
      }),
    ).toEqual({ type: "ok" });
    const current = await state();
    if (current.type === "state") expect(current.settings.connectionDestination).toBe("local");
  });
  it("keeps the connection closed if storing a destination change fails", async () => {
    await configure();
    mock.storage.session.set.mockRejectedValueOnce(new Error("Synthetic storage failure"));
    const count = Socket.instances.length;
    const applied = await message({
      type: "set_connection_destination",
      destination: "local",
      cloudUrl: "",
    });
    expect(applied.type).toBe("error");
    expect(await message({ type: "permit", tabId: 1 })).toMatchObject({
      type: "error",
      code: "connection_changing",
    });
    await mock.alarms.onAlarm.dispatch({ name: "heartbeat" });
    expect(Socket.instances).toHaveLength(count);
  });
  it("keeps idle Cloud disconnected and sends authentication before any shared tab", async () => {
    expect((await configure()).type).toBe("ok");
    expect(Socket.instances).toHaveLength(1);
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    expect(cloud.url).toBe(`wss://gateway.example.test${fixtureRoute}`);
    cloud.open();
    expect(cloud.sent).toEqual([{ type: "authenticate", token: fixtureCode }]);
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() =>
      expect(cloud.sent.some((frame) => frame.type === "tab_permitted")).toBe(true),
    );
    expect(JSON.stringify(await state())).not.toContain(fixtureCode);
    expect((await mock.storage.local.get(null)).cloudConnectionCode).toBeUndefined();
    expect((await mock.storage.session.get("cloudConnectionCode")).cloudConnectionCode).toBe(
      fixtureCode,
    );
  });
  it("does not transfer shares or reuse a connection code with a new Cloud URL", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ type: "authenticated" });
    await vi.waitFor(() =>
      expect(cloud.sent.some((frame) => frame.type === "tab_permitted")).toBe(true),
    );
    expect((await configure("https://other.example.test", "")).type).toBe("error");
    expect(
      (await message({ type: "set_connection_destination", destination: "local", cloudUrl: "" }))
        .type,
    ).toBe("ok");
    const current = await state();
    expect(current.type).toBe("state");
    if (current.type === "state") {
      expect(current.sharedTabs).toEqual([]);
      expect(current.cloudConnectionFailed).toBe(false);
    }
    const local = lastSocket();
    local.open();
    await Promise.resolve();
    expect(local.sent.some((frame) => frame.type === "tab_permitted")).toBe(false);
    expect(local.sent.some((frame) => frame.type === "authenticate")).toBe(false);
  });
  it("rejects commands received before authentication and stops sharing on rejection", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket();
    cloud.open();
    cloud.message({ id: "early", method: "screenshot", params: { tabId: 1 } });
    expect(cloud.readyState).toBe(3);
    expect(cloud.sent).toEqual([{ type: "authenticate", token: fixtureCode }]);
    const current = await state();
    if (current.type === "state") {
      expect(current.sharedTabs).toEqual([]);
      expect(current.cloudConnectionFailed).toBe(true);
    }
  });
  it("does not forward an old read response to the replacement connection", async () => {
    await configure();
    await message({ type: "permit", tabId: 1 });
    const previous = lastSocket();
    previous.open();
    previous.message({ type: "authenticated" });
    await vi.waitFor(() =>
      expect(previous.sent.some((frame) => frame.type === "tab_permitted")).toBe(true),
    );
    let completeCapture: (result: { data: string }) => void = () => {};
    const capture = new Promise<{ data: string }>((resolve) => {
      completeCapture = resolve;
    });
    mock.debugger.sendCommand.mockImplementation(async (...args: unknown[]) =>
      args[1] === "Page.captureScreenshot" ? await capture : {},
    );
    previous.message({ id: "old-read", method: "screenshot", params: { tabId: 1 } });
    await vi.waitFor(() =>
      expect(
        mock.debugger.sendCommand.mock.calls.some(
          (args) => (args as unknown[])[1] === "Page.captureScreenshot",
        ),
      ).toBe(true),
    );
    await configure("https://replacement.example.test", "b".repeat(43));
    await message({ type: "permit", tabId: 1 });
    const replacement = lastSocket();
    replacement.open();
    replacement.message({ type: "authenticated" });
    await vi.waitFor(() =>
      expect(replacement.sent.some((frame) => frame.type === "tab_permitted")).toBe(true),
    );
    completeCapture({ data: "synthetic-page-content" });
    await vi.advanceTimersByTimeAsync(1);
    expect(replacement.sent.some((frame) => frame.id === "old-read")).toBe(false);
    expect(JSON.stringify(replacement.sent)).not.toContain("synthetic-page-content");
  });
  it("allows destination changes only from the extension popup", async () => {
    const result = await message(
      {
        type: "set_connection_destination",
        destination: "cloud",
        cloudUrl: "https://other.example.test",
        code: fixtureCode,
      },
      { id: mock.runtime.id, url: "https://page.example.test", tab: { id: 1 } },
    );
    expect(result.type).toBe("error");
    expect(
      (await mock.storage.session.get("cloudConnectionCode")).cloudConnectionCode,
    ).toBeUndefined();
  });
});

describe("Saved Cloud Sandbox resume", () => {
  async function optIn() {
    const saved = {
      id: crypto.randomUUID(),
      name: "Isolated",
      url: "wss://gateway.example.test/ws",
      code: fixtureCode,
    };
    await mock.storage.local.set({ savedCloudConnections: [saved] });
    expect(
      await message({
        type: "set_connection_destination",
        destination: "cloud",
        cloudUrl: saved.url,
        savedId: saved.id,
      }),
    ).toEqual({ type: "ok" });
    await message({ type: "set_all_tabs_access", value: true });
    const socket = lastSocket();
    socket.open();
    socket.message({ type: "authenticated" });
    await vi.waitFor(() => expect(socket.sent.some((f) => f.type === "tab_permitted")).toBe(true));
    expect(await message({ type: "set_cloud_sandbox_resume", value: true })).toEqual({
      type: "ok",
    });
    return { saved, socket };
  }
  async function restartWorker() {
    // Simulates process termination: no callbacks from the old worker.
    for (const socket of Socket.instances) socket.dispose();
    mock.runtime.onMessage.clear();
    mock.alarms.onAlarm.clear();
    mock.permissions.onRemoved.clear();
    await mock.storage.session.clear();
    vi.clearAllTimers();
    vi.resetModules();
    await import("../src/background.js");
    return state();
  }
  async function allowInputs() {
    const current = await optIn();
    await message({ type: "set_operations_require_approval", value: false });
    await message({ type: "set_trusted_automation_enabled", value: true });
    return current;
  }
  it.each([
    "value",
    "editable-value",
    "attr",
  ])("reads %s without repeated prompts after explicit Sandbox consent", async (kind) => {
    const { socket } = await allowInputs();
    mock.debugger.sendCommand.mockResolvedValue({
      result: { value: { found: true, value: "synthetic draft" } },
    });
    socket.message({
      id: "input",
      method: "get_dom",
      params: { tabId: 1, kind, name: "value", selector: "textarea" },
    });
    await vi.waitFor(() =>
      expect(socket.sent.find((f) => f.id === "input")).toMatchObject({
        result: { found: true, value: "synthetic draft" },
      }),
    );
    expect(socket.sent.some((f) => f.type === "approval_pending")).toBe(false);
  });
  it("uploads through native file input without repeated prompts after explicit Sandbox consent", async () => {
    const { socket } = await allowInputs();
    Object.assign(mock.extension, { isAllowedFileSchemeAccess: vi.fn(async () => true) });
    mock.debugger.sendCommand.mockImplementation(async (...call: unknown[]) => {
      switch (call[1]) {
        case "DOM.getDocument":
          return { root: { nodeId: 1 } };
        case "DOM.querySelector":
          return { nodeId: 2 };
        case "DOM.describeNode":
          return {
            node: {
              nodeName: "INPUT",
              attributes: ["type", "file", "multiple", ""],
              backendNodeId: 3,
            },
          };
        default:
          return {};
      }
    });
    mock.scripting.executeScript.mockResolvedValue([{ result: { files: 2 } }]);
    socket.message({
      id: "upload",
      method: "upload_file",
      params: {
        tabId: 1,
        selector: "input[type=file]",
        files: ["/tmp/staging/one.png", "/tmp/staging/two.png"],
      },
    });
    await vi.waitFor(() =>
      expect(socket.sent.find((f) => f.id === "upload")).toMatchObject({
        result: { ok: true, files: 2 },
      }),
    );
    expect(mock.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, "DOM.setFileInputFiles", {
      backendNodeId: 3,
      files: ["/tmp/staging/one.png", "/tmp/staging/two.png"],
    });
    expect(socket.sent.some((f) => f.type === "approval_pending")).toBe(false);
  });
  it.each([
    "/tmp/staging/../secret.png",
    "/tmp/staging/.ssh/id_ed25519",
    "/tmp/staging/profile-mediaid/Default/Cookies",
  ])("still prompts for paths with protected or ambiguous names: %s", async (path) => {
    const { socket } = await allowInputs();
    socket.message({
      id: "outside",
      method: "upload_file",
      params: { tabId: 1, selector: "input[type=file]", files: [path] },
    });
    await vi.waitFor(() =>
      expect(socket.sent.some((f) => f.type === "approval_pending")).toBe(true),
    );
    expect(mock.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 1 },
      "DOM.setFileInputFiles",
      expect.anything(),
    );
  });
  it.each([
    "get_dom",
    "upload_file",
    "state_inspect",
    "snapshot",
    "describe",
    "find",
    "validate_editable",
    "network_log",
    "read_dom",
  ])("retains explicit account policy approval for %s", async (method) => {
    const { socket } = await allowInputs();
    socket.message({
      id: "policy",
      method,
      params: {
        tabId: 1,
        selector: "textarea",
        kind: method === "state_inspect" ? "cookie" : "value",
        includeValues: true,
        body: true,
        files: ["/tmp/one.png"],
        _requireApproval: true,
      },
    });
    await vi.waitFor(() =>
      expect(socket.sent.some((f) => f.type === "approval_pending")).toBe(true),
    );
    expect(socket.sent.some((f) => f.id === "policy")).toBe(false);
  });
  it.each([
    "sandbox",
    "resume",
    "trust",
    "approval",
    "permission",
    "credential",
  ])("does not automate after %s consent changes", async (change) => {
    const { saved } = await allowInputs();
    if (change === "sandbox") await message({ type: "set_all_tabs_access", value: false });
    if (change === "resume") await message({ type: "set_cloud_sandbox_resume", value: false });
    if (change === "trust") await message({ type: "set_trusted_automation_enabled", value: false });
    if (change === "approval")
      await message({ type: "set_operations_require_approval", value: true });
    if (change === "permission") mock.permissions.contains.mockResolvedValue(false);
    if (change === "credential")
      await mock.storage.local.set({ savedCloudConnections: [{ ...saved, code: "b".repeat(43) }] });
    if (change === "sandbox") {
      expect(await state()).toMatchObject({ allTabsAccess: { active: false }, sharedTabs: [] });
      return;
    }
    const socket = lastSocket();
    socket.message({
      id: "after-revoke",
      method: "get_dom",
      params: { tabId: 1, kind: "value", selector: "textarea" },
    });
    await vi.waitFor(() =>
      expect(
        socket.sent.some((f) => f.type === "approval_pending" || f.id === "after-revoke"),
      ).toBe(true),
    );
    expect(socket.sent.find((f) => f.id === "after-revoke")?.result).toBeUndefined();
  });
  it("restores only explicitly opted-in saved Sandbox and authenticates before announcing", async () => {
    await optIn();
    const current = await restartWorker();
    expect(current).toMatchObject({ allTabsAccess: { active: true, resumeEnabled: true } });
    const socket = lastSocket();
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([{ type: "authenticate", token: fixtureCode }]);
    socket.message({ type: "authenticated" });
    await vi.waitFor(() => expect(socket.sent.some((f) => f.type === "tab_permitted")).toBe(true));
  });
  it("rediscovers the route and reauthenticates after transient disconnection", async () => {
    const { socket } = await optIn();
    const count = Socket.instances.length;
    socket.close();
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({ allTabsAccess: { resumeEnabled: true, active: true } }),
    );
    await vi.advanceTimersByTimeAsync(3001);
    expect(Socket.instances.length).toBeGreaterThan(count);
    const next = lastSocket();
    next.open();
    expect(next.sent).toEqual([{ type: "authenticate", token: fixtureCode }]);
    next.message({ type: "authenticated" });
    await vi.waitFor(() => expect(next.sent.some((f) => f.type === "tab_permitted")).toBe(true));
  });
  it("turning Sandbox off cancels pending resume and does not return after restart", async () => {
    const { socket } = await optIn();
    socket.close();
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({ allTabsAccess: { active: true } }),
    );
    expect(await message({ type: "set_all_tabs_access", value: false })).toEqual({ type: "ok" });
    expect(await state()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
      sharedTabs: [],
    });
    const count = Socket.instances.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(Socket.instances).toHaveLength(count);
    expect(await restartWorker()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
      sharedTabs: [],
    });
  });
  it("permission revocation cancels consent even after regrant and restart", async () => {
    await optIn();
    await mock.permissions.remove({ origins: ["<all_urls>"] });
    await mock.permissions.request({ origins: ["<all_urls>"] });
    expect((await mock.storage.local.get("cloudSandboxResume")).cloudSandboxResume).toBeUndefined();
    expect(await restartWorker()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
      sharedTabs: [],
    });
  });
  it("a replacement browser stops resume instead of repeatedly evicting it", async () => {
    const { socket } = await optIn();
    socket.close(4001);
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({
        allTabsAccess: { active: false, resumeEnabled: false },
        sharedTabs: [],
      }),
    );
    const count = Socket.instances.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(Socket.instances).toHaveLength(count);
    expect(await restartWorker()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
    });
  });
  it.each([
    "credential",
    "endpoint",
    "permission",
    "expiry",
  ])("does not restore when %s changes", async (kind) => {
    const { saved } = await optIn();
    if (kind === "credential")
      await mock.storage.local.set({ savedCloudConnections: [{ ...saved, code: "b".repeat(43) }] });
    if (kind === "endpoint")
      await mock.storage.local.set({ cloudWebSocketUrl: "wss://other.example.test/ws" });
    if (kind === "permission") mock.permissions.contains.mockResolvedValue(false);
    if (kind === "expiry")
      await mock.storage.local.set({
        savedCloudConnections: [{ ...saved, expiresAt: new Date(Date.now() - 1000).toISOString() }],
      });
    expect(await restartWorker()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
      sharedTabs: [],
    });
  });
  it("changing destination cancels resume and does not migrate consent", async () => {
    await optIn();
    await configure("https://other.example.test", "b".repeat(43));
    expect(await state()).toMatchObject({
      allTabsAccess: { active: false, resumeEnabled: false },
      sharedTabs: [],
    });
    expect((await mock.storage.local.get("cloudSandboxResume")).cloudSandboxResume).toBeUndefined();
  });
  it("stops automatic resume on revoked credentials", async () => {
    const { socket } = await optIn();
    vi.mocked(fetch).mockResolvedValue(new Response("Denied", { status: 401 }));
    socket.close();
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({ allTabsAccess: { active: true, resumeEnabled: true } }),
    );
    await vi.advanceTimersByTimeAsync(3001);
    await vi.waitFor(async () =>
      expect(await state()).toMatchObject({
        allTabsAccess: { active: false, resumeEnabled: false },
      }),
    );
    const count = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(count);
  });
  it("rejects website messages and requires saved Sandbox consent", async () => {
    expect(await message({ type: "set_cloud_sandbox_resume", value: true })).toMatchObject({
      type: "error",
    });
    await optIn();
    expect(
      await message(
        { type: "set_cloud_sandbox_resume", value: false },
        { id: mock.runtime.id, url: "https://page.example.test", tab: { id: 1 } },
      ),
    ).toMatchObject({ type: "error" });
    expect(await state()).toMatchObject({ allTabsAccess: { resumeEnabled: true } });
  });
});

describe("Cloud endpoint", () => {
  it("accepts secure URLs and local test endpoints", () => {
    expect(normalizeCloudWebSocketUrl("https://gateway.example.test")).toBe(
      "wss://gateway.example.test/ws",
    );
    expect(normalizeCloudWebSocketUrl("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/ws");
  });
  it.each([
    "http://gateway.example.test",
    "ws://gateway.example.test/ws",
    "https://user:password@gateway.example.test",
    "https://gateway.example.test/?token=fixture",
    "https://gateway.example.test/not-ws",
  ])("rejects unsafe endpoint %s", (value) => {
    expect(() => normalizeCloudWebSocketUrl(value)).toThrow();
  });
});
