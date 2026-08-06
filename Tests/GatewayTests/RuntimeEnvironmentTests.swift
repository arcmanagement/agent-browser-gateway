import XCTest
@testable import GatewayCore

final class RuntimeEnvironmentTests: XCTestCase {
    func testProductionDefaultsRemainStable() {
        let env: [String: String] = [:]

        XCTAssertEqual(ABGConstants.configuredWsPort(environment: env), 8765)
        XCTAssertNil(ABGConstants.configuredProfile(environment: env))
        XCTAssertEqual(ABGConstants.configuredSupportDir(environment: env).lastPathComponent, "AgentBrowserGateway")
        XCTAssertEqual(ABGConstants.configuredLogsDir(environment: env).lastPathComponent, "AgentBrowserGateway")
        XCTAssertEqual(ABGConstants.configuredUserDir(environment: env).lastPathComponent, ".abg")
    }

    func testNonDefaultPortDefaultsToDevProfile() {
        let env = ["ABG_PORT": "8766"]

        XCTAssertEqual(ABGConstants.configuredWsPort(environment: env), 8766)
        XCTAssertEqual(ABGConstants.configuredProfile(environment: env), "dev")
        XCTAssertEqual(ABGConstants.configuredSupportDir(environment: env).lastPathComponent, "AgentBrowserGateway-dev")
        XCTAssertEqual(ABGConstants.configuredLogsDir(environment: env).lastPathComponent, "AgentBrowserGateway-dev")
        XCTAssertEqual(ABGConstants.configuredUserDir(environment: env).lastPathComponent, ".abg-dev")
        XCTAssertEqual(ABGConstants.configuredScreenshotsDir(environment: env).deletingLastPathComponent().lastPathComponent, "abg-dev")
        XCTAssertEqual(ABGConstants.configuredRecordingsDir(environment: env).lastPathComponent, "recordings")
        XCTAssertEqual(ABGConstants.configuredRecordingsDir(environment: env).deletingLastPathComponent().lastPathComponent, "abg-dev")
    }

    func testRecordingsDirDefaultsToProductionComponent() {
        let env: [String: String] = [:]
        XCTAssertEqual(ABGConstants.configuredRecordingsDir(environment: env).lastPathComponent, "recordings")
        XCTAssertEqual(ABGConstants.configuredRecordingsDir(environment: env).deletingLastPathComponent().lastPathComponent, "abg")
    }

    func testExplicitProductionProfileKeepsProductionStateWithCustomPort() {
        let env = ["ABG_PORT": "9000", "ABG_PROFILE": "prod"]

        XCTAssertEqual(ABGConstants.configuredWsPort(environment: env), 9000)
        XCTAssertNil(ABGConstants.configuredProfile(environment: env))
        XCTAssertEqual(ABGConstants.configuredSupportDir(environment: env).lastPathComponent, "AgentBrowserGateway")
        XCTAssertEqual(ABGConstants.configuredUserDir(environment: env).lastPathComponent, ".abg")
    }

    func testEmptyProfileStillInfersDevFromCustomPort() {
        let env = ["ABG_PORT": "8766", "ABG_PROFILE": ""]

        XCTAssertEqual(ABGConstants.configuredProfile(environment: env), "dev")
    }

    func testDirectoryOverridesWinOverProfileDefaults() {
        let env = [
            "ABG_PORT": "8766",
            "ABG_STATE_DIR": "~/custom-abg-state",
            "ABG_LOGS_DIR": "~/custom-abg-logs",
            "ABG_USER_DIR": "~/custom-abg-user",
        ]

        XCTAssertEqual(ABGConstants.configuredSupportDir(environment: env).lastPathComponent, "custom-abg-state")
        XCTAssertEqual(ABGConstants.configuredLogsDir(environment: env).lastPathComponent, "custom-abg-logs")
        XCTAssertEqual(ABGConstants.configuredUserDir(environment: env).lastPathComponent, "custom-abg-user")
    }
}
