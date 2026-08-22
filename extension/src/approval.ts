import {
  approvalRemainingMs,
  scriptBlockPresentation,
  shouldFallBackToTabPicker,
} from "./approvalLogic.js";
import { browserAdapter } from "./browserAdapter.js";
import type { ApprovalDecision, ApprovalToBackground, BackgroundToApproval } from "./types.js";

const browser = browserAdapter;
const intentEl = document.getElementById("intent") as HTMLDivElement;
const tabTitleEl = document.getElementById("tabTitle") as HTMLDivElement;
const tabUrlEl = document.getElementById("tabUrl") as HTMLDivElement;
const scriptBlockEl = document.getElementById("scriptBlock") as HTMLPreElement;
const allowBtn = document.getElementById("allowBtn") as HTMLButtonElement;
const denyBtn = document.getElementById("denyBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

const approvalId = new URLSearchParams(window.location.search).get("id");
let submitted = false;
let timeoutId: number | null = null;
let currentMethod: string | null = null;
let currentTabId: number | null = null;
// How the Allow click should mint the capture stream for record_start. The
// load-time probe flips this to "desktop" when tabCapture reports the all-tabs
// invocation gap, so the picker call happens directly inside the click gesture.
let captureMode: "tab" | "desktop" = "tab";

async function send(msg: ApprovalToBackground): Promise<BackgroundToApproval> {
  return (await browser.runtime.sendMessage(msg)) as BackgroundToApproval;
}

async function decide(
  decision: ApprovalDecision,
  streamId?: string,
  streamSource?: "tab" | "desktop",
): Promise<void> {
  if (!approvalId || submitted) return;
  submitted = true;
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  allowBtn.disabled = true;
  denyBtn.disabled = true;
  statusEl.textContent = "Submitting decision...";
  try {
    await send({ type: "approval_decision", approvalId, decision, streamId, streamSource });
  } finally {
    window.close();
  }
}

function chooseTabViaPicker(): void {
  chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId) => {
    if (!streamId) {
      showError("Tab selection was cancelled; recording did not start.");
      return;
    }
    decide("allow", streamId, "desktop").catch((e) =>
      showError(e instanceof Error ? e.message : String(e)),
    );
  });
}

// record_start needs a tabCapture stream ID minted inside the user gesture.
// getMediaStreamId is called synchronously in the "Allow" click so the gesture
// stays active; the resulting ID travels with the approval decision.
function getTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) reject(new Error(err?.message ?? "could not start tab capture"));
      else resolve(streamId);
    });
  });
}

async function load(): Promise<void> {
  if (!approvalId) {
    showError("approval request missing");
    return;
  }

  const response = await send({ type: "get_approval_request", approvalId });
  if (response.type !== "approval_request") {
    showError(response.type === "error" ? response.message : "approval request unavailable");
    return;
  }

  const { request } = response;
  currentMethod = request.method;
  currentTabId = request.tab.tabId;
  intentEl.textContent = request.intent;
  tabTitleEl.textContent = request.tab.title || "(untitled)";
  tabUrlEl.textContent = request.tab.url || "(no URL)";
  const scriptBlock = scriptBlockPresentation(request.script);
  scriptBlockEl.textContent = scriptBlock.text;
  scriptBlockEl.hidden = scriptBlock.hidden;
  allowBtn.disabled = false;
  denyBtn.disabled = false;

  const remainingMs = approvalRemainingMs(request.createdAt, request.timeoutMs);
  statusEl.textContent = "This request expires in 60 seconds.";
  if (currentMethod === "record_start" && currentTabId !== null) {
    // Probe the mint outside the gesture: in all-tabs mode no tab carries the
    // action-click activeTab grant, so tabCapture cannot target it and the
    // Allow click must open Chrome's own tab picker instead.
    getTabStreamId(currentTabId).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      if (shouldFallBackToTabPicker(message) && chrome.desktopCapture) {
        captureMode = "desktop";
        statusEl.textContent =
          "Allow opens Chrome's tab picker: choose the tab and enable audio sharing to record it.";
      }
    });
  }
  timeoutId = setTimeout(() => {
    decide("timeout").catch((e) => {
      showError(e instanceof Error ? e.message : String(e));
    });
  }, remainingMs) as unknown as number;
}

function showError(message: string): void {
  intentEl.textContent = "Unable to load approval request.";
  tabTitleEl.textContent = "";
  tabUrlEl.textContent = "";
  scriptBlockEl.textContent = "";
  scriptBlockEl.hidden = true;
  statusEl.textContent = message;
  allowBtn.disabled = true;
  denyBtn.disabled = true;
}

allowBtn.onclick = () => {
  if (currentMethod === "record_start" && currentTabId !== null) {
    if (captureMode === "desktop") {
      // The picker call must happen directly inside the click gesture.
      chooseTabViaPicker();
      return;
    }
    // Mint the capture stream ID synchronously inside the gesture, then submit.
    let streamIdPromise: Promise<string>;
    try {
      streamIdPromise = getTabStreamId(currentTabId);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      return;
    }
    streamIdPromise
      .then((streamId) => decide("allow", streamId, "tab"))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        if (shouldFallBackToTabPicker(message) && chrome.desktopCapture) {
          chooseTabViaPicker();
          return;
        }
        showError(message);
      });
    return;
  }
  decide("allow").catch((e) => {
    showError(e instanceof Error ? e.message : String(e));
  });
};

denyBtn.onclick = () => {
  decide("deny").catch((e) => {
    showError(e instanceof Error ? e.message : String(e));
  });
};

load().catch((e) => {
  showError(e instanceof Error ? e.message : String(e));
});
