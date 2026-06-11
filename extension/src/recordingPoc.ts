// Recording PoC — background (service worker) glue.
//
// Wires the popup trigger to the offscreen recorder. The popup mints a
// tabCapture streamId inside a real user gesture and sends it here; we ensure
// an offscreen document exists, forward the streamId, then save the returned
// webm via chrome.downloads.
//
// Goal: prove the gesture -> tabCapture -> offscreen -> webm(tab + mic) pipeline
// works in this MV3 extension before building the real `abg record` feature.
// Chrome-only (the offscreen API does not exist on Firefox).

import { browserAdapter } from "./browserAdapter.js";

const browser = browserAdapter;
const OFFSCREEN_URL = "offscreen.html";
const RECORDING_MS = 5000;

interface PocStartMessage {
  type: "recording_poc_start";
  streamId: string;
}

interface PocResult {
  ok: boolean;
  bytes?: number;
  mime?: string;
  micUsed?: boolean;
  filename?: string;
  error?: string;
}

let creating: Promise<void> | null = null;

export function registerRecordingPoc(): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as Partial<PocStartMessage>;
    if (msg?.type !== "recording_poc_start" || !msg.streamId) return undefined;
    runPoc(msg.streamId)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) } satisfies PocResult),
      );
    return true; // async response
  });
}

async function runPoc(streamId: string): Promise<PocResult> {
  await ensureOffscreenDocument();

  const result = (await chrome.runtime.sendMessage({
    target: "offscreen-recording-poc",
    type: "start",
    streamId,
    withMic: true,
    ms: RECORDING_MS,
  })) as {
    ok: boolean;
    dataUrl?: string;
    bytes?: number;
    mime?: string;
    micUsed?: boolean;
    error?: string;
  };

  if (!result?.ok || !result.dataUrl) {
    return { ok: false, error: result?.error ?? "offscreen returned no data" };
  }

  const filename = "abg-recording-poc.webm";
  await chrome.downloads.download({ url: result.dataUrl, filename, saveAs: false });
  return { ok: true, bytes: result.bytes, mime: result.mime, micUsed: result.micUsed, filename };
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreen = (chrome as unknown as { offscreen?: typeof chrome.offscreen }).offscreen;
  if (!offscreen) throw new Error("offscreen API unavailable (non-Chrome build)");

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length > 0) return;

  if (!creating) {
    creating = offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Record the shared tab (video + audio) for the recording PoC.",
    });
  }
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
