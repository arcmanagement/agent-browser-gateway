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
