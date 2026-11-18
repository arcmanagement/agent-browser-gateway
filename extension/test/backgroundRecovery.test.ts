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
  it("selects all editable text with the native shortcut and separate key edges", async () => {
    const { chrome, command } = await startBackground();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const platform = await page.evaluate(() => navigator.platform);
      vi.stubGlobal("navigator", { platform });
      const modifier = /Mac/i.test(platform) ? "cmd" : "ctrl";
      await page.setContent(
        '<input value="connection-ok"><textarea>connection-ok</textarea><div contenteditable="true">connection-ok</div>',
      );
      const session = await page.context().newCDPSession(page);
      chrome.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
        if (method === "Input.dispatchKeyEvent")
          return session.send(method, params as { type: "keyDown" | "keyUp" | "char" });
        return {};
      });
      for (const selector of ["input", "textarea", "div"]) {
        for (const separate of [false, true]) {
          const element = page.locator(selector);
          await element.evaluate((el) => {
            el.focus();
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.setSelectionRange(13, 13);
            } else {
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              const selection = getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }
          });
          const params = { key: "a", modifiers: [modifier] };
          if (separate) {
            await command("key_down", params);
            await command("key_up", params);
          } else {
            expect(await command("key_press", params)).toMatchObject({ result: { ok: true } });
          }
          expect(
            await element.evaluate((el) =>
              el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
                ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
                : getSelection()?.toString(),
            ),
          ).toBe("connection-ok");
        }
      }
    } finally {
      await browser.close();
    }
  });

  it("respects prevented shortcuts and still types ordinary letters", async () => {
    const { chrome, command } = await startBackground();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const platform = await page.evaluate(() => navigator.platform);
      vi.stubGlobal("navigator", { platform });
      const modifier = /Mac/i.test(platform) ? "cmd" : "ctrl";
      await page.setContent('<input value="connection-ok">');
      const session = await page.context().newCDPSession(page);
      chrome.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
        if (method === "Input.dispatchKeyEvent")
          return session.send(method, params as { type: "keyDown" | "keyUp" | "char" });
        return {};
      });
      const input = page.locator("input");
      await input.evaluate((el) => {
        if (!(el instanceof HTMLInputElement)) throw new Error("Expected input");
        el.focus();
        el.setSelectionRange(13, 13);
        el.addEventListener("keydown", (event) => {
          if (event.ctrlKey || event.metaKey) event.preventDefault();
        });
      });
      await command("key_press", { key: "a", modifiers: [modifier] });
      expect(
        await input.evaluate((el) => {
          if (!(el instanceof HTMLInputElement)) throw new Error("Expected input");
          return [el.selectionStart, el.selectionEnd];
        }),
      ).toEqual([13, 13]);
      const keyEvents = chrome.debugger.sendCommand.mock.calls
        .filter(([, method]) => method === "Input.dispatchKeyEvent")
        .map(([, , params]) => params);
      expect(keyEvents).toEqual([
        expect.objectContaining({ type: "keyDown", windowsVirtualKeyCode: 65 }),
        expect.objectContaining({ type: "keyUp", windowsVirtualKeyCode: 65 }),
      ]);
      await command("key_press", { key: "a" });
      expect(await input.inputValue()).toBe("connection-oka");
    } finally {
      await browser.close();
    }
  });

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

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function pngData(width: number, height: number): string {
  return btoa(String.fromCharCode(...pngBytes(width, height)));
}

// Mimics Chrome: a clip renders at clip size x clip.scale x device factor.
function captureAt(deviceFactor: number, layout: Record<string, unknown>) {
  return async (...args: unknown[]) => {
    const [, method, params] = args as [unknown, string, Record<string, unknown> | undefined];
    if (method === "Page.getLayoutMetrics") return layout;
    if (method === "Page.captureScreenshot") {
      const clip = params?.clip as { width: number; height: number; scale: number };
      return {
        data: pngData(
          Math.round(clip.width * clip.scale * deviceFactor),
          Math.round(clip.height * clip.scale * deviceFactor),
        ),
      };
    }
    return {};
  };
}

