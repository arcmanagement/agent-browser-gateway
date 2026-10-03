// Site icons for shared tabs, shown next to each tab in the Gateway menu.
//
// The icon always comes from the browser, never from the network: on Chrome it is
// read from the browser's own favicon cache through the extension's `_favicon`
// endpoint (the `favicon` permission), elsewhere only from a `data:` URL the
// browser already holds. Whatever the source, the image is decoded and re-encoded
// to a small PNG before it leaves the extension, so page-controlled formats such
// as SVG never reach the Gateway.

import type { BrowserKind } from "./browserAdapter.js";

export const FAVICON_SIZE = 32;
/** Cap on the re-encoded PNG. The Gateway enforces the same cap. */
export const FAVICON_MAX_ENCODED_BYTES = 8 * 1024;
/** Cap on the source image before decoding. */
export const FAVICON_MAX_SOURCE_BYTES = 256 * 1024;
export const FAVICON_DATA_URL_PREFIX = "data:image/png;base64,";
const FAVICON_FETCH_TIMEOUT_MS = 2_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Raster formats the browser can decode in an extension worker. SVG is never accepted. */
const RASTER_IMAGE_TYPES = new Set([
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/ico",
  "image/gif",
  "image/jpeg",
  "image/webp",
  "image/bmp",
]);

export type FaviconSource =
  | { kind: "browser_cache"; url: string }
  | { kind: "data_url"; url: string };

export type FaviconSourceOptions = {
  browserKind: BrowserKind;
  /** `chrome.runtime.getURL("/_favicon/")` when the `favicon` permission is granted. */
  faviconCacheBaseUrl?: string;
};

/**
 * Picks where to read a tab's icon from, or `null` to fall back to the Gateway's monogram.
 * A tab without `favIconUrl` has no icon yet; Chrome's cache would answer with a generic
 * globe, which is less useful than the monogram.
 */
export function faviconSourceForTab(
  tab: { url?: string; favIconUrl?: string },
  options: FaviconSourceOptions,
): FaviconSource | null {
  const favIconUrl = tab.favIconUrl?.trim();
  if (!favIconUrl) return null;

  if (options.browserKind === "chrome" && options.faviconCacheBaseUrl && isHttpUrl(tab.url)) {
    return {
      kind: "browser_cache",
      url: faviconCacheUrl(options.faviconCacheBaseUrl, tab.url as string),
    };
  }

  if (isRasterImageDataUrl(favIconUrl)) {
    return { kind: "data_url", url: favIconUrl };
  }
  return null;
}

export function faviconCacheUrl(baseUrl: string, pageUrl: string, size = FAVICON_SIZE): string {
  const url = new URL(baseUrl);
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

/** True for `data:image/<raster>[;...],` URLs; SVG and other types are refused. */
export function isRasterImageDataUrl(value: string): boolean {
  const match = /^data:([^;,]+)[;,]/i.exec(value);
  if (!match) return false;
  return RASTER_IMAGE_TYPES.has((match[1] ?? "").toLowerCase());
}

/**
 * Identifies a raster image by its leading bytes, or `null` for anything else (SVG,
 * HTML, truncated data). The declared Content-Type is not trusted: Chrome's `_favicon`
 * endpoint answers without one, and a data: URL can declare any type.
 */
export function sniffRasterImageType(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(...PNG_SIGNATURE)) return "image/png";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Whether fetched source bytes may be decoded at all; returns the sniffed type. */
export function acceptableFaviconSourceType(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > FAVICON_MAX_SOURCE_BYTES) return null;
  return sniffRasterImageType(bytes);
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Turns re-encoded PNG bytes into the data URL sent to the Gateway, or `null` if refused. */
export function faviconDataUrlFromPng(bytes: Uint8Array): string | null {
  if (!hasPngSignature(bytes)) return null;
  if (bytes.length > FAVICON_MAX_ENCODED_BYTES) return null;
  return `${FAVICON_DATA_URL_PREFIX}${bytesToBase64(bytes)}`;
}

/** Validates a favicon data URL before it is put on the wire. */
export function isFaviconDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(FAVICON_DATA_URL_PREFIX)) return false;
  const base64 = value.slice(FAVICON_DATA_URL_PREFIX.length);
  if (base64.length === 0 || base64.length > Math.ceil(FAVICON_MAX_ENCODED_BYTES / 3) * 4) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
}

/** Aspect-fit rectangle for drawing a `width`×`height` image into a `size` square. */
export function containRect(
  width: number,
  height: number,
  size = FAVICON_SIZE,
): { x: number; y: number; width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: size, height: size };
  const scale = Math.min(size / width, size / height);
  const fitWidth = Math.max(1, Math.round(width * scale));
  const fitHeight = Math.max(1, Math.round(height * scale));
  return {
    x: Math.floor((size - fitWidth) / 2),
    y: Math.floor((size - fitHeight) / 2),
    width: fitWidth,
    height: fitHeight,
  };
}

export type FaviconDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Decodes the source and re-encodes it as a `FAVICON_SIZE` PNG. */
  rasterize: (source: Blob) => Promise<Uint8Array | null>;
};

/**
 * Reads, sanitizes, and encodes a tab icon. Never throws: any failure means the Gateway
 * shows its monogram instead.
 */
export async function resolveFavicon(
  source: FaviconSource | null,
  deps: FaviconDeps,
): Promise<string | null> {
  if (!source) return null;
  try {
    const response = await deps.fetch(source.url, {
      cache: "force-cache",
      credentials: "omit",
      signal: timeoutSignal(FAVICON_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > FAVICON_MAX_SOURCE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = acceptableFaviconSourceType(bytes);
    if (!type) return null;
    const png = await deps.rasterize(new Blob([bytes], { type }));
    return png ? faviconDataUrlFromPng(png) : null;
  } catch {
    return null;
  }
}

/** Worker-side rasterizer: decode with createImageBitmap, redraw, export as PNG. */
export async function rasterizeFaviconPng(source: Blob): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return null;
  }
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(FAVICON_SIZE, FAVICON_SIZE);
    const context = canvas.getContext("2d");
    if (!context) return null;
    const rect = containRect(bitmap.width, bitmap.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}
