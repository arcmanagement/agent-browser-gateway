import SwiftUI
import AppKit
import GatewayCore

struct MenuBarView: View {
    @ObservedObject var coordinator: GatewayCoordinator

    private let panelWidth: CGFloat = 390

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            statusStrip
            sharedTabsCard
            extensionsCard
            toolsCard
            footer
        }
        .padding(14)
        .frame(width: panelWidth)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .stroke(Color.white.opacity(0.28), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.24), radius: 28, x: 0, y: 18)
        )
    }

    private var header: some View {
        GlassCard(padding: 14) {
            HStack(spacing: 12) {
                GaugeBadge(
                    symbol: coordinator.permittedTabs.isEmpty ? "shield" : "shield.lefthalf.filled",
                    color: statusColor
                )

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text("Agent Browser Gateway")
                            .font(.system(size: 16, weight: .semibold))
                            .lineLimit(1)
                        profileBadge
                    }

                    Text(statusText)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }
        }
    }

    private var profileBadge: some View {
        Text(ABGConstants.runtimeProfileLabel.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundStyle(profileColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule(style: .continuous)
                    .fill(profileColor.opacity(0.13))
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(profileColor.opacity(0.26), lineWidth: 1)
                    )
            )
    }

    private var statusStrip: some View {
        HStack(spacing: 10) {
            CompactMetric(
                title: "Tabs",
                value: "\(coordinator.permittedTabs.count)",
                symbol: "rectangle.stack.badge.person.crop",
                color: coordinator.permittedTabs.isEmpty ? .secondary : .blue
            )
            CompactMetric(
                title: "Ext",
                value: "\(coordinator.connectedExtensionIds.count)",
                symbol: "puzzlepiece.extension",
                color: coordinator.connectedExtensionIds.isEmpty ? .secondary : .blue
            )
            CompactMetric(
                title: "Port",
                value: "\(ABGConstants.wsPort)",
                symbol: "network",
                color: ABGConstants.runtimeProfile == nil ? .secondary : .orange
            )
        }
    }

    private var sharedTabsCard: some View {
        GlassCard {
            CardTitle("Shared tabs", symbol: "rectangle.stack.badge.person.crop", count: coordinator.permittedTabs.count)

            if coordinator.permittedTabs.isEmpty {
                EmptyStateRow(symbol: "lock.circle", text: "No tabs are shared with this Gateway")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(coordinator.permittedTabs, id: \.tabId) { tab in
                            tabRow(tab)
                        }
                    }
                    .padding(.vertical, 1)
                }
                .frame(maxHeight: 270)

                Button(role: .destructive) {
                    revokeAll()
                } label: {
                    Label("Revoke all shared tabs", systemImage: "xmark.shield")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(GlassButtonStyle(tint: .red))
                .controlSize(.small)
                .help("Revoke every shared tab immediately")
            }
        }
    }

    private func tabRow(_ tab: PermittedTab) -> some View {
        HStack(spacing: 10) {
            VStack(spacing: 2) {
                Text("\(tab.tabId)")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Circle()
                    .fill(Color.blue)
                    .frame(width: 5, height: 5)
            }
            .frame(width: 42, height: 38)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color.blue.opacity(0.11))
                    .overlay(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .stroke(Color.blue.opacity(0.20), lineWidth: 1)
                    )
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(tabTitle(tab))
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)

                    Text(accessModeLabel(tab.accessMode))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(accessModeColor(tab.accessMode))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule(style: .continuous)
                                .fill(accessModeColor(tab.accessMode).opacity(0.12))
                        )
                }

                Text(tabHost(tab.url))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Button {
                copy("\(tab.tabId)")
            } label: {
                Image(systemName: "number")
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Copy tab id")
        }
        .padding(9)
        .background(glassRowBackground)
    }

    private var extensionsCard: some View {
        GlassCard {
            CardTitle("Extensions", symbol: "puzzlepiece.extension", count: coordinator.connectedExtensionIds.count)

            if coordinator.connectedExtensionIds.isEmpty {
                EmptyStateRow(symbol: "bolt.horizontal.circle", text: "No extension connected")
            } else {
                VStack(spacing: 7) {
                    ForEach(coordinator.connectedExtensionIds, id: \.self) { id in
                        extensionRow(id)
                    }
                }
            }
        }
    }

    private func extensionRow(_ id: String) -> some View {
        let label = coordinator.extensionProfiles[id] ?? short(id)
        let browser = coordinator.extensionBrowsers[id] ?? "browser"
        let version = coordinator.extensionVersions[id]
        let details = version.map { "\(browser) \($0)" } ?? browser

        return HStack(spacing: 10) {
            Circle()
                .fill(Color.green)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(details)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Button {
                copy(id)
            } label: {
                Image(systemName: "doc.on.doc")
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Copy extension id")
        }
        .padding(9)
        .background(glassRowBackground)
    }

    private var toolsCard: some View {
        GlassCard {
            HStack(spacing: 8) {
                ToolButton(title: "Audit", symbol: "doc.text.magnifyingglass") {
                    NSWorkspace.shared.open(URL(fileURLWithPath: ABGConstants.auditLogPath))
                }

                ToolButton(title: "Logs", symbol: "folder") {
                    NSWorkspace.shared.open(ABGConstants.logsDir)
                }

                ToolButton(title: "Socket", symbol: "point.3.connected.trianglepath.dotted") {
                    copy(ABGConstants.udsPath)
                }
            }

            Button(role: .destructive) {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit Gateway", systemImage: "power")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(GlassButtonStyle(tint: .red))
            .keyboardShortcut("q")
            .controlSize(.small)
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Text("v\(appVersion())")
            Text("multi-profile")
            Spacer(minLength: 0)
            Text("\(ABGConstants.wsHost):\(ABGConstants.wsPort)")
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 4)
        .lineLimit(1)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(.regularMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.24), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 4)
    }

    private var statusColor: Color {
        if !coordinator.permittedTabs.isEmpty { return .blue }
        if !coordinator.connectedExtensionIds.isEmpty { return .blue }
        return .secondary
    }

    private var profileColor: Color {
        ABGConstants.runtimeProfile == nil ? .secondary : .orange
    }

    private var statusText: String {
        "Local only - \(ABGConstants.wsHost):\(ABGConstants.wsPort)"
    }

    private func revokeAll() {
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

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func short(_ s: String) -> String {
        guard s.count > 8 else { return s }
        return String(s.prefix(8))
    }

    private func tabTitle(_ tab: PermittedTab) -> String {
        let value = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { return value }
        return tabHost(tab.url)
    }

    private func tabHost(_ url: String) -> String {
        guard let host = URL(string: url)?.host, !host.isEmpty else {
            return truncate(url, max: 44)
        }
        if host.hasPrefix("www.") {
            return String(host.dropFirst(4))
        }
        return host
    }

    private func accessModeLabel(_ value: String) -> String {
        switch value {
        case "all_tabs": return "all tabs"
        case "manual": return "per tab"
        default: return value.replacingOccurrences(of: "_", with: " ")
        }
    }

    private func accessModeColor(_ value: String) -> Color {
        value == "all_tabs" ? .orange : .secondary
    }

    private func truncate(_ s: String, max: Int) -> String {
        guard s.count > max else { return s }
        return String(s.prefix(max - 1)) + "..."
    }

    private func appVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    }
}

