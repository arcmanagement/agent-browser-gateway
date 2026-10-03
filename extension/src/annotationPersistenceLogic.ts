// Pure logic for keeping annotations across page reloads (issue #440).
//
// The in-page overlay state lives in the tab's isolated world and disappears on reload. The
// background keeps a per-tab snapshot in chrome.storage.session (trusted contexts only, never
// page-visible storage) so the user or an agent can explicitly restore it later. Retention is
// separate from sharing permission: keeping a snapshot never grants access, and restoring still
// requires the tab to be shared because every annotate command is gated on a permitted tab.

export const ANNOTATION_SNAPSHOT_STORAGE_PREFIX = "abgAnnotationSnapshot:";
export const MAX_SAVED_ANNOTATIONS = 200;
const MAX_COMMENT_LENGTH = 4000;
const MAX_TEXT_LENGTH = 10000;
const MAX_SELECTOR_LENGTH = 2000;
const MAX_SHORT_STRING_LENGTH = 500;
const MAX_PATH_LENGTH = 64;
const MAX_FRAGMENTS = 64;

export type SavedRect = { x: number; y: number; width: number; height: number };

export type SavedAnnotation = {
  uid: string;
  kind: "screenshot" | "dom" | "text";
  source: "drag" | "selection" | "cli";
  comment: string;
  displayNumber?: number;
  selector?: string;
  text?: string;
  textAnchor?: {
    selector: string;
    index?: number;
    startPath?: number[];
    startOffset?: number;
    endPath?: number[];
    endOffset?: number;
    fragments?: SavedRect[];
  };
  rect: SavedRect;
  anchor?:
    | { type: "window" }
    | { type: "frame"; selector: string }
    | { type: "element"; selector: string };
  createdAt: string;
  element?: {
    tag: string;
    selector: string;
    selectorQuality: "stable" | "structural";
    text: string;
  };
};

export type AnnotationSnapshotRecord = {
  version: 1;
  url: string;
  title: string;
  savedAt: string;
  /** Overlay instance that produced `annotations`. A reload creates a new page session. */
  pageSessionId: string;
  /** Annotations that were live in `pageSessionId` when the snapshot was taken. */
  annotations: SavedAnnotation[];
  /**
   * Annotations from an earlier page session that `pageSessionId` has not restored (yet). They
   * stay here until a restore places them or the user clears annotations.
   */
  pending: SavedAnnotation[];
};

export type AnnotationSnapshotUpdate = {
  pageSessionId: string;
  url: string;
  title: string;
  annotations: SavedAnnotation[];
  cleared?: boolean;
};

export type SavedAnnotationSummary = {
  /** Saved annotations that are not shown in the page right now; what `--restore` will try. */
  count: number;
  /** All annotations in the snapshot, including ones already shown in the page. */
  totalSaved: number;
  savedAt: string;
  url: string;
  title: string;
  urlMatches: boolean;
};

export function annotationSnapshotStorageKey(tabId: number): string {
  return `${ANNOTATION_SNAPSHOT_STORAGE_PREFIX}${tabId}`;
}

/** Origin + pathname + search. The hash is ignored so in-page anchors do not block a restore. */
export function annotationUrlKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function annotationUrlsMatch(savedUrl: string | undefined, currentUrl: string | undefined) {
  const saved = annotationUrlKey(savedUrl);
  return saved !== null && saved === annotationUrlKey(currentUrl);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function sanitizeRect(value: unknown): SavedRect | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return null;
  }
  return { x, y, width, height };
}

function sanitizePath(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PATH_LENGTH) return undefined;
  return value.every((item) => Number.isInteger(item) && item >= 0)
    ? (value as number[])
    : undefined;
}

function sanitizeAnchor(value: unknown): SavedAnnotation["anchor"] {
  if (!isRecord(value)) return undefined;
  if (value.type === "window") return { type: "window" };
  if ((value.type === "frame" || value.type === "element") && typeof value.selector === "string") {
    return { type: value.type, selector: value.selector.slice(0, MAX_SELECTOR_LENGTH) };
  }
  return undefined;
}

