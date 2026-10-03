import SwiftUI
import GatewayCore

/// The Overview's lead card: the answer in one sentence, the gate itself, and the tab
/// strip of what is lit.
struct GateHeroView: View {
    var state: GateState
    var tabs: [PermittedTab]
    var showSharedTabs: () -> Void

    private static let maxChips = 6

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space5) {
            VStack(alignment: .leading, spacing: GateMetrics.space2) {
                SectionLabel(title: "Right now")
                Text(state.headline)
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(tone == .neutral ? AnyShapeStyle(.primary) : tone.text)
                    .contentTransition(.opacity)
                Text(state.detail(endpoint: GateText.endpoint))
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 560, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)

            GateRailView(mode: GateMark.Mode(state))
                .padding(.horizontal, GateMetrics.space2)

            if !tabs.isEmpty {
                FlowLayout(spacing: GateMetrics.space2) {
                    ForEach(tabs.prefix(Self.maxChips), id: \.revocationKey) { tab in
                        SharedTabChip(tab: tab)
                    }
                    Button(tabs.count > Self.maxChips ? "+\(tabs.count - Self.maxChips) more" : "Manage shared tabs", action: showSharedTabs)
                        .buttonStyle(.link)
                        .padding(.vertical, 6)
                }
            }
        }
        .gateCard(padding: GateMetrics.space6, tint: tone == .neutral ? nil : tone)
    }

    private var tone: GateTone {
        switch state {
        case .attention: return .danger
        case .open(let shared, let allTabs): return allTabs == shared ? .warning : .signal
        case .noBrowser, .closed: return .neutral
        }
    }
}

/// A lit browser tab in the strip: the brief's tab-chip motif.
struct SharedTabChip: View {
    var tab: PermittedTab

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            SignalDot(tone: tone, size: 6)
            Text(tab.displayTitle)
                .lineLimit(1)
                .frame(maxWidth: 200, alignment: .leading)
            Text(verbatim: "\(tab.tabId)")
                .font(.callout.monospaced())
                .foregroundStyle(.secondary)
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: GateMetrics.radiusControl, topTrailingRadius: GateMetrics.radiusControl)
                .fill(tone.fill.opacity(0.07))
                .overlay {
                    UnevenRoundedRectangle(topLeadingRadius: GateMetrics.radiusControl, topTrailingRadius: GateMetrics.radiusControl)
                        .strokeBorder(tone.fill.opacity(0.4), lineWidth: 1)
                }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Shared: \(tab.displayTitle), tab \(tab.tabId)\(tab.isAllTabsShare ? ", all-tabs mode" : "")")
    }

    private var tone: GateTone {
        tab.isAllTabsShare ? .warning : .signal
    }
}
