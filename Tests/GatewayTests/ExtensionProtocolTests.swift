import XCTest
import Foundation
@testable import GatewayCore

final class ExtensionProtocolTests: XCTestCase {
    func testPermittedTabExpirationIsOptionalAndTimeBounded() {
        let now = Date()
        let unbounded = PermittedTab(
            extensionId: "extension-1",
            tabId: 1,
            url: "https://example.com/",
            title: "Example",
            origin: "https://example.com",
            permittedAt: now
        )
        let future = PermittedTab(
            extensionId: "extension-1",
            tabId: 2,
            url: "https://example.com/future",
            title: "Future",
            origin: "https://example.com",
            permittedAt: now,
            expiresAt: now.addingTimeInterval(60)
        )
        let expired = PermittedTab(
            extensionId: "extension-1",
            tabId: 3,
            url: "https://example.com/expired",
            title: "Expired",
            origin: "https://example.com",
            permittedAt: now.addingTimeInterval(-120),
            expiresAt: now.addingTimeInterval(-60)
        )

        XCTAssertFalse(unbounded.isExpired)
        XCTAssertFalse(future.isExpired)
        XCTAssertTrue(expired.isExpired)
    }

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

    func testDecodesTabRevokedWithSafeFallbackReason() throws {
        let json = """
        {
          "type": "tab_revoked",
          "tabId": 42
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(ExtensionMessage.self, from: json)

        guard case .tabRevoked(let tabId, let reason) = message else {
            return XCTFail("expected tab_revoked")
        }
        XCTAssertEqual(tabId, 42)
        XCTAssertEqual(reason, "unknown")
    }

    func testGatewayCommandRoundTripsStructuredParams() throws {
        let command = GatewayCommand(
            id: "cmd-1",
            method: "click_selector",
            params: AnyCodable([
                "tabId": 7,
                "selector": "#submit",
                "dryRun": true,
                "tags": ["consent", "operation"],
            ])
        )

        let data = try JSONEncoder().encode(command)
        let decoded = try JSONDecoder().decode(GatewayCommand.self, from: data)
        let params = try XCTUnwrap(decoded.params?.value as? [String: Any])

        XCTAssertEqual(decoded.id, "cmd-1")
        XCTAssertEqual(decoded.method, "click_selector")
        XCTAssertEqual(params["tabId"] as? Int, 7)
        XCTAssertEqual(params["selector"] as? String, "#submit")
        XCTAssertEqual(params["dryRun"] as? Bool, true)
        XCTAssertEqual(params["tags"] as? [String], ["consent", "operation"])
    }

    func testCLIResponsePreservesStructuredErrorContext() throws {
        let response = CLIResponse(
            id: "req-1",
            error: ErrorPayload(
                code: "tab_not_permitted",
                message: "Tab is not shared with ABG.",
                userMessage: "Share this tab before running the command.",
                nextCommand: "abg tabs",
                hint: "Use the extension popup to share a tab.",
                tabId: 123,
                expectedDomains: ["https://example.com"],
                candidates: [
                    ErrorPayload.TabCandidate(
                        ref: "@1",
                        tabId: 123,
                        title: "Example",
                        url: "https://example.com/",
                        accessMode: "manual"
                    ),
                ]
            )
        )

        let data = try JSONEncoder().encode(response)
        let decoded = try JSONDecoder().decode(CLIResponse.self, from: data)
        let error = try XCTUnwrap(decoded.error)
        let candidate = try XCTUnwrap(error.candidates?.first)

        XCTAssertEqual(decoded.id, "req-1")
        XCTAssertNil(decoded.result)
        XCTAssertEqual(error.code, "tab_not_permitted")
        XCTAssertEqual(error.userMessage, "Share this tab before running the command.")
        XCTAssertEqual(error.nextCommand, "abg tabs")
        XCTAssertEqual(error.hint, "Use the extension popup to share a tab.")
        XCTAssertEqual(error.tabId, 123)
        XCTAssertEqual(error.expectedDomains, ["https://example.com"])
        XCTAssertEqual(candidate.ref, "@1")
        XCTAssertEqual(candidate.tabId, 123)
        XCTAssertEqual(candidate.title, "Example")
        XCTAssertEqual(candidate.url, "https://example.com/")
        XCTAssertEqual(candidate.accessMode, "manual")
    }
}
