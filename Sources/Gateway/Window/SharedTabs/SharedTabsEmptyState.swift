import SwiftUI

/// Empty state with the exact steps and the CLI line that confirms them.
struct SharedTabsEmptyState: View {
    var hasBrowser: Bool

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(hasBrowser ? "No tabs shared" : "No browser connected")
            } icon: {
                GateMark(mode: hasBrowser ? .closed : .dormant)
                    .frame(width: 44, height: 44)
            }
        } description: {
            Text(hasBrowser
                 ? "Agents can't see anything. In Chrome, click the ABG icon and choose Share this tab with agents, or press ⌥⇧S (the default shortcut)."
                 : "Open Chrome with the ABG extension. It connects to this Gateway at \(GateText.endpoint).")
        } actions: {
            CommandLineView(command: GateText.cli("tabs --compact"))
                .fixedSize()
        }
    }
}
