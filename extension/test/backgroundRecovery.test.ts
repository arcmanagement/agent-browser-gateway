import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeEvent, installChromeMock } from "./chromeMock.js";

const tabId = 42;
const url = "https://example.test/form";
const blocked = () => new Error("Cannot access a chrome-extension:// URL of different extension");

async function startBackground() {
  const chrome = installChromeMock();
  Object.assign(chrome.tabs, { onActivated: createChromeEvent() });
  const tab = {
    id: tabId,
    url,
    title: "Form",
    active: true,
    currentWindow: true,
    incognito: false,
    windowId: 1,
  };
  chrome.tabs.tabs.set(tabId, tab);
  await chrome.storage.local.set({ operationsRequireApproval: false });
  await chrome.storage.session.set({
    permittedTabs: {
      [tabId]: {
        url,
        title: tab.title,
        origin: new URL(url).origin,
        permittedAt: 1,
        accessMode: "manual",
      },
    },
  });
  const listeners = new Map<string, (event: unknown) => void>();
  const sent: { id?: string; result?: unknown; error?: { code: string; message: string } }[] = [];
  const socketCreated = vi.fn();
  vi.stubGlobal("__ABG_WS_URL__", "ws://127.0.0.1:8765/ws");
  vi.stubGlobal(
    "WebSocket",
    class {
      readyState = 1;
      constructor() {
        socketCreated();
      }
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      }
      close() {}
      send(data: string) {
        sent.push(JSON.parse(data));
      }
    },
  );
  await import("../src/background.js");
  await vi.waitFor(() => expect(socketCreated).toHaveBeenCalled());
  listeners.get("open")?.({});
  let nextId = 0;
  const command = async (method: string, params: Record<string, unknown> = {}) => {
    const id = `command-${++nextId}`;
    listeners.get("message")?.({
      data: JSON.stringify({ id, method, params: { tabId, ...params } }),
    });
    await vi.waitFor(() => expect(sent.some((message) => message.id === id)).toBe(true));
    return sent.find((message) => message.id === id);
  };
  return { chrome, tab, command };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("background recovery boundaries", () => {
  it("activates native buttons with Enter and a held Space through debugger commands", async () => {
    const { chrome, command } = await startBackground();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<button onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1">Activate</button>',
      );
      const session = await page.context().newCDPSession(page);
      chrome.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
        if (method === "Input.dispatchKeyEvent")
          return session.send(method, params as { type: "keyDown" | "keyUp" | "char" });
        return {};
      });
      const button = page.locator("button");
      await button.focus();
      expect(await command("key_press", { key: "Enter" })).toMatchObject({ result: { ok: true } });
      expect(await button.getAttribute("data-clicks")).toBe("1");
      await command("key_down", { key: "Space" });
      expect(await button.getAttribute("data-clicks")).toBe("1");
      await command("key_up", { key: "Space" });
      expect(await button.getAttribute("data-clicks")).toBe("2");
    } finally {
      await browser.close();
    }
  });

  it("recovers Escape through scripting without replaying the debugger key operation", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Input.dispatchKeyEvent") throw blocked();
      return {};
    });
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { attempted: true, focusChanged: false } },
    ]);
    expect(await command("key_press", { key: "Escape" })).toMatchObject({
      result: { ok: true, recovery: { strategy: "escape", focusChanged: false } },
    });
    expect(
      chrome.debugger.sendCommand.mock.calls.filter(
        ([, method]) => method === "Input.dispatchKeyEvent",
      ),
    ).toHaveLength(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
  });

  it("stops recovery when the tab is revoked and shared again during a probe", async () => {
    const { chrome, tab, command } = await startBackground();
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { attempted: true, focusChanged: false } },
    ]);
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Input.dispatchKeyEvent") throw blocked();
      if (method === "Runtime.evaluate" && chrome.scripting.executeScript.mock.calls.length === 1) {
        await command("revoke");
        await chrome.commands.onCommand.dispatch("toggle-share-current-tab", tab);
        await vi.waitFor(() =>
          expect(chrome.storage.session.values.get("permittedTabs")).toMatchObject({
            [tabId]: { origin: new URL(url).origin, accessMode: "manual" },
          }),
        );
        throw blocked();
      }
      return {};
    });
    expect(await command("key_press", { key: "Escape" })).toMatchObject({
      error: { message: "tab not permitted" },
    });
    expect(
      chrome.scripting.executeScript.mock.calls.filter(
        ([injection]) => (injection as { args?: unknown[] }).args?.[0] === "escape",
      ),
    ).toHaveLength(1);
  });

  it("does not capture another active tab when the target loses activation", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockRejectedValue(blocked());
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { width: 800, height: 600 } },
    ]);
    chrome.tabs.query.mockResolvedValue([
      {
        id: 99,
        url: "https://private.test/",
        active: true,
        currentWindow: true,
        incognito: false,
        windowId: 1,
      },
    ]);
    expect(await command("screenshot")).toMatchObject({ error: expect.anything() });
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("discards a fallback capture if sharing is revoked while capture is in flight", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockRejectedValue(blocked());
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { width: 800, height: 600 } },
    ]);
    chrome.tabs.captureVisibleTab.mockImplementation(async () => {
      await command("revoke");
      return "data:image/png;base64,revoked";
    });
    expect(await command("screenshot")).toMatchObject({ error: { message: "tab not permitted" } });
  });

  it("captures the permitted active tab when debugger access is blocked", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.getLayoutMetrics") throw blocked();
      return {};
    });
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { width: 800, height: 600 } },
    ]);
    expect(await command("screenshot")).toMatchObject({
      result: { dataUrl: "data:image/png;base64,test", cssViewport: { width: 800, height: 600 } },
    });
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledExactlyOnceWith(1, { format: "png" });
  });
});
