import Foundation

public enum ABGConstants {
    public static let bundleId = "co.arcm.AgentBrowserGateway"
    public static let wsHost = "127.0.0.1"
    public static let wsPort: Int = 8765

    public static var supportDir: URL {
        let url = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("AgentBrowserGateway", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        chmod(url.path, 0o700)
        return url
    }

    public static var logsDir: URL {
        let url = FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("Logs/AgentBrowserGateway", isDirectory: true)
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
}
