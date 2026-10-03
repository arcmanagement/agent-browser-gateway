import SwiftUI

struct PluginListRow: View {
    var plugin: PluginHost.PluginSummary
    var source: PluginSource

    var body: some View {
        HStack(spacing: GateMetrics.space3) {
            PluginGlyph(name: plugin.name, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: GateMetrics.space2) {
                    Text(plugin.name)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    if !plugin.isEnabled {
                        GateBadge(text: "off")
                    }
                }
                Text(plugin.description ?? "No description")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if source != .bundled {
                // Built-in is the common case; only call out user and local plugins.
                GateBadge(text: source.title)
            }
        }
        .padding(.vertical, 3)
        .opacity(plugin.isEnabled ? 1 : 0.6)
        .accessibilityElement(children: .combine)
    }
}

/// Monochrome plugin glyph: plugins are tools, not brands, so they stay neutral.
struct PluginGlyph: View {
    var name: String
    var size: CGFloat

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.44))
            .foregroundStyle(.secondary)
            .frame(width: size, height: size)
            .background(Color.primary.opacity(0.07), in: .rect(cornerRadius: size * 0.26))
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch name {
        case "gmail", "gmail-plugin": return "envelope"
        case "slack", "slack-plugin": return "bubble.left.and.bubble.right"
        case "linear", "linear-plugin": return "list.bullet.rectangle"
        case "redaction", "redaction-plugin": return "eye.slash"
        case "workflow", "workflow-plugin": return "arrow.triangle.branch"
        case "notion-plugin": return "doc.richtext"
        case "markdown-plugin": return "text.alignleft"
        case "info-plugin": return "info.circle"
        default: return "puzzlepiece.extension"
        }
    }
}
