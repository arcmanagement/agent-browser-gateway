import { normalizeCloudWebSocketUrl } from "./gatewayEndpoint.js";

export function cloudServiceOrigin(endpoint: string): string {
  const url = new URL(normalizeCloudWebSocketUrl(endpoint));
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return `${url.origin}/*`;
}

export async function discoverCloudRoute(
  endpoint: string,
  code: string,
  signal: AbortSignal,
): Promise<string> {
  const ws = new URL(normalizeCloudWebSocketUrl(endpoint));
  const http = new URL(ws);
  http.protocol = http.protocol === "wss:" ? "https:" : "http:";
  http.pathname = "/ws/connect";
  const response = await fetch(http, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: code }),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok || !response.body) throw new Error("Cloud authentication failed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new Error("Invalid Cloud route.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !result ||
    typeof result !== "object" ||
    !("path" in result) ||
    typeof result.path !== "string" ||
    !/^\/ws\/[a-f0-9]{64}$/.test(result.path)
  )
    throw new Error("Invalid Cloud route.");
  ws.pathname = result.path;
  return ws.toString();
}
