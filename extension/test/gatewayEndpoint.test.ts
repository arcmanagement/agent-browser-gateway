import { describe, expect, it } from "vitest";
import {
  normalizeAppliedGatewayWebSocketUrl,
  normalizeGatewayWebSocketUrl,
  resolveStoredGatewayWebSocketUrl,
} from "../src/gatewayEndpoint.js";

const defaultUrl = "ws://127.0.0.1:8765/ws";

describe("Gateway WebSocket endpoint", () => {
  it("accepts ws and wss URLs with the exact /ws path", () => {
    expect(normalizeGatewayWebSocketUrl(" ws://127.0.0.1:8765/ws ")).toBe(defaultUrl);
    expect(normalizeGatewayWebSocketUrl("wss://gateway.example.com/ws")).toBe(
      "wss://gateway.example.com/ws",
    );
  });

  it.each([
    "",
    "https://gateway.example.com/ws",
    "ws://user:secret@gateway.example.com/ws",
    "ws://gateway.example.com/",
    "ws://gateway.example.com/ws/",
    "ws://gateway.example.com/stream",
    "ws://gateway.example.com/ws?token=secret",
    "ws://gateway.example.com/ws#debug",
    "not-a-url",
  ])("rejects an unsupported endpoint: %s", (value) => {
    expect(() => normalizeGatewayWebSocketUrl(value)).toThrow();
  });

  it("uses the default endpoint when an empty value is applied", () => {
    expect(normalizeAppliedGatewayWebSocketUrl("", defaultUrl)).toBe(defaultUrl);
    expect(normalizeAppliedGatewayWebSocketUrl("   ", defaultUrl)).toBe(defaultUrl);
  });

  it("still rejects a non-empty invalid value when applied", () => {
    expect(() =>
      normalizeAppliedGatewayWebSocketUrl("https://gateway.example.com/ws", defaultUrl),
    ).toThrow();
  });

  it("restores a valid stored endpoint", () => {
    expect(resolveStoredGatewayWebSocketUrl("wss://gateway.example.com/ws", defaultUrl)).toEqual({
      url: "wss://gateway.example.com/ws",
      shouldPersist: false,
    });
  });

  it("falls back to the default when the stored endpoint is absent or invalid", () => {
    expect(resolveStoredGatewayWebSocketUrl(undefined, defaultUrl)).toEqual({
      url: defaultUrl,
      shouldPersist: true,
    });
    expect(resolveStoredGatewayWebSocketUrl("https://gateway.example.com/ws", defaultUrl)).toEqual({
      url: defaultUrl,
      shouldPersist: true,
    });
  });
});
