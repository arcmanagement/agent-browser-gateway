import { describe, expect, it } from "vitest";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  recentShortcutMessage,
  SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS,
  sharedTabSummary,
  shortcutHint,
  trustedAutomationNote,
} from "../src/popupLogic.js";
import type { ExtensionSettings } from "../src/types.js";

const baseSettings: ExtensionSettings = {
  allTabsAccessEnabled: false,
  evalEnabled: false,
  operationsRequireApproval: true,
  profileLabel: "",
  gatewayWebSocketUrl: "ws://127.0.0.1:8765/ws",
  trustedAutomationEnabled: false,
  bookmarksAccessEnabled: false,
  readingListAccessEnabled: false,
  personalDataMutationsEnabled: false,
};

describe("popupLogic", () => {
  it("summarizes trusted automation state", () => {
    expect(trustedAutomationNote(baseSettings)).toContain("When enabled");
    expect(trustedAutomationNote({ ...baseSettings, trustedAutomationEnabled: true })).toContain(
      "eval is disabled",
    );
    expect(
      trustedAutomationNote({
        ...baseSettings,
        evalEnabled: true,
        trustedAutomationEnabled: true,
      }),
    ).toContain("AutoMode is active");
  });

  it("summarizes all-tabs permission state", () => {
    expect(
      allTabsAccessNote(baseSettings, {
        active: false,
        permissionGranted: false,
        shareableTabCount: 0,
        skippedTabCount: 0,
      }),
    ).toContain("isolated sandbox profiles");
    expect(
      allTabsAccessNote(
        { ...baseSettings, allTabsAccessEnabled: true },
        { active: false, permissionGranted: false, shareableTabCount: 0, skippedTabCount: 0 },
      ),
    ).toContain("permission is missing");
    expect(
      allTabsAccessNote(baseSettings, {
        active: true,
        permissionGranted: true,
        shareableTabCount: 3,
        skippedTabCount: 1,
      }),
    ).toBe(
      "3 tabs are shared in sandbox mode. Browser-owned automation controls are enabled for this isolated profile.",
    );
  });

  it("formats annotation and shared-tab labels without DOM state", () => {
    expect(annotationButtonLabel({ enabled: false, count: 0 })).toBe("Annotate this tab");
    expect(annotationButtonLabel({ enabled: false, count: 2 })).toBe("2 annotations - Resume");
    expect(annotationButtonLabel({ enabled: true, count: 1 })).toBe("1 annotation - Done");
    expect(
      sharedTabSummary({
        accessMode: "all_tabs",
        tabId: 7,
        title: "Example",
        url: "https://example.com",
      }),
    ).toBe("🌐 [7] Example");
  });

  it("shows the bound shortcut keys and where to change them", () => {
    const hint = shortcutHint(
      [
        { name: "toggle-share-current-tab", shortcut: "⌥⇧S" },
        { name: "copy-current-tab-id", shortcut: "" },
        { name: "_execute_action", shortcut: "" },
      ],
      "chrome",
    );
    expect(hint).toBe(
      "Shortcuts: ⌥⇧S shares or revokes this tab, (not set) copies its tab ID. Change them at chrome://extensions/shortcuts.",
    );
    expect(shortcutHint([], "firefox")).toContain("about:addons > Manage Extension Shortcuts");
  });

  it("shows only recent shortcut results", () => {
    const feedback = {
      tabId: 7,
      level: "warning" as const,
      message: "Nothing was changed.",
      at: 0,
    };
    expect(recentShortcutMessage(undefined, 0)).toBeUndefined();
    expect(recentShortcutMessage(feedback, 1_000)).toBe("Last shortcut: Nothing was changed.");
    expect(recentShortcutMessage(feedback, SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS + 1)).toBeUndefined();
    expect(recentShortcutMessage({ ...feedback, at: 5_000 }, 0)).toBeUndefined();
  });
});
