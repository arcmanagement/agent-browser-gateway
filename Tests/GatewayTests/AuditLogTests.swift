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

    private func tempAuditLogPath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-audit-\(UUID().uuidString).jsonl")
            .path
    }
}
