import { afterEach, describe, expect, it, vi } from "vitest";
import { manageAnnotationMode } from "../src/annotationOverlay.js";
import { annotationOverlayStrings } from "../src/i18n.js";
import { installChromeMock } from "./chromeMock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error('Cannot access contents of url "chrome://newtab/"'),
    );
    chrome.debugger.sendCommand.mockResolvedValueOnce({
      result: { value: { ok: true, enabled: false, count: 0, annotations: [] } },
    });

    await manageAnnotationMode(42, { action: "restore", saved: [{ uid: "a" }] });

    const [, method, params] = chrome.debugger.sendCommand.mock.calls[0] as unknown as [
      unknown,
      string,
      { expression: string },
    ];
    expect(method).toBe("Runtime.evaluate");
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

    chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error('Cannot access contents of url "chrome://newtab/"'),
    );
    chrome.debugger.sendCommand.mockResolvedValueOnce({
      result: { value: { ok: true, enabled: true, count: 0, annotations: [] } },
    });
    await manageAnnotationMode(42, { action: "start", ui });
    const [, , params] = chrome.debugger.sendCommand.mock.calls[0] as unknown as [
      unknown,
      string,
      { expression: string },
    ];
    expect(params.expression).toContain('"done":"完了"');
    expect(params.expression).toContain('"countOther":"注釈 {count} 件"');
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
