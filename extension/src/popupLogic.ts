import type { AnnotationRestoreReport } from "./annotationOverlay.js";
import {
  COPY_TAB_ID_COMMAND,
  isShareableTabUrl,
  shortcutFeedbackText,
  TOGGLE_SHARE_COMMAND,
} from "./backgroundLogic.js";
import type { BrowserKind } from "./browserAdapter.js";
import { formatText, type Language, type LocalizedText, type MessageKey, msg, t } from "./i18n.js";
import type { BackgroundToPopup, ExtensionSettings, RecentShortcutFeedback } from "./types.js";

export const SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS = 2 * 60_000;

export function shortcutHint(
  commands: { name?: string; shortcut?: string }[],
  browserKind: BrowserKind,
  lang: Language,
): string {
  const keyFor = (name: string) =>
    commands.find((command) => command.name === name)?.shortcut || t(lang, "popup.shortcut.notSet");
  return t(lang, "popup.shortcut.hint", {
    toggle: keyFor(TOGGLE_SHARE_COMMAND),
    copy: keyFor(COPY_TAB_ID_COMMAND),
    settingsPage: msg(
      browserKind === "firefox"
        ? "popup.shortcut.firefoxSettingsPage"
        : "popup.shortcut.chromeSettingsPage",
    ),
  });
}

/** The bound keys for the two shortcuts, labeled for the popup's key legend. */
export function shortcutKeys(
  commands: { name?: string; shortcut?: string }[],
  lang: Language,
): { keys: string | null; label: string }[] {
  const keyFor = (name: string) =>
    commands.find((command) => command.name === name)?.shortcut || null;
  return [
    { keys: keyFor(TOGGLE_SHARE_COMMAND), label: t(lang, "popup.shortcut.toggle") },
    { keys: keyFor(COPY_TAB_ID_COMMAND), label: t(lang, "popup.shortcut.copy") },
  ];
}

export function recentShortcutMessage(
  feedback: RecentShortcutFeedback | undefined,
  now: number,
  lang: Language,
): string | undefined {
  if (!feedback) return undefined;
  const age = now - feedback.at;
  if (age < 0 || age > SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS) return undefined;
  // Re-format from the stored outcome so a language change applies to the popup right away.
  const message = feedback.outcome
    ? formatText(lang, shortcutFeedbackText(feedback.outcome))
    : feedback.message;
  return t(lang, "popup.shortcut.last", { message });
}

type PopupState = Extract<BackgroundToPopup, { type: "state" }>;

export function trustedAutomationNote(settings: ExtensionSettings, lang: Language): string {
  if (!settings.trustedAutomationEnabled) {
    return t(lang, "popup.permissions.trustedAutomation.off");
  }
  return settings.evalEnabled
    ? t(lang, "popup.permissions.trustedAutomation.active")
    : t(lang, "popup.permissions.trustedAutomation.evalDisabled");
}

export function allTabsAccessNote(
  settings: ExtensionSettings,
  allTabsAccess: PopupState["allTabsAccess"],
  lang: Language,
): string {
  if (allTabsAccess.active) {
    return t(lang, "popup.permissions.allTabs.active", {
      count: allTabsAccess.shareableTabCount,
    });
  }
  if (settings.allTabsAccessEnabled && !allTabsAccess.permissionGranted) {
    return t(lang, "popup.permissions.allTabs.permissionMissing");
  }
  return t(lang, "popup.permissions.allTabs.default");
}

export function annotationButtonLabel(
  annotationState: Pick<PopupState["annotationState"], "enabled" | "count">,
  lang: Language,
): string {
  const count = annotationState.count;
  if (annotationState.enabled) return t(lang, "popup.annotation.done", { count });
  if (count > 0) return t(lang, "popup.annotation.resume", { count });
  return t(lang, "popup.annotation.start");
}

