import Foundation

/// Validation for the optional site icon the extension sends with `tab_permitted` and
/// `tab_updated`. The extension reads the icon from the browser's own favicon cache and
/// re-encodes it as a small PNG; the Gateway checks it again here and never fetches icons
/// itself. Icons live only in memory for the menu and window, never in the audit log, on
/// disk, or in CLI JSON.
public enum TabFavicon {
    public static let dataURLPrefix = "data:image/png;base64,"
    /// Same cap as the extension: the decoded PNG may be at most 8 KB.
    public static let maxPNGBytes = 8 * 1024
    /// The extension sends 32×32; anything much larger is not a tab icon.
    public static let maxDimension = 256

    private static let pngSignature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    /// Returns the PNG bytes of a valid favicon data URL, or `nil` for anything else
    /// (other image types, SVG, oversized data, malformed base64 or PNG headers).
    public static func pngData(fromDataURL value: String) -> Data? {
        guard value.hasPrefix(dataURLPrefix) else { return nil }
        let base64 = value.dropFirst(dataURLPrefix.count)
        // 4 base64 characters per 3 bytes; reject before decoding anything oversized.
        guard !base64.isEmpty, base64.utf8.count <= (maxPNGBytes + 2) / 3 * 4 else { return nil }
        guard let data = Data(base64Encoded: String(base64)) else { return nil }
        return validatedPNG(data)
    }

    /// The icon to keep after a `tab_permitted` / `tab_updated`: a valid new icon wins;
    /// otherwise the current one stays while the tab is still on the same origin (a
    /// re-announce after reconnect can arrive before the extension has the icon again).
    public static func resolve(_ dataURL: String?, current: Data?, sameOrigin: Bool) -> Data? {
        if let dataURL, let png = pngData(fromDataURL: dataURL) { return png }
        return sameOrigin ? current : nil
    }

    /// Checks size, PNG signature, and the IHDR dimensions without decoding pixels.
    public static func validatedPNG(_ data: Data) -> Data? {
        guard data.count <= maxPNGBytes, data.count >= 24 else { return nil }
        let bytes = [UInt8](data.prefix(24))
        guard Array(bytes[0..<8]) == pngSignature else { return nil }
        // The first chunk must be IHDR: length 13, type "IHDR", then width and height.
        guard Array(bytes[12..<16]) == Array("IHDR".utf8) else { return nil }
        let width = bytes[16..<20].reduce(0) { $0 << 8 | Int($1) }
        let height = bytes[20..<24].reduce(0) { $0 << 8 | Int($1) }
        guard (1...maxDimension).contains(width), (1...maxDimension).contains(height) else {
            return nil
        }
        return data
    }
}
