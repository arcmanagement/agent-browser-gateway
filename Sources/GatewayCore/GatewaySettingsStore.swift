import Foundation

public enum GatewayApprovalMode: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case extensionPopup = "extension_popup"
    case requireApproval = "require_approval"
    case trustedAutomation = "trusted_automation"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .extensionPopup:
            return "Follow Extension"
        case .requireApproval:
            return "Require Approval"
        case .trustedAutomation:
            return "Trusted Automation"
        }
    }

    public var detail: String {
        switch self {
        case .extensionPopup:
            return "Use the active extension install's popup setting."
        case .requireApproval:
            return "Default write-like operations to local approval."
        case .trustedAutomation:
            return "Default trusted profiles to the reduced-prompt policy where supported."
        }
    }
}

public enum GatewayDomainPolicyAction: String, Codable, CaseIterable, Hashable, Identifiable, Sendable {
    case allow
    case ask
    case deny

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .allow:
            return "Allow"
        case .ask:
            return "Ask"
        case .deny:
            return "Deny"
        }
    }

    public var detail: String {
        switch self {
        case .allow:
            return "Allow commands after the tab is explicitly shared."
        case .ask:
            return "Keep per-tab sharing and prefer an extra local approval where supported."
        case .deny:
            return "Block commands for matching shared tabs."
        }
    }
}

public struct GatewayDomainPolicy: Codable, Equatable, Identifiable, Sendable {
    public var domain: String
    public var action: GatewayDomainPolicyAction
    public var approvalMode: GatewayApprovalMode
    public var timeoutMs: Int
    public var appliesToSubdomains: Bool

    public var id: String { domain }

    public init(
        domain: String,
        action: GatewayDomainPolicyAction = .ask,
        approvalMode: GatewayApprovalMode = .extensionPopup,
        timeoutMs: Int = GatewaySettings.defaultTimeoutMs,
        appliesToSubdomains: Bool = true
    ) {
        self.domain = GatewaySettings.normalizedDomain(domain) ?? domain.trimmingCharacters(in: .whitespacesAndNewlines)
        self.action = action
        self.approvalMode = approvalMode
        self.timeoutMs = GatewaySettings.clampedTimeout(timeoutMs)
        self.appliesToSubdomains = appliesToSubdomains
    }

    enum CodingKeys: String, CodingKey {
        case domain
        case action
        case approvalMode
        case timeoutMs
        case appliesToSubdomains
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let domain = try container.decode(String.self, forKey: .domain)
        let approvalMode = try container.decodeIfPresent(GatewayApprovalMode.self, forKey: .approvalMode) ?? .extensionPopup
        let action = try container.decodeIfPresent(GatewayDomainPolicyAction.self, forKey: .action)
            ?? Self.legacyAction(for: approvalMode)
        let timeoutMs = try container.decodeIfPresent(Int.self, forKey: .timeoutMs) ?? GatewaySettings.defaultTimeoutMs
        let appliesToSubdomains = try container.decodeIfPresent(Bool.self, forKey: .appliesToSubdomains) ?? true
        self.init(
            domain: domain,
            action: action,
            approvalMode: approvalMode,
            timeoutMs: timeoutMs,
            appliesToSubdomains: appliesToSubdomains
        )
    }

    private static func legacyAction(for approvalMode: GatewayApprovalMode) -> GatewayDomainPolicyAction {
        switch approvalMode {
        case .trustedAutomation:
            return .allow
        case .requireApproval, .extensionPopup:
            return .ask
        }
    }
}

public struct GatewaySettings: Codable, Equatable, Sendable {
    public static let defaultTimeoutMs = 30_000
    public static let minimumTimeoutMs = 1_000
    public static let maximumTimeoutMs = 300_000

    public var defaultTimeoutMs: Int
    public var approvalModeDefault: GatewayApprovalMode
    public var domainPolicies: [GatewayDomainPolicy]

