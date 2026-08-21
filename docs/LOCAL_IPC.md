# Local IPC contract

ABG exposes one CLI-facing IPC contract across desktop operating systems. The `abg` CLI sends one
JSON request to the local Gateway and reads one JSON response. Unix sockets and named pipes use
line-delimited JSON. The authenticated macOS WebSocket fallback carries one request or response per
text message without a trailing newline. Callers use CLI commands and the JSON contract in
`docs/CLI_JSON_CONTRACT.md`; they do not select socket paths, pipe names, permissions, or fallback
transports.

## CLI-facing contract

Every supported platform uses the same transport payload:

```json
{"id":"uuid-or-caller-id","method":"status","params":{}}
```

The Gateway replies with one JSON response. Unix sockets and named pipes append a newline; the
macOS WebSocket fallback sends the same envelope as one text message:

```json
{"id":"same-id","result":{}}
```

Errors use the same `error` object on every OS. The CLI may normalize those errors for stderr, but
the local IPC endpoint remains an implementation detail of the platform-specific CLI and Gateway
runtime.

Endpoint resolution is owned by ABG:

1. Resolve the runtime profile from `ABG_PROFILE`. If it is unset and `ABG_PORT` is not the default
   port, use the `dev` profile. `prod`, `production`, and `default` resolve to the production
   profile.
2. Resolve platform state paths from `ABG_STATE_DIR` when set. Otherwise use the platform default
   state location.
3. Derive the socket path or pipe name from the resolved profile and platform.
4. On macOS, probe the standard state directory and app-group Unix sockets in order. If neither is
   reachable, read the owner-only `cli-endpoint.json` rendezvous file and connect to the
   token-authenticated loopback WebSocket.
5. Connect to the resolved endpoint. Scripts and agents should not pass an endpoint path, pipe name,
   port, or token.

## Platform choices

| OS | Selected IPC | Rationale | Alternatives considered |
| --- | --- | --- | --- |
| macOS | Unix domain socket, with an authenticated loopback WebSocket fallback | Unix sockets provide native filesystem-scoped IPC for normal installations. The fallback preserves CLI access when sandbox or path-length constraints prevent a usable socket. | An unauthenticated loopback port was rejected. The fallback is limited to `127.0.0.1`, requires a per-launch token, and is used only after socket probes fail. Temporary files do not provide request/response semantics. |
| Linux | Unix domain socket | Matches Linux service conventions, supports owner-scoped filesystem placement, and keeps parity with the macOS CLI contract. | TCP loopback has the same port and policy drawbacks as macOS. Abstract namespace sockets are Linux-only and make endpoint inspection and cleanup less obvious. |
| Windows | Named pipe | Native Windows local IPC, no port allocation, direct support in .NET, and a stable per-machine endpoint for the Windows CLI. | TCP loopback adds firewall and port concerns. Unix sockets are available on modern Windows but are less idiomatic for .NET desktop packaging and support. |

## Endpoint resolution

| OS | Production endpoint | Profiled endpoint | Override behavior |
| --- | --- | --- | --- |
| macOS | Probe `~/Library/Application Support/AgentBrowserGateway/gateway.sock`, then `~/Library/Group Containers/group.jp.co.arcm.abg/abg.sock`. Fall back to the endpoint file in the same two directories. | Profile the support directory and use `abg-<profile>.sock` plus `cli-endpoint-<profile>.json` in the app-group directory. | `ABG_STATE_DIR` pins socket and endpoint-file resolution to one state directory. `ABG_GROUP_DIR` replaces the app-group directory for development and tests. |
| Linux | `$XDG_RUNTIME_DIR/agent-browser-gateway/gateway.sock` when `XDG_RUNTIME_DIR` is set, otherwise `~/.local/state/AgentBrowserGateway/gateway.sock` | Use `agent-browser-gateway-<profile>` under `XDG_RUNTIME_DIR`, or `~/.local/state/AgentBrowserGateway-<profile>/gateway.sock` without it. | `ABG_STATE_DIR` replaces the state directory, then `gateway.sock` is appended. |
| Windows | `\\.\pipe\AgentBrowserGateway.Cli` | `\\.\pipe\AgentBrowserGateway.Cli.<profile>` | `ABG_STATE_DIR` affects files such as logs and settings, not the named pipe endpoint. |

