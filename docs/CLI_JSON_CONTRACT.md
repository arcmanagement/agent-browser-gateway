# CLI JSON Contract

ABG's CLI JSON contract is the stable interface consumed by agents, scripts, and plugin command
wrappers. The current contract version is `1`, defined in `CLIJSONContract.version`.

## Transport Envelope

The CLI talks to the local Gateway over line-delimited JSON on the Unix domain socket.

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
| `abg tabs` | Array of tab objects with stable tab identity and sharing metadata. Compact mode preserves `ref`, `tabId`, `title`, `url`, and `accessMode`. |
| `abg inspect` | Object combining `status`-style fields with `extensionCount`, `permittedTabCount`, `tabs`, and optional recovery guidance when no tabs are shared. |
| `abg read` | Object containing tab metadata and the requested content format, such as `text`, `html`, `markdown`, or structured JSON. |
| `abg get` | Object or scalar result for the requested getter. Getter names and primitive JSON types are part of the command contract. |
| `abg snapshot` | Object or array containing inspectable element rows with refs, text, roles, and selector/geometry metadata when available. |
| `abg screenshot` | Object with local output path and capture metadata. `abg screenshot --latest` returns the latest saved screenshot path object or a normalized error. |
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

The stable optional error fields are:

- `userMessage`
- `nextCommand`
- `hint`
- `tabId`
- `plugin`
- `command`
- `expectedDomains`
- `candidates`

## Versioning Policy

Additive optional fields do not require a contract version bump. Renaming or removing stable keys,
changing a documented JSON type, changing an error code, or changing stdout from JSON to text is a
breaking change and requires a contract version bump plus release notes.

When a breaking change is unavoidable, keep a compatibility window where the old key or behavior is
still emitted alongside the new one whenever practical. Contract tests should be updated in the same
PR as the intentional version bump.
