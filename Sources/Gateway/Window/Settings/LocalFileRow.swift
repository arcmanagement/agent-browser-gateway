import SwiftUI
import AppKit

/// A local path the Gateway owns, with Show in Finder (or Open for folders) and Copy.
struct LocalFileRow: View {
    var title: String
    var path: String
    var isOwnerOnly: Bool?
    var isFolder = false
    var revealable = true

    var body: some View {
        LabeledContent {
            HStack(spacing: GateMetrics.space2) {
                Text(verbatim: displayPath)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .help(path)
                if isOwnerOnly == true {
                    GateBadge(text: "0600", monospaced: true)
                        .help("Readable and writable by your user only")
                }
                if revealable {
                    Button(isFolder ? "Open \(title)" : "Show \(title) in Finder", systemImage: "arrow.up.forward.app", action: reveal)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help(isFolder ? "Open in Finder" : "Show in Finder")
                }
                CopyButton(label: "Copy \(title.lowercased()) path", value: path)
            }
        } label: {
            Text(title)
        }
    }

    private var displayPath: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return path.hasPrefix(home) ? "~" + path.dropFirst(home.count) : path
    }

    private func reveal() {
        if isFolder {
            NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))
        } else {
            NSWorkspace.shared.selectFile(path, inFileViewerRootedAtPath: "")
        }
    }
}
