import SwiftUI
import AppKit
import GatewayCore

/// The status item popover, modeled on macOS system menus (Sound, Wi-Fi): only shared tabs
/// and connected extensions, a switcher per extension, quiet section headers, and a plain
/// footer. Everything else lives in the Gateway window.
struct MenuBarView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    var openWindow: () -> Void = {}

    /// `nil` shows every extension's tabs ("All").
    @State private var selectedExtension: String?
    @State private var revoking: Set<String> = []

    init(coordinator: GatewayCoordinator, selectedExtension: String? = nil, openWindow: @escaping () -> Void = {}) {
        self.coordinator = coordinator
        self.openWindow = openWindow
        _selectedExtension = State(initialValue: selectedExtension)
    }

    static let width: CGFloat = 340
    static let maxVisibleRows = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Agent Browser Gateway")
                .font(.headline)
                .padding(.horizontal, MenuMetrics.inset)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)

            if coordinator.connectedExtensionIds.isEmpty && coordinator.permittedTabs.isEmpty {
                MenuSeparator()
                MenuEmptyNote(
                    title: "No browser connected",
                    detail: "Open Chrome with the ABG extension. It connects to \(GateText.endpoint)."
                )
            } else {
                if !extensionOptions.isEmpty {
                    ExtensionSwitcher(
                        options: extensionOptions,
                        selection: $selectedExtension
                    )
                    .padding(.horizontal, MenuMetrics.inset - 4)
                    .padding(.bottom, 8)
                }

                if let selectedExtension {
                    ExtensionInfoRow(
                        extensionId: selectedExtension,
                        browser: coordinator.extensionBrowsers[selectedExtension],
                        version: coordinator.extensionVersions[selectedExtension]
                    )
                    .padding(.horizontal, MenuMetrics.inset)
                    .padding(.bottom, 6)
                }

                MenuSeparator()
                sharedTabs
            }

            MenuSeparator()

            VStack(spacing: 0) {
                MenuActionRow(title: "Open Agent Browser Gateway…", action: openWindow)
                    .keyboardShortcut("o")
                MenuActionRow(title: "Quit Gateway") {
                    NSApplication.shared.terminate(nil)
                }
                .keyboardShortcut("q")
            }
            .padding(.horizontal, MenuMetrics.rowGutter)

            Text(verbatim: "Local only · \(GateText.endpoint)\(profileSuffix)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, MenuMetrics.inset)
                .padding(.top, 4)
                .padding(.bottom, 10)
        }
        .frame(width: Self.width)
        .onChange(of: coordinator.connectedExtensionIds) { _, ids in
            if let selectedExtension, !ids.contains(selectedExtension) {
                self.selectedExtension = nil
            }
        }
    }

    // MARK: - Shared tabs

    private var sharedTabs: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text("Shared Tabs")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if revocableTabs.count > 1 {
                    Button("Revoke All", action: revokeAll)
                        .buttonStyle(.borderless)
                        .font(.subheadline)
                        .foregroundStyle(GateColor.dangerText)
                        .help("Revoke access to every per-tab share shown here")
                        .accessibilityLabel("Revoke access to all \(revocableTabs.count) shared tabs shown")
                }
            }
            .padding(.horizontal, MenuMetrics.inset)
            .padding(.top, 8)
            .padding(.bottom, 2)

            if visibleTabs.isEmpty {
                MenuEmptyNote(
                    title: "No tabs shared",
                    detail: "Click the ABG icon in Chrome, then Share this tab with agents. Default shortcut: ⌥⇧S."
                )
            } else if visibleTabs.count > Self.maxVisibleRows {
                ScrollView {
                    tabRows
                }
                .frame(height: CGFloat(Self.maxVisibleRows) * MenuBarTabRow.height + MenuBarTabRow.height / 2)
            } else {
                tabRows
            }
        }
        .padding(.bottom, 6)
    }

    private var tabRows: some View {
        VStack(spacing: 0) {
            ForEach(visibleTabs, id: \.revocationKey) { tab in
                MenuBarTabRow(
                    tab: tab,
                    isRevoking: revoking.contains(tab.revocationKey)
                ) {
                    revoke(tab)
                }
            }
        }
        .padding(.horizontal, MenuMetrics.rowGutter)
    }

    private var visibleTabs: [PermittedTab] {
        guard let selectedExtension else { return coordinator.permittedTabs }
        return coordinator.permittedTabs.filter { $0.extensionId == selectedExtension }
    }

    /// Tabs shared by all-tabs mode are turned off from the extension popup, as there.
    private var revocableTabs: [PermittedTab] {
        visibleTabs.filter { !$0.isAllTabsShare }
    }

    private var extensionOptions: [ExtensionSwitcher.Option] {
        coordinator.connectedExtensionIds.map { id in
            ExtensionSwitcher.Option(
                id: id,
                title: Self.extensionLabel(
                    id: id,
                    profile: coordinator.extensionProfiles[id],
                    browser: coordinator.extensionBrowsers[id]
                ),
                sharedCount: coordinator.permittedTabs.filter { $0.extensionId == id }.count
            )
        }
    }

    private var profileSuffix: String {
        ABGConstants.runtimeProfile.map { " · \($0)" } ?? ""
    }

    /// The profile label set in the extension, else browser plus a short id ("Chrome · 4b2a").
    static func extensionLabel(id: String, profile: String?, browser: String?) -> String {
        if let profile = profile?.trimmingCharacters(in: .whitespacesAndNewlines), !profile.isEmpty {
            return profile
        }
        return "\(BrowserProfileRow.browserName(browser)) · \(id.prefix(4))"
    }

    // MARK: - Actions

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

extension PermittedTab {
    /// Tab IDs are only unique per browser profile, so rows key on both.
    var revocationKey: String { "\(extensionId)#\(tabId)" }
}

enum MenuMetrics {
    /// Text inset from the popover edge, matching system menus.
    static let inset: CGFloat = 14
    /// Inset of hover-highlighted rows, so the highlight sits inside the text inset.
    static let rowGutter: CGFloat = 5
}

private struct MenuSeparator: View {
    var body: some View {
        Divider()
            .padding(.horizontal, MenuMetrics.inset)
            .padding(.vertical, 4)
    }
}

private struct MenuEmptyNote: View {
    var title: String
    var detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.body)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, MenuMetrics.inset)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
