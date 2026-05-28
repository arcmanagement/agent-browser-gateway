import XCTest
import Foundation
@testable import GatewayCore

final class ExtensionProtocolTests: XCTestCase {
    func testDecodesTabAccessMode() throws {
        let json = """
        {
          "type": "tab_permitted",
          "tabId": 42,
          "url": "https://example.com/",
          "title": "Example",
          "origin": "https://example.com",
          "accessMode": "all_tabs"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(ExtensionMessage.self, from: json)

        guard case .tabPermitted(_, _, _, _, _, let accessMode) = message else {
            return XCTFail("expected tab_permitted")
        }
        XCTAssertEqual(accessMode, "all_tabs")
    }
}
