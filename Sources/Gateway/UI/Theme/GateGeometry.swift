import CoreGraphics

/// Geometry of the ABG gate mark (site/public/favicon.svg) on a 20 × 20 unit grid:
/// two rails meet two pillars, and the signal dot sits in the aperture between them.
/// `openness` (0…1) slides the pillars apart so the aperture can hold the dot; the
/// menu bar template image and the SwiftUI mark share these numbers.
enum GateGeometry {
    static let grid: CGFloat = 20
    static let pillarWidth: CGFloat = 2.3
    static let pillarTop: CGFloat = 3
    static let pillarHeight: CGFloat = 14
    static let railHeight: CGFloat = 1.6
    static let railInset: CGFloat = 1
    static let dotRadius: CGFloat = 1.5

    /// How far each pillar slides out when the gate opens. Wide enough that the dot keeps
    /// a visible gap from both pillars even at 1x in the menu bar.
    static let openShift: CGFloat = 1.6

    /// Left edge of the left pillar: 6.6 when closed, 5.0 when open.
    static func leftPillarX(openness: CGFloat) -> CGFloat {
        6.6 - openShift * openness
    }

    /// Left edge of the right pillar: 11.1 when closed, 12.7 when open.
    static func rightPillarX(openness: CGFloat) -> CGFloat {
        11.1 + openShift * openness
    }

    static func pillars(in rect: CGRect, openness: CGFloat) -> [CGRect] {
        let unit = rect.width / grid
        return [leftPillarX(openness: openness), rightPillarX(openness: openness)].map { x in
            CGRect(
                x: rect.minX + x * unit,
                y: rect.minY + pillarTop * unit,
                width: pillarWidth * unit,
                height: pillarHeight * unit
            )
        }
    }

    static func rails(in rect: CGRect, openness: CGFloat) -> [CGRect] {
        let unit = rect.width / grid
        let y = rect.minY + (grid - railHeight) / 2 * unit
        let leftEnd = leftPillarX(openness: openness)
        let rightStart = rightPillarX(openness: openness) + pillarWidth
        return [
            CGRect(x: rect.minX + railInset * unit, y: y, width: (leftEnd - railInset) * unit, height: railHeight * unit),
            CGRect(x: rect.minX + rightStart * unit, y: y, width: (grid - railInset - rightStart) * unit, height: railHeight * unit),
        ]
    }

    static func dot(in rect: CGRect, scale: CGFloat = 1) -> CGRect {
        let unit = rect.width / grid
        let radius = dotRadius * unit * scale
        return CGRect(x: rect.midX - radius, y: rect.midY - radius, width: radius * 2, height: radius * 2)
    }
}
