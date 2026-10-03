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
  shortcutHint,
  shortcutKeys,
  tabGate,
  tabHost,
  tabRiskFlags,
  trustedAutomationNote,
  visibleSharedTabs,
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
const allTabsOn = { ...allTabsOff, active: true, permissionGranted: true };
const normalTab = { incognito: false, incognitoAccessAllowed: true };
const web = "https://example.com/page";

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
    expect(trustedAutomationNote(baseSettings, "en")).toBe(
      "Lets eval on shared tabs skip the approval window. Scripts are still audited.",
    );
    expect(
      trustedAutomationNote({ ...baseSettings, trustedAutomationEnabled: true }, "en"),
    ).toContain("eval stays off");
    expect(
      trustedAutomationNote(
        { ...baseSettings, evalEnabled: true, trustedAutomationEnabled: true },
        "en",
      ),
    ).toMatch(/^On: eval on shared tabs runs without an approval window/);
    expect(trustedAutomationNote(baseSettings, "ja")).toBe(
      "共有中のタブでの eval で、承認ウィンドウを省略します。スクリプトは監査ログに記録されます。",
    );
  });

  it("summarizes all-tabs permission state", () => {
    expect(allTabsAccessNote(baseSettings, allTabsOff, "en")).toContain("isolated sandbox profile");
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
      "3 tabs shared. Browser automation controls are on for this isolated profile.",
    );
    expect(allTabsAccessNote(baseSettings, { ...active, shareableTabCount: 1 }, "en")).toMatch(
      /^1 tab shared\./,
    );
    expect(allTabsAccessNote(baseSettings, active, "ja")).toMatch(/^3 個のタブを共有中です。/);
  });

  it("formats annotation and shared-tab labels without DOM state", () => {
    expect(annotationButtonLabel({ enabled: false, count: 0 }, "en")).toBe("Annotate this tab");
    expect(annotationButtonLabel({ enabled: false, count: 2 }, "en")).toBe("Resume annotating (2)");
    expect(annotationButtonLabel({ enabled: true, count: 1 }, "en")).toBe("Finish annotating (1)");
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
    expect(annotationButtonLabel({ enabled: true, count: 1 }, "ja")).toBe("注釈を終了（1 件）");
    expect(annotationButtonLabel({ enabled: false, count: 2 }, "ja")).toBe("注釈を再開（2 件）");
    expect(restoreAnnotationsLabel({ restorableCount: 3 }, "ja")).toBe(
      "保存済みの注釈を復元（3 件）",
    );
  });

  it("shows the bound shortcut keys and where to change them", () => {
    const commands = [
      { name: "toggle-share-current-tab", shortcut: "⌥⇧S" },
      { name: "copy-current-tab-id", shortcut: "" },
      { name: "_execute_action", shortcut: "" },
    ];
    expect(shortcutHint(commands, "chrome", "en")).toBe(
      "⌥⇧S shares or revokes the current tab. (not set) copies its tab ID. Change shortcuts at chrome://extensions/shortcuts.",
    );
    expect(shortcutHint([], "firefox", "en")).toContain(
      "about:addons > Manage Extension Shortcuts",
    );
    expect(shortcutHint(commands, "chrome", "ja")).toBe(
      "⌥⇧S で現在のタブを共有／共有解除、（未設定） でタブ ID をコピーします。ショートカットは chrome://extensions/shortcuts で変更できます。",
    );
    expect(shortcutKeys(commands, "en")).toEqual([
      { keys: "⌥⇧S", label: "Share / revoke" },
      { keys: null, label: "Copy tab ID" },
    ]);
    expect(shortcutKeys([], "ja").map((key) => key.label)).toEqual([
      "共有／解除",
      "タブ ID をコピー",
    ]);
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
      "直前のショートカット: タブ 7「Example」をエージェントと共有しました。",
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
    const closed = tabGate(
      { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
      web,
      "en",
    );
    expect(closed).toMatchObject({ mode: "closed", tone: "neutral", headline: "Not shared" });
    const open = tabGate(
      { permitted: true, allTabsAccess: allTabsOff, activeTab: normalTab },
      web,
      "en",
    );
    expect(open).toMatchObject({ mode: "open", tone: "success", headline: "Shared with agents" });
    expect(open.detail).toContain("revoke");
    expect(
      tabGate(
        {
          permitted: false,
          allTabsAccess: allTabsOff,
          activeTab: { incognito: true, incognitoAccessAllowed: false },
        },
        web,
        "en",
      ),
    ).toMatchObject({ mode: "blocked", tone: "neutral", headline: "Blocked in incognito" });
    expect(
      tabGate({ permitted: true, allTabsAccess: allTabsOn, activeTab: normalTab }, web, "en"),
    ).toMatchObject({ mode: "sandbox", tone: "warning", headline: "All tabs shared" });
  });

  it("explains pages that cannot be shared instead of offering Share", () => {
    const settingsPage = tabGate(
      { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
      "chrome://settings/",
      "en",
    );
    expect(settingsPage).toMatchObject({ mode: "unsupported", headline: "Can't share this page" });
    expect(settingsPage.detail).toBe("Only http, https, and file pages can be shared.");
    // A tab that is already shared stays revocable whatever its URL.
    expect(
      tabGate(
        { permitted: true, allTabsAccess: allTabsOff, activeTab: normalTab },
        "about:blank",
        "en",
      ).mode,
    ).toBe("open");
    // Without a URL the popup keeps the normal share flow.
    expect(
      tabGate(
        { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
        undefined,
        "en",
      ).mode,
    ).toBe("closed");
    expect(
      tabGate(
        { permitted: false, allTabsAccess: allTabsOn, activeTab: normalTab },
        "chrome://newtab/",
        "en",
      ).mode,
    ).toBe("unsupported");
    expect(
      tabGate(
        { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
        "file:///Users/me/report.html",
        "en",
      ).mode,
    ).toBe("closed");
  });

  it("keeps shared and not-shared distinct in Japanese", () => {
    const shared = tabGate(
      { permitted: true, allTabsAccess: allTabsOff, activeTab: normalTab },
      web,
      "ja",
    );
    const notShared = tabGate(
      { permitted: false, allTabsAccess: allTabsOff, activeTab: normalTab },
      web,
      "ja",
    );
    expect(shared).toMatchObject({ headline: "エージェントと共有中", tone: "success" });
    expect(notShared).toMatchObject({ headline: "共有していません", tone: "neutral" });
  });

  it("flags settings that skip approval only on a shared tab", () => {
    const risky = {
      ...baseSettings,
      operationsRequireApproval: false,
      trustedAutomationEnabled: true,
      evalEnabled: true,
    };
    expect(tabRiskFlags(risky, "open", "en")).toEqual([
      "Write operations run without asking you.",
      "AutoMode: eval runs without asking you.",
    ]);
    expect(tabRiskFlags(risky, "sandbox", "ja")).toHaveLength(2);
    expect(tabRiskFlags(risky, "closed", "en")).toEqual([]);
    expect(tabRiskFlags(baseSettings, "open", "en")).toEqual([]);
    // AutoMode without eval enabled does not run eval, so it is not flagged.
    expect(tabRiskFlags({ ...baseSettings, trustedAutomationEnabled: true }, "open", "en")).toEqual(
      [],
    );
  });

  it("shows the host under the tab title", () => {
    expect(tabHost("https://shop.example.com/checkout?step=2")).toBe("shop.example.com");
    expect(tabHost("http://127.0.0.1:8080/")).toBe("127.0.0.1:8080");
    expect(tabHost("file:///Users/me/My%20Report.html")).toBe("/Users/me/My Report.html");
    expect(tabHost("chrome://settings/")).toBe("chrome://settings/");
    expect(tabHost(undefined)).toBe("");
    expect(tabHost("not a url")).toBe("not a url");
  });

  it("caps the shared-tabs list with the current tab first", () => {
    const tabs = Array.from({ length: 9 }, (_, i) => ({ tabId: 100 + i }));
    const collapsed = visibleSharedTabs(tabs, 106, false);
    expect(collapsed.rows.map((tab) => tab.tabId)).toEqual([106, 100, 101, 102]);
    expect(collapsed.hidden).toBe(5);
    const expanded = visibleSharedTabs(tabs, 106, true);
    expect(expanded.rows).toHaveLength(9);
    expect(expanded.hidden).toBe(0);
    // Five rows fit: hiding one would cost the same space as the "Show more" row.
    expect(visibleSharedTabs(tabs.slice(0, 5), 999, false)).toMatchObject({ hidden: 0 });
    expect(visibleSharedTabs(tabs.slice(0, 6), 999, false).hidden).toBe(2);
  });

  it("labels shared-tab rows", () => {
    const tab = { tabId: 7, title: "Example", url: "https://example.com" };
    expect(sharedTabAccessLabel({ ...tab, accessMode: "all_tabs" }, "en")).toBe("all tabs");
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
      "Restored 2 of 3 annotations. 1 couldn't be matched to the changed page.",
    );
    expect(formatText("ja", partial)).toMatch(/^3 件中 2 件の注釈を復元しました。/);
    const mismatch = restoreReportText(
      restoreReport("url_mismatch", 0, 0, { savedUrl: "https://a.test/" }),
    );
    expect(formatText("en", mismatch)).toBe(
      "Saved annotations are for https://a.test/, but this tab shows a different page. Nothing was restored.",
    );
    expect(formatText("ja", restoreReportText(restoreReport("no_saved_annotations", 0, 0)))).toBe(
      "このタブに保存済みの注釈はありません。",
    );
    expect(formatText("ja", restoreReportText(restoreReport("already_present", 0, 0)))).toBe(
      "保存済みの注釈はすべてページに表示されています。",
    );
    expect(formatText("ja", restoreReportText(restoreReport("none_restored", 0, 2)))).toContain(
      "保存済みの注釈 2 件は",
    );
  });

  it("translates known error codes and keeps other errors in English", () => {
    const known = {
      message: "Chrome has not granted ABG optional access to bookmarks in this profile.",
      code: "bookmarks_permission_required",
    };
    expect(errorText(known, "en")).toBe(
      "Error: ABG can't access bookmarks in this profile. Turn on Bookmarks access to grant it.",
    );
    expect(errorText(known, "ja")).toMatch(
      /^エラー: このプロファイルでは、ABG にブックマークへのアクセスが許可されていません。/,
    );
    expect(errorText({ message: "socket closed", code: "something_new" }, "ja")).toBe(
      "エラー: socket closed",
    );
    expect(errorMessage({ message: "unknown message" }, "ja")).toBe("unknown message");
    expect(errorMessage({ message: "x", code: "constructor" }, "ja")).toBe("x");
  });
});
