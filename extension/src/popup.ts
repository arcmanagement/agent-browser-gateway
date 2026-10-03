import { browserAdapter } from "./browserAdapter.js";
import { applyTranslations } from "./domI18n.js";
import {
  browserUiLocale,
  isUiLanguageSetting,
  type Language,
  readUiLanguage,
  resolveUiLanguage,
  t,
} from "./i18n.js";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  errorText,
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
const uiLanguageEl = document.getElementById("uiLanguage") as HTMLSelectElement;

let profileLabelTimer: number | null = null;
// Display language for this popup. Set from storage before the first render, then from each
// state refresh; changing the setting re-renders the popup immediately.
let lang: Language = "en";

function setLanguage(next: Language): void {
  if (next === lang && document.documentElement.lang === next) return;
  lang = next;
  applyTranslations(document, lang);
}

function showError(response: { message: string; code?: string }): void {
  statusEl.textContent = errorText(response, lang);
}

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
  const label = state.permitted ? restoreAnnotationsLabel(state.annotationState, lang) : null;
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
        ? errorText(response, lang)
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
    tabInfoEl.textContent = t(lang, "popup.tab.none");
    actionBtn.disabled = true;
    return;
  }
  const tabId = tab.id;
  const state = await send({ type: "get_state", tabId });
  if (state.type === "state") {
    setLanguage(resolveUiLanguage(state.settings.uiLanguage, browserUiLocale()));
  }
  tabInfoEl.textContent = tab.title ?? tab.url ?? t(lang, "common.untitled");
  if (state.type !== "state") {
    statusEl.textContent =
      state.type === "error" ? errorText(state, lang) : t(lang, "popup.tab.unknownState");
    return;
  }

  uiLanguageEl.value = state.settings.uiLanguage;
  uiLanguageEl.disabled = false;
  uiLanguageEl.onchange = async () => {
    const value = uiLanguageEl.value;
    if (!isUiLanguageSetting(value)) return;
    uiLanguageEl.disabled = true;
    const response = await send({ type: "set_ui_language", value });
    if (response.type === "error") {
      uiLanguageEl.value = state.settings.uiLanguage;
      showError(response);
      uiLanguageEl.disabled = false;
      return;
    }
    // Takes effect in the popup right away; refresh() re-applies the static text too.
    await refresh();
  };

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
      showError(response);
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
      showError(response);
    }
    evalToggleEl.disabled = false;
  };

  trustedAutomationToggleEl.checked = state.settings.trustedAutomationEnabled;
  trustedAutomationToggleEl.disabled = false;
  trustedAutomationNoteEl.textContent = trustedAutomationNote(state.settings, lang);
  trustedAutomationToggleEl.onchange = async () => {
    const nextValue = trustedAutomationToggleEl.checked;
    trustedAutomationToggleEl.disabled = true;
    const response = await send({
      type: "set_trusted_automation_enabled",
      value: nextValue,
    });
    if (response.type === "error") {
      trustedAutomationToggleEl.checked = !nextValue;
      showError(response);
    }
    trustedAutomationToggleEl.disabled = false;
    await refresh();
  };

  allTabsToggleEl.checked = state.allTabsAccess.active;
  allTabsToggleEl.disabled = false;
  allTabsNoteEl.textContent = allTabsAccessNote(state.settings, state.allTabsAccess, lang);
  allTabsSettingEl.classList.toggle("warning-active", state.allTabsAccess.active);
  allTabsToggleEl.onchange = async () => {
    const nextValue = allTabsToggleEl.checked;
    allTabsToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestAllTabsPermission();
      if (!granted) {
        allTabsToggleEl.checked = false;
        allTabsNoteEl.textContent = t(lang, "popup.permissions.allTabs.notGranted");
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
      showError(response);
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
    ? t(lang, "popup.permissions.bookmarks.note")
    : t(lang, "popup.permissions.bookmarks.unsupported");
  bookmarksToggleEl.onchange = async () => {
    const nextValue = bookmarksToggleEl.checked;
    bookmarksToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestApiPermission("bookmarks");
      if (!granted) {
        bookmarksToggleEl.checked = false;
        bookmarksNoteEl.textContent = t(lang, "popup.permissions.bookmarks.notGranted");
        bookmarksToggleEl.disabled = false;
        return;
      }
    }
    const response = await send({ type: "set_bookmarks_access", value: nextValue });
    if (response.type === "error") {
      bookmarksToggleEl.checked = !nextValue;
      showError(response);
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
    ? t(lang, "popup.permissions.readingList.note")
    : t(lang, "popup.permissions.readingList.unsupported");
  readingListToggleEl.onchange = async () => {
    const nextValue = readingListToggleEl.checked;
    readingListToggleEl.disabled = true;
    if (nextValue) {
      const granted = await requestApiPermission("readingList");
      if (!granted) {
        readingListToggleEl.checked = false;
        readingListNoteEl.textContent = t(lang, "popup.permissions.readingList.notGranted");
        readingListToggleEl.disabled = false;
        return;
      }
    }
    const response = await send({ type: "set_reading_list_access", value: nextValue });
    if (response.type === "error") {
      readingListToggleEl.checked = !nextValue;
      showError(response);
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
  personalDataMutationsNoteEl.textContent = t(lang, "popup.permissions.personalDataMutations.note");
  personalDataMutationsToggleEl.onchange = async () => {
    const nextValue = personalDataMutationsToggleEl.checked;
    personalDataMutationsToggleEl.disabled = true;
    const response = await send({ type: "set_personal_data_mutations", value: nextValue });
    if (response.type === "error") {
      personalDataMutationsToggleEl.checked = !nextValue;
      showError(response);
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
        showError(response);
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
      showError(response);
      applyGatewayUrlBtn.disabled = false;
      return;
    }
    gatewayWebSocketUrlEl.blur();
    statusEl.textContent = t(lang, "popup.advanced.gatewayUrl.reconnecting");
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
    actionBtn.textContent = t(lang, "popup.action.disableAllTabs");
    actionBtn.className = "danger";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      allTabsToggleEl.checked = false;
      const response = await send({ type: "set_all_tabs_access", value: false });
      if (response.type === "error") {
        showError(response);
        actionBtn.disabled = false;
        return;
      }
      await removeAllTabsPermission();
      await refresh();
    };
    annotationBtn.disabled = !state.permitted;
    annotationBtn.textContent = annotationButtonLabel(state.annotationState, lang);
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
        showError(response);
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
    actionBtn.textContent = t(lang, "popup.action.enableIncognito");
    actionBtn.className = "secondary";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await openExtensionSettings();
    };
    annotationBtn.disabled = true;
    annotationBtn.textContent = t(lang, "popup.annotation.start");
    annotationBtn.className = "secondary";
    clearAnnotationsBtn.disabled = true;
    restoreAnnotationsBtn.hidden = true;
  } else if (state.permitted) {
    actionBtn.textContent = t(lang, "popup.action.revoke");
    actionBtn.className = "danger";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await send({ type: "revoke", tabId });
      await refresh();
    };
    annotationBtn.disabled = false;
    annotationBtn.textContent = annotationButtonLabel(state.annotationState, lang);
    annotationBtn.className = state.annotationState.enabled ? "annotation-on" : "secondary";
    annotationBtn.onclick = async () => {
      annotationBtn.disabled = true;
      const response = await send({
        type: "annotation_action",
        tabId,
        action: state.annotationState.enabled ? "stop" : "start",
      });
      if (response.type === "error") {
        showError(response);
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
    actionBtn.textContent = t(lang, "popup.action.share");
    actionBtn.className = "primary";
    actionBtn.disabled = false;
    actionBtn.onclick = async () => {
      await send({ type: "permit", tabId });
      await refresh();
    };
    annotationBtn.disabled = true;
    annotationBtn.textContent = t(lang, "popup.annotation.start");
    annotationBtn.className = "secondary";
    clearAnnotationsBtn.disabled = true;
    restoreAnnotationsBtn.hidden = true;
  }

  const shortcutMessage = recentShortcutMessage(state.shortcutFeedback, Date.now(), lang);
  shortcutResultEl.hidden = !shortcutMessage;
  shortcutResultEl.textContent = shortcutMessage ?? "";
  shortcutResultEl.className = `shortcut-result ${state.shortcutFeedback?.level ?? ""}`;
  const commands = await browser.commands.getAll().catch(() => []);
  shortcutHintEl.textContent = shortcutHint(commands, browser.kind, lang);

  renderPill(tabStatusEl, tabAccessStatusPill(state, lang));
  statusEl.replaceChildren();
  renderPill(gatewayStatusEl, gatewayStatusPill(state.wsConnected, lang));

  if (state.sharedTabs.length > 0) {
    const heading = document.createElement("h2");
    heading.className = "label";
    heading.textContent = sharedTabsHeading(state.sharedTabs.length, lang);
    const list = document.createElement("ul");
    for (const sharedTab of state.sharedTabs) {
      const item = document.createElement("li");
      item.className = "shared-item";
      item.title = sharedTabSummary(sharedTab);
      const idEl = document.createElement("span");
      idEl.className = "tab-id";
      idEl.textContent = String(sharedTab.tabId);
      const titleEl = document.createElement("span");
      titleEl.className = "tab-title";
      titleEl.textContent = sharedTab.title || sharedTab.url;
      item.append(idEl, titleEl);
      const accessLabel = sharedTabAccessLabel(sharedTab, lang);
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

readUiLanguage(browser.storage.local)
  .then((initial) => {
    // Translate the static text before the first state round trip so it does not flash English.
    lang = initial;
    applyTranslations(document, lang);
  })
  .catch(() => {})
  .then(() => refresh())
  .catch((e) => {
    statusEl.textContent = t(lang, "common.errorPrefix", { message: String(e) });
  });
