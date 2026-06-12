import Foundation

enum SkillBundle {
    private static let bundleName = "AgentBrowserGateway_abg.bundle"

    static let markdown: String = loadMarkdownResource("agent-browser-gateway")
    static let pluginCreatorMarkdown: String = loadMarkdownResource("abg-plugin-creator")

    private static func loadMarkdownResource(_ name: String) -> String {
        let candidates = resourceCandidates(named: "\(name).md")
        guard let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else {
            preconditionFailure("\(name).md resource missing from abg bundle")
        }
        return text
    }

    private static func resourceCandidates(named filename: String) -> [URL] {
        let executablePath = CommandLine.arguments.first ?? "abg"
        let executableURL = URL(fileURLWithPath: executablePath)
        let resolvedExecutableURL = executableURL.resolvingSymlinksInPath()
        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)

        let candidateDirs = [
            executableURL.deletingLastPathComponent(),
            resolvedExecutableURL.deletingLastPathComponent(),
            URL(fileURLWithPath: "/opt/homebrew/bin", isDirectory: true),
            URL(fileURLWithPath: "/usr/local/bin", isDirectory: true),
            cwd,
            cwd.appendingPathComponent("Sources/abg/Resources", isDirectory: true),
        ]

        var seen = Set<String>()
        return candidateDirs.flatMap { dir -> [URL] in
            let urls = [
                dir.appendingPathComponent(bundleName, isDirectory: true).appendingPathComponent(filename),
                dir.appendingPathComponent(filename),
            ]
            return urls.filter { seen.insert($0.path).inserted }
        }
    }

    /// Parsed from the `version:` line in the markdown frontmatter so the
    /// resource file is the single source of truth.
    static let version: String = version(from: markdown, resourceName: "agent-browser-gateway.md")
    static let pluginCreatorVersion: String = version(from: pluginCreatorMarkdown, resourceName: "abg-plugin-creator.md")

    private static func version(from markdown: String, resourceName: String) -> String {
        for line in markdown.split(separator: "\n").prefix(20) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("version:") {
                return String(trimmed.dropFirst("version:".count))
                    .trimmingCharacters(in: .whitespaces)
            }
        }
        preconditionFailure("version not found in \(resourceName) frontmatter")
    }
}
