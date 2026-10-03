import SwiftUI

/// A small status light. Only `signal` and `warning` glow, and only because something is
/// actually live; the glow is dropped under Increase Contrast.
struct SignalDot: View {
    var tone: GateTone
    var size: CGFloat = 7

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Circle()
            .fill(tone == .neutral ? AnyShapeStyle(.tertiary) : AnyShapeStyle(tone.fill))
            .frame(width: size, height: size)
            .shadow(color: glow, radius: size * 0.6)
            .accessibilityHidden(true)
    }

    private var glow: Color {
        guard contrast != .increased, tone == .signal || tone == .warning else { return .clear }
        return tone.fill.opacity(0.5)
    }
}
