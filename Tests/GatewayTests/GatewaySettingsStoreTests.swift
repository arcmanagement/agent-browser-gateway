import XCTest
@testable import GatewayCore

final class GatewaySettingsStoreTests: XCTestCase {
    func testMissingSettingsUseDefaults() throws {
        let userDir = try makeTemporaryUserDirectory()
        defer { try? FileManager.default.removeItem(at: userDir) }

        let settings = GatewaySettingsStore.load(userDirectory: userDir)

        XCTAssertEqual(settings.defaultTimeoutMs, GatewaySettings.defaultTimeoutMs)
        XCTAssertEqual(settings.approvalModeDefault, .extensionPopup)
        XCTAssertTrue(settings.domainPolicies.isEmpty)
        XCTAssertEqual(GatewaySettingsStore.settingsFile(userDirectory: userDir).lastPathComponent, "gateway-settings.json")
    }

    func testSaveLoadNormalizesSettingsAndUsesOwnerOnlyFile() throws {
        let userDir = try makeTemporaryUserDirectory()
        defer { try? FileManager.default.removeItem(at: userDir) }

        let settings = GatewaySettings(
            defaultTimeoutMs: 999,
            approvalModeDefault: .requireApproval,
            domainPolicies: [
                GatewayDomainPolicy(
                    domain: " HTTPS://Example.com/path ",
                    approvalMode: .trustedAutomation,
                    timeoutMs: 999_999,
                    appliesToSubdomains: true
                ),
                GatewayDomainPolicy(
                    domain: "example.com",
                    approvalMode: .requireApproval,
                    timeoutMs: 2_000,
                    appliesToSubdomains: false
                ),
                GatewayDomainPolicy(domain: "not a domain", approvalMode: .extensionPopup, timeoutMs: 30_000),
            ]
        )

        try GatewaySettingsStore.save(settings, userDirectory: userDir)
        let loaded = GatewaySettingsStore.load(userDirectory: userDir)

        XCTAssertEqual(loaded.defaultTimeoutMs, GatewaySettings.minimumTimeoutMs)
        XCTAssertEqual(loaded.approvalModeDefault, .requireApproval)
        XCTAssertEqual(loaded.domainPolicies, [
            GatewayDomainPolicy(
                domain: "example.com",
                approvalMode: .requireApproval,
                timeoutMs: 2_000,
                appliesToSubdomains: false
            ),
        ])

        let attributes = try FileManager.default.attributesOfItem(atPath: GatewaySettingsStore.settingsFile(userDirectory: userDir).path)
        let permissions = try XCTUnwrap(attributes[.posixPermissions] as? NSNumber)
        XCTAssertEqual(permissions.intValue & 0o077, 0)
    }

    func testCorruptSettingsFallBackToDefaults() throws {
        let userDir = try makeTemporaryUserDirectory()
        defer { try? FileManager.default.removeItem(at: userDir) }
        try FileManager.default.createDirectory(at: userDir, withIntermediateDirectories: true)
        try Data("{".utf8).write(to: GatewaySettingsStore.settingsFile(userDirectory: userDir))

        let settings = GatewaySettingsStore.load(userDirectory: userDir)

        XCTAssertEqual(settings, GatewaySettings())
    }

    private func makeTemporaryUserDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-settings-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
