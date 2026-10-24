import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendCloudRecording,
  beginCloudRecording,
  finishCloudRecording,
  readCloudRecording,
} from "../src/cloudArtifacts.js";

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("abg-cloud-recordings-v1");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
describe("browser-local cloud recording artifacts", () => {
  it("keeps bounded parts with the connection and share, finalizes and expires", async () => {
    await beginCloudRecording({
      id: "test",
      connection: "owner:share",
      tabId: 7,
      mime: "video/webm",
    });
    await appendCloudRecording("test", btoa("a".repeat(100000)));
    expect((await readCloudRecording("owner:share", 7, "test")).parts).toBe(3);
    await expect(readCloudRecording("other:share", 7, "test")).rejects.toThrow(
      "recording_unavailable",
    );
    await expect(readCloudRecording("owner:share", 8, "test")).rejects.toThrow(
      "recording_unavailable",
    );
    await expect(readCloudRecording("owner:share", 7, "test", 0)).rejects.toThrow(
      "recording_not_ready",
    );
    await finishCloudRecording("test");
    expect(atob((await readCloudRecording("owner:share", 7, "test", 0)).dataBase64!)).toHaveLength(
      49152,
    );
    await expect(readCloudRecording("owner:share", 7, "test", 3)).rejects.toThrow(
      "recording_not_ready",
    );
  });
  it("coalesces thousands of small chunks without losing bytes or exceeding the API part cap", async () => {
    await beginCloudRecording({ id: "long", connection: "owner", tabId: 7, mime: "video/webm" });
    for (let n = 0; n < 2100; n++)
      await appendCloudRecording("long", btoa(String.fromCharCode(n % 256)));
    await finishCloudRecording("long");
    expect((await readCloudRecording("owner", 7, "long")).parts).toBe(1);
    const binary = atob((await readCloudRecording("owner", 7, "long", 0)).dataBase64);
    expect(binary).toHaveLength(2100);
    for (let n = 0; n < 2100; n++) expect(binary.charCodeAt(n)).toBe(n % 256);
  });
  it("evicts older recordings and denies failed recordings", async () => {
    for (let n = 0; n < 4; n++)
      await beginCloudRecording({ id: `r${n}`, connection: "owner", tabId: 7, mime: "video/webm" });
    await expect(readCloudRecording("owner", 7, "r0")).rejects.toThrow("recording_unavailable");
    await appendCloudRecording("r3", btoa("abc"));
    await finishCloudRecording("r3", "recording_failed");
    await expect(readCloudRecording("owner", 7, "r3", 0)).rejects.toThrow("recording_failed");
  });
});
