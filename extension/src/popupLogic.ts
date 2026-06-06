import type { BackgroundToPopup, ExtensionSettings } from "./types.js";

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

export function annotationButtonLabel(annotationState: PopupState["annotationState"]): string {
  const suffix = annotationState.count === 1 ? "" : "s";
  if (annotationState.enabled) return `${annotationState.count} annotation${suffix} - Done`;
  if (annotationState.count > 0) return `${annotationState.count} annotation${suffix} - Resume`;
  return "Annotate this tab";
}

export function sharedTabSummary(tab: PopupState["sharedTabs"][number]): string {
  return `${tab.accessMode === "all_tabs" ? "🌐" : "🔓"} [${tab.tabId}] ${tab.title || tab.url}`;
}
