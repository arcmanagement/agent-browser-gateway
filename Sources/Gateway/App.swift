import SwiftUI
import AppKit
import GatewayCore

final class GatewayAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        GatewayCoordinator.shared.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

@main
struct GatewayApp: App {
    @NSApplicationDelegateAdaptor(GatewayAppDelegate.self) var appDelegate
    @StateObject private var coordinator = GatewayCoordinator.shared

    var body: some Scene {
        MenuBarExtra {
            MenuBarView(coordinator: coordinator)
        } label: {
            Label {
                Text(menuBarTitle)
            } icon: {
                Image(systemName: coordinator.permittedTabs.isEmpty ? "shield" : "shield.lefthalf.filled")
            }
        }
        .menuBarExtraStyle(.window)
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
