import { describe, expect, it } from "vitest";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  sharedTabSummary,
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
});
