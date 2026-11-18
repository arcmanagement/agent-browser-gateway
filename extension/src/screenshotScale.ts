// Output scale for screenshots: image pixels per CSS pixel. Chrome multiplies the
// CDP clip scale by the display's device pixel ratio, so the requested scale is
// divided by it, and the PNG header is checked so the reported size is the real one.

export const MIN_SCREENSHOT_SCALE = 0.1;
export const MAX_SCREENSHOT_SCALE = 2;

/** Returns the requested scale, 1 when omitted, or throws for an invalid value. */
export function screenshotScale(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < MIN_SCREENSHOT_SCALE ||
    value > MAX_SCREENSHOT_SCALE
  ) {
    throw new Error(
      `scale must be a number from ${MIN_SCREENSHOT_SCALE} to ${MAX_SCREENSHOT_SCALE}`,
    );
  }
  return value;
}

/** Reads width and height from the IHDR chunk of a base64 PNG. */
export function pngSize(base64: string): { width: number; height: number } | undefined {
  let header: string;
  try {
    header = atob(base64.slice(0, 32));
  } catch {
    return undefined;
  }
  if (header.length < 24 || header.slice(1, 4) !== "PNG" || header.slice(12, 16) !== "IHDR") {
    return undefined;
  }
  const read = (offset: number) =>
    ((header.charCodeAt(offset) << 24) |
      (header.charCodeAt(offset + 1) << 16) |
      (header.charCodeAt(offset + 2) << 8) |
      header.charCodeAt(offset + 3)) >>>
    0;
  return { width: read(16), height: read(20) };
}

/** Target image size for a CSS-pixel region at the requested scale. */
export function scaledSize(
  css: { width: number; height: number },
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(css.width * scale)),
    height: Math.max(1, Math.round(css.height * scale)),
  };
}

/** True when an image is within one pixel of the expected size in both directions. */
export function matchesSize(
  actual: { width: number; height: number },
  expected: { width: number; height: number },
): boolean {
  return (
    Math.abs(actual.width - expected.width) <= 1 && Math.abs(actual.height - expected.height) <= 1
  );
}

/** Resizes a PNG data URL in the worker; returns undefined where canvas APIs are missing. */
export async function resizePngDataUrl(
  dataUrl: string,
  size: { width: number; height: number },
): Promise<string | undefined> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return undefined;
  }
  const source = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    let binary = "";
    for (let index = 0; index < png.length; index += 0x8000) {
      binary += String.fromCharCode(...png.subarray(index, index + 0x8000));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } finally {
    bitmap.close();
  }
}
