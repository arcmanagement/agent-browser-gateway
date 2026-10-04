import SwiftUI
import AppKit
import Combine
import GatewayCore

@MainActor
final class GatewayAppDelegate: NSObject, NSApplicationDelegate {
    private let coordinator = GatewayCoordinator.shared
    private let router = GatewayWindowRouter()
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var dashboardWindowController: NSWindowController?
    private var cancellables: Set<AnyCancellable> = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        coordinator.start()
        observeCoordinator()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showDashboardWindow()
        return false
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = statusItemAutosaveName
        item.isVisible = true
        statusItem = item

        if let button = item.button {
            button.target = self
            button.action = #selector(togglePopover(_:))
            // Icon only, like system status items; state lives in the glyph, the count in
            // the tooltip and accessibility label.
            button.imagePosition = .imageOnly
            button.title = ""
        }
        refreshStatusItem()

        popover.behavior = .transient
        popover.animates = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let host = NSHostingController(
            rootView: MenuBarView(coordinator: coordinator, openWindow: { [weak self] in
                self?.popover.performClose(nil)
                self?.showDashboardWindow()
            })
        )
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
    }

    private func observeCoordinator() {
        Publishers.CombineLatest3(
            coordinator.$permittedTabs,
            coordinator.$connectedExtensionIds,
            coordinator.$statusMessage
        )
        .receive(on: RunLoop.main)
        .sink { [weak self] _ in self?.refreshStatusItem() }
        .store(in: &cancellables)
    }

    private func refreshStatusItem() {
        guard let button = statusItem?.button else { return }
        let state = GateState(
            permittedTabs: coordinator.permittedTabs,
            connectedExtensionCount: coordinator.connectedExtensionIds.count,
            statusMessage: coordinator.statusMessage
        )
        let profile = ABGConstants.runtimeProfile
        button.image = StatusItemImage.image(for: state, profile: profile)
        button.toolTip = StatusItemImage.accessibilityDescription(for: state, profile: profile)
        button.setAccessibilityLabel(button.toolTip)
    }

    @objc private func togglePopover(_ sender: NSStatusBarButton) {
        if popover.isShown {
            popover.performClose(sender)
        } else {
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    @objc func showSettingsSection(_ sender: Any?) {
        showDashboardWindow(section: .settings)
    }

    @objc func showSection(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let section = GatewaySection(rawValue: raw) else { return }
        showDashboardWindow(section: section)
    }

    func showDashboardWindow(section: GatewaySection? = nil) {
        if let section {
            router.section = section
        }
        if dashboardWindowController == nil {
            dashboardWindowController = makeDashboardWindowController()
        }

        guard let window = dashboardWindowController?.window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makeDashboardWindowController() -> NSWindowController {
        let host = NSHostingController(
            rootView: GatewayWindowView(coordinator: coordinator, router: router)
        )
        // Bridge SwiftUI toolbars and titles into this AppKit-owned window.
        host.sceneBridgingOptions = [.toolbars, .title]
        // Each section's navigationTitle becomes the window title ("Overview", "Audit", …).
        // Bridging applies on change, so seed the first one.
        let window = NSWindow(contentViewController: host)
        window.title = router.section.title
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.toolbarStyle = .unified
        window.setContentSize(NSSize(width: 1180, height: 760))
        window.minSize = NSSize(width: 880, height: 580)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName(windowAutosaveName)
        if !window.setFrameUsingName(windowAutosaveName) {
            window.center()
        }
        return NSWindowController(window: window)
    }

    private var statusItemAutosaveName: NSStatusItem.AutosaveName {
        let profile = ABGConstants.runtimeProfile ?? "prod"
        return "jp.co.arcm.AgentBrowserGateway.\(profile).statusItem.v2"
    }

    private var windowAutosaveName: String {
        let profile = ABGConstants.runtimeProfile ?? "prod"
        return "jp.co.arcm.AgentBrowserGateway.\(profile).window.v3"
    }
}

/// AppKit entry point. The Gateway is a menu bar utility whose only window is AppKit-owned,
/// so a SwiftUI `App` added nothing but an empty Settings scene, which macOS opened at
/// launch. The main menu is never shown for an accessory app, but it routes the standard
/// key equivalents (⌘C/⌘V in text fields, ⌘W, ⌘Q, ⌘, and ⌘1…⌘5) while the window is key.
@main
enum GatewayMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = GatewayAppDelegate()
        app.delegate = delegate
        app.mainMenu = GatewayMainMenu.make(target: delegate)
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}
