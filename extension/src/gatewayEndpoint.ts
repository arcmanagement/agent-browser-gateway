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
