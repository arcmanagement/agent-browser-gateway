# Tab recording (`abg record start/stop/status`)

Record a shared browser tab to a playable `.webm` video with **tab audio** (and,
opt-in, the **microphone**). Unlike a screenshot stream, this is real, smooth
video with sound — suitable for sharing a flow with a person (bug repro,
walkthrough, demo) or for feeding tab audio to an agent.

This is the one capability a headless automation driver such as Playwright
cannot match structurally: `chrome.tabCapture` is an extension-only API, and
Playwright's built-in `recordVideo` produces silent video. ABG records the
**real logged-in tab**, with **tab audio**, behind an explicit consent gate.

## CLI

```bash
abg record start <tab|ref> [--mic] [--out out.webm]
abg record stop
abg record status
```

- `start` opens the ABG approval window. Clicking **Allow** both grants consent
  and supplies the user gesture Chrome requires to start tab capture. Recording
  then runs until `stop`. The tab shows a red **REC** badge while active.
- `--mic` also records the microphone (the physical room). Off by default. If
  the OS/mic permission is denied, recording continues with tab audio only and
  the result reports `mic: false`.
- `--out` chooses the output path. Omitted, the Gateway writes to
  `$TMPDIR/abg/recordings/tab-<id>-<timestamp>.webm` and returns the path.
- `stop` finalizes the file and returns `{ path, bytes, durationMs, mime, mic }`.
- Only one recording is active at a time (single-session, like `abg stream`).

## Consent and the gesture

`abg record start` is **always** approval-gated, regardless of the
`operationsRequireApproval` setting — recording tab/room audio is heavier than
the per-tab read/operate model, so it must never be silently auto-approved.

The approval window's **Allow** click is also the user gesture that mints the
`tabCapture` stream ID (`chrome.tabCapture.getMediaStreamId` is called
synchronously inside the click so the gesture stays live). This is how a
CLI-driven start satisfies Chrome's gesture requirement without a human touching
the browser toolbar.

## Architecture

Three layers, mirroring the existing screenshot/stream flows.

```
abg record start ──UDS──▶ Coordinator ──WS cmd──▶ background.ts
                                                     │  approval window (Allow = gesture)
                                                     │  mints tabCapture streamId
                                                     ▼
                                              offscreen document
                                              getUserMedia({chromeMediaSource:'tab'})
                                              + mic (opt-in) via Web Audio
                                              MediaRecorder(timeslice=1s)
                                                     │  webm chunk / 1s
   Gateway appends chunks  ◀──WS record_chunk──────┘
   to the .webm file       ◀──WS record_stopped──── (finalize → return path)
```

- MV3 service workers cannot run `getUserMedia`/`MediaRecorder`, so capture runs
  in an **offscreen document**.
- Tab audio is captured *and* re-routed to the speakers (capturing it otherwise
  mutes the page) so the user still hears the tab while it records.
- The recorder uses a **timeslice**, streaming one webm chunk per second. The
  Gateway appends each chunk to the file on disk, so long recordings never build
  a huge in-memory blob and never exceed the WebSocket frame limit.
- Cleanup: closing or revoking the tab ends the capture track, which stops the
  recorder and finalizes the file; a dropped extension connection flushes what
  was captured.

## Per-tab vs all-tabs / sandbox

Recording targets one explicitly shared tab by `tabId`. The permission check is
identical to every other command (the tab must be in `permittedTabs`), so it
works the same whether the tab was shared in per-tab `manual` mode or is present
via `all_tabs` mode. The approval gate is always shown regardless of mode.

The capture stream differs between the modes. Manual sharing's toolbar click carries the
`activeTab` grant that `tabCapture` needs, so the Allow click mints the stream directly. Tabs
shared through `all_tabs` mode never received a per-tab action click, so `tabCapture` refuses
them; the approval window detects this at load and the Allow click opens Chrome's own tab picker
(`desktopCapture`) instead — choose the tab and enable its audio-sharing toggle to record tab
audio. Cancelling the picker cancels the recording; leaving the audio toggle off records
video-only.

## Output locations and the App Store sandbox

Without `--output`, recordings land in the ABG recordings directory and HAR exports in
the ABG `har` directory. For the sandboxed Mac App Store gateway both resolve inside
the shared app-group container (`~/Library/Group Containers/group.jp.co.arcm.abg/abg/`),
where the CLI and the user can read them; unsandboxed builds use the user temp
directory. The result JSON always carries the resolved `path`/`outputPath`.

An explicit output path the gateway cannot write — typically any location outside the
group container under the sandbox — is rejected up front with `output_path_unwritable`
before capture or approval starts, instead of failing mid-recording.

## Firefox

Chrome-first. The offscreen and `tabCapture` APIs do not exist on Firefox, so
the firefox build strips the `offscreen`/`tabCapture` permissions and the
offscreen document; `abg record start` is unavailable there.

## Manual verification runbook

The capture pipeline (gesture → tabCapture → offscreen → webm) cannot be
exercised headlessly — it needs a real Chrome, a real click, and audio. Verify a
build like this:

1. **Rebuild + reinstall the app** so the Gateway has the record methods:
   `./build-app.sh` (or your usual install), then relaunch the Gateway.
2. **Rebuild + reload the extension**: `cd extension && pnpm run build`, then in
   `chrome://extensions` reload the unpacked ABG extension.
3. Open a tab that plays audio (e.g. a YouTube video) and **share it** via the
   ABG popup. Note its ref from `abg tabs --compact`.
4. `abg record start <ref>` → an approval window appears. Click **Allow**.
   - Expect: the command returns `{ ok: true, recordingId, path, mic: false }`.
   - Expect: the tab's toolbar badge turns red **REC**.
   - Expect: you still hear the tab audio during recording.
5. Let it run a few seconds, then `abg record start <ref> --mic` in a separate
   check to confirm the OS mic prompt appears and `mic: true` comes back.
6. `abg record stop` → returns `{ path, bytes, durationMs, mic }`.
7. Open the returned `.webm` in a standard player. Confirm: smooth video, tab
   audio present, plays and is seekable, and (for the `--mic` run) room audio is
   mixed in.
8. `abg record status` mid-recording shows the active session; after stop it
   shows `recording: false`.
9. Edge cases: close the tab mid-recording → the file still finalizes; deny the
   approval → no file is written and the command errors `user_denied`.

### Known limitation to check

DRM/EME-protected media (e.g. Netflix) may capture as black video or silence via
`tabCapture`. ABG's target use cases — SaaS dashboards, meetings, internal tools
— are unaffected, but confirm behavior if protected playback is in scope.
