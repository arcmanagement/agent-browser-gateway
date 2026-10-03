import SwiftUI
import AppKit

/// Brand color roles from the shared ABG design brief ("The Gate"), resolved for the
/// current appearance. Semantic colors carry meaning and are never decorative:
///
/// - `signal` (green): access is open or being granted — shared, allowed, connected.
/// - `danger` (red): access is removed or refused — revoke, deny, errors.
/// - `warning` (amber): wide-scope states — all-tabs sandbox mode, non-default profiles.
///
/// Text uses the system hierarchical styles (`.primary`, `.secondary`, `.tertiary`) so it
/// follows Increase Contrast automatically; these tokens cover accents and surfaces only.
/// Light values match `extension/public/ui.css`, darkened where needed for WCAG AA text.
enum GateColor {
    /// Luminous signal for dots, glows, rails, and short labels.
    static let signal = dynamic(light: 0x0E9F55, dark: 0x3DFF8F)
    /// Signal used for text so small labels keep AA contrast on light surfaces.
    static let signalText = dynamic(light: 0x0A7A3F, dark: 0x3DFF8F)
    static let danger = dynamic(light: 0xD92D20, dark: 0xFF5A4E)
    static let dangerText = dynamic(light: 0xB42318, dark: 0xFF7D73)
    static let warning = dynamic(light: 0xB25E00, dark: 0xFFB547)
    static let warningText = dynamic(light: 0x9A5100, dark: 0xFFC46E)

    /// Window content surface (brief: page / ink-1).
    static let canvas = dynamic(light: 0xF6F7F5, dark: 0x0D1112)
    /// Raised card surface (brief: card / ink-2).
    static let card = dynamic(light: 0xFFFFFF, dark: 0x141A1C)
    /// Inset surface for code, CLI lines, and the gate rail (brief: ink-0 / hover).
    static let inset = dynamic(light: 0xEEF0ED, dark: 0x07090A)

    /// Hairline separators. Increase Contrast strengthens them (see `GateLine`).
    static func line(strong: Bool = false, highContrast: Bool = false) -> Color {
        let lightAlpha: CGFloat = highContrast ? 0.32 : (strong ? 0.16 : 0.08)
        let darkAlpha: CGFloat = highContrast ? 0.38 : (strong ? 0.14 : 0.08)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.isDark
                ? NSColor(white: 1, alpha: darkAlpha)
                : NSColor(calibratedRed: 7 / 255, green: 9 / 255, blue: 10 / 255, alpha: lightAlpha)
        })
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            NSColor(hex: appearance.isDark ? dark : light)
        })
    }
}

extension NSAppearance {
    var isDark: Bool {
        bestMatch(from: [.darkAqua, .aqua, .accessibilityHighContrastDarkAqua, .accessibilityHighContrastAqua])
            .map { $0 == .darkAqua || $0 == .accessibilityHighContrastDarkAqua } ?? false
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