The profile name is normalized to ASCII letters, digits, `.`, `_`, and `-`; unsupported characters
become `-`, and leading or trailing separators are removed. An empty normalized value falls back to
the production profile.

## Permissions

| OS | Permission model |
| --- | --- |
| macOS | Socket and rendezvous directories are mode `0700`, and the socket is chmodded `0700` after bind. The fallback endpoint file is mode `0600`, contains a random per-launch token and port, and the WebSocket accepts only loopback clients with an exact token and no browser `Origin` header. |
| Linux | The runtime or state directory must be owner-only with mode `0700`. The socket should be bound with owner-only access. If the platform implementation cannot chmod the socket itself, it must rely on a restrictive directory and process umask. |
| Windows | The named pipe is local-machine only. The production endpoint name is unprofiled, and profiled endpoints include only the normalized profile suffix. The Windows implementation should keep the pipe accessible to the current user session and should not expose a network pipe endpoint. |

The CLI does not broaden permissions. If the Gateway is not reachable or permission checks fail, the
CLI reports `gateway_not_running` or a transport I/O error through the normal error contract.

## Cleanup behavior

| OS | Startup cleanup | Runtime cleanup | Crash handling |
| --- | --- | --- | --- |
| macOS | Before binding, the Gateway removes the resolved stale socket. It rewrites each reachable `cli-endpoint` file with a new token and current port. | The socket and loopback listener are owned by the running Gateway process. Each CLI connection is short-lived. | A stale socket or endpoint file can remain after a crash; the next startup removes the socket and replaces the endpoint file. A stale token cannot authenticate to a later Gateway launch. |
| Linux | Before binding, the Gateway should remove any stale `gateway.sock` at the resolved path. | The socket file is owned by the running Gateway process. Normal process exit releases the listener. | A stale socket file can remain after a crash; the next Gateway startup must remove it before binding. |
| Windows | No filesystem socket cleanup is needed. The Gateway creates the named pipe listener when it starts. | Each client connection is short-lived. The server opens a fresh pipe instance for incoming CLI calls. | The pipe endpoint disappears when the Gateway process exits. A new Gateway process recreates the listener. |

## Implementation boundary

The platform shell owns endpoint creation and cleanup. The command protocol, request routing, error
shape, audit behavior, and CLI output remain platform-neutral. New commands must be added to the JSON
contract and runtime handling without requiring callers to know which OS-specific IPC transport is in
use.

## Extension channel transport decision

The extension ↔ Gateway channel stays on the loopback WebSocket (`/ws` with the extension-scheme
Origin allowlist) and does not migrate to Chrome Native Messaging, in whole or as a replacement
([#367](https://github.com/arcmanagement/agent-browser-gateway/issues/367)).

Native Messaging was rejected because it is structurally same-machine only and cannot carry the
remote-pairing direction ([#71](https://github.com/arcmanagement/agent-browser-gateway/issues/71)),
the sandboxed Mac App Store build cannot write the host manifest outside its container, Chrome owns
the host process lifecycle while the Gateway is a persistent resident process, and manifest
registration multiplies per-browser and per-OS installer complexity.

Revisit only if fixed-port conflicts on 8765 or non-MAS `network.server` concerns become concrete
problems. Local hardening of the shared listener is tracked through the token-authenticated `/cli`
route ([#366](https://github.com/arcmanagement/agent-browser-gateway/issues/366)) and the `/stream`
token gate ([#365](https://github.com/arcmanagement/agent-browser-gateway/issues/365)).
