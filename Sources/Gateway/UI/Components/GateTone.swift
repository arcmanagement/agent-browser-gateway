import SwiftUI

/// Semantic tone for dots, badges, and status text. Signal, danger, and warning keep the
/// meanings defined in `GateColor`; `neutral` is everything else.
enum GateTone: Equatable {
    case neutral
    case signal
    case danger
    case warning

    var fill: Color {
        switch self {
        case .neutral: Color.secondary
        case .signal: GateColor.signal
        case .danger: GateColor.danger
        case .warning: GateColor.warning
        }
    }

    var text: AnyShapeStyle {
        switch self {
        case .neutral: AnyShapeStyle(.secondary)
        case .signal: AnyShapeStyle(GateColor.signalText)
        case .danger: AnyShapeStyle(GateColor.dangerText)
        case .warning: AnyShapeStyle(GateColor.warningText)
        }
    }
}
