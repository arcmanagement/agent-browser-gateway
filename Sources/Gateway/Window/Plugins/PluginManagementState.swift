import Foundation

enum PluginManagementOperation: Equatable {
    case updating(String)
    case enabling(String)
    case disabling(String)
    case uninstalling(String)

    var pluginID: String {
        switch self {
        case .updating(let pluginID), .enabling(let pluginID), .disabling(let pluginID), .uninstalling(let pluginID):
            return pluginID
        }
    }

    var title: String {
        switch self {
        case .updating: return "Updating…"
        case .enabling: return "Enabling…"
        case .disabling: return "Disabling…"
        case .uninstalling: return "Uninstalling…"
        }
    }
}

enum PluginManagementAlert: Identifiable {
    case confirmUninstall(PluginHost.PluginSummary)
    case error(String)

    var id: String {
        switch self {
        case .confirmUninstall(let plugin):
            return "uninstall-\(plugin.id)"
        case .error(let message):
            return "error-\(message)"
        }
    }
}
