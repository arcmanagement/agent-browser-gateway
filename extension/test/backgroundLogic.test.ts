import { describe, expect, it } from "vitest";
import {
  createAuditDiff,
  detectBrowserKind,
  isShareableTabUrl,
  originForUrl,
} from "../src/backgroundLogic.js";

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

  it("captures text-only audit diffs with hashes and compact previews", () => {
    const diff = createAuditDiff(
      { text: "Status: Draft\nOwner: user@example.com" },
      { text: "Status: Published\nOwner: user@example.com" },
    );

    expect(diff.changed).toBe(true);
    expect(diff.text.changed).toBe(true);
    expect(diff.text.beforeHash).toMatch(/^fnv1a32:/);
    expect(diff.text.afterHash).toMatch(/^fnv1a32:/);
    expect(diff.text.beforeHash).not.toBe(diff.text.afterHash);
    expect(diff.preview.join("\n")).toContain("- Status: Draft");
    expect(diff.preview.join("\n")).toContain("+ Status: Published");
    expect(diff.preview.join("\n")).not.toContain("user@example.com");
    expect(diff.preview.join("\n")).toContain("[redacted:email]");
  });

  it("captures HTML-backed audit diffs separately from visible text", () => {
    const diff = createAuditDiff(
      { text: "Hello world", html: "<p>Hello <strong>world</strong></p>" },
      { text: "Hello ABG", html: "<p>Hello <em>ABG</em></p>" },
    );

    expect(diff.changed).toBe(true);
    expect(diff.text.changed).toBe(true);
    expect(diff.html?.changed).toBe(true);
    expect(diff.html?.beforeHash).toMatch(/^fnv1a32:/);
    expect(diff.html?.afterHash).toMatch(/^fnv1a32:/);
  });

  it("marks no-op replacements as unchanged while retaining reconstructable hashes", () => {
    const diff = createAuditDiff(
      { text: "Already correct", html: "<p>Already correct</p>" },
      { text: "Already correct", html: "<p>Already correct</p>" },
    );

    expect(diff.changed).toBe(false);
    expect(diff.text.changed).toBe(false);
    expect(diff.html?.changed).toBe(false);
    expect(diff.text.beforeHash).toBe(diff.text.afterHash);
    expect(diff.html?.beforeHash).toBe(diff.html?.afterHash);
  });

  it("redacts and bounds large audit diff excerpts", () => {
    const secret = "token=abcd1234abcd1234abcd1234abcd1234abcd1234";
    const before = `draft ${secret} ${"a".repeat(600)}`;
    const after = `published ${secret} ${"b".repeat(600)}`;
    const diff = createAuditDiff({ text: before }, { text: after }, { excerptChars: 80 });
    const preview = diff.preview.join("\n");

    expect(diff.text.beforeTruncated).toBe(true);
    expect(diff.text.afterTruncated).toBe(true);
    expect(diff.policy.excerptChars).toBe(80);
    expect(preview).not.toContain("abcd1234abcd1234");
    expect(preview).toContain("[redacted");
    expect(diff.text.beforeExcerpt.length).toBeLessThanOrEqual(120);
    expect(diff.text.afterExcerpt.length).toBeLessThanOrEqual(120);
  });
});
