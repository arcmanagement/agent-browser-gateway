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
        .menuBarExtraStyle(.menu)
    }

    private var menuBarTitle: String {
        if let profile = ABGConstants.runtimeProfile {
            return "ABG \(profile)"
        }
        return "ABG"
    }
}
