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
