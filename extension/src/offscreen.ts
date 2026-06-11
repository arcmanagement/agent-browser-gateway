// Recording PoC — offscreen document.
//
// MV3 service workers cannot run getUserMedia / MediaRecorder, so the actual
// capture happens here in a DOM context. The background worker hands us a
// tabCapture streamId (minted inside a popup user gesture) and we:
//   1. open the tab MediaStream (video + audio) from that streamId,
//   2. re-route the tab audio back to the speakers (capturing it mutes them),
//   3. optionally mix in the microphone,
//   4. record `ms` milliseconds of webm,
//   5. return the result to the background worker as a data URL.
//
// This file exists only to de-risk the gesture / capture pipeline; it is not
// the final recording architecture.

interface StartMessage {
  target: "offscreen-recording-poc";
  type: "start";
  streamId: string;
  withMic: boolean;
  ms: number;
}

interface StartResult {
  ok: boolean;
  dataUrl?: string;
  bytes?: number;
  mime?: string;
  micUsed?: boolean;
  error?: string;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<StartMessage>;
  if (msg?.target !== "offscreen-recording-poc" || msg.type !== "start" || !msg.streamId) {
    return undefined;
  }
  record(msg as StartMessage)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({ ok: false, error: errorMessage(error) } satisfies StartResult),
    );
  return true; // keep the channel open for the async response
});

async function record(msg: StartMessage): Promise<StartResult> {
  // chromeMediaSource constraints are not in the standard typings.
  const tabConstraints = {
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId } },
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId } },
  } as unknown as MediaStreamConstraints;
  const tabStream = await navigator.mediaDevices.getUserMedia(tabConstraints);

  // Capturing tab audio detaches it from the output; rebuild it through a graph
  // so the user still hears the page while we also record it.
  const audioCtx = new AudioContext();
  const mixDestination = audioCtx.createMediaStreamDestination();
  const tabSource = audioCtx.createMediaStreamSource(tabStream);
  tabSource.connect(audioCtx.destination); // keep audible
  tabSource.connect(mixDestination); // into the recording mix

  let micUsed = false;
  let micStream: MediaStream | null = null;
  if (msg.withMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioCtx.createMediaStreamSource(micStream).connect(mixDestination);
      micUsed = true;
    } catch (error) {
      // Mic denied / unavailable — keep going with tab audio only.
      console.warn("[recording-poc] microphone unavailable:", error);
    }
  }

  const mixed = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...mixDestination.stream.getAudioTracks(),
  ]);

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(mixed, { mimeType: "video/webm" });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  recorder.start(1000); // timeslice so the webm carries duration metadata
  await delay(msg.ms);
  recorder.stop();
  const blob = await stopped;

  for (const track of mixed.getTracks()) track.stop();
  for (const track of tabStream.getTracks()) track.stop();
  if (micStream) for (const track of micStream.getTracks()) track.stop();
  await audioCtx.close();

  return {
    ok: true,
    dataUrl: await blobToDataUrl(blob),
    bytes: blob.size,
    mime: blob.type,
    micUsed,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
