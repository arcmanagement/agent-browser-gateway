import { afterEach, describe, expect, it, vi } from "vitest";
import { browserAdapter } from "../src/browserAdapter.js";
import { installChromeMock } from "./chromeMock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserAdapter", () => {
  it("exposes Chrome APIs through a lazy adapter boundary", async () => {
    const chrome = installChromeMock();

    expect(browserAdapter.kind).toBe("chrome");
    expect(browserAdapter.runtime.id).toBe("test-extension-id");
    expect(browserAdapter.runtime.getURL("popup.html")).toBe(
      "chrome-extension://test-extension-id/popup.html",
    );

    await browserAdapter.storage.local.set({ extensionId: "abc" });
    await expect(browserAdapter.storage.local.get("extensionId")).resolves.toEqual({
      extensionId: "abc",
    });

    const tab = await browserAdapter.tabs.create({ url: "https://example.test" });
    expect(tab.id).toBe(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://example.test" });
    expect(browserAdapter.downloads.onCreated.hasListeners()).toBe(false);
    expect(browserAdapter.windows.onRemoved.hasListeners()).toBe(false);
  });
});
