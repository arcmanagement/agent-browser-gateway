import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationToolbarPreferencesFromDebugger,
  forgetAnnotationDebuggerContext,
  manageAnnotationMode,
} from "../src/annotationOverlay.js";
import { annotationOverlayStrings } from "../src/i18n.js";
import { installChromeMock } from "./chromeMock.js";

afterEach(() => {
  forgetAnnotationDebuggerContext(42);
  vi.unstubAllGlobals();
});

function mockDebuggerFallback(chrome: ReturnType<typeof installChromeMock>, enabled = false) {
  chrome.scripting.executeScript.mockRejectedValueOnce(
    new Error('Cannot access contents of url "chrome://newtab/"'),
  );
  chrome.debugger.sendCommand
    .mockResolvedValueOnce({ frameTree: { frame: { id: "top-frame" } } })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ executionContextId: 17 })
    .mockResolvedValueOnce({
      result: { value: { ok: true, enabled, count: 0, annotations: [] } },
    });
}

describe("annotationOverlay", () => {
  it("runs annotation commands through chrome.scripting", async () => {
    const chrome = installChromeMock();
    chrome.scripting.executeScript.mockResolvedValueOnce([
      {
        result: {
          ok: true,
          enabled: true,
          count: 2,
          annotations: [{ id: 1 }, { id: 2 }],
        },
      },
    ]);

    const result = await manageAnnotationMode(42, { action: "list" });

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      // Without strings from the caller the overlay falls back to English.
      args: [{ action: "list", persist: true, ui: annotationOverlayStrings("en") }],
      func: expect.any(Function),
      target: { tabId: 42 },
    });
    expect(result).toEqual({
      ok: true,
      enabled: true,
      count: 2,
      annotations: [{ id: 1 }, { id: 2 }],
    });
  });

  it("passes saved annotations for restore and keeps persistence off in the debugger world", async () => {
    const chrome = installChromeMock();
    mockDebuggerFallback(chrome);

    await manageAnnotationMode(42, { action: "restore", saved: [{ uid: "a" }] });

    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 42 }, "Runtime.addBinding", {
      name: "__abgAnnotationToolbarChanged",
      executionContextName: "abg-annotation",
    });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 42 },
      "Page.createIsolatedWorld",
      { frameId: "top-frame", worldName: "abg-annotation" },
    );
    const [, method, params] = chrome.debugger.sendCommand.mock.calls[3] as unknown as [
      unknown,
      string,
      { expression: string; contextId: number },
    ];
    expect(method).toBe("Runtime.evaluate");
    expect(params.contextId).toBe(17);
    expect(params.expression).toContain('"toolbarBinding":"__abgAnnotationToolbarChanged"');
    expect(params.expression).toContain('"persist":false');
    expect(params.expression).toContain('"saved":[{"uid":"a"}]');
    expect(params.expression).not.toContain('"persist":true');
  });

  it("passes the display-language string table in both execution paths", async () => {
    const chrome = installChromeMock();
    const ui = annotationOverlayStrings("ja");
    chrome.scripting.executeScript.mockResolvedValueOnce([
      { result: { ok: true, enabled: true, count: 0, annotations: [] } },
    ]);
    await manageAnnotationMode(42, { action: "start", ui });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ args: [{ action: "start", persist: true, ui }] }),
    );

    mockDebuggerFallback(chrome, true);
    await manageAnnotationMode(42, { action: "start", ui });
    const [, , params] = chrome.debugger.sendCommand.mock.calls[3] as unknown as [
      unknown,
      string,
      { expression: string },
    ];
    expect(params.expression).toContain('"done":"完了"');
    expect(params.expression).toContain('"countOther":"注釈 {count} 件"');
  });

  it("accepts toolbar updates only from the registered isolated context and rejects stale bindings", async () => {
    const chrome = installChromeMock();
    mockDebuggerFallback(chrome, true);
    await manageAnnotationMode(42, { action: "start" });
    const preferences = { x: 0.25, y: 0.75, collapsed: true };
    const event = {
      name: "__abgAnnotationToolbarChanged",
      executionContextId: 17,
      payload: JSON.stringify(preferences),
    };
    expect(annotationToolbarPreferencesFromDebugger(42, event)).toEqual(preferences);
    expect(annotationToolbarPreferencesFromDebugger(43, event)).toBeUndefined();
    for (const invalid of [
      null,
      { ...event, name: "otherBinding" },
      { ...event, executionContextId: 18 },
      { ...event, payload: "{" },
      { ...event, payload: " ".repeat(513) },
      { ...event, payload: JSON.stringify({ ...preferences, x: 2 }) },
    ]) {
      expect(annotationToolbarPreferencesFromDebugger(42, invalid)).toBeUndefined();
    }
    forgetAnnotationDebuggerContext(42);
    expect(annotationToolbarPreferencesFromDebugger(42, event)).toBeUndefined();
  });

  it("normalizes unexpected content-script results", async () => {
    const chrome = installChromeMock();
    chrome.scripting.executeScript.mockResolvedValueOnce([{ result: { ok: false } }]);

    await expect(manageAnnotationMode(42, { action: "list" })).resolves.toEqual({
      ok: true,
      enabled: false,
      count: 0,
      annotations: [],
      nextCommand: "abg annotate <tab>",
    });
  });
});