describe("screenshot scale", () => {
  const viewport = { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 };
  const captures = (chrome: ReturnType<typeof installChromeMock>) =>
    chrome.debugger.sendCommand.mock.calls.filter(
      ([, method]) => method === "Page.captureScreenshot",
    );

  it("returns CSS-pixel images on a device pixel ratio of 2 by default", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(
      captureAt(2, { cssVisualViewport: viewport, visualViewport: { clientWidth: 1600 } }),
    );
    expect(await command("screenshot")).toMatchObject({
      result: {
        imageSize: { width: 800, height: 600 },
        scale: 1,
        cssViewport: { width: 800, height: 600 },
      },
    });
    expect(captures(chrome)).toHaveLength(1);
    expect(captures(chrome)[0]?.[2]).toMatchObject({ clip: { scale: 0.5 } });
  });

  it.each([
    [0.5, 1, 400, 300],
    [0.5, 2, 400, 300],
    [2, 1, 1600, 1200],
    [2, 2, 1600, 1200],
  ])("applies scale %d on a device pixel ratio of %d", async (scale, ratio, width, height) => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(
      captureAt(ratio, {
        cssVisualViewport: viewport,
        visualViewport: { clientWidth: 800 * ratio },
      }),
    );
    const reply = await command("screenshot", { scale });
    expect(reply).toMatchObject({ result: { imageSize: { width, height }, scale } });
    const data = String((reply?.result as { dataUrl: string }).dataUrl).split(",")[1];
    const bytes = Uint8Array.from(atob(data ?? ""), (c) => c.charCodeAt(0));
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(width);
    expect(captures(chrome)).toHaveLength(1);
  });

  it("corrects an unknown device factor, such as page zoom, with one more capture", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(captureAt(2.5, { cssVisualViewport: viewport }));
    expect(await command("screenshot", { scale: 0.5 })).toMatchObject({
      result: { imageSize: { width: 400, height: 300 }, scale: 0.5 },
    });
    expect(captures(chrome)).toHaveLength(2);
  });

  it("scales a clipped region", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(
      captureAt(2, { cssVisualViewport: viewport, visualViewport: { clientWidth: 1600 } }),
    );
    expect(
      await command("screenshot", { clip: { x: 10, y: 20, width: 200, height: 100 }, scale: 0.5 }),
    ).toMatchObject({ result: { imageSize: { width: 100, height: 50 }, scale: 0.5 } });
  });

  it.each([0, 3, "1", -1])("rejects scale %s before capturing", async (scale) => {
    const { chrome, command } = await startBackground();
    expect(await command("screenshot", { scale })).toMatchObject({ error: expect.anything() });
    expect(captures(chrome)).toHaveLength(0);
  });

  it("resizes the visible-tab fallback to the requested scale", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.getLayoutMetrics") throw blocked();
      return {};
    });
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { width: 800, height: 600 } },
    ]);
    chrome.tabs.captureVisibleTab.mockResolvedValue(`data:image/png;base64,${pngData(1600, 1200)}`);
    const drawn: number[][] = [];
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1600, height: 1200, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext() {
          return { drawImage: (_image: unknown, ...box: number[]) => drawn.push(box) };
        }
        async convertToBlob() {
          return new Blob([pngBytes(this.width, this.height)]);
        }
      },
    );
    const reply = await command("screenshot", { scale: 0.5 });
    expect(reply).toMatchObject({
      result: {
        imageSize: { width: 400, height: 300 },
        scale: 0.5,
        cssViewport: { width: 800, height: 600 },
      },
    });
    expect(drawn).toEqual([[0, 0, 400, 300]]);
  });

  it("reports the real size when the fallback cannot resize", async () => {
    const { chrome, command } = await startBackground();
    chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.getLayoutMetrics") throw blocked();
      return {};
    });
    chrome.scripting.executeScript.mockResolvedValue([
      { frameId: 0, result: { width: 800, height: 600 } },
    ]);
    chrome.tabs.captureVisibleTab.mockResolvedValue(`data:image/png;base64,${pngData(1600, 1200)}`);
    expect(await command("screenshot")).toMatchObject({
      result: { imageSize: { width: 1600, height: 1200 }, scale: 2 },
    });
  });
});
