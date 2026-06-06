import Foundation
import GatewayCore
import XCTest
@testable import Gateway

final class AuditLogTests: XCTestCase {
    func testCreatesLogFileWithOwnerOnlyPermissions() throws {
        let path = tempAuditLogPath()
        defer { try? FileManager.default.removeItem(atPath: path) }

        _ = AuditLog(path: path)

        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        let permissions = try XCTUnwrap(attributes[.posixPermissions] as? NSNumber)
        XCTAssertEqual(permissions.intValue & 0o777, 0o600)
    }

    func testWritesStructuredEntriesAndTailsMostRecentLines() async throws {
        let path = tempAuditLogPath()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let log = AuditLog(path: path)

        await log.log(
            action: "permit",
            extensionId: "extension-a",
            tabId: 42,
            url: "https://example.com/",
            agent: "xctest",
            details: ["accessMode": AnyCodable("manual")]
        )
        await log.log(action: "revoke", extensionId: "extension-a", tabId: 42)

        let entries = await log.tail(lines: 1)

        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.action, "revoke")
        XCTAssertEqual(entries.first?.extensionId, "extension-a")
        XCTAssertEqual(entries.first?.tabId, 42)
    }

    func testTailSkipsMalformedLines() async throws {
        let path = tempAuditLogPath()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let log = AuditLog(path: path)

        try "not-json\n".write(toFile: path, atomically: true, encoding: .utf8)
        await log.log(action: "valid", details: ["ok": AnyCodable(true)])

        let entries = await log.tail(lines: 10)

        XCTAssertEqual(entries.map(\.action), ["valid"])
        XCTAssertEqual(entries.first?.details?["ok"]?.value as? Bool, true)
    }

    func testDigestSummarizesLocalAuditLogWithoutSensitiveDetails() async throws {
        let path = tempAuditLogPath()
        defer { try? FileManager.default.removeItem(atPath: path) }

        let auditLog = AuditLog(path: path)
        await auditLog.log(
            action: "paste",
            tabId: 7,
            url: "https://docs.google.com/spreadsheets/d/abc",
            agent: "cli",
            details: [
                "ok": AnyCodable(true),
                "value": AnyCodable("secret pasted value"),
                "textBytes": AnyCodable(19),
            ]
        )
        await auditLog.log(
            action: "eval_script",
            tabId: 7,
            url: "https://docs.google.com/spreadsheets/d/abc",
            agent: "cli",
            details: [
                "approval": AnyCodable(["decision": "approved"]),
                "script": AnyCodable("return 'secret script value'"),
            ]
        )
        await auditLog.log(
            action: "plugin_command_run",
            agent: "cli",
            details: [
                "plugin": AnyCodable("private-plugin"),
                "args": AnyCodable(["prompt": "secret plugin argument"]),
            ]
        )

        guard let digest = await auditLog.digest(period: "day", now: Date().addingTimeInterval(5))?.asJSONObject() else {
            return XCTFail("expected digest")
        }

        XCTAssertEqual(digest["ok"] as? Bool, true)
        XCTAssertEqual(digest["period"] as? String, "day")
        XCTAssertEqual(digest["localOnly"] as? Bool, true)
        XCTAssertEqual(digest["eventCount"] as? Int, 3)
        XCTAssertEqual(digest["uniqueTabCount"] as? Int, 1)
        XCTAssertEqual(rowCount(digest["actions"], key: "action", value: "paste"), 1)
        XCTAssertEqual(rowCount(digest["actions"], key: "action", value: "eval_script"), 1)
        XCTAssertEqual(rowCount(digest["origins"], key: "origin", value: "docs.google.com"), 2)
        XCTAssertEqual(tabCount(digest["tabs"], tabId: 7), 2)
        XCTAssertEqual(rowCount(digest["outcomes"], key: "outcome", value: "ok"), 1)
        XCTAssertEqual(rowCount(digest["outcomes"], key: "outcome", value: "approval:approved"), 1)

        let data = try JSONSerialization.data(withJSONObject: digest, options: [.sortedKeys])
        let text = String(data: data, encoding: .utf8) ?? ""
        XCTAssertFalse(text.contains("secret pasted value"))
        XCTAssertFalse(text.contains("secret script value"))
        XCTAssertFalse(text.contains("secret plugin argument"))
        XCTAssertFalse(text.contains("\"details\""))
    }

    func testDigestSupportsWeeklyAliasAndRejectsUnknownPeriods() async {
        let path = tempAuditLogPath()
        defer { try? FileManager.default.removeItem(atPath: path) }

        let auditLog = AuditLog(path: path)
        await auditLog.log(action: "permit", tabId: 99, url: "https://example.com/", agent: "extension")

        guard let weekly = await auditLog.digest(period: "weekly", now: Date().addingTimeInterval(5))?.asJSONObject() else {
            return XCTFail("expected weekly digest")
        }
        XCTAssertEqual(weekly["ok"] as? Bool, true)
        XCTAssertEqual(weekly["period"] as? String, "week")
        XCTAssertEqual(weekly["eventCount"] as? Int, 1)

        let bad = await auditLog.digest(period: "month")
        XCTAssertNil(bad)
        XCTAssertNil(AuditLog.normalizeDigestPeriod("month"))
    }

    private func tempAuditLogPath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-audit-\(UUID().uuidString).jsonl")
            .path
    }

    private func rowCount(_ rows: Any?, key: String, value: String) -> Int? {
        guard let rows = rows as? [[String: Any]],
              let row = rows.first(where: { $0[key] as? String == value })
        else { return nil }
        return row["count"] as? Int
    }

    private func tabCount(_ rows: Any?, tabId: Int) -> Int? {
        guard let rows = rows as? [[String: Any]],
              let row = rows.first(where: { $0["tabId"] as? Int == tabId })
        else { return nil }
        return row["count"] as? Int
    }
}
