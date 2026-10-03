import AppKit

/// Standard App, Edit, View, and Window menus. Hidden for an accessory app, yet they keep
/// the expected shortcuts working inside the Gateway window.
@MainActor
enum GatewayMainMenu {
    static func make(target: GatewayAppDelegate) -> NSMenu {
        let main = NSMenu()

        let appMenu = NSMenu(title: "Agent Browser Gateway")
        appMenu.addItem(withTitle: "About Agent Browser Gateway", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settings = appMenu.addItem(withTitle: "Settings…", action: #selector(GatewayAppDelegate.showSettingsSection(_:)), keyEquivalent: ",")
        settings.target = target
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Agent Browser Gateway", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addSubmenuItem(appMenu)

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addSubmenuItem(edit)

        let view = NSMenu(title: "View")
        for section in GatewaySection.allCases {
            let item = view.addItem(
                withTitle: section.title,
                action: #selector(GatewayAppDelegate.showSection(_:)),
                keyEquivalent: String(section.shortcutKey)
            )
            item.target = target
            item.representedObject = section.rawValue
        }
        main.addSubmenuItem(view)

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        main.addSubmenuItem(window)
        NSApplication.shared.windowsMenu = window

        return main
    }
}

private extension NSMenu {
    func addSubmenuItem(_ submenu: NSMenu) {
        let item = NSMenuItem(title: submenu.title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        addItem(item)
    }
}
