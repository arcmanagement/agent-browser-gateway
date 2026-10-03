// English UI catalog: the source of truth for every message key. Other catalogs must define
// the same keys (see MessageCatalog in ../i18n.ts).
//
// Placeholders use {name}. An entry with { one, other } is chosen by the numeric `count`
// param. Approval intents (intent.*) are also sent to the Gateway in English, so their
// English text must stay byte-for-byte stable.
//
// Voice: short, specific, action-first. Every label says what happens and to which tab.
// Consent words are fixed: Share / Allow grant access, Revoke / Deny remove or refuse it.

export type MessageEntry = string | { readonly one: string; readonly other: string };

export const en = {
  // ---- Shared ----
  "common.untitled": "(untitled)",
  "common.errorPrefix": "Error: {message}",

  // ---- Popup ----
  "popup.gateway.checking": "Checking…",
  "popup.gateway.connected": "Connected",
  "popup.gateway.connectedDescription": "Connected to the Gateway",
  "popup.gateway.disconnected": "Disconnected",
  "popup.gateway.disconnectedDescription": "Not connected to the Gateway",
  "popup.gateway.offlineTitle": "Can't reach the Gateway",
  "popup.gateway.offlineBody": "Start the Gateway app. This extension connects to {url}.",
  "popup.tab.none": "No active tab",
  "popup.tab.unknownState": "Couldn't read this tab's state. Close and reopen the popup.",
  "popup.tab.id": "tab {tabId}",
  "popup.tab.allTabsShared": "All tabs shared",
  "popup.tab.blocked": "Blocked in incognito",
  "popup.tab.shared": "Shared with agents",
  "popup.tab.notShared": "Not shared",
  "popup.tab.unsupported": "Can't share this page",
  "popup.tab.sharedDetail":
    "Agents can read and operate this tab. Sharing ends when you revoke it or the tab leaves this site.",
  "popup.tab.notSharedDetail": "Agents can't see or operate this tab until you share it.",
  "popup.tab.allTabsDetail": "Sandbox mode is on: every tab in this profile is shared.",
  "popup.tab.unsupportedDetail": "Only http, https, and file pages can be shared.",
  "popup.tab.flag.noApproval": "Write operations run without asking you.",
  "popup.tab.flag.autoMode": "AutoMode: eval runs without asking you.",
  "popup.incognito.body": "To share this tab, allow ABG in incognito from the extension settings.",
  "popup.incognito.openSettings": "Open extension settings",
  "popup.action.share": "Share this tab with agents",
  "popup.action.revoke": "Revoke access to this tab",
  "popup.action.disableAllTabs": "Turn off all-tabs mode",
  "popup.annotation.heading": "Annotations",
  "popup.annotation.start": "Annotate this tab",
  "popup.annotation.done": "Finish annotating ({count})",
  "popup.annotation.resume": "Resume annotating ({count})",
  "popup.annotation.clear": "Clear all",
  "popup.annotation.restore": "Restore saved annotations",
  "popup.annotation.restoreCount": {
    one: "Restore {count} saved annotation",
    other: "Restore {count} saved annotations",
  },
  "popup.restore.noSaved": "No saved annotations for this tab.",
  "popup.restore.urlMismatch":
    "Saved annotations are for {savedUrl}, but this tab shows {currentUrl}. Nothing was restored.",
  "popup.restore.anotherPage": "another page",
  "popup.restore.differentPage": "a different page",
  "popup.restore.restored": {
    one: "Restored {count} annotation.",
    other: "Restored {count} annotations.",
  },
  "popup.restore.partial":
    "Restored {restored} of {total} annotations. {unrestored} couldn't be matched to the changed page.",
  "popup.restore.noneRestored":
    "None of the {unrestored} saved annotations match the changed page. Nothing was restored.",
  "popup.restore.alreadyPresent": "All saved annotations are already on the page.",
  "popup.shortcut.last": "Last shortcut: {message}",
  "popup.shortcut.hint":
    "{toggle} shares or revokes the current tab. {copy} copies its tab ID. Change shortcuts at {settingsPage}.",
  "popup.shortcut.toggle": "Share / revoke",
  "popup.shortcut.copy": "Copy tab ID",
  "popup.shortcut.notSet": "(not set)",
  "popup.shortcut.chromeSettingsPage": "chrome://extensions/shortcuts",
  "popup.shortcut.firefoxSettingsPage": "about:addons > Manage Extension Shortcuts",
  "popup.sharedTabs.heading": "Shared tabs",
  "popup.sharedTabs.allTabs": "all tabs",
  "popup.sharedTabs.thisTab": "this tab",
  "popup.sharedTabs.revoke": "Revoke",
  "popup.sharedTabs.revokeLabel": "Revoke access to tab {tabId}: {title}",
  "popup.sharedTabs.showMore": "Show {count} more",
  "popup.sharedTabs.showLess": "Show fewer",
  "popup.permissions.heading": "Permissions",
  "popup.permissions.group.everyday": "Everyday",
  "popup.permissions.group.automation": "Automation",
  "popup.permissions.group.personalData": "Personal data",
  "popup.permissions.risk.higher": "Higher risk",
  "popup.permissions.requireApproval": "Require approval for write operations",
  "popup.permissions.requireApproval.note":
    "Clicks, typing, navigation, and other changes open an approval window first.",
  "popup.permissions.eval": "Allow approved JavaScript eval",
  "popup.permissions.eval.note":
    "Off by default. Unless AutoMode is on, each eval shows you the exact script to approve.",
  "popup.permissions.trustedAutomation": "Trusted automation (AutoMode)",
  "popup.permissions.trustedAutomation.off":
    "Lets eval on shared tabs skip the approval window. Scripts are still audited.",
  "popup.permissions.trustedAutomation.active":
    "On: eval on shared tabs runs without an approval window and is still audited.",
  "popup.permissions.trustedAutomation.evalDisabled":
    "On, but eval stays off until you allow it above.",
  "popup.permissions.allTabs": "Share all tabs (sandbox profiles only)",
  "popup.permissions.allTabs.active": {
    one: "{count} tab shared. Browser automation controls are on for this isolated profile.",
    other: "{count} tabs shared. Browser automation controls are on for this isolated profile.",
  },
  "popup.permissions.allTabs.permissionMissing":
    "Chrome permission is missing. Turn this on again to grant it.",
  "popup.permissions.allTabs.default":
    "Shares every tab in this profile. Use it only in an isolated sandbox profile, never your personal one.",
  "popup.permissions.allTabs.notGranted": "Permission wasn't granted, so all-tabs mode stays off.",
  "popup.permissions.bookmarks": "Bookmarks access",
  "popup.permissions.bookmarks.note":
    "Separate permission. Agents get bookmark URLs only through bookmark commands.",
  "popup.permissions.bookmarks.unsupported": "This browser doesn't provide the bookmarks API.",
  "popup.permissions.bookmarks.notGranted":
    "Permission wasn't granted, so bookmarks access stays off.",
  "popup.permissions.readingList": "Reading List access",
  "popup.permissions.readingList.note": "Separate permission for your saved Reading List entries.",
  "popup.permissions.readingList.unsupported":
    "This browser doesn't provide chrome.readingList (Chrome 120 or later).",
  "popup.permissions.readingList.notGranted":
    "Permission wasn't granted, so Reading List access stays off.",
  "popup.permissions.personalDataMutations": "Allow bookmark & Reading List changes",
  "popup.permissions.personalDataMutations.note":
    "Agents can request changes. Each one opens an approval window, and deletions are marked as permanent.",
  "popup.advanced.heading": "Advanced",
  "popup.advanced.language": "Display language",
  "popup.advanced.language.auto": "Auto (browser language)",
  "popup.advanced.language.note":
    "This popup switches now. Approval windows, the annotation toolbar, and shortcut messages switch the next time they open.",
  "popup.advanced.shortcuts": "Keyboard shortcuts",
  "popup.advanced.profileLabel": "Profile label (shown in the menu bar)",
  "popup.advanced.profileLabel.placeholder": "e.g. personal, work, staging",
  "popup.advanced.gatewayUrl": "Gateway endpoint (WebSocket)",
  "popup.advanced.gatewayUrl.apply": "Apply",
  "popup.advanced.gatewayUrl.note":
    "For development and self-hosting. Applying reconnects right away.",
  "popup.advanced.gatewayUrl.reconnecting": "Reconnecting to the Gateway…",
  "popup.footer.audit": "Every read and operation is written to the local audit log.",

  // Errors shown in the popup and approval window, keyed by Gateway error code. Unknown codes
  // show the original (English) message.
  "error.all_tabs_permission_required":
    "ABG can't access all sites in this profile. Turn on all-tabs mode to grant access.",
  "error.bookmarks_permission_required":
    "ABG can't access bookmarks in this profile. Turn on Bookmarks access to grant it.",
  "error.reading_list_permission_required":
    "ABG can't access the Reading List in this profile. Turn on Reading List access to grant it.",
  "error.bookmarks_unsupported": "This browser doesn't provide the chrome.bookmarks API.",
  "error.reading_list_unsupported":
    "This browser doesn't provide the chrome.readingList API. Chrome has it from version 120; some other Chromium browsers don't.",
  "error.tab_not_shared": "This tab isn't shared with ABG. Share it first.",
  "error.approval_not_found":
    "This approval request is gone. It may have expired or already been answered.",

  // ---- Approval window ----
  "approval.windowTitle": "Approve operation",
  "approval.heading": "Allow this operation?",
  "approval.loading": "Loading…",
  "approval.allow": "Allow",
  "approval.deny": "Deny",
  "approval.escToDeny": "to deny",
  "approval.noUrl": "(no URL)",
  "approval.submitting": "Sending your answer…",
  "approval.expires": "Auto-deny in {time}",
  "approval.tabPickerNote":
    "Allow opens Chrome's tab picker. Choose this tab and turn on audio sharing to record it.",
  "approval.tabPickerCancelled": "No tab was chosen, so recording didn't start.",
  "approval.tabCaptureFailed": "Couldn't start tab capture.",
  "approval.missingRequest": "This window has no approval request. Close it and try again.",
  "approval.unavailable": "This approval request isn't available anymore.",
  "approval.loadFailed": "Couldn't load the approval request.",

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
  "shortcut.blocked.noActiveTab": "No active tab. Click into a tab, then press the shortcut again.",
  "shortcut.blocked.allTabsMode":
    "All-tabs mode is on, so tabs can't be shared or revoked one at a time. Nothing was changed. Turn off all-tabs mode in the popup first.",
  "shortcut.blocked.incognito":
    'ABG is off in incognito, so this tab can\'t be shared. Turn on "Allow in incognito" in the extension settings first.',
  "shortcut.blocked.unsupportedPage":
    "{subject} can't be shared. Only http, https, and file pages can. Nothing was changed.",
  "shortcut.blocked.schemePages": "{scheme}: pages",
  "shortcut.blocked.thisPage": "This page",
  "shortcut.shareFailed": "Couldn't share tab {tabId}: {error}",
  "shortcut.revokeFailed": "Couldn't revoke tab {tabId}: {error}",
  "shortcut.copiedNotShared":
    "Copied the ID of {tab}. It isn't shared, so agents can't access it until you share it.",
  "shortcut.copiedShared": "Copied the ID of {tab}. This tab is shared with agents.",
  "shortcut.copiedSharedAllTabs":
    "Copied the ID of {tab}. This tab is shared with agents through all-tabs mode.",
  "shortcut.copyFailed": "Couldn't copy tab ID {tabId}: {error}",

  // ---- Annotation overlay (passed into the page as a string table) ----
  "overlay.annotating": "Annotating",
  "overlay.modeGroup": "Annotation target",
  "overlay.modeArea": "Area",
  "overlay.modeText": "Text",
  "overlay.clear": "Clear all",
  "overlay.clearConfirm": "Clear all {count}?",
  "overlay.clearConfirmTitle": "Click again to remove every annotation on this page",
  "overlay.done": "Done",
  "overlay.doneTitle": "Finish annotating (Esc)",
  "overlay.count": { one: "{count} annotation", other: "{count} annotations" },
  "overlay.hintArea": "Drag or click to mark",
  "overlay.hintText": "Select text to mark",
  "overlay.hintSelected": "Delete removes it",
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
