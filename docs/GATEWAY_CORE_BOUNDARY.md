# Gateway core and OS-specific shell boundary

The current Swift Gateway target is split into two layers:

| Layer | Files | Responsibility |
|---|---|---|
| Runtime boundary | `GatewayRuntime.swift`, `Coordinator.swift`, `WSServer.swift`, `UDSServer.swift`, `AuditLog.swift`, `PluginHost.swift` | Local protocol handling, extension state, CLI dispatch, audit logging, plugin execution, and loopback transports. |
| macOS shell | `App.swift`, `MenuBar.swift`, `GatewayWindowView.swift` | SwiftUI/AppKit lifecycle, menu bar item, dashboard window, Finder/pasteboard actions, and visual presentation. |

`GatewayRuntime` is the transport-facing protocol. `WSServer` and `UDSServer` depend on that protocol
instead of the macOS `GatewayCoordinator` concrete type, so a future Windows/Linux shell can provide a
different runtime implementation or wrap the same runtime behavior without changing the transports.

The desktop OS expansion model is documented in
[DESKTOP_OS_EXPANSION.md](DESKTOP_OS_EXPANSION.md). That document keeps Windows and Linux execution
models separate and states the packaging, startup, logs, IPC, and security assumptions for each OS.

## macOS-specific APIs

Keep these APIs in the shell layer:

- `NSApplication`, `NSStatusItem`, `NSPopover`, `NSWindowController`
- `NSWorkspace` file reveal/open actions
- `NSPasteboard` copy actions
- SwiftUI views and visual state

The runtime layer can use Foundation, Vapor/NIO transport primitives, `GatewayCore`, and local
filesystem paths from `ABGConstants`, but should not import AppKit or SwiftUI.

## Porting notes

- A non-macOS shell should start the runtime, expose status, and provide UI/tray equivalents outside
  `GatewayCoordinator`.
- Loopback WS/UDS transports should continue to speak through `GatewayRuntime`.
- Platform-specific installer/tray/status work should not add AppKit or SwiftUI dependencies to the
  runtime boundary.
- Windows shell work should stay in the WinUI/tray, installer, named-pipe, and Windows path layers.
- Linux shell work should stay CLI/headless-first, with optional systemd user-service integration and
  no required desktop UI.
