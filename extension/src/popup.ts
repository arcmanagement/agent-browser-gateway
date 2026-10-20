import { browserAdapter } from "./browserAdapter.js";
import { cloudServiceOrigin } from "./cloudConnection.js";
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
  type GateMode,
  gatewayStatusPill,
  recentShortcutMessage,
  restoreAnnotationsLabel,
  type StatusPill,
  sharedTabAccessLabel,
  sharedTabSummary,
  shortcutHint,
  shortcutKeys,
  tabGate,
  tabHost,
  tabRiskFlags,
  trustedAutomationNote,
  visibleSharedTabs,
} from "./popupLogic.js";
import type { BackgroundToPopup, PopupToBackground } from "./types.js";

const browser = browserAdapter;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const topEl = byId<HTMLElement>("top");
const heroEl = byId<HTMLElement>("hero");
const tabStateEl = byId<HTMLHeadingElement>("tabState");
const tabIdEl = byId<HTMLSpanElement>("tabId");
const tabInfoEl = byId<HTMLSpanElement>("tabInfo");
const tabHostEl = byId<HTMLSpanElement>("tabHost");
const tabDetailEl = byId<HTMLParagraphElement>("tabDetail");
const tabFlagsEl = byId<HTMLUListElement>("tabFlags");
const gatewayStatusEl = byId<HTMLSpanElement>("gatewayStatus");
const gatewayBannerEl = byId<HTMLDivElement>("gatewayBanner");
const gatewayBannerBodyEl = byId<HTMLSpanElement>("gatewayBannerBody");
const actionBtn = byId<HTMLButtonElement>("actionBtn");
const annotationsEl = byId<HTMLDivElement>("annotations");
const annotationBtn = byId<HTMLButtonElement>("annotationBtn");
const clearAnnotationsBtn = byId<HTMLButtonElement>("clearAnnotationsBtn");
const restoreAnnotationsBtn = byId<HTMLButtonElement>("restoreAnnotationsBtn");
const approvalToggleEl = byId<HTMLInputElement>("approvalToggle");
const evalToggleEl = byId<HTMLInputElement>("evalToggle");
const trustedAutomationToggleEl = byId<HTMLInputElement>("trustedAutomationToggle");
const trustedAutomationNoteEl = byId<HTMLDivElement>("trustedAutomationNote");
const allTabsToggleEl = byId<HTMLInputElement>("allTabsToggle");
const allTabsNoteEl = byId<HTMLDivElement>("allTabsNote");
const bookmarksToggleEl = byId<HTMLInputElement>("bookmarksToggle");
const bookmarksNoteEl = byId<HTMLDivElement>("bookmarksNote");
const readingListToggleEl = byId<HTMLInputElement>("readingListToggle");
const readingListNoteEl = byId<HTMLDivElement>("readingListNote");
const personalDataMutationsToggleEl = byId<HTMLInputElement>("personalDataMutationsToggle");
const profileLabelEl = byId<HTMLInputElement>("profileLabel");
const gatewayWebSocketUrlEl = byId<HTMLInputElement>("gatewayWebSocketUrl");
const connectionDestinationEl = byId<HTMLSelectElement>("connectionDestination");
const connectionPanelEl = byId<HTMLDetailsElement>("connectionPanel");
const connectionDestinationLabelEl = byId<HTMLElement>("connectionDestinationLabel");
const cloudUrlEl = byId<HTMLInputElement>("cloudUrl");
const cloudCodeEl = byId<HTMLInputElement>("cloudCode");
const cloudConnectionFieldsEl = byId<HTMLElement>("cloudConnectionFields");
const applyConnectionBtn = byId<HTMLButtonElement>("applyConnectionBtn");
const savedCloudConnectionEl = byId<HTMLSelectElement>("savedCloudConnection");
const cloudRegistrationSettingsEl = byId<HTMLDetailsElement>("cloudRegistrationSettings");
const cloudConnectionNameEl = byId<HTMLInputElement>("cloudConnectionName");
const cloudLoginBtn = byId<HTMLButtonElement>("cloudLoginBtn");
const deleteCloudConnectionBtn = byId<HTMLButtonElement>("deleteCloudConnectionBtn");
const cloudLoginStatusEl = byId<HTMLElement>("cloudLoginStatus");
const cloudManualConnectionEl = byId<HTMLDetailsElement>("cloudManualConnection");
let connectionFormDirty = false;
let applyingConnection = false;
let connectionPanelInitialized = false;
const applyGatewayUrlBtn = byId<HTMLButtonElement>("applyGatewayUrlBtn");
const statusEl = byId<HTMLDivElement>("status");
const sharedListEl = byId<HTMLElement>("sharedList");
const shortcutResultEl = byId<HTMLDivElement>("shortcutResult");
const shortcutKeysEl = byId<HTMLDivElement>("shortcutKeys");
const shortcutHintEl = byId<HTMLDivElement>("shortcutHint");
const uiLanguageEl = byId<HTMLSelectElement>("uiLanguage");

