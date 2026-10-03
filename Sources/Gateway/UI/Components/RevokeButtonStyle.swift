import SwiftUI

/// Compact outlined danger button used for Revoke everywhere, so revoking never looks
/// like sharing.
struct RevokeButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .foregroundStyle(GateColor.dangerText)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background {
                RoundedRectangle(cornerRadius: GateMetrics.radiusChip)
                    .fill(GateColor.danger.opacity(configuration.isPressed ? 0.18 : 0.08))
                    .overlay {
                        RoundedRectangle(cornerRadius: GateMetrics.radiusChip)
                            .strokeBorder(GateColor.danger.opacity(contrast == .increased ? 0.9 : 0.42), lineWidth: 1)
                    }
            }
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}
