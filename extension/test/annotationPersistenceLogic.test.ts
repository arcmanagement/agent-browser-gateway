import { describe, expect, it } from "vitest";
import {
  type AnnotationSnapshotRecord,
  annotationSnapshotStorageKey,
  annotationUrlKey,
  annotationUrlsMatch,
  MAX_SAVED_ANNOTATIONS,
  mergeAnnotationSnapshot,
  parseAnnotationSnapshotMessage,
  parseAnnotationSnapshotRecord,
  restorableAnnotations,
  type SavedAnnotation,
  sanitizeSavedAnnotation,
  sanitizeSavedAnnotations,
  summarizeSavedAnnotations,
} from "../src/annotationPersistenceLogic.js";

const now = new Date("2026-10-03T00:00:00.000Z");

function annotation(uid: string, overrides: Partial<SavedAnnotation> = {}): SavedAnnotation {
  return {
    uid,
    kind: "dom",
    source: "drag",
    comment: `comment ${uid}`,
    selector: `#${uid}`,
    rect: { x: 1, y: 2, width: 30, height: 40 },
    createdAt: `2026-10-02T00:00:0${uid.length}.000Z`,
    ...overrides,
  };
}

function record(overrides: Partial<AnnotationSnapshotRecord> = {}): AnnotationSnapshotRecord {
  return {
    version: 1,
    url: "https://example.com/app?x=1",
    title: "Example",
    savedAt: "2026-10-02T00:00:00.000Z",
    pageSessionId: "s1",
    annotations: [annotation("a"), annotation("bb")],
    pending: [],
    ...overrides,
  };
}

describe("annotation URL matching", () => {
  it("ignores the hash but keeps origin, path, and query", () => {
    expect(annotationUrlKey("https://example.com/app?x=1#top")).toBe("https://example.com/app?x=1");
    expect(
      annotationUrlsMatch("https://example.com/app?x=1#a", "https://example.com/app?x=1#b"),
    ).toBe(true);
    expect(annotationUrlsMatch("https://example.com/app?x=1", "https://example.com/app?x=2")).toBe(
      false,
    );
    expect(annotationUrlsMatch("https://example.com/app", "https://example.com/other")).toBe(false);
    expect(annotationUrlsMatch("https://example.com/app", "http://example.com/app")).toBe(false);
  });

  it("never matches missing or invalid URLs", () => {
    expect(annotationUrlKey(undefined)).toBeNull();
    expect(annotationUrlKey("not a url")).toBeNull();
    expect(annotationUrlsMatch(undefined, undefined)).toBe(false);
    expect(annotationUrlsMatch("not a url", "not a url")).toBe(false);
  });

  it("keys storage by tab", () => {
    expect(annotationSnapshotStorageKey(7)).toBe("abgAnnotationSnapshot:7");
  });
});

describe("snapshot validation", () => {
  it("drops unknown fields and bounds strings", () => {
    const sanitized = sanitizeSavedAnnotation({
      ...annotation("a"),
      comment: "x".repeat(5000),
      viewportRect: { x: 0, y: 0, width: 1, height: 1 },
      secret: "page data",
      element: {
        tag: "button",
        selector: "#a",
        selectorQuality: "stable",
        text: "Save",
        color: "red",
      },
      textAnchor: {
        selector: "p",
        startPath: [0, -1],
        fragments: [{ x: 0, y: 0, width: 1, height: 1 }, "bad"],
      },
      anchor: { type: "element", selector: ".scroller" },
    });
    expect(sanitized?.comment).toHaveLength(4000);
    expect(sanitized).not.toHaveProperty("secret");
    expect(sanitized).not.toHaveProperty("viewportRect");
    expect(sanitized?.element).toEqual({
      tag: "button",
      selector: "#a",
      selectorQuality: "stable",
      text: "Save",
    });
    expect(sanitized?.textAnchor?.startPath).toBeUndefined();
    expect(sanitized?.textAnchor?.fragments).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
    expect(sanitized?.anchor).toEqual({ type: "element", selector: ".scroller" });
  });

  it("rejects annotations without uid, kind, or a finite rect", () => {
    expect(sanitizeSavedAnnotation({ ...annotation("a"), uid: "" })).toBeNull();
    expect(sanitizeSavedAnnotation({ ...annotation("a"), kind: "script" })).toBeNull();
    expect(
      sanitizeSavedAnnotation({
        ...annotation("a"),
        rect: { x: Number.NaN, y: 0, width: 1, height: 1 },
      }),
    ).toBeNull();
    expect(sanitizeSavedAnnotation("nope")).toBeNull();
  });

  it("deduplicates by uid and caps the list size", () => {
    expect(
      sanitizeSavedAnnotations([annotation("a"), annotation("a"), { bad: true }]),
    ).toHaveLength(1);
    expect(
      sanitizeSavedAnnotations(
        Array.from({ length: MAX_SAVED_ANNOTATIONS + 1 }, (_, i) => annotation(`a${i}`)),
      ),
    ).toBeNull();
    expect(sanitizeSavedAnnotations("nope")).toBeNull();
  });

  it("parses overlay messages and stored records", () => {
    expect(
      parseAnnotationSnapshotMessage({
        type: "abg_annotation_snapshot",
        pageSessionId: "s1",
        cleared: true,
        annotations: [annotation("a")],
      }),
    ).toEqual({ pageSessionId: "s1", cleared: true, annotations: [annotation("a")] });
    expect(
      parseAnnotationSnapshotMessage({ type: "other", pageSessionId: "s1", annotations: [] }),
    ).toBeNull();
    expect(
      parseAnnotationSnapshotMessage({ type: "abg_annotation_snapshot", annotations: [] }),
    ).toBeNull();
    expect(parseAnnotationSnapshotRecord(record())).toEqual(record());
    expect(parseAnnotationSnapshotRecord({ ...record(), version: 2 })).toBeNull();
    expect(parseAnnotationSnapshotRecord(undefined)).toBeNull();
  });
});

