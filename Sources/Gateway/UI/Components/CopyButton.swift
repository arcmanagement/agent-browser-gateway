import SwiftUI

/// Icon-only copy control that confirms with a checkmark. The text label stays available
/// to VoiceOver and as the hover help.
struct CopyButton: View {
    var label: String
    var value: String

    @State private var didCopy = false

    var body: some View {
        Button(didCopy ? "Copied" : label, systemImage: didCopy ? "checkmark" : "doc.on.doc", action: copy)
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .foregroundStyle(didCopy ? AnyShapeStyle(GateColor.signalText) : AnyShapeStyle(.secondary))
            .contentTransition(.symbolEffect(.replace))
            .help(label)
            .task(id: didCopy) {
                guard didCopy else { return }
                try? await Task.sleep(for: .seconds(1.4))
                didCopy = false
            }
    }

    private func copy() {
        Pasteboard.copy(value)
        didCopy = true
    }
}
