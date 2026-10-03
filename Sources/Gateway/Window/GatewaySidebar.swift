import SwiftUI
import GatewayCore

/// Native source-list sidebar. Counts ride on standard list badges; the footer keeps the
/// live gate state, endpoint, and profile in view from every section.
struct GatewaySidebar: View {
    @Binding var selection: GatewaySection
    var state: GateState
    var sharedCount: Int
    var pluginCount: Int

    var body: some View {
        List(selection: selectionBinding) {
            Section("Gateway") {
                row(.overview)
                row(.sharedTabs, badge: sharedCount)
                row(.audit)
            }
            Section("Configure") {
                row(.plugins, badge: pluginCount)
                row(.settings)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SidebarStatusFooter(state: state)
        }
    }

    // The tag must be the outermost modifier: a badge applied after it hides the tag from
    // List selection, and the row stops responding to clicks.
    private func row(_ section: GatewaySection, badge: Int = 0) -> some View {
        Label(section.title, systemImage: section.systemImage)
            .badge(badge)
            .tag(section)
    }

    /// The sidebar always has a selection; clicking empty space must not clear it.
    private var selectionBinding: Binding<GatewaySection?> {
        Binding(
            get: { selection },
            set: { if let value = $0 { selection = value } }
        )
    }
}

private struct SidebarStatusFooter: View {
    var state: GateState

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space1) {
            HStack(spacing: GateMetrics.space2) {
                GateMark(mode: GateMark.Mode(state))
                    .frame(width: 18, height: 18)
                Text(statusText)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(tone.text)
                    .lineLimit(1)
            }
            Text(verbatim: "\(GateText.endpoint) · \(ABGConstants.runtimeProfileLabel) · v\(GateText.appVersion)")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, GateMetrics.space4)
        .padding(.vertical, GateMetrics.space3)
        .accessibilityElement(children: .combine)
    }

    private var statusText: String {
        switch state {
        case .attention: return "Needs attention"
        case .noBrowser: return "Waiting for a browser"
        case .closed: return "Gate closed"
        case .open(let shared, _): return "\(GateText.tabs(shared)) shared"
        }
    }

    private var tone: GateTone {
        switch state {
        case .attention: return .danger
        case .open(let shared, let allTabs): return allTabs == shared ? .warning : .signal
        default: return .neutral
        }
    }
}