    public init(
        defaultTimeoutMs: Int = Self.defaultTimeoutMs,
        approvalModeDefault: GatewayApprovalMode = .extensionPopup,
        domainPolicies: [GatewayDomainPolicy] = []
    ) {
        self.defaultTimeoutMs = Self.clampedTimeout(defaultTimeoutMs)
        self.approvalModeDefault = approvalModeDefault
        self.domainPolicies = Self.normalizedDomainPolicies(domainPolicies)
    }

    public var normalized: GatewaySettings {
        GatewaySettings(
            defaultTimeoutMs: defaultTimeoutMs,
            approvalModeDefault: approvalModeDefault,
            domainPolicies: domainPolicies
        )
    }

    public static func clampedTimeout(_ value: Int) -> Int {
        min(max(value, minimumTimeoutMs), maximumTimeoutMs)
    }

    public static func normalizedDomainPolicies(_ policies: [GatewayDomainPolicy]) -> [GatewayDomainPolicy] {
        var byDomain: [String: GatewayDomainPolicy] = [:]
        for policy in policies {
            guard let domain = normalizedDomain(policy.domain) else { continue }
            byDomain[domain] = GatewayDomainPolicy(
                domain: domain,
                action: policy.action,
                approvalMode: policy.approvalMode,
                timeoutMs: policy.timeoutMs,
                appliesToSubdomains: policy.appliesToSubdomains
            )
        }
        return byDomain.values.sorted { $0.domain.localizedCaseInsensitiveCompare($1.domain) == .orderedAscending }
    }

    public func policy(for url: String) -> GatewayDomainPolicy? {
        guard let host = URL(string: url)?.host(percentEncoded: false)?.lowercased() else {
            return nil
        }
        return domainPolicies
            .filter { policy in
                if policy.domain.hasPrefix("*.") {
                    let suffix = String(policy.domain.dropFirst(2))
                    return host == suffix || host.hasSuffix(".\(suffix)")
                }
                if host == policy.domain {
                    return true
                }
                return policy.appliesToSubdomains && host.hasSuffix(".\(policy.domain)")
            }
            .sorted { lhs, rhs in lhs.domain.count > rhs.domain.count }
            .first
    }

    public static func normalizedDomain(_ rawValue: String) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let hostCandidate: String
        if trimmed.contains("://"), let host = URL(string: trimmed)?.host(percentEncoded: false) {
            hostCandidate = host
        } else {
            hostCandidate = String(trimmed.split(separator: "/").first ?? "")
        }

        let withoutPort = String(hostCandidate.split(separator: ":").first ?? "")
        let normalized = withoutPort
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .lowercased()

        guard !normalized.isEmpty,
              !normalized.contains(where: { $0.isWhitespace }),
              normalized.allSatisfy({ character in
                  character.isLetter || character.isNumber || character == "-" || character == "." || character == "*"
              }),
              normalized != "*",
              !normalized.contains("..")
        else {
            return nil
        }
        if normalized.contains("*"), !normalized.hasPrefix("*.") {
            return nil
        }
        return normalized
    }
}

public enum GatewaySettingsStore {
    public static func settingsFile(userDirectory: URL = ABGConstants.abgUserDir) -> URL {
        userDirectory.standardizedFileURL.appendingPathComponent("gateway-settings.json")
    }

    public static func load(userDirectory: URL = ABGConstants.abgUserDir) -> GatewaySettings {
        let file = settingsFile(userDirectory: userDirectory)
        guard let data = try? Data(contentsOf: file),
              let settings = try? JSONDecoder().decode(GatewaySettings.self, from: data)
        else {
            return GatewaySettings()
        }
        return settings.normalized
    }

    public static func save(_ settings: GatewaySettings, userDirectory: URL = ABGConstants.abgUserDir) throws {
        let userDirectory = userDirectory.standardizedFileURL
        try FileManager.default.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        chmod(userDirectory.path, 0o700)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(settings.normalized)
        let file = settingsFile(userDirectory: userDirectory)
        try data.write(to: file, options: .atomic)
        chmod(file.path, 0o600)
    }
}
