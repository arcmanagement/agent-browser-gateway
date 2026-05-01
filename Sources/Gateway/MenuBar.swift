import SwiftUI
import AppKit
import GatewayCore

struct MenuBarView: View {
    @ObservedObject var coordinator: GatewayCoordinator

    var body: some View {
        // Status line
        Text(coordinator.statusMessage)
            .font(.caption)

        Divider()

        // Connections
        if coordinator.connectedExtensionIds.isEmpty {
            Text("No extension connected")
                .foregroundColor(.secondary)
        } else {
            let n = coordinator.connectedExtensionIds.count
            Text("\(n) extension\(n == 1 ? "" : "s") connected")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(coordinator.connectedExtensionIds, id: \.self) { id in
                let label = coordinator.extensionProfiles[id] ?? short(id)
                let browser = coordinator.extensionBrowsers[id] ?? "browser"
                Text("  • \(label) (\(browser))")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }

        Divider()

        // Shared tabs
        if coordinator.permittedTabs.isEmpty {
            Text("No shared tabs")
                .foregroundColor(.secondary)
        } else {
            let n = coordinator.permittedTabs.count
            Text("\(n) shared tab\(n == 1 ? "" : "s")")
                .font(.caption)
                .foregroundColor(.secondary)
            ForEach(coordinator.permittedTabs, id: \.tabId) { tab in
                // Click to copy tabId
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("\(tab.tabId)", forType: .string)
                } label: {
                    HStack(spacing: 4) {
                        Text("🔓")
                        Text("[\(tab.tabId)]")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.secondary)
                        Text(truncate(tab.title.isEmpty ? tab.url : tab.title, max: 40))
                            .font(.caption)
                    }
                }
                .help("Click to copy tabId \(tab.tabId)")
            }

            Button("Revoke all") {
                Task { @MainActor in
                    for tab in coordinator.permittedTabs {
                        for extId in coordinator.connectedExtensionIds {
                            _ = try? await coordinator.sendCommand(
                                to: extId,
                                method: "revoke",
                                params: AnyCodable(["tabId": tab.tabId])
                            )
                        }
                    }
                    coordinator.permittedTabs.removeAll()
                }
            }
            .help("Revoke every shared tab immediately")
        }

        Divider()

        // Audit and meta
        Button("Open audit log") {
            let url = URL(fileURLWithPath: ABGConstants.auditLogPath)
            NSWorkspace.shared.open(url)
        }

        Button("Open audit log folder") {
            NSWorkspace.shared.open(ABGConstants.logsDir)
        }

        Button("Copy abg socket path") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(ABGConstants.udsPath, forType: .string)
        }

        Divider()

        Text("ABG v\(appVersion()) — \(buildShortId())")
            .font(.caption2)
            .foregroundColor(.secondary)

        Button("Quit Gateway") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }

    private func short(_ s: String) -> String {
        guard s.count > 8 else { return s }
        return String(s.prefix(8))
    }

    private func truncate(_ s: String, max: Int) -> String {
        guard s.count > max else { return s }
        return String(s.prefix(max - 1)) + "…"
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    }

    private func buildShortId() -> String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "local"
    }
}