/** Label for the restore affordance, or null when there is nothing saved to restore. */
export function restoreAnnotationsLabel(
  annotationState: Pick<PopupState["annotationState"], "restorableCount">,
  lang: Language,
): string | null {
  const count = annotationState.restorableCount;
  if (count <= 0) return null;
  return t(lang, "popup.annotation.restoreCount", { count });
}

/**
 * What the popup shows after Restore. The agent-facing userMessage for the same result stays
 * English and keeps its CLI hints; this is the human-facing version.
 */
export function restoreReportText(
  report: Pick<
    AnnotationRestoreReport,
    "status" | "restored" | "unrestored" | "savedUrl" | "currentUrl"
  >,
): LocalizedText {
  const restored = report.restored.length;
  const unrestored = report.unrestored.length;
  switch (report.status) {
    case "no_saved_annotations":
      return msg("popup.restore.noSaved");
    case "url_mismatch":
      return msg("popup.restore.urlMismatch", {
        savedUrl: report.savedUrl ?? msg("popup.restore.anotherPage"),
        currentUrl: report.currentUrl ?? msg("popup.restore.differentPage"),
      });
    case "restored":
      return msg("popup.restore.restored", { count: restored });
    case "partial":
      return msg("popup.restore.partial", {
        restored,
        unrestored,
        total: restored + unrestored,
      });
    case "none_restored":
      return msg("popup.restore.noneRestored", { unrestored });
    default:
      return msg("popup.restore.alreadyPresent");
  }
}

// Gateway error codes that have a human-facing translation.
const ERROR_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  all_tabs_permission_required: "error.all_tabs_permission_required",
  bookmarks_permission_required: "error.bookmarks_permission_required",
  reading_list_permission_required: "error.reading_list_permission_required",
  bookmarks_unsupported: "error.bookmarks_unsupported",
  reading_list_unsupported: "error.reading_list_unsupported",
  tab_not_shared: "error.tab_not_shared",
  approval_not_found: "error.approval_not_found",
};

/**
 * An error from the background as shown to the user. Known error codes are translated; any
 * other error keeps its original English message, so nothing is hidden when a translation is
 * missing.
 */
export function errorMessage(error: { message: string; code?: string }, lang: Language): string {
  const key =
    error.code && Object.hasOwn(ERROR_MESSAGE_KEYS, error.code)
      ? ERROR_MESSAGE_KEYS[error.code]
      : undefined;
  return key ? t(lang, key) : error.message;
}

/** errorMessage with the "error:" prefix the popup status line uses. */
export function errorText(error: { message: string; code?: string }, lang: Language): string {
  return t(lang, "common.errorPrefix", { message: errorMessage(error, lang) });
}

export type StatusTone = "success" | "danger" | "warning" | "neutral";
export type StatusPill = { label: string; tone: StatusTone; description?: string };

export function gatewayStatusPill(wsConnected: boolean, lang: Language): StatusPill {
  return wsConnected
    ? {
        label: t(lang, "popup.gateway.connected"),
        tone: "success",
        description: t(lang, "popup.gateway.connectedDescription"),
      }
    : {
        label: t(lang, "popup.gateway.disconnected"),
        tone: "danger",
        description: t(lang, "popup.gateway.disconnectedDescription"),
      };
}

/**
 * How the popup's gate shows the active tab. `mode` drives the gate graphic and the primary
 * action; tone and headline put the state into words, so consent never depends on color or
 * the graphic alone.
 *   open        shared by the user (signal)
 *   closed      not shared (neutral)
 *   sandbox     shared because all-tabs mode is on (warning)
 *   blocked     incognito tab while ABG is not allowed in incognito
 *   unsupported a page that cannot be shared, such as chrome:// pages
 */
export type GateMode = "open" | "closed" | "sandbox" | "blocked" | "unsupported";
export type TabGate = { mode: GateMode; tone: StatusTone; headline: string; detail: string };

