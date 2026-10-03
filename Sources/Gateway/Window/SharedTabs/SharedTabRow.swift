import SwiftUI
import GatewayCore

struct SharedTabRow: View {
    var tab: PermittedTab
    var isRevoking: Bool
    var revoke: () -> Void

    var body: some View {
        HStack(spacing: GateMetrics.space3) {
            SiteIcon(tab: tab, size: 30)

            VStack(alignment: .leading, spacing: 2) {
                Text(tab.displayTitle)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                Text(verbatim: tab.url)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: GateMetrics.space1) {
                    Text(verbatim: "tab \(tab.tabId)")
                        .font(.callout.monospaced())
                    CopyButton(label: "Copy tab ID", value: "\(tab.tabId)")
                }
                timing
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Group {
                if tab.isAllTabsShare {
                    GateBadge(text: "all tabs", tone: .warning)
                        .help("Shared by all-tabs mode. Turn it off in this profile's ABG popup.")
                } else if isRevoking {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Revoking")
                } else {
                    Button("Revoke", action: revoke)
                        .buttonStyle(RevokeButtonStyle())
                        .accessibilityLabel("Revoke access to tab \(tab.tabId): \(tab.displayTitle)")
                        .help("Revoke access to this tab now")
                }
            }
            .frame(width: 76, alignment: .trailing)
        }
        .padding(.vertical, GateMetrics.space1)
        .accessibilityElement(children: .contain)
    }

    /// "Shared 48 minutes ago" / "Expires in 41 minutes", refreshed every 30 seconds.
    private var timing: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            if let expiresAt = tab.expiresAt {
                Text("Expires \(expiresAt.formatted(.relative(presentation: .named)))")
            } else {
                Text("Shared \(tab.permittedAt.formatted(.relative(presentation: .named)))")
            }
        }
    }
}

struct SharedTabsGroupHeader: View {
    var label: String
    var browser: String?
    var version: String?
    var extensionId: String
    var isConnected: Bool
    var hasAllTabsShares: Bool

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            SignalDot(tone: isConnected ? .signal : .neutral, size: 6)
            Text(label)
                .font(.headline)
                .foregroundStyle(.primary)
            Text(verbatim: details)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            if hasAllTabsShares {
                GateBadge(text: "sandbox · all tabs", tone: .warning)
            }
            Spacer()
            CopyButton(label: "Copy extension ID", value: extensionId)
        }
        .padding(.top, GateMetrics.space2)
    }

    private var details: String {
        var parts = [BrowserProfileRow.browserName(browser)]
        if let version, !version.isEmpty { parts.append(version) }
        parts.append(String(extensionId.prefix(8)))
        if !isConnected { parts.append("suspended") }
        return parts.joined(separator: " · ")
    }
}
