export function detectBrowserKind(userAgent: string): string {
  // Lightweight UA sniff. This is only a Gateway UI label, not a security decision.
  if (/Edg\//.test(userAgent)) return "edge";
  if (/OPR\//.test(userAgent)) return "opera";
  if (/Brave/.test(userAgent)) return "brave";
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
