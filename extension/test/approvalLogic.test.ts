import { describe, expect, it } from "vitest";
import { approvalRemainingMs, scriptBlockPresentation } from "../src/approvalLogic.js";

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
