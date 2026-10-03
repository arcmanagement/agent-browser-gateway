import SwiftUI
import GatewayCore

/// Overview: answers "what can agents see right now?" first, then shows the instruments
/// behind that answer and the latest audit evidence.
struct OverviewView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    var audit: AuditStore
    var state: GateState
    var navigate: (GatewaySection) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: GateMetrics.space5) {
                GateHeroView(
                    state: state,
                    tabs: coordinator.permittedTabs,
                    showSharedTabs: { navigate(.sharedTabs) }
                )

                instruments

                HStack(alignment: .top, spacing: GateMetrics.space5) {
                    RecentActivityView(store: audit) { navigate(.audit) }
                        .frame(maxWidth: .infinity)
                    CLIQuickStartView()
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(GateMetrics.space6)
            .frame(maxWidth: GateMetrics.contentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Overview")
        .navigationSubtitle(state.headline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Copy “\(GateText.cli("status"))”", systemImage: "terminal") {
                    Pasteboard.copy(GateText.cli("status"))
                }
                .help("Copy the command that prints this Gateway's state")
            }
        }
    }

    private var instruments: some View {
        HStack(alignment: .top, spacing: GateMetrics.space3) {
            InstrumentTile(
                title: "Browsers",
                value: coordinator.connectedExtensionIds.isEmpty ? "None" : "\(coordinator.connectedExtensionIds.count) connected",
                tone: coordinator.connectedExtensionIds.isEmpty ? .neutral : .signal,
                detail: browsersDetail
            )
            InstrumentTile(
                title: "CLI transport",
                value: coordinator.cliSocketActive ? "Unix socket" : "Loopback WebSocket",
                tone: .neutral,
                detail: coordinator.cliSocketActive
                    ? "Owner-only local socket. abg finds it on its own."
                    : "Socket unavailable; abg uses the token-protected WebSocket on \(GateText.endpoint)."
            )
            InstrumentTile(
                title: "Gateway",
                value: GateText.endpoint,
                tone: .neutral,
                detail: "Loopback only, profile \(ABGConstants.runtimeProfileLabel). No telemetry.",
                monospacedValue: true
            )
        }
    }

    private var browsersDetail: String {
        let labels = coordinator.connectedExtensionIds.map { id -> String in
            let label = coordinator.extensionProfiles[id].flatMap { $0.isEmpty ? nil : $0 } ?? "Profile \(id.prefix(8))"
            return "\(label) (\(BrowserProfileRow.browserName(coordinator.extensionBrowsers[id])))"
        }
        return labels.isEmpty ? "Install the ABG extension in Chrome." : labels.joined(separator: ", ")
    }
}
