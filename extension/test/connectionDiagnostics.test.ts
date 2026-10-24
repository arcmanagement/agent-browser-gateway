import { describe, expect, it, vi } from "vitest";
import {
  ConnectionDiagnostics,
  DIAGNOSTIC_LIMIT,
  type DiagnosticDetails,
} from "../src/connectionDiagnostics.js";

function fixture() {
  let data: Record<string, unknown> = {};
  let now = 1_800_000_000_000;
  const storage = {
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (values: Record<string, unknown>) => {
      data = structuredClone(values);
    }),
  };
  const create = (runId = "aaa") =>
    new ConnectionDiagnostics({
      storage: storage as unknown as chrome.storage.StorageArea,
      runId,
      version: "1.1.1",
      now: () => now,
      context: () => ({ destination: "cloud", phase: "ready", sharedTabCount: 1 }),
    });
  return {
    storage,
    create,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("connection diagnostic history", () => {
  it("serializes simultaneous events and preserves history across worker restarts", async () => {
    const f = fixture();
    const first = f.create();
    first.record("socket_error", { attempt: 1 });
    first.record("socket_closed", { attempt: 1, closeCode: 1006, wasClean: false });
    expect((await first.read()).events.map((e) => e.event)).toEqual([
      "socket_error",
      "socket_closed",
    ]);
    const restarted = f.create("bbb");
    restarted.record("worker_started");
    expect((await restarted.read()).events.map((e) => e.runId)).toEqual(["aaa", "aaa", "bbb"]);
  });

  it("bounds the number and age of events", async () => {
    const f = fixture();
    const log = f.create();
    for (let i = 0; i < DIAGNOSTIC_LIMIT + 10; i++) log.record("socket_closed", { attempt: i });
    const events = (await log.read()).events;
    expect(events).toHaveLength(DIAGNOSTIC_LIMIT);
    expect(events[0]?.attempt).toBe(10);
    f.advance(7 * 24 * 60 * 60 * 1000 + 1);
    log.record("worker_started");
    expect((await log.read()).events.map((e) => e.event)).toEqual(["worker_started"]);
  });

  it("preserves the fixed proxy-restart reason across worker restarts and JSON export", async () => {
    const f = fixture();
    const first = f.create();
    first.record("socket_closed", {
      closeCode: 1001,
      wasClean: true,
      reasonPresent: true,
      serverReason: "cloudflare_proxy_restarting",
    });
    await first.read();
    const result = JSON.parse(JSON.stringify(await f.create("bbb").read()));
    expect(result.events).toEqual([
      expect.objectContaining({ closeCode: 1001, serverReason: "cloudflare_proxy_restarting" }),
    ]);
  });

  it("whitelists fields and labels on both write and read, never storing arbitrary reasons or secrets", async () => {
    const f = fixture();
    const log = f.create();
    log.record("socket_closed", {
      reason: "secret token",
      serverReason: "https://private.example?token=secret",
      endpoint: "secret",
      token: "secret",
      pageTitle: "secret",
      closeCode: 4001,
    } as unknown as DiagnosticDetails);
    const first = (await log.read()).events[0];
    expect(first).toMatchObject({ closeCode: 4001 });
    expect(JSON.stringify(f.storage.set.mock.calls)).not.toContain("secret");
    await f.storage.set({
      connectionDiagnosticsV1: [{ ...first, token: "secret", reason: "secret" }],
    });
    expect(JSON.stringify(await log.read())).not.toContain("secret");
  });

  it("recovers after a failed storage write and reports the missing event", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    f.storage.set.mockRejectedValueOnce(new Error("storage unavailable"));
    const log = f.create();
    log.record("socket_error");
    log.record("socket_closed", { closeCode: 1006 });
    const result = await log.read();
    expect(result.storageFailed).toBe(true);
    expect(result.events.map((e) => e.event)).toEqual(["socket_closed"]);
  });
});
