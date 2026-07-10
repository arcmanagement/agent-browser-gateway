import SwiftUI
import AppKit
import Combine
import GatewayCore

@MainActor
final class GatewayAppDelegate: NSObject, NSApplicationDelegate {
    private let coordinator = GatewayCoordinator.shared
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
        return true
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = statusItemAutosaveName
        item.isVisible = true
        statusItem = item

        if let button = item.button {
            button.target = self
            button.action = #selector(togglePopover(_:))
            button.imagePosition = .imageLeft
            button.image = statusImage()
            button.title = menuBarTitle
            button.toolTip = menuBarTitle
            button.font = .systemFont(ofSize: 12, weight: .semibold)
        }

        popover.behavior = .transient
        popover.contentSize = NSSize(width: 390, height: 640)
        popover.contentViewController = NSHostingController(
            rootView: MenuBarView(coordinator: coordinator) { [weak self] in
                self?.popover.performClose(nil)
                self?.showDashboardWindow()
            }
        )
    }

    private func observeCoordinator() {
        coordinator.$permittedTabs
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refreshStatusItem() }
            .store(in: &cancellables)
    }

    private func refreshStatusItem() {
        guard let button = statusItem?.button else { return }
        button.image = statusImage()
        button.title = menuBarTitle
        button.toolTip = menuBarTitle
    }

    @objc private func togglePopover(_ sender: NSStatusBarButton) {
        if popover.isShown {
            popover.performClose(sender)
        } else {
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
        }
    }

    private func showDashboardWindow() {
        if dashboardWindowController == nil {
            dashboardWindowController = makeDashboardWindowController()
        }

        guard let window = dashboardWindowController?.window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makeDashboardWindowController() -> NSWindowController {
        let window = NSWindow(
            contentViewController: NSHostingController(
                rootView: GatewayWindowView(coordinator: coordinator)
            )
        )
        window.title = windowTitle
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unifiedCompact
        window.setContentSize(NSSize(width: 1040, height: 700))
        window.minSize = NSSize(width: 820, height: 560)
        window.isReleasedWhenClosed = false
        window.center()
        return NSWindowController(window: window)
    }

    private func statusImage() -> NSImage? {
        let name = coordinator.permittedTabs.isEmpty ? "shield" : "shield.lefthalf.filled"
        let image = NSImage(systemSymbolName: name, accessibilityDescription: menuBarTitle)
        image?.isTemplate = true
        return image
    }

    private var menuBarTitle: String {
        let base = ABGConstants.runtimeProfile.map { "ABG \($0)" } ?? "ABG"
        if coordinator.permittedTabs.count == 1,
           let tab = coordinator.permittedTabs.first {
            return "\(base) \(menuTabLabel(tab))"
        }
        if coordinator.permittedTabs.count > 1 {
            return "\(base) \(coordinator.permittedTabs.count)"
        }
        return base
    }

    private var statusItemAutosaveName: NSStatusItem.AutosaveName {
        let profile = ABGConstants.runtimeProfile ?? "prod"
        return "jp.co.arcm.AgentBrowserGateway.\(profile).statusItem.v2"
    }

    private var windowTitle: String {
        ABGConstants.runtimeProfile.map { "Agent Browser Gateway \($0)" } ?? "Agent Browser Gateway"
    }

    private func menuTabLabel(_ tab: PermittedTab) -> String {
        let title = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let value: String
        if !title.isEmpty {
            value = title
        } else if let host = URL(string: tab.url)?.host, !host.isEmpty {
            value = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        } else {
            value = tab.url
        }
        guard value.count > 18 else { return value }
        return "\(value.prefix(17))..."
    }
}

@main
struct GatewayApp: App {
    @NSApplicationDelegateAdaptor(GatewayAppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
