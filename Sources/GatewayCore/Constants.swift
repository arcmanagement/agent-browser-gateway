import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public enum ABGConstants {
    public static let bundleId = "jp.co.arcm.AgentBrowserGateway"
    public static let version = "0.4.5"
    // Shared rendezvous between the sandboxed Store gateway and bundled sandboxed CLI.
    public static let appGroupId = "group.jp.co.arcm.abg"
    public static let defaultWsPort: Int = 8765
    public static let wsHost = "127.0.0.1"
    // sockaddr_un.sun_path is 104 bytes on Darwin including the NUL terminator.
    public static let maxUnixSocketPathBytes = 103
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

    // MARK: - CLI transport rendezvous

    public static var isSandboxed: Bool {
        isSandboxed(environment: ProcessInfo.processInfo.environment)
    }

    public static func isSandboxed(environment: [String: String]) -> Bool {
        environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// Shared app-group directory readable by the sandboxed gateway, the bundled
    /// sandboxed CLI, and unsandboxed clients. Not profile-suffixed; per-profile
    /// artifacts inside it carry the profile in their filename instead.
    public static func groupContainerDir(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let override = configuredDirectoryOverride("ABG_GROUP_DIR", environment: environment) {
            return override
        }
        #if os(macOS)
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) {
            return url
        }
        #endif
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers", isDirectory: true)
            .appendingPathComponent(appGroupId, isDirectory: true)
    }

    /// The socket path the gateway should bind. The sandboxed (Mac App Store) gateway
    /// cannot use `udsPath`: its container-relative form exceeds the sun_path limit and
    /// unsandboxed clients resolve a different directory anyway. ABG_STATE_DIR keeps
    /// winning so dev/test setups pin both sides to one location.
    public static func configuredCLISocketPath(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if configuredDirectoryOverride("ABG_STATE_DIR", environment: environment) != nil {
            return configuredSupportDir(environment: environment)
                .appendingPathComponent("gateway.sock").path
        }
        if isSandboxed(environment: environment) {
            return groupContainerDir(environment: environment)
                .appendingPathComponent(groupSocketName(environment: environment)).path
        }
        return configuredSupportDir(environment: environment)
            .appendingPathComponent("gateway.sock").path
    }

    /// Ordered socket paths a CLI should probe. The standard path resolves inside the
    /// probing process's own view of Application Support, so a sandboxed CLI simply
    /// gets a harmless ENOENT there before moving on to the group container. The
    /// gateway's own app container is intentionally never probed: sandboxed CLIs are
    /// denied access and unsandboxed ones would trip Sonoma+ container-protection
    /// prompts.
    public static func cliSocketCandidates(environment: [String: String] = ProcessInfo.processInfo.environment) -> [String] {
        if configuredDirectoryOverride("ABG_STATE_DIR", environment: environment) != nil {
            return [configuredSupportDir(environment: environment)
                .appendingPathComponent("gateway.sock").path]
        }
        return [
            configuredSupportDir(environment: environment)
                .appendingPathComponent("gateway.sock").path,
            groupContainerDir(environment: environment)
                .appendingPathComponent(groupSocketName(environment: environment)).path,
        ]
    }

    /// Ordered `cli-endpoint` JSON candidates ({token, port}) for the WS fallback.
    public static func cliEndpointCandidates(environment: [String: String] = ProcessInfo.processInfo.environment) -> [String] {
        if configuredDirectoryOverride("ABG_STATE_DIR", environment: environment) != nil {
            return [configuredSupportDir(environment: environment)
                .appendingPathComponent(cliEndpointFileName(environment: environment)).path]
        }
        return [
            configuredSupportDir(environment: environment)
                .appendingPathComponent(cliEndpointFileName(environment: environment)).path,
            groupContainerDir(environment: environment)
                .appendingPathComponent(cliEndpointFileName(environment: environment)).path,
        ]
    }

    public static func cliEndpointFileName(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
        if let profile = configuredProfile(environment: environment) {
            return "cli-endpoint-\(profile).json"
        }
        return "cli-endpoint.json"
    }

    public static func fitsUnixSocketPath(_ path: String) -> Bool {
        path.utf8.count <= maxUnixSocketPathBytes
    }

    private static func groupSocketName(environment: [String: String]) -> String {
        if let profile = configuredProfile(environment: environment) {
            return "abg-\(profile).sock"
        }
        return "abg.sock"
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
        mediaOutputBaseDir(environment: environment)
            .appendingPathComponent("screenshots", isDirectory: true)
    }

    public static func configuredRecordingsDir(environment: [String: String]) -> URL {
        mediaOutputBaseDir(environment: environment)
            .appendingPathComponent("recordings", isDirectory: true)
    }

    /// Media written by a sandboxed process must land in the shared group container:
    /// paths inside the process's own container are invisible to the other side of a
    /// share and trip Sonoma+ container-protection prompts when third parties read
    /// them. Unsandboxed builds keep using the user temp dir.
    private static func mediaOutputBaseDir(environment: [String: String]) -> URL {
        let component: String
        if let profile = configuredProfile(environment: environment) {
            component = "abg-\(profile)"
        } else {
            component = "abg"
        }
        if isSandboxed(environment: environment) {
            return groupContainerDir(environment: environment)
                .appendingPathComponent(component, isDirectory: true)
        }
        return FileManager.default.temporaryDirectory
            .appendingPathComponent(component, isDirectory: true)
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
