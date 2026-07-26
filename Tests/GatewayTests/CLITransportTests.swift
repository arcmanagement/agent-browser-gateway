import XCTest
@testable import Gateway
@testable import GatewayCore

final class CLITransportTests: XCTestCase {
    // MARK: - Socket path selection

    func testUnsandboxedGatewayKeepsStandardSocketPath() {
        let env: [String: String] = [:]
        let path = ABGConstants.configuredCLISocketPath(environment: env)
        XCTAssertTrue(path.hasSuffix("AgentBrowserGateway/gateway.sock"))
        XCTAssertFalse(path.contains("Group Containers"))
    }

    func testSandboxedGatewayBindsInGroupContainer() {
        let env = ["APP_SANDBOX_CONTAINER_ID": ABGConstants.bundleId]
        let path = ABGConstants.configuredCLISocketPath(environment: env)
        XCTAssertTrue(path.contains(ABGConstants.appGroupId))
        XCTAssertTrue(path.hasSuffix("/abg.sock"))
    }

    func testSandboxedDevProfileUsesProfiledSocketName() {
        let env = [
            "APP_SANDBOX_CONTAINER_ID": ABGConstants.bundleId,
            "ABG_PORT": "8766",
        ]
        XCTAssertTrue(ABGConstants.configuredCLISocketPath(environment: env).hasSuffix("/abg-dev.sock"))
    }

    func testStateDirOverrideWinsEvenWhenSandboxed() {
        let env = [
            "APP_SANDBOX_CONTAINER_ID": ABGConstants.bundleId,
            "ABG_STATE_DIR": "~/custom-abg-state",
        ]
        let path = ABGConstants.configuredCLISocketPath(environment: env)
        XCTAssertTrue(path.hasSuffix("custom-abg-state/gateway.sock"))
        XCTAssertEqual(ABGConstants.cliSocketCandidates(environment: env), [path])
        XCTAssertEqual(ABGConstants.cliEndpointCandidates(environment: env).count, 1)
    }

    func testClientProbesStandardPathBeforeGroupContainer() {
        let env: [String: String] = [:]
        let candidates = ABGConstants.cliSocketCandidates(environment: env)
        XCTAssertEqual(candidates.count, 2)
        XCTAssertTrue(candidates[0].hasSuffix("AgentBrowserGateway/gateway.sock"))
        XCTAssertTrue(candidates[1].contains(ABGConstants.appGroupId))
        // The gateway's own app container is intentionally not probed.
        XCTAssertFalse(candidates.contains { $0.contains("/Containers/\(ABGConstants.bundleId)/") })
    }

    func testGroupDirOverrideRedirectsGroupCandidates() {
        let env = ["ABG_GROUP_DIR": "~/custom-abg-group"]
        let candidates = ABGConstants.cliSocketCandidates(environment: env)
        XCTAssertTrue(candidates[1].hasSuffix("custom-abg-group/abg.sock"))
    }

    func testEndpointFileNameCarriesProfile() {
        XCTAssertEqual(ABGConstants.cliEndpointFileName(environment: [:]), "cli-endpoint.json")
        XCTAssertEqual(ABGConstants.cliEndpointFileName(environment: ["ABG_PORT": "8766"]), "cli-endpoint-dev.json")
    }

    func testUnixSocketPathByteGuard() {
        XCTAssertTrue(ABGConstants.fitsUnixSocketPath(String(repeating: "a", count: 103)))
        XCTAssertFalse(ABGConstants.fitsUnixSocketPath(String(repeating: "a", count: 104)))
        // Multibyte paths are measured in UTF-8 bytes, not characters.
        XCTAssertFalse(ABGConstants.fitsUnixSocketPath(String(repeating: "あ", count: 35)))
    }

    // MARK: - Sandboxed media output redirection

    func testSandboxedScreenshotsDirMovesToGroupContainer() {
        let sandboxed = ["APP_SANDBOX_CONTAINER_ID": ABGConstants.bundleId]
        XCTAssertTrue(ABGConstants.configuredScreenshotsDir(environment: sandboxed).path.contains(ABGConstants.appGroupId))
        XCTAssertFalse(ABGConstants.configuredScreenshotsDir(environment: [:]).path.contains(ABGConstants.appGroupId))
    }

    // MARK: - /cli upgrade authorization

    func testCLIUpgradeRequiresExactToken() {
        XCTAssertTrue(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: "secret", expectedToken: "secret"))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: "wrong", expectedToken: "secret"))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: "secre", expectedToken: "secret"))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: nil, expectedToken: "secret"))
    }

    func testCLIUpgradeRejectsAnyOriginBearingRequest() {
        // Browsers always send Origin and cannot set custom headers; a request that
        // carries both a valid token and an Origin is still refused.
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: "https://example.com", token: "secret", expectedToken: "secret"))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: "chrome-extension://abc", token: "secret", expectedToken: "secret"))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: "", token: "secret", expectedToken: "secret"))
    }

    func testCLIUpgradeRejectsWhenNoTokenConfigured() {
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: "", expectedToken: ""))
        XCTAssertFalse(WSServer.isAuthorizedCLIUpgrade(origin: nil, token: "anything", expectedToken: ""))
    }

    // MARK: - Endpoint file

    func testEndpointFileIsOwnerOnlyJSONWithTokenAndPort() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-cli-endpoint-test-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let env = [
            "ABG_STATE_DIR": base.appendingPathComponent("state").path,
            "ABG_GROUP_DIR": base.appendingPathComponent("group").path,
        ]

        let token = CLIEndpoint.generateToken()
        XCTAssertEqual(token.utf8.count, 64)

        let written = CLIEndpoint.write(token: token, port: 8765, environment: env)
        // ABG_STATE_DIR pins a single rendezvous location.
        XCTAssertEqual(written.count, 1)

        for path in written {
            let attrs = try FileManager.default.attributesOfItem(atPath: path)
            XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.uint16Value, 0o600)
            let data = try XCTUnwrap(FileManager.default.contents(atPath: path))
            let payload = try JSONDecoder().decode(CLIEndpoint.Payload.self, from: data)
            XCTAssertEqual(payload.token, token)
            XCTAssertEqual(payload.port, 8765)
        }
    }

    func testEndpointCandidatesCoverBothRendezvousDirsWithoutStateOverride() {
        let candidates = ABGConstants.cliEndpointCandidates(environment: [:])
        XCTAssertEqual(candidates.count, 2)
        XCTAssertTrue(candidates[0].hasSuffix("AgentBrowserGateway/cli-endpoint.json"))
        XCTAssertTrue(candidates[1].contains(ABGConstants.appGroupId))
    }

    func testTokensAreUnpredictablyUnique() {
        XCTAssertNotEqual(CLIEndpoint.generateToken(), CLIEndpoint.generateToken())
    }

    func testConstantTimeEquals() {
        XCTAssertTrue(CLIEndpoint.constantTimeEquals("abc", "abc"))
        XCTAssertFalse(CLIEndpoint.constantTimeEquals("abc", "abd"))
        XCTAssertFalse(CLIEndpoint.constantTimeEquals("abc", "ab"))
        XCTAssertTrue(CLIEndpoint.constantTimeEquals("", ""))
    }
}
