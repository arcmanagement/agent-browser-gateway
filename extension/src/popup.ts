import { browserAdapter } from "./browserAdapter.js";
import {
  allTabsAccessNote,
  annotationButtonLabel,
  sharedTabSummary,
  trustedAutomationNote,
} from "./popupLogic.js";
import type { BackgroundToPopup, PopupToBackground } from "./types.js";

const browser = browserAdapter;
const tabInfoEl = document.getElementById("tabInfo") as HTMLDivElement;
const actionBtn = document.getElementById("actionBtn") as HTMLButtonElement;
const annotationBtn = document.getElementById("annotationBtn") as HTMLButtonElement;
const clearAnnotationsBtn = document.getElementById("clearAnnotationsBtn") as HTMLButtonElement;
const approvalToggleEl = document.getElementById("approvalToggle") as HTMLInputElement;
const evalToggleEl = document.getElementById("evalToggle") as HTMLInputElement;
const trustedAutomationToggleEl = document.getElementById(
  "trustedAutomationToggle",
) as HTMLInputElement;
const trustedAutomationNoteEl = document.getElementById("trustedAutomationNote") as HTMLDivElement;
const allTabsToggleEl = document.getElementById("allTabsToggle") as HTMLInputElement;
const allTabsNoteEl = document.getElementById("allTabsNote") as HTMLDivElement;
const profileLabelEl = document.getElementById("profileLabel") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const sharedListEl = document.getElementById("sharedList") as HTMLDivElement;
const incognitoNoticeEl = document.getElementById("incognitoNotice") as HTMLDivElement;
const openExtensionsBtn = document.getElementById("openExtensionsBtn") as HTMLButtonElement;
const recordingPocBtn = document.getElementById("recordingPocBtn") as HTMLButtonElement | null;
const recordingPocNote = document.getElementById("recordingPocNote") as HTMLDivElement | null;

let profileLabelTimer: number | null = null;
let lastActiveTabId: number | null = null;

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

async function refresh(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    tabInfoEl.textContent = "(no active tab)";
    actionBtn.disabled = true;
    return;
  }
  const tabId = tab.id;
  lastActiveTabId = tabId;
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
    clearAnnotationsBtn.disabled = !state.permitted || state.annotationState.count === 0;
    clearAnnotationsBtn.onclick = async () => {
      if (!state.permitted) return;
      clearAnnotationsBtn.disabled = true;
      await send({ type: "annotation_action", tabId, action: "clear" });
      await refresh();
    };
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
    clearAnnotationsBtn.disabled = state.annotationState.count === 0;
    clearAnnotationsBtn.onclick = async () => {
      clearAnnotationsBtn.disabled = true;
      await send({ type: "annotation_action", tabId, action: "clear" });
      await refresh();
    };
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
  }

  statusEl.replaceChildren();
  const wsStateEl = document.createElement("span");
  wsStateEl.className = state.wsConnected ? "ws-ok" : "ws-err";
  wsStateEl.textContent = state.wsConnected ? "● Gateway connected" : "● Gateway disconnected";
  statusEl.append(wsStateEl);

  if (state.sharedTabs.length > 0) {
    const heading = document.createElement("h2");
    heading.textContent = `Shared tabs (${state.sharedTabs.length})`;
    const items = state.sharedTabs.map((t) => {
      const item = document.createElement("div");
      item.className = "shared-item";
      item.textContent = sharedTabSummary(t);
      return item;
    });
    sharedListEl.replaceChildren(heading, ...items);
  } else {
    sharedListEl.replaceChildren();
  }
}

// Recording PoC: trigger the capture pipeline from a real user gesture.
// getMediaStreamId is called first (synchronously in the click) so the gesture
// is still active; the resulting streamId is handed to the background worker.
recordingPocBtn?.addEventListener("click", () => {
  void runRecordingPoc();
});

async function runRecordingPoc(): Promise<void> {
  if (!recordingPocBtn || !recordingPocNote) return;
  if (lastActiveTabId == null) {
    recordingPocNote.textContent = "✗ no active tab";
    return;
  }
  recordingPocBtn.disabled = true;
  recordingPocNote.textContent = "requesting tab capture…";
  try {
    const streamId = await getTabMediaStreamId(lastActiveTabId);
    recordingPocNote.textContent = "recording 5s…";
    const res = (await browser.runtime.sendMessage({
      type: "recording_poc_start",
      streamId,
    })) as { ok: boolean; bytes?: number; micUsed?: boolean; filename?: string; error?: string };
    recordingPocNote.textContent = res?.ok
      ? `✓ ${res.filename} · ${Math.round((res.bytes ?? 0) / 1024)} KB · mic ${res.micUsed ? "on" : "off"}`
      : `✗ ${res?.error ?? "failed"}`;
  } catch (e) {
    recordingPocNote.textContent = `✗ ${(e as Error).message}`;
  } finally {
    recordingPocBtn.disabled = false;
  }
}

function getTabMediaStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) reject(new Error(err?.message ?? "no streamId"));
      else resolve(streamId);
    });
  });
}

refresh().catch((e) => {
  statusEl.textContent = `error: ${e}`;
});
