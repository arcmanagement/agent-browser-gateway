import SwiftUI

/// Monogram circle for a site, with a small live dot. The Gateway receives no favicon
/// data for shared tabs, so the host's initial stands in for it.
struct SiteMonogram: View {
    var host: String
    var tone: GateTone
    var size: CGFloat = 26

    var body: some View {
        Text(verbatim: initial)
            .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.primary.opacity(0.1)))
            .overlay(alignment: .bottomTrailing) {
                SignalDot(tone: tone, size: 8)
                    .padding(1.5)
                    .background(Circle().fill(.background))
                    .offset(x: 2, y: 2)
            }
            .accessibilityHidden(true)
    }

    private var initial: String {
        let trimmed = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        return trimmed.first.map { String($0).uppercased() } ?? "•"
    }
}
