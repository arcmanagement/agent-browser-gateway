import Foundation
import Observation
import GatewayCore

/// Plugin list filtering and user-plugin management (install, update, enable, disable,
/// uninstall). Behavior is unchanged from the original window; only the home moved.
@MainActor
@Observable
final class PluginsModel {
    @ObservationIgnored let coordinator: GatewayCoordinator

    var searchText = ""
    var filter: PluginFilter = .all
    var selectedPluginID: String?
    var isInstallSheetPresented = false
    private(set) var operation: PluginManagementOperation?
    private(set) var message: String?
    private var messagePluginID: String?
    var alert: PluginManagementAlert?

    init(coordinator: GatewayCoordinator) {
        self.coordinator = coordinator
    }

    func filteredPlugins(from summaries: [PluginHost.PluginSummary]) -> [PluginHost.PluginSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return summaries
            .filter { filter.matches(PluginSource(plugin: $0)) }
            .filter { plugin in
                guard !query.isEmpty else { return true }
                return Self.searchableText(plugin).localizedCaseInsensitiveContains(query)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func selectedPlugin(in plugins: [PluginHost.PluginSummary]) -> PluginHost.PluginSummary? {
        if let selectedPluginID, let plugin = plugins.first(where: { $0.id == selectedPluginID }) {
            return plugin
        }
        return plugins.first
    }

    func isOperating(on plugin: PluginHost.PluginSummary) -> Bool {
        operation?.pluginID == plugin.id
    }

    func message(for plugin: PluginHost.PluginSummary) -> String? {
        messagePluginID == plugin.id ? message : nil
    }

    static func isGitBacked(_ plugin: PluginHost.PluginSummary) -> Bool {
        FileManager.default.fileExists(atPath: URL(fileURLWithPath: plugin.path).appendingPathComponent(".git").path)
    }

    static func commandRows(_ plugin: PluginHost.PluginSummary) -> [PluginHost.CommandSummary] {
        if !plugin.commands.isEmpty { return plugin.commands }
        return plugin.registeredCommands.map {
            PluginHost.CommandSummary(id: "\(plugin.name).\($0)", name: $0, description: nil, args: [])
        }
    }

    private static func searchableText(_ plugin: PluginHost.PluginSummary) -> String {
        [
            plugin.name,
            plugin.author ?? "",
            plugin.description ?? "",
            plugin.path,
            plugin.domains.joined(separator: " "),
            plugin.transforms.joined(separator: " "),
            plugin.registeredCommands.joined(separator: " "),
        ].joined(separator: " ")
    }

    // MARK: - Management

    func reloadPlugins() {
        _ = coordinator.pluginHost.reload()
        coordinator.refreshPluginSummaries()
    }

    func install(source: String, name: String?, force: Bool) async throws {
        let result = try await Task.detached(priority: .userInitiated) {
            try ABGPluginInstaller.install(source: source, name: name, force: force)
        }.value

        let reloadResult = coordinator.pluginHost.reload(plugin: result.name)
        let didReload = reloadResult.contains { row in
            (row["status"] as? String) == "reloaded"
        }
        if !didReload, result.installName != result.name {
            _ = coordinator.pluginHost.reload(plugin: result.installName)
        }
        coordinator.refreshPluginSummaries()
        filter = .all
        selectedPluginID = result.path
    }

    func update(_ plugin: PluginHost.PluginSummary) async {
        guard PluginSource(plugin: plugin) == .user else { return }
        operation = .updating(plugin.id)
        message = nil
        messagePluginID = plugin.id
        let result = await Task.detached(priority: .userInitiated) {
            ABGPluginInstaller.updatePlugin(at: URL(fileURLWithPath: plugin.path))
        }.value

        operation = nil
        guard result.status == "updated" else {
            alert = .error(result.error ?? result.reason ?? "Plugin update failed.")
            return
        }
        if plugin.isEnabled {
            reloadLoadedPlugin(plugin)
        }
        coordinator.refreshPluginSummaries()
        selectedPluginID = plugin.id
        if !plugin.isEnabled {
            message = "Updated while disabled."
        } else {
            message = result.output?.isEmpty == false ? result.output : "Already up to date."
        }
    }

    func enable(_ plugin: PluginHost.PluginSummary) async {
        guard PluginSource(plugin: plugin) == .user else { return }
        operation = .enabling(plugin.id)
        message = nil
        messagePluginID = plugin.id
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginStateStore.enable(at: URL(fileURLWithPath: plugin.path))
            }.value
            reloadLoadedPlugin(plugin)
            coordinator.refreshPluginSummaries()
            selectedPluginID = plugin.id
            message = "Enabled and reloaded."
        } catch {
            alert = .error(error.localizedDescription)
        }
        operation = nil
    }

    func disable(_ plugin: PluginHost.PluginSummary) async {
        guard PluginSource(plugin: plugin) == .user else { return }
        operation = .disabling(plugin.id)
        message = nil
        messagePluginID = plugin.id
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginStateStore.disable(at: URL(fileURLWithPath: plugin.path))
            }.value
            _ = coordinator.pluginHost.unload(at: URL(fileURLWithPath: plugin.path))
            coordinator.refreshPluginSummaries()
            selectedPluginID = plugin.id
            message = "Disabled. Its commands are unloaded."
        } catch {
            alert = .error(error.localizedDescription)
        }
        operation = nil
    }

    func uninstall(_ plugin: PluginHost.PluginSummary) async {
        guard PluginSource(plugin: plugin) == .user else { return }
        operation = .uninstalling(plugin.id)
        message = nil
        do {
            _ = try await Task.detached(priority: .userInitiated) {
                try ABGPluginInstaller.uninstall(at: URL(fileURLWithPath: plugin.path))
            }.value
            _ = coordinator.pluginHost.unload(plugin: plugin.name)
            coordinator.refreshPluginSummaries()
            selectedPluginID = nil
            filter = .all
        } catch {
            alert = .error(error.localizedDescription)
        }
        operation = nil
    }

    private func reloadLoadedPlugin(_ plugin: PluginHost.PluginSummary) {
        let installName = URL(fileURLWithPath: plugin.path).lastPathComponent
        let reloadResult = coordinator.pluginHost.reload(plugin: plugin.name)
        let didReload = reloadResult.contains { row in
            (row["status"] as? String) == "reloaded"
        }
        if !didReload, installName != plugin.name {
            _ = coordinator.pluginHost.reload(plugin: installName)
        }
    }
}
