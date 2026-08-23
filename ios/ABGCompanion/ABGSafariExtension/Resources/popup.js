const api = globalThis.browser ?? globalThis.chrome;
const title = document.getElementById("title");
const detail = document.getElementById("detail");
const action = document.getElementById("action");
const connection = document.getElementById("connection");
const trusted = document.getElementById("trusted");
const cookies = document.getElementById("cookies");
const readingList = document.getElementById("readingList");
const frames = document.getElementById("frames");

let tabId = null;
let activeTab = null;
let state = null;
let actionInFlight = false;
let lastTouchAt = 0;

function renderState() {
  trusted.checked = state?.trustedAutomationEnabled === true;
  cookies.checked = state?.cookieAccessEnabled === true;
  readingList.checked = state?.readingListEnabled === true;
  frames.disabled = !state?.paired || !state?.shared || (state?.missingFrameOrigins || []).length === 0;
  frames.textContent = (state?.missingFrameOrigins || []).length > 0
    ? `Enable ${state.missingFrameOrigins.length} embedded site${state.missingFrameOrigins.length === 1 ? "" : "s"}`
    : "Embedded sites enabled";
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
  renderState();
}

function showActionError(error) {
  detail.textContent = error?.message || "The tab could not be shared.";
  connection.textContent = "Share failed";
  connection.classList.toggle("connected", false);
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
    const request = api.runtime.sendMessage({
      type: startingShare ? "share_tab" : "revoke_tab",
      tabId,
      tab: activeTab ? { id: tabId, url: activeTab.url, title: activeTab.title } : null,
    });
    if (!startingShare) {
      state = {
        ...state,
        shared: false,
        connected: false,
        connectionError: null,
      };
      renderState();
      void Promise.resolve(request).catch(() => undefined);
      return;
    }

    const response = await request;
    if (!response?.ok) {
      throw new Error(response?.error || "The tab could not be shared.");
    }
    state = {
      ...state,
      shared: startingShare,
      connected: false,
      connectionError: null,
    };
    renderState();
    await refresh().catch(() => undefined);
  } catch (error) {
    showActionError(error);
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
    await api.runtime.sendMessage({ type: "set_trusted_automation", tabId, enabled: trusted.checked });
  } finally {
    trusted.disabled = false;
  }
});

cookies.addEventListener("change", async () => {
  cookies.disabled = true;
  try {
    if (cookies.checked) {
      const granted = state?.sitePermissionPattern
        && await api.permissions.request({ origins: [state.sitePermissionPattern] });
      if (!granted) throw new Error("Cookie permission was not granted for this site.");
    }
    const response = await api.runtime.sendMessage({ type: "set_cookie_access", tabId, enabled: cookies.checked });
    if (!response?.ok) throw new Error(response?.error || "Cookie permission could not be changed.");
    await refresh();
  } catch (error) {
    cookies.checked = !cookies.checked;
    detail.textContent = error?.message || String(error);
  } finally {
    cookies.disabled = false;
  }
});

readingList.addEventListener("change", async () => {
  readingList.disabled = true;
  try {
    await api.runtime.sendMessage({ type: "set_reading_list_access", tabId, enabled: readingList.checked });
  } finally {
    readingList.disabled = false;
  }
});

frames.addEventListener("click", async () => {
  frames.disabled = true;
  try {
    const origins = state?.missingFrameOrigins || [];
    const granted = origins.length > 0 && await api.permissions.request({ origins });
    if (!granted) throw new Error("Embedded-site access was not granted.");
    const stored = await api.runtime.sendMessage({ type: "grant_frame_access", tabId, origins });
    if (!stored?.ok) throw new Error(stored?.error || "Embedded-site access could not be saved.");
    await api.runtime.sendMessage({ type: "refresh_frame_access", tabId });
    await refresh();
  } catch (error) {
    detail.textContent = error?.message || String(error);
  } finally {
    frames.disabled = false;
  }
});

refresh().catch((error) => {
  detail.textContent = error?.message || "The extension could not start.";
});
