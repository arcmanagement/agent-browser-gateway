import Foundation
import GatewayCore

/// What agents can reach right now, reduced to the one state the UI leads with.
/// Kept free of SwiftUI so the rules are unit-testable.
enum GateState: Equatable {
    /// The Gateway could not open its local listener; nothing can connect.
    case attention(message: String)
    /// The Gateway runs, but no browser extension is connected.
    case noBrowser
    /// A browser is connected and no tab is shared: the gate is closed.
    case closed
    /// Tabs are shared. `allTabs` counts tabs shared by all-tabs (sandbox) mode.
    case open(shared: Int, allTabs: Int)

    init(permittedTabs: [PermittedTab], connectedExtensionCount: Int, statusMessage: String) {
        if statusMessage.hasPrefix("WS error") {
            self = .attention(message: statusMessage)
        } else if !permittedTabs.isEmpty {
            self = .open(
                shared: permittedTabs.count,
                allTabs: permittedTabs.filter(\.isAllTabsShare).count
            )
        } else if connectedExtensionCount > 0 {
            self = .closed
        } else {
            self = .noBrowser
        }
    }

    var isOpen: Bool {
        if case .open = self { return true }
        return false
    }

    var hasAllTabsShares: Bool {
        if case .open(_, let allTabs) = self { return allTabs > 0 }
        return false
    }

    /// One sentence that answers "what can agents see right now?".
    var headline: String {
        switch self {
        case .attention:
            return "The Gateway isn't listening"
        case .noBrowser:
            return "No browser connected"
        case .closed:
            return "Agents can't see any tab"
        case .open(let shared, _):
            return "Agents can see \(GateText.tabs(shared))"
        }
    }

    func detail(endpoint: String) -> String {
        switch self {
        case .attention(let message):
            return "\(message). Quit and reopen the app; if it persists, another process may be using \(endpoint)."
        case .noBrowser:
            return "Open Chrome with the ABG extension. It connects to this Gateway at \(endpoint)."
        case .closed:
            return "Nothing passes until you share a tab. In Chrome, open the ABG popup and choose Share this tab with agents."
        case .open(let shared, let allTabs):
            if allTabs == shared {
                return "All of them come from all-tabs mode in a sandbox profile. Turn it off in that profile's ABG popup."
            }
            if allTabs > 0 {
                return "You shared \(GateText.tabs(shared - allTabs)) one by one; \(GateText.tabs(allTabs)) come from all-tabs mode in a sandbox profile."
            }
            return "Each one stays shared until you revoke it or the tab leaves its site."
        }
    }
}

enum GateText {
    static func tabs(_ count: Int) -> String {
        count == 1 ? "1 tab" : "\(count) tabs"
    }

    static func browsers(_ count: Int) -> String {
        count == 1 ? "1 browser" : "\(count) browsers"
    }

    /// `abg` invocation that reaches this Gateway. Non-default ports (the dev variant)
    /// need `ABG_PORT` so the CLI finds the right rendezvous.
    static func cli(_ arguments: String, port: Int = ABGConstants.wsPort) -> String {
        let base = port == ABGConstants.defaultWsPort ? "abg" : "ABG_PORT=\(port) abg"
        return arguments.isEmpty ? base : "\(base) \(arguments)"
    }

    static var endpoint: String {
        "\(ABGConstants.wsHost):\(ABGConstants.wsPort)"
    }

    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ABGConstants.version
    }
}

extension PermittedTab {
    var isAllTabsShare: Bool { accessMode == "all_tabs" }

    /// Host without `www.`, or the raw URL when it has no host (e.g. `file:` pages).
    var displayHost: String {
        guard let host = URL(string: url)?.host, !host.isEmpty else { return url }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    var displayTitle: String {
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? displayHost : value
    }
}
