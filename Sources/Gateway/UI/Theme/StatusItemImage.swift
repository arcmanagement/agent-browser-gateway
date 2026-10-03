import AppKit

/// Template images of the gate mark for the menu bar status item. Template rendering keeps
/// them crisp and correctly tinted in light, dark, and tinted menu bars; state is carried
/// by shape (outline, closed, open with a dot, badge), never by color alone.
enum StatusItemImage {
    static let pointSize = NSSize(width: 18, height: 18)

    /// - Parameter profile: non-production runtime profile (e.g. "dev"); adds a small
    ///   corner mark so a dev Gateway is distinguishable without menu bar text.
    static func image(for state: GateState, profile: String? = nil) -> NSImage {
        var size = pointSize
        if profile != nil { size.width += profileMarkWidth }
        let image = NSImage(size: size, flipped: true) { rect in
            let markRect = CGRect(origin: rect.origin, size: pointSize)
            draw(state: state, in: markRect)
            if profile != nil {
                drawProfileMark(in: CGRect(x: markRect.maxX + 0.5, y: rect.maxY - 7.5, width: profileMarkWidth - 1.5, height: 5.5))
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = accessibilityDescription(for: state, profile: profile)
        return image
    }

    /// Spoken by VoiceOver and shown as the tooltip; carries the count the icon omits.
    static func accessibilityDescription(for state: GateState, profile: String? = nil) -> String {
        let name = profile.map { "Agent Browser Gateway (\($0))" } ?? "Agent Browser Gateway"
        switch state {
        case .attention: return "\(name) — needs attention"
        case .noBrowser: return "\(name) — no browser connected"
        case .closed: return "\(name) — no tabs shared"
        case .open(let shared, _): return "\(name) — \(GateText.tabs(shared)) shared"
        }
    }

    private static let profileMarkWidth: CGFloat = 5

    /// A small subscript "D" to the right of the mark for non-production profiles.
    private static func drawProfileMark(in mark: CGRect) {
        // "D": a vertical stem with a half-round bowl, drawn as a path so it stays
        // crisp at 1x and 2x without depending on font hinting.
        let path = NSBezierPath()
        let stemX = mark.minX + 0.75
        path.move(to: CGPoint(x: stemX, y: mark.minY + 0.5))
        path.line(to: CGPoint(x: stemX, y: mark.maxY - 0.5))
        path.line(to: CGPoint(x: mark.minX + 2.5, y: mark.maxY - 0.5))
        path.curve(
            to: CGPoint(x: mark.minX + 2.5, y: mark.minY + 0.5),
            controlPoint1: CGPoint(x: mark.maxX + 0.6, y: mark.maxY - 0.5),
            controlPoint2: CGPoint(x: mark.maxX + 0.6, y: mark.minY + 0.5)
        )
        path.close()
        path.lineWidth = 1
        NSColor.black.setStroke()
        path.stroke()
    }

    private static func draw(state: GateState, in rect: CGRect) {
        let openness: CGFloat = state.isOpen ? 1 : 0
        let ink = NSColor.black

        // Dormant (no browser) dims the whole mark, like an inactive system item.
        let pillarAlpha: CGFloat
        let railAlpha: CGFloat
        switch state {
        case .open: (pillarAlpha, railAlpha) = (1, 1)
        case .noBrowser: (pillarAlpha, railAlpha) = (0.4, 0.3)
        default: (pillarAlpha, railAlpha) = (1, 0.55)
        }

        ink.withAlphaComponent(railAlpha).setFill()
        for rail in GateGeometry.rails(in: rect, openness: openness) {
            NSBezierPath(roundedRect: rail, xRadius: rail.height / 2, yRadius: rail.height / 2).fill()
        }

        ink.withAlphaComponent(pillarAlpha).setFill()
        for pillar in GateGeometry.pillars(in: rect, openness: openness) {
            let radius = pillar.width / 2
            NSBezierPath(roundedRect: pillar, xRadius: radius, yRadius: radius).fill()
        }

        if state.isOpen {
            ink.setFill()
            NSBezierPath(ovalIn: GateGeometry.dot(in: rect)).fill()
        }

        if case .attention = state {
            // Notification-style badge in the top-right corner, clear of the pillars, with
            // a knocked-out ring so it reads on any menu bar.
            let badge = CGRect(x: rect.maxX - 5, y: rect.minY + 0.5, width: 4.5, height: 4.5)
            NSGraphicsContext.current?.compositingOperation = .clear
            NSBezierPath(ovalIn: badge.insetBy(dx: -1, dy: -1)).fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
            ink.setFill()
            NSBezierPath(ovalIn: badge).fill()
        }
    }
}