private struct GlassCard<Content: View>: View {
    let padding: CGFloat
    let content: Content

    init(padding: CGFloat = 12, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.thinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.30), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
        )
    }
}

private struct GaugeBadge: View {
    let symbol: String
    let color: Color

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.14))
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.32), lineWidth: 1)
                )
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(color)
        }
        .frame(width: 48, height: 48)
        .shadow(color: color.opacity(0.16), radius: 10, x: 0, y: 4)
    }
}

private struct CardTitle: View {
    let title: String
    let symbol: String
    let count: Int

    init(_ title: String, symbol: String, count: Int) {
        self.title = title
        self.symbol = symbol
        self.count = count
    }

    var body: some View {
        HStack(spacing: 7) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("\(count)")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.secondary.opacity(0.10))
                )
        }
    }
}

private struct CompactMetric: View {
    let title: String
    let value: String
    let symbol: String
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 1) {
                Text(value)
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .stroke(Color.white.opacity(0.25), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.10), radius: 12, x: 0, y: 7)
        )
    }
}

private struct EmptyStateRow: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 20)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.secondary.opacity(0.07))
        )
    }
}

private struct ToolButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(GlassButtonStyle(tint: .blue))
        .controlSize(.small)
    }
}

private struct GlassButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(configuration.isPressed ? tint.opacity(0.18) : tint.opacity(0.10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(tint.opacity(0.22), lineWidth: 1)
                    )
            )
    }
}
