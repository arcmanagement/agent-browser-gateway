import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeEvent, installChromeMock } from "./chromeMock.js";

const tabId = 42;
const url = "https://example.test/form";

async function startBackground(accessMode: "manual" | "all_tabs" | null = "manual") {
  const chrome = installChromeMock();
  const onActivated = createChromeEvent<[{ tabId: number; windowId: number }]>();
  Object.assign(chrome.tabs, { onActivated });
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
  if (accessMode) {
    await chrome.storage.session.set({
      permittedTabs: {
        [tabId]: {
          url,
          title: tab.title,
          origin: "https://example.test",
          permittedAt: 1,
          accessMode,
        },
      },
    });
  }
  if (accessMode === "all_tabs") {
    await chrome.storage.local.set({ allTabsAccessEnabled: true });
    chrome.permissions.origins.add("<all_urls>");
  }
  const socketCreated = vi.fn();
  vi.stubGlobal("__ABG_WS_URL__", "ws://127.0.0.1:8765/ws");
  vi.stubGlobal(
    "WebSocket",
    class {
      readyState = 0;
      constructor() {
        socketCreated();
      }
      addEventListener() {}
      close() {}
      send() {}
    },
  );
  await import("../src/background.js");
  await vi.waitFor(() => expect(socketCreated).toHaveBeenCalled());
  return { chrome, tab, onActivated };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared tab action badge", () => {
  it("restores the manual share badge when the service worker resumes", async () => {
    const { chrome } = await startBackground();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId, text: "ON" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId, color: "#34c759" });
  });

  it.each([
    "loading",
    "complete",
  ])("restores the manual share badge after reload status %s", async (status) => {
    const { chrome, tab } = await startBackground();
    chrome.action.setBadgeText.mockClear();
    await chrome.tabs.onUpdated.dispatch(tabId, { status }, tab);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId, text: "ON" });
    expect(chrome.storage.session.values.get("permittedTabs")).toMatchObject({
      [tabId]: { accessMode: "manual" },
    });
  });

  it("keeps the badge on same-origin navigation", async () => {
    const { chrome, tab } = await startBackground();
    const nextUrl = "https://example.test/next";
    await chrome.tabs.onUpdated.dispatch(tabId, { url: nextUrl }, { ...tab, url: nextUrl });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId, text: "ON" });
  });

  it("clears the badge and permission on cross-origin navigation", async () => {
    const { chrome, tab } = await startBackground();
    const nextUrl = "https://other.test/";
    await chrome.tabs.onUpdated.dispatch(tabId, { url: nextUrl }, { ...tab, url: nextUrl });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId, text: "" });
    expect(chrome.storage.session.values.get("permittedTabs")).toEqual({});
  });

  it("restores the all-tabs badge without converting it to manual sharing", async () => {
    const { chrome, tab } = await startBackground("all_tabs");
    await chrome.tabs.onUpdated.dispatch(tabId, { status: "complete" }, tab);
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ tabId, text: "ALL" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      tabId,
      color: "#0a84ff",
    });
  });

  it("does not show a shared badge on an unshared tab", async () => {
    const { chrome, tab } = await startBackground(null);
    await chrome.tabs.onUpdated.dispatch(tabId, { status: "complete" }, tab);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId, text: "ON" });
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId, text: "ALL" });
  });
});
