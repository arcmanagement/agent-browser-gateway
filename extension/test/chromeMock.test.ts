import { afterEach, describe, expect, it, vi } from "vitest";
import { createChromeEvent, installChromeMock } from "./chromeMock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chromeMock", () => {
  it("installs a runtime global with deterministic extension URLs", () => {
    const chrome = installChromeMock();

    expect(globalThis.chrome).toBe(chrome);
    expect(chrome.runtime.id).toBe("test-extension-id");
    expect(chrome.runtime.getURL("/popup.html")).toBe(
      "chrome-extension://test-extension-id/popup.html",
    );
  });

  it("supports extension storage get, set, remove, and clear", async () => {
    const chrome = installChromeMock();

    await chrome.storage.local.set({ extensionId: "abc", enabled: true });
    await expect(chrome.storage.local.get("extensionId")).resolves.toEqual({
      extensionId: "abc",
    });
    await expect(chrome.storage.local.get(["extensionId", "enabled"])).resolves.toEqual({
      enabled: true,
      extensionId: "abc",
    });
    await expect(chrome.storage.local.get({ missing: "fallback" })).resolves.toEqual({
      missing: "fallback",
    });

    await chrome.storage.local.remove("enabled");
    await expect(chrome.storage.local.get(null)).resolves.toEqual({ extensionId: "abc" });

    await chrome.storage.local.clear();
    await expect(chrome.storage.local.get(null)).resolves.toEqual({});
  });

  it("tracks listeners and dispatches Chrome-style events", async () => {
    const event = createChromeEvent<[string, number]>();
    const listener = vi.fn();

    event.addListener(listener);
    expect(event.hasListener(listener)).toBe(true);
    await event.dispatch("ready", 1);

    expect(listener).toHaveBeenCalledWith("ready", 1);

    event.removeListener(listener);
    expect(event.hasListeners()).toBe(false);
  });

  it("tracks tab lifecycle calls and emitted tab events", async () => {
    const chrome = installChromeMock();
    const createdListener = vi.fn();
    const updatedListener = vi.fn();

    chrome.tabs.onCreated.addListener(createdListener);
    chrome.tabs.onUpdated.addListener(updatedListener);

    const tab = await chrome.tabs.create({ url: "https://example.test", active: true });
    expect(tab).toMatchObject({
      active: true,
      currentWindow: true,
      id: 1,
      url: "https://example.test",
    });
    expect(createdListener).toHaveBeenCalledWith(tab);

    await chrome.tabs.update(tab.id, { active: false });
    expect(updatedListener).toHaveBeenCalledWith(tab.id, { active: false }, expect.any(Object));

    await expect(chrome.tabs.query({ currentWindow: true })).resolves.toHaveLength(1);
    await chrome.tabs.remove(tab.id);
    await expect(chrome.tabs.query({ currentWindow: true })).resolves.toHaveLength(0);
  });

  it("records optional permission grants", async () => {
    const chrome = installChromeMock();

    await expect(chrome.permissions.contains({ origins: ["<all_urls>"] })).resolves.toBe(false);
    await expect(chrome.permissions.request({ origins: ["<all_urls>"] })).resolves.toBe(true);
    await expect(chrome.permissions.contains({ origins: ["<all_urls>"] })).resolves.toBe(true);

    await expect(chrome.permissions.remove({ origins: ["<all_urls>"] })).resolves.toBe(true);
    await expect(chrome.permissions.contains({ origins: ["<all_urls>"] })).resolves.toBe(false);
  });
});
