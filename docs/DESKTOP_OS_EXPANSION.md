# Desktop OS expansion model

ABG's desktop OS expansion keeps the Gateway core platform-independent while each operating system
owns its native shell, packaging, startup, logs, IPC binding, and security integration. This document
tracks the Windows and Linux execution models separately so the Linux plan does not inherit desktop UI
requirements from the Windows plan.

## Shared Gateway core boundary

The shared Gateway core owns behavior that must stay consistent across desktop operating systems:

- Browser extension protocol over loopback WebSocket.
- Connected extension state, shared tab state, command dispatch, and approval decisions.
- CLI command semantics and machine-readable JSON output.
- Audit event schema and plugin command execution rules.
- Local-only networking, no ABG-operated cloud relay, and no telemetry.

OS-specific shells own the process lifecycle, native status surfaces, install and update mechanics,
local IPC endpoint type, log locations, and user-visible security prompts. A shell may wrap the
shared runtime or reimplement platform bindings, but it should not fork the extension protocol, CLI
contract, audit schema, or consent model.

## Windows execution model

Windows is a native desktop target. The Gateway runs as a user-scoped tray application with WinUI 3
setup and status surfaces around the shared Gateway behavior.

| Area | Assumption |
|---|---|
| Packaging | Produce signed `agent-browser-gateway-<version>-windows-x64.zip` and `agent-browser-gateway-<version>-windows-x64-setup.zip` artifacts on `windows-latest`. The setup ZIP is the normal user-facing package and is the source for WinGet manifests. |
| Startup | The tray Gateway starts from the installer and can opt into launch at sign in through `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. ABG does not install a Windows service or machine-wide scheduled task for the desktop app. |
| Logs and state | Audit logs live under `%LOCALAPPDATA%\AgentBrowserGateway\Logs\audit.jsonl`. User plugins and config live under `%USERPROFILE%\.abg\` by default, with `%USERPROFILE%\.abg-dev\` reserved for development runs. |
| IPC | Browser extensions connect to the Gateway over loopback WebSocket. The Windows CLI talks to the local Gateway through a user-scoped named pipe rather than a Unix domain socket. |
| Security | The Gateway binds only to loopback, keeps per-tab consent and operation approval semantics, signs release executables for distribution, and treats SmartScreen reputation as a Windows distribution concern. Install, update, and startup registration are user scoped. |

The Windows shell owns:

- WinUI 3 setup and status windows.
- Notification-area tray lifecycle and menu commands.
- Windows installer, Add/Remove Programs registration, WinGet publication, Authenticode signing, and
  SmartScreen-facing release flow.
- Windows path conventions and named-pipe IPC binding.

The Windows shell must not own the extension protocol, cross-platform CLI output contract, approval
policy semantics, or audit event schema.

## Linux execution model

Linux is CLI/headless-first. The initial target is a Gateway service controlled by the CLI and, when
available, an optional systemd user service. A Linux desktop UI is not part of the committed plan
unless real demand appears.

| Area | Assumption |
|---|---|
| Packaging | Start with a distribution-neutral `agent-browser-gateway-X.Y.Z-linux-x64.tar.gz` artifact. Add `.deb` or `.rpm` packages later only when user demand justifies distribution-specific packaging. |
| Startup | The CLI exposes `abg gateway start`, `abg gateway status`, and `abg gateway stop`. A bundled systemd user-service template may provide login-session startup on systems that use systemd. |
| Logs and state | Follow XDG-style user paths: `~/.config/agent-browser-gateway/` for config and `~/.local/state/agent-browser-gateway/` for runtime state, service metadata, and audit logs. |
| IPC | Browser extensions connect over loopback WebSocket. The Linux CLI should use a user-scoped Unix domain socket under the runtime state directory. |
| Security | The Gateway remains local-only, user-scoped, and telemetry-free. The headless target avoids desktop portal, tray, or notification dependencies in the first release. Service files and sockets should be owned by the user and should not require root or system-wide daemon installation. |

The Linux shell owns:

- CLI lifecycle commands for starting, stopping, and inspecting the Gateway process.
- Optional systemd user service integration.
- Tarball install and uninstall layout, plus future distribution package metadata.
- Linux path conventions and Unix domain socket binding.

The Linux shell must not introduce a required desktop UI, tray dependency, system service, or
machine-wide install requirement for the initial target.

## Non-overlap checks

- Windows UI work belongs to WinUI and tray surfaces; Linux starts headless and should not inherit
  that UI plan.
- Windows package-manager work targets WinGet; Linux starts with a tarball and may add `.deb` or
  `.rpm` later.
- Windows startup is the current user's Run key; Linux startup is explicit CLI lifecycle plus optional
  systemd user service.
- Windows IPC uses named pipes; Linux IPC uses Unix domain sockets.
- Both targets share the extension protocol, CLI command behavior, audit semantics, consent model,
  loopback-only networking, and no-telemetry policy.
