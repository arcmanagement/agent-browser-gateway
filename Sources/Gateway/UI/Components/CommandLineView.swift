import SwiftUI

/// A real, copyable CLI line: "monospace evidence" from the brief. The prompt glyph is
/// decorative; the copied value is the bare command.
struct CommandLineView: View {
    var command: String
    var note: String?

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            Text(verbatim: "$")
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            Text(verbatim: command)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
            if let note {
                Text(note)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: GateMetrics.space2)
            CopyButton(label: "Copy command", value: command)
        }
        .font(.body.monospaced())
        .padding(.leading, GateMetrics.space3)
        .padding(.trailing, GateMetrics.space2)
        .padding(.vertical, 6)
        .background {
            RoundedRectangle(cornerRadius: GateMetrics.radiusControl)
                .fill(GateColor.inset)
                .overlay {
                    RoundedRectangle(cornerRadius: GateMetrics.radiusControl)
                        .strokeBorder(GateColor.line(highContrast: contrast == .increased), lineWidth: 1)
                }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Command \(command)")
    }
}
