import { describe, expect, it } from "vitest";
import type { AnnotationRestoreReport } from "../src/annotationOverlay.js";
import { formatText } from "../src/i18n.js";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  errorMessage,
  errorText,
  gatewayStatusPill,
  recentShortcutMessage,
  restoreAnnotationsLabel,
  restoreReportText,
  SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS,
  sharedTabAccessLabel,
  sharedTabSummary,
  sharedTabsHeading,
  shortcutHint,
  tabAccessStatusPill,
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
  uiLanguage: "auto",
};

const allTabsOff = {
  active: false,
  permissionGranted: false,
  shareableTabCount: 0,
  skippedTabCount: 0,
};
const normalTab = { incognito: false, incognitoAccessAllowed: true };

function restoreReport(
  status: AnnotationRestoreReport["status"],
  restored: number,
  unrestored: number,
  urls: { savedUrl?: string; currentUrl?: string } = {},
): AnnotationRestoreReport {
  const item = { uid: "u", kind: "dom", comment: "" };
  return {
    status,
    restored: Array.from({ length: restored }, (_, i) => ({
      ...item,
      displayNumber: i + 1,
      restoredBy: "selector" as const,
    })),
    unrestored: Array.from({ length: unrestored }, () => ({ ...item, reason: "not_found" })),
    alreadyPresent: 0,
    ...urls,
  };
}

