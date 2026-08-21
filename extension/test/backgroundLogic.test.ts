import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickSelectorFrameFn,
  createAuditDiff,
  describeFileAttachFailure,
  detectBrowserKind,
  isShareableTabUrl,
  normalizeUploadFiles,
  originForUrl,
  personalDataMutationIntent,
  raiseBrowserTab,
  raisePermittedBrowserTab,
  richClipboardPayloadLabel,
} from "../src/backgroundLogic.js";
import { installChromeMock } from "./chromeMock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeUploadFiles", () => {
  it("accepts a files array of absolute paths", () => {
    expect(normalizeUploadFiles({ files: ["/tmp/a.png", "/tmp/b.png"] })).toEqual([
      "/tmp/a.png",
      "/tmp/b.png",
    ]);
  });

  it("accepts a legacy single file string", () => {
    expect(normalizeUploadFiles({ file: "/tmp/a.png" })).toEqual(["/tmp/a.png"]);
  });

  it("prefers files over the legacy file alias", () => {
    expect(normalizeUploadFiles({ files: ["/tmp/a.png"], file: "/tmp/legacy.png" })).toEqual([
      "/tmp/a.png",
    ]);
  });

  it("throws when no file is provided", () => {
    expect(() => normalizeUploadFiles({})).toThrow(/file required/);
    expect(() => normalizeUploadFiles({ files: [] })).toThrow(/file required/);
  });

  it("throws when any entry is not a non-empty string", () => {
    expect(() => normalizeUploadFiles({ files: ["/tmp/a.png", ""] })).toThrow(/file required/);
    expect(() => normalizeUploadFiles({ files: ["/tmp/a.png", 123 as unknown as string] })).toThrow(
      /file required/,
    );
  });
});

