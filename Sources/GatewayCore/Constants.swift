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
        return url
    }

    public static var logsDir: URL {
        let url = FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)
            .first!
            .appendingPathComponent("Logs/AgentBrowserGateway", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    public static var udsPath: String {
        supportDir.appendingPathComponent("gateway.sock").path
    }

    public static var auditLogPath: String {
        logsDir.appendingPathComponent("audit.jsonl").path
    }

    public static var skillsDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/skills", isDirectory: true)
    }
}
