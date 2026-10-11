import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCloudWebSocketUrl } from "../src/gatewayEndpoint.js";
import type { ApprovalToBackground, BackgroundToPopup, PopupToBackground } from "../src/types.js";
import { type ChromeMock, createChromeEvent, createChromeMock } from "./chromeMock.js";

class Socket extends EventTarget {
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  constructor(readonly url: string) {
    super();
    Socket.instances.push(this);
  }
  addEventListener(type: string, callback: EventListenerOrEventListenerObject): void {
    super.addEventListener(type, callback);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
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
  for (const socket of Socket.instances) socket.close();
  await vi.advanceTimersByTimeAsync(1);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Cloud connection boundary", () => {
  it("shares only web tabs in Cloud sandbox, rotates origin shares and revokes on disable", async () => {
    await configure();
    mock.tabs.tabs.set(2, { id: 2, active: false, currentWindow: true, incognito: false, url: "file:///tmp/private.html", title: "File" });
    expect(await message({ type: "set_all_tabs_access", value: true })).toEqual({ type: "ok" });
    const cloud = lastSocket(); cloud.open(); cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some(f => f.type === "tab_permitted")).toBe(true));
    expect(cloud.sent.filter(f => f.type === "tab_permitted")).toMatchObject([{ tabId: 1, accessMode: "all_tabs" }]);
    const frameCount = cloud.sent.length;
    await state(); await state();
    expect(cloud.sent).toHaveLength(frameCount);
    const newTab = { id: 3, active: false, currentWindow: true, incognito: false, url: "https://new.example.test/", title: "New" };
    mock.tabs.tabs.set(3, newTab); await mock.tabs.onCreated.dispatch(newTab);
    expect(cloud.sent.filter(f => f.type === "tab_permitted").at(-1)).toMatchObject({ tabId: 3, accessMode: "all_tabs" });
    const moved = { ...newTab, url: "https://other.example.test/" };
    mock.tabs.tabs.set(3, moved); await mock.tabs.onUpdated.dispatch(3, { url: moved.url }, moved);
    expect(cloud.sent.filter(f => f.type === "tab_permitted").at(-1)).toMatchObject({ tabId: 3, origin: "https://other.example.test" });
    await message({ type: "set_all_tabs_access", value: false });
    const current = await state();
    if (current.type === "state") expect(current.sharedTabs).toEqual([]);
    expect(cloud.sent.filter(f => f.type === "tab_revoked").map(f => f.tabId)).toEqual([1, 3]);
  });
  it("rejects sandbox controls on a manual share and rejects non-web Cloud tab creation", async () => {
    await configure(); await message({ type: "permit", tabId: 1 });
    const cloud = lastSocket(); cloud.open(); cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some(f => f.type === "tab_permitted")).toBe(true));
    cloud.message({ id: "manual-create", method: "sandbox_action", params: { tabId: 1, action: "tab-create", url: "https://new.example.test" } });
    await vi.waitFor(() => expect(cloud.sent.find(f => f.id === "manual-create")).toMatchObject({ error: { code: "sandbox_profile_required" } }));
    await message({ type: "revoke", tabId: 1 });
    await message({ type: "set_all_tabs_access", value: true });
    const sandbox = lastSocket(); sandbox.open(); sandbox.message({ type: "authenticated" });
    await vi.waitFor(() => expect(sandbox.sent.some(f => f.type === "tab_permitted")).toBe(true));
    await mock.storage.local.set({ operationsRequireApproval: false });
    sandbox.message({ id: "file-create", method: "sandbox_action", params: { tabId: 1, action: "tab-create", url: "file:///tmp/private.html" } });
    await vi.waitFor(() => expect(sandbox.sent.find(f => f.id === "file-create")).toMatchObject({ error: { code: "cloud_tab_unsupported" } }));
  });
  it("does not execute a pending sandbox operation after sandbox sharing is disabled", async () => {
    await configure(); await message({ type: "set_all_tabs_access", value: true });
    const cloud = lastSocket(); cloud.open(); cloud.message({ type: "authenticated" });
    await vi.waitFor(() => expect(cloud.sent.some(f => f.type === "tab_permitted")).toBe(true));
    cloud.message({ id: "pending-create", method: "sandbox_action", params: { tabId: 1, action: "tab-create", url: "https://new.example.test" } });
    await vi.waitFor(() => expect(cloud.sent.some(f => f.type === "approval_pending")).toBe(true));
    expect(mock.tabs.create).not.toHaveBeenCalled();
    const pending = cloud.sent.find(f => f.type === "approval_pending")?.approval as { approvalId: string };
    await message({ type: "set_all_tabs_access", value: false });
    expect(await message({ type: "approval_decision", approvalId: pending.approvalId, decision: "allow" },
      { id: mock.runtime.id, url: mock.runtime.getURL("approval.html") })).toEqual({ type: "ok" });
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.tabs.create).not.toHaveBeenCalled();
  });
  it.each([fixtureCode, undefined])("starts Cloud sandbox OFF after worker or browser restart (code=%s)", async (code) => {
    for (const socket of Socket.instances) socket.close();
    await vi.advanceTimersByTimeAsync(1);
    vi.resetModules(); mock = createChromeMock();
    Object.assign(mock.tabs, { onActivated: createChromeEvent() });
    mock.tabs.tabs.set(1, { id: 1, active: true, currentWindow: true, incognito: false, url: "https://page.example.test", title: "Fixture" });
    mock.permissions.contains.mockResolvedValue(true);
    await mock.storage.local.set({ connectionDestination: "cloud", cloudWebSocketUrl: "wss://gateway.example.test/ws", allTabsAccessEnabled: true });
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
