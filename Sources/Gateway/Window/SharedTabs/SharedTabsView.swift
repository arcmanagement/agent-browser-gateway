import SwiftUI
import GatewayCore

/// Every tab agents can reach, grouped by browser profile, each with Revoke.
struct SharedTabsView: View {
    @ObservedObject var coordinator: GatewayCoordinator

    @State private var revoking: Set<String> = []

    var body: some View {
        Group {
            if coordinator.permittedTabs.isEmpty {
                SharedTabsEmptyState(hasBrowser: !coordinator.connectedExtensionIds.isEmpty)
            } else {
                List {
                    ForEach(groups, id: \.extensionId) { group in
                        Section {
                            ForEach(group.tabs, id: \.revocationKey) { tab in
                                SharedTabRow(
                                    tab: tab,
                                    isRevoking: revoking.contains(tab.revocationKey)
                                ) {
                                    revoke(tab)
                                }
                            }
                        } header: {
                            SharedTabsGroupHeader(
                                label: MenuBarView.extensionLabel(
                                    id: group.extensionId,
                                    profile: coordinator.extensionProfiles[group.extensionId],
                                    browser: coordinator.extensionBrowsers[group.extensionId]
                                ),
                                browser: coordinator.extensionBrowsers[group.extensionId],
                                version: coordinator.extensionVersions[group.extensionId],
                                extensionId: group.extensionId,
                                isConnected: coordinator.connectedExtensionIds.contains(group.extensionId),
                                hasAllTabsShares: group.tabs.contains(where: \.isAllTabsShare)
                            )
                        }
                    }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
            }
        }
        .navigationTitle("Shared Tabs")
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Revoke All", systemImage: "xmark.circle", role: .destructive, action: revokeAll)
                    .labelStyle(.titleAndIcon)
                    .disabled(revocableTabs.isEmpty)
                    .help("Revoke every per-tab share now. Tabs shared by all-tabs mode are turned off in that profile's ABG popup.")
            }
        }
    }

    private var subtitle: String {
        coordinator.permittedTabs.isEmpty ? "Nothing shared" : "\(GateText.tabs(coordinator.permittedTabs.count)) open to agents"
    }

    private var groups: [(extensionId: String, tabs: [PermittedTab])] {
        var order: [String] = []
        var byExtension: [String: [PermittedTab]] = [:]
        for tab in coordinator.permittedTabs {
            if byExtension[tab.extensionId] == nil { order.append(tab.extensionId) }
            byExtension[tab.extensionId, default: []].append(tab)
        }
        return order.map { ($0, byExtension[$0] ?? []) }
    }

    private var revocableTabs: [PermittedTab] {
        coordinator.permittedTabs.filter { !$0.isAllTabsShare }
    }

    private func revoke(_ tab: PermittedTab) {
        revoking.insert(tab.revocationKey)
        Task {
            await coordinator.revokeSharedTab(tab)
            revoking.remove(tab.revocationKey)
        }
    }

    private func revokeAll() {
        let tabs = revocableTabs
        revoking.formUnion(tabs.map(\.revocationKey))
        Task {
            await coordinator.revokeAllSharedTabs(tabs)
            revoking.subtract(tabs.map(\.revocationKey))
        }
    }
}
