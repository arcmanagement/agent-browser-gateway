import type { ShortcutFeedback, TabAccessMode } from "./types.js";

export function detectBrowserKind(userAgent: string): string {
  // Lightweight UA sniff. This is only a Gateway UI label, not a security decision.
  if (/Edg\//.test(userAgent)) return "edge";
  if (/OPR\//.test(userAgent)) return "opera";
  if (/Brave/.test(userAgent)) return "brave";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\//.test(userAgent)) return "chrome";
  return "browser";
}

export function isShareableTabUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

export function originForUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

type RaiseTabBrowser = {
  tabs: {
    get(tabId: number): Promise<{ windowId?: number }>;
    update(tabId: number, properties: { active: boolean }): Promise<unknown>;
  };
  windows: {
    update(windowId: number, properties: { focused: boolean }): Promise<unknown>;
  };
};

export type RaiseTabResult = {
  ok: true;
  tabId: number;
  windowId: number;
  active: true;
  windowFocused: true;
};

export async function raiseBrowserTab(
  browser: RaiseTabBrowser,
  tabId: number,
): Promise<RaiseTabResult> {
  const tab = await browser.tabs.get(tabId);
  if (!Number.isInteger(tab.windowId) || (tab.windowId ?? -1) < 0) {
    throw new Error("tab window unavailable");
  }
  const windowId = tab.windowId as number;
  await browser.tabs.update(tabId, { active: true });
  await browser.windows.update(windowId, { focused: true });
  return {
    ok: true,
    tabId,
    windowId,
    active: true,
    windowFocused: true,
  };
}

export async function raisePermittedBrowserTab(
  browser: RaiseTabBrowser,
  permittedTabs: { has(tabId: number): boolean },
  tabId: number,
): Promise<RaiseTabResult> {
  if (!permittedTabs.has(tabId)) {
    throw new Error("tab not permitted");
  }
  return raiseBrowserTab(browser, tabId);
}

export function richClipboardPayloadLabel(
  mime: string | undefined,
  contentBytes: number | undefined,
): string {
  if (!mime) return " current clipboard payload";
  const byteSuffix = contentBytes === undefined ? "" : ` (${contentBytes} bytes)`;
  return ` ${quoteForIntentLabel(mime)} clipboard payload${byteSuffix}`;
}

function quoteForIntentLabel(value: string): string {
  return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value);
}

// Normalize the file list for an upload_file command. Accepts `files` (array of
// absolute paths, the canonical form) or the legacy single `file` string, and
// returns a non-empty array of strings. Throws on malformed input so the
// extension surfaces a clear error before touching the debugger.
export function normalizeUploadFiles(params: { files?: unknown; file?: unknown }): string[] {
  const raw = params.files ?? params.file;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (list.length === 0) {
    throw new Error("file required: provide at least one file path");
  }
  const files = list.filter((f): f is string => typeof f === "string" && f.length > 0);
  if (files.length !== list.length) {
    throw new Error("file required: every file path must be a non-empty string");
  }
  return files;
}

export type FileAttachFailure = {
  code: "file_access_required" | "file_attach_failed";
  message: string;
};

export function describeFileAttachFailure(detail: string): FileAttachFailure {
  if (/\bNot allowed\b/i.test(detail)) {
    return {
      code: "file_access_required",
      message:
        'Chrome blocked access to the local file path. Open chrome://extensions, open Agent Browser Gateway details, enable "Allow access to file URLs", then retry. Chrome applies this explicit local-file grant to debugger attachment on HTTP and HTTPS pages too.',
    };
  }
  return {
    code: "file_attach_failed",
    message: `Chrome rejected the file attachment (${detail}). This usually means the input is inside a cross-origin iframe, is hidden behind a custom upload widget, or the path is not readable by the browser. Verify the selector points to a real top-document input[type=file] and that the file paths are absolute and accessible.`,
  };
}

export type AuditDiffValue = {
  text: string;
  html?: string;
};

export type AuditDiffField = {
  changed: boolean;
  beforeHash: string;
  afterHash: string;
  beforeLength: number;
  afterLength: number;
  beforeExcerpt: string;
  afterExcerpt: string;
  beforeTruncated: boolean;
  afterTruncated: boolean;
  diffStart: number;
  beforeChangedLength: number;
  afterChangedLength: number;
};

export type AuditDiffPayload = {
  version: 1;
  changed: boolean;
  policy: {
    mode: "hash_and_redacted_excerpts";
    hash: "fnv1a32";
    excerptChars: number;
    redaction: string;
  };
  text: AuditDiffField;
  html?: AuditDiffField;
  preview: string[];
};

const DEFAULT_AUDIT_DIFF_EXCERPT_CHARS = 160;

export function createAuditDiff(
  before: AuditDiffValue,
  after: AuditDiffValue,
  options: { excerptChars?: number } = {},
): AuditDiffPayload {
  const excerptChars = clampExcerptChars(options.excerptChars);
  const text = createAuditDiffField(before.text, after.text, excerptChars);
  const includeHTML = before.html !== undefined || after.html !== undefined;
  const html = includeHTML
    ? createAuditDiffField(before.html ?? "", after.html ?? "", excerptChars)
    : undefined;
  const changed = text.changed || (html?.changed ?? false);
  const preview = [
    `text ${text.changed ? "changed" : "unchanged"} (${text.beforeLength} -> ${text.afterLength} chars)`,
    `- ${text.beforeExcerpt}`,
    `+ ${text.afterExcerpt}`,
  ];
  if (html) {
    preview.push(
      `html ${html.changed ? "changed" : "unchanged"} (${html.beforeLength} -> ${html.afterLength} chars)`,
    );
  }
  return {
    version: 1,
    changed,
    policy: {
      mode: "hash_and_redacted_excerpts",
      hash: "fnv1a32",
      excerptChars,
      redaction: "email, credential assignment, long digit group, and token-like string masks",
    },
    text,
    ...(html ? { html } : {}),
    preview,
  };
}

export function createAuditDiffField(
  before: string,
  after: string,
  excerptChars = DEFAULT_AUDIT_DIFF_EXCERPT_CHARS,
): AuditDiffField {
  const changed = before !== after;
  const prefix = commonPrefixLength(before, after);
  const suffix = changed ? commonSuffixLength(before, after, prefix) : 0;
  const beforeChangedLength = changed ? before.length - prefix - suffix : 0;
  const afterChangedLength = changed ? after.length - prefix - suffix : 0;
  return {
    changed,
    beforeHash: stableTextHash(before),
    afterHash: stableTextHash(after),
    beforeLength: before.length,
    afterLength: after.length,
    beforeExcerpt: changed
      ? changedExcerpt(before, prefix, suffix, excerptChars)
      : boundedRedactedExcerpt(before, excerptChars),
    afterExcerpt: changed
      ? changedExcerpt(after, prefix, suffix, excerptChars)
      : boundedRedactedExcerpt(after, excerptChars),
    beforeTruncated: before.length > excerptChars,
    afterTruncated: after.length > excerptChars,
    diffStart: prefix,
    beforeChangedLength,
    afterChangedLength,
  };
}

export function stableTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function redactAuditExcerpt(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted:email]")
    .replace(
      /\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"'\s<>&]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b(?:\d[\s-]?){13,19}\b/g, "[redacted:number]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted:token]");
}

