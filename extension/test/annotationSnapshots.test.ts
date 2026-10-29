import { describe, expect, it, vi } from "vitest";
import type { AnnotationCommand, AnnotationModeResult } from "../src/annotationOverlay.js";
import {
  annotationSnapshotStorageKey,
  type SavedAnnotation,
} from "../src/annotationPersistenceLogic.js";
import {
  AnnotationSnapshotStore,
  runAnnotationModeWithSnapshots,
} from "../src/annotationSnapshots.js";
import { createChromeStorageArea } from "./chromeMock.js";

const pageUrl = "https://example.com/app?x=1";

function annotation(uid: string, createdAt: string): SavedAnnotation {
  return {
    uid,
    kind: "dom",
    source: "drag",
    comment: `about ${uid}`,
    selector: `#${uid}`,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    createdAt,
  };
}

const first = annotation("first", "2026-10-02T00:00:01.000Z");
const second = annotation("second", "2026-10-02T00:00:02.000Z");

function result(
  pageSessionId: string | undefined,
  annotations: SavedAnnotation[],
  extra: Partial<AnnotationModeResult> = {},
): AnnotationModeResult {
  return {
    ok: true,
    enabled: false,
    count: annotations.length,
    annotations,
    nextCommand: "abg annotate <tab>",
    ...(pageSessionId ? { pageSessionId } : {}),
    ...extra,
  };
}

function setup(url = pageUrl) {
  const storage = createChromeStorageArea();
  const store = new AnnotationSnapshotStore(storage);
  const run = vi.fn<(tabId: number, command: AnnotationCommand) => Promise<AnnotationModeResult>>();
  const deps = { store, run, currentPage: vi.fn(async () => ({ url, title: "Example" })) };
  return { storage, store, run, deps };
}

describe("runAnnotationModeWithSnapshots", () => {
  it("saves annotations from command results and hides the page session id", async () => {
    const { storage, run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [first, second]));

    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    expect(output).not.toHaveProperty("pageSessionId");
    expect(output).not.toHaveProperty("saved");
    expect(storage.values.get(annotationSnapshotStorageKey(7))).toMatchObject({
      url: pageUrl,
      pageSessionId: "s1",
      annotations: [first, second],
      pending: [],
    });
  });

  it("tells the agent to restore after a reload wiped the overlay", async () => {
    const { run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [first, second]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    // After a reload the page has no overlay state, so no page session id comes back.
    run.mockResolvedValueOnce(result(undefined, []));
    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    expect(output.count).toBe(0);
    expect(output.saved).toMatchObject({ count: 2, totalSaved: 2, url: pageUrl, urlMatches: true });
    expect(output.nextCommand).toBe("abg annotate <tab> --restore");
    expect(output.userMessage).toContain("--restore");
  });

  it("restores into the page and reports what could not be placed", async () => {
    const { storage, run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [first, second]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    run.mockResolvedValueOnce(
      result("s2", [first], {
        restore: {
          status: "partial",
          restored: [
            {
              uid: "first",
              displayNumber: 1,
              kind: "dom",
              comment: first.comment,
              restoredBy: "selector",
            },
          ],
          unrestored: [
            { uid: "second", kind: "dom", comment: second.comment, reason: "selector_not_found" },
          ],
          alreadyPresent: 0,
        },
      }),
    );
    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "restore" });

    expect(run).toHaveBeenLastCalledWith(7, { action: "restore", saved: [first, second] });
    expect(output.restore?.status).toBe("partial");
    expect(output.userMessage).toContain("Restored 1 of 2");
    // The unrestored annotation stays saved so a later restore can retry it.
    expect(output.saved).toMatchObject({ count: 1, totalSaved: 2 });
    expect(storage.values.get(annotationSnapshotStorageKey(7))).toMatchObject({
      pageSessionId: "s2",
      annotations: [first],
      pending: [second],
    });
  });

  it("refuses to restore onto a different URL and leaves the page alone", async () => {
    const { run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [first]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    deps.currentPage.mockResolvedValue({ url: "https://example.com/other", title: "Other" });
    run.mockResolvedValueOnce(result(undefined, []));
    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "restore" });

    expect(run).toHaveBeenLastCalledWith(7, { action: "list" });
    expect(output.restore).toMatchObject({
      status: "url_mismatch",
      restored: [],
      unrestored: [],
      savedUrl: pageUrl,
      currentUrl: "https://example.com/other",
    });
    expect(output.nextCommand).toBe("abg annotate <tab> --saved");
  });

  it("reports when there is nothing saved to restore", async () => {
    const { run, deps } = setup();
    run.mockResolvedValueOnce(result(undefined, []));

    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "restore" });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(7, { action: "list" });
    expect(output.restore?.status).toBe("no_saved_annotations");
  });

  it("prints saved annotations without restoring them", async () => {
    const { run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [second, first]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    run.mockResolvedValueOnce(result(undefined, []));
    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "saved" });

    expect(run).toHaveBeenLastCalledWith(7, { action: "list" });
    expect(output.saved).toMatchObject({
      count: 2,
      urlMatches: true,
      annotations: [first, second],
    });
    expect(output.nextCommand).toBe("abg annotate <tab> --restore");

    const { run: emptyRun, deps: emptyDeps } = setup();
    emptyRun.mockResolvedValueOnce(result(undefined, []));
    expect(
      (await runAnnotationModeWithSnapshots(emptyDeps, 7, { action: "saved" })).saved,
    ).toBeNull();
  });

  it.each([
    "clear",
    "clear_confirm",
  ] as const)("deletes the saved snapshot on confirmed %s", async (action) => {
    const { storage, run, deps } = setup();
    run.mockResolvedValueOnce(result("s1", [first]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "list" });

    run.mockResolvedValueOnce(
      result("s1", [], action === "clear_confirm" ? { cleared: true } : {}),
    );
    await runAnnotationModeWithSnapshots(deps, 7, { action });

    expect(storage.values.has(annotationSnapshotStorageKey(7))).toBe(false);
  });
});

