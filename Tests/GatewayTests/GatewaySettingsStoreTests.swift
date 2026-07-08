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
                    action: .allow,
                    approvalMode: .trustedAutomation,
                    timeoutMs: 999_999,
                    appliesToSubdomains: true
                ),
                GatewayDomainPolicy(
                    domain: "example.com",
                    action: .deny,
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
                action: .deny,
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

    func testDomainPolicyMatchesMostSpecificURLHost() throws {
        let settings = GatewaySettings(domainPolicies: [
            GatewayDomainPolicy(domain: "example.com", action: .ask, timeoutMs: 3_000, appliesToSubdomains: true),
            GatewayDomainPolicy(domain: "app.example.com", action: .allow, timeoutMs: 4_000, appliesToSubdomains: false),
            GatewayDomainPolicy(domain: "*.internal.test", action: .deny, timeoutMs: 5_000),
        ])

        XCTAssertEqual(settings.policy(for: "https://app.example.com/path")?.action, .allow)
        XCTAssertEqual(settings.policy(for: "https://docs.example.com/path")?.action, .ask)
        XCTAssertEqual(settings.policy(for: "https://team.internal.test/path")?.action, .deny)
        XCTAssertNil(settings.policy(for: "file:///tmp/example.html"))
    }

    func testLegacyApprovalModePoliciesDecodeToActions() throws {
        let json = """
        {
          "defaultTimeoutMs": 30000,
          "approvalModeDefault": "extension_popup",
          "domainPolicies": [
            {
              "domain": "trusted.example",
              "approvalMode": "trusted_automation",
              "timeoutMs": 30000,
              "appliesToSubdomains": true
            },
            {
              "domain": "ask.example",
              "approvalMode": "require_approval",
              "timeoutMs": 30000,
              "appliesToSubdomains": true
            }
          ]
        }
        """

        let settings = try JSONDecoder().decode(GatewaySettings.self, from: Data(json.utf8))

        XCTAssertEqual(settings.policy(for: "https://trusted.example")?.action, .allow)
        XCTAssertEqual(settings.policy(for: "https://ask.example")?.action, .ask)
    }

    private func makeTemporaryUserDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-settings-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