export function tabGate(
  state: Pick<PopupState, "permitted" | "allTabsAccess" | "activeTab">,
  tabUrl: string | undefined,
  lang: Language,
): TabGate {
  // Only a known URL can rule sharing out; an unknown one keeps the normal share flow.
  const unsupported = tabUrl !== undefined && !isShareableTabUrl(tabUrl);
  const gate = (
    mode: GateMode,
    tone: StatusTone,
    headline: MessageKey,
    detail: MessageKey,
  ): TabGate => ({ mode, tone, headline: t(lang, headline), detail: t(lang, detail) });
  if (state.allTabsAccess.active) {
    if (!state.permitted && unsupported) {
      return gate("unsupported", "neutral", "popup.tab.unsupported", "popup.tab.unsupportedDetail");
    }
    return gate("sandbox", "warning", "popup.tab.allTabsShared", "popup.tab.allTabsDetail");
  }
  if (state.activeTab.incognito && !state.activeTab.incognitoAccessAllowed) {
    return gate("blocked", "neutral", "popup.tab.blocked", "popup.incognito.body");
  }
  if (state.permitted) {
    return gate("open", "success", "popup.tab.shared", "popup.tab.sharedDetail");
  }
  if (unsupported) {
    return gate("unsupported", "neutral", "popup.tab.unsupported", "popup.tab.unsupportedDetail");
  }
  return gate("closed", "neutral", "popup.tab.notShared", "popup.tab.notSharedDetail");
}

/**
 * Settings that let agents act on a shared tab without asking, stated next to the tab so
 * they are never hidden below the fold. Empty unless the tab is actually shared.
 */
export function tabRiskFlags(
  settings: Pick<
    ExtensionSettings,
    "operationsRequireApproval" | "trustedAutomationEnabled" | "evalEnabled"
  >,
  mode: GateMode,
  lang: Language,
): string[] {
  if (mode !== "open" && mode !== "sandbox") return [];
  const flags: string[] = [];
  if (!settings.operationsRequireApproval) flags.push(t(lang, "popup.tab.flag.noApproval"));
  if (settings.trustedAutomationEnabled && settings.evalEnabled) {
    flags.push(t(lang, "popup.tab.flag.autoMode"));
  }
  return flags;
}

/** Shown under the tab title: the host for web pages, the path for local files. */
export function tabHost(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.host;
    // Browser pages such as chrome://settings/ are clearest as the full URL.
    return url;
  } catch {
    return url;
  }
}

export const SHARED_TABS_COLLAPSED_LIMIT = 4;

/**
 * Rows for the shared-tabs list: the current tab first, then the others in their existing
 * order. Collapsed, the list shows at most SHARED_TABS_COLLAPSED_LIMIT rows (all-tabs mode can
 * share dozens) and reports how many are hidden behind "Show more".
 */
export function visibleSharedTabs<T extends { tabId: number }>(
  tabs: readonly T[],
  currentTabId: number,
  expanded: boolean,
): { rows: T[]; hidden: number } {
  const ordered = [
    ...tabs.filter((tab) => tab.tabId === currentTabId),
    ...tabs.filter((tab) => tab.tabId !== currentTabId),
  ];
  // Hiding a single row saves no space over the "Show more" row that replaces it.
  if (expanded || ordered.length <= SHARED_TABS_COLLAPSED_LIMIT + 1) {
    return { rows: ordered, hidden: 0 };
  }
  return {
    rows: ordered.slice(0, SHARED_TABS_COLLAPSED_LIMIT),
    hidden: ordered.length - SHARED_TABS_COLLAPSED_LIMIT,
  };
}

export function sharedTabAccessLabel(
  tab: PopupState["sharedTabs"][number],
  lang: Language,
): string | null {
  return tab.accessMode === "all_tabs" ? t(lang, "popup.sharedTabs.allTabs") : null;
}

export function sharedTabSummary(tab: PopupState["sharedTabs"][number]): string {
  return `${tab.accessMode === "all_tabs" ? "🌐" : "🔓"} [${tab.tabId}] ${tab.title || tab.url}`;
}
