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

describe("keyboard event compatibility", () => {
  it.each(["cmd", "ctrl"])("sends keyCode for %s+A without typing a letter", async (modifier) => {
    const { chrome, command } = await startBackground();
    await command("key_press", { key: "a", modifiers: [modifier] });
    const events = chrome.debugger.sendCommand.mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent")
      .map(([, , payload]) => payload);
    expect(events).toEqual([
      {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: modifier === "cmd" ? 4 : 2,
        windowsVirtualKeyCode: 65,
      },
      {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: modifier === "cmd" ? 4 : 2,
        windowsVirtualKeyCode: 65,
      },
    ]);
  });
  it("keeps character input and individual key edges", async () => {
    const { chrome, command } = await startBackground();
    await command("key_press", { key: "7" });
    await command("key_down", { key: "ArrowLeft", modifiers: ["shift"] });
    await command("key_up", { key: "ArrowLeft", modifiers: ["shift"] });
    const events = chrome.debugger.sendCommand.mock.calls
      .filter(([, method]) => method === "Input.dispatchKeyEvent")
      .map(([, , payload]) => payload);
    expect(events).toHaveLength(5);
    expect(events[1]).toMatchObject({
      type: "char",
      text: "7",
      code: "Digit7",
      windowsVirtualKeyCode: 55,
    });
    expect(events[3]).toMatchObject({
      type: "keyDown",
      code: "ArrowLeft",
      modifiers: 8,
      windowsVirtualKeyCode: 37,
    });
    expect(events[4]).toMatchObject({ type: "keyUp", windowsVirtualKeyCode: 37 });
  });
});

describe("CodeMirror document operations", () => {
  async function fixture() {
    const host = await startBackground();
    let text = '{\n  "name": "Original"\n}';
    let readOnly = false,
      ignoreWrites = false;
    const setValue = vi.fn((value: string) => {
      if (!ignoreWrites) text = value;
    });
    const editor = { getValue: () => text, setValue, getOption: () => readOnly };
    const wrapper = {
      CodeMirror: editor as typeof editor | undefined,
      tagName: "DIV",
      getAttribute: () => null,
      closest: () => wrapper,
    };
    const input = {
      tagName: "TEXTAREA",
      value: "visible line only",
      getAttribute: () => null,
      closest: () => wrapper,
    };
    const page = {
      title: "Fixture",
      querySelectorAll: (selector: string) =>
        selector === ".CodeMirror" ? [wrapper] : selector === "textarea" ? [input] : [],
    };
    const location = { href: url, origin: new URL(url).origin };
    host.chrome.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method !== "Runtime.evaluate") return {};
      return {
        result: {
          value: new Function(
            "document",
            "window",
            "HTMLInputElement",
            "HTMLTextAreaElement",
            `return ${(params as { expression: string }).expression}`,
          )(page, { location }, class {}, class {}),
        },
      };
    });
    return {
      ...host,
      initial: text,
      setValue,
      input,
      wrapper,
      setReadOnly: () => {
        readOnly = true;
      },
      ignoreWrites: () => {
        ignoreWrites = true;
      },
    };
  }
  it("reads the full document and replaces it through the hidden input's editor", async () => {
    const f = await fixture();
    expect(
      await f.command("get_dom", { kind: "editable-value", selector: "textarea" }),
    ).toMatchObject({ result: { kind: "codemirror", source: "editor", editableText: f.initial } });
    const replacement = JSON.stringify({ name: "Replacement", unicode: "日本語" }, null, 2);
    expect(
      await f.command("fill", {
        selector: "textarea",
        value: replacement,
        expectedUrl: url,
        expectedValue: f.initial,
      }),
    ).toMatchObject({ result: { ok: true, kind: "codemirror", verified: true } });
    expect(f.input.value).toBe("visible line only");
    expect(
      await f.command("get_dom", { kind: "editable-value", selector: ".CodeMirror" }),
    ).toMatchObject({ result: { editableText: replacement } });
    expect(f.setValue).toHaveBeenCalledExactlyOnceWith(replacement);
  });
  it("previews without writing and refuses a stale document or navigated tab", async () => {
    const f = await fixture();
    expect(
      await f.command("fill", { selector: ".CodeMirror", value: "preview", dryRun: true }),
    ).toMatchObject({ result: { ok: true, dryRun: true, verified: false } });
    expect(
      await f.command("fill", {
        selector: ".CodeMirror",
        value: "changed",
        expectedValue: "stale",
      }),
    ).toMatchObject({ result: { ok: false, error: "editor_changed" } });
    expect(
      await f.command("fill", {
        selector: ".CodeMirror",
        value: "changed",
        expectedUrl: "https://other.test/",
      }),
    ).toMatchObject({ result: { ok: false, error: "page_changed" } });
    expect(f.setValue).not.toHaveBeenCalled();
  });
  it("refuses read-only or uninitialized editors and reports ignored writes", async () => {
    const f = await fixture();
    f.setReadOnly();
    expect(await f.command("fill", { selector: ".CodeMirror", value: "changed" })).toMatchObject({
      result: { ok: false, error: "editor_read_only" },
    });
    f.wrapper.CodeMirror = undefined;
    expect(await f.command("fill", { selector: "textarea", value: "changed" })).toMatchObject({
      result: { ok: false, error: "editor_unavailable" },
    });
    expect(f.setValue).not.toHaveBeenCalled();
    vi.resetModules();
    const ignored = await fixture();
    ignored.ignoreWrites();
    expect(
      await ignored.command("fill", { selector: ".CodeMirror", value: "changed" }),
    ).toMatchObject({ result: { ok: false, verified: false, error: "replacement_mismatch" } });
  });
});
