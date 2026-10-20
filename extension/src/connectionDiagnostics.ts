// Only fixed labels, counts and timings belong here. Never pass endpoints, page data,
// tokens, exception messages or the server's arbitrary WebSocket close reason.
export const diagnosticEvents = [
  "worker_started",
  "browser_started",
  "network_online",
  "network_offline",
  "discovery_started",
  "discovery_succeeded",
  "discovery_failed",
  "socket_connecting",
  "socket_construct_failed",
  "socket_open",
  "socket_error",
  "socket_closed",
  "disconnect_requested",
  "reconnect_scheduled",
  "authentication_started",
  "authenticated",
  "authentication_timeout",
  "authentication_rejected",
  "shares_cleared",
  "debugger_detached",
] as const;
export type DiagnosticEvent = (typeof diagnosticEvents)[number];
export const disconnectReasons = [
  "configuration_changed",
  "not_configured",
  "unexpected_route",
  "authentication_timeout",
  "authentication_rejected",
  "no_shared_tabs",
  "discovery_failed",
  "explicit_reconnect",
] as const;
export type DisconnectReason = (typeof disconnectReasons)[number];
export const serverCloseReasons = [
  "connection_replaced",
  "authentication_required",
  "invalid_message_or_credential",
] as const;
export type DiagnosticDetails = {
  failure?: "permission_missing" | "http_error" | "timeout" | "aborted" | "network_or_response";
  serverReason?: (typeof serverCloseReasons)[number];
  detachReason?: "target_closed" | "canceled_by_user";
  attempt?: number;
  active?: boolean;
  closeCode?: number;
  wasClean?: boolean;
  reasonPresent?: boolean;
  reason?: DisconnectReason;
  durationMs?: number;
  lastSentAgoMs?: number;
  lastReceivedAgoMs?: number;
  httpStatus?: number;
  aborted?: boolean;
  debuggerCount?: number;
};
export type DiagnosticContext = {
  destination: "local" | "cloud";
  phase: "idle" | "discovering" | "connecting" | "authenticating" | "ready";
  sharedTabCount: number;
  online?: boolean;
};
export type ConnectionDiagnostic = DiagnosticDetails &
  DiagnosticContext & {
    event: DiagnosticEvent;
    at: number;
    runId: string;
    version: string;
  };
const STORAGE_KEY = "connectionDiagnosticsV1";
export const DIAGNOSTIC_LIMIT = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const numberKeys = [
  "attempt",
  "closeCode",
  "durationMs",
  "lastSentAgoMs",
  "lastReceivedAgoMs",
  "httpStatus",
  "debuggerCount",
] as const;
const booleanKeys = ["active", "wasClean", "reasonPresent", "aborted", "online"] as const;

function sanitize(value: unknown): ConnectionDiagnostic | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (
    !diagnosticEvents.includes(v.event as DiagnosticEvent) ||
    typeof v.at !== "number" ||
    !Number.isFinite(v.at) ||
    typeof v.runId !== "string" ||
    !/^[a-f0-9-]{1,64}$/.test(v.runId) ||
    typeof v.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(v.version) ||
    (v.destination !== "local" && v.destination !== "cloud") ||
    !["idle", "discovering", "connecting", "authenticating", "ready"].includes(String(v.phase)) ||
    typeof v.sharedTabCount !== "number" ||
    !Number.isSafeInteger(v.sharedTabCount) ||
    v.sharedTabCount < 0
  )
    return;
  const result: ConnectionDiagnostic = {
    event: v.event as DiagnosticEvent,
    at: v.at,
    runId: v.runId,
    version: v.version,
    destination: v.destination,
    phase: v.phase as DiagnosticContext["phase"],
    sharedTabCount: v.sharedTabCount,
  };
  for (const key of numberKeys) {
    const n = v[key];
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) result[key] = n;
  }
  for (const key of booleanKeys) if (typeof v[key] === "boolean") result[key] = v[key];
  if (disconnectReasons.includes(v.reason as DisconnectReason))
    result.reason = v.reason as DisconnectReason;
  if (serverCloseReasons.includes(v.serverReason as (typeof serverCloseReasons)[number]))
    result.serverReason = v.serverReason as (typeof serverCloseReasons)[number];
  if (v.detachReason === "target_closed" || v.detachReason === "canceled_by_user")
    result.detachReason = v.detachReason;
  if (
    ["permission_missing", "http_error", "timeout", "aborted", "network_or_response"].includes(
      String(v.failure),
    )
  )
    result.failure = v.failure as DiagnosticDetails["failure"];
  return result;
}

export class ConnectionDiagnostics {
  private queue: Promise<void> = Promise.resolve();
  private storageFailed = false;
  constructor(
    private readonly options: {
      storage: Pick<chrome.storage.StorageArea, "get" | "set">;
      context: () => DiagnosticContext;
      runId: string;
      version: string;
      now?: () => number;
    },
  ) {}

  private async load(): Promise<ConnectionDiagnostic[]> {
    const stored = await this.options.storage.get(STORAGE_KEY);
    const values: unknown[] = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    const now = (this.options.now ?? Date.now)();
    return values
      .map(sanitize)
      .filter((v): v is ConnectionDiagnostic => !!v && v.at >= now - RETENTION_MS && v.at <= now)
      .slice(-DIAGNOSTIC_LIMIT);
  }

  record(
    event: DiagnosticEvent,
    details: DiagnosticDetails = {},
    context?: DiagnosticContext,
  ): void {
    const entry = sanitize({
      ...details,
      ...(context ?? this.options.context()),
      event,
      at: (this.options.now ?? Date.now)(),
      runId: this.options.runId,
      version: this.options.version,
    });
    if (!entry) return;
    // Serialize read/append/write so simultaneous close/error events cannot overwrite each other.
    // A storage failure must never interrupt the connection or poison subsequent writes.
    this.queue = this.queue
      .then(async () => {
        const events = await this.load();
        await this.options.storage.set({
          [STORAGE_KEY]: [...events, entry].slice(-DIAGNOSTIC_LIMIT),
        });
      })
      .catch(() => {
        this.storageFailed = true;
        console.warn("[ABG] Connection diagnostic history could not be saved");
      });
  }

  async read(): Promise<{ events: ConnectionDiagnostic[]; storageFailed: boolean }> {
    await this.queue;
    return { events: await this.load(), storageFailed: this.storageFailed };
  }
}
