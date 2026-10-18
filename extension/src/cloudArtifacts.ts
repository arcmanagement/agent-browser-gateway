/** Recordings stay in the connected browser until explicitly downloaded through an active share. */
const DB = "abg-cloud-recordings-v1";
const MAX_BYTES = 64 * 1024 * 1024;
const TTL = 60 * 60 * 1000;
const PART = 48 * 1024;
export type CloudRecording = {
  id: string;
  connection: string;
  tabId: number;
  createdAt: number;
  bytes: number;
  parts: number;
  complete: boolean;
  mime: string;
  failed?: string;
};
function request<T>(input: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    input.onsuccess = () => resolve(input.result);
    input.onerror = () => reject(Error("recording_storage_failed"));
  });
}
async function database() {
  const open = indexedDB.open(DB, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("recordings", { keyPath: "id" });
    open.result.createObjectStore("parts");
  };
  return request(open);
}
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T>) {
  const db = await database();
  try {
    const tx = db.transaction(["recordings", "parts"], mode);
    const complete = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(Error("recording_storage_failed"));
    });
    try {
      const value = await run(tx);
      await complete;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await complete.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
}
async function purge(tx: IDBTransaction, row: CloudRecording) {
  const records = tx.objectStore("recordings"),
    parts = tx.objectStore("parts");
  records.delete(row.id);
  for (let i = 0; i < row.parts; i++) parts.delete(`${row.id}:${i}`);
}
export async function beginCloudRecording(
  row: Pick<CloudRecording, "id" | "connection" | "tabId" | "mime">,
) {
  await transaction("readwrite", async (tx) => {
    const records = tx.objectStore("recordings");
    const rows = (await request(records.getAll())) as CloudRecording[];
    const live = rows
      .filter((r) => r.createdAt + TTL > Date.now())
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const expired of rows.filter((r) => r.createdAt + TTL <= Date.now()))
      await purge(tx, expired);
    while (live.length >= 3) await purge(tx, live.shift()!);
    if (rows.some((r) => r.id === row.id)) throw Error("recording_exists");
    records.put({ ...row, createdAt: Date.now(), bytes: 0, parts: 0, complete: false });
  });
}
export async function appendCloudRecording(id: string, dataBase64: string) {
  // The offscreen recorder emits ordered chunks; split each into bounded RPC-sized pieces.
  const binary = atob(dataBase64);
  const failed = await transaction("readwrite", async (tx) => {
    const records = tx.objectStore("recordings"),
      row = (await request(records.get(id))) as CloudRecording | undefined;
    if (!row || row.complete || row.failed || row.createdAt + TTL <= Date.now())
      throw Error("recording_unavailable");
    if (row.bytes + binary.length > MAX_BYTES) {
      row.failed = "recording_size_limit";
      records.put(row);
      return row.failed;
    }
    const parts = tx.objectStore("parts");
    let pending = binary;
    if (row.parts) {
      const lastKey = `${id}:${row.parts - 1}`;
      const last = atob((await request(parts.get(lastKey))) as string);
      if (last.length < PART) {
        pending = last + pending;
        row.parts--;
      }
    }
    for (let offset = 0; offset < pending.length; offset += PART)
      parts.put(btoa(pending.slice(offset, offset + PART)), `${id}:${row.parts++}`);
    row.bytes += binary.length;
    records.put(row);
    return undefined;
  });
  if (failed) throw Error(failed);
}
export async function finishCloudRecording(id: string, failed?: string) {
  await transaction("readwrite", async (tx) => {
    const records = tx.objectStore("recordings"),
      row = (await request(records.get(id))) as CloudRecording | undefined;
    if (!row) return;
    row.complete = true;
    if (failed) row.failed = failed;
    records.put(row);
  });
}
type RecordingMetadata = Omit<CloudRecording, "connection">;
type RecordingPart = { id: string; part: number; dataBase64: string };
export function readCloudRecording(
  connection: string,
  tabId: number,
  id: string,
): Promise<RecordingMetadata>;
export function readCloudRecording(
  connection: string,
  tabId: number,
  id: string,
  part: number,
): Promise<RecordingPart>;
export function readCloudRecording(
  connection: string,
  tabId: number,
  id: string,
  part: number | undefined,
): Promise<RecordingMetadata | RecordingPart>;
export async function readCloudRecording(
  connection: string,
  tabId: number,
  id: string,
  part?: number,
) {
  return transaction("readonly", async (tx) => {
    const row = (await request(tx.objectStore("recordings").get(id))) as CloudRecording | undefined;
    if (
      !row ||
      row.connection !== connection ||
      row.tabId !== tabId ||
      row.createdAt + TTL <= Date.now()
    )
      throw Error("recording_unavailable");
    if (part === undefined) {
      const { connection: _, ...metadata } = row;
      return metadata;
    }
    if (!row.complete || row.failed || !Number.isSafeInteger(part) || part < 0 || part >= row.parts)
      throw Error(row.failed ?? "recording_not_ready");
    return {
      id,
      part,
      dataBase64: (await request(tx.objectStore("parts").get(`${id}:${part}`))) as string,
    };
  });
}
