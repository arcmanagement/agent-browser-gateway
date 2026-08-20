import { describe, expect, it, vi } from "vitest";
import {
  type GatewaySocket,
  GatewayWebSocketConnection,
} from "../src/gatewayWebSocketConnection.js";

class MockGatewaySocket implements GatewaySocket {
  readyState = 0;
  readonly close = vi.fn(() => {
    this.readyState = 3;
  });
  readonly send = vi.fn();
  private readonly listeners = new Map<string, ((event: Event | MessageEvent) => void)[]>();

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event | MessageEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: "open" | "message" | "close" | "error", event: Event | MessageEvent): void {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("GatewayWebSocketConnection", () => {
  it("closes the current socket and connects to an applied endpoint immediately", () => {
    const sockets: MockGatewaySocket[] = [];
    const endpoints: string[] = [];
    const connection = new GatewayWebSocketConnection({
      endpoint: "ws://127.0.0.1:8765/ws",
      createSocket: (endpoint) => {
        endpoints.push(endpoint);
        const socket = new MockGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onConnectionChange: vi.fn(),
      onWarning: vi.fn(),
    });

    connection.ensureConnected();
    connection.reconnect("wss://gateway.example.com/ws");

    expect(endpoints).toEqual(["ws://127.0.0.1:8765/ws", "wss://gateway.example.com/ws"]);
    const initialSocket = sockets.at(0);
    expect(initialSocket).toBeDefined();
    expect(initialSocket?.close).toHaveBeenCalledOnce();
  });

  it("ignores stale events from the replaced socket", () => {
    const sockets: MockGatewaySocket[] = [];
    const schedule = vi.fn();
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();
    const connection = new GatewayWebSocketConnection({
      endpoint: "ws://127.0.0.1:8765/ws",
      createSocket: () => {
        const socket = new MockGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      onOpen: vi.fn(),
      onMessage,
      onConnectionChange,
      onWarning: vi.fn(),
      schedule,
    });

    connection.ensureConnected();
    connection.reconnect("wss://gateway.example.com/ws");
    const initialSocket = sockets.at(0);
    const replacementSocket = sockets.at(1);
    expect(initialSocket).toBeDefined();
    expect(replacementSocket).toBeDefined();
    replacementSocket?.emit("open", new Event("open"));
    initialSocket?.emit("close", new Event("close"));
    initialSocket?.emit("message", new MessageEvent("message", { data: "stale" }));

    expect(sockets).toHaveLength(2);
    expect(schedule).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onConnectionChange).toHaveBeenLastCalledWith(true);
  });
});
