import SwiftUI

/// The two pillars of the gate mark. Animatable so the gate visibly opens.
struct GatePillarsShape: Shape {
    var openness: CGFloat

    var animatableData: CGFloat {
        get { openness }
        set { openness = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for pillar in GateGeometry.pillars(in: rect, openness: openness) {
            path.addRoundedRect(in: pillar, cornerSize: CGSize(width: pillar.width / 2, height: pillar.width / 2))
        }
        return path
    }
}

/// The two rails that run into the gate from the browser and agent sides.
struct GateRailsShape: Shape {
    var openness: CGFloat

    var animatableData: CGFloat {
        get { openness }
        set { openness = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for rail in GateGeometry.rails(in: rect, openness: openness) {
            path.addRoundedRect(in: rail, cornerSize: CGSize(width: rail.height / 2, height: rail.height / 2))
        }
        return path
    }
}

/// The signal dot in the aperture.
struct GateDotShape: Shape {
    var scale: CGFloat

    var animatableData: CGFloat {
        get { scale }
        set { scale = newValue }
    }

    func path(in rect: CGRect) -> Path {
        Path(ellipseIn: GateGeometry.dot(in: rect, scale: scale))
    }
}
