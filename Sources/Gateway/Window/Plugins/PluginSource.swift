import Foundation
import GatewayCore

/// Where a loaded plugin comes from. Only `user` plugins can be managed from the app.
enum PluginSource: Equatable {
    case bundled
    case user
    case local

    var title: String {
        switch self {
        case .bundled: return "Built-in"
        case .user: return "User"
        case .local: return "Local dev"
        }
    }

    var symbol: String {
        switch self {
        case .bundled: return "shippingbox"
        case .user: return "person.crop.circle"
        case .local: return "hammer"
        }
    }

    init(plugin: PluginHost.PluginSummary) {
        let pluginURL = URL(fileURLWithPath: plugin.path).standardizedFileURL
        let path = pluginURL.path
        let userPluginsPath = ABGConstants.userPluginsDir.standardizedFileURL.path
        if pluginURL.deletingLastPathComponent().standardizedFileURL.path == userPluginsPath {
            self = .user
        } else if path.contains("/Contents/Resources/plugins/") || path.contains("/agent-browser-gateway/plugins/") {
            self = .bundled
        } else {
            self = .local
        }
    }
}

enum PluginFilter: String, CaseIterable, Identifiable {
    case all
    case bundled
    case user
    case local

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All Sources"
        case .bundled: return "Built-in"
        case .user: return "User"
        case .local: return "Local Dev"
        }
    }

    func matches(_ source: PluginSource) -> Bool {
        switch self {
        case .all: return true
        case .bundled: return source == .bundled
        case .user: return source == .user
        case .local: return source == .local
        }
    }
}