const diagnosticsPanel = byId<HTMLDetailsElement>("connectionDiagnosticsPanel");
const diagnosticsStatus = byId<HTMLElement>("connectionDiagnosticsStatus");
const diagnosticsLog = byId<HTMLElement>("connectionDiagnosticsLog");
const refreshDiagnosticsBtn = byId<HTMLButtonElement>("refreshDiagnosticsBtn");
const saveDiagnosticsBtn = byId<HTMLButtonElement>("saveDiagnosticsBtn");

let profileLabelTimer: number | null = null;
// Display language for this popup. Set from storage before the first render, then from each
// state refresh; changing the setting re-renders the popup immediately.
let lang: Language = "en";
// Gate mode of the last render, so the share -> shared and revoke transitions animate only
// when the state really changes (never on first paint).
let lastGate: GateMode | null = null;
let transitionTimer: number | null = null;
// Whether the shared-tabs list shows every row; it stays as the user left it across refreshes.
let sharedTabsExpanded = false;

function setLanguage(next: Language): void {
  if (next === lang && document.documentElement.lang === next) return;
  lang = next;
  applyTranslations(document, lang);
}

// The status line under the primary action. It keeps its message across refreshes and is
// cleared when the user starts the next action.
function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", isError);
}

function clearStatus(): void {
  setStatus("");
}

function showError(response: { message: string; code?: string }): void {
  setStatus(errorText(response, lang), true);
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

/** Switches in the higher-risk groups tint their row while they are on. */
function syncRiskRows(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("input.switch.warning")) {
    input.closest(".setting")?.classList.toggle("warning-active", input.checked);
  }
}

function renderGate(mode: GateMode): void {
  const previous = lastGate;
  heroEl.dataset.gate = mode;
  lastGate = mode;
  if (previous === null || previous === mode) return;
  heroEl.classList.remove("just-opened", "just-changed");
  // Restart the one-shot animations: force a style flush before re-adding the classes.
  void heroEl.offsetWidth;
  heroEl.classList.add("just-changed");
  if (mode === "open" || mode === "sandbox") heroEl.classList.add("just-opened");
  if (transitionTimer !== null) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    heroEl.classList.remove("just-opened", "just-changed");
    transitionTimer = null;
  }, 1200) as unknown as number;
}

function renderShortcutKeys(commands: { name?: string; shortcut?: string }[]): void {
  const items = shortcutKeys(commands, lang).filter((item) => item.keys);
  shortcutKeysEl.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("span");
      row.className = "key";
      const kbd = document.createElement("kbd");
      kbd.textContent = item.keys;
      row.append(kbd, item.label);
      return row;
    }),
  );
}

