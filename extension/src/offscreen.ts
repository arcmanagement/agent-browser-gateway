// Recording — offscreen document.
//
// MV3 service workers cannot run getUserMedia / MediaRecorder, so the actual
// capture happens here in a DOM context. The background worker hands us a
// tabCapture streamId (minted inside the approval-window "Allow" gesture) and
// a recordingId. We:
//   1. open the tab MediaStream (video + audio) from that streamId,
//   2. re-route the tab audio back to the speakers (capturing it mutes them),
//   3. optionally mix in the microphone,
//   4. start MediaRecorder with a timeslice and stream each webm chunk to the
//      background worker (which forwards it to the Gateway), and
//   5. on stop, emit a final "stopped" event with duration + mime.
//
// One recording is active at a time (mirrors the single-session Stream model).

interface StartCommand {
  target: "abg-offscreen";
  cmd: "start";
  recordingId: string;
  streamId: string;
  withMic: boolean;
  timesliceMs?: number;
}

interface StopCommand {
  target: "abg-offscreen";
  cmd: "stop";
  recordingId: string;
}

type OffscreenCommand = StartCommand | StopCommand;

interface StartResult {
  ok: boolean;
  micUsed?: boolean;
  mime?: string;
  error?: string;
}

interface StopResult {
  ok: boolean;
  error?: string;
}

interface ActiveRecording {
  recordingId: string;
  recorder: MediaRecorder;
  audioCtx: AudioContext;
  tabStream: MediaStream;
  micStream: MediaStream | null;
  mixed: MediaStream;
  mime: string;
  micUsed: boolean;
  startedAt: number;
  seq: number;
  sendChain: Promise<void>;
}

let active: ActiveRecording | null = null;

const DEFAULT_TIMESLICE_MS = 1000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Partial<OffscreenCommand>;
  if (msg?.target !== "abg-offscreen") return undefined;
  if (msg.cmd === "start") {
    startRecording(msg as StartCommand)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) } satisfies StartResult),
      );
    return true; // async response
  }
  if (msg.cmd === "stop") {
    stopRecording(msg as StopCommand)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: errorMessage(error) } satisfies StopResult),
      );
    return true;
  }
  return undefined;
});

async function startRecording(msg: StartCommand): Promise<StartResult> {
  if (active) {
    return { ok: false, error: "a recording is already active" };
  }

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
      console.warn("[abg-recorder] microphone unavailable:", error);
    }
  }

  const mixed = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...mixDestination.stream.getAudioTracks(),
  ]);

  const mime = pickMimeType();
  const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined);

  const recording: ActiveRecording = {
    recordingId: msg.recordingId,
    recorder,
    audioCtx,
    tabStream,
    micStream,
    mixed,
    mime: recorder.mimeType || mime || "video/webm",
    micUsed,
    startedAt: performance.now(),
    seq: 0,
    sendChain: Promise.resolve(),
  };
  active = recording;

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    const seq = recording.seq++;
    // Preserve chunk order: base64-encode + post sequentially.
    recording.sendChain = recording.sendChain.then(() => emitChunk(recording, seq, event.data));
  };
  recorder.onerror = (event) => {
    const detail = (event as unknown as { error?: DOMException }).error;
    emitEvent({
      type: "abg_offscreen_error",
      recordingId: recording.recordingId,
      error: detail?.message ?? "MediaRecorder error",
    });
    teardown(recording);
  };

  // Tab closed / navigated away ends the video track — finalize gracefully.
  const [videoTrack] = tabStream.getVideoTracks();
  if (videoTrack) {
    videoTrack.onended = () => {
      if (active?.recordingId === recording.recordingId && recorder.state !== "inactive") {
        recorder.stop();
      }
    };
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  void finalizeOnStop(recording, stopped);

  recorder.start(msg.timesliceMs ?? DEFAULT_TIMESLICE_MS);
  return { ok: true, micUsed, mime: recording.mime };
}

async function stopRecording(msg: StopCommand): Promise<StopResult> {
  const recording = active;
  if (!recording || recording.recordingId !== msg.recordingId) {
    return { ok: false, error: "no matching active recording" };
  }
  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }
  return { ok: true };
}

async function finalizeOnStop(recording: ActiveRecording, stopped: Promise<void>): Promise<void> {
  await stopped;
  // Wait for the trailing chunk(s) to finish encoding + posting so the Gateway
  // has the whole file before we announce completion.
  await recording.sendChain;
  const durationMs = Math.round(performance.now() - recording.startedAt);
  emitEvent({
    type: "abg_offscreen_stopped",
    recordingId: recording.recordingId,
    durationMs,
    mime: recording.mime,
    micUsed: recording.micUsed,
    chunkCount: recording.seq,
  });
  teardown(recording);
}

async function emitChunk(recording: ActiveRecording, seq: number, blob: Blob): Promise<void> {
  const dataBase64 = await blobToBase64(blob);
  emitEvent({
    type: "abg_offscreen_chunk",
    recordingId: recording.recordingId,
    seq,
    dataBase64,
  });
}

function emitEvent(event: Record<string, unknown>): void {
  // Fire-and-forget to the background worker; ignore "no receiver" races.
  try {
    void chrome.runtime.sendMessage(event).catch?.(() => {});
  } catch {
    // sendMessage can throw synchronously if the context is tearing down.
  }
}

function teardown(recording: ActiveRecording): void {
  if (active?.recordingId === recording.recordingId) active = null;
  for (const track of recording.mixed.getTracks()) track.stop();
  for (const track of recording.tabStream.getTracks()) track.stop();
  if (recording.micStream) for (const track of recording.micStream.getTracks()) track.stop();
  recording.audioCtx.close().catch(() => {});
}

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
