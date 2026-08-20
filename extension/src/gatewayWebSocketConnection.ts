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
  onOpen: () => void | Promise<void>;
  onMessage: (event: MessageEvent) => void;
  onConnectionChange: (connected: boolean) => void;
  onWarning: (message: string, error: unknown) => void;
  reconnectDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled?: (timer: unknown) => void;
};

export class GatewayWebSocketConnection {
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
    if (this.socket && (this.socket.readyState === OPEN || this.socket.readyState === CONNECTING)) {
      return;
    }

    let socket: GatewaySocket;
    try {
      socket = this.options.createSocket(this.endpoint);
      this.socket = socket;
    } catch (error) {
      this.options.onWarning("[ABG] WS construct failed", error);
      this.scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.options.onConnectionChange(true);
      Promise.resolve(this.options.onOpen()).catch((error) => {
        this.options.onWarning("[ABG] WS open handler failed", error);
      });
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.options.onMessage(event as MessageEvent);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.options.onConnectionChange(false);
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      this.socket = null;
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
    const previousSocket = this.socket;
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

  send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(data);
    return true;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, this.reconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) return;
    this.cancelScheduled(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