function renderSharedTabs(state: PopupState, currentTabId: number): void {
  if (state.sharedTabs.length === 0) {
    sharedListEl.replaceChildren();
    return;
  }
  const head = document.createElement("div");
  head.className = "section-head";
  const heading = document.createElement("h2");
  heading.className = "label";
  heading.textContent = t(lang, "popup.sharedTabs.heading");
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(state.sharedTabs.length);
  head.append(heading, count);

  const list = document.createElement("ul");
  list.className = "list";
  list.id = "sharedTabsList";
  const { rows, hidden } = visibleSharedTabs(state.sharedTabs, currentTabId, sharedTabsExpanded);
  for (const sharedTab of rows) {
    const item = document.createElement("li");
    const allTabs = sharedTab.accessMode === "all_tabs";
    item.className = allTabs ? "list-item all-tabs" : "list-item";
    item.title = sharedTabSummary(sharedTab);
    const dot = document.createElement("span");
    dot.className = "list-dot";
    dot.setAttribute("aria-hidden", "true");
    const titleEl = document.createElement("span");
    titleEl.className = "list-title";
    titleEl.textContent = sharedTab.title || sharedTab.url;
    const idEl = document.createElement("span");
    idEl.className = "list-id";
    idEl.textContent = String(sharedTab.tabId);
    item.append(dot, titleEl, idEl);

    const accessLabel = sharedTabAccessLabel(sharedTab, lang);
    if (accessLabel) {
      const tag = document.createElement("span");
      tag.className = "tag warning";
      tag.textContent = accessLabel;
      item.append(tag);
    } else if (sharedTab.tabId === currentTabId) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t(lang, "popup.sharedTabs.thisTab");
      item.append(tag);
    } else {
      // Revoking another shared tab is always safe: it only removes access.
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "danger revoke";
      revoke.textContent = t(lang, "popup.sharedTabs.revoke");
      revoke.setAttribute(
        "aria-label",
        t(lang, "popup.sharedTabs.revokeLabel", {
          tabId: sharedTab.tabId,
          title: sharedTab.title || sharedTab.url,
        }),
      );
      revoke.onclick = async () => {
        revoke.disabled = true;
        clearStatus();
        const response = await send({ type: "revoke", tabId: sharedTab.tabId });
        if (response.type === "error") showError(response);
        await refresh();
      };
      item.append(revoke);
    }
    list.append(item);
  }
  // Collapsing only applies when there is something to hide or to fold back.
  if (hidden > 0 || sharedTabsExpanded) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "list-more";
    toggle.setAttribute("aria-controls", list.id);
    toggle.setAttribute("aria-expanded", String(sharedTabsExpanded));
    toggle.textContent = sharedTabsExpanded
      ? t(lang, "popup.sharedTabs.showLess")
      : t(lang, "popup.sharedTabs.showMore", { count: hidden });
    toggle.onclick = () => {
      sharedTabsExpanded = !sharedTabsExpanded;
      renderSharedTabs(state, currentTabId);
      document.querySelector<HTMLButtonElement>("#sharedList .list-more")?.focus();
    };
    const row = document.createElement("li");
    row.className = "list-item list-more-row";
    row.append(toggle);
    list.append(row);
  }
  sharedListEl.replaceChildren(head, list);
}

// Restoring is explicit: the popup offers it, it never happens on page load.
function renderRestoreButton(state: PopupState, tabId: number): void {
  const label = state.permitted ? restoreAnnotationsLabel(state.annotationState, lang) : null;
  restoreAnnotationsBtn.hidden = label === null;
  if (label === null) return;
  restoreAnnotationsBtn.textContent = label;
  restoreAnnotationsBtn.disabled = false;
  restoreAnnotationsBtn.onclick = async () => {
    restoreAnnotationsBtn.disabled = true;
    clearStatus();
    const response = await send({ type: "annotation_action", tabId, action: "restore" });
    await refresh();
    if (response.type === "error") showError(response);
    else if (response.type === "ok" && response.message) setStatus(response.message);
  };
}

function renderAnnotations(state: PopupState, tabId: number): void {
  annotationsEl.hidden = !state.permitted;
  if (!state.permitted) return;
  annotationBtn.disabled = false;
  annotationBtn.textContent = annotationButtonLabel(state.annotationState, lang);
  annotationBtn.className = state.annotationState.enabled ? "annotation-on" : "secondary";
  annotationBtn.onclick = async () => {
    annotationBtn.disabled = true;
    clearStatus();
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
    clearStatus();
    await send({ type: "annotation_action", tabId, action: "clear" });
    await refresh();
  };
  renderRestoreButton(state, tabId);
}

