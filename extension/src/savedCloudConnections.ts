import { browserAdapter as browser } from "./browserAdapter.js";
import { normalizeCloudWebSocketUrl } from "./gatewayEndpoint.js";

export type SavedCloudConnection = {
  id: string;
  name: string;
  url: string;
  code: string;
  expiresAt?: string;
};
type PendingLogin = {
  id: string;
  name: string;
  url: string;
  request: string;
  verifier: string;
  privateKey: JsonWebKey;
  expiresAt: number;
  replacing?: boolean;
  selection?: { destination?: unknown; id?: unknown; url?: unknown };
};
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const bytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const base64url = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((b) => b.toString(16).padStart(2, "0")).join("");
// Proves possession of the saved credential so the service only replaces that browser identity.
async function replacementProof(code: string, browserId: string, challenge: string) {
  const encoder = new TextEncoder();
  const digest = hex(await crypto.subtle.digest("SHA-256", encoder.encode(code)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(digest),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`abg-browser-proof-v1:${browserId}:${challenge}`),
    ),
  );
}

export async function protectCloudStorage(): Promise<boolean> {
  if (typeof browser.storage.local.setAccessLevel !== "function") return false;
  await browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  return true;
}
export async function savedCloudConnections(): Promise<SavedCloudConnection[]> {
  if (!(await protectCloudStorage())) return [];
  const { savedCloudConnections: raw } = await browser.storage.local.get("savedCloudConnections");
  if (!Array.isArray(raw)) return [];
  const found = new Map<string, SavedCloudConnection>();
  for (const item of raw.slice(0, 50)) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100 ||
      typeof item.url !== "string" ||
      typeof item.code !== "string" ||
      !codePattern.test(item.code) ||
      (item.expiresAt !== undefined &&
        (typeof item.expiresAt !== "string" || !Number.isFinite(Date.parse(item.expiresAt))))
    )
      continue;
    try {
      found.set(item.id, {
        id: item.id,
        name: item.name,
        url: normalizeCloudWebSocketUrl(item.url),
        code: item.code,
        expiresAt: item.expiresAt,
      });
    } catch {
      /* Ignore unusable saved destinations. */
    }
  }
  return [...found.values()];
}
let saving: Promise<unknown> = Promise.resolve();
export function changeSavedCloudConnections(
  change: (current: SavedCloudConnection[]) => SavedCloudConnection[],
): Promise<void> {
  const task = saving.then(async () => {
    if (!(await protectCloudStorage()))
      throw new Error("This browser cannot protect saved connections.");
    const next = change(await savedCloudConnections());
    if (next.length > 50) throw new Error("Remove a saved connection before adding another.");
    await browser.storage.local.set({ savedCloudConnections: next });
  });
  saving = task.catch(() => {});
  return task;
}
async function request(
  url: string,
  action: "start" | "poll",
  body: unknown,
): Promise<Record<string, unknown>> {
  const endpoint = new URL(normalizeCloudWebSocketUrl(url));
  endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
  endpoint.pathname = `/account/browser-login/${action}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.body) throw new Error("Cloud login returned an invalid response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) {
        await reader.cancel();
        throw new Error("Cloud login returned an invalid response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const content = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder().decode(content));
  if (!response.ok)
    throw Object.assign(new Error("Cloud login could not be completed. Start login again."), {
      status: response.status,
    });
  return result;
}
let starting = false;
export async function beginCloudLogin(url: string, name: string, savedId?: string): Promise<void> {
  if (starting) throw new Error("Login is already starting.");
  starting = true;
  try {
    await startCloudLogin(url, name, savedId);
  } finally {
    starting = false;
  }
}
async function startCloudLogin(url: string, name: string, savedId?: string): Promise<void> {
  if (!(await protectCloudStorage()))
    throw new Error("This browser cannot protect saved connections.");
  if (!name.trim() || name.trim().length > 100)
    throw new Error("Enter a connection name (1–100 characters).");
  const normalized = normalizeCloudWebSocketUrl(url);
  const connections = await savedCloudConnections();
  const selected = savedId
    ? connections.find((c) => c.id === savedId && c.url === normalized)
    : undefined;
  if (savedId && !selected) throw new Error("Select the saved connection again.");
  if (!selected && connections.length >= 50)
    throw new Error("Remove a saved connection before adding another.");
  const { pendingCloudLogin } = await browser.storage.session.get("pendingCloudLogin");
  if (pendingCloudLogin && pendingCloudLogin.expiresAt + 300_000 > Date.now())
    throw new Error("Finish the pending login or wait for it to expire before starting again.");
  const key = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", key.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", key.privateKey);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const id = selected?.id ?? crypto.randomUUID();
  const before = await browser.storage.local.get([
    "connectionDestination",
    "activeCloudConnectionId",
    "cloudWebSocketUrl",
  ]);
  const browserId = `browser-${id}`;
  const result = await request(normalized, "start", {
    browserId,
    name: name.trim(),
    challenge,
    publicKey: { kty: publicKey.kty, n: publicKey.n, e: publicKey.e },
    ...(selected ? { proof: await replacementProof(selected.code, browserId, challenge) } : {}),
  });
  if (
    typeof result.request !== "string" ||
    result.request.length > 4096 ||
    typeof result.expiresAt !== "number" ||
    typeof result.authorizeUrl !== "string"
  )
    throw new Error("Cloud login returned an invalid response.");
  const authorize = new URL(result.authorizeUrl);
  if (
    (authorize.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(authorize.hostname)) ||
    authorize.username ||
    authorize.password ||
    authorize.pathname !== "/connect/browser" ||
    authorize.searchParams.get("request") !== result.request
  )
    throw new Error("Cloud login returned an invalid destination.");
  const pending: PendingLogin = {
    id,
    name: name.trim(),
    url: normalized,
    request: result.request,
    verifier,
    privateKey,
    expiresAt: result.expiresAt,
    replacing: !!selected,
    selection: {
      destination: before.connectionDestination,
      id: before.activeCloudConnectionId,
      url: before.cloudWebSocketUrl,
    },
  };
  await browser.storage.session.set({ pendingCloudLogin: pending });
  await browser.alarms.create("cloud-login", { periodInMinutes: 0.5 });
  await browser.tabs.create({ url: authorize.toString(), active: true });
}
let polling = false;
let nextPoll = 0;
export async function pollCloudLogin(
  connected?: (connection: SavedCloudConnection) => Promise<void>,
): Promise<void> {
  if (polling || Date.now() < nextPoll) return;
  nextPoll = Date.now() + 2000;
  polling = true;
  let pendingId: string | undefined;
  try {
    const { pendingCloudLogin: pending } = (await browser.storage.session.get(
      "pendingCloudLogin",
    )) as { pendingCloudLogin?: PendingLogin };
    if (!pending) {
      await browser.alarms.clear("cloud-login");
      return;
    }
    pendingId = pending.id;
    if (pending.expiresAt + 300_000 <= Date.now()) {
      await browser.storage.session.remove("pendingCloudLogin");
      await browser.alarms.clear("cloud-login");
      return;
    }
    const result = await request(pending.url, "poll", {
      request: pending.request,
      verifier: pending.verifier,
    });
    if (
      (await browser.storage.session.get("pendingCloudLogin")).pendingCloudLogin?.id !== pending.id
    )
      return;
    if (result.status === "pending") return;
    if (result.status === "denied") {
      await browser.storage.session.remove("pendingCloudLogin");
      await browser.alarms.clear("cloud-login");
      return;
    }
    if (
      result.status !== "approved" ||
      typeof result.encrypted !== "string" ||
      result.encrypted.length > 512 ||
      typeof result.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(result.expiresAt))
    )
      throw new Error("Invalid login response.");
    const key = await crypto.subtle.importKey(
      "jwk",
      pending.privateKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
    const code = new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "RSA-OAEP" }, key, bytes(result.encrypted)),
    );
    if (!codePattern.test(code)) throw new Error("Invalid login response.");
    await changeSavedCloudConnections((connections) =>
      pending.replacing && !connections.some((c) => c.id === pending.id)
        ? connections
        : [
            ...connections.filter((c) => c.id !== pending.id),
            {
              id: pending.id,
              name: pending.name,
              url: pending.url,
              code,
              expiresAt: result.expiresAt as string,
            },
          ],
    );
    const saved = (await savedCloudConnections()).find((c) => c.id === pending.id);
    const current = await browser.storage.local.get([
      "connectionDestination",
      "activeCloudConnectionId",
      "cloudWebSocketUrl",
    ]);
    if (
      saved &&
      pending.selection &&
      current.connectionDestination === pending.selection.destination &&
      current.activeCloudConnectionId === pending.selection.id &&
      current.cloudWebSocketUrl === pending.selection.url
    ) {
      await connected?.(saved);
    }
    if (
      (await browser.storage.session.get("pendingCloudLogin")).pendingCloudLogin?.id === pending.id
    ) {
      await browser.storage.session.remove("pendingCloudLogin");
      await browser.alarms.clear("cloud-login");
    }
  } catch (error) {
    if (
      pendingId &&
      (await browser.storage.session.get("pendingCloudLogin")).pendingCloudLogin?.id ===
        pendingId &&
      [400, 401, 403, 404, 409, 410].includes((error as { status?: number }).status ?? 0)
    ) {
      await browser.storage.session.remove("pendingCloudLogin");
      await browser.alarms.clear("cloud-login");
    }
    throw error;
  } finally {
    polling = false;
  }
}