function clampExcerptChars(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUDIT_DIFF_EXCERPT_CHARS;
  return Math.max(40, Math.min(512, Math.floor(value)));
}

function boundedRedactedExcerpt(value: string, limit: number): string {
  const prefix = value.length > limit ? value.slice(0, limit) : value;
  return redactAuditExcerpt(`${prefix}${value.length > limit ? "..." : ""}`);
}

function changedExcerpt(value: string, prefix: number, suffix: number, limit: number): string {
  const context = Math.max(12, Math.floor(limit / 4));
  const changedEnd = value.length - suffix;
  const start = Math.max(0, prefix - context);
  let end = Math.min(value.length, changedEnd + context);
  if (end - start > limit) {
    end = Math.min(value.length, start + limit);
  }
  const excerpt = `${start > 0 ? "..." : ""}${value.slice(start, end)}${end < value.length ? "..." : ""}`;
  return redactAuditExcerpt(excerpt);
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix;
  let length = 0;
  while (length < max && a[a.length - 1 - length] === b[b.length - 1 - length]) {
    length += 1;
  }
  return length;
}

/**
 * Frame script for selector-based clicks. Serialized with Function.prototype.toString
 * and evaluated inside the page, so it must stay self-contained: no references to
 * module imports or outer-scope bindings.
 *
 * A selector that matches more than one element is rejected without clicking so an
 * imprecise selector cannot act on a different element than intended. Callers that
 * want one of several matches use `find first`, `find last`, `find nth`, or a
 * snapshot ref.
 */
