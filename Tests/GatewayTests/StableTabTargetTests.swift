import XCTest
@testable import Gateway
@testable import GatewayCore

final class StableTabTargetTests: XCTestCase {
    func testTargetRemainsStableWhenOtherTabsAreAdded() {
        var registry = StableTabTargetRegistry()
        let selected = StableTabIdentity(extensionId: "profile-a", tabId: 42)

        let first = registry.target(for: selected)
        _ = registry.target(for: StableTabIdentity(extensionId: "profile-a", tabId: 99))
        _ = registry.target(for: StableTabIdentity(extensionId: "profile-b", tabId: 7))

        XCTAssertEqual(registry.target(for: selected), first)
        XCTAssertEqual(registry.identity(forTargetId: first.targetId), selected)
    }

    func testSameChromeTabIdInDifferentProfilesGetsDistinctTargets() {
        var registry = StableTabTargetRegistry()
        let profileA = StableTabIdentity(extensionId: "profile-a", tabId: 42)
        let profileB = StableTabIdentity(extensionId: "profile-b", tabId: 42)

        let targetA = registry.target(for: profileA)
        let targetB = registry.target(for: profileB)

        XCTAssertNotEqual(targetA.ref, targetB.ref)
        XCTAssertNotEqual(targetA.targetId, targetB.targetId)
        XCTAssertLessThan(targetA.targetId, 0)
        XCTAssertLessThan(targetB.targetId, 0)
        XCTAssertEqual(registry.identity(forTargetId: targetA.targetId), profileA)
        XCTAssertEqual(registry.identity(forTargetId: targetB.targetId), profileB)
    }

    func testRefResolutionDoesNotDependOnListPosition() {
        let targets = [
            StableTabTarget(ref: "t2", targetId: -2),
            StableTabTarget(ref: "t1", targetId: -1),
        ]

        XCTAssertEqual(
            StableTabTargetRegistry.targetId(forRef: "t1", in: targets),
            -1
        )
        XCTAssertEqual(
            StableTabTargetRegistry.targetId(forRef: "T2", in: targets),
            -2
        )
    }

    func testRemovedTabIdGetsANewTargetWhenChromeReusesIt() {
        var registry = StableTabTargetRegistry()
        let identity = StableTabIdentity(extensionId: "profile-a", tabId: 42)
        let original = registry.target(for: identity)

        registry.remove(identity)
        let reused = registry.target(for: identity)

        XCTAssertNotEqual(reused, original)
        XCTAssertNil(registry.identity(forTargetId: original.targetId))
        XCTAssertEqual(registry.identity(forTargetId: reused.targetId), identity)
    }

    func testEvalScriptLimitsExposeRecommendedAndHardMaximum() {
        XCTAssertEqual(EvalScriptLimits.recommendedBytes, 65_536)
        XCTAssertEqual(EvalScriptLimits.maximumBytes, 262_144)
        XCTAssertEqual(EvalScriptLimits.defaultTimeoutMs, 75_000)
        XCTAssertLessThan(EvalScriptLimits.recommendedBytes, EvalScriptLimits.maximumBytes)
    }

    @MainActor
    func testCoordinatorKeepsRefsStableAcrossReorderingAndProfiles() async throws {
        let coordinator = GatewayCoordinator.shared
        coordinator.permittedTabs = []
        coordinator.connectedExtensionIds = []
        coordinator.extensionProfiles = [:]
        coordinator.extensionBrowsers = [:]
        coordinator.extensionVersions = [:]
        defer {
            coordinator.permittedTabs = []
            coordinator.connectedExtensionIds = []
            coordinator.extensionProfiles = [:]
            coordinator.extensionBrowsers = [:]
            coordinator.extensionVersions = [:]
        }
        coordinator.handleExtensionMessage(
            ExtensionMessage.hello(
                extensionId: "profile-a",
                version: "test",
                profileLabel: "Profile A",
                browserKind: "chrome"
            ),
            from: "profile-a"
        )
        coordinator.handleExtensionMessage(
            ExtensionMessage.tabPermitted(
                tabId: 42,
                url: "https://example.com/a",
                title: "A",
                origin: "https://example.com",
                expiresAt: nil,
                accessMode: "all_tabs"
            ),
            from: "profile-a"
        )

        let initial = try tabRows(
            from: await coordinator.handleCLIRequest(CLIRequest(id: "initial", method: "list_tabs"))
        )
        let initialProfileA = try XCTUnwrap(initial.first)
        let profileARef = try XCTUnwrap(initialProfileA["ref"] as? String)
        let profileATargetId = try XCTUnwrap(initialProfileA["targetId"] as? Int)

        coordinator.handleExtensionMessage(
            ExtensionMessage.hello(
                extensionId: "profile-b",
                version: "test",
                profileLabel: "Profile B",
                browserKind: "chrome"
            ),
            from: "profile-b"
        )
        coordinator.handleExtensionMessage(
            ExtensionMessage.tabPermitted(
                tabId: 42,
                url: "https://example.com/b",
                title: "B",
                origin: "https://example.com",
                expiresAt: nil,
                accessMode: "all_tabs"
            ),
            from: "profile-b"
        )
        coordinator.handleExtensionMessage(
            ExtensionMessage.tabPermitted(
                tabId: 42,
                url: "https://example.com/a?updated",
                title: "A updated",
                origin: "https://example.com",
                expiresAt: nil,
                accessMode: "all_tabs"
            ),
            from: "profile-a"
        )

        let reordered = try tabRows(
            from: await coordinator.handleCLIRequest(CLIRequest(id: "reordered", method: "list_tabs"))
        )
        let profileA = try XCTUnwrap(reordered.first { $0["profile"] as? String == "Profile A" })
        let profileB = try XCTUnwrap(reordered.first { $0["profile"] as? String == "Profile B" })

        XCTAssertEqual(profileA["ref"] as? String, profileARef)
        XCTAssertEqual(profileA["targetId"] as? Int, profileATargetId)
        XCTAssertNotEqual(profileA["ref"] as? String, profileB["ref"] as? String)
        XCTAssertNotEqual(profileA["targetId"] as? Int, profileB["targetId"] as? Int)

        let ambiguous = await coordinator.handleCLIRequest(
            CLIRequest(
                id: "ambiguous",
                method: "get_tab",
                params: AnyCodable(["tabId": 42, "what": "url"])
            )
        )
        XCTAssertEqual(ambiguous.error?.code, "ambiguous_tab_id")
        XCTAssertEqual(ambiguous.error?.candidates?.count, 2)
    }

    @MainActor
    func testCoordinatorRejectsOversizedEvalBeforeDispatch() async {
        let coordinator = GatewayCoordinator.shared
        let response = await coordinator.handleCLIRequest(
            CLIRequest(
                id: "oversized",
                method: "eval_tab",
                params: AnyCodable([
                    "tabId": -1,
                    "script": String(repeating: "x", count: EvalScriptLimits.maximumBytes + 1),
                ])
            )
        )

        XCTAssertEqual(response.error?.code, "script_too_large")
        XCTAssertEqual(response.error?.nextCommand, "abg eval --help")
    }

    private func tabRows(from response: CLIResponse) throws -> [[String: Any]] {
        try XCTUnwrap(response.result?.value as? [[String: Any]])
    }
}
