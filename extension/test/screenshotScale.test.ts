import { describe, expect, it } from "vitest";
import { matchesSize, pngSize, scaledSize, screenshotScale } from "../src/screenshotScale.js";

describe("screenshot scale helpers", () => {
  it("defaults to 1 and accepts 0.1 to 2", () => {
    expect(screenshotScale(undefined)).toBe(1);
    expect(screenshotScale(0.1)).toBe(0.1);
    expect(screenshotScale(2)).toBe(2);
    for (const value of [0, 0.09, 2.01, Number.POSITIVE_INFINITY, "1"]) {
      expect(() => screenshotScale(value)).toThrow(/scale/);
    }
  });

  it("reads PNG dimensions and ignores other data", () => {
    const header = new Uint8Array(33);
    header.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    new DataView(header.buffer).setUint32(16, 3190);
    new DataView(header.buffer).setUint32(20, 2964);
    expect(pngSize(btoa(String.fromCharCode(...header)))).toEqual({ width: 3190, height: 2964 });
    expect(pngSize("test")).toBeUndefined();
    expect(pngSize(btoa("GIF89a...................."))).toBeUndefined();
  });

  it("rounds target sizes and tolerates one pixel", () => {
    expect(scaledSize({ width: 1595, height: 1482 }, 0.5)).toEqual({ width: 798, height: 741 });
    expect(scaledSize({ width: 1, height: 1 }, 0.1)).toEqual({ width: 1, height: 1 });
    expect(matchesSize({ width: 799, height: 741 }, { width: 798, height: 741 })).toBe(true);
    expect(matchesSize({ width: 1596, height: 1482 }, { width: 798, height: 741 })).toBe(false);
  });
});
