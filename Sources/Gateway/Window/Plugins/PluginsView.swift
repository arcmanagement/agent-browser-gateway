import SwiftUI
import GatewayCore

/// Loaded plugins on the left, the selected plugin's commands and management on the right.
struct PluginsView: View {
    @ObservedObject var coordinator: GatewayCoordinator
    @Bindable var model: PluginsModel

    var body: some View {
        let plugins = model.filteredPlugins(from: coordinator.pluginSummaries)
        let selected = model.selectedPlugin(in: plugins)

        HStack(spacing: 0) {
            Group {
                if plugins.isEmpty {
                    ContentUnavailableView {
                        Label(coordinator.pluginSummaries.isEmpty ? "No Plugins Loaded" : "No Matching Plugins", systemImage: "puzzlepiece.extension")
                    } description: {
                        Text(coordinator.pluginSummaries.isEmpty
                             ? "Install one from a git repository, or put a plugin folder in the user plugin directory."
                             : "Try another source or search.")
                    } actions: {
                        if coordinator.pluginSummaries.isEmpty {
                            Button("Install a Plugin…") { model.isInstallSheetPresented = true }
                        }
                    }
                } else {
                    List(plugins, selection: selectionBinding(default: selected?.id)) { plugin in
                        PluginListRow(plugin: plugin, source: PluginSource(plugin: plugin))
                            .tag(plugin.id)
                    }
                    .listStyle(.inset)
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(width: 290)

            Divider()

            Group {
                if let selected {
                    PluginDetailView(plugin: selected, model: model)
                } else {
                    ContentUnavailableView("No Plugin Selected", systemImage: "puzzlepiece.extension")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Plugins")
        .navigationSubtitle("\(coordinator.pluginSummaries.filter(\.isLoaded).count) loaded")
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "Search plugins")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Source", selection: $model.filter) {
                    ForEach(PluginFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.menu)
                .help("Filter by where plugins come from")
                Button("Reload Plugins", systemImage: "arrow.clockwise", action: model.reloadPlugins)
                    .keyboardShortcut("r")
                    .help("Reload all plugins (⌘R)")
                Button("Install Plugin", systemImage: "plus") {
                    model.isInstallSheetPresented = true
                }
                .help("Install a plugin from a git repository")
            }
        }
        .sheet(isPresented: $model.isInstallSheetPresented) {
            PluginInstallSheet { source, name, force in
                try await model.install(source: source, name: name, force: force)
            }
        }
        .alert(
            alertTitle,
            isPresented: alertBinding,
            presenting: model.alert
        ) { alert in
            switch alert {
            case .confirmUninstall(let plugin):
                Button("Uninstall", role: .destructive) {
                    Task { await model.uninstall(plugin) }
                }
                Button("Cancel", role: .cancel) {}
            case .error:
                Button("OK", role: .cancel) {}
            }
        } message: { alert in
            switch alert {
            case .confirmUninstall(let plugin):
                Text("Remove \(plugin.name) from this profile's user plugin directory. Built-in and local development plugins can't be removed here.")
            case .error(let message):
                Text(message)
            }
        }
    }

    private var alertTitle: String {
        switch model.alert {
        case .confirmUninstall(let plugin): "Uninstall \(plugin.name)?"
        case .error: "Plugin Action Failed"
        case nil: ""
        }
    }

    private var alertBinding: Binding<Bool> {
        Binding(
            get: { model.alert != nil },
            set: { if !$0 { model.alert = nil } }
        )
    }

    private func selectionBinding(default id: String?) -> Binding<String?> {
        Binding(
            get: { model.selectedPluginID ?? id },
            set: { model.selectedPluginID = $0 }
        )
    }
}
