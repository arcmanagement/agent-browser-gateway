# CLI JSON Contract

ABG's CLI JSON contract is the stable interface consumed by agents, scripts, and plugin command
wrappers. The current contract version is `1`, defined in `CLIJSONContract.version`.

## Transport Envelope

The CLI talks to the local Gateway through the platform-local IPC abstraction: Unix domain sockets
on macOS and Linux, and named pipes on Windows. On macOS, the CLI probes the standard state
directory socket and then the app-group container socket used by the sandboxed Mac App Store
gateway. When neither socket is reachable, it falls back to a token-authenticated loopback
WebSocket. The envelopes below are identical across transports. Endpoint resolution, permissions,
fallback behavior, and cleanup are documented in `docs/LOCAL_IPC.md`; callers should use the `abg`
CLI contract instead of reaching into OS-specific endpoints.

Requests use this envelope:

```json
{
  "id": "uuid-or-caller-id",
  "method": "status",
  "params": {}
}
```

Responses use this envelope:

```json
{
  "id": "same-id",
  "result": {}
}
```

`result` is command-specific. `error` is an object on failure. The unused counterpart is optional and
may be omitted or encoded as `null`; callers should treat both forms the same. Command stdout prints
the successful `result` value rather than the transport envelope.

## Major Command Output

These shapes are stable for automation. New optional keys may be added without a contract bump.

| Command | Result shape |
| --- | --- |
| `abg status` | Object with Gateway state, including running/connection counters and extension metadata. |
| `abg tabs` | Array of tab objects with stable tab identity and sharing metadata. Compact mode preserves stable `ref`, profile-qualified `targetId`, Chrome `tabId`, `title`, `url`, `accessMode`, and profile/browser labels when available. |
| `abg inspect` | Object combining `status`-style fields with `extensionCount`, `permittedTabCount`, `tabs`, and optional recovery guidance when no tabs are shared. |
| `abg read` | Object containing tab metadata and the requested content format, such as `text`, `html`, `markdown`, or structured JSON. |
| `abg get` | Object or scalar result for the requested getter. Getter names and primitive JSON types are part of the command contract. |
| `abg snapshot` | Object or array containing inspectable element rows with refs, text, roles, and selector/geometry metadata when available. |
| `abg screenshot` | Object with local output path and capture metadata. `abg screenshot --latest` returns the latest saved screenshot path object or a normalized error. |
| `abg wait` | Object `{ ok, mode, ... }` — `{ ok: true, mode, ms | value }` on success, `{ ok: false, error: "timeout", mode, timeoutMs }` on timeout. Combined load+selector waits return `{ load, selector }` with one such object each. |
| `abg replay` | Dry run returns `{ tabId, steps }`; execution returns `{ ok, tabId, results }` where each result row is `{ index, op, result }` and `result` is that step's command output. See `docs/REPLAY_POLICY.md`. |
| `abg record start` | Object `{ ok, recordingId, tabId, path, mic, startedAt }` after the user approves. `abg record stop` returns `{ ok, path, bytes, durationMs, mime, mic }`; `abg record status` returns `{ recording, ... }`. See `docs/RECORDING.md`. |
| `abg audit` | Array of recent audit log rows. Rows are append-only JSON objects; sensitive operation payload values remain omitted or summarized. |
| `abg plugin list` | Array of plugin objects with `name`, `source`, filesystem status, manifest metadata, and loaded command metadata when available. |
| `abg <plugin> <command>` | JSON value returned by the plugin command handler. Command plugins should prefer stable object results such as `{ "ok": true, ... }`. |

## Error Object

Gateway protocol errors use `ErrorPayload`:

```json
{
  "code": "no_matching_tab",
  "message": "No shared tab matches the plugin domain policy.",
  "userMessage": "共有済みタブが見つかりません。",
  "nextCommand": "abg tabs --compact",
  "hint": "Share the target tab from the extension popup.",
  "tabId": 123,
  "plugin": "slack",
  "command": "catch-up",
  "expectedDomains": ["*.slack.com"],
  "candidates": [
    {
      "ref": "t1",
      "tabId": 123,
      "title": "Example",
      "url": "https://example.com/",
      "accessMode": "manual"
    }
  ]
}
```

CLI stderr normalizes `code` to `error` for user-facing command failures:

```json
{
  "error": "no_matching_tab",
  "message": "No shared tab matches the plugin domain policy.",
  "userMessage": "共有済みタブが見つかりません。",
  "nextCommand": "abg tabs --compact"
}
```

Error codes are stable snake_case identifiers. `message` is short technical English for logs and
scripts. `userMessage` is optional user-recovery copy and should be included when the caller can take
a clear local action. `nextCommand` must be a safe local command that helps recover or inspect state.

Tab refs are stable for the lifetime of the running Gateway and route by browser profile plus Chrome
tab ID. `ambiguous_tab_id` means the same raw positive Chrome tab ID exists in multiple connected
profiles; retry with a ref from `abg tabs --compact`. `script_too_large` is returned before dispatch
when eval source exceeds 262144 bytes. `command_timeout` reports an eval that exceeded its effective
timeout after dispatch. `file_access_required` means Chrome's explicit **Allow access to file URLs**
grant is off; Chrome applies that local-file grant to debugger attachment on HTTP and HTTPS pages too.
Other debugger-side attachment failures use `file_attach_failed` with selector, frame, and path
recovery guidance. ABG v0.4.3 and later use a stable CDP backend node for upload, avoiding a separate
class of failures caused by transient frontend node handles. `ambiguous_selector` means a
selector-based click matched more than one element; nothing is clicked, the error carries
`matchCount`, and the caller narrows the selector or picks one match with `abg find first|last|nth`
or a snapshot ref. `blocked_by_extension_frame` means a third-party extension iframe (such as
a password manager inline menu) is open in the tab and Chrome refuses debugger commands for the
whole tab until the user dismisses it; the dispatched action may still have executed.

The stable optional error fields are:

- `userMessage`
- `nextCommand`
- `hint`
- `tabId`
- `plugin`
- `command`
- `expectedDomains`
- `candidates`
- `matchCount`

## Versioning Policy

Additive optional fields do not require a contract version bump. Renaming or removing stable keys,
changing a documented JSON type, changing an error code, or changing stdout from JSON to text is a
breaking change and requires a contract version bump plus release notes.

When a breaking change is unavoidable, keep a compatibility window where the old key or behavior is
still emitted alongside the new one whenever practical. Contract tests should be updated in the same
PR as the intentional version bump.
