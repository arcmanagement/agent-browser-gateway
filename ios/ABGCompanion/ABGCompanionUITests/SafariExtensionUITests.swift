import XCTest

final class SafariExtensionUITests: XCTestCase {
    @MainActor
    func testSafariTabSharing() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))
        let pageMenu = safari.buttons["PageFormatMenuButton"]
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
        pageMenu.tap()

        let extensionItem = safari.cells["Agent Browser Gateway"]
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()

        let stopButton = safari.buttons["Stop sharing"]
        if stopButton.waitForExistence(timeout: 2) {
            stopButton.tap()
            XCTAssertTrue(safari.buttons["Share this tab"].waitForExistence(timeout: 5))
        }

        let shareButton = safari.buttons["Share this tab"]
        XCTAssertTrue(shareButton.waitForExistence(timeout: 5))
        shareButton.tap()

        let doneButton = safari.buttons["完了"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
        doneButton.tap()
        pageMenu.tap()
        XCTAssertTrue(extensionItem.waitForExistence(timeout: 5))
        extensionItem.tap()
        XCTAssertTrue(stopButton.waitForExistence(timeout: 5), safari.debugDescription)
        let trustedAutomation = safari.switches.firstMatch
        XCTAssertTrue(trustedAutomation.waitForExistence(timeout: 5), safari.debugDescription)
        if trustedAutomation.value as? String != "1" {
            trustedAutomation.tap()
            XCTAssertEqual(trustedAutomation.value as? String, "1")
        }
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
        doneButton.tap()
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 5))
    }
}
