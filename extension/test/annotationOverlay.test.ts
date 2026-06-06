import { afterEach, describe, expect, it, vi } from "vitest";
import { manageAnnotationMode } from "../src/annotationOverlay.js";
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
      args: [{ action: "list" }],
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
