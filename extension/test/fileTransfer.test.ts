import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTransfers, UPLOAD_CHUNK_BYTES, UPLOAD_FILE_BYTES } from "../src/fileTransfer.js";

afterEach(() => vi.useRealTimers());
const id = "00000000-0000-4000-8000-000000000001";
const first = {
  transferId: id,
  name: "image.png",
  mime: "image/png",
  totalBytes: 5,
  offset: 0,
  data: btoa("abc"),
};

describe("ABG file transfer", () => {
  it("reassembles bytes and requires a complete transfer before attachment", () => {
    const store = new FileTransfers();
    expect(store.append("share", 7, first)).toEqual({
      transferId: id,
      receivedBytes: 3,
      complete: false,
    });
    expect(() => store.files("share", 7, [id])).toThrow("upload_incomplete");
    expect(store.append("share", 7, { ...first, offset: 3, data: btoa("de") }).complete).toBe(true);
    expect(store.files("share", 7, [id])).toEqual([
      { name: "image.png", mime: "image/png", data: btoa("abcde") },
    ]);
    store.remove([id]);
    expect(() => store.files("share", 7, [id])).toThrow("upload_not_found");
  });

  it("rejects access from another tab, share or connection and discards revoked data", () => {
    const store = new FileTransfers();
    store.append("connection:share", 7, { ...first, totalBytes: 3 });
    expect(() => store.files("other:share", 7, [id])).toThrow("upload_not_found");
    expect(() => store.files("connection:share", 8, [id])).toThrow("upload_not_found");
    expect(() => store.append("other:share", 7, first)).toThrow("upload_not_found");
    store.clear(8);
    expect(store.files("connection:share", 7, [id])).toHaveLength(1);
    store.clear(7);
    expect(() => store.files("connection:share", 7, [id])).toThrow("upload_not_found");
  });

  it("bounds chunks, total allocation, ordering and lifetime", () => {
    vi.useFakeTimers();
    const store = new FileTransfers();
    expect(() => store.append("s", 7, { ...first, offset: 1 })).toThrow("upload_offset_mismatch");
    expect(() => store.append("s", 7, { ...first, data: "!bad" })).toThrow("invalid_upload_chunk");
    expect(() =>
      store.append("s", 7, { ...first, data: btoa("a".repeat(UPLOAD_CHUNK_BYTES + 1)) }),
    ).toThrow("invalid_upload_chunk");
    store.append("s", 7, { ...first, totalBytes: UPLOAD_FILE_BYTES });
    store.append("s", 7, {
      ...first,
      transferId: "00000000-0000-4000-8000-000000000002",
      totalBytes: UPLOAD_FILE_BYTES,
    });
    expect(() =>
      store.append("s", 7, { ...first, transferId: "00000000-0000-4000-8000-000000000003" }),
    ).toThrow("upload_size_limit");
    expect(() => store.append("s", 7, first)).toThrow("upload_not_found");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(() => store.files("s", 7, [id])).toThrow("upload_not_found");
    expect(store.append("s", 7, { ...first, totalBytes: 3 }).complete).toBe(true);
    store.clear();
    expect(() => store.files("s", 7, [id])).toThrow("upload_not_found");
  });
});
