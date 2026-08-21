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
            "matchCount",
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
            "matchCount",
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

    func testAmbiguousSelectorErrorRoundTripsMatchCount() throws {
        let wire = Data("""
        {"type":"response","id":"cmd-1","error":{"code":"ambiguous_selector","message":"selector matched 3 elements; nothing was clicked.","matchCount":3}}
        """.utf8)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: wire) as? [String: Any])
        let errorObject = try XCTUnwrap(object["error"] as? [String: Any])
        let payload = try JSONDecoder().decode(
            ErrorPayload.self,
            from: JSONSerialization.data(withJSONObject: errorObject)
        )
        XCTAssertEqual(payload.code, "ambiguous_selector")
        XCTAssertEqual(payload.matchCount, 3)

        let encoded = try JSONEncoder().encode(CLIResponse(id: "cmd-1", error: payload))
        let reencoded = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let reencodedError = try XCTUnwrap(reencoded["error"] as? [String: Any])
        XCTAssertEqual(reencodedError["matchCount"] as? Int, 3)
        XCTAssertTrue(CLIJSONContract.errorPayloadKeys.contains("matchCount"))
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

    func testDecodesRecordChunk() throws {
        let json = """
        {
          "type": "record_chunk",
          "recordingId": "rec-1",
          "seq": 3,
          "dataBase64": "AAECAw=="
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(ExtensionMessage.self, from: json)

        guard case .recordChunk(let recordingId, let seq, let dataBase64) = message else {
            return XCTFail("expected record_chunk")
        }
        XCTAssertEqual(recordingId, "rec-1")
        XCTAssertEqual(seq, 3)
        XCTAssertEqual(dataBase64, "AAECAw==")
    }

    func testDecodesRecordStopped() throws {
        let json = """
        {
          "type": "record_stopped",
          "recordingId": "rec-2",
          "durationMs": 5000,
          "mime": "video/webm;codecs=vp9,opus",
          "micUsed": true,
          "chunkCount": 5
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(ExtensionMessage.self, from: json)

        guard case .recordStopped(let recordingId, let durationMs, let mime, let micUsed, let chunkCount) = message else {
            return XCTFail("expected record_stopped")
        }
        XCTAssertEqual(recordingId, "rec-2")
        XCTAssertEqual(durationMs, 5000)
        XCTAssertEqual(mime, "video/webm;codecs=vp9,opus")
        XCTAssertTrue(micUsed)
        XCTAssertEqual(chunkCount, 5)
    }

    func testDecodesRecordFailedWithFallbackMessage() throws {
        let json = """
        {
          "type": "record_failed",
          "recordingId": "rec-3"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(ExtensionMessage.self, from: json)

        guard case .recordFailed(let recordingId, let error) = message else {
            return XCTFail("expected record_failed")
        }
        XCTAssertEqual(recordingId, "rec-3")
        XCTAssertEqual(error, "recording failed")
    }

    func testRecordChunkRoundTripsThroughWireType() throws {
        let message = ExtensionMessage.recordChunk(recordingId: "rec-4", seq: 0, dataBase64: "Zm9v")
        let data = try JSONEncoder().encode(message)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "record_chunk")
        XCTAssertEqual(object["recordingId"] as? String, "rec-4")
        XCTAssertEqual(object["seq"] as? Int, 0)
        XCTAssertEqual(object["dataBase64"] as? String, "Zm9v")

        let decoded = try JSONDecoder().decode(ExtensionMessage.self, from: data)
        guard case .recordChunk(let recordingId, _, let dataBase64) = decoded else {
            return XCTFail("expected record_chunk")
        }
        XCTAssertEqual(recordingId, "rec-4")
        XCTAssertEqual(dataBase64, "Zm9v")
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