describe("popupLogic", () => {
  it("summarizes trusted automation state", () => {
    expect(trustedAutomationNote(baseSettings, "en")).toContain("When enabled");
    expect(
      trustedAutomationNote({ ...baseSettings, trustedAutomationEnabled: true }, "en"),
    ).toContain("eval is disabled");
    expect(
      trustedAutomationNote(
        { ...baseSettings, evalEnabled: true, trustedAutomationEnabled: true },
        "en",
      ),
    ).toContain("AutoMode is active");
    expect(trustedAutomationNote(baseSettings, "ja")).toBe(
      "オンにすると、共有中のタブでの eval はローカルの承認ポップアップを省略できます。スクリプトは引き続き監査ログに記録されます。",
    );
  });

  it("summarizes all-tabs permission state", () => {
    expect(allTabsAccessNote(baseSettings, allTabsOff, "en")).toContain(
      "isolated sandbox profiles",
    );
    expect(
      allTabsAccessNote({ ...baseSettings, allTabsAccessEnabled: true }, allTabsOff, "en"),
    ).toContain("permission is missing");
    const active = {
      active: true,
      permissionGranted: true,
      shareableTabCount: 3,
      skippedTabCount: 1,
    };
    expect(allTabsAccessNote(baseSettings, active, "en")).toBe(
      "3 tabs are shared in sandbox mode. Browser-owned automation controls are enabled for this isolated profile.",
    );
    expect(allTabsAccessNote(baseSettings, { ...active, shareableTabCount: 1 }, "en")).toMatch(
      /^1 tab is shared in sandbox mode\./,
    );
    expect(allTabsAccessNote(baseSettings, active, "ja")).toMatch(
      /^サンドボックスモードで 3 個のタブを共有中です。/,
    );
  });

  it("formats annotation and shared-tab labels without DOM state", () => {
    expect(annotationButtonLabel({ enabled: false, count: 0 }, "en")).toBe("Annotate this tab");
    expect(annotationButtonLabel({ enabled: false, count: 2 }, "en")).toBe(
      "2 annotations - Resume",
    );
    expect(annotationButtonLabel({ enabled: true, count: 1 }, "en")).toBe("1 annotation - Done");
    expect(restoreAnnotationsLabel({ restorableCount: 0 }, "en")).toBeNull();
    expect(restoreAnnotationsLabel({ restorableCount: 1 }, "en")).toBe(
      "Restore 1 saved annotation",
    );
    expect(restoreAnnotationsLabel({ restorableCount: 3 }, "en")).toBe(
      "Restore 3 saved annotations",
    );
    expect(
      sharedTabSummary({
        accessMode: "all_tabs",
        tabId: 7,
        title: "Example",
        url: "https://example.com",
      }),
    ).toBe("🌐 [7] Example");
  });

  it("formats annotation labels in Japanese", () => {
    expect(annotationButtonLabel({ enabled: false, count: 0 }, "ja")).toBe(
      "このタブに注釈を付ける",
    );
    expect(annotationButtonLabel({ enabled: true, count: 1 }, "ja")).toBe("注釈 1 件 - 完了");
    expect(annotationButtonLabel({ enabled: false, count: 2 }, "ja")).toBe("注釈 2 件 - 再開");
    expect(restoreAnnotationsLabel({ restorableCount: 3 }, "ja")).toBe("保存済みの注釈 3 件を復元");
  });

  it("shows the bound shortcut keys and where to change them", () => {
    const commands = [
      { name: "toggle-share-current-tab", shortcut: "⌥⇧S" },
      { name: "copy-current-tab-id", shortcut: "" },
      { name: "_execute_action", shortcut: "" },
    ];
    expect(shortcutHint(commands, "chrome", "en")).toBe(
      "Shortcuts: ⌥⇧S shares or revokes this tab, (not set) copies its tab ID. Change them at chrome://extensions/shortcuts.",
    );
    expect(shortcutHint([], "firefox", "en")).toContain(
      "about:addons > Manage Extension Shortcuts",
    );
    expect(shortcutHint(commands, "chrome", "ja")).toBe(
      "ショートカット: ⌥⇧S でこのタブを共有／共有解除、（未設定） でタブ ID をコピーします。変更は chrome://extensions/shortcuts で行えます。",
    );
  });

  it("shows only recent shortcut results", () => {
    const feedback = {
      tabId: 7,
      level: "warning" as const,
      message: "Nothing was changed.",
      at: 0,
    };
    expect(recentShortcutMessage(undefined, 0, "en")).toBeUndefined();
    expect(recentShortcutMessage(feedback, 1_000, "en")).toBe(
      "Last shortcut: Nothing was changed.",
    );
    expect(
      recentShortcutMessage(feedback, SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS + 1, "en"),
    ).toBeUndefined();
    expect(recentShortcutMessage({ ...feedback, at: 5_000 }, 0, "en")).toBeUndefined();
  });

  it("re-formats a stored shortcut outcome in the current display language", () => {
    const feedback = {
      tabId: 7,
      level: "success" as const,
      message: 'Shared tab 7 ("Example") with agents.',
      at: 0,
      outcome: { kind: "shared" as const, tabId: 7, title: "Example" },
    };
    expect(recentShortcutMessage(feedback, 1_000, "en")).toBe(
      'Last shortcut: Shared tab 7 ("Example") with agents.',
    );
    expect(recentShortcutMessage(feedback, 1_000, "ja")).toBe(
      '直前のショートカット: タブ 7 ("Example") をエージェントと共有しました。',
    );
  });

  it("maps gateway connection to a status pill", () => {
    expect(gatewayStatusPill(true, "en")).toMatchObject({ label: "Connected", tone: "success" });
    expect(gatewayStatusPill(false, "en")).toMatchObject({
      label: "Disconnected",
      tone: "danger",
    });
    expect(gatewayStatusPill(true, "ja")).toEqual({
      label: "接続中",
      tone: "success",
      description: "Gateway に接続しています",
    });
  });

  it("keeps the active tab's consent state unambiguous", () => {
    expect(
      tabAccessStatusPill(
        { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
        "en",
      ),
    ).toEqual({ label: "Not shared", tone: "neutral" });
    expect(
      tabAccessStatusPill(
        { permitted: true, allTabsAccess: allTabsOff, activeTab: normalTab },
        "en",
      ),
    ).toEqual({ label: "Shared", tone: "success" });
    expect(
      tabAccessStatusPill(
        {
          permitted: false,
          allTabsAccess: allTabsOff,
          activeTab: { incognito: true, incognitoAccessAllowed: false },
        },
        "en",
      ),
    ).toEqual({ label: "Blocked", tone: "neutral" });
    expect(
      tabAccessStatusPill(
        {
          permitted: true,
          allTabsAccess: { ...allTabsOff, active: true, permissionGranted: true },
          activeTab: normalTab,
        },
        "en",
      ),
    ).toEqual({ label: "All tabs shared", tone: "warning" });
  });

  it("keeps shared and not-shared distinct in Japanese", () => {
    const shared = tabAccessStatusPill(
      { permitted: true, allTabsAccess: allTabsOff, activeTab: normalTab },
      "ja",
    );
    const notShared = tabAccessStatusPill(
      { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
      "ja",
    );
    expect(shared).toEqual({ label: "共有中", tone: "success" });
    expect(notShared).toEqual({ label: "未共有", tone: "neutral" });
  });

  it("labels shared-tab rows", () => {
    expect(sharedTabsHeading(2, "en")).toBe("Shared tabs (2)");
    expect(sharedTabsHeading(2, "ja")).toBe("共有中のタブ（2）");
    const tab = { tabId: 7, title: "Example", url: "https://example.com" };
    expect(sharedTabAccessLabel({ ...tab, accessMode: "all_tabs" }, "en")).toBe("all-tabs");
    expect(sharedTabAccessLabel({ ...tab, accessMode: "all_tabs" }, "ja")).toBe("全タブ");
    expect(sharedTabAccessLabel({ ...tab, accessMode: "manual" }, "en")).toBeNull();
  });

  it("formats restore results for the popup in the display language", () => {
    const restored = restoreReportText(restoreReport("restored", 2, 0));
    expect(formatText("en", restored)).toBe("Restored 2 annotations.");
    expect(formatText("ja", restored)).toBe("注釈を 2 件復元しました。");
    expect(formatText("en", restoreReportText(restoreReport("restored", 1, 0)))).toBe(
      "Restored 1 annotation.",
    );
    const partial = restoreReportText(restoreReport("partial", 2, 1));
    expect(formatText("en", partial)).toBe(
      "Restored 2 of 3 annotations. The other 1 could not be matched to the changed page, so they were not drawn.",
    );
    expect(formatText("ja", partial)).toMatch(/^3 件中 2 件の注釈を復元しました。/);
    const mismatch = restoreReportText(
      restoreReport("url_mismatch", 0, 0, { savedUrl: "https://a.test/" }),
    );
    expect(formatText("en", mismatch)).toBe(
      "Saved annotations belong to https://a.test/, but the tab now shows a different page. Nothing was restored.",
    );
    expect(formatText("ja", restoreReportText(restoreReport("no_saved_annotations", 0, 0)))).toBe(
      "このタブに保存済みの注釈はありません。何も復元していません。",
    );
    expect(formatText("ja", restoreReportText(restoreReport("already_present", 0, 0)))).toBe(
      "保存済みの注釈はすべてページに表示されています。",
    );
    expect(formatText("ja", restoreReportText(restoreReport("none_restored", 0, 2)))).toContain(
      "2 件を試行",
    );
  });

  it("translates known error codes and keeps other errors in English", () => {
    const known = {
      message: "Chrome has not granted ABG optional access to bookmarks in this profile.",
      code: "bookmarks_permission_required",
    };
    expect(errorText(known, "en")).toBe(
      "error: Chrome has not granted ABG optional access to bookmarks in this profile.",
    );
    expect(errorText(known, "ja")).toBe(
      "エラー: このプロファイルでは、ABG にブックマークへのアクセスが許可されていません。",
    );
    expect(errorText({ message: "socket closed", code: "something_new" }, "ja")).toBe(
      "エラー: socket closed",
    );
    expect(errorMessage({ message: "unknown message" }, "ja")).toBe("unknown message");
    expect(errorMessage({ message: "x", code: "constructor" }, "ja")).toBe("x");
  });
});