describe("AnnotationSnapshotStore", () => {
  it("serializes concurrent updates for one tab", async () => {
    const storage = createChromeStorageArea();
    const store = new AnnotationSnapshotStore(storage);
    const base = { url: pageUrl, title: "Example" };

    await Promise.all([
      store.apply(1, { ...base, pageSessionId: "s1", annotations: [first, second] }),
      store.apply(1, { ...base, pageSessionId: "s2", annotations: [] }),
      store.apply(1, { ...base, pageSessionId: "s2", annotations: [first] }),
    ]);

    expect(await store.load(1)).toMatchObject({
      pageSessionId: "s2",
      annotations: [first],
      pending: [second],
    });
    await store.delete(1);
    expect(await store.load(1)).toBeNull();
  });
});

describe("individual annotation references", () => {
  it("reads one live annotation without discarding the rest of the snapshot", async () => {
    const { run, deps, store } = setup();
    run.mockResolvedValue(result("s1", [first, second]));
    const output = await runAnnotationModeWithSnapshots(deps, 7, { action: "get", uid: first.uid });
    expect(output.annotations).toEqual([
      expect.objectContaining({ uid: first.uid, reference: `abg-annotation:${first.uid}` }),
    ]);
    expect((await store.load(7))?.annotations).toEqual([first, second]);
  });

  it("finds a saved reference after reload and removes only that reference", async () => {
    const { run, deps, store } = setup();
    await store.apply(7, {
      pageSessionId: "old",
      url: pageUrl,
      title: "Example",
      annotations: [first, second],
    });
    run.mockResolvedValue(result(undefined, []));
    expect(
      (await runAnnotationModeWithSnapshots(deps, 7, { action: "get", uid: first.uid })).count,
    ).toBe(1);
    const removed = await runAnnotationModeWithSnapshots(deps, 7, {
      action: "remove",
      uid: first.uid,
    });
    expect(removed.count).toBe(0);
    expect((await store.load(7))?.annotations).toEqual([second]);
    expect(
      (await runAnnotationModeWithSnapshots(deps, 7, { action: "get", uid: first.uid })).count,
    ).toBe(0);
  });

  it("removes one pending annotation while preserving a newer live annotation", async () => {
    const { run, deps, store } = setup();
    await store.apply(7, {
      pageSessionId: "old",
      url: pageUrl,
      title: "Example",
      annotations: [first],
    });
    run.mockResolvedValue(result("new", [second]));
    await runAnnotationModeWithSnapshots(deps, 7, { action: "remove", uid: first.uid });
    expect(await store.load(7)).toMatchObject({ annotations: [second], pending: [] });
  });

  it("rejects missing or malformed UIDs before injecting any command", async () => {
    const { run, deps } = setup();
    for (const uid of [undefined, "", "a b", "x".repeat(129)]) {
      await expect(
        runAnnotationModeWithSnapshots(deps, 7, { action: "remove", uid }),
      ).rejects.toThrow("valid annotation uid");
    }
    expect(run).not.toHaveBeenCalled();
  });
});
