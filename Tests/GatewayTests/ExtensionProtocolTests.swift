import XCTest
import Foundation
@testable import GatewayCore

final class ExtensionProtocolTests: XCTestCase {
    func testCLIJSONContractVersionAndStableKeys() {
        XCTAssertEqual(CLIJSONContract.version, 1)
        XCTAssertEqual(CLIJSONContract.requestEnvelopeKeys, ["id", "method", "params"])
        XCTAssertEqual(CLIJSONContract.responseEnvelopeKeys, ["id", "result", "error"])
        XCTAssertEqual(CLIJSONContract.errorPayloadKeys, [
            "code",
            "message",
            "userMessage",
            "nextCommand",
            "hint",
            "tabId",
            "plugin",
            "command",
            "expectedDomains",
            "candidates",
        ])
        XCTAssertEqual(CLIJSONContract.stderrErrorKeys, [
            "error",
            "message",
            "userMessage",
            "nextCommand",
            "hint",
            "tabId",
            "plugin",
            "command",
            "expectedDomains",
            "candidates",
        ])
    }

    func testCLIResponseEncodesStructuredErrorPayload() throws {
        let response = CLIResponse(
            id: "request-1",
            error: ErrorPayload(
                code: "no_matching_tab",
                message: "No shared tab matches the plugin domain policy.",
                userMessage: "Share the target tab, then retry.",
                nextCommand: "abg tabs --compact",
                hint: "Use the extension popup to share the tab.",
                tabId: 123,
                plugin: "slack",
                command: "catch-up",
                expectedDomains: ["*.slack.com"],
                candidates: [
                    ErrorPayload.TabCandidate(
                        ref: "t1",
                        tabId: 123,
                        title: "Slack",
                        url: "https://example.slack.com/",
                        accessMode: "manual"
                    ),
                ]
            )
        )

        let data = try JSONEncoder().encode(response)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let error = try XCTUnwrap(object["error"] as? [String: Any])
        let candidates = try XCTUnwrap(error["candidates"] as? [[String: Any]])

        XCTAssertEqual(object["id"] as? String, "request-1")
        XCTAssertNil(object["result"])
        XCTAssertEqual(error["code"] as? String, "no_matching_tab")
        XCTAssertEqual(error["message"] as? String, "No shared tab matches the plugin domain policy.")
        XCTAssertEqual(error["userMessage"] as? String, "Share the target tab, then retry.")
        XCTAssertEqual(error["nextCommand"] as? String, "abg tabs --compact")
        XCTAssertEqual(error["hint"] as? String, "Use the extension popup to share the tab.")
        XCTAssertEqual(error["tabId"] as? Int, 123)
        XCTAssertEqual(error["plugin"] as? String, "slack")
        XCTAssertEqual(error["command"] as? String, "catch-up")
        XCTAssertEqual(error["expectedDomains"] as? [String], ["*.slack.com"])
        XCTAssertEqual(candidates.first?["ref"] as? String, "t1")
        XCTAssertEqual(candidates.first?["tabId"] as? Int, 123)
        XCTAssertEqual(candidates.first?["title"] as? String, "Slack")
        XCTAssertEqual(candidates.first?["url"] as? String, "https://example.slack.com/")
        XCTAssertEqual(candidates.first?["accessMode"] as? String, "manual")
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
}