function renderAction(state: PopupState, tabId: number, mode: GateMode): void {
  actionBtn.hidden = false;
  actionBtn.disabled = false;
  if (state.allTabsAccess.active) {
    actionBtn.textContent = t(lang, "popup.action.disableAllTabs");
    actionBtn.className = "action danger";
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      clearStatus();
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
    return;
  }
  if (mode === "blocked") {
    actionBtn.textContent = t(lang, "popup.incognito.openSettings");
    actionBtn.className = "action secondary";
    actionBtn.onclick = async () => {
      await openExtensionSettings();
    };
    return;
  }
  if (mode === "open") {
    actionBtn.textContent = t(lang, "popup.action.revoke");
    actionBtn.className = "action danger";
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      clearStatus();
      const response = await send({ type: "revoke", tabId });
      if (response.type === "error") showError(response);
      await refresh();
    };
    return;
  }
  if (mode === "unsupported") {
    actionBtn.hidden = true;
    actionBtn.onclick = null;
    return;
  }
  actionBtn.textContent = t(lang, "popup.action.share");
  actionBtn.className = "action primary";
  actionBtn.onclick = async () => {
    actionBtn.disabled = true;
    clearStatus();
    const response = await send({ type: "permit", tabId });
    if (response.type === "error") showError(response);
    await refresh();
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
  tabInfoEl.textContent = tab.title || tab.url || t(lang, "common.untitled");
  tabHostEl.textContent = tabHost(tab.url);
  tabIdEl.textContent = t(lang, "popup.tab.id", { tabId });
  if (state.type !== "state") {
    setStatus(
      state.type === "error" ? errorText(state, lang) : t(lang, "popup.tab.unknownState"),
      true,
    );
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
    syncRiskRows();
    const response = await send({
      type: "set_eval_enabled",
      value: nextValue,
    });
    if (response.type === "error") {
      evalToggleEl.checked = !nextValue;
      showError(response);
    }
    evalToggleEl.disabled = false;
    await refresh();
  };

  trustedAutomationToggleEl.checked = state.settings.trustedAutomationEnabled;
  trustedAutomationToggleEl.disabled = false;
  trustedAutomationNoteEl.textContent = trustedAutomationNote(state.settings, lang);
  trustedAutomationToggleEl.onchange = async () => {
    const nextValue = trustedAutomationToggleEl.checked;
    trustedAutomationToggleEl.disabled = true;
    syncRiskRows();
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

  const resumeSetting = byId<HTMLElement>("cloudSandboxResumeSetting");
  const resumeNote = byId<HTMLElement>("cloudSandboxResumeNote");
  const resumeToggle = byId<HTMLInputElement>("cloudSandboxResumeToggle");
  resumeSetting.hidden = resumeNote.hidden = state.settings.connectionDestination !== "cloud";
  resumeToggle.checked = state.allTabsAccess.resumeEnabled === true;
  resumeToggle.disabled = !state.activeCloudConnectionId || !state.allTabsAccess.active;
  resumeToggle.onchange = async () => {
    resumeToggle.disabled = true;
    const response = await send({ type: "set_cloud_sandbox_resume", value: resumeToggle.checked });
    if (response.type === "error") showError(response);
    await refresh();
  };
  allTabsToggleEl.checked = state.allTabsAccess.active;
  allTabsToggleEl.disabled =
    state.settings.connectionDestination === "cloud" && !state.cloudCodeConfigured;
  allTabsNoteEl.textContent = allTabsAccessNote(state.settings, state.allTabsAccess, lang);
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
  personalDataMutationsToggleEl.onchange = async () => {
    const nextValue = personalDataMutationsToggleEl.checked;
    personalDataMutationsToggleEl.disabled = true;
    syncRiskRows();
    const response = await send({ type: "set_personal_data_mutations", value: nextValue });
    if (response.type === "error") {
      personalDataMutationsToggleEl.checked = !nextValue;
      showError(response);
    }
    personalDataMutationsToggleEl.disabled = false;
    await refresh();
  };
  syncRiskRows();

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

  if (!connectionPanelInitialized) {
    connectionPanelEl.open =
      state.settings.connectionDestination === "cloud" && !state.cloudCodeConfigured;
    connectionPanelInitialized = true;
  }
  connectionDestinationLabelEl.textContent = t(
    lang,
    state.settings.connectionDestination === "cloud"
      ? "popup.connection.cloud"
      : "popup.connection.local",
  );
  if (!connectionFormDirty && !applyingConnection) {
    connectionDestinationEl.value = state.settings.connectionDestination;
    cloudUrlEl.value =
      state.settings.cloudWebSocketUrl || "https://connect.agent-browser-gateway.com";
    savedCloudConnectionEl.value = state.activeCloudConnectionId ?? "";
  }
  if (!applyingConnection) {
    const selected = connectionFormDirty
      ? savedCloudConnectionEl.value
      : (state.activeCloudConnectionId ?? "");
    savedCloudConnectionEl.replaceChildren();
    const fresh = document.createElement("option");
    fresh.value = "";
    fresh.textContent = t(lang, "popup.connection.add");
    savedCloudConnectionEl.append(fresh);
    for (const item of state.savedCloudConnections ?? []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      savedCloudConnectionEl.append(option);
    }
    savedCloudConnectionEl.value = selected;
  }
  const updateConnectionFields = () => {
    cloudConnectionFieldsEl.hidden = connectionDestinationEl.value !== "cloud";
    const selected = (state.savedCloudConnections ?? []).find(
      (c) => c.id === savedCloudConnectionEl.value,
    );
    cloudLoginBtn.hidden = false;
    cloudLoginBtn.textContent = t(
      lang,
      selected ? "popup.connection.relogin" : "popup.connection.login",
    );
    deleteCloudConnectionBtn.hidden = !selected;
    cloudRegistrationSettingsEl.hidden = !!selected;
    cloudManualConnectionEl.hidden = !!selected;
    cloudUrlEl.readOnly = !!selected;
    cloudConnectionNameEl.readOnly = !!selected;
    if (selected) {
      cloudUrlEl.value = selected.url;
      cloudConnectionNameEl.value = selected.name;
    } else if (!cloudConnectionNameEl.value.trim()) {
      cloudConnectionNameEl.value = state.settings.profileLabel || "Agent Browser Gateway";
    }
    cloudLoginStatusEl.textContent = state.cloudLoginPending
      ? t(lang, "popup.connection.loginPending")
      : t(lang, "popup.connection.savedNote");
    applyConnectionBtn.hidden =
      connectionDestinationEl.value === "cloud" && !selected && !cloudCodeEl.value.trim();
  };
  savedCloudConnectionEl.onchange = async () => {
    connectionFormDirty = true;
    cloudCodeEl.value = "";
    cloudConnectionNameEl.value = "";
    if (!savedCloudConnectionEl.value)
      cloudUrlEl.value = "https://connect.agent-browser-gateway.com";
    updateConnectionFields();
    if (savedCloudConnectionEl.value) await applySelectedConnection();
  };
  connectionDestinationEl.onchange = () => {
    connectionFormDirty = true;
    updateConnectionFields();
  };
  cloudUrlEl.oninput =
    cloudCodeEl.oninput =
    cloudConnectionNameEl.oninput =
      () => {
        connectionFormDirty = true;
        updateConnectionFields();
      };
  cloudCodeEl.placeholder = t(
    lang,
    state.cloudCodeConfigured ? "popup.connection.codeSaved" : "popup.connection.codeNeeded",
  );
  updateConnectionFields();
  applyConnectionBtn.disabled = applyingConnection;
  cloudLoginBtn.disabled = applyingConnection || !!state.cloudLoginPending;
  deleteCloudConnectionBtn.disabled = applyingConnection;
  cloudLoginBtn.onclick = async () => {
    const cloudUrl = cloudUrlEl.value;
    const name = cloudConnectionNameEl.value;
    const savedId = savedCloudConnectionEl.value || undefined;
    applyingConnection = true;
    clearStatus();
    cloudLoginBtn.disabled = true;
    try {
      if (!(await browser.permissions.request({ origins: [cloudServiceOrigin(cloudUrl)] }))) {
        showError({
          code: "cloud_service_permission_required",
          message: "Cloud service access is required.",
        });
        return;
      }
      const response = await send({ type: "begin_cloud_login", cloudUrl, name, savedId });
      if (response.type === "error") showError(response);
      else setStatus(t(lang, "popup.connection.loginPending"));
    } catch {
      showError({ code: "cloud_url_invalid", message: "Could not start Cloud login." });
    } finally {
      applyingConnection = false;
      await refresh();
    }
  };
  deleteCloudConnectionBtn.onclick = async () => {
    const id = savedCloudConnectionEl.value;
    applyingConnection = true;
    clearStatus();
    deleteCloudConnectionBtn.disabled = true;
    try {
      const response = await send({ type: "delete_cloud_connection", id });
      if (response.type === "error") showError(response);
      else {
        connectionFormDirty = false;
        cloudCodeEl.value = "";
        cloudConnectionNameEl.value = "";
      }
    } finally {
      applyingConnection = false;
      await refresh();
    }
  };
  const applySelectedConnection = async () => {
    if (applyingConnection) return;
    const destination = connectionDestinationEl.value === "cloud" ? "cloud" : "local";
    const cloudUrl = cloudUrlEl.value;
    const code = cloudCodeEl.value || undefined;
    const savedId = destination === "cloud" ? savedCloudConnectionEl.value || undefined : undefined;
    applyingConnection = true;
    applyConnectionBtn.disabled = true;
    clearStatus();
    try {
      if (destination === "cloud") {
        const endpoint = cloudUrl.trim() || state.settings.cloudWebSocketUrl;
        let origin: string;
        try {
          origin = cloudServiceOrigin(endpoint);
        } catch {
          showError({ code: "cloud_url_invalid", message: "Invalid Cloud URL." });
          return;
        }
        // Call from the apply gesture: request access only to the selected Cloud host.
        if (!(await browser.permissions.request({ origins: [origin] }))) {
          showError({
            code: "cloud_service_permission_required",
            message: "Cloud service access is required.",
          });
          return;
        }
      }
      const response = await send({
        type: "set_connection_destination",
        destination,
        cloudUrl,
        code,
        savedId,
      });
      if (response.type === "error") {
        showError(response);
        return;
      }
      cloudCodeEl.value = "";
      connectionFormDirty = false;
      connectionPanelEl.open = false;
      setStatus(t(lang, "popup.connection.applied"));
    } catch {
      showError({ message: t(lang, "popup.connection.offline") });
    } finally {
      applyingConnection = false;
      applyConnectionBtn.disabled = false;
      await refresh();
    }
  };
  applyConnectionBtn.onclick = applySelectedConnection;

  if (document.activeElement !== gatewayWebSocketUrlEl) {
    gatewayWebSocketUrlEl.value = state.settings.gatewayWebSocketUrl;
  }
  const applyGatewayWebSocketUrl = async () => {
    applyGatewayUrlBtn.disabled = true;
    clearStatus();
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
    setStatus(t(lang, "popup.advanced.gatewayUrl.reconnecting"));
    await refresh();
  };
  applyGatewayUrlBtn.disabled = false;
  applyGatewayUrlBtn.onclick = applyGatewayWebSocketUrl;
  gatewayWebSocketUrlEl.onkeydown = async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await applyGatewayWebSocketUrl();
  };

  // The hero: the tab at the gate, in words and in the graphic.
  const gate = tabGate(state, tab.url, lang);
  tabStateEl.textContent = gate.headline;
  tabDetailEl.textContent = gate.detail;
  const flags = tabRiskFlags(state.settings, gate.mode, lang);
  tabFlagsEl.replaceChildren(
    ...flags.map((flag) => {
      const item = document.createElement("li");
      item.textContent = flag;
      return item;
    }),
  );
  tabFlagsEl.hidden = flags.length === 0;
  renderGate(gate.mode);
  renderAction(state, tabId, gate.mode);
  renderAnnotations(state, tabId);

  const shortcutMessage = recentShortcutMessage(state.shortcutFeedback, Date.now(), lang);
  shortcutResultEl.hidden = !shortcutMessage;
  shortcutResultEl.textContent = shortcutMessage ?? "";
  shortcutResultEl.className = `evidence ${state.shortcutFeedback?.level ?? ""}`;
  const commands = await browser.commands.getAll().catch(() => []);
  renderShortcutKeys(commands);
  shortcutHintEl.textContent = shortcutHint(commands, browser.kind, lang);

  const cloudIdle =
    state.settings.connectionDestination === "cloud" &&
    Boolean(state.cloudCodeConfigured) &&
    !state.cloudConnectionFailed &&
    state.sharedTabs.length === 0;
  renderPill(
    gatewayStatusEl,
    cloudIdle
      ? { label: t(lang, "popup.connection.idle"), tone: "neutral" }
      : gatewayStatusPill(state.wsConnected, lang),
  );
  topEl.dataset.gateway = state.wsConnected ? "connected" : cloudIdle ? "idle" : "disconnected";
  gatewayBannerEl.hidden = state.wsConnected || cloudIdle;
  if (!state.wsConnected) {
    const [before, after = ""] = t(lang, "popup.gateway.offlineBody").split("{url}");
    const code = document.createElement("code");
    code.textContent = state.settings.gatewayWebSocketUrl;
    if (state.settings.connectionDestination === "cloud")
      gatewayBannerBodyEl.textContent = t(lang, "popup.connection.offline");
    else gatewayBannerBodyEl.replaceChildren(before ?? "", code, after);
  }

  const auditNote = document.querySelector<HTMLElement>('[data-i18n="popup.footer.audit"]');
  if (auditNote)
    auditNote.textContent = t(
      lang,
      state.settings.connectionDestination === "cloud"
        ? "popup.connection.cloudAudit"
        : "popup.footer.audit",
    );
  renderSharedTabs(state, tabId);
}

