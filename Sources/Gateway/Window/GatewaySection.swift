import Foundation
import Observation

enum GatewaySection: String, CaseIterable, Identifiable, Hashable {
    case overview
    case sharedTabs
    case audit
    case plugins
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .sharedTabs: return "Shared Tabs"
        case .audit: return "Audit"
        case .plugins: return "Plugins"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "gauge.with.dots.needle.33percent"
        case .sharedTabs: return "rectangle.stack"
        case .audit: return "list.bullet.rectangle"
        case .plugins: return "puzzlepiece.extension"
        case .settings: return "gearshape"
        }
    }

    /// ⌘1…⌘5 in sidebar order; Settings also answers to ⌘, (see the window root).
    var shortcutKey: Character {
        switch self {
        case .overview: return "1"
        case .sharedTabs: return "2"
        case .audit: return "3"
        case .plugins: return "4"
        case .settings: return "5"
        }
    }
}

/// Lets the menu bar popover open the window on a specific section.
@MainActor
@Observable
final class GatewayWindowRouter {
    var section: GatewaySection = .overview
}
