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
  it("treats a failed keepalive send as a transient transport failure", () => {
    vi.useFakeTimers();
    try {
      const socket = new MockGatewaySocket();
      const onConnectionChange = vi.fn();
      const connection = new GatewayWebSocketConnection({
        endpoint: "wss://gateway.example/ws",
        createSocket: () => socket,
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onConnectionChange,
        onWarning: vi.fn(),
        autoReconnect: () => false,
      });
      connection.ensureConnected();
      socket.emit("open", new Event("open"));
      socket.send.mockImplementationOnce(() => {
        throw new Error("transport failed");
      });
      connection.startKeepAlive();
      vi.advanceTimersByTime(20_000);
      expect(onConnectionChange).toHaveBeenLastCalledWith(false, undefined, true);
      expect(socket.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an authenticated Cloud worker active without leaking heartbeats to command handling", () => {
    vi.useFakeTimers();
    try {
      const socket = new MockGatewaySocket();
      const onMessage = vi.fn();
      const connection = new GatewayWebSocketConnection({
        endpoint: "wss://gateway.example/ws",
        createSocket: () => socket,
        onOpen: vi.fn(),
        onMessage,
        onConnectionChange: vi.fn(),
        onWarning: vi.fn(),
        autoReconnect: () => false,
      });
      connection.ensureConnected();
      socket.emit("open", new Event("open"));
      connection.startKeepAlive();
      vi.advanceTimersByTime(20_000);
      expect(socket.send).toHaveBeenLastCalledWith('{"type":"ping"}');
      socket.emit("message", new MessageEvent("message", { data: '{"type":"pong"}' }));
      expect(onMessage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(20_000);
      expect(socket.send).toHaveBeenCalledTimes(2);
      connection.disconnect();
      vi.advanceTimersByTime(60_000);
      expect(socket.send).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [1001, "CloudFlare WebSocket proxy restarting", "cloudflare_proxy_restarting"],
    [1001, "Cloudflare WebSocket proxy restarting", "cloudflare_proxy_restarting"],
    [1001, "CloudFlare WebSocket proxy restarting token=secret", undefined],
    [1001, "secret CloudFlare WebSocket proxy restarting", undefined],
    [1001, "https://private.example?token=secret", undefined],
    [1001, "cloudflare_proxy_restarting", undefined],
    [1001, "", undefined],
    [1006, "CloudFlare WebSocket proxy restarting", undefined],
  ])("records only an exact recognized close reason: %s %s", (code, reason, serverReason) => {
    const socket = new MockGatewaySocket();
    const onDiagnostic = vi.fn();
    const connection = new GatewayWebSocketConnection({
      endpoint: "wss://gateway.example/ws",
      createSocket: () => socket,
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onConnectionChange: vi.fn(),
      onWarning: vi.fn(),
      onDiagnostic,
      autoReconnect: () => false,
    });
    connection.ensureConnected();
    socket.emit("open", new Event("open"));
    socket.emit("close", Object.assign(new Event("close"), { code, wasClean: true, reason }));
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      "socket_closed",
      expect.objectContaining({
        closeCode: code,
        serverReason,
        reasonPresent: reason.length > 0,
      }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("secret");
  });

  it("retains a late close after error without changing the replacement connection", () => {
    const sockets: MockGatewaySocket[] = [];
    const onDiagnostic = vi.fn();
    const onConnectionChange = vi.fn();
    const connection = new GatewayWebSocketConnection({
      endpoint: "wss://private.example/secret",
      createSocket: () => {
        const socket = new MockGatewaySocket();
        sockets.push(socket);
        return socket;
      },
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onWarning: vi.fn(),
      onConnectionChange,
      onDiagnostic,
      autoReconnect: () => false,
    });
    connection.ensureConnected();
    sockets[0]?.emit("open", new Event("open"));
    connection.send("secret payload");
    sockets[0]?.emit("message", new MessageEvent("message", { data: "secret response" }));
    sockets[0]?.emit("error", new Event("error"));
    connection.ensureConnected();
    sockets[1]?.emit("open", new Event("open"));
    onConnectionChange.mockClear();
    sockets[0]?.emit(
      "close",
      Object.assign(new Event("close"), { code: 1006, wasClean: false, reason: "secret reason" }),
    );
    expect(onConnectionChange).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      "socket_closed",
      expect.objectContaining({
        attempt: 1,
        active: false,
        closeCode: 1006,
        wasClean: false,
        lastSentAgoMs: expect.any(Number),
        lastReceivedAgoMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("secret");
    sockets[1]?.emit(
      "close",
      Object.assign(new Event("close"), {
        code: 4001,
        wasClean: true,
        reason: "connection_replaced",
      }),
    );
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      "socket_closed",
      expect.objectContaining({ attempt: 2, active: true, serverReason: "connection_replaced" }),
    );
  });

  it("records intentional disconnects once and isolates diagnostic failures", () => {
    const socket = new MockGatewaySocket();
    const onDiagnostic = vi.fn();
    const onConnectionChange = vi.fn();
    const connection = new GatewayWebSocketConnection({
      endpoint: "ws://127.0.0.1:8765/ws",
      createSocket: () => socket,
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onWarning: vi.fn(),
      onConnectionChange,
      onDiagnostic,
    });
    connection.ensureConnected();
    onDiagnostic.mockImplementationOnce(() => {
      throw new Error("Storage failure");
    });
    expect(() => socket.emit("open", new Event("open"))).not.toThrow();
    expect(onConnectionChange).toHaveBeenLastCalledWith(true);
    connection.disconnect("no_shared_tabs");
    expect(onDiagnostic).toHaveBeenLastCalledWith(
      "disconnect_requested",
      expect.objectContaining({ reason: "no_shared_tabs" }),
    );
    const count = onDiagnostic.mock.calls.length;
    connection.disconnect("no_shared_tabs");
    expect(onDiagnostic).toHaveBeenCalledTimes(count);
  });

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
