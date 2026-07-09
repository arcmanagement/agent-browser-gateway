import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public enum ABGConstants {
    public static let bundleId = "co.arcm.AgentBrowserGateway"
    public static let defaultWsPort: Int = 8765
    public static let wsHost = "127.0.0.1"
    public static var wsPort: Int {
        configuredWsPort(environment: ProcessInfo.processInfo.environment)
    }

    public static var runtimeProfile: String? {
        configuredProfile(environment: ProcessInfo.processInfo.environment)
    }

    public static var runtimeProfileLabel: String {
        runtimeProfile ?? "prod"
    }

    public static var supportDir: URL {
        let url = configuredSupportDir(environment: ProcessInfo.processInfo.environment)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var logsDir: URL {
        let url = configuredLogsDir(environment: ProcessInfo.processInfo.environment)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var abgUserDir: URL {
        let url = configuredUserDir(environment: ProcessInfo.processInfo.environment)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var userPluginsDir: URL {
        let url = abgUserDir.appendingPathComponent("plugins", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var screenshotsDir: URL {
        let url = configuredScreenshotsDir(environment: ProcessInfo.processInfo.environment)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var recordingsDir: URL {
        let url = configuredRecordingsDir(environment: ProcessInfo.processInfo.environment)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var udsPath: String {
        supportDir.appendingPathComponent("gateway.sock").path
    }

    public static var auditLogPath: String {
        logsDir.appendingPathComponent("audit.jsonl").path
    }

    public static var claudeSkillsDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/skills", isDirectory: true)
    }

    public static var codexSkillsDir: URL {
        let home: URL
        if let env = ProcessInfo.processInfo.environment["CODEX_HOME"], !env.isEmpty {
            let expanded = (env as NSString).expandingTildeInPath
            home = URL(fileURLWithPath: expanded, isDirectory: true)
        } else {
            home = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".codex", isDirectory: true)
        }
        return home.appendingPathComponent("skills", isDirectory: true)
    }

    public static func configuredWsPort(environment: [String: String]) -> Int {
        guard let raw = environment["ABG_PORT"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let port = Int(raw),
              (1...65535).contains(port) else {
            return defaultWsPort
        }
        return port
    }

    public static func configuredProfile(environment: [String: String]) -> String? {
        if let rawProfile = environment["ABG_PROFILE"],
           !rawProfile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return normalizedProfile(rawProfile)
        }
        return configuredWsPort(environment: environment) == defaultWsPort ? nil : "dev"
    }

    public static func configuredSupportDir(environment: [String: String]) -> URL {
        if let override = configuredDirectoryOverride("ABG_STATE_DIR", environment: environment) {
            return override
        }
        let component = profiledComponent("AgentBrowserGateway", environment: environment)
        return FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent(component, isDirectory: true)
    }

    public static func configuredLogsDir(environment: [String: String]) -> URL {
        if let override = configuredDirectoryOverride("ABG_LOGS_DIR", environment: environment) {
            return override
        }
        let component = profiledComponent("AgentBrowserGateway", environment: environment)
        return FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent(component, isDirectory: true)
    }

    public static func configuredUserDir(environment: [String: String]) -> URL {
        if let override = configuredDirectoryOverride("ABG_USER_DIR", environment: environment) {
            return override
        }
        let component: String
        if let profile = configuredProfile(environment: environment) {
            component = ".abg-\(profile)"
        } else {
            component = ".abg"
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(component, isDirectory: true)
    }

    public static func configuredScreenshotsDir(environment: [String: String]) -> URL {
        let component: String
        if let profile = configuredProfile(environment: environment) {
            component = "abg-\(profile)"
        } else {
            component = "abg"
        }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(component, isDirectory: true)
            .appendingPathComponent("screenshots", isDirectory: true)
    }

    public static func configuredRecordingsDir(environment: [String: String]) -> URL {
        let component: String
        if let profile = configuredProfile(environment: environment) {
            component = "abg-\(profile)"
        } else {
            component = "abg"
        }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(component, isDirectory: true)
            .appendingPathComponent("recordings", isDirectory: true)
    }

    private static func profiledComponent(_ productionComponent: String, environment: [String: String]) -> String {
        guard let profile = configuredProfile(environment: environment) else {
            return productionComponent
        }
        return "\(productionComponent)-\(profile)"
    }

    private static func configuredDirectoryOverride(_ name: String, environment: [String: String]) -> URL? {
        guard let raw = environment[name]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: (raw as NSString).expandingTildeInPath, isDirectory: true)
    }

    private static func normalizedProfile(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        let lower = trimmed.lowercased()
        if ["prod", "production", "default"].contains(lower) {
            return nil
        }
        let sanitized = trimmed
            .replacingOccurrences(of: #"[^A-Za-z0-9_.-]+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-_"))
        return sanitized.isEmpty ? nil : sanitized
    }
}