export function clickSelectorFrameFn(
  ctx: {
    doc: Pick<Document, "querySelectorAll">;
    frame?: unknown;
    queryAll?: (selector: string) => Element[];
  },
  opts: { selector: string },
): { found: boolean; tag?: string; frame?: unknown } {
  // ctx.queryAll pierces open shadow roots when the frame API provides it; the
  // plain document query keeps the function usable in isolation.
  const matches = ctx.queryAll
    ? ctx.queryAll(opts.selector)
    : ctx.doc.querySelectorAll(opts.selector);
  if (matches.length === 0) return { found: false };
  if (matches.length > 1) {
    const error = new Error(
      `selector matched ${matches.length} elements; nothing was clicked. Use \`abg find first|last|nth\`, a snapshot ref, or a more specific selector.`,
    ) as Error & { code: string; matchCount: number };
    error.code = "ambiguous_selector";
    error.matchCount = matches.length;
    throw error;
  }
  const el = matches[0] as HTMLElement;
  el.click();
  return { found: true, tag: el.tagName, frame: ctx.frame };
}

export type PersonalDataMutationKind =
  | "bookmark_create"
  | "bookmark_update"
  | "bookmark_move"
  | "bookmark_remove"
  | "reading_list_add"
  | "reading_list_update"
  | "reading_list_remove";

/**
 * Approval intent for browser-owned personal data mutations. Delete operations
 * carry deliberately stronger copy than create/update so an accidental Allow on
 * a destructive request is harder.
 */
export function personalDataMutationIntent(
  kind: PersonalDataMutationKind,
  target: { title?: string; url?: string; id?: string; parentId?: string },
): string {
  const label = target.title ? `"${target.title}"` : (target.url ?? `id ${target.id ?? "?"}`);
  switch (kind) {
    case "bookmark_create":
      return `Create bookmark ${label}${target.url ? ` for ${target.url}` : ""}${
        target.parentId ? ` in folder ${target.parentId}` : ""
      }. Browser-owned personal data write.`;
    case "bookmark_update":
      return `Update bookmark ${label} (id ${target.id ?? "?"}). Browser-owned personal data write.`;
    case "bookmark_move":
      return `Move bookmark ${label} (id ${target.id ?? "?"})${
        target.parentId ? ` to folder ${target.parentId}` : ""
      }. Browser-owned personal data write.`;
    case "bookmark_remove":
      return `PERMANENTLY DELETE bookmark ${label} (id ${target.id ?? "?"}). This removes saved personal data from the browser and ABG cannot undo it.`;
    case "reading_list_add":
      return `Add ${label} to the Reading List. Browser-owned personal data write.`;
    case "reading_list_update":
      return `Update the Reading List entry ${label}. Browser-owned personal data write.`;
    case "reading_list_remove":
      return `PERMANENTLY DELETE the Reading List entry ${label}. This removes saved personal data from the browser and ABG cannot undo it.`;
  }
}

// ---------- Keyboard shortcuts (chrome.commands) ----------

export const TOGGLE_SHARE_COMMAND = "toggle-share-current-tab";
export const COPY_TAB_ID_COMMAND = "copy-current-tab-id";

export type ShortcutTabSnapshot = {
  id?: number;
  url?: string;
  title?: string;
  incognito?: boolean;
};

export type ShortcutBlockReason =
  | "no_active_tab"
  | "all_tabs_mode"
  | "incognito_access_disabled"
  | "unsupported_page";

export type ShareToggleDecision =
  | { action: "permit"; tabId: number }
  | { action: "revoke"; tabId: number }
  | { action: "blocked"; reason: ShortcutBlockReason; tabId?: number };

