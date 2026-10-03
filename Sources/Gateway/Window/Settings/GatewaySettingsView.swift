import SwiftUI
import AppKit
import GatewayCore

/// Profile-local defaults and domain policies from gateway-settings.json, plus the
/// window appearance and the local files the Gateway keeps.
struct GatewaySettingsView: View {
    @Bindable var model: SettingsModel
    @Binding var appearance: String

    var body: some View {
        Form {
            Section {
                Picker("Default approval", selection: $model.approvalModeDefault) {
                    ForEach(GatewayApprovalMode.allCases) { mode in
                        Text(mode.displayTitle).tag(mode)
                    }
                }
                LabeledContent("Command timeout") {
                    HStack(spacing: GateMetrics.space2) {
                        TextField("Timeout in milliseconds", value: $model.defaultTimeoutMs, format: .number)
                            .labelsHidden()
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .frame(width: 84)
                        Text("ms")
                            .foregroundStyle(.secondary)
                        Stepper("Command timeout", value: $model.defaultTimeoutMs, in: SettingsModel.timeoutRange, step: 1_000)
                            .labelsHidden()
                    }
                }
            } header: {
                Text("Defaults")
            } footer: {
                Text("\(model.approvalModeDefault.displayDetail) Timeouts range from \(GatewaySettings.minimumTimeoutMs / 1000) to \(GatewaySettings.maximumTimeoutMs / 1000) seconds.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, GateMetrics.space2)
            }

            Section {
                if model.settings.domainPolicies.isEmpty {
                    Text("No domain policies. Every shared tab uses the defaults above.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.settings.domainPolicies) { policy in
                        DomainPolicyRow(policy: policy) {
                            model.removeDomainPolicy(policy)
                        }
                    }
                }
                NewDomainPolicyRow(model: model)
            } header: {
                Text("Domain policies")
            } footer: {
                Text("The most specific matching domain wins. Deny blocks commands on matching shared tabs; sharing a tab is still up to you.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, GateMetrics.space2)
            }

            Section("Window") {
                Picker("Appearance", selection: $appearance) {
                    ForEach(WindowAppearance.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
            }

            Section {
                LocalFileRow(title: "Settings", path: GatewaySettingsStore.settingsFile().path, isOwnerOnly: model.settingsFileIsOwnerOnly)
                LocalFileRow(title: "Audit log", path: ABGConstants.auditLogPath, isOwnerOnly: nil)
                LocalFileRow(title: "Logs folder", path: ABGConstants.logsDir.path, isOwnerOnly: nil, isFolder: true)
                LocalFileRow(title: "CLI socket", path: ABGConstants.configuredCLISocketPath(), isOwnerOnly: nil, revealable: false)
            } header: {
                Text("Local files")
            } footer: {
                Text("Everything stays on this Mac: no analytics, no phone-home, no cloud dependency.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, GateMetrics.space2)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .navigationTitle("Settings")
        .navigationSubtitle(model.hasUnsavedChanges ? "Unsaved changes" : "gateway-settings.json")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(GateColor.dangerText)
                } else if let message = model.message {
                    Label(message, systemImage: "checkmark.circle")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(.secondary)
                }
                Button("Revert", action: model.reload)
                    .disabled(!model.hasUnsavedChanges)
                    .help("Discard unsaved changes and reload the file")
                Button("Save", action: model.save)
                    .keyboardShortcut("s")
                    .disabled(!model.hasUnsavedChanges)
                    .help("Save to gateway-settings.json (⌘S)")
            }
        }
        .onAppear {
            // Keep a draft when the user switches sections; otherwise pick up file edits.
            if !model.hasUnsavedChanges { model.reload() }
        }
    }
}
