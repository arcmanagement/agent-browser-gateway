const api = globalThis.browser ?? globalThis.chrome;
const title = document.getElementById("title");
const detail = document.getElementById("detail");
const action = document.getElementById("action");
const connection = document.getElementById("connection");
const trusted = document.getElementById("trusted");

let tabId = null;
let activeTab = null;
let state = null;
let actionInFlight = false;
let lastTouchAt = 0;

async function refresh() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  activeTab = tab ?? null;
  tabId = tab?.id ?? null;
  title.textContent = tab?.title || tab?.url || "Current tab";
  if (tabId === null) {
    detail.textContent = "No active Safari tab is available.";
    return;
  }

  state = await api.runtime.sendMessage({ type: "get_state", tabId });
  trusted.checked = state?.trustedAutomationEnabled === true;
  if (!state?.paired) {
    detail.textContent = "Open the ABG app and pair this iPhone with your Mac first.";
    connection.textContent = "Not paired";
    action.disabled = true;
    return;
  }

  action.disabled = false;
  action.textContent = state.shared ? "Stop sharing" : "Share this tab";
  action.classList.toggle("revoke", state.shared);
  detail.textContent = state.shared
    ? "This tab is available to ABG on your paired Mac."
    : `Paired with ${state.gatewayLabel || "your Mac Gateway"}.`;
  if (state.connectionError === "scope_missing") {
    detail.textContent = "Pair this iPhone again to grant Safari tab sharing access.";
  }
  connection.textContent = !state.shared
    ? "Ready to share"
    : state.connected
      ? "Connected to Mac"
      : state.connectionError === "scope_missing"
        ? "Pairing update required"
        : "Waiting for Mac Gateway";
  connection.classList.toggle("connected", state.connected);
}

async function handleAction() {
  if (tabId === null || !state || actionInFlight) return;
  actionInFlight = true;
  action.disabled = true;
  const startingShare = !state.shared;
  detail.textContent = startingShare ? "Starting sharing…" : "Stopping sharing…";
  connection.textContent = "Sending request";
  connection.classList.toggle("connected", false);

  try {
    const response = await api.runtime.sendMessage({
      type: startingShare ? "share_tab" : "revoke_tab",
      tabId,
      tab: activeTab ? { id: tabId, url: activeTab.url, title: activeTab.title } : null,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "The tab could not be shared.");
    }
    await refresh();
  } catch (error) {
    detail.textContent = error?.message || "The tab could not be shared.";
    connection.textContent = "Share failed";
    connection.classList.toggle("connected", false);
  } finally {
    actionInFlight = false;
    action.disabled = false;
  }
}

action.addEventListener("touchend", (event) => {
  lastTouchAt = Date.now();
  event.preventDefault();
  void handleAction();
}, { passive: false });

action.addEventListener("click", () => {
  if (Date.now() - lastTouchAt < 750) return;
  void handleAction();
});

trusted.addEventListener("change", async () => {
  trusted.disabled = true;
  try {
    await api.runtime.sendMessage({ type: "set_trusted_automation", enabled: trusted.checked });
  } finally {
    trusted.disabled = false;
  }
});

refresh().catch((error) => {
  detail.textContent = error?.message || "The extension could not start.";
});
