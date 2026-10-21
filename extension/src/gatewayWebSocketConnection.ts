import type {
  DiagnosticDetails,
  DiagnosticEvent,
  DisconnectReason,
} from "./connectionDiagnostics.js";
import { classifyServerCloseReason } from "./connectionDiagnostics.js";

const CONNECTING = 0;
const OPEN = 1;

export type GatewaySocket = {
  readonly readyState: number;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event | MessageEvent) => void,
  ): void;
  close(): void;
  send(data: string): void;
};

type GatewayWebSocketConnectionOptions = {
  endpoint: string;
  createSocket: (endpoint: string) => GatewaySocket;
  onOpen: (endpoint: string) => void | Promise<void>;
  onMessage: (event: MessageEvent) => void;
  onConnectionChange: (connected: boolean, closeCode?: number) => void;
  onWarning: (message: string, error: unknown) => void;
  onDiagnostic?: (event: DiagnosticEvent, details?: DiagnosticDetails) => void;
  reconnectDelayMs?: number;
  shouldConnect?: () => boolean;
  autoReconnect?: () => boolean;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled?: (timer: unknown) => void;
};

export class GatewayWebSocketConnection {
  private attempt = 0;
  private socketDetails: (() => DiagnosticDetails) | undefined;
  private markSent: (() => void) | undefined;
  private endpoint: string;
  private socket: GatewaySocket | null = null;
  private reconnectTimer: unknown = null;
  private readonly reconnectDelayMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelScheduled: (timer: unknown) => void;

  constructor(private readonly options: GatewayWebSocketConnectionOptions) {
    this.endpoint = options.endpoint;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 3000;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelScheduled = options.cancelScheduled ?? ((timer) => clearTimeout(timer as number));
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  ensureConnected(): void {
    if (this.options.shouldConnect && !this.options.shouldConnect()) return;
    if (this.socket && (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)) {
      return;
    }

    const attempt = ++this.attempt;
    const startedAt = Date.now();
    let receivedAt: number | undefined;
    let sentAt: number | undefined;

    this.diagnostic("socket_connecting", { attempt });
    let socket: GatewaySocket;
    try {
      socket = this.options.createSocket(this.endpoint);
      this.socket = socket;
    } catch (error) {
      this.diagnostic("socket_construct_failed", { attempt });
      this.options.onWarning("[ABG] WS construct failed", error);
      this.scheduleReconnect();
      return;
    }

    const details = (): DiagnosticDetails => ({
      attempt,
      active: this.socket === socket,
      durationMs: Date.now() - startedAt,
      ...(sentAt === undefined ? {} : { lastSentAgoMs: Date.now() - sentAt }),
      ...(receivedAt === undefined ? {} : { lastReceivedAgoMs: Date.now() - receivedAt }),
    });
    this.socketDetails = details;
    this.markSent = () => {
      sentAt = Date.now();
    };
    const endpoint = this.endpoint;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.diagnostic("socket_open", details());
      this.options.onConnectionChange(true);
      Promise.resolve(this.options.onOpen(endpoint)).catch((error) => {
        this.options.onWarning("[ABG] WS open handler failed", error);
      });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      receivedAt = Date.now();
      this.options.onMessage(event as MessageEvent);
    });
    let closeRecorded = false;
    socket.addEventListener("close", (event) => {
      if (!closeRecorded) {
        closeRecorded = true;
        const close = event as CloseEvent;
        this.diagnostic("socket_closed", {
          ...details(),
          closeCode: close.code,
          wasClean: close.wasClean,
          serverReason: classifyServerCloseReason(close.code, close.reason),
          reasonPresent: typeof close.reason === "string" && close.reason.length > 0,
        });
      }
      if (this.socket !== socket) return;
      this.socket = null;
      this.socketDetails = undefined;
      this.markSent = undefined;
      this.options.onConnectionChange(false, (event as CloseEvent).code);
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      this.diagnostic("socket_error", this.socketDetails?.());
      this.socket = null;
      this.socketDetails = undefined;
      this.markSent = undefined;
      this.options.onConnectionChange(false);
      try {
        socket.close();
      } catch {}
      this.scheduleReconnect();
    });
  }

  reconnect(endpoint: string): void {
    this.endpoint = endpoint;
    this.cancelReconnect();
    if (this.socket)
      this.diagnostic("disconnect_requested", {
        ...this.socketDetails?.(),
        reason: "explicit_reconnect",
      });
    const previousSocket = this.socket;
    this.socketDetails = undefined;
    this.markSent = undefined;
    this.socket = null;
    this.options.onConnectionChange(false);
    if (
      previousSocket &&
      (previousSocket.readyState === OPEN || previousSocket.readyState === CONNECTING)
    ) {
      previousSocket.close();
    }
    this.ensureConnected();
  }

  disconnect(reason: DisconnectReason = "configuration_changed"): void {
    if (this.socket) this.diagnostic("disconnect_requested", { ...this.socketDetails?.(), reason });
    this.socketDetails = undefined;
    this.markSent = undefined;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = null;
    this.options.onConnectionChange(false);
    socket?.close();
  }

  send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(data);
    this.markSent?.();
    return true;
  }

  private scheduleReconnect(): void {
    if (this.options.autoReconnect && !this.options.autoReconnect()) return;
    if (this.reconnectTimer !== null) return;
    this.diagnostic("reconnect_scheduled");
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, this.reconnectDelayMs);
  }

  private diagnostic(event: DiagnosticEvent, details?: DiagnosticDetails): void {
    try {
      this.options.onDiagnostic?.(event, details);
    } catch {}
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) return;
    this.cancelScheduled(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
