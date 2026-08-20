export function resolveGatewayWebSocketUrl(rawUrl, fallbackUrl) {
  const configuredUrl = rawUrl?.trim();
  if (!configuredUrl) return fallbackUrl;

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("Invalid ABG WebSocket URL: expected ws:// or wss:// URL ending in /ws");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Invalid ABG WebSocket URL: protocol must be ws:// or wss://");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Invalid ABG WebSocket URL: host is required and credentials are not allowed");
  }
  if (url.pathname !== "/ws" || url.search || url.hash) {
    throw new Error("Invalid ABG WebSocket URL: path must be /ws without query or fragment");
  }

  return url.toString();
}
