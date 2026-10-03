import SwiftUI
import GatewayCore

/// One shared tab, styled like a system menu row (Sound > Output): site icon with a live
/// dot, title, and a secondary line. Clicking the row copies the numeric tab ID (the same
/// value as the extension's ⌥⇧C shortcut) and confirms it in the secondary line. Revoke
/// appears on hover as a separate control, and both actions are offered to VoiceOver.
/// Tabs from all-tabs mode show an amber tag instead, as in the extension popup.
struct MenuBarTabRow: View {
    static let height: CGFloat = 44
    static let copyHint = "Click to copy tab ID"
    static let copiedFeedbackDuration: Duration = .seconds(1.5)

    var tab: PermittedTab
    var isRevoking: Bool
    var revoke: () -> Void
    var copyTabId: (String) -> Void = Pasteboard.copy

    @State private var isHovered = false
    @State private var copyCount = 0
    @State private var showsCopied = false

    var body: some View {
        HStack(spacing: 6) {
            // The copy target is a sibling of Revoke, so clicking Revoke never also copies.
            Button(action: copy) {
                HStack(spacing: 10) {
                    SiteIcon(tab: tab)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(tab.displayTitle)
                            .font(.body)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        subtitle
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onKeyPress(.return) {
                copy()
                return .handled
            }
            .help("\(tab.url)\n\(Self.copyHint)")

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
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(Self.copyHint)
        .accessibilityAction { copy() }
        .accessibilityActions {
            Button("Copy tab ID", action: copy)
            if !tab.isAllTabsShare {
                Button("Revoke access", action: revoke)
            }
        }
        .task(id: copyCount) {
            guard copyCount > 0 else { return }
            try? await Task.sleep(for: Self.copiedFeedbackDuration)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { showsCopied = false }
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        if showsCopied {
            Label {
                Text(verbatim: Self.copiedMessage(tabId: tab.tabId))
            } icon: {
                Image(systemName: "checkmark")
            }
            .labelStyle(CopiedLabelStyle())
            .font(.caption)
            .foregroundStyle(GateColor.signalText)
            .lineLimit(1)
            .transition(.opacity)
        } else {
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
            .transition(.opacity)
        }
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

    static func copiedMessage(tabId: Int) -> String {
        "Copied tab ID \(tabId)"
    }

    private func copy() {
        copyTabId("\(tab.tabId)")
        withAnimation(.easeOut(duration: 0.15)) { showsCopied = true }
        copyCount += 1
        AccessibilityNotification.Announcement(Self.copiedMessage(tabId: tab.tabId)).post()
    }
}

/// Checkmark and text on one baseline, tighter than the default label spacing.
private struct CopiedLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon
                .imageScale(.small)
                .fontWeight(.semibold)
            configuration.title
        }
    }
}
