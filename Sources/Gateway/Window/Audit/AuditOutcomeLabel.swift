import SwiftUI

/// Outcome with a glyph so meaning never rides on color alone.
struct AuditOutcomeLabel: View {
    var entry: AuditLogViewEntry
    var compact = false

    var body: some View {
        Label {
            Text(verbatim: entry.outcome)
                .lineLimit(1)
        } icon: {
            Image(systemName: entry.outcomeSymbol)
                .imageScale(.small)
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(entry.outcomeTone.text)
        .font(compact ? .callout.monospaced() : .body.monospaced())
    }
}
