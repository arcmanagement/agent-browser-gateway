import SwiftUI

/// Small uppercase section heading with an optional count, as in the extension popup.
struct SectionLabel: View {
    var title: String
    var count: Int?

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(0.6)
                .foregroundStyle(.secondary)
            if let count {
                Text(verbatim: "\(count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .overlay {
                        Capsule().strokeBorder(.quaternary, lineWidth: 1)
                    }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
