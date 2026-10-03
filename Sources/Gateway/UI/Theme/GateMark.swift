import SwiftUI

/// The ABG gate mark. Closed, it is two pillars on a rail; open, the pillars part and the
/// signal lights in the aperture. Amber replaces the signal for all-tabs sandbox mode.
struct GateMark: View {
    enum Mode: Equatable {
        /// No browser connected: the mark is drawn quietly.
        case dormant
        /// Browser connected, nothing shared.
        case closed
        /// At least one tab is shared.
        case open
        /// Shared, and every shared tab comes from all-tabs sandbox mode.
        case sandbox
        /// The Gateway needs attention.
        case attention
    }

    var mode: Mode

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        ZStack {
            GateRailsShape(openness: openness)
                .fill(railStyle)
            GatePillarsShape(openness: openness)
                .fill(pillarStyle)
            GateDotShape(scale: isLit ? 1 : 0.01)
                .fill(dotColor)
                .shadow(color: glowColor, radius: 6)
                .opacity(isLit ? 1 : 0)
        }
        .aspectRatio(1, contentMode: .fit)
        .animation(reduceMotion ? nil : GateMetrics.gateMotion, value: mode)
        .accessibilityHidden(true)
    }

    private var isLit: Bool {
        mode == .open || mode == .sandbox
    }

    private var openness: CGFloat {
        isLit ? 1 : 0
    }

    private var pillarStyle: AnyShapeStyle {
        switch mode {
        case .dormant: AnyShapeStyle(.tertiary)
        case .attention: AnyShapeStyle(GateColor.danger)
        default: AnyShapeStyle(.primary)
        }
    }

    private var railStyle: AnyShapeStyle {
        switch mode {
        case .open: AnyShapeStyle(GateColor.signal)
        case .sandbox: AnyShapeStyle(GateColor.warning)
        default: AnyShapeStyle(.tertiary)
        }
    }

    private var dotColor: Color {
        mode == .sandbox ? GateColor.warning : GateColor.signal
    }

    private var glowColor: Color {
        guard isLit, contrast != .increased else { return .clear }
        return dotColor.opacity(0.55)
    }
}

extension GateMark.Mode {
    init(_ state: GateState) {
        switch state {
        case .attention: self = .attention
        case .noBrowser: self = .dormant
        case .closed: self = .closed
        case .open(let shared, let allTabs): self = allTabs == shared ? .sandbox : .open
        }
    }
}
