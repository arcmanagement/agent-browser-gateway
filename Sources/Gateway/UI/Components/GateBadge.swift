import SwiftUI

/// A quiet outlined tag, matching the extension's `.tag` chips.
struct GateBadge: View {
    var text: String
    var tone: GateTone = .neutral
    var monospaced = false

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Text(verbatim: text)
            .font(monospaced ? .caption.monospaced() : .caption)
            .foregroundStyle(tone.text)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background {
                RoundedRectangle(cornerRadius: GateMetrics.radiusChip)
                    .fill(tone == .neutral ? Color.clear : tone.fill.opacity(0.08))
                    .strokeBorder(borderColor, lineWidth: 1)
            }
    }

    private var borderColor: Color {
        if tone == .neutral {
            return GateColor.line(strong: true, highContrast: contrast == .increased)
        }
        return tone.fill.opacity(contrast == .increased ? 0.8 : 0.4)
    }
}
