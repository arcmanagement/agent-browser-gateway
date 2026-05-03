import type { BackgroundToPopup, PopupToBackground } from "./types.js";

const tabInfoEl = document.getElementById("tabInfo") as HTMLDivElement;
const actionBtn = document.getElementById("actionBtn") as HTMLButtonElement;
const annotationBtn = document.getElementById("annotationBtn") as HTMLButtonElement;
const clearAnnotationsBtn = document.getElementById("clearAnnotationsBtn") as HTMLButtonElement;
const approvalToggleEl = document.getElementById("approvalToggle") as HTMLInputElement;
const profileLabelEl = document.getElementById("profileLabel") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const sharedListEl = document.getElementById("sharedList") as HTMLDivElement;

let profileLabelTimer: number | null = null;

async function send(msg: PopupToBackground): Promise<BackgroundToPopup> {
  return (await chrome.runtime.sendMessage(msg)) as BackgroundToPopup;
}

async function refresh(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  if (state.permitted) {
    actionBtn.textContent = "Revoke this tab";
    actionBtn.className = "danger";
    actionBtn.onclick = async () => {
      await send({ type: "revoke", tabId });
      await refresh();
    };
    annotationBtn.disabled = false;
    annotationBtn.textContent = state.annotationState.enabled
      ? `${state.annotationState.count} annotation${state.annotationState.count === 1 ? "" : "s"} - Done`
      : state.annotationState.count > 0
        ? `${state.annotationState.count} annotation${state.annotationState.count === 1 ? "" : "s"} - Resume`
        : "Annotate this tab";
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
    actionBtn.onclick = async () => {
      await send({ type: "permit", tabId });
      await refresh();
    };
    annotationBtn.disabled = true;
    annotationBtn.textContent = "Annotate this tab";
    annotationBtn.className = "secondary";
    clearAnnotationsBtn.disabled = true;
  }

  const wsState = state.wsConnected
    ? '<span class="ws-ok">● Gateway connected</span>'
    : '<span class="ws-err">● Gateway disconnected</span>';
  statusEl.innerHTML = wsState;

  if (state.sharedTabs.length > 0) {
    const items = state.sharedTabs
      .map((t) => `<div class="shared-item">🔓 [${t.tabId}] ${escapeHtml(t.title || t.url)}</div>`)
      .join("");
    sharedListEl.innerHTML = `<h2>Shared tabs (${state.sharedTabs.length})</h2>${items}`;
  } else {
    sharedListEl.innerHTML = "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

refresh().catch((e) => {
  statusEl.textContent = `error: ${e}`;
});
