import SwiftUI
import GatewayCore

/// One shared tab, styled like a system menu row (Sound > Output): site icon with a
/// live dot, title, and a secondary line. Revoke appears on hover and is always offered
/// to VoiceOver as a row action. Tabs from all-tabs mode show an amber tag instead, as in
/// the extension popup.
struct MenuBarTabRow: View {
    static let height: CGFloat = 44

    var tab: PermittedTab
    var isRevoking: Bool
    var revoke: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            SiteIcon(tab: tab)

            VStack(alignment: .leading, spacing: 1) {
                Text(tab.displayTitle)
                    .font(.body)
                    .lineLimit(1)
                    .truncationMode(.tail)
                subtitle
            }

            Spacer(minLength: 6)

            trailing
        }
        .padding(.horizontal, 9)
        .frame(height: Self.height)
        .background {
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color.primary.opacity(0.08) : .clear)
        }
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
        .help(tab.url)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityActions {
            if !tab.isAllTabsShare {
                Button("Revoke access", action: revoke)
            }
        }
    }

    private var subtitle: some View {
        HStack(spacing: 4) {
            Text(verbatim: tab.displayHost)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(verbatim: "·").accessibilityHidden(true)
            Text(verbatim: "\(tab.tabId)")
                .monospaced()
                .fixedSize()
            Text(verbatim: "·").accessibilityHidden(true)
            if tab.isAllTabsShare {
                Text("all tabs")
                    .foregroundStyle(GateColor.warningText)
                    .fixedSize()
            } else {
                Text("per tab")
                    .fixedSize()
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var trailing: some View {
        if isRevoking {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Revoking")
        } else if isHovered && !tab.isAllTabsShare {
            Button("Revoke", action: revoke)
                .buttonStyle(RevokeButtonStyle())
                .help("Revoke access to this tab now")
                .transition(.opacity)
        }
    }

    private var accessibilityLabel: String {
        let mode = tab.isAllTabsShare ? "shared by all-tabs mode" : "shared"
        return "\(tab.displayTitle), \(tab.displayHost), tab \(tab.tabId), \(mode)"
    }
}
