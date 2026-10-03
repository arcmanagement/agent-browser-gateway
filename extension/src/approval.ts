import {
  approvalRemainingMs,
  scriptBlockPresentation,
  shouldFallBackToTabPicker,
} from "./approvalLogic.js";
import { browserAdapter } from "./browserAdapter.js";
import { applyTranslations } from "./domI18n.js";
import { formatText, type Language, readUiLanguage, t } from "./i18n.js";
import { errorMessage } from "./popupLogic.js";
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
// Display language, read once when the window opens. The intent is formatted from the request's
// message in this language; the Gateway keeps its English copy of the same intent.
let lang: Language = "en";

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
  statusEl.textContent = t(lang, "approval.submitting");
  try {
    await send({ type: "approval_decision", approvalId, decision, streamId, streamSource });
  } finally {
    window.close();
  }
}

function chooseTabViaPicker(): void {
  chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId) => {
    if (!streamId) {
      showError(t(lang, "approval.tabPickerCancelled"));
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
      if (err || !streamId) {
        reject(new Error(err?.message ?? t(lang, "approval.tabCaptureFailed")));
      } else resolve(streamId);
    });
  });
}

async function load(): Promise<void> {
  if (!approvalId) {
    showError(t(lang, "approval.missingRequest"));
    return;
  }

  const response = await send({ type: "get_approval_request", approvalId });
  if (response.type !== "approval_request") {
    showError(
      response.type === "error" ? errorMessage(response, lang) : t(lang, "approval.unavailable"),
    );
    return;
  }

  const { request } = response;
  currentMethod = request.method;
  currentTabId = request.tab.tabId;
  intentEl.textContent = request.intentText ? formatText(lang, request.intentText) : request.intent;
  tabTitleEl.textContent = request.tab.title || t(lang, "common.untitled");
  tabUrlEl.textContent = request.tab.url || t(lang, "approval.noUrl");
  const scriptBlock = scriptBlockPresentation(request.script);
  scriptBlockEl.textContent = scriptBlock.text;
  scriptBlockEl.hidden = scriptBlock.hidden;
  allowBtn.disabled = false;
  denyBtn.disabled = false;

  const remainingMs = approvalRemainingMs(request.createdAt, request.timeoutMs);
  statusEl.textContent = t(lang, "approval.expires", {
    seconds: Math.round(request.timeoutMs / 1000),
  });
  if (currentMethod === "record_start" && currentTabId !== null) {
    // Probe the mint outside the gesture: in all-tabs mode no tab carries the
    // action-click activeTab grant, so tabCapture cannot target it and the
    // Allow click must open Chrome's own tab picker instead.
    getTabStreamId(currentTabId).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      if (shouldFallBackToTabPicker(message) && chrome.desktopCapture) {
        captureMode = "desktop";
        statusEl.textContent = t(lang, "approval.tabPickerNote");
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
  intentEl.textContent = t(lang, "approval.loadFailed");
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

// Escape is the keyboard shortcut for the safe choice. Allow is never bound to a
// global key: it needs a deliberate click or Enter/Space on the focused button.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing || denyBtn.disabled) return;
  event.preventDefault();
  denyBtn.click();
});

readUiLanguage(browser.storage.local)
  .then((resolved) => {
    lang = resolved;
    // Static text first: load() then fills the intent, which is also a translated element.
    applyTranslations(document, lang);
  })
  .catch(() => {})
  .then(() => load())
  .catch((e) => {
    showError(e instanceof Error ? e.message : String(e));
  });
