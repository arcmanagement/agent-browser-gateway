import SwiftUI

/// One reading on the instrument strip: label, value, and a short truthful note.
struct InstrumentTile: View {
    var title: String
    var value: String
    var tone: GateTone
    var detail: String
    var monospacedValue = false

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            SectionLabel(title: title)
            HStack(spacing: GateMetrics.space2) {
                if tone != .neutral {
                    SignalDot(tone: tone)
                }
                Text(verbatim: value)
                    .font(monospacedValue ? .title3.monospaced() : .title3.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .gateCard()
        .accessibilityElement(children: .combine)
    }
}
