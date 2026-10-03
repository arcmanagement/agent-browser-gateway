import XCTest
import GatewayCore
@testable import Gateway

/// The Gateway app's status language: what the menu bar icon, popover, and Overview say
/// agents can see. These rules decide whether the UI claims a tab is open, so they are
/// pinned here.
final class GateStateTests: XCTestCase {
    private func tab(_ id: Int, mode: String = "manual", ext: String = "ext-a") -> PermittedTab {
        PermittedTab(
            extensionId: ext,
            tabId: id,
            url: "https://www.example.com/\(id)",
            title: "",
            origin: "https://www.example.com",
            permittedAt: Date(),
            accessMode: mode
        )
    }

    func testNoBrowserWhenNothingConnected() {
        let state = GateState(permittedTabs: [], connectedExtensionCount: 0, statusMessage: "Running")
        XCTAssertEqual(state, .noBrowser)
        XCTAssertEqual(state.headline, "No browser connected")
    }

    func testClosedWhenBrowserConnectedButNothingShared() {
        let state = GateState(permittedTabs: [], connectedExtensionCount: 1, statusMessage: "Running")
        XCTAssertEqual(state, .closed)
        XCTAssertFalse(state.isOpen)
        XCTAssertEqual(state.headline, "Agents can't see any tab")
    }

    func testOpenCountsAllTabsSharesSeparately() {
        let state = GateState(
            permittedTabs: [tab(1), tab(2, mode: "all_tabs"), tab(3, mode: "all_tabs")],
            connectedExtensionCount: 2,
            statusMessage: "Running"
        )
        XCTAssertEqual(state, .open(shared: 3, allTabs: 2))
        XCTAssertTrue(state.isOpen)
        XCTAssertTrue(state.hasAllTabsShares)
        XCTAssertEqual(state.headline, "Agents can see 3 tabs")
        XCTAssertEqual(GateState.open(shared: 1, allTabs: 0).headline, "Agents can see 1 tab")
    }

    func testListenerErrorTakesPriority() {
        let state = GateState(permittedTabs: [], connectedExtensionCount: 0, statusMessage: "WS error: address in use")
        XCTAssertEqual(state, .attention(message: "WS error: address in use"))
    }

    func testSocketFallbackIsNotAnAttentionState() {
        let message = "UDS error: path too long — CLI stays available over loopback WS"
        XCTAssertEqual(GateState(permittedTabs: [], connectedExtensionCount: 1, statusMessage: message), .closed)
    }

    func testGateMarkModeUsesAmberOnlyWhenEveryShareIsAllTabs() {
        XCTAssertEqual(GateMark.Mode(.open(shared: 2, allTabs: 2)), .sandbox)
        XCTAssertEqual(GateMark.Mode(.open(shared: 2, allTabs: 1)), .open)
        XCTAssertEqual(GateMark.Mode(.closed), .closed)
        XCTAssertEqual(GateMark.Mode(.noBrowser), .dormant)
    }

    func testCLIHintAddsPortOnlyForNonDefaultPort() {
        XCTAssertEqual(GateText.cli("status", port: ABGConstants.defaultWsPort), "abg status")
        XCTAssertEqual(GateText.cli("tabs --compact", port: 8766), "ABG_PORT=8766 abg tabs --compact")
    }

    func testTabDisplayFallsBackToHostWithoutWWW() {
        let shared = tab(7)
        XCTAssertEqual(shared.displayHost, "example.com")
        XCTAssertEqual(shared.displayTitle, "example.com")
        XCTAssertNotEqual(shared.revocationKey, tab(7, ext: "ext-b").revocationKey)
    }

    func testExtensionLabelPrefersProfileLabel() {
        XCTAssertEqual(MenuBarView.extensionLabel(id: "4b2ad75a-1", profile: " work ", browser: "chrome"), "work")
        XCTAssertEqual(MenuBarView.extensionLabel(id: "4b2ad75a-1", profile: nil, browser: "chrome"), "Chrome · 4b2a")
        XCTAssertEqual(MenuBarView.extensionLabel(id: "4b2ad75a-1", profile: "", browser: nil), "Browser · 4b2a")
    }

    @MainActor
    func testStatusItemDescribesStateInWords() {
        XCTAssertEqual(
            StatusItemImage.accessibilityDescription(for: .open(shared: 8, allTabs: 0)),
            "Agent Browser Gateway — 8 tabs shared"
        )
        XCTAssertEqual(
            StatusItemImage.accessibilityDescription(for: .noBrowser, profile: "dev"),
            "Agent Browser Gateway (dev) — no browser connected"
        )
        let image = StatusItemImage.image(for: .closed, profile: "dev")
        XCTAssertTrue(image.isTemplate)
        XCTAssertGreaterThan(image.size.width, StatusItemImage.pointSize.width)
        XCTAssertEqual(StatusItemImage.image(for: .closed).size, StatusItemImage.pointSize)
    }
}
