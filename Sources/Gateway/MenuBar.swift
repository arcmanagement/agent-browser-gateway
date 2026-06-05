import SwiftUI
import AppKit
import GatewayCore

struct MenuBarView: View {
    @ObservedObject var coordinator: GatewayCoordinator

    private let panelWidth: CGFloat = 380

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            metrics
            connectionSection
            sharedTabsSection
            actions
            footer
        }
        .padding(16)
        .frame(width: panelWidth)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(statusColor.opacity(0.14))
                Image(systemName: coordinator.permittedTabs.isEmpty ? "shield" : "shield.lefthalf.filled")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(statusColor)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("Agent Browser Gateway")
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                    profileBadge
                }

                Text(coordinator.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
    }

    private var profileBadge: some View {
        Text(ABGConstants.runtimeProfileLabel)
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(profileColor)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                Capsule(style: .continuous)
                    .fill(profileColor.opacity(0.12))
            )
    }

    private var metrics: some View {
        HStack(spacing: 8) {
            MetricTile(
                title: "Extensions",
                value: "\(coordinator.connectedExtensionIds.count)",
                symbol: "puzzlepiece.extension",
                color: coordinator.connectedExtensionIds.isEmpty ? .secondary : .blue
            )
            MetricTile(
                title: "Shared Tabs",
                value: "\(coordinator.permittedTabs.count)",
                symbol: "rectangle.stack.badge.person.crop",
                color: coordinator.permittedTabs.isEmpty ? .secondary : .green
            )
            MetricTile(
                title: "Port",
                value: "\(ABGConstants.wsPort)",
                symbol: "network",
                color: ABGConstants.runtimeProfile == nil ? .secondary : .orange
            )
        }
    }

    private var connectionSection: some View {
        SectionBlock(title: "Extensions", symbol: "puzzlepiece.extension") {
            if coordinator.connectedExtensionIds.isEmpty {
                EmptyStateRow(symbol: "bolt.horizontal.circle", text: "No extension connected")
            } else {
                VStack(spacing: 6) {
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
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Text(details)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Button {
                copy(id)
            } label: {
                Image(systemName: "doc.on.doc")
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .help("Copy extension id")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(rowBackground)
    }

    private var sharedTabsSection: some View {
        SectionBlock(title: "Shared Tabs", symbol: "rectangle.stack.badge.person.crop") {
            if coordinator.permittedTabs.isEmpty {
                EmptyStateRow(symbol: "lock.circle", text: "No shared tabs")
            } else {
                VStack(spacing: 8) {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(coordinator.permittedTabs, id: \.tabId) { tab in
                                tabRow(tab)
                            }
                        }
                    }
                    .frame(maxHeight: 260)

                    Button(role: .destructive) {
                        revokeAll()
                    } label: {
                        Label("Revoke all", systemImage: "xmark.shield")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help("Revoke every shared tab immediately")
                }
            }
        }
    }

    private func tabRow(_ tab: PermittedTab) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.green.opacity(0.12))
                Text("\(tab.tabId)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(.green)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
            .frame(width: 38, height: 30)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(tabTitle(tab))
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)

                    Text(accessModeLabel(tab.accessMode))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(accessModeColor(tab.accessMode))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule(style: .continuous)
                                .fill(accessModeColor(tab.accessMode).opacity(0.12))
                        )
                }

                Text(tabHost(tab.url))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Button {
                copy("\(tab.tabId)")
            } label: {
                Image(systemName: "number")
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .help("Copy tab id")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(rowBackground)
    }

    private var actions: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                PanelActionButton(title: "Audit", symbol: "doc.text.magnifyingglass") {
                    NSWorkspace.shared.open(URL(fileURLWithPath: ABGConstants.auditLogPath))
                }

                PanelActionButton(title: "Logs", symbol: "folder") {
                    NSWorkspace.shared.open(ABGConstants.logsDir)
                }

                PanelActionButton(title: "Socket", symbol: "point.3.connected.trianglepath.dotted") {
                    copy(ABGConstants.udsPath)
                }
            }

            Button(role: .destructive) {
                NSApplication.shared.terminate(nil)
            } label: {
                Label("Quit Gateway", systemImage: "power")
                    .frame(maxWidth: .infinity)
            }
            .keyboardShortcut("q")
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Text("v\(appVersion())")
            Text("•")
            Text(buildShortId())
            Text("•")
            Text(ABGConstants.runtimeProfileLabel)
            Spacer(minLength: 0)
            Text(ABGConstants.wsHost)
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .lineLimit(1)
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color.secondary.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.secondary.opacity(0.12), lineWidth: 1)
            )
    }

    private var statusColor: Color {
        if !coordinator.permittedTabs.isEmpty { return .green }
        if !coordinator.connectedExtensionIds.isEmpty { return .blue }
        return .secondary
    }

    private var profileColor: Color {
        ABGConstants.runtimeProfile == nil ? .secondary : .orange
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

    private func buildShortId() -> String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "local"
    }
}

private struct SectionBlock<Content: View>: View {
    let title: String
    let symbol: String
    let content: Content

    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)

            content
        }
    }
}

private struct MetricTile: View {
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
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(color.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(color.opacity(0.14), lineWidth: 1)
                )
        )
    }
}

private struct EmptyStateRow: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
                .frame(width: 18)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.06))
        )
    }
}

private struct PanelActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}
