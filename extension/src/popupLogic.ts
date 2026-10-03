import type { AnnotationRestoreReport } from "./annotationOverlay.js";
import {
  COPY_TAB_ID_COMMAND,
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

/** Consent state of the active tab, shown next to its title. */
export function tabAccessStatusPill(
  state: Pick<PopupState, "permitted" | "allTabsAccess" | "activeTab">,
  lang: Language,
): StatusPill {
  if (state.allTabsAccess.active) {
    return { label: t(lang, "popup.tab.allTabsShared"), tone: "warning" };
  }
  if (state.activeTab.incognito && !state.activeTab.incognitoAccessAllowed) {
    return { label: t(lang, "popup.tab.blocked"), tone: "neutral" };
  }
  if (state.permitted) return { label: t(lang, "popup.tab.shared"), tone: "success" };
  return { label: t(lang, "popup.tab.notShared"), tone: "neutral" };
}

export function sharedTabsHeading(count: number, lang: Language): string {
  return t(lang, "popup.sharedTabs.heading", { count });
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
