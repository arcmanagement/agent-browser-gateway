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

public struct GatewayDomainPolicy: Codable, Equatable, Identifiable, Sendable {
    public var domain: String
    public var approvalMode: GatewayApprovalMode
    public var timeoutMs: Int
    public var appliesToSubdomains: Bool

    public var id: String { domain }

    public init(
        domain: String,
        approvalMode: GatewayApprovalMode = .extensionPopup,
        timeoutMs: Int = GatewaySettings.defaultTimeoutMs,
        appliesToSubdomains: Bool = true
    ) {
        self.domain = GatewaySettings.normalizedDomain(domain) ?? domain.trimmingCharacters(in: .whitespacesAndNewlines)
        self.approvalMode = approvalMode
        self.timeoutMs = GatewaySettings.clampedTimeout(timeoutMs)
        self.appliesToSubdomains = appliesToSubdomains
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
                approvalMode: policy.approvalMode,
                timeoutMs: policy.timeoutMs,
                appliesToSubdomains: policy.appliesToSubdomains
            )
        }
        return byDomain.values.sorted { $0.domain.localizedCaseInsensitiveCompare($1.domain) == .orderedAscending }
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
