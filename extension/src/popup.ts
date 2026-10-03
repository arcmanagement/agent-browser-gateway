import { browserAdapter } from "./browserAdapter.js";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  gatewayStatusPill,
  recentShortcutMessage,
  restoreAnnotationsLabel,
  type StatusPill,
  sharedTabAccessLabel,
  sharedTabSummary,
  sharedTabsHeading,
  shortcutHint,
  tabAccessStatusPill,
  trustedAutomationNote,
} from "./popupLogic.js";
import type { BackgroundToPopup, PopupToBackground } from "./types.js";

const browser = browserAdapter;
const tabInfoEl = document.getElementById("tabInfo") as HTMLDivElement;
const tabStatusEl = document.getElementById("tabStatus") as HTMLSpanElement;
const gatewayStatusEl = document.getElementById("gatewayStatus") as HTMLSpanElement;
const actionBtn = document.getElementById("actionBtn") as HTMLButtonElement;
const annotationBtn = document.getElementById("annotationBtn") as HTMLButtonElement;
const clearAnnotationsBtn = document.getElementById("clearAnnotationsBtn") as HTMLButtonElement;
const restoreAnnotationsBtn = document.getElementById("restoreAnnotationsBtn") as HTMLButtonElement;
const approvalToggleEl = document.getElementById("approvalToggle") as HTMLInputElement;
const evalToggleEl = document.getElementById("evalToggle") as HTMLInputElement;
const trustedAutomationToggleEl = document.getElementById(
  "trustedAutomationToggle",
) as HTMLInputElement;
const trustedAutomationNoteEl = document.getElementById("trustedAutomationNote") as HTMLDivElement;
const allTabsToggleEl = document.getElementById("allTabsToggle") as HTMLInputElement;
const allTabsNoteEl = document.getElementById("allTabsNote") as HTMLDivElement;
const allTabsSettingEl = document.getElementById("allTabsSetting") as HTMLDivElement;
const bookmarksToggleEl = document.getElementById("bookmarksToggle") as HTMLInputElement;
const bookmarksNoteEl = document.getElementById("bookmarksNote") as HTMLDivElement;
const readingListToggleEl = document.getElementById("readingListToggle") as HTMLInputElement;
const readingListNoteEl = document.getElementById("readingListNote") as HTMLDivElement;
const personalDataMutationsToggleEl = document.getElementById(
  "personalDataMutationsToggle",
) as HTMLInputElement;
const personalDataMutationsNoteEl = document.getElementById(
  "personalDataMutationsNote",
) as HTMLDivElement;
const profileLabelEl = document.getElementById("profileLabel") as HTMLInputElement;
const gatewayWebSocketUrlEl = document.getElementById("gatewayWebSocketUrl") as HTMLInputElement;
const applyGatewayUrlBtn = document.getElementById("applyGatewayUrlBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const sharedListEl = document.getElementById("sharedList") as HTMLDivElement;
const incognitoNoticeEl = document.getElementById("incognitoNotice") as HTMLDivElement;
const openExtensionsBtn = document.getElementById("openExtensionsBtn") as HTMLButtonElement;
const shortcutResultEl = document.getElementById("shortcutResult") as HTMLDivElement;
const shortcutHintEl = document.getElementById("shortcutHint") as HTMLDivElement;

let profileLabelTimer: number | null = null;

function renderPill(el: HTMLElement, pill: StatusPill): void {
  el.textContent = pill.label;
  el.className = pill.tone === "neutral" ? "pill" : `pill ${pill.tone}`;
  el.title = pill.description ?? pill.label;
  if (pill.description) el.setAttribute("aria-label", pill.description);
  else el.removeAttribute("aria-label");
  el.hidden = false;
}

async function send(msg: PopupToBackground): Promise<BackgroundToPopup> {
  return (await browser.runtime.sendMessage(msg)) as BackgroundToPopup;
}

async function openExtensionSettings(): Promise<void> {
  await browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
  window.close();
}

async function requestAllTabsPermission(): Promise<boolean> {
  return await browser.permissions.request({ origins: ["<all_urls>"] });
}

async function removeAllTabsPermission(): Promise<void> {
  await browser.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
}

async function requestApiPermission(permission: string): Promise<boolean> {
  const permissionName = permission as unknown as chrome.runtime.ManifestPermissions;
  return await browser.permissions.request({ permissions: [permissionName] });
}

async function removeApiPermission(permission: string): Promise<void> {
  const permissionName = permission as unknown as chrome.runtime.ManifestPermissions;
  await browser.permissions.remove({ permissions: [permissionName] }).catch(() => false);
}

type PopupState = Extract<BackgroundToPopup, { type: "state" }>;

// Restoring is explicit: the popup offers it, it never happens on page load.
function renderRestoreButton(state: PopupState, tabId: number): void {
  const label = state.permitted ? restoreAnnotationsLabel(state.annotationState) : null;
  restoreAnnotationsBtn.hidden = label === null;
  if (label === null) return;
  restoreAnnotationsBtn.textContent = label;
  restoreAnnotationsBtn.disabled = false;
  restoreAnnotationsBtn.onclick = async () => {
    restoreAnnotationsBtn.disabled = true;
    const response = await send({ type: "annotation_action", tabId, action: "restore" });
    await refresh();
    const message =
      response.type === "error"
        ? `error: ${response.message}`
        : response.type === "ok"
          ? response.message
          : undefined;
    if (message) {
      const note = document.createElement("div");
      note.textContent = message;
      statusEl.append(note);
    }
  };
}

async function refresh(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    tabInfoEl.textContent = "(no active tab)";
    actionBtn.disabled = true;
    return;
  }
  const tabId = tab.id;
  tabInfoEl.textContent = tab.title ?? tab.url ?? "(untitled)";
  const state = await send({ type: "get_state", tabId });
  if (state.type !== "state") {
    statusEl.textContent = state.type === "error" ? state.message : "unknown state";
    return;
  }

  approvalToggleEl.checked = state.settings.operationsRequireApproval;
  approvalToggleEl.disabled = false;
  approvalToggleEl.onchange = async () => {
    const nextValue = approvalToggleEl.checked;
    approvalToggleEl.disabled = true;
    const response = await send({
      type: "set_operations_require_approval",
      value: nextValue,
    });
    if (response.type === "error") {
      approvalToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
    }
    approvalToggleEl.disabled = false;
  };

  evalToggleEl.checked = state.settings.evalEnabled;
  evalToggleEl.disabled = false;
  evalToggleEl.onchange = async () => {
    const nextValue = evalToggleEl.checked;
    evalToggleEl.disabled = true;
    const response = await send({
      type: "set_eval_enabled",
      value: nextValue,
    });
    if (response.type === "error") {
      evalToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
    }
    evalToggleEl.disabled = false;
  };

  trustedAutomationToggleEl.checked = state.settings.trustedAutomationEnabled;
  trustedAutomationToggleEl.disabled = false;
  trustedAutomationNoteEl.textContent = trustedAutomationNote(state.settings);
  trustedAutomationToggleEl.onchange = async () => {
    const nextValue = trustedAutomationToggleEl.checked;
    trustedAutomationToggleEl.disabled = true;
    const response = await send({
      type: "set_trusted_automation_enabled",
      value: nextValue,
    });
    if (response.type === "error") {
      trustedAutomationToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
    }
    trustedAutomationToggleEl.disabled = false;
    await refresh();
  };

  allTabsToggleEl.checked = state.allTabsAccess.active;
  allTabsToggleEl.disabled = false;
  allTabsNoteEl.textContent = allTabsAccessNote(state.settings, state.allTabsAccess);
  allTabsSettingEl.classList.toggle("warning-active", state.allTabsAccess.active);
  allTabsToggleEl.onchange = async () => {
    const nextValue = allTabsToggleEl.checked;
    allTabsToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestAllTabsPermission();
      if (!granted) {
        allTabsToggleEl.checked = false;
        allTabsNoteEl.textContent = "All-tabs permission was not granted.";
        allTabsToggleEl.disabled = false;
        return;
      }
    }
    const response = await send({
      type: "set_all_tabs_access",
      value: nextValue,
    });
    if (response.type === "error") {
      allTabsToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
      if (nextValue) await removeAllTabsPermission();
      allTabsToggleEl.disabled = false;
      return;
    } else if (!nextValue) {
      await removeAllTabsPermission();
    }
    allTabsToggleEl.disabled = false;
    await refresh();
  };

  bookmarksToggleEl.checked = state.personalDataAccess.bookmarks.active;
  bookmarksToggleEl.disabled = !state.personalDataAccess.bookmarks.supported;
  bookmarksNoteEl.textContent = state.personalDataAccess.bookmarks.supported
    ? "Separate browser-owned personal data permission. URLs are returned only by bookmark commands and are not shared-tab state."
    : "This browser target does not expose the bookmarks extension API.";
  bookmarksToggleEl.onchange = async () => {
    const nextValue = bookmarksToggleEl.checked;
    bookmarksToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestApiPermission("bookmarks");
      if (!granted) {
        bookmarksToggleEl.checked = false;
        bookmarksNoteEl.textContent = "Bookmarks permission was not granted.";
        bookmarksToggleEl.disabled = false;
        return;
      }
    }
    const response = await send({ type: "set_bookmarks_access", value: nextValue });
    if (response.type === "error") {
      bookmarksToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
      if (nextValue) await removeApiPermission("bookmarks");
      bookmarksToggleEl.disabled = false;
      return;
    } else if (!nextValue) {
      await removeApiPermission("bookmarks");
    }
    bookmarksToggleEl.disabled = false;
    await refresh();
  };

  readingListToggleEl.checked = state.personalDataAccess.readingList.active;
  readingListToggleEl.disabled = !state.personalDataAccess.readingList.supported;
  readingListNoteEl.textContent = state.personalDataAccess.readingList.supported
    ? "Separate browser-owned personal data permission for saved Reading List entries."
    : "This browser target does not expose chrome.readingList. Chrome documents it for Chrome 120+.";
  readingListToggleEl.onchange = async () => {
    const nextValue = readingListToggleEl.checked;
    readingListToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestApiPermission("readingList");
      if (!granted) {
        readingListToggleEl.checked = false;
        readingListNoteEl.textContent = "Reading List permission was not granted.";
        readingListToggleEl.disabled = false;
        return;
      }
    }
    const response = await send({ type: "set_reading_list_access", value: nextValue });
    if (response.type === "error") {
      readingListToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
      if (nextValue) await removeApiPermission("readingList");
      readingListToggleEl.disabled = false;
      return;
    } else if (!nextValue) {
      await removeApiPermission("readingList");
    }
    readingListToggleEl.disabled = false;
    await refresh();
  };

  personalDataMutationsToggleEl.checked = state.settings.personalDataMutationsEnabled;
  personalDataMutationsNoteEl.textContent =
    "Allows agent-requested bookmark and Reading List changes. Every change still opens a per-operation approval window; deletes use stronger confirmation copy.";
  personalDataMutationsToggleEl.onchange = async () => {
    const nextValue = personalDataMutationsToggleEl.checked;
    personalDataMutationsToggleEl.disabled = true;
    const response = await send({ type: "set_personal_data_mutations", value: nextValue });
    if (response.type === "error") {
      personalDataMutationsToggleEl.checked = !nextValue;
      statusEl.textContent = `error: ${response.message}`;
    }
    personalDataMutationsToggleEl.disabled = false;
    await refresh();
  };

  // Only seed the profile input once per popup open so the user's typing isn't clobbered.
  if (document.activeElement !== profileLabelEl) {
    profileLabelEl.value = state.settings.profileLabel;
  }
  profileLabelEl.oninput = () => {
    if (profileLabelTimer !== null) clearTimeout(profileLabelTimer);
    profileLabelTimer = setTimeout(async () => {
      profileLabelTimer = null;
      const response = await send({ type: "set_profile_label", value: profileLabelEl.value });
      if (response.type === "error") {
        statusEl.textContent = `error: ${response.message}`;
      }
    }, 350) as unknown as number;
  };

  if (document.activeElement !== gatewayWebSocketUrlEl) {
    gatewayWebSocketUrlEl.value = state.settings.gatewayWebSocketUrl;
  }
  const applyGatewayWebSocketUrl = async () => {
    applyGatewayUrlBtn.disabled = true;
    const response = await send({
      type: "set_gateway_websocket_url",
      value: gatewayWebSocketUrlEl.value,
    });
    if (response.type === "error") {
      statusEl.textContent = `error: ${response.message}`;
      applyGatewayUrlBtn.disabled = false;
      return;
    }
    gatewayWebSocketUrlEl.blur();
    statusEl.textContent = "Reconnecting to Gateway…";
    await refresh();
  };
  applyGatewayUrlBtn.disabled = false;
  applyGatewayUrlBtn.onclick = applyGatewayWebSocketUrl;
  gatewayWebSocketUrlEl.onkeydown = async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await applyGatewayWebSocketUrl();
  };

  const incognitoAccessAllowed = state.activeTab.incognitoAccessAllowed;
  const incognitoBlocked = state.activeTab.incognito && !incognitoAccessAllowed;
  const allTabsActive = state.allTabsAccess.active;
  incognitoNoticeEl.hidden = incognitoAccessAllowed;
  openExtensionsBtn.onclick = async () => {
    await openExtensionSettings();
  };

  if (allTabsActive) {
    actionBtn.textContent = "Disable all-tabs access";
    actionBtn.className = "danger";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      allTabsToggleEl.checked = false;
      const response = await send({ type: "set_all_tabs_access", value: false });
      if (response.type === "error") {
        statusEl.textContent = `error: ${response.message}`;
        actionBtn.disabled = false;
        return;
      }
      await removeAllTabsPermission();
      await refresh();
    };
    annotationBtn.disabled = !state.permitted;
    annotationBtn.textContent = annotationButtonLabel(state.annotationState);
    annotationBtn.className = state.annotationState.enabled ? "annotation-on" : "secondary";
    annotationBtn.onclick = async () => {
      if (!state.permitted) return;
      annotationBtn.disabled = true;
      const response = await send({
        type: "annotation_action",
        tabId,
        action: state.annotationState.enabled ? "stop" : "start",
      });
      if (response.type === "error") {
        statusEl.textContent = `error: ${response.message}`;
        annotationBtn.disabled = false;
        return;
      }
      window.close();
      await refresh();
    };
    clearAnnotationsBtn.disabled =
      !state.permitted ||
      (state.annotationState.count === 0 && state.annotationState.restorableCount === 0);
    clearAnnotationsBtn.onclick = async () => {
      if (!state.permitted) return;
      clearAnnotationsBtn.disabled = true;
      await send({ type: "annotation_action", tabId, action: "clear" });
      await refresh();
    };
    renderRestoreButton(state, tabId);
  } else if (incognitoBlocked) {
    actionBtn.textContent = "Enable incognito access first";
    actionBtn.className = "secondary";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await openExtensionSettings();
    };
    annotationBtn.disabled = true;
    annotationBtn.textContent = "Annotate this tab";
    annotationBtn.className = "secondary";
    clearAnnotationsBtn.disabled = true;
    restoreAnnotationsBtn.hidden = true;
  } else if (state.permitted) {
    actionBtn.textContent = "Revoke this tab";
    actionBtn.className = "danger";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await send({ type: "revoke", tabId });
      await refresh();
    };
    annotationBtn.disabled = false;
    annotationBtn.textContent = annotationButtonLabel(state.annotationState);
    annotationBtn.className = state.annotationState.enabled ? "annotation-on" : "secondary";
    annotationBtn.onclick = async () => {
      annotationBtn.disabled = true;
      const response = await send({
        type: "annotation_action",
        tabId,
        action: state.annotationState.enabled ? "stop" : "start",
      });
      if (response.type === "error") {
        statusEl.textContent = `error: ${response.message}`;
        annotationBtn.disabled = false;
        return;
      }
      window.close();
      await refresh();
    };
    clearAnnotationsBtn.disabled =
      state.annotationState.count === 0 && state.annotationState.restorableCount === 0;
    clearAnnotationsBtn.onclick = async () => {
      clearAnnotationsBtn.disabled = true;
      await send({ type: "annotation_action", tabId, action: "clear" });
      await refresh();
    };
    renderRestoreButton(state, tabId);
  } else {
    actionBtn.textContent = "Share this tab with agent";
    actionBtn.className = "primary";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await send({ type: "permit", tabId });
      await refresh();
    };
    annotationBtn.disabled = true;
    annotationBtn.textContent = "Annotate this tab";
    annotationBtn.className = "secondary";
    clearAnnotationsBtn.disabled = true;
    restoreAnnotationsBtn.hidden = true;
  }

  const shortcutMessage = recentShortcutMessage(state.shortcutFeedback, Date.now());
  shortcutResultEl.hidden = !shortcutMessage;
  shortcutResultEl.textContent = shortcutMessage ?? "";
  shortcutResultEl.className = `shortcut-result ${state.shortcutFeedback?.level ?? ""}`;
  const commands = await browser.commands.getAll().catch(() => []);
  shortcutHintEl.textContent = shortcutHint(commands, browser.kind);

  renderPill(tabStatusEl, tabAccessStatusPill(state));
  statusEl.replaceChildren();
  renderPill(gatewayStatusEl, gatewayStatusPill(state.wsConnected));

  if (state.sharedTabs.length > 0) {
    const heading = document.createElement("h2");
    heading.className = "label";
    heading.textContent = sharedTabsHeading(state.sharedTabs.length);
    const list = document.createElement("ul");
    for (const t of state.sharedTabs) {
      const item = document.createElement("li");
      item.className = "shared-item";
      item.title = sharedTabSummary(t);
      const idEl = document.createElement("span");
      idEl.className = "tab-id";
      idEl.textContent = String(t.tabId);
      const titleEl = document.createElement("span");
      titleEl.className = "tab-title";
      titleEl.textContent = t.title || t.url;
      item.append(idEl, titleEl);
      const accessLabel = sharedTabAccessLabel(t);
      if (accessLabel) {
        const modeEl = document.createElement("span");
        modeEl.className = "pill warning";
        modeEl.textContent = accessLabel;
        item.append(modeEl);
      }
      list.append(item);
    }
    sharedListEl.replaceChildren(heading, list);
  } else {
    sharedListEl.replaceChildren();
  }
}

refresh().catch((e) => {
  statusEl.textContent = `error: ${e}`;
});
