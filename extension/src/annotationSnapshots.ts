// Background-side retention of annotations across page reloads (issue #440).
//
// Snapshots live in chrome.storage.session, keyed by tab ID. That area is cleared on browser
// restart and extension reload, and by default only trusted extension contexts can read it, so
// neither the page nor the content script can read the user's comments back from it.
//
// Retention is deliberately separate from sharing permission:
// - Revoking a tab keeps its snapshot; closing the tab or an explicit clear deletes it.
// - Nothing here grants access. Every annotate command, including restore, is dispatched only
//   for a currently shared tab, and restore never runs on its own when a page loads.

import type {
  AnnotationCommand,
  AnnotationModeResult,
  AnnotationRestoreReport,
} from "./annotationOverlay.js";
import {
  ANNOTATION_LIST_COMMAND,
  ANNOTATION_RESTORE_COMMAND,
  type AnnotationSnapshotRecord,
  type AnnotationSnapshotUpdate,
  annotationSnapshotStorageKey,
  annotationUrlsMatch,
  mergeAnnotationSnapshot,
  parseAnnotationSnapshotRecord,
  restorableAnnotations,
  sanitizeSavedAnnotations,
  summarizeSavedAnnotations,
} from "./annotationPersistenceLogic.js";

export const ANNOTATION_SAVED_COMMAND = "abg annotate <tab> --saved";

type StorageArea = {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
};

export class AnnotationSnapshotStore {
  private readonly queues = new Map<number, Promise<unknown>>();

  constructor(private readonly storage: StorageArea) {}

  async load(tabId: number): Promise<AnnotationSnapshotRecord | null> {
    const key = annotationSnapshotStorageKey(tabId);
    const stored = await this.storage.get(key);
    return parseAnnotationSnapshotRecord(stored[key]);
  }

  apply(tabId: number, update: AnnotationSnapshotUpdate): Promise<void> {
    return this.serialize(tabId, async () => {
      const key = annotationSnapshotStorageKey(tabId);
      const merged = mergeAnnotationSnapshot(await this.load(tabId), update);
      if (merged) await this.storage.set({ [key]: merged });
      else await this.storage.remove(key);
    });
  }

  delete(tabId: number): Promise<void> {
    return this.serialize(tabId, () => this.storage.remove(annotationSnapshotStorageKey(tabId)));
  }

  // Updates for one tab arrive both from the overlay and from command results. Running them
  // one at a time keeps each read-modify-write from overwriting a concurrent one.
  private serialize<T>(tabId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(tabId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.queues.get(tabId) === next) this.queues.delete(tabId);
      });
    return next;
  }
}

