export type StoredGatewayWebSocketUrl = {
  url: string;
  shouldPersist: boolean;
};

export function normalizeGatewayWebSocketUrl(value: string): string {
  const configuredUrl = value.trim();
  if (!configuredUrl) {
    throw new Error("Enter a Gateway WebSocket URL.");
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("Enter a valid Gateway WebSocket URL.");
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Gateway WebSocket URL must use ws:// or wss://.");
  }
  if (!url.hostname) {
    throw new Error("Gateway WebSocket URL must include a hostname.");
  }
  if (url.username || url.password) {
    throw new Error("Gateway WebSocket URL must not include credentials.");
  }
  if (url.pathname !== "/ws") {
    throw new Error("Gateway WebSocket URL must use the exact /ws path.");
  }
  if (url.search || url.hash) {
    throw new Error("Gateway WebSocket URL must not include a query or fragment.");
  }

  return url.toString();
}

export function normalizeAppliedGatewayWebSocketUrl(value: string, defaultUrl: string): string {
  return normalizeGatewayWebSocketUrl(value.trim() || defaultUrl);
}

export function resolveStoredGatewayWebSocketUrl(
  storedValue: unknown,
  defaultUrl: string,
): StoredGatewayWebSocketUrl {
  const normalizedDefault = normalizeGatewayWebSocketUrl(defaultUrl);
  if (typeof storedValue !== "string") {
    return { url: normalizedDefault, shouldPersist: true };
  }

  try {
    const normalizedStored = normalizeGatewayWebSocketUrl(storedValue);
    return {
      url: normalizedStored,
      shouldPersist: storedValue !== normalizedStored,
    };
  } catch {
    return { url: normalizedDefault, shouldPersist: true };
  }
}

export function normalizeCloudWebSocketUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Cloud URL.");
  }
  if (url.protocol === "https:") url.protocol = "wss:";
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && loopback) url.protocol = "ws:";
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) {
    throw new Error("Cloud connections require HTTPS or WSS.");
  }
  if (url.pathname === "/") url.pathname = "/ws";
  return normalizeGatewayWebSocketUrl(url.toString());
}
