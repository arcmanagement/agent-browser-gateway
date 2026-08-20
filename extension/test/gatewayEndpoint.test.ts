import { describe, expect, it } from "vitest";
import { resolveGatewayWebSocketUrl } from "../src/gatewayEndpoint.js";

const fallbackUrl = "ws://127.0.0.1:8765/ws";

describe("resolveGatewayWebSocketUrl", () => {
  it("keeps the loopback endpoint when no override is provided", () => {
    expect(resolveGatewayWebSocketUrl(undefined, fallbackUrl)).toBe(fallbackUrl);
    expect(resolveGatewayWebSocketUrl("  ", fallbackUrl)).toBe(fallbackUrl);
  });

  it("accepts ws and wss gateway endpoints", () => {
    expect(resolveGatewayWebSocketUrl("ws://gateway.example.com:8765/ws", fallbackUrl)).toBe(
      "ws://gateway.example.com:8765/ws",
    );
    expect(resolveGatewayWebSocketUrl("wss://gateway.example.com/ws", fallbackUrl)).toBe(
      "wss://gateway.example.com/ws",
    );
  });

  it.each([
    "https://gateway.example.com/ws",
    "ws://user:secret@gateway.example.com/ws",
    "ws://gateway.example.com/stream",
    "ws://gateway.example.com/ws?token=secret",
    "ws://gateway.example.com/ws#debug",
    "not-a-url",
  ])("rejects unsafe or malformed endpoint %s", (url) => {
    expect(() => resolveGatewayWebSocketUrl(url, fallbackUrl)).toThrow(/Invalid ABG WebSocket URL/);
  });
});
