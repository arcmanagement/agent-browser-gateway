import AppKit
import SwiftUI
import GatewayCore

/// A site's icon in a circle, with a small live dot. The icon is the favicon the extension
/// read from the browser's own cache; when there is none (older extensions, Safari, pages
/// without an icon), the host's initial stands in for it.
struct SiteIcon: View {
    var host: String
    var favicon: Data? = nil
    var tone: GateTone
    var size: CGFloat = 26

    var body: some View {
        content
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

    @ViewBuilder
    private var content: some View {
        if let image = favicon.flatMap(TabFaviconImage.image(from:)) {
            // 16pt in the 26pt circle: the extension sends 32px, so this is pixel-exact at 2x.
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: (size * 0.62).rounded(), height: (size * 0.62).rounded())
                .clipShape(RoundedRectangle(cornerRadius: size * 0.08))
        } else {
            Text(verbatim: initial)
                .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
        }
    }

    private var initial: String {
        let trimmed = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        return trimmed.first.map { String($0).uppercased() } ?? "•"
    }
}

extension SiteIcon {
    init(tab: PermittedTab, size: CGFloat = 26) {
        self.init(
            host: tab.displayHost,
            favicon: tab.favicon,
            tone: tab.isAllTabsShare ? .warning : .signal,
            size: size
        )
    }
}

/// Decodes the validated PNG bytes once per icon. `TabFavicon` has already checked the
/// signature, size, and dimensions; decoding still fails closed to the monogram.
@MainActor
enum TabFaviconImage {
    private static let cache: NSCache<NSData, NSImage> = {
        let cache = NSCache<NSData, NSImage>()
        cache.countLimit = 256
        return cache
    }()

    static func image(from data: Data) -> NSImage? {
        let key = data as NSData
        if let cached = cache.object(forKey: key) { return cached }
        guard let image = decode(data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    static func decode(_ data: Data) -> NSImage? {
        guard let png = TabFavicon.validatedPNG(data),
              let rep = NSBitmapImageRep(data: png),
              rep.pixelsWide > 0, rep.pixelsHigh > 0,
              rep.pixelsWide <= TabFavicon.maxDimension, rep.pixelsHigh <= TabFavicon.maxDimension
        else { return nil }
        // Points = pixels / 2, so a 32px icon is a crisp 16pt image on Retina displays.
        rep.size = NSSize(width: CGFloat(rep.pixelsWide) / 2, height: CGFloat(rep.pixelsHigh) / 2)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}
