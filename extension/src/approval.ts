import type { ApprovalDecision, ApprovalToBackground, BackgroundToApproval } from "./types.js";

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

async function send(msg: ApprovalToBackground): Promise<BackgroundToApproval> {
  return (await chrome.runtime.sendMessage(msg)) as BackgroundToApproval;
}

async function decide(decision: ApprovalDecision): Promise<void> {
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
    await send({ type: "approval_decision", approvalId, decision });
  } finally {
    window.close();
  }
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
  intentEl.textContent = request.intent;
  tabTitleEl.textContent = request.tab.title || "(untitled)";
  tabUrlEl.textContent = request.tab.url || "(no URL)";
  if (request.script !== undefined) {
    scriptBlockEl.textContent = request.script;
    scriptBlockEl.hidden = false;
  } else {
    scriptBlockEl.textContent = "";
    scriptBlockEl.hidden = true;
  }
  allowBtn.disabled = false;
  denyBtn.disabled = false;

  const expiresAt = request.createdAt + request.timeoutMs;
  const remainingMs = Math.max(0, expiresAt - Date.now());
  statusEl.textContent = "This request expires in 60 seconds.";
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
