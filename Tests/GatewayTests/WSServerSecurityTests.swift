import XCTest
@testable import Gateway

final class WSServerSecurityTests: XCTestCase {
    func testAllowsBrowserExtensionOrigins() {
        XCTAssertTrue(WSServer.isAllowedWebSocketOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"))
        XCTAssertTrue(WSServer.isAllowedWebSocketOrigin("moz-extension://2c6c59b3-3eb9-4868-8d55-304a0eb29f2c"))
        XCTAssertTrue(WSServer.isAllowedWebSocketOrigin("safari-web-extension://com.example.agent-browser-gateway"))
        XCTAssertTrue(WSServer.isAllowedWebSocketOrigin("CHROME-EXTENSION://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"))
    }

    func testRejectsWebFileNullAndMissingOrigins() {
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin(nil))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin(""))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("https://example.com"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("http://127.0.0.1:8765"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("file://local"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("null"))
    }

    func testRejectsMalformedExtensionLikeOrigins() {
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("chrome-extension://"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("chrome-extension.evil://abcdefghijklmnopabcdefghijklmnop"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop/path"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("chrome-extension://user@abcdefghijklmnopabcdefghijklmnop"))
        XCTAssertFalse(WSServer.isAllowedWebSocketOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop?debug=true"))
    }

    func testBindFailureStatusGuidesPortConflictRecovery() {
        let error = NSError(
            domain: "NIO",
            code: 48,
            userInfo: [NSLocalizedDescriptionKey: "Address already in use"]
        )

        let message = WSServer.bindFailureStatus(
            error: error,
            attempt: 3,
            totalAttempts: 7,
            port: 8765
        )

        XCTAssertTrue(message.contains("attempt 3/7"))
        XCTAssertTrue(message.contains("127.0.0.1:8765"))
        XCTAssertTrue(message.contains("Address already in use"))
        XCTAssertTrue(message.contains("lsof -nP -iTCP:8765 -sTCP:LISTEN"))
    }
}
