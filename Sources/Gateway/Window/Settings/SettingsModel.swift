import Foundation
import Observation
import GatewayCore

/// Edits gateway-settings.json. Changes stay a draft until Save, as before; the model
/// now tracks unsaved changes so the window can say so.
@MainActor
@Observable
final class SettingsModel {
    var settings = GatewaySettingsStore.load()
    private(set) var savedSettings = GatewaySettingsStore.load()
    private(set) var message: String?
    private(set) var error: String?

    var newPolicyDomain = ""
    var newPolicyAction: GatewayDomainPolicyAction = .ask
    var newPolicyApprovalMode: GatewayApprovalMode = .extensionPopup
    var newPolicyTimeoutMs = GatewaySettings.defaultTimeoutMs
    var newPolicyAppliesToSubdomains = true

    static var timeoutRange: ClosedRange<Int> {
        GatewaySettings.minimumTimeoutMs...GatewaySettings.maximumTimeoutMs
    }

    var hasUnsavedChanges: Bool {
        settings.normalized != savedSettings
    }

    var canAddDomainPolicy: Bool {
        GatewaySettings.normalizedDomain(newPolicyDomain) != nil
    }

    var defaultTimeoutMs: Int {
        get { settings.defaultTimeoutMs }
        set {
            settings.defaultTimeoutMs = GatewaySettings.clampedTimeout(newValue)
            clearFeedback()
        }
    }

    var approvalModeDefault: GatewayApprovalMode {
        get { settings.approvalModeDefault }
        set {
            settings.approvalModeDefault = newValue
            clearFeedback()
        }
    }

    var clampedNewPolicyTimeoutMs: Int {
        get { newPolicyTimeoutMs }
        set { newPolicyTimeoutMs = GatewaySettings.clampedTimeout(newValue) }
    }

    var settingsFileIsOwnerOnly: Bool {
        let path = GatewaySettingsStore.settingsFile().path
        guard FileManager.default.fileExists(atPath: path),
              let permissions = try? FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber else {
            return false
        }
        return permissions.intValue & 0o077 == 0
    }

    func reload() {
        settings = GatewaySettingsStore.load()
        savedSettings = settings
        clearFeedback()
    }

    func save() {
        do {
            settings = settings.normalized
            try GatewaySettingsStore.save(settings)
            savedSettings = settings
            error = nil
            message = "Saved to gateway-settings.json."
        } catch {
            message = nil
            self.error = error.localizedDescription
        }
    }

    func addDomainPolicy() {
        guard let domain = GatewaySettings.normalizedDomain(newPolicyDomain) else {
            message = nil
            error = "Enter a domain such as example.com."
            return
        }
        let policy = GatewayDomainPolicy(
            domain: domain,
            action: newPolicyAction,
            approvalMode: newPolicyApprovalMode,
            timeoutMs: newPolicyTimeoutMs,
            appliesToSubdomains: newPolicyAppliesToSubdomains
        )
        settings.domainPolicies.removeAll { $0.domain == domain }
        settings.domainPolicies.append(policy)
        settings.domainPolicies = GatewaySettings.normalizedDomainPolicies(settings.domainPolicies)
        newPolicyDomain = ""
        newPolicyTimeoutMs = settings.defaultTimeoutMs
        clearFeedback()
    }

    func removeDomainPolicy(_ policy: GatewayDomainPolicy) {
        settings.domainPolicies.removeAll { $0.id == policy.id }
        clearFeedback()
    }

    private func clearFeedback() {
        message = nil
        error = nil
    }
}
