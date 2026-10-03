// English UI catalog: the source of truth for every message key. Other catalogs must define
// the same keys (see MessageCatalog in ../i18n.ts).
//
// Placeholders use {name}. An entry with { one, other } is chosen by the numeric `count`
// param. Approval intents (intent.*) are also sent to the Gateway in English, so their
// English text must stay byte-for-byte stable.

export type MessageEntry = string | { readonly one: string; readonly other: string };

export const en = {
  // ---- Shared ----
  "common.untitled": "(untitled)",
  "common.errorPrefix": "error: {message}",

  // ---- Popup ----
  "popup.gateway.checking": "Checking…",
  "popup.gateway.connected": "Connected",
  "popup.gateway.connectedDescription": "Gateway connected",
  "popup.gateway.disconnected": "Disconnected",
  "popup.gateway.disconnectedDescription": "Gateway disconnected",
  "popup.tab.none": "(no active tab)",
  "popup.tab.unknownState": "unknown state",
  "popup.tab.allTabsShared": "All tabs shared",
  "popup.tab.blocked": "Blocked",
  "popup.tab.shared": "Shared",
  "popup.tab.notShared": "Not shared",
  "popup.incognito.title": "Incognito access is off",
  "popup.incognito.body":
    "Chrome blocks ABG in incognito windows until this extension is allowed there.",
  "popup.incognito.openSettings": "Open extension settings",
  "popup.action.share": "Share this tab with agent",
  "popup.action.revoke": "Revoke this tab",
  "popup.action.disableAllTabs": "Disable all-tabs access",
  "popup.action.enableIncognito": "Enable incognito access first",
  "popup.annotation.start": "Annotate this tab",
  "popup.annotation.done": {
    one: "{count} annotation - Done",
    other: "{count} annotations - Done",
  },
  "popup.annotation.resume": {
    one: "{count} annotation - Resume",
    other: "{count} annotations - Resume",
  },
  "popup.annotation.clear": "Clear",
  "popup.annotation.restore": "Restore saved annotations",
  "popup.annotation.restoreCount": {
    one: "Restore {count} saved annotation",
    other: "Restore {count} saved annotations",
  },
  "popup.restore.noSaved": "No saved annotations exist for this tab. Nothing was restored.",
  "popup.restore.urlMismatch":
    "Saved annotations belong to {savedUrl}, but the tab now shows {currentUrl}. Nothing was restored.",
  "popup.restore.anotherPage": "another page",
  "popup.restore.differentPage": "a different page",
  "popup.restore.restored": {
    one: "Restored {count} annotation.",
    other: "Restored {count} annotations.",
  },
  "popup.restore.partial":
    "Restored {restored} of {total} annotations. The other {unrestored} could not be matched to the changed page, so they were not drawn.",
  "popup.restore.noneRestored":
    "No saved annotation could be matched to the changed page ({unrestored} tried), so nothing was drawn.",
  "popup.restore.alreadyPresent": "All saved annotations are already shown on the page.",
  "popup.shortcut.last": "Last shortcut: {message}",
  "popup.shortcut.hint":
    "Shortcuts: {toggle} shares or revokes this tab, {copy} copies its tab ID. Change them at {settingsPage}.",
  "popup.shortcut.notSet": "(not set)",
  "popup.shortcut.chromeSettingsPage": "chrome://extensions/shortcuts",
  "popup.shortcut.firefoxSettingsPage": "about:addons > Manage Extension Shortcuts",
  "popup.sharedTabs.heading": "Shared tabs ({count})",
  "popup.sharedTabs.allTabs": "all-tabs",
  "popup.permissions.heading": "Permissions",
  "popup.permissions.requireApproval": "Require approval for write operations",
  "popup.permissions.eval": "Enable approved JavaScript eval",
  "popup.permissions.trustedAutomation": "Trusted automation / AutoMode",
  "popup.permissions.trustedAutomation.off":
    "When enabled, eval on shared tabs can skip the local approval popup. Scripts are still audited.",
  "popup.permissions.trustedAutomation.active":
    "AutoMode is active: eval skips local approval popups for shared tabs and is still audited.",
  "popup.permissions.trustedAutomation.evalDisabled":
    "AutoMode is active but eval is disabled until the eval switch is enabled.",
  "popup.permissions.allTabs": "Sandbox all-tabs profile mode",
  "popup.permissions.allTabs.active": {
    one: "{count} tab is shared in sandbox mode. Browser-owned automation controls are enabled for this isolated profile.",
    other:
      "{count} tabs are shared in sandbox mode. Browser-owned automation controls are enabled for this isolated profile.",
  },
  "popup.permissions.allTabs.permissionMissing":
    "Chrome permission is missing. Toggle this on to re-authorize.",
  "popup.permissions.allTabs.default":
    "For isolated sandbox profiles only. Do not enable this in mixed personal profiles.",
  "popup.permissions.allTabs.notGranted": "All-tabs permission was not granted.",
  "popup.permissions.bookmarks": "Bookmarks access",
  "popup.permissions.bookmarks.note":
    "Separate browser-owned personal data permission. URLs are returned only by bookmark commands and are not shared-tab state.",
  "popup.permissions.bookmarks.unsupported":
    "This browser target does not expose the bookmarks extension API.",
  "popup.permissions.bookmarks.notGranted": "Bookmarks permission was not granted.",
  "popup.permissions.readingList": "Reading List access",
  "popup.permissions.readingList.note":
    "Separate browser-owned personal data permission for saved Reading List entries.",
  "popup.permissions.readingList.unsupported":
    "This browser target does not expose chrome.readingList. Chrome documents it for Chrome 120+.",
  "popup.permissions.readingList.notGranted": "Reading List permission was not granted.",
  "popup.permissions.personalDataMutations": "Allow bookmark & Reading List changes",
  "popup.permissions.personalDataMutations.note":
    "Allows agent-requested bookmark and Reading List changes. Every change still opens a per-operation approval window; deletes use stronger confirmation copy.",
  "popup.advanced.heading": "Advanced",
  "popup.advanced.language": "Display language",
  "popup.advanced.language.auto": "Auto (browser language)",
  "popup.advanced.language.note":
    "Applies to this popup now. Approval windows, the annotation toolbar, and shortcut messages use it the next time they appear.",
  "popup.advanced.profileLabel": "Profile label (shown in menubar)",
  "popup.advanced.profileLabel.placeholder": "e.g. personal, work, staging",
  "popup.advanced.gatewayUrl": "Gateway WebSocket endpoint",
  "popup.advanced.gatewayUrl.apply": "Apply",
  "popup.advanced.gatewayUrl.note":
    "Developer and self-hosted diagnostics only. Applying reconnects immediately.",
  "popup.advanced.gatewayUrl.reconnecting": "Reconnecting to Gateway…",

  // Errors shown in the popup and approval window, keyed by Gateway error code. Unknown codes
  // show the original (English) message.
  "error.all_tabs_permission_required":
    "Chrome has not granted ABG optional access to all sites in this profile.",
  "error.bookmarks_permission_required":
    "Chrome has not granted ABG optional access to bookmarks in this profile.",
  "error.reading_list_permission_required":
    "Chrome has not granted ABG optional access to Reading List in this profile.",
  "error.bookmarks_unsupported":
    "This browser extension target does not expose the chrome.bookmarks API.",
  "error.reading_list_unsupported":
    "This browser extension target does not expose the chrome.readingList API. Chrome documents the API for Chrome 120+; other Chromium browsers may omit it.",
  "error.tab_not_shared": "tab is not shared with ABG",
  "error.approval_not_found": "approval request not found",

  // ---- Approval window ----
  "approval.windowTitle": "Approve Operation",
  "approval.heading": "Approve operation?",
  "approval.loading": "Loading…",
  "approval.allow": "Allow",
  "approval.deny": "Deny",
  "approval.escToDeny": "to deny",
  "approval.noUrl": "(no URL)",
  "approval.submitting": "Submitting decision...",
  "approval.expires": "This request expires in {seconds} seconds.",
  "approval.tabPickerNote":
    "Allow opens Chrome's tab picker: choose the tab and enable audio sharing to record it.",
  "approval.tabPickerCancelled": "Tab selection was cancelled; recording did not start.",
  "approval.tabCaptureFailed": "could not start tab capture",
  "approval.missingRequest": "approval request missing",
  "approval.unavailable": "approval request unavailable",
  "approval.loadFailed": "Unable to load approval request.",

  // ---- Approval intents (also sent to the Gateway in English) ----
  "intent.frameSuffix": " inside frame {frame}",
  "intent.clickSelector": "Click the element matching selector {selector}{frame}.",
  "intent.clickAt": "Click at page coordinates ({x}, {y}).",
  "intent.clickRef": "Click snapshot ref {ref}.",
  "intent.clickDescribed": "Click the element with describe id {id}.",
  "intent.dblclickSelector": "Double-click the element matching selector {selector}{frame}.",
  "intent.focusSelector":
    "Focus the element matching selector {selector}{frame} without clicking it.",
  "intent.hoverSelector": "Move the mouse over the element matching selector {selector}{frame}.",
  "intent.selectOption": "Select an option in {selector}{frame}.",
  "intent.check": "Check the input matching selector {selector}{frame} if needed.",
  "intent.uncheck": "Uncheck the input matching selector {selector}{frame} if needed.",
  "intent.fillPreview": "Preview editable replacement for selector {selector}{frame}.",
  "intent.fillAuditDiff":
    "Fill {bytes} bytes into the editable target matching selector {selector}{frame} and capture a redacted audit diff.",
  "intent.fill": "Fill {value} into the editable target matching selector {selector}{frame}.",
  "intent.paste":
    "Paste {bytes} bytes into the editable element matching selector {selector}{frame}.",
  "intent.pasteRich": "Paste {payload} into {target}.",
  "intent.clipboardCurrent": "current clipboard payload",
  "intent.clipboardMime": "{mime} clipboard payload",
  "intent.clipboardMimeBytes": "{mime} clipboard payload ({bytes} bytes)",
  "intent.targetSelector": "the element matching selector {selector}{frame}",
  "intent.targetFocused": "the currently focused target",
  "intent.clear": "Clear the editable element matching selector {selector}{frame}.",
  "intent.replaceDom":
    "Replace the element matching selector {selector}{frame} with provided HTML.",
  "intent.uploadFile": "Attach {files} to file input {selector}{frame}.",
  "intent.localFile": "local file {file}",
  "intent.localFiles": "{count} local files ({file}, ...)",
  "intent.typeText": "Type {text} into the focused element.",
  "intent.insertText": "Insert {bytes} bytes into the focused element without key events.",
  "intent.execCommand":
    "Run document.execCommand({command}) against the focused element with {bytes} value bytes.",
  "intent.keyPress": "Press {chord}.",
  "intent.keyDown": "Dispatch key down for {chord}.",
  "intent.keyUp": "Dispatch key up for {chord}.",
  "intent.navigate": "Navigate this tab to {url}.",
  "intent.sandboxViewport": "Set sandbox viewport to {width}x{height}.",
  "intent.sandboxViewportMobile": "Set sandbox viewport to {width}x{height} mobile.",
  "intent.sandboxViewportClear": "Clear sandbox viewport emulation.",
  "intent.sandboxStorageSet": "Set {kind} key {key} to {bytes} bytes in the sandbox profile.",
  "intent.sandboxStorageDelete": "Delete {kind} key {key} from the sandbox profile.",
  "intent.sandboxTabCreate": "Create a new sandbox tab for {url}.",
  "intent.sandboxTabClose": "Close sandbox tab {tabId}.",
  "intent.drag": "Drag from {from} to {to}{frame}.",
  "intent.dragPointSelector": "selector {selector}",
  "intent.dragPointCoords": "({x}, {y})",
  "intent.scrollIntoView": "Scroll the element matching selector {selector}{frame} into view.",
  "intent.dialogAccept": "Accept {type} dialog{prompt}: {message}",
  "intent.dialogDismiss": "Dismiss {type} dialog{prompt}: {message}",
  "intent.dialogPrompt": " with {bytes} prompt bytes",
  "intent.scrollElement":
    "Scroll the element matching selector {selector} by (Δx={dx}, Δy={dy}){frame}.",
  "intent.scrollTab": "Scroll this tab by (Δx={dx}, Δy={dy}) {where}.",
  "intent.scrollAtPoint": "at ({x}, {y})",
  "intent.scrollAtCenter": "at viewport center",
  "intent.findAction": "Run find action {action} on {selector}{frame}.",
  "intent.eval": "Run approved JavaScript eval ({bytes} bytes).",
  "intent.record": "Record this tab to a video file, capturing tab audio.",
  "intent.recordWithMic":
    "Record this tab to a video file, capturing tab audio and the microphone (physical room).",
  "intent.personal.idLabel": "id {id}",
  "intent.personal.bookmarkCreate":
    "Create bookmark {label}{forUrl}{inFolder}. Browser-owned personal data write.",
  "intent.personal.forUrl": " for {url}",
  "intent.personal.inFolder": " in folder {parentId}",
  "intent.personal.bookmarkUpdate":
    "Update bookmark {label} (id {id}). Browser-owned personal data write.",
  "intent.personal.bookmarkMove":
    "Move bookmark {label} (id {id}){toFolder}. Browser-owned personal data write.",
  "intent.personal.toFolder": " to folder {parentId}",
  "intent.personal.bookmarkRemove":
    "PERMANENTLY DELETE bookmark {label} (id {id}). This removes saved personal data from the browser and ABG cannot undo it.",
  "intent.personal.readingListAdd":
    "Add {label} to the Reading List. Browser-owned personal data write.",
  "intent.personal.readingListUpdate":
    "Update the Reading List entry {label}. Browser-owned personal data write.",
  "intent.personal.readingListRemove":
    "PERMANENTLY DELETE the Reading List entry {label}. This removes saved personal data from the browser and ABG cannot undo it.",

  // ---- Keyboard shortcut feedback (badge tooltip, in-page toast, popup) ----
  "shortcut.tab": "tab {tabId}",
  "shortcut.tabWithTitle": 'tab {tabId} ("{title}")',
  "shortcut.shared": "Shared {tab} with agents.",
  "shortcut.revoked": "Revoked {tab}. Agents can no longer access it.",
  "shortcut.blocked.noActiveTab":
    "No active tab was found. Focus a browser tab and try the shortcut again.",
  "shortcut.blocked.allTabsMode":
    "All-tabs sandbox mode is on, so per-tab share and revoke do not apply. Nothing was changed. Turn off all-tabs access in the popup to manage tabs one by one.",
  "shortcut.blocked.incognito":
    'Incognito access is off for Agent Browser Gateway, so this tab cannot be shared. Enable "Allow in incognito" in the extension settings first.',
  "shortcut.blocked.unsupportedPage":
    "{subject} cannot be shared. Only http, https, and file pages can be shared. Nothing was changed.",
  "shortcut.blocked.schemePages": "{scheme}: pages",
  "shortcut.blocked.thisPage": "This page",
  "shortcut.shareFailed": "Could not share tab {tabId}: {error}",
  "shortcut.revokeFailed": "Could not revoke tab {tabId}: {error}",
  "shortcut.copiedNotShared":
    "Copied tab ID {tabId} for {tab}. This tab is not shared: agents cannot access it until you share it.",
  "shortcut.copiedShared": "Copied tab ID {tabId} for {tab}. This tab is shared with agents.",
  "shortcut.copiedSharedAllTabs":
    "Copied tab ID {tabId} for {tab}. This tab is shared with agents through all-tabs mode.",
  "shortcut.copyFailed": "Could not copy tab ID {tabId}: {error}",

  // ---- Annotation overlay (passed into the page as a string table) ----
  "overlay.annotating": "Annotating",
  "overlay.modeGroup": "Annotation target",
  "overlay.modeArea": "Area",
  "overlay.modeText": "Text",
  "overlay.clear": "Clear",
  "overlay.clearConfirm": "Clear {count}?",
  "overlay.clearConfirmTitle": "Click again to remove every annotation on this page",
  "overlay.done": "Done",
  "overlay.doneTitle": "Finish annotating (Esc)",
  "overlay.count": { one: "{count} annotation", other: "{count} annotations" },
  "overlay.hintArea": "Drag or click to mark",
  "overlay.hintText": "Select text to mark",
  "overlay.hintSelected": "Delete to remove",
  "overlay.hintFinish": "Esc to finish",
  "overlay.annotationLabel": "Annotation {number}",
  "overlay.editorPlaceholder": "Add a comment for the agent…",
  "overlay.editorSave": "Save",
  "overlay.editorDelete": "Delete",
  "overlay.editorKeysPrimary": "Enter to save · Esc to cancel",
  "overlay.editorKeysNewline": "Shift+Enter for a new line",
  "overlay.doneToastNone": "Annotation mode is off",
  "overlay.doneToast": {
    one: "{count} annotation ready for the agent",
    other: "{count} annotations ready for the agent",
  },
} as const satisfies Record<string, MessageEntry>;