describe("describeFileAttachFailure", () => {
  it("explains the explicit Chrome local-file grant for Not allowed", () => {
    expect(describeFileAttachFailure('{"code":-32000,"message":"Not allowed"}')).toEqual({
      code: "file_access_required",
      message: expect.stringContaining("Allow access to file URLs"),
    });
  });

  it("preserves the generic attachment guidance for other debugger errors", () => {
    const failure = describeFileAttachFailure("Could not find node");
    expect(failure.code).toBe("file_attach_failed");
    expect(failure.message).toContain("top-document input[type=file]");
    expect(failure.message).toContain("Could not find node");
  });
});

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

  it("activates a shared target tab before focusing its existing window", async () => {
    const chrome = installChromeMock();
    const tab = await chrome.tabs.create({
      active: false,
      url: "https://example.test",
      windowId: 7,
    });

    await expect(raisePermittedBrowserTab(chrome, new Set([tab.id]), tab.id)).resolves.toEqual({
      ok: true,
      tabId: tab.id,
      windowId: 7,
      active: true,
      windowFocused: true,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(tab.id, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
    const tabUpdateOrder = chrome.tabs.update.mock.invocationCallOrder[0];
    const windowUpdateOrder = chrome.windows.update.mock.invocationCallOrder[0];
    if (tabUpdateOrder === undefined || windowUpdateOrder === undefined) {
      throw new Error("expected both activation calls");
    }
    expect(tabUpdateOrder).toBeLessThan(windowUpdateOrder);
  });

  it("does not focus any window when the target tab has no owning window", async () => {
    const chrome = installChromeMock();
    const tab = await chrome.tabs.create({ active: false, url: "https://example.test" });
    chrome.tabs.get.mockResolvedValueOnce({ ...tab, windowId: undefined });

    await expect(raiseBrowserTab(chrome, tab.id)).rejects.toThrow("tab window unavailable");
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });

  it("rejects an unshared tab before reading or focusing browser state", async () => {
    const chrome = installChromeMock();

    await expect(raisePermittedBrowserTab(chrome, new Set([7]), 8)).rejects.toThrow(
      "tab not permitted",
    );
    expect(chrome.tabs.get).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.windows.update).not.toHaveBeenCalled();
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

  it("describes rich clipboard payloads without raw content", () => {
    const label = richClipboardPayloadLabel("text/html", 25);

    expect(label).toBe(' "text/html" clipboard payload (25 bytes)');
    expect(label).not.toContain("<b>secret</b>");
  });

  it("describes current clipboard paste without claiming a MIME payload", () => {
    expect(richClipboardPayloadLabel(undefined, undefined)).toBe(" current clipboard payload");
  });
});

describe("clickSelectorFrameFn", () => {
  const makeElement = (tag: string) => {
    const clicks: number[] = [];
    return {
      tagName: tag,
      clicks,
      click() {
        clicks.push(1);
      },
    };
  };

  const makeCtx = (elements: ReturnType<typeof makeElement>[], frame?: unknown) => ({
    doc: {
      querySelectorAll: () => elements,
    } as unknown as Pick<Document, "querySelectorAll">,
    frame,
  });

  it("returns found: false for zero matches without clicking", () => {
    expect(clickSelectorFrameFn(makeCtx([]), { selector: ".missing" })).toEqual({
      found: false,
    });
  });

  it("clicks the single match and reports its tag", () => {
    const el = makeElement("BUTTON");
    const result = clickSelectorFrameFn(makeCtx([el]), { selector: "#submit" });
    expect(result).toEqual({ found: true, tag: "BUTTON", frame: undefined });
    expect(el.clicks).toHaveLength(1);
  });

  it("propagates the resolved frame descriptor for a single match", () => {
    const el = makeElement("A");
    const frame = { ref: "@f1", url: "https://example.com/inner" };
    const result = clickSelectorFrameFn(makeCtx([el], frame), { selector: "a.next" });
    expect(result.frame).toEqual(frame);
    expect(el.clicks).toHaveLength(1);
  });

  it("rejects multiple matches with ambiguous_selector and clicks nothing", () => {
    const first = makeElement("BUTTON");
    const second = makeElement("BUTTON");
    let thrown: (Error & { code?: string; matchCount?: number }) | undefined;
    try {
      clickSelectorFrameFn(makeCtx([first, second]), { selector: "button" });
    } catch (error) {
      thrown = error as Error & { code?: string; matchCount?: number };
    }
    expect(thrown?.code).toBe("ambiguous_selector");
    expect(thrown?.matchCount).toBe(2);
    expect(thrown?.message).toContain("matched 2 elements");
    expect(first.clicks).toHaveLength(0);
    expect(second.clicks).toHaveLength(0);
  });

  it("stays self-contained so it can be serialized into the page", () => {
    const source = clickSelectorFrameFn.toString();
    expect(source).not.toContain("import");
    expect(source).not.toContain("require(");
  });
});

describe("personalDataMutationIntent", () => {
  it("describes creates with title, url, and folder", () => {
    const intent = personalDataMutationIntent("bookmark_create", {
      title: "Docs",
      url: "https://example.com/docs",
      parentId: "42",
    });
    expect(intent).toContain('Create bookmark "Docs"');
    expect(intent).toContain("https://example.com/docs");
    expect(intent).toContain("folder 42");
    expect(intent).toContain("Browser-owned personal data write.");
  });

  it("uses stronger copy for deletes than for creates", () => {
    const remove = personalDataMutationIntent("bookmark_remove", { title: "Docs", id: "42" });
    expect(remove).toContain("PERMANENTLY DELETE");
    expect(remove).toContain("cannot undo");
    const create = personalDataMutationIntent("bookmark_create", { title: "Docs" });
    expect(create).not.toContain("PERMANENTLY DELETE");
  });

  it("covers reading list removals with the destructive copy", () => {
    const intent = personalDataMutationIntent("reading_list_remove", {
      url: "https://example.com/article",
    });
    expect(intent).toContain("PERMANENTLY DELETE");
    expect(intent).toContain("https://example.com/article");
  });
});
