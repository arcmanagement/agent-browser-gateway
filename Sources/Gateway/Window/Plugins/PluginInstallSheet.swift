import SwiftUI

/// Installs a user plugin from a git source. Install stays disabled until the user
/// confirms they trust the source.
struct PluginInstallSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var sourceText = ""
    @State private var installName = ""
    @State private var replaceExisting = false
    @State private var trustSource = false
    @State private var isInstalling = false
    @State private var errorMessage: String?

    let onInstall: (String, String?, Bool) async throws -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space5) {
            VStack(alignment: .leading, spacing: GateMetrics.space1) {
                Text("Install a Plugin")
                    .font(.title2.weight(.semibold))
                Text("Plugins add commands and transforms to abg and run inside this Gateway. Private repositories use your local git credentials; ABG stores no tokens.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Form {
                TextField("Repository", text: $sourceText, prompt: Text(verbatim: "user/repo or https://github.com/user/repo.git"))
                    .font(.body.monospaced())
                    .disabled(isInstalling)
                    .onSubmit(startInstall)
                TextField("Install name", text: $installName, prompt: Text("Inferred from the repository"))
                    .disabled(isInstalling)
                Toggle("Replace an existing plugin with the same name", isOn: $replaceExisting)
                    .disabled(isInstalling)
                Toggle("I trust this source to run code in my Gateway", isOn: $trustSource)
                    .disabled(isInstalling)
            }
            .formStyle(.columns)

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(GateColor.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: GateMetrics.space2) {
                if isInstalling {
                    ProgressView()
                        .controlSize(.small)
                    Text("Installing…")
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(isInstalling)
                Button("Install", action: startInstall)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canInstall)
            }
        }
        .padding(GateMetrics.space6)
        .frame(width: 500)
    }

    private var canInstall: Bool {
        !trimmedSource.isEmpty && trustSource && !isInstalling
    }

    private var trimmedSource: String {
        sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String? {
        let value = installName.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func startInstall() {
        guard canInstall else { return }
        isInstalling = true
        errorMessage = nil
        Task {
            do {
                try await onInstall(trimmedSource, trimmedName, replaceExisting)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isInstalling = false
        }
    }
}
