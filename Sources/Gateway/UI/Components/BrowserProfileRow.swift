import SwiftUI

/// A connected browser profile: green light, the profile label the user set in the
/// extension, browser kind and extension version, and how many of its tabs are shared.
struct BrowserProfileRow: View {
    var label: String
    var browser: String?
    var version: String?
    var sharedCount: Int

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            SignalDot(tone: .signal)
                .frame(width: 12)
            Text(label)
                .font(.body)
                .lineLimit(1)
            Text(verbatim: details)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: GateMetrics.space2)
            Text(sharedCount == 0 ? "nothing shared" : "\(GateText.tabs(sharedCount)) shared")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var details: String {
        let kind = BrowserProfileRow.browserName(browser)
        guard let version, !version.isEmpty else { return kind }
        return "\(kind) \(version)"
    }

    static func browserName(_ kind: String?) -> String {
        switch kind {
        case "chrome": "Chrome"
        case "edge": "Edge"
        case "firefox": "Firefox"
        case "safari-ios": "Safari (iOS)"
        case .some(let other) where !other.isEmpty: other
        default: "Browser"
        }
    }
}
