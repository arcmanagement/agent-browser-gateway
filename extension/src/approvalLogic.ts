export function approvalRemainingMs(
  createdAt: number,
  timeoutMs: number,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, createdAt + timeoutMs - nowMs);
}

export function scriptBlockPresentation(script: string | undefined): {
  hidden: boolean;
  text: string;
} {
  return script === undefined ? { hidden: true, text: "" } : { hidden: false, text: script };
}

/**
 * Whether a tabCapture stream-ID mint failure is the all-tabs invocation gap
 * (no per-tab action click ever granted activeTab), which the desktopCapture
 * tab picker can recover from. Other failures (protected pages, missing API)
 * are not recoverable by the picker.
 */
export function shouldFallBackToTabPicker(message: string): boolean {
  return /not been invoked|activeTab/i.test(message);
}

/** Remaining time as m:ss for the approval countdown, rounded up so 0:00 means expired. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const DESTRUCTIVE_INTENT_KEYS: readonly string[] = [
  "intent.personal.bookmarkRemove",
  "intent.personal.readingListRemove",
];

/** Approvals that permanently delete browser-owned data are marked in red in the window. */
export function isDestructiveIntent(key: string | undefined): boolean {
  return key !== undefined && DESTRUCTIVE_INTENT_KEYS.includes(key);
}