// Mirrors the popup's Share / Revoke button: all-tabs mode and missing incognito
// access take precedence, a shared tab is revoked, and an unshared tab is shared
// only when it is an http, https, or file page.
export function decideShareToggle(input: {
  tab: ShortcutTabSnapshot | undefined;
  permitted: boolean;
  allTabsActive: boolean;
  incognitoAccessAllowed: boolean;
}): ShareToggleDecision {
  const tabId = input.tab?.id;
  if (typeof tabId !== "number") return { action: "blocked", reason: "no_active_tab" };
  if (input.allTabsActive) return { action: "blocked", reason: "all_tabs_mode", tabId };
  if (input.tab?.incognito && !input.incognitoAccessAllowed) {
    return { action: "blocked", reason: "incognito_access_disabled", tabId };
  }
  if (input.permitted) return { action: "revoke", tabId };
  if (!isShareableTabUrl(input.tab?.url)) {
    return { action: "blocked", reason: "unsupported_page", tabId };
  }
  return { action: "permit", tabId };
}

export type ShortcutOutcome =
  | { kind: "shared"; tabId: number; title?: string }
  | { kind: "revoked"; tabId: number; title?: string }
  | { kind: "blocked"; reason: ShortcutBlockReason; url?: string }
  | { kind: "toggle_failed"; action: "permit" | "revoke"; tabId: number; error: string }
  | { kind: "copied"; tabId: number; title?: string; accessMode?: TabAccessMode }
  | { kind: "copy_failed"; tabId: number; error: string };

const BADGE_GREEN = "#34c759";
const BADGE_BLUE = "#0a84ff";
const BADGE_GRAY = "#8e8e93";
const BADGE_ORANGE = "#ff9500";
const BADGE_RED = "#ff3b30";

function shortcutTabLabel(tabId: number, title: string | undefined): string {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return `tab ${tabId}`;
  const short = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  return `tab ${tabId} ("${short}")`;
}

function urlScheme(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol.replace(/:$/, "");
  } catch {
    return undefined;
  }
}

function blockedMessage(reason: ShortcutBlockReason, url: string | undefined): string {
  switch (reason) {
    case "no_active_tab":
      return "No active tab was found. Focus a browser tab and try the shortcut again.";
    case "all_tabs_mode":
      return "All-tabs sandbox mode is on, so per-tab share and revoke do not apply. Nothing was changed. Turn off all-tabs access in the popup to manage tabs one by one.";
    case "incognito_access_disabled":
      return 'Incognito access is off for Agent Browser Gateway, so this tab cannot be shared. Enable "Allow in incognito" in the extension settings first.';
    case "unsupported_page": {
      const scheme = urlScheme(url);
      const subject = scheme ? `${scheme}: pages` : "This page";
      return `${subject} cannot be shared. Only http, https, and file pages can be shared. Nothing was changed.`;
    }
  }
}

export function shortcutFeedback(outcome: ShortcutOutcome): ShortcutFeedback {
  switch (outcome.kind) {
    case "shared":
      return {
        level: "success",
        badgeText: "ON",
        badgeColor: BADGE_GREEN,
        message: `Shared ${shortcutTabLabel(outcome.tabId, outcome.title)} with agents.`,
      };
    case "revoked":
      return {
        level: "success",
        badgeText: "OFF",
        badgeColor: BADGE_GRAY,
        message: `Revoked ${shortcutTabLabel(outcome.tabId, outcome.title)}. Agents can no longer access it.`,
      };
    case "blocked":
      return {
        level: "warning",
        badgeText: "!",
        badgeColor: BADGE_ORANGE,
        message: blockedMessage(outcome.reason, outcome.url),
      };
    case "toggle_failed":
      return {
        level: "error",
        badgeText: "ERR",
        badgeColor: BADGE_RED,
        message: `Could not ${outcome.action === "permit" ? "share" : "revoke"} tab ${outcome.tabId}: ${outcome.error}`,
      };
    case "copied": {
      const label = shortcutTabLabel(outcome.tabId, outcome.title);
      if (!outcome.accessMode) {
        return {
          level: "warning",
          badgeText: "ID",
          badgeColor: BADGE_ORANGE,
          message: `Copied tab ID ${outcome.tabId} for ${label}. This tab is not shared: agents cannot access it until you share it.`,
        };
      }
      const via = outcome.accessMode === "all_tabs" ? " through all-tabs mode" : "";
      return {
        level: "success",
        badgeText: "ID",
        badgeColor: BADGE_BLUE,
        message: `Copied tab ID ${outcome.tabId} for ${label}. This tab is shared with agents${via}.`,
      };
    }
    case "copy_failed":
      return {
        level: "error",
        badgeText: "ERR",
        badgeColor: BADGE_RED,
        message: `Could not copy tab ID ${outcome.tabId}: ${outcome.error}`,
      };
  }
}
