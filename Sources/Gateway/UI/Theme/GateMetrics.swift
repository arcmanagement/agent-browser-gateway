import SwiftUI

/// Shared spacing, radii, and motion so every surface keeps the same rhythm (4 pt grid).
enum GateMetrics {
    static let space1: CGFloat = 4
    static let space2: CGFloat = 8
    static let space3: CGFloat = 12
    static let space4: CGFloat = 16
    static let space5: CGFloat = 20
    static let space6: CGFloat = 24
    static let space8: CGFloat = 32

    static let radiusChip: CGFloat = 6
    static let radiusControl: CGFloat = 8
    static let radiusCard: CGFloat = 12

    /// Maximum readable width for detail content in the window.
    static let contentMaxWidth: CGFloat = 880

    /// UI transitions: 200 ms ease-out, matching the brief's cubic-bezier(0.2, 0.8, 0.2, 1).
    static let motion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2)
    /// The gate opening: slower and physical, still well under a second.
    static let gateMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.6)
}