function sanitizeTextAnchor(value: unknown): SavedAnnotation["textAnchor"] {
  if (!isRecord(value) || typeof value.selector !== "string") return undefined;
  const fragments = Array.isArray(value.fragments)
    ? value.fragments
        .slice(0, MAX_FRAGMENTS)
        .map(sanitizeRect)
        .filter((rect): rect is SavedRect => rect !== null)
    : undefined;
  return {
    selector: value.selector.slice(0, MAX_SELECTOR_LENGTH),
    index: finiteNumber(value.index),
    startPath: sanitizePath(value.startPath),
    startOffset: finiteNumber(value.startOffset),
    endPath: sanitizePath(value.endPath),
    endOffset: finiteNumber(value.endOffset),
    fragments,
  };
}

function sanitizeElement(value: unknown): SavedAnnotation["element"] {
  if (!isRecord(value) || typeof value.tag !== "string" || typeof value.selector !== "string") {
    return undefined;
  }
  return {
    tag: value.tag.slice(0, 64),
    selector: value.selector.slice(0, MAX_SELECTOR_LENGTH),
    selectorQuality: value.selectorQuality === "stable" ? "stable" : "structural",
    text: boundedString(value.text, MAX_SHORT_STRING_LENGTH) ?? "",
  };
}

/**
 * Validates one annotation coming from the page. Unknown fields are dropped and strings are
 * bounded, so a hostile or buggy page session cannot bloat extension storage.
 */
export function sanitizeSavedAnnotation(value: unknown): SavedAnnotation | null {
  if (!isRecord(value)) return null;
  const uid = boundedString(value.uid, 128);
  if (!uid) return null;
  const kind = value.kind;
  if (kind !== "screenshot" && kind !== "dom" && kind !== "text") return null;
  const rect = sanitizeRect(value.rect);
  if (!rect) return null;
  const source =
    value.source === "drag" || value.source === "selection" || value.source === "cli"
      ? value.source
      : "cli";
  const annotation: SavedAnnotation = {
    uid,
    kind,
    source,
    comment: boundedString(value.comment, MAX_COMMENT_LENGTH) ?? "",
    rect,
    createdAt: boundedString(value.createdAt, 64) ?? new Date(0).toISOString(),
  };
  const displayNumber = finiteNumber(value.displayNumber);
  if (displayNumber !== undefined) annotation.displayNumber = displayNumber;
  const selector = boundedString(value.selector, MAX_SELECTOR_LENGTH);
  if (selector) annotation.selector = selector;
  const text = boundedString(value.text, MAX_TEXT_LENGTH);
  if (text) annotation.text = text;
  const textAnchor = sanitizeTextAnchor(value.textAnchor);
  if (textAnchor) annotation.textAnchor = textAnchor;
  const anchor = sanitizeAnchor(value.anchor);
  if (anchor) annotation.anchor = anchor;
  const element = sanitizeElement(value.element);
  if (element) annotation.element = element;
  return annotation;
}

export function sanitizeSavedAnnotations(value: unknown): SavedAnnotation[] | null {
  if (!Array.isArray(value) || value.length > MAX_SAVED_ANNOTATIONS) return null;
  const sanitized: SavedAnnotation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const annotation = sanitizeSavedAnnotation(item);
    if (!annotation || seen.has(annotation.uid)) continue;
    seen.add(annotation.uid);
    sanitized.push(annotation);
  }
  return sanitized;
}

/** Parses the runtime message the in-page overlay sends after every annotation change. */
export function parseAnnotationSnapshotMessage(
  value: unknown,
): { pageSessionId: string; annotations: SavedAnnotation[]; cleared: boolean } | null {
  if (!isRecord(value) || value.type !== "abg_annotation_snapshot") return null;
  const pageSessionId = boundedString(value.pageSessionId, 128);
  if (!pageSessionId) return null;
  const annotations = sanitizeSavedAnnotations(value.annotations);
  if (!annotations) return null;
  return { pageSessionId, annotations, cleared: value.cleared === true };
}

