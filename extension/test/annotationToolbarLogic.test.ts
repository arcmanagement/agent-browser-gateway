import { describe, expect, it } from "vitest";
import { parseAnnotationToolbarPreferences } from "../src/annotationToolbarLogic.js";

describe("toolbar preferences", () => {
  it("restores only bounded positions and an explicit collapsed state", () => {
    expect(
      parseAnnotationToolbarPreferences({ x: 0.5, y: 1, collapsed: true, extra: "ignored" }),
    ).toEqual({ x: 0.5, y: 1, collapsed: true });
    for (const value of [
      null,
      {},
      { x: -1, y: 0, collapsed: false },
      { x: 0, y: Infinity, collapsed: false },
      { x: NaN, y: 1, collapsed: false },
      { x: 0, y: 2, collapsed: false },
      { x: 0, y: 0, collapsed: "yes" },
    ]) {
      expect(parseAnnotationToolbarPreferences(value)).toBeUndefined();
    }
  });
});
