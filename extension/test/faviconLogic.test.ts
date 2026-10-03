import { describe, expect, it, vi } from "vitest";
import {
  acceptableFaviconSourceType,
  containRect,
  FAVICON_DATA_URL_PREFIX,
  FAVICON_MAX_ENCODED_BYTES,
  FAVICON_MAX_SOURCE_BYTES,
  faviconCacheUrl,
  faviconDataUrlFromPng,
  faviconSourceForTab,
  hasPngSignature,
  isFaviconDataUrl,
  isRasterImageDataUrl,
  resolveFavicon,
  sniffRasterImageType,
} from "../src/faviconLogic.js";

const CACHE_BASE = "chrome-extension://abcdefghijklmnop/_favicon/";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set(PNG_SIGNATURE);
  return bytes;
}

describe("faviconSourceForTab", () => {
  it("reads Chrome's favicon cache for http(s) tabs that have an icon", () => {
    const source = faviconSourceForTab(
      { url: "https://example.com/a?b=1", favIconUrl: "https://example.com/favicon.ico" },
      { browserKind: "chrome", faviconCacheBaseUrl: CACHE_BASE },
    );
    expect(source).toEqual({
      kind: "browser_cache",
      url: `${CACHE_BASE}?pageUrl=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&size=32`,
    });
  });

  it("never returns the page's own network favicon URL", () => {
    for (const browserKind of ["chrome", "firefox"] as const) {
      const source = faviconSourceForTab(
        { url: "https://example.com/", favIconUrl: "https://cdn.example.com/icon.png" },
        { browserKind },
      );
      expect(source).toBeNull();
    }
  });

  it("falls back to the monogram when the tab has no icon yet", () => {
    expect(
      faviconSourceForTab(
        { url: "https://example.com/" },
        { browserKind: "chrome", faviconCacheBaseUrl: CACHE_BASE },
      ),
    ).toBeNull();
    expect(
      faviconSourceForTab(
        { url: "https://example.com/", favIconUrl: "  " },
        { browserKind: "chrome", faviconCacheBaseUrl: CACHE_BASE },
      ),
    ).toBeNull();
  });

  it("uses a raster data: icon on Firefox and when the cache is unavailable", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(
      faviconSourceForTab(
        { url: "https://example.com/", favIconUrl: dataUrl },
        { browserKind: "firefox" },
      ),
    ).toEqual({ kind: "data_url", url: dataUrl });
    expect(
      faviconSourceForTab(
        { url: "file:///tmp/a.html", favIconUrl: dataUrl },
        {
          browserKind: "chrome",
          faviconCacheBaseUrl: CACHE_BASE,
        },
      ),
    ).toEqual({ kind: "data_url", url: dataUrl });
  });

  it("refuses SVG data: icons", () => {
    for (const favIconUrl of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/svg+xml,<svg></svg>",
      "data:text/html,<b>x</b>",
    ]) {
      expect(
        faviconSourceForTab(
          { url: "https://example.com/", favIconUrl },
          { browserKind: "firefox" },
        ),
      ).toBeNull();
    }
  });
});