export function parseAnnotationSnapshotRecord(value: unknown): AnnotationSnapshotRecord | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (typeof value.url !== "string" || typeof value.pageSessionId !== "string") return null;
  const annotations = sanitizeSavedAnnotations(value.annotations);
  const pending = sanitizeSavedAnnotations(value.pending);
  if (!annotations || !pending) return null;
  return {
    version: 1,
    url: value.url,
    title: typeof value.title === "string" ? value.title : "",
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    pageSessionId: value.pageSessionId,
    annotations,
    pending,
  };
}

const byCreatedAt = (lhs: SavedAnnotation, rhs: SavedAnnotation): number =>
  lhs.createdAt.localeCompare(rhs.createdAt);

/**
 * Applies an update from a page session to the stored snapshot. Returns null when nothing is
 * left to keep (explicit clear, or every annotation was deleted and nothing is pending).
 *
 * - Same page session: the update replaces its own annotations; pending ones stay pending
 *   unless the update now contains them (they were restored).
 * - New page session (the page reloaded) on the same URL: everything the old session had is
 *   carried as pending, minus anything the new session already shows.
 * - New page session on another URL: the old snapshot is replaced; one snapshot per tab.
 */
export function mergeAnnotationSnapshot(
  existing: AnnotationSnapshotRecord | null,
  update: AnnotationSnapshotUpdate,
  now: Date = new Date(),
): AnnotationSnapshotRecord | null {
  if (update.cleared) return null;
  let carried: SavedAnnotation[] = [];
  if (existing) {
    if (existing.pageSessionId === update.pageSessionId) {
      carried = existing.pending;
    } else if (annotationUrlsMatch(existing.url, update.url)) {
      carried = [...existing.annotations, ...existing.pending];
    }
  }
  const live = new Set(update.annotations.map((annotation) => annotation.uid));
  const seen = new Set<string>();
  const pending = carried
    .filter((annotation) => {
      if (live.has(annotation.uid) || seen.has(annotation.uid)) return false;
      seen.add(annotation.uid);
      return true;
    })
    .sort(byCreatedAt)
    .slice(0, Math.max(0, MAX_SAVED_ANNOTATIONS - update.annotations.length));
  if (update.annotations.length === 0 && pending.length === 0) return null;
  return {
    version: 1,
    url: update.url,
    title: update.title,
    savedAt: now.toISOString(),
    pageSessionId: update.pageSessionId,
    annotations: update.annotations,
    pending,
  };
}

/**
 * Saved annotations that are not shown in the current page session. `currentPageSessionId` is
 * undefined when the page has no overlay state (for example right after a reload).
 */
export function restorableAnnotations(
  record: AnnotationSnapshotRecord,
  currentPageSessionId: string | undefined,
): SavedAnnotation[] {
  const candidates =
    currentPageSessionId !== undefined && record.pageSessionId === currentPageSessionId
      ? record.pending
      : [...record.annotations, ...record.pending];
  return [...candidates].sort(byCreatedAt);
}

export function summarizeSavedAnnotations(
  record: AnnotationSnapshotRecord,
  currentUrl: string | undefined,
  currentPageSessionId: string | undefined,
): SavedAnnotationSummary {
  return {
    count: restorableAnnotations(record, currentPageSessionId).length,
    totalSaved: record.annotations.length + record.pending.length,
    savedAt: record.savedAt,
    url: record.url,
    title: record.title,
    urlMatches: annotationUrlsMatch(record.url, currentUrl),
  };
}

export const ANNOTATION_RESTORE_COMMAND = "abg annotate <tab> --restore";
export const ANNOTATION_LIST_COMMAND = "abg annotate <tab>";
