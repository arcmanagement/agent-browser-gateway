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
