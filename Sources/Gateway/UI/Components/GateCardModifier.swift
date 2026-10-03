import SwiftUI

/// Hairline-bordered card surface. Borders, not shadows, separate surfaces; Increase
/// Contrast strengthens the hairline.
struct GateCardModifier: ViewModifier {
    var padding: CGFloat
    var tint: GateTone?

    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: GateMetrics.radiusCard)
                    .fill(GateColor.card)
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: GateMetrics.radiusCard)
                                .fill(tint.fill.opacity(0.05))
                        }
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: GateMetrics.radiusCard)
                            .strokeBorder(borderColor, lineWidth: 1)
                    }
            }
    }

    private var borderColor: Color {
        if let tint, tint != .neutral {
            return tint.fill.opacity(contrast == .increased ? 0.8 : 0.32)
        }
        return GateColor.line(strong: true, highContrast: contrast == .increased)
    }
}

extension View {
    func gateCard(padding: CGFloat = GateMetrics.space4, tint: GateTone? = nil) -> some View {
        modifier(GateCardModifier(padding: padding, tint: tint))
    }
}
