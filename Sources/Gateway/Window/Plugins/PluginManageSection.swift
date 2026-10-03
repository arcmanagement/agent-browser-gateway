import SwiftUI

/// Enable/disable, update, and uninstall for user plugins.
struct PluginManageSection: View {
    var plugin: PluginHost.PluginSummary
    var model: PluginsModel

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space3) {
            HStack(spacing: GateMetrics.space2) {
                if plugin.isEnabled {
                    Button("Disable", systemImage: "pause.circle") {
                        Task { await model.disable(plugin) }
                    }
                    .help("Unload this plugin without deleting it")
                } else {
                    Button("Enable", systemImage: "play.circle") {
                        Task { await model.enable(plugin) }
                    }
                    .help("Enable and reload this plugin")
                }

                Button("Update", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await model.update(plugin) }
                }
                .disabled(!PluginsModel.isGitBacked(plugin))
                .help(PluginsModel.isGitBacked(plugin) ? "Pull updates with your local git credentials" : "Only plugins installed from git can be updated")

                Spacer(minLength: 0)

                Button("Uninstall…", role: .destructive) {
                    model.alert = .confirmUninstall(plugin)
                }
                .foregroundStyle(GateColor.dangerText)
                .help("Remove this plugin from the profile")
            }
            .disabled(model.isOperating(on: plugin))

            if let operation = model.operation, operation.pluginID == plugin.id {
                HStack(spacing: GateMetrics.space2) {
                    ProgressView()
                        .controlSize(.small)
                    Text(operation.title)
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
            } else if let message = model.message(for: plugin) {
                Label(message, systemImage: "checkmark.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Text("User plugins live in this profile's plugin directory. Disabling is a local file flag; updates use your git credentials, and ABG stores no tokens.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .gateCard()
    }
}
