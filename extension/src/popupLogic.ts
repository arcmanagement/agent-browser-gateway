import { COPY_TAB_ID_COMMAND, TOGGLE_SHARE_COMMAND } from "./backgroundLogic.js";
import type { BrowserKind } from "./browserAdapter.js";
import type { BackgroundToPopup, ExtensionSettings, RecentShortcutFeedback } from "./types.js";

export const SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS = 2 * 60_000;

export function shortcutHint(
  commands: { name?: string; shortcut?: string }[],
  browserKind: BrowserKind,
): string {
  const keyFor = (name: string) =>
    commands.find((command) => command.name === name)?.shortcut || "(not set)";
  const settingsPage =
    browserKind === "firefox"
      ? "about:addons > Manage Extension Shortcuts"
      : "chrome://extensions/shortcuts";
  return `Shortcuts: ${keyFor(TOGGLE_SHARE_COMMAND)} shares or revokes this tab, ${keyFor(
    COPY_TAB_ID_COMMAND,
  )} copies its tab ID. Change them at ${settingsPage}.`;
}

export function recentShortcutMessage(
  feedback: RecentShortcutFeedback | undefined,
  now: number,
): string | undefined {
  if (!feedback) return undefined;
  const age = now - feedback.at;
  if (age < 0 || age > SHORTCUT_FEEDBACK_POPUP_MAX_AGE_MS) return undefined;
  return `Last shortcut: ${feedback.message}`;
}

type PopupState = Extract<BackgroundToPopup, { type: "state" }>;

export function trustedAutomationNote(settings: ExtensionSettings): string {
  if (!settings.trustedAutomationEnabled) {
    return "When enabled, eval on shared tabs can skip the local approval popup. Scripts are still audited.";
  }
  return settings.evalEnabled
    ? "AutoMode is active: eval skips local approval popups for shared tabs and is still audited."
    : "AutoMode is active but eval is disabled until the eval switch is enabled.";
}

export function allTabsAccessNote(
  settings: ExtensionSettings,
  allTabsAccess: PopupState["allTabsAccess"],
): string {
  if (allTabsAccess.active) {
    return `${allTabsAccess.shareableTabCount} tabs are shared in sandbox mode. Browser-owned automation controls are enabled for this isolated profile.`;
  }
  if (settings.allTabsAccessEnabled && !allTabsAccess.permissionGranted) {
    return "Chrome permission is missing. Toggle this on to re-authorize.";
  }
  return "For isolated sandbox profiles only. Do not enable this in mixed personal profiles.";
}

export function annotationButtonLabel(
  annotationState: Pick<PopupState["annotationState"], "enabled" | "count">,
): string {
  const suffix = annotationState.count === 1 ? "" : "s";
  if (annotationState.enabled) return `${annotationState.count} annotation${suffix} - Done`;
  if (annotationState.count > 0) return `${annotationState.count} annotation${suffix} - Resume`;
  return "Annotate this tab";
}

/** Label for the restore affordance, or null when there is nothing saved to restore. */
export function restoreAnnotationsLabel(
  annotationState: Pick<PopupState["annotationState"], "restorableCount">,
): string | null {
  const count = annotationState.restorableCount;
  if (count <= 0) return null;
  return `Restore ${count} saved annotation${count === 1 ? "" : "s"}`;
}

export function sharedTabSummary(tab: PopupState["sharedTabs"][number]): string {
  return `${tab.accessMode === "all_tabs" ? "🌐" : "🔓"} [${tab.tabId}] ${tab.title || tab.url}`;
}
