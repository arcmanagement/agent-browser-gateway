import SwiftUI
import AppKit

struct PluginDetailView: View {
    var plugin: PluginHost.PluginSummary
    var model: PluginsModel

    private var source: PluginSource { PluginSource(plugin: plugin) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: GateMetrics.space5) {
                header
                if source == .user {
                    PluginManageSection(plugin: plugin, model: model)
                }
                if !PluginsModel.commandRows(plugin).isEmpty {
                    commands
                }
                if !plugin.domains.isEmpty || !plugin.transforms.isEmpty {
                    HStack(alignment: .top, spacing: GateMetrics.space4) {
                        chips(title: "Domains", values: plugin.domains, empty: "None declared")
                        chips(title: "Transforms", values: plugin.transforms, empty: "None")
                    }
                }
                location
            }
            .padding(GateMetrics.space6)
            .frame(maxWidth: GateMetrics.contentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: GateMetrics.space4) {
            PluginGlyph(name: plugin.name, size: 48)
            VStack(alignment: .leading, spacing: GateMetrics.space1) {
                HStack(spacing: GateMetrics.space2) {
                    Text(plugin.name)
                        .font(.title2.weight(.semibold))
                        .textSelection(.enabled)
                    GateBadge(text: source.title)
                    if !plugin.isEnabled {
                        GateBadge(text: "disabled")
                    }
                }
                Text(metaLine)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let description = plugin.description, !description.isEmpty {
                    Text(description)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, GateMetrics.space1)
                }
            }
        }
    }

    private var metaLine: String {
        var parts: [String] = []
        if let version = plugin.version, !version.isEmpty { parts.append("v\(version)") }
        if let author = plugin.author, !author.isEmpty { parts.append(author) }
        parts.append(plugin.isLoaded ? "loaded" : "not loaded")
        let commandCount = PluginsModel.commandRows(plugin).count
        parts.append(commandCount == 0 ? "no commands" : commandCount == 1 ? "1 command" : "\(commandCount) commands")
        return parts.joined(separator: " · ")
    }

    private var commands: some View {
        let rows = PluginsModel.commandRows(plugin)
        return VStack(alignment: .leading, spacing: GateMetrics.space3) {
            SectionLabel(title: "Commands", count: rows.count)
            ForEach(rows) { command in
                VStack(alignment: .leading, spacing: GateMetrics.space1) {
                    CommandLineView(command: GateText.cli("\(plugin.name) \(command.name)"))
                    if let description = command.description, !description.isEmpty {
                        Text(description)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.leading, GateMetrics.space1)
                    }
                    if !command.args.isEmpty {
                        FlowLayout(spacing: GateMetrics.space1) {
                            ForEach(command.args, id: \.self) { arg in
                                GateBadge(text: arg, monospaced: true)
                            }
                        }
                        .padding(.leading, GateMetrics.space1)
                    }
                }
            }
        }
        .gateCard()
    }

    private func chips(title: String, values: [String], empty: String) -> some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            SectionLabel(title: title, count: values.count)
            if values.isEmpty {
                Text(empty)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                FlowLayout(spacing: GateMetrics.space1) {
                    ForEach(values, id: \.self) { value in
                        GateBadge(text: value, monospaced: true)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .gateCard()
    }

    private var location: some View {
        HStack(spacing: GateMetrics.space2) {
            Image(systemName: "folder")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(verbatim: plugin.path)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer(minLength: 0)
            Button("Show in Finder", systemImage: "arrow.up.forward.app") {
                NSWorkspace.shared.selectFile(plugin.path, inFileViewerRootedAtPath: "")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .help("Show in Finder")
            CopyButton(label: "Copy path", value: plugin.path)
        }
    }
}
