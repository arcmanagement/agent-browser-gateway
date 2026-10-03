import SwiftUI
import GatewayCore

/// The Gateway window: a native sidebar (Overview, Shared Tabs, Audit, Plugins, Settings)
/// and one detail view per section.
struct GatewayWindowView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    @Bindable var router: GatewayWindowRouter

    @State private var audit = AuditStore()
    @State private var plugins: PluginsModel
    @State private var settings = SettingsModel()
    @AppStorage(WindowAppearance.storageKey) private var appearance = WindowAppearance.system.rawValue

    init(coordinator: GatewayCoordinator, router: GatewayWindowRouter) {
        self.coordinator = coordinator
        self.router = router
        _plugins = State(initialValue: PluginsModel(coordinator: coordinator))
    }

    var body: some View {
        NavigationSplitView {
            GatewaySidebar(
                selection: $router.section,
                state: gateState,
                sharedCount: coordinator.permittedTabs.count,
                pluginCount: coordinator.pluginSummaries.filter(\.isLoaded).count
            )
            .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
        } detail: {
            detail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(GateColor.canvas)
        }
        .frame(minWidth: 880, minHeight: 580)
        .preferredColorScheme(WindowAppearance(rawValue: appearance)?.colorScheme)
        .task {
            audit.reload()
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch router.section {
        case .overview:
            OverviewView(coordinator: coordinator, audit: audit, state: gateState) { router.section = $0 }
        case .sharedTabs:
            SharedTabsView(coordinator: coordinator)
        case .audit:
            AuditView(store: audit)
        case .plugins:
            PluginsView(coordinator: coordinator, model: plugins)
        case .settings:
            GatewaySettingsView(model: settings, appearance: $appearance)
        }
    }

    private var gateState: GateState {
        GateState(
            permittedTabs: coordinator.permittedTabs,
            connectedExtensionCount: coordinator.connectedExtensionIds.count,
            statusMessage: coordinator.statusMessage
        )
    }
}