describe("favicon validation helpers", () => {
  it("builds the cache URL with an encoded page URL", () => {
    expect(faviconCacheUrl(CACHE_BASE, "https://a.test/?q=1&r=2", 16)).toBe(
      `${CACHE_BASE}?pageUrl=https%3A%2F%2Fa.test%2F%3Fq%3D1%26r%3D2&size=16`,
    );
  });

  it("recognizes raster data URLs only", () => {
    expect(isRasterImageDataUrl("data:image/x-icon;base64,AAAB")).toBe(true);
    expect(isRasterImageDataUrl("DATA:IMAGE/PNG;base64,AAAA")).toBe(true);
    expect(isRasterImageDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isRasterImageDataUrl("https://example.com/favicon.ico")).toBe(false);
  });

  it("sniffs raster formats from bytes, not from the declared type", () => {
    expect(sniffRasterImageType(pngBytes(16))).toBe("image/png");
    expect(sniffRasterImageType(new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01]))).toBe(
      "image/x-icon",
    );
    expect(sniffRasterImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe(
      "image/gif",
    );
    expect(sniffRasterImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffRasterImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(
      "image/webp",
    );
    expect(sniffRasterImageType(new TextEncoder().encode("<svg xmlns='…'/>"))).toBeNull();
    expect(
      sniffRasterImageType(new TextEncoder().encode("<?xml version='1.0'?><svg/>")),
    ).toBeNull();
    expect(sniffRasterImageType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
    expect(sniffRasterImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it("accepts sources only within the size cap", () => {
    expect(acceptableFaviconSourceType(pngBytes(1200))).toBe("image/png");
    expect(acceptableFaviconSourceType(new Uint8Array())).toBeNull();
    expect(acceptableFaviconSourceType(pngBytes(FAVICON_MAX_SOURCE_BYTES))).toBe("image/png");
    expect(acceptableFaviconSourceType(pngBytes(FAVICON_MAX_SOURCE_BYTES + 1))).toBeNull();
  });

  it("encodes only PNG bytes within the 8 KB cap", () => {
    expect(hasPngSignature(pngBytes(16))).toBe(true);
    expect(hasPngSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(false);

    const dataUrl = faviconDataUrlFromPng(pngBytes(12));
    expect(dataUrl).toBe(`${FAVICON_DATA_URL_PREFIX}iVBORw0KGgoAAAAA`);
    expect(isFaviconDataUrl(dataUrl)).toBe(true);

    expect(faviconDataUrlFromPng(pngBytes(FAVICON_MAX_ENCODED_BYTES))).not.toBeNull();
    expect(faviconDataUrlFromPng(pngBytes(FAVICON_MAX_ENCODED_BYTES + 1))).toBeNull();
    expect(faviconDataUrlFromPng(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("validates the wire data URL", () => {
    expect(isFaviconDataUrl(`${FAVICON_DATA_URL_PREFIX}AAAA`)).toBe(true);
    expect(isFaviconDataUrl(FAVICON_DATA_URL_PREFIX)).toBe(false);
    expect(isFaviconDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isFaviconDataUrl(`${FAVICON_DATA_URL_PREFIX}not base64!`)).toBe(false);
    expect(isFaviconDataUrl(`${FAVICON_DATA_URL_PREFIX}${"A".repeat(12_000)}`)).toBe(false);
    expect(isFaviconDataUrl(42)).toBe(false);
  });

  it("aspect-fits non-square icons into the square", () => {
    expect(containRect(16, 16)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
    expect(containRect(64, 32)).toEqual({ x: 0, y: 8, width: 32, height: 16 });
    expect(containRect(0, 10)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });
});

describe("resolveFavicon", () => {
  const source = { kind: "browser_cache" as const, url: `${CACHE_BASE}?pageUrl=x&size=32` };

  it("re-encodes the fetched icon to a PNG data URL", async () => {
    // Chrome's _favicon endpoint answers without a Content-Type.
    const fetch = vi.fn(async () => new Response(new Blob([pngBytes(40)])));
    const rasterize = vi.fn(async (_blob: Blob) => pngBytes(20));
    const dataUrl = await resolveFavicon(source, { fetch, rasterize });
    expect(dataUrl?.startsWith(FAVICON_DATA_URL_PREFIX)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      source.url,
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(rasterize).toHaveBeenCalledOnce();
    expect(rasterize.mock.calls[0]?.[0].type).toBe("image/png");
  });

  it("does not decode SVG, mislabeled, or oversized sources", async () => {
    const rasterize = vi.fn(async () => pngBytes(20));
    const svg = vi.fn(async () => new Response(new Blob(["<svg/>"], { type: "image/svg+xml" })));
    expect(await resolveFavicon(source, { fetch: svg, rasterize })).toBeNull();
    const mislabeled = vi.fn(async () => new Response(new Blob(["<svg/>"], { type: "image/png" })));
    expect(await resolveFavicon(source, { fetch: mislabeled, rasterize })).toBeNull();
    const huge = vi.fn(
      async () => new Response(new Blob([pngBytes(FAVICON_MAX_SOURCE_BYTES + 1)])),
    );
    expect(await resolveFavicon(source, { fetch: huge, rasterize })).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("drops results that are not PNG or exceed the cap", async () => {
    const fetch = vi.fn(async () => new Response(new Blob([pngBytes(40)])));
    expect(
      await resolveFavicon(source, { fetch, rasterize: async () => new Uint8Array([1, 2, 3]) }),
    ).toBeNull();
    expect(
      await resolveFavicon(source, {
        fetch,
        rasterize: async () => pngBytes(FAVICON_MAX_ENCODED_BYTES + 1),
      }),
    ).toBeNull();
  });

  it("returns null instead of throwing on fetch or decode failures", async () => {
    const rasterize = vi.fn(async () => pngBytes(20));
    expect(await resolveFavicon(null, { fetch: vi.fn(), rasterize })).toBeNull();
    expect(
      await resolveFavicon(source, {
        fetch: async () => {
          throw new Error("offline");
        },
        rasterize,
      }),
    ).toBeNull();
    expect(
      await resolveFavicon(source, {
        fetch: async () => new Response("", { status: 404 }),
        rasterize,
      }),
    ).toBeNull();
    expect(
      await resolveFavicon(source, {
        fetch: async () => new Response(new Blob([pngBytes(40)])),
        rasterize: async () => {
          throw new Error("decode failed");
        },
      }),
    ).toBeNull();
  });
});
