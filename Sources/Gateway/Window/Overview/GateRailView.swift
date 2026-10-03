import SwiftUI

/// The signature: your browser on the left, agents on the right, the gate between. The
/// rails light up only when a tab is actually shared; amber when every shared tab comes
/// from all-tabs sandbox mode.
struct GateRailView: View {
    var mode: GateMark.Mode

    private let markSize: CGFloat = 56

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: GateMetrics.space2) {
            HStack(spacing: 0) {
                RailEndpoint(systemImage: "macwindow", tone: tone)
                rail
                GateMark(mode: mode)
                    .frame(width: markSize, height: markSize)
                    .padding(.horizontal, -markSize / GateGeometry.grid)
                rail
                RailEndpoint(systemImage: "apple.terminal", tone: tone)
            }
            HStack {
                Text("Your browser")
                Spacer()
                Text("The gate")
                Spacer()
                Text("Agents via abg")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var rail: some View {
        Capsule()
            .fill(isLit ? AnyShapeStyle(tone.fill) : AnyShapeStyle(GateColor.line(strong: true, highContrast: contrast == .increased)))
            .frame(height: markSize * GateGeometry.railHeight / GateGeometry.grid)
            .shadow(color: isLit && contrast != .increased ? tone.fill.opacity(0.45) : .clear, radius: 5)
            .animation(reduceMotion ? nil : GateMetrics.gateMotion, value: isLit)
    }

    private var isLit: Bool {
        mode == .open || mode == .sandbox
    }

    private var tone: GateTone {
        switch mode {
        case .open: return .signal
        case .sandbox: return .warning
        default: return .neutral
        }
    }

    private var accessibilityText: String {
        isLit ? "The gate is open between your browser and agents." : "The gate is closed between your browser and agents."
    }
}

private struct RailEndpoint: View {
    var systemImage: String
    var tone: GateTone

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Image(systemName: systemImage)
            .font(.title3)
            .foregroundStyle(tone == .neutral ? AnyShapeStyle(.secondary) : tone.text)
            .frame(width: 40, height: 40)
            .background {
                RoundedRectangle(cornerRadius: GateMetrics.radiusControl)
                    .fill(GateColor.inset)
                    .overlay {
                        RoundedRectangle(cornerRadius: GateMetrics.radiusControl)
                            .strokeBorder(borderColor, lineWidth: 1)
                    }
            }
    }

    private var borderColor: Color {
        tone == .neutral
            ? GateColor.line(strong: true, highContrast: contrast == .increased)
            : tone.fill.opacity(contrast == .increased ? 0.9 : 0.5)
    }
}
