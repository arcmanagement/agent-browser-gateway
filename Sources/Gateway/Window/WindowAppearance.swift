import SwiftUI

/// Window-only appearance override, stored under the original `pluginBrowserAppearance`
/// key so existing preferences carry over.
enum WindowAppearance: String, CaseIterable, Identifiable {
    static let storageKey = "pluginBrowserAppearance"

    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: return "Match System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}
