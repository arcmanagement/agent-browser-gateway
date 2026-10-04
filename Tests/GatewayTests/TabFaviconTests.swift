import AppKit
import XCTest
@testable import Gateway
@testable import GatewayCore

final class TabFaviconTests: XCTestCase {
    // MARK: - Data URL validation

    func testAcceptsSmallPNGDataURL() throws {
        let png = try Self.makePNG(width: 32, height: 32)
        let data = try XCTUnwrap(TabFavicon.pngData(fromDataURL: Self.dataURL(png)))
        XCTAssertEqual(data, png)
    }

    func testRejectsNonPNGAndSVGInput() throws {
        let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#.utf8)
        XCTAssertNil(TabFavicon.pngData(fromDataURL: "data:image/svg+xml;base64,\(svg.base64EncodedString())"))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: "data:image/svg+xml,<svg/>"))
        // An SVG (or anything else) labelled as PNG is still refused by its bytes.
        XCTAssertNil(TabFavicon.pngData(fromDataURL: Self.dataURL(svg)))
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0] + Array(repeating: 0, count: 40))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: "data:image/jpeg;base64,\(jpeg.base64EncodedString())"))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: Self.dataURL(jpeg)))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: "https://example.com/favicon.png"))
    }

    func testRejectsMalformedBase64() {
        XCTAssertNil(TabFavicon.pngData(fromDataURL: TabFavicon.dataURLPrefix))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: TabFavicon.dataURLPrefix + "not base64!"))
        XCTAssertNil(TabFavicon.pngData(fromDataURL: TabFavicon.dataURLPrefix + "iVBO\nRw0K"))
    }

    func testRejectsOversizedInput() throws {
        let noisy = try Self.makePNG(width: 128, height: 128, noise: true)
        XCTAssertGreaterThan(noisy.count, TabFavicon.maxPNGBytes)
        XCTAssertNil(TabFavicon.pngData(fromDataURL: Self.dataURL(noisy)))
        // Refused by length before any base64 decoding.
        let huge = TabFavicon.dataURLPrefix + String(repeating: "A", count: 64 * 1024)
        XCTAssertNil(TabFavicon.pngData(fromDataURL: huge))
    }

    func testRejectsImplausibleDimensions() throws {
        var png = try Self.makePNG(width: 32, height: 32)
        // Rewrite IHDR width to 4096 px; the header check refuses it without decoding.
        png.replaceSubrange(16..<20, with: [0x00, 0x00, 0x10, 0x00])
        XCTAssertNil(TabFavicon.validatedPNG(png))
    }

    func testResolveKeepsIconOnlyForSameOrigin() throws {
        let png = try Self.makePNG(width: 32, height: 32)
        let other = try Self.makePNG(width: 16, height: 16)
        XCTAssertEqual(TabFavicon.resolve(Self.dataURL(other), current: png, sameOrigin: true), other)
        XCTAssertEqual(TabFavicon.resolve(nil, current: png, sameOrigin: true), png)
        XCTAssertEqual(TabFavicon.resolve("data:image/svg+xml,<svg/>", current: png, sameOrigin: true), png)
        XCTAssertNil(TabFavicon.resolve(nil, current: png, sameOrigin: false))
    }

    // MARK: - Decoding for display

    @MainActor
    func testDecodesValidPNGAtHalfPointSize() throws {
        let png = try Self.makePNG(width: 32, height: 32)
        let image = try XCTUnwrap(TabFaviconImage.decode(png))
        XCTAssertEqual(image.size, NSSize(width: 16, height: 16))
        XCTAssertNotNil(TabFaviconImage.image(from: png))
    }

    @MainActor
    func testDecodingFailsClosedForGarbage() {
        var truncated = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13])
        truncated.append(contentsOf: Array("IHDR".utf8) + [0, 0, 0, 32, 0, 0, 0, 32])
        XCTAssertNil(TabFaviconImage.decode(truncated))
        XCTAssertNil(TabFaviconImage.decode(Data("<svg/>".utf8)))
    }

    // MARK: - Protocol

    func testTabPermittedDecodesFavicon() throws {
        let png = try Self.makePNG(width: 32, height: 32)
        let message = try Self.decode([
            "type": "tab_permitted", "tabId": 7, "url": "https://example.com/",
            "title": "Example", "origin": "https://example.com", "favicon": Self.dataURL(png),
        ])
        guard case .tabPermitted(_, _, _, _, _, _, let favicon) = message else {
            return XCTFail("expected tab_permitted")
        }
        XCTAssertEqual(favicon, Self.dataURL(png))
    }

    func testMalformedFaviconDoesNotFailTheShare() throws {
        let message = try Self.decode([
            "type": "tab_permitted", "tabId": 7, "url": "https://example.com/",
            "title": "Example", "origin": "https://example.com", "favicon": 42,
        ])
        guard case .tabPermitted(let tabId, _, _, _, _, _, let favicon) = message else {
            return XCTFail("expected tab_permitted")
        }
        XCTAssertEqual(tabId, 7)
        XCTAssertNil(favicon)
    }

    func testTabUpdatedWithoutFaviconStillDecodes() throws {
        let message = try Self.decode([
            "type": "tab_updated", "tabId": 7, "url": "https://example.com/b",
            "title": "B", "origin": "https://example.com",
        ])
        guard case .tabUpdated(_, _, _, _, _, let favicon) = message else {
            return XCTFail("expected tab_updated")
        }
        XCTAssertNil(favicon)
    }

    func testPermittedTabEncodingNeverIncludesFavicon() throws {
        let tab = PermittedTab(
            extensionId: "ext", tabId: 7, url: "https://example.com/", title: "Example",
            origin: "https://example.com", permittedAt: Date(timeIntervalSince1970: 0),
            favicon: try Self.makePNG(width: 32, height: 32)
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(tab)) as? [String: Any]
        )
        XCTAssertNil(object["favicon"])
        XCTAssertEqual(object["tabId"] as? Int, 7)
        let decoded = try JSONDecoder().decode(PermittedTab.self, from: JSONEncoder().encode(tab))
        XCTAssertNil(decoded.favicon)
    }

    // MARK: - Coordinator

    @MainActor
    func testCoordinatorKeepsIconAcrossUpdatesAndOmitsItFromCLI() async throws {
        let coordinator = GatewayCoordinator.shared
        let saved = coordinator.permittedTabs
        defer { coordinator.permittedTabs = saved }
        let png = try Self.makePNG(width: 32, height: 32)
        coordinator.permittedTabs = [
            PermittedTab(
                extensionId: "ext", tabId: 7, url: "https://example.com/a", title: "A",
                origin: "https://example.com", permittedAt: Date()
            ),
        ]

        coordinator.handleExtensionMessage(
            .tabUpdated(tabId: 7, url: "https://example.com/a", title: "A", origin: "https://example.com",
                        accessMode: nil, favicon: Self.dataURL(png)),
            from: "ext"
        )
        XCTAssertEqual(coordinator.permittedTabs.first?.favicon, png)

        // A title update without an icon keeps it; an invalid icon is ignored.
        coordinator.handleExtensionMessage(
            .tabUpdated(tabId: 7, url: "https://example.com/b", title: "B", origin: "https://example.com",
                        accessMode: nil, favicon: "data:image/svg+xml,<svg/>"),
            from: "ext"
        )
        XCTAssertEqual(coordinator.permittedTabs.first?.favicon, png)

        let response = await coordinator.handleCLIRequest(CLIRequest(id: "tabs", method: "list_tabs"))
        let rows = try XCTUnwrap(response.result?.value as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertNil(rows[0]["favicon"])

        // Another origin drops the old site's icon.
        coordinator.handleExtensionMessage(
            .tabUpdated(tabId: 7, url: "https://other.example/", title: "Other", origin: "https://other.example",
                        accessMode: "all_tabs"),
            from: "ext"
        )
        XCTAssertNil(coordinator.permittedTabs.first?.favicon)
    }

    // MARK: - Helpers

    static func dataURL(_ data: Data) -> String {
        TabFavicon.dataURLPrefix + data.base64EncodedString()
    }

    static func decode(_ object: [String: Any]) throws -> ExtensionMessage {
        try JSONDecoder().decode(ExtensionMessage.self, from: JSONSerialization.data(withJSONObject: object))
    }

    static func makePNG(width: Int, height: Int, noise: Bool = false) throws -> Data {
        let rep = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        ))
        let pixels = try XCTUnwrap(rep.bitmapData)
        var seed: UInt32 = 0x9E37_79B9
        for index in 0..<(rep.bytesPerRow * height) {
            if noise {
                seed = seed &* 1_664_525 &+ 1_013_904_223
                pixels[index] = UInt8(truncatingIfNeeded: seed >> 24)
            } else {
                pixels[index] = index % 4 == 3 ? 255 : UInt8(truncatingIfNeeded: index)
            }
        }
        return try XCTUnwrap(rep.representation(using: .png, properties: [:]))
    }
}
