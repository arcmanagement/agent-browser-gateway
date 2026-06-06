import { describe, expect, it } from "vitest";
import { detectBrowserKind, isShareableTabUrl, originForUrl } from "../src/backgroundLogic.js";

describe("backgroundLogic", () => {
  it("detects browser labels from user agents without making security decisions", () => {
    expect(detectBrowserKind("Mozilla/5.0 Edg/126.0.0.0")).toBe("edge");
    expect(detectBrowserKind("Mozilla/5.0 OPR/90.0.0.0")).toBe("opera");
    expect(detectBrowserKind("Mozilla/5.0 Brave Chrome/126.0.0.0")).toBe("brave");
    expect(detectBrowserKind("Mozilla/5.0 Chrome/126.0.0.0")).toBe("chrome");
    expect(detectBrowserKind("Something Else")).toBe("browser");
  });

  it("limits shareable tab URLs to browser-visible document schemes", () => {
    expect(isShareableTabUrl("https://example.com")).toBe(true);
    expect(isShareableTabUrl("http://example.com")).toBe(true);
    expect(isShareableTabUrl("file:///tmp/report.html")).toBe(true);
    expect(isShareableTabUrl("chrome://extensions")).toBe(false);
    expect(isShareableTabUrl("about:blank")).toBe(false);
    expect(isShareableTabUrl(undefined)).toBe(false);
    expect(isShareableTabUrl("not a url")).toBe(false);
  });

  it("normalizes invalid origins to an empty string", () => {
    expect(originForUrl("https://example.com/path?q=1")).toBe("https://example.com");
    expect(originForUrl("file:///tmp/report.html")).toBe("null");
    expect(originForUrl("not a url")).toBe("");
  });
});