export type AnnotationSnapshotDeps = {
  store: AnnotationSnapshotStore;
  run: (tabId: number, command: AnnotationCommand) => Promise<AnnotationModeResult>;
  currentPage: (tabId: number) => Promise<{ url?: string; title?: string }>;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

function restoreGuidance(
  report: AnnotationRestoreReport,
): Pick<AnnotationModeResult, "userMessage" | "nextCommand"> {
  const restored = report.restored.length;
  const unrestored = report.unrestored.length;
  switch (report.status) {
    case "no_saved_annotations":
      return {
        userMessage: "No saved annotations exist for this tab. Nothing was restored.",
        nextCommand: ANNOTATION_LIST_COMMAND,
      };
    case "url_mismatch":
      return {
        userMessage: `Saved annotations belong to ${report.savedUrl ?? "another page"}, but the tab now shows ${report.currentUrl ?? "a different page"}. Nothing was restored. Read them with --saved.`,
        nextCommand: ANNOTATION_SAVED_COMMAND,
      };
    case "restored":
      return {
        userMessage: `Restored ${plural(restored, "annotation")}.`,
        nextCommand: ANNOTATION_LIST_COMMAND,
      };
    case "partial":
      return {
        userMessage: `Restored ${restored} of ${restored + unrestored} annotations. The other ${unrestored} could not be matched to the changed page, so they were not drawn; see restore.unrestored.`,
        nextCommand: ANNOTATION_LIST_COMMAND,
      };
    case "none_restored":
      return {
        userMessage: `No saved annotation could be matched to the changed page (${unrestored} tried), so nothing was drawn; see restore.unrestored.`,
        nextCommand: ANNOTATION_SAVED_COMMAND,
      };
    default:
      return {
        userMessage: "All saved annotations are already shown on the page.",
        nextCommand: ANNOTATION_LIST_COMMAND,
      };
  }
}

function emptyRestoreReport(
  status: "no_saved_annotations" | "url_mismatch",
  savedUrl: string | undefined,
  currentUrl: string | undefined,
): AnnotationRestoreReport {
  return { status, restored: [], unrestored: [], alreadyPresent: 0, savedUrl, currentUrl };
}

async function persistResult(
  deps: AnnotationSnapshotDeps,
  tabId: number,
  result: AnnotationModeResult,
  page: { url?: string; title?: string },
): Promise<void> {
  if (!result.pageSessionId || !page.url) return;
  const annotations = sanitizeSavedAnnotations(result.annotations);
  if (!annotations) return;
  await deps.store.apply(tabId, {
    pageSessionId: result.pageSessionId,
    url: page.url,
    title: page.title ?? "",
    annotations,
  });
}

function withoutSessionId(result: AnnotationModeResult): AnnotationModeResult {
  const { pageSessionId: _pageSessionId, ...rest } = result;
  return rest;
}

/**
 * Runs one annotate command and keeps the tab's saved snapshot in sync with it. The caller is
 * responsible for checking that the tab is currently shared before calling this.
 */
export async function runAnnotationModeWithSnapshots(
  deps: AnnotationSnapshotDeps,
  tabId: number,
  command: AnnotationCommand,
): Promise<AnnotationModeResult> {
  const page = await deps.currentPage(tabId);

  if (command.action === "restore") {
    const record = await deps.store.load(tabId);
    if (!record || !annotationUrlsMatch(record.url, page.url)) {
      const current = await deps.run(tabId, { action: "list" });
      const restore = emptyRestoreReport(
        record ? "url_mismatch" : "no_saved_annotations",
        record?.url,
        page.url,
      );
      return withoutSessionId({ ...current, restore, ...restoreGuidance(restore) });
    }
    // Every saved annotation is offered; the page skips the ones it already shows.
    const result = await deps.run(tabId, {
      action: "restore",
      saved: restorableAnnotations(record, undefined),
    });
    await persistResult(deps, tabId, result, page);
    const after = await deps.store.load(tabId);
    const output: AnnotationModeResult = {
      ...result,
      ...(result.restore ? restoreGuidance(result.restore) : {}),
    };
    if (after) {
      const summary = summarizeSavedAnnotations(after, page.url, result.pageSessionId);
      if (summary.count > 0) output.saved = summary;
    }
    return withoutSessionId(output);
  }

  if (command.action === "saved") {
    const current = await deps.run(tabId, { action: "list" });
    const record = await deps.store.load(tabId);
    if (!record) {
      return withoutSessionId({
        ...current,
        saved: null,
        userMessage: "No saved annotations exist for this tab.",
        nextCommand: ANNOTATION_LIST_COMMAND,
      });
    }
    const summary = summarizeSavedAnnotations(record, page.url, current.pageSessionId);
    return withoutSessionId({
      ...current,
      saved: {
        ...summary,
        annotations: [...record.annotations, ...record.pending].sort((lhs, rhs) =>
          lhs.createdAt.localeCompare(rhs.createdAt),
        ),
      },
      userMessage:
        summary.count > 0 && summary.urlMatches
          ? `Saved annotations not shown on the page: ${summary.count}. Restore them with --restore.`
          : undefined,
      nextCommand:
        summary.count > 0 && summary.urlMatches
          ? ANNOTATION_RESTORE_COMMAND
          : ANNOTATION_LIST_COMMAND,
    });
  }

  const result = await deps.run(tabId, command);
  if (command.action === "clear") {
    await deps.store.delete(tabId);
    return withoutSessionId(result);
  }
  await persistResult(deps, tabId, result, page);
  const record = await deps.store.load(tabId);
  if (!record) return withoutSessionId(result);
  const summary = summarizeSavedAnnotations(record, page.url, result.pageSessionId);
  if (summary.count === 0) return withoutSessionId(result);
  const hint = summary.urlMatches
    ? `Saved annotations from before the page reloaded are not shown (${summary.count}). Restore them with abg annotate <tab> --restore.`
    : `Saved annotations exist for ${summary.url}, which is not the current page. Read them with abg annotate <tab> --saved.`;
  return withoutSessionId({
    ...result,
    saved: summary,
    userMessage: result.userMessage ? `${result.userMessage} ${hint}` : hint,
    nextCommand: summary.urlMatches ? ANNOTATION_RESTORE_COMMAND : ANNOTATION_SAVED_COMMAND,
  });
}
