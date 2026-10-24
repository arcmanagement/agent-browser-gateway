import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChromeMock, createChromeMock } from "./chromeMock.js";

let mock: ChromeMock;
let publicKey: JsonWebKey;
const code = "a".repeat(43);
const url = "https://gateway.example.test";
const encode = (value: string) => new TextEncoder().encode(value);
const toBase64url = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
async function expectedProof(secret: string, message: string) {
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encode(secret)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    encode(digest),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64url(await crypto.subtle.sign("HMAC", key, encode(message)));
}
beforeEach(() => {
  vi.resetModules();
  mock = createChromeMock();
  vi.stubGlobal("chrome", mock);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const data = JSON.parse(init.body);
      publicKey = data.publicKey;
      return Response.json({
        request: "synthetic-request",
        expiresAt: Date.now() + 300_000,
        authorizeUrl: "https://app.example.test/connect/browser?request=synthetic-request",
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("saved login connections", () => {
  it("pairs through Web login, stores no password or private key locally, and persists the encrypted handoff once", async () => {
    const connections = await import("../src/savedCloudConnections.js");
    await connections.beginCloudLogin(url, "Work browser");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string)).not.toHaveProperty(
      "proof",
    );
    expect(mock.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(mock.tabs.create).toHaveBeenCalledWith({
      url: "https://app.example.test/connect/browser?request=synthetic-request",
      active: true,
    });
    const pending = (await mock.storage.session.get("pendingCloudLogin")).pendingCloudLogin as {
      privateKey: JsonWebKey;
    };
    expect(pending.privateKey.d).toBeTruthy();
    expect(await mock.storage.local.get(null)).not.toHaveProperty("pendingCloudLogin");
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const encrypted = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(code)),
        ),
      ),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "approved",
          encrypted,
          credentialId: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ),
    );
    const connected = vi.fn(async () => {});
    await connections.pollCloudLogin(connected);
    expect(connected).toHaveBeenCalledOnce();
    expect(connected).toHaveBeenCalledWith(expect.objectContaining({ name: "Work browser", code }));
    expect(
      (await connections.savedCloudConnections()).map((c) => ({
        name: c.name,
        url: c.url,
        code: c.code,
      })),
    ).toEqual([{ name: "Work browser", url: "wss://gateway.example.test/ws", code }]);
    expect((await mock.storage.session.get("pendingCloudLogin")).pendingCloudLogin).toBeUndefined();
    expect(JSON.stringify(await mock.storage.local.get(null))).not.toContain(pending.privateKey.d);
    vi.resetModules();
    const restarted = await import("../src/savedCloudConnections.js");
    expect((await restarted.savedCloudConnections())[0]?.code).toBe(code);
  });
  it.each([
    false,
    true,
  ])("re-logs into a saved identity after the request deadline and respects changed selection (%s)", async (switched) => {
    const id = crypto.randomUUID();
    await mock.storage.local.set({
      savedCloudConnections: [
        { id, name: "My Chrome", url: "wss://gateway.example.test/ws", code },
      ],
    });
    const connections = await import("../src/savedCloudConnections.js");
    await connections.beginCloudLogin(url, "My Chrome", id);
    const started = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(started.browserId).toBe(`browser-${id}`);
    expect(started.proof).toBe(
      await expectedProof(code, `abg-browser-proof-v1:browser-${id}:${started.challenge}`),
    );
    const { pendingCloudLogin: pending } = (await mock.storage.session.get(
      "pendingCloudLogin",
    )) as { pendingCloudLogin: { expiresAt: number } };
    const encryptionKey = await crypto.subtle.importKey(
      "jwk",
      publicKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const encrypted = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            encryptionKey,
            new TextEncoder().encode("b".repeat(43)),
          ),
        ),
      ),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.spyOn(Date, "now").mockReturnValue(pending.expiresAt + 1000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "approved",
          encrypted,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ),
    );
    if (switched)
      await mock.storage.local.set({
        connectionDestination: "local",
        activeCloudConnectionId: "another-selection",
      });
    const connected = vi.fn(async () => {});
    await connections.pollCloudLogin(connected);
    expect(connected).toHaveBeenCalledTimes(switched ? 0 : 1);
    expect(fetch).toHaveBeenCalledOnce();
    expect(
      (await connections.savedCloudConnections()).map((c) => ({ id: c.id, code: c.code })),
    ).toEqual([{ id, code: "b".repeat(43) }]);
    expect((await mock.storage.session.get("pendingCloudLogin")).pendingCloudLogin).toBeUndefined();
    expect(mock.alarms.clear).toHaveBeenCalledWith("cloud-login");
  });
  it("does not persist a credential if trusted storage is unavailable or a saved record is malformed", async () => {
    const connections = await import("../src/savedCloudConnections.js");
    await mock.storage.local.set({
      savedCloudConnections: [
        { id: crypto.randomUUID(), name: "Bad", url: "https://attacker.test/?token=x", code },
      ],
    });
    expect(await connections.savedCloudConnections()).toEqual([]);
    Object.assign(mock.storage.local, { setAccessLevel: undefined });
    await expect(connections.beginCloudLogin(url, "Work")).rejects.toThrow("cannot protect");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serializes removal with a new login so neither saved destination is resurrected or lost", async () => {
    const connections = await import("../src/savedCloudConnections.js");
    const a = { id: crypto.randomUUID(), name: "A", url: "wss://a.example.test/ws", code };
    const b = { ...a, id: crypto.randomUUID(), name: "B", url: "wss://b.example.test/ws" };
    await connections.changeSavedCloudConnections(() => [a]);
    await Promise.all([
      connections.changeSavedCloudConnections((current) => [...current, b]),
      connections.changeSavedCloudConnections((current) => current.filter((c) => c.id !== a.id)),
    ]);
    expect((await connections.savedCloudConnections()).map((c) => c.name)).toEqual(["B"]);
  });
});
