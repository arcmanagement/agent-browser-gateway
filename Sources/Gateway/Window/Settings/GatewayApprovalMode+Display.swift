import GatewayCore

/// Window copy for settings values. The raw values and GatewayCore titles stay unchanged
/// because the CLI and the JSON file use them.
extension GatewayApprovalMode {
    var displayTitle: String {
        switch self {
        case .extensionPopup: return "Follow each extension"
        case .requireApproval: return "Require approval"
        case .trustedAutomation: return "Trusted automation"
        }
    }

    var displayDetail: String {
        switch self {
        case .extensionPopup:
            return "Use the approval setting from each browser's ABG popup."
        case .requireApproval:
            return "Write operations default to a local approval window."
        case .trustedAutomation:
            return "Trusted profiles default to the reduced-prompt policy (AutoMode) where supported. Operations are still audited."
        }
    }
}

extension GatewayDomainPolicyAction {
    var tone: GateTone {
        switch self {
        case .allow: return .signal
        case .ask: return .neutral
        case .deny: return .danger
        }
    }
}