function markReady(): void {
  // Enable transitions only after the first state has painted, so opening the popup on a
  // shared tab shows it shared instead of animating into it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.add("ready")),
  );
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
    setStatus(t(lang, "common.errorPrefix", { message: String(e) }), true);
  })
  .finally(markReady);

async function readConnectionDiagnostics() {
  diagnosticsStatus.textContent = "";
  try {
    const response = await send({ type: "get_connection_diagnostics" });
    if (response.type !== "connection_diagnostics") throw new Error("Unavailable");
    diagnosticsLog.textContent = response.events.length
      ? response.events
          .slice()
          .reverse()
          .map(
            (event) =>
              `${new Date(event.at).toISOString()} ${event.event}\n${JSON.stringify(event)}`,
          )
          .join("\n\n")
      : t(lang, "popup.diagnostics.empty");
    if (response.storageFailed)
      diagnosticsStatus.textContent = t(lang, "popup.diagnostics.incomplete");
    return response;
  } catch {
    diagnosticsLog.textContent = "";
    diagnosticsStatus.textContent = t(lang, "popup.diagnostics.unavailable");
    return undefined;
  }
}
diagnosticsPanel.addEventListener("toggle", () => {
  if (diagnosticsPanel.open) void readConnectionDiagnostics();
});
refreshDiagnosticsBtn.addEventListener("click", () => void readConnectionDiagnostics());
saveDiagnosticsBtn.addEventListener("click", async () => {
  const response = await readConnectionDiagnostics();
  if (!response) return;
  const report = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    storageFailed: response.storageFailed,
    events: response.events,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `abg-connection-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
