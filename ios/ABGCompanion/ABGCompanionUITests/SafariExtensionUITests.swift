import XCTest

final class SafariExtensionUITests: XCTestCase {
    @MainActor
    func testStopSharingUpdatesButton() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))
        let overviewDone = safari.buttons["DoneButton"]
        if overviewDone.waitForExistence(timeout: 2) {
            overviewDone.tap()
        }
        shareCurrentTab(in: safari)
        stopSharingCurrentTab(in: safari, closePopup: false)
    }

    @MainActor
    func testSafariTabSharing() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))
        let overviewDone = safari.buttons["DoneButton"]
        if overviewDone.waitForExistence(timeout: 2) {
            overviewDone.tap()
        }
        shareCurrentTab(in: safari)
        stopSharingCurrentTab(in: safari)
        shareCurrentTab(in: safari)

        let moreMenu = safari.buttons["MoreMenuButton"]
        XCTAssertTrue(moreMenu.waitForExistence(timeout: 5))
        moreMenu.tap()
        let newTab = safari.buttons["NewTabButton"]
        XCTAssertTrue(newTab.waitForExistence(timeout: 5))
        newTab.tap()

        let address = safari.textFields["TabBarItemTitle"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        let urlField = safari.textFields["URL"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 5))
        urlField.typeText("https://example.com\n")
        XCTAssertTrue(safari.staticTexts["Example Domain"].waitForExistence(timeout: 10))

        shareCurrentTab(in: safari)
        setTrustedAutomation(in: safari)
    }

    @MainActor
    func testEnableSiteCapabilities() throws {
        let companion = XCUIApplication()
        companion.launch()
        XCTAssertTrue(companion.wait(for: .runningForeground, timeout: 10))
        companion.terminate()

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.launch()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))
        navigate(in: safari, to: "http://192.168.1.3:8877/?run=\(Int(Date().timeIntervalSince1970))")
        XCTAssertTrue(safari.staticTexts["iPhone capability test"].waitForExistence(timeout: 10))
        shareCurrentTab(in: safari, closePopup: false)
        let trustedSwitch = safari.switches.element(boundBy: 0)
        XCTAssertTrue(trustedSwitch.waitForExistence(timeout: 5), safari.debugDescription)
        if trustedSwitch.value as? String != "1" {
            tapCheckbox(trustedSwitch)
        }
        assertSwitchEnabled(trustedSwitch, in: safari)

        let cookieSwitch = safari.switches.element(boundBy: 1)
        XCTAssertTrue(cookieSwitch.waitForExistence(timeout: 5), safari.debugDescription)
        if cookieSwitch.value as? String != "1" {
            tapCheckbox(cookieSwitch)
            allowSitePermissionIfNeeded(in: safari)
        }
        assertSwitchEnabled(cookieSwitch, in: safari)

        let readingListSwitch = safari.switches.element(boundBy: 2)
        XCTAssertTrue(readingListSwitch.waitForExistence(timeout: 5), safari.debugDescription)
        if readingListSwitch.value as? String != "1" {
            tapCheckbox(readingListSwitch)
        }
        assertSwitchEnabled(readingListSwitch, in: safari)

        let enabledEmbeddedSites = safari.buttons["Embedded sites enabled"]
        if !enabledEmbeddedSites.exists {
            let embeddedSites = safari.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Enable ")).firstMatch
            XCTAssertTrue(embeddedSites.waitForExistence(timeout: 5), safari.debugDescription)
            if embeddedSites.isEnabled {
                embeddedSites.tap()
                allowSitePermissionIfNeeded(in: safari)
            }
        }
        XCTAssertTrue(enabledEmbeddedSites.waitForExistence(timeout: 5), safari.debugDescription)
        closeExtensionPopupIfNeeded(in: safari)
    }

    @MainActor
    private func shareCurrentTab(in safari: XCUIApplication, closePopup: Bool = true) {
        let pageMenu = safari.buttons["PageFormatMenuButton"]
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        pageMenu.tap()

        let extensionItem = safari.cells["Agent Browser Gateway"]
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()

        let stopButton = safari.buttons["Stop sharing"]
        if !stopButton.waitForExistence(timeout: 2) {
            let shareButton = safari.buttons["Share this tab"]
            XCTAssertTrue(shareButton.waitForExistence(timeout: 5))
            shareButton.tap()
            XCTAssertTrue(stopButton.waitForExistence(timeout: 5), safari.debugDescription)
        }

        if closePopup {
            let doneButton = safari.buttons["完了"]
            XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
            doneButton.tap()
            XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        }
    }

    @MainActor
    private func stopSharingCurrentTab(in safari: XCUIApplication, closePopup: Bool = true) {
        let pageMenu = safari.buttons["PageFormatMenuButton"]
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        pageMenu.tap()

        let extensionItem = safari.cells["Agent Browser Gateway"]
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()

        let stopButton = safari.buttons["Stop sharing"]
        XCTAssertTrue(stopButton.waitForExistence(timeout: 5), safari.debugDescription)
        stopButton.tap()
        XCTAssertTrue(safari.buttons["Share this tab"].waitForExistence(timeout: 5), safari.debugDescription)

        if closePopup {
            let doneButton = safari.buttons["完了"]
            XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
            doneButton.tap()
            XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        }
    }

    @MainActor
    private func setTrustedAutomation(in safari: XCUIApplication) {
        let pageMenu = safari.buttons["PageFormatMenuButton"]
        pageMenu.tap()
        let extensionItem = safari.cells["Agent Browser Gateway"]
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()

        let trustedAutomation = safari.switches.firstMatch
        XCTAssertTrue(trustedAutomation.waitForExistence(timeout: 5), safari.debugDescription)
        if trustedAutomation.value as? String != "1" {
            trustedAutomation.tap()
            XCTAssertEqual(trustedAutomation.value as? String, "1")
        }
        let doneButton = safari.buttons["完了"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
        doneButton.tap()
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
    }

    @MainActor
    private func navigate(in safari: XCUIApplication, to url: String) {
        let address = safari.textFields["TabBarItemTitle"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        let urlField = safari.textFields["URL"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 5))
        urlField.typeText("\(url)\n")
    }

    @MainActor
    private func openExtensionPopup(in safari: XCUIApplication) {
        let pageMenu = safari.buttons["PageFormatMenuButton"]
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        pageMenu.tap()
        let extensionItem = safari.cells["Agent Browser Gateway"]
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()
        let ready = safari.buttons["Stop sharing"]
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == YES AND enabled == YES"),
            object: ready
        )
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 15), .completed, safari.debugDescription)
    }

    @MainActor
    private func allowSitePermissionIfNeeded(in safari: XCUIApplication) {
        let allow = safari.buttons.matching(NSPredicate(
            format: "label == %@ OR label == %@ OR label CONTAINS %@ OR label CONTAINS %@",
            "Allow", "許可", "Allow on", "このWebサイトで許可"
        )).firstMatch
        if allow.waitForExistence(timeout: 3) {
            allow.tap()
        }
    }

    @MainActor
    private func assertSwitchEnabled(_ element: XCUIElement, in safari: XCUIApplication) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed, safari.debugDescription)
    }

    @MainActor
    private func tapCheckbox(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.5)).tap()
    }

    @MainActor
    private func closeExtensionPopupIfNeeded(in safari: XCUIApplication) {
        let doneButton = safari.buttons["完了"]
        if doneButton.waitForExistence(timeout: 2) {
            doneButton.tap()
        }
        XCTAssertTrue(safari.buttons["PageFormatMenuButton"].waitForExistence(timeout: 5))
    }
}
