import XCTest
import Foundation
@testable import GatewayCore

final class ExtensionProtocolTests: XCTestCase {
    func testCLIJSONContractVersionAndStableKeys() {
        XCTAssertEqual(CLIJSONContract.version, 1)
        XCTAssertEqual(CLIJSONContract.requestEnvelopeKeys, ["id", "method", "params"])
        XCTAssertEqual(CLIJSONContract.responseEnvelopeKeys, ["id", "result", "error"])
        XCTAssertEqual(CLIJSONContract.waitResultKeysByMode["sleep"], ["ok", "mode", "ms"])
        XCTAssertEqual(CLIJSONContract.waitResultKeysByMode["selector"], ["ok", "mode", "found", "elapsedMs", "selector"])
        XCTAssertEqual(CLIJSONContract.waitResultKeysByMode["load_then_selector"], ["ok", "mode", "phase", "load", "selector"])
        XCTAssertEqual(CLIJSONContract.recordFlowKeys, ["tabId", "out", "name", "startedAt", "finishedAt", "match", "steps"])
        XCTAssertEqual(CLIJSONContract.recordFlowMatchKeys, ["tabId", "url", "title", "first"])
        XCTAssertEqual(CLIJSONContract.replayDryRunKeys, ["tabId", "steps"])
        XCTAssertEqual(CLIJSONContract.replayResultKeys, ["ok", "tabId", "results"])
        XCTAssertEqual(CLIJSONContract.replayResultRowKeys, ["index", "op", "result"])
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

    func testWorkflowJSONContractFixturesMatchCodeConstants() throws {
        let waitFixture = try loadFixture("wait-result.schema")
        let waitModes = try XCTUnwrap(waitFixture["modes"] as? [String: [String]])
        XCTAssertEqual(waitModes, CLIJSONContract.waitResultKeysByMode)

        let recordFixture = try loadFixture("record-flow.schema")
        XCTAssertEqual(recordFixture["stableKeys"] as? [String], CLIJSONContract.recordFlowKeys)
        XCTAssertEqual(recordFixture["matchKeys"] as? [String], CLIJSONContract.recordFlowMatchKeys)
        let recordExample = try XCTUnwrap(recordFixture["example"] as? [String: Any])
        XCTAssertFixtureKeys(recordExample, include: CLIJSONContract.recordFlowKeys)
        XCTAssertNotNil(recordExample["steps"] as? [[String: Any]])

        let replayFixture = try loadFixture("replay-result.schema")
        XCTAssertEqual(replayFixture["dryRunKeys"] as? [String], CLIJSONContract.replayDryRunKeys)
        XCTAssertEqual(replayFixture["resultKeys"] as? [String], CLIJSONContract.replayResultKeys)
        XCTAssertEqual(replayFixture["resultRowKeys"] as? [String], CLIJSONContract.replayResultRowKeys)
        let examples = try XCTUnwrap(replayFixture["examples"] as? [String: Any])
        let dryRun = try XCTUnwrap(examples["dryRun"] as? [String: Any])
        XCTAssertFixtureKeys(dryRun, include: CLIJSONContract.replayDryRunKeys)
        let executed = try XCTUnwrap(examples["executed"] as? [String: Any])
        XCTAssertFixtureKeys(executed, include: CLIJSONContract.replayResultKeys)
        let results = try XCTUnwrap(executed["results"] as? [[String: Any]])
        XCTAssertFixtureKeys(try XCTUnwrap(results.first), include: CLIJSONContract.replayResultRowKeys)
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

    private func loadFixture(_ name: String) throws -> [String: Any] {
        let testFileURL = URL(fileURLWithPath: #filePath)
        let fixtureURL = testFileURL
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/cli-json-contract/\(name).json")
        let data = try Data(contentsOf: fixtureURL)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func XCTAssertFixtureKeys(
        _ object: [String: Any],
        include expectedKeys: [String],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let objectKeys = Set(object.keys)
        for key in expectedKeys {
            XCTAssertTrue(objectKeys.contains(key), "missing key: \(key)", file: file, line: line)
        }
    }

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
