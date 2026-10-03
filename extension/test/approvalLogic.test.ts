import { describe, expect, it } from "vitest";
import {
  approvalRemainingMs,
  formatCountdown,
  isDestructiveIntent,
  scriptBlockPresentation,
  shouldFallBackToTabPicker,
} from "../src/approvalLogic.js";

describe("approvalLogic", () => {
  it("clamps approval timeout remaining time", () => {
    expect(approvalRemainingMs(1_000, 60_000, 5_000)).toBe(56_000);
    expect(approvalRemainingMs(1_000, 60_000, 90_000)).toBe(0);
  });

  it("keeps approval script visibility explicit", () => {
    expect(scriptBlockPresentation(undefined)).toEqual({ hidden: true, text: "" });
    expect(scriptBlockPresentation("document.title")).toEqual({
      hidden: false,
      text: "document.title",
    });
  });

  it("formats the countdown as m:ss and never shows negative time", () => {
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(59_001)).toBe("1:00");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("marks only permanent deletions as destructive", () => {
    expect(isDestructiveIntent("intent.personal.bookmarkRemove")).toBe(true);
    expect(isDestructiveIntent("intent.personal.readingListRemove")).toBe(true);
    expect(isDestructiveIntent("intent.personal.bookmarkUpdate")).toBe(false);
    expect(isDestructiveIntent("intent.clickSelector")).toBe(false);
    expect(isDestructiveIntent(undefined)).toBe(false);
  });
});

describe("shouldFallBackToTabPicker", () => {
  it("matches the all-tabs invocation failure", () => {
    expect(
      shouldFallBackToTabPicker(
        "Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.",
      ),
    ).toBe(true);
  });

  it("does not match unrelated mint failures", () => {
    expect(shouldFallBackToTabPicker("could not start tab capture")).toBe(false);
    expect(shouldFallBackToTabPicker("no current window")).toBe(false);
  });
});
