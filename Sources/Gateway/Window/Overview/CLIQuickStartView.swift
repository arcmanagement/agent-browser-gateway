import SwiftUI

/// The three commands that verify everything on this page from a terminal.
struct CLIQuickStartView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space3) {
            SectionLabel(title: "From your terminal")
            step(GateText.cli("status"), "Gateway state and connected browsers")
            step(GateText.cli("tabs --compact"), "Shared tabs with their IDs")
            step(GateText.cli("audit --lines 20"), "The latest audit entries")
        }
        .gateCard()
    }

    private func step(_ command: String, _ caption: String) -> some View {
        VStack(alignment: .leading, spacing: GateMetrics.space1) {
            CommandLineView(command: command)
            Text(caption)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.leading, GateMetrics.space1)
        }
    }
}
