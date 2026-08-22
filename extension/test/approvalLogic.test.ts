import { describe, expect, it } from "vitest";
import {
  approvalRemainingMs,
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
