import SwiftUI

/// Identity of the selected extension: browser, version, and its id (copyable).
struct ExtensionInfoRow: View {
    var extensionId: String
    var browser: String?
    var version: String?

    var body: some View {
        HStack(spacing: 6) {
            SignalDot(tone: .signal, size: 6)
            Text(verbatim: browserText)
            Text(verbatim: "·").accessibilityHidden(true)
            Text(verbatim: String(extensionId.prefix(8)))
                .monospaced()
                .help(extensionId)
            Spacer(minLength: 4)
            CopyButton(label: "Copy extension ID", value: extensionId)
                .controlSize(.small)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Connected: \(browserText), extension \(extensionId.prefix(8))")
    }

    private var browserText: String {
        let name = BrowserProfileRow.browserName(browser)
        guard let version, !version.isEmpty else { return "Connected · \(name)" }
        return "Connected · \(name) \(version)"
    }
}