describe("mergeAnnotationSnapshot", () => {
  const update = (pageSessionId: string, annotations: SavedAnnotation[], url = record().url) => ({
    pageSessionId,
    url,
    title: "Example",
    annotations,
  });

  it("creates a record from the first update and deletes it on clear", () => {
    const created = mergeAnnotationSnapshot(null, update("s1", [annotation("a")]), now);
    expect(created).toMatchObject({
      pageSessionId: "s1",
      savedAt: now.toISOString(),
      annotations: [annotation("a")],
      pending: [],
    });
    expect(
      mergeAnnotationSnapshot(created, { ...update("s1", []), cleared: true }, now),
    ).toBeNull();
  });

  it("replaces the same session's annotations so deletions stick", () => {
    const merged = mergeAnnotationSnapshot(record(), update("s1", [annotation("a")]), now);
    expect(merged?.annotations.map((item) => item.uid)).toEqual(["a"]);
    expect(merged?.pending).toEqual([]);
    expect(mergeAnnotationSnapshot(record(), update("s1", []), now)).toBeNull();
  });

  it("carries a reloaded page's old annotations as pending until they are restored", () => {
    const afterReload = mergeAnnotationSnapshot(record(), update("s2", [annotation("new")]), now);
    expect(afterReload?.annotations.map((item) => item.uid)).toEqual(["new"]);
    expect(afterReload?.pending.map((item) => item.uid)).toEqual(["a", "bb"]);

    // The new session restores "a"; "bb" stays pending.
    const afterRestore = mergeAnnotationSnapshot(
      afterReload,
      update("s2", [annotation("new"), annotation("a")]),
      now,
    );
    expect(afterRestore?.pending.map((item) => item.uid)).toEqual(["bb"]);

    // Deleting the restored annotation later does not bring it back.
    const afterDelete = mergeAnnotationSnapshot(
      afterRestore,
      update("s2", [annotation("new")]),
      now,
    );
    expect(afterDelete?.pending.map((item) => item.uid)).toEqual(["bb"]);
  });

  it("keeps pending annotations when a new session has none yet", () => {
    const merged = mergeAnnotationSnapshot(record(), update("s2", []), now);
    expect(merged?.annotations).toEqual([]);
    expect(merged?.pending.map((item) => item.uid)).toEqual(["a", "bb"]);
  });

  it("replaces the snapshot when the tab now shows another page", () => {
    const merged = mergeAnnotationSnapshot(
      record(),
      update("s2", [annotation("new")], "https://example.com/other"),
      now,
    );
    expect(merged?.url).toBe("https://example.com/other");
    expect(merged?.pending).toEqual([]);
  });
});

describe("restorable annotations and summaries", () => {
  const saved = record({ pending: [annotation("ccc")] });

  it("offers everything when the page has no overlay state", () => {
    expect(restorableAnnotations(saved, undefined).map((item) => item.uid)).toEqual([
      "a",
      "bb",
      "ccc",
    ]);
    expect(summarizeSavedAnnotations(saved, "https://example.com/app?x=1#frag", undefined)).toEqual(
      {
        count: 3,
        totalSaved: 3,
        savedAt: saved.savedAt,
        url: saved.url,
        title: saved.title,
        urlMatches: true,
      },
    );
  });

  it("offers only pending annotations to the session that saved the rest", () => {
    expect(restorableAnnotations(saved, "s1").map((item) => item.uid)).toEqual(["ccc"]);
    expect(summarizeSavedAnnotations(saved, "https://example.com/elsewhere", "s1")).toMatchObject({
      count: 1,
      totalSaved: 3,
      urlMatches: false,
    });
  });
});
