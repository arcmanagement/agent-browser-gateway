export const UPLOAD_CHUNK_BYTES = 36 * 1024;
export const UPLOAD_FILE_BYTES = 16 * 1024 * 1024;
const TOTAL_BYTES = 32 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;

export class FileTransferError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export type UploadChunk = {
  transferId: string;
  name: string;
  mime: string;
  totalBytes: number;
  offset: number;
  data: string;
};
export type UploadedFile = { name: string; mime: string; data: string };
type Transfer = Omit<UploadChunk, "offset" | "data"> & {
  scope: string;
  tabId: number;
  expiresAt: number;
  receivedBytes: number;
  chunks: Uint8Array[];
};

export class FileTransfers {
  private readonly transfers = new Map<string, Transfer>();

  clear(tabId?: number) {
    for (const [id, row] of this.transfers) {
      if (tabId === undefined || row.tabId === tabId) this.transfers.delete(id);
    }
  }

  private purge() {
    for (const [id, row] of this.transfers) {
      if (row.expiresAt <= Date.now()) this.transfers.delete(id);
    }
  }

  append(scope: string, tabId: number, input: UploadChunk) {
    this.purge();
    if (
      !/^[a-f0-9-]{36}$/i.test(input.transferId) ||
      !input.name ||
      input.name.length > 255 ||
      [...input.name].some((c) => c.charCodeAt(0) < 32 || c === "/" || c === "\\") ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(input.mime) ||
      input.mime.length > 128 ||
      !Number.isSafeInteger(input.totalBytes) ||
      input.totalBytes < 1 ||
      input.totalBytes > UPLOAD_FILE_BYTES ||
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      typeof input.data !== "string" ||
      input.data.length > (UPLOAD_CHUNK_BYTES * 4) / 3 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
    )
      throw new FileTransferError("invalid_upload_chunk");
    const decoded = atob(input.data);
    if (!decoded.length || input.offset + decoded.length > input.totalBytes)
      throw new FileTransferError("invalid_upload_chunk");
    let row = this.transfers.get(input.transferId);
    if (!row) {
      if (input.offset !== 0) throw new FileTransferError("upload_offset_mismatch");
      const reserved = [...this.transfers.values()].reduce((n, value) => n + value.totalBytes, 0);
      if (this.transfers.size >= 20 || reserved + input.totalBytes > TOTAL_BYTES)
        throw new FileTransferError("upload_size_limit");
      row = {
        transferId: input.transferId,
        name: input.name,
        mime: input.mime,
        totalBytes: input.totalBytes,
        scope,
        tabId,
        expiresAt: Date.now() + TTL_MS,
        receivedBytes: 0,
        chunks: [],
      };
      this.transfers.set(input.transferId, row);
    }
    if (
      row.scope !== scope ||
      row.tabId !== tabId ||
      row.name !== input.name ||
      row.mime !== input.mime ||
      row.totalBytes !== input.totalBytes
    )
      throw new FileTransferError("upload_not_found");
    if (input.offset !== row.receivedBytes) throw new FileTransferError("upload_offset_mismatch");
    row.chunks.push(Uint8Array.from(decoded, (c) => c.charCodeAt(0)));
    row.receivedBytes += decoded.length;
    return {
      transferId: input.transferId,
      receivedBytes: row.receivedBytes,
      complete: row.receivedBytes === row.totalBytes,
    };
  }

  files(scope: string, tabId: number, ids: string[]): UploadedFile[] {
    this.purge();
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      throw new FileTransferError("invalid_upload_chunk");
    return ids.map((id) => {
      const row = this.transfers.get(id);
      if (!row || row.scope !== scope || row.tabId !== tabId)
        throw new FileTransferError("upload_not_found");
      if (row.receivedBytes !== row.totalBytes) throw new FileTransferError("upload_incomplete");
      const bytes = new Uint8Array(row.totalBytes);
      let offset = 0;
      for (const chunk of row.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { name: row.name, mime: row.mime, data: btoa(binary) };
    });
  }

  remove(ids: string[]) {
    for (const id of ids) this.transfers.delete(id);
  }
}

// Runs in the target document's isolated world; no client or browser-host path is read.
export function attachUploadedFiles(selector: string, files: UploadedFile[]) {
  const matches = document.querySelectorAll(selector);
  if (matches.length !== 1) throw new Error("file_input_not_unique");
  const input = matches[0];
  if (!(input instanceof HTMLInputElement) || input.type !== "file")
    throw new Error("not_file_input");
  if (input.disabled) throw new Error("file_input_disabled");
  if (files.length > 1 && !input.multiple) throw new Error("single_file_input");
  const transfer = new DataTransfer();
  for (const file of files) {
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], file.name, { type: file.mime }));
  }
  input.files = transfer.files;
  const count = transfer.files.length;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, files: count };
}
